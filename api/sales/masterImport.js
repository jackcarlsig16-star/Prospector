import { parseCsv } from '../../src/utils/csv.js';
import { normalizeDomain, isConsumerDomain } from '../../src/constants/partnerDomains.js';
import { PIPELINE_STATUS_IDS } from '../../src/constants/partnerPipeline.js';
import { OWNER_TEAMS } from '../../src/constants/ownership.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { normName, findByName, matchOwner } from './intakeMatch.js';
import { bulkStageRefusal } from './pipelineStages.js';
import { validateFields } from './pipelineRoutes.js';
import { applyPartnerSignal } from './partnerSignals.js';
import { addDays } from './goalsShared.js';
import { laDateString } from './laDate.js';

// master-pipeline-import-v1 - the HomeLover x Upside master sheet into
// partners (sales_goals), targets (sales_targets) and employers
// (sales_opportunities). plan() is pure and is the dry run; applyPlan()
// writes exactly what the plan says. Keyed on record_id, so a re-run only
// fills, moves an employer forward, or reports. Partners are never
// stage-moved and never touched (no last_touch_at, no touch events):
// ownership goes through the Assign signal, everything else is a plain
// fill-empty update. No partner_domains rows, no Apollo, no Claude.

export const ACCOUNT_HEADERS = ['record_id', 'name', 'kind', 'category', 'segment', 'tier', 'funnel_stage', 'owner_team',
  'owner_name', 'co_owner_name', 'next_step', 'next_step_due', 'company_domain', 'partner_path', 'route_in',
  'broker_on_account', 'source', 'flags', 'notes'];
export const CONTACT_HEADERS = ['record_id', 'name', 'title', 'role'];
const KINDS = ['partner', 'employer', 'association', 'health_plan', 'other'];
const ROLES = ['champion', 'blocker', 'referrer', 'counterpart', 'other'];
const TIERS = ['1', '2', '3', '4'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Sheet label -> [partner stage (compared only), opportunity stage].
export const SHEET_STAGES = {
  'Not contacted': ['not_started', 'target'],
  'Contacted': ['first_email_sent', 'contacted'],
  'Engaged': ['replied', 'responded'],
  'Meeting scheduled': ['meeting_set', 'meeting'],
  'Meeting held': ['meeting_set', 'meeting'],
  'Pilot/proposal': ['proposal_pilot', 'proposal_pilot'],
  'Live': ['live', 'launched'],
  'Nurture': [null, 'nurture'],
  'Hold': ['paused', 'on_hold'],
};
const NOTE_FIELDS = [['partner_path', 'Partner path'], ['route_in', 'Route in'], ['broker_on_account', 'Broker on account'],
  ['source', 'Source'], ['flags', 'Flags'], ['notes', 'Notes']];

export class ImportRefused extends Error {}

// No email address and no phone number may enter: the whole file is refused
// and the message names the record, never the value.
const PHONE = /\+?\d[\d\s().-]{7,}\d/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function readFile(text, headers, label) {
  const { headers: got, rows } = parseCsv(String(text || '').replace(/^﻿/, '').replace(/\r/g, ''));
  if (got.join(',') !== headers.join(',')) throw new ImportRefused(`${label}: headers must be exactly ${headers.join(',')}`);
  rows.forEach((r, i) => {
    for (const [k, v] of Object.entries(r)) {
      const phone = v.match(PHONE);
      if (v.includes('@') || (phone && !ISO_DATE.test(phone[0]))) {
        throw new ImportRefused(`${label} line ${i + 2} (${r.record_id || 'no record_id'}, ${k}): contains ${v.includes('@') ? 'an "@"' : 'a phone number'} - remove it and re-export`);
      }
    }
  });
  return rows;
}

const one = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const empty = v => v == null || (typeof v === 'string' && !v.trim());

// Company level: global.lockton.com = lockton.com, x.co.uk keeps three labels.
export function companyDomain(d) {
  const parts = d.split('.');
  const n = parts.length > 2 && parts[parts.length - 1].length === 2 && ['co', 'com', 'org', 'net', 'ac', 'gov'].includes(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-n).join('.');
}
const words = s => new Set(normName(s).split(' ').filter(w => w.length >= 3 && w !== 'and' && w !== 'the'));
const shareWord = (a, b) => { const wb = words(b); return [...words(a)].some(w => wb.has(w)); };

export function readInput(accountsText, contactsText) {
  const accounts = readFile(accountsText, ACCOUNT_HEADERS, 'accounts.csv');
  const contacts = readFile(contactsText, CONTACT_HEADERS, 'contacts.csv');
  const invalid = [];
  const seen = new Set();
  const valid = [];
  for (const raw of accounts) {
    const r = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, one(v)]));
    const bad = [];
    if (!r.record_id) bad.push('record_id is empty');
    else if (seen.has(r.record_id)) bad.push('record_id appears twice');
    if (!r.name) bad.push('name is empty');
    if (!KINDS.includes(r.kind)) bad.push(`kind "${r.kind}"`);
    if (r.tier && !TIERS.includes(r.tier)) bad.push(`tier "${r.tier}"`);
    if (r.funnel_stage && !(r.funnel_stage in SHEET_STAGES)) bad.push(`funnel_stage "${r.funnel_stage}"`);
    if (r.owner_team && !OWNER_TEAMS.includes(r.owner_team)) bad.push(`owner_team "${r.owner_team}"`);
    if (r.next_step_due && !DATE_RE.test(r.next_step_due)) bad.push(`next_step_due "${r.next_step_due}"`);
    if (r.co_owner_name.length > 120) bad.push('co_owner_name over 120 characters');
    if (r.company_domain) {
      const d = normalizeDomain(r.company_domain);
      if (!d || isConsumerDomain(d)) bad.push(`company_domain "${r.company_domain}"`);
      else r.company_domain = d;
    }
    seen.add(r.record_id);
    if (bad.length) invalid.push({ record_id: r.record_id, name: r.name, reason: bad.join('; ') });
    else valid.push(r);
  }
  const people = new Map();
  for (const raw of contacts) {
    const c = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, one(v)]));
    if (!c.record_id || !c.name) continue;
    if (!people.has(c.record_id)) people.set(c.record_id, []);
    people.get(c.record_id).push({ name: c.name, title: c.title || null, role: ROLES.includes(c.role) ? c.role : null });
  }
  return { accounts: valid, contacts: people, invalid };
}

export async function loadState(supabase, businessId) {
  const all = (table, cols, extra = q => q) => selectAllPages(() => extra(supabase.from(table).select(cols).eq('business_id', businessId)).order('id'));
  const [partners, domains, opps, targets, contacts, todos, sequenced] = await Promise.all([
    all('sales_goals', 'id, name, record_id, tier, category, owner_user_id, owner_team, co_owner_name, next_step, notes, company_domain, pipeline_status, last_touch_at',
      q => q.eq('goal_type', 'partnership').is('archived_at', null)),
    all('partner_domains', 'id, goal_id, domain', q => q.eq('confirmed', true)),
    all('sales_opportunities', '*', q => q.is('archived_at', null)),
    all('sales_targets', 'id, name, record_id, kind, status, suggested_category, owner_team, co_owner_name, research_notes'),
    all('partner_contacts', 'id, goal_id, name, title, role_in_notes'),
    all('sales_week_goals', 'id, text, status, kind', q => q.eq('kind', 'todo').eq('status', 'open')),
    selectAllPages(() => supabase.from('sales_sequenced_accounts').select('account_id, name').eq('business_id', businessId).order('account_id')),
  ]);
  const [{ data: members, error: mErr }, { data: snap, error: sErr }] = await Promise.all([
    supabase.from('business_members').select('user_id, name').eq('business_id', businessId),
    supabase.from('sales_raw_snapshots').select('payload').eq('business_id', businessId).eq('entity', 'accounts')
      .order('captured_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (mErr || sErr) throw new Error((mErr || sErr).message);
  const accountDomains = new Map((Array.isArray(snap?.payload) ? snap.payload : []).map(a => [a.id, normalizeDomain(a.domain || '')]));
  return {
    partners, domains, opps, targets, contacts, todos,
    sequenced: sequenced.map(s => ({ ...s, domain: accountDomains.get(s.account_id) || null })),
    members: (members || []).map(m => ({ id: m.user_id, name: m.name })),
    categories: [...new Set(partners.map(p => p.category).filter(Boolean))],
  };
}

// The marker block: "— master sheet <record_id> —" and the lines under it up
// to the next blank line. A re-run replaces only that block.
export function withBlock(notes, recordId, lines) {
  const marker = `— master sheet ${recordId} —`;
  const block = lines.length ? [marker, ...lines] : [];
  const ls = (notes || '').split('\n');
  const i = ls.findIndex(l => l.trim() === marker);
  let out;
  if (i === -1) out = block.length ? [...(notes && notes.trim() ? [notes.replace(/\s+$/, ''), ''] : []), ...block] : ls;
  else { let j = i + 1; while (j < ls.length && ls[j].trim()) j++; out = [...ls.slice(0, i), ...block, ...ls.slice(j)]; }
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text || null;
}

const personName = line => line.split(/ — | \(/)[0].trim().toLowerCase();
function mergeLines(existing, lines) {
  const have = new Set((existing || '').split('\n').filter(l => l.trim()).map(personName));
  const add = lines.filter(l => !have.has(personName(l)));
  if (!add.length) return null;
  return [existing && existing.trim() ? existing.replace(/\s+$/, '') : null, ...add].filter(Boolean).join('\n');
}

function partnerStageCompare(current, sheetLabel) {
  const sheet = SHEET_STAGES[sheetLabel]?.[0];
  const now = current || 'not_started';
  if (!sheet || sheet === now) return null;
  if (sheet === 'paused' || now === 'paused') return 'differs';
  return PIPELINE_STATUS_IDS.indexOf(sheet) > PIPELINE_STATUS_IDS.indexOf(now) ? 'ahead' : 'behind';
}

function matchPartner(r, state) {
  const byRecord = state.partners.find(p => p.record_id === r.record_id);
  if (byRecord) return { row: byRecord, by: 'record_id' };
  if (r.company_domain) {
    const cd = companyDomain(r.company_domain);
    const goalIds = new Set(state.domains.filter(d => companyDomain(d.domain) === cd).map(d => d.goal_id));
    const hits = state.partners.filter(p => goalIds.has(p.id) && shareWord(p.name, r.name));
    if (hits.length === 1) return { row: hits[0], by: 'domain' };
  }
  const exact = findByName(r.name, state.partners, 'name', false);
  return exact ? { row: exact, by: 'name' } : null;
}

function matchOpp(r, state) {
  const byRecord = state.opps.find(o => o.record_id === r.record_id);
  if (byRecord) return { row: byRecord, by: 'record_id' };
  const key = r.name.toLowerCase();
  const hits = state.opps.filter(o => o.organization.trim().toLowerCase() === key);
  return hits.length === 1 ? { row: hits[0], by: 'name' } : null;
}

function sequencedFor(r, state) {
  if (r.company_domain) {
    const cd = companyDomain(r.company_domain);
    const hits = state.sequenced.filter(s => s.domain && companyDomain(s.domain) === cd && shareWord(s.name || '', r.name));
    if (hits.length === 1) return hits[0];
  }
  return findByName(r.name, state.sequenced, 'name', false);
}

function possibleFor(r, state) {
  const p = findByName(r.name, state.partners, 'name', true);
  if (p) return `partner ${p.name}`;
  const o = findByName(r.name, state.opps, 'organization', true);
  if (o) return `employer ${o.organization}`;
  const s = findByName(r.name, state.sequenced, 'name', true);
  return s ? `sequenced ${s.name}` : null;
}

function noteLines(r, extra = []) {
  return [...extra, ...NOTE_FIELDS.filter(([k]) => r[k]).map(([k, label]) => `${label}: ${r[k]}`)];
}

export function plan(state, input, { acceptPossible = [], today = laDateString() } = {}) {
  const actions = [];
  const report = {
    counts: { partner_update: 0, partner_to_target: 0, target_update: 0, opp_insert: 0, opp_update: 0, skipped: 0, invalid: input.invalid.length },
    differences: [], partner_stages: [], opp_stage_moves: [], opp_stage_refused: [], possibles: [], kind_mismatches: [],
    skipped: [], invalid: input.invalid, contacts: { partner_insert: 0, partner_update: 0, opp_lines: 0, target_lines: 0 }, todos: 0,
  };
  const diff = (r, field, prospector, sheet) => report.differences.push({ record_id: r.record_id, name: r.name, field, prospector, sheet });
  const skip = (r, reason) => { report.counts.skipped++; report.skipped.push({ record_id: r.record_id, name: r.name, reason }); };
  const ownerId = r => (/^(jack|cyrus)$/i.test(r.owner_name) ? matchOwner(r.owner_name, state.members) : null);

  for (const r of input.accounts) {
    const people = input.contacts.get(r.record_id) || [];
    const accepted = acceptPossible.includes(r.record_id);
    const isPartner = r.kind === 'partner';
    const oppHit = isPartner ? null : matchOpp(r, state);
    const partnerHit = oppHit ? null : matchPartner(r, state);
    if (!isPartner && partnerHit) report.kind_mismatches.push({ record_id: r.record_id, name: r.name, sheet_kind: r.kind, prospector: `partner ${partnerHit.row.name}` });

    if (partnerHit) {
      const p = partnerHit.row;
      const a = { route: 'partner_update', record_id: r.record_id, name: r.name, goal_id: p.id, matched_by: partnerHit.by, patch: {}, assign: {}, contacts: [], todo: null };
      if (p.record_id && p.record_id !== r.record_id) diff(r, 'record_id', p.record_id, r.record_id);
      else if (!p.record_id) a.patch.record_id = r.record_id;
      for (const [field, value] of [['tier', r.tier], ['next_step', r.next_step], ['company_domain', r.company_domain]]) {
        if (!value) continue;
        if (empty(p[field])) a.patch[field] = value;
        else if (String(p[field]).toLowerCase() !== value.toLowerCase()) diff(r, field, p[field], value);
      }
      if (r.category) {
        if (!state.categories.includes(r.category)) diff(r, 'category (not a Prospector category, not written)', p.category, r.category);
        else if (empty(p.category)) a.patch.category = r.category;
        else if (p.category !== r.category) diff(r, 'category', p.category, r.category);
      }
      if (r.owner_team && r.owner_team !== p.owner_team) a.assign.owner_team = r.owner_team;
      if (r.co_owner_name && r.co_owner_name !== p.co_owner_name) a.assign.co_owner_name = r.co_owner_name;
      const owner = ownerId(r);
      if (owner && !p.owner_user_id) a.assign.owner_user_id = owner;
      else if (owner && owner !== p.owner_user_id) diff(r, 'owner', state.members.find(m => m.id === p.owner_user_id)?.name || p.owner_user_id, r.owner_name);
      const notes = withBlock(p.notes, r.record_id, noteLines(r));
      if ((notes || null) !== (p.notes || null)) a.patch.notes = notes;
      const dir = partnerStageCompare(p.pipeline_status, r.funnel_stage);
      if (dir) report.partner_stages.push({ record_id: r.record_id, name: r.name, prospector: p.pipeline_status || 'not_started', sheet: r.funnel_stage, dir });
      for (const c of people) {
        const hit = state.contacts.find(x => x.goal_id === p.id && x.name.trim().toLowerCase() === c.name.toLowerCase());
        if (!hit) { a.contacts.push({ op: 'insert', name: c.name, title: c.title, role_in_notes: c.role }); report.contacts.partner_insert++; continue; }
        const patch = {};
        if (c.title && c.title !== hit.title) patch.title = c.title;
        if (c.role && c.role !== hit.role_in_notes) patch.role_in_notes = c.role;
        if (Object.keys(patch).length) { a.contacts.push({ op: 'update', id: hit.id, name: c.name, patch }); report.contacts.partner_update++; }
      }
      if (r.next_step && r.next_step_due && !state.todos.some(t => t.text.trim().toLowerCase() === r.next_step.toLowerCase())) {
        a.todo = { text: r.next_step, due_date: r.next_step_due, owner_user_id: a.assign.owner_user_id || p.owner_user_id || null };
        report.todos++;
      }
      report.counts.partner_update++;
      actions.push(a);
      continue;
    }

    if (isPartner) {
      const t = state.targets.find(x => x.record_id === r.record_id) || state.targets.find(x => x.name.trim().toLowerCase() === r.name.toLowerCase());
      const lines = people.map(c => `${c.name}${c.title ? ` — ${c.title}` : ''}`);
      if (t) {
        if (t.status === 'rejected') { skip(r, 'a rejected target (never again)'); continue; }
        const patch = {};
        if (!t.record_id) patch.record_id = r.record_id;
        if (r.category && empty(t.suggested_category)) patch.suggested_category = r.category;
        if (r.owner_team && r.owner_team !== t.owner_team) patch.owner_team = r.owner_team;
        if (r.co_owner_name && r.co_owner_name !== t.co_owner_name) patch.co_owner_name = r.co_owner_name;
        const research = mergeLines(t.research_notes, lines);
        if (research) { patch.research_notes = research; report.contacts.target_lines += lines.length; }
        report.counts.target_update++;
        actions.push({ route: 'target_update', record_id: r.record_id, name: r.name, target_id: t.id, patch });
        continue;
      }
      const possible = possibleFor(r, state);
      if (possible && !accepted) { report.possibles.push({ record_id: r.record_id, name: r.name, possible }); skip(r, `possible match: ${possible} (--accept-possible ${r.record_id} to import as new)`); continue; }
      report.contacts.target_lines += lines.length;
      report.counts.partner_to_target++;
      actions.push({ route: 'partner_to_target', record_id: r.record_id, name: r.name, row: {
        name: r.name, kind: 'partner', status: 'proposed', evidence: `master sheet ${r.record_id}`, suggested_category: r.category || null,
        owner_team: r.owner_team || null, co_owner_name: r.co_owner_name || null, record_id: r.record_id, research_notes: lines.join('\n') || null,
      } });
      continue;
    }

    const stage = SHEET_STAGES[r.funnel_stage]?.[1] || null;
    const extra = [...(r.company_domain ? [`Domain: ${r.company_domain}`] : []), ...(['health_plan', 'other'].includes(r.kind) ? [`Account type: ${r.kind === 'health_plan' ? 'Health plan' : 'Other'}`] : [])];
    const dmLines = people.map(c => `${c.name}${c.title ? ` — ${c.title}` : ''}${c.role ? ` (${c.role})` : ''}`);
    const seq = sequencedFor(r, state);
    const owner = /^(jack|cyrus)$/i.test(r.owner_name) ? r.owner_name[0].toUpperCase() + r.owner_name.slice(1).toLowerCase() : null;
    if (oppHit) {
      const o = oppHit.row;
      const patch = {};
      if (o.record_id && o.record_id !== r.record_id) diff(r, 'record_id', o.record_id, r.record_id);
      else if (!o.record_id) patch.record_id = r.record_id;
      for (const [field, value] of [['cohort', r.segment], ['tier', r.tier], ['next_action', r.next_step], ['next_action_date', r.next_step_due], ['owner', owner]]) {
        if (!value) continue;
        if (empty(o[field])) patch[field] = value;
        else if (String(o[field]).toLowerCase() !== value.toLowerCase()) diff(r, field, o[field], value);
      }
      const orgType = r.kind === 'association' ? 'membership' : 'employer';
      if (o.org_type !== orgType) diff(r, 'org_type', o.org_type, orgType);
      if (r.owner_team && r.owner_team !== o.owner_team) patch.owner_team = r.owner_team;
      if (r.co_owner_name && r.co_owner_name !== o.co_owner_name) patch.co_owner_name = r.co_owner_name;
      if (seq && empty(o.apollo_account_id)) patch.apollo_account_id = seq.account_id;
      if (stage && stage !== o.stage) {
        const refusal = bulkStageRefusal(o.stage, stage);
        if (refusal) report.opp_stage_refused.push({ record_id: r.record_id, name: r.name, prospector: o.stage, sheet: stage, reason: refusal });
        else { patch.stage = stage; report.opp_stage_moves.push({ record_id: r.record_id, name: r.name, from: o.stage, to: stage }); }
      }
      const notes = withBlock(o.notes, r.record_id, noteLines(r, extra));
      if ((notes || null) !== (o.notes || null)) patch.notes = notes;
      const dm = mergeLines(o.decision_makers, dmLines);
      if (dm) { patch.decision_makers = dm; report.contacts.opp_lines += dmLines.filter(l => !(o.decision_makers || '').toLowerCase().includes(personName(l))).length; }
      report.counts.opp_update++;
      actions.push({ route: 'opp_update', record_id: r.record_id, name: r.name, opp_id: o.id, matched_by: oppHit.by, patch });
      continue;
    }
    const possible = possibleFor(r, state);
    if (possible && !accepted) { report.possibles.push({ record_id: r.record_id, name: r.name, possible }); skip(r, `possible match: ${possible} (--accept-possible ${r.record_id} to import as new)`); continue; }
    const fields = {
      organization: r.name, org_type: r.kind === 'association' ? 'membership' : 'employer', stage: stage || 'target',
      ...(r.segment ? { cohort: r.segment } : {}), ...(r.tier ? { tier: r.tier } : {}), ...(r.next_step ? { next_action: r.next_step } : {}),
      ...(r.next_step_due ? { next_action_date: r.next_step_due } : {}), ...(owner ? { owner } : {}),
      ...(r.owner_team ? { owner_team: r.owner_team } : {}), ...(r.co_owner_name ? { co_owner_name: r.co_owner_name } : {}),
      ...(dmLines.length ? { decision_makers: dmLines.join('\n') } : {}),
    };
    const notes = withBlock(null, r.record_id, noteLines(r, extra));
    if (notes) fields.notes = notes;
    const { payload, error } = validateFields(fields);
    if (error) { skip(r, error); continue; }
    report.contacts.opp_lines += dmLines.length;
    report.counts.opp_insert++;
    actions.push({ route: 'opp_insert', record_id: r.record_id, name: r.name, row: { ...payload, record_id: r.record_id, apollo_account_id: seq?.account_id || null, source: 'csv' } });
  }
  return { actions, report };
}

// A to-do lands in this LA week (Monday), linked to the partner.
const mondayOf = d => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

export async function applyPlan(supabase, businessId, { actions }, { now = new Date() } = {}) {
  const done = { partner_update: 0, assign: 0, partner_to_target: 0, target_update: 0, opp_insert: 0, opp_update: 0, contacts: 0, todos: 0, errors: [] };
  const week = mondayOf(laDateString(now));
  const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
  for (const a of actions) {
    try {
      if (a.route === 'partner_update') {
        if (Object.keys(a.patch).length) { must(await supabase.from('sales_goals').update({ ...a.patch, updated_at: now.toISOString() }).eq('id', a.goal_id).select('id')); done.partner_update++; }
        if (Object.keys(a.assign).length) {
          await applyPartnerSignal(supabase, { businessId, goalId: a.goal_id, signal: { type: 'assign', ...a.assign }, now, meta: { from_import: a.record_id } });
          done.assign++;
        }
        for (const c of a.contacts) {
          if (c.op === 'insert') must(await supabase.from('partner_contacts').insert({ business_id: businessId, goal_id: a.goal_id, name: c.name, title: c.title, role_in_notes: c.role_in_notes, source: 'manual' }).select('id'));
          else must(await supabase.from('partner_contacts').update({ ...c.patch, updated_at: now.toISOString() }).eq('id', c.id).select('id'));
          done.contacts++;
        }
        if (a.todo) {
          must(await supabase.from('sales_week_goals').insert({ business_id: businessId, week_start: week, kind: 'todo', status: 'open', text: a.todo.text,
            due_date: a.todo.due_date, owner_user_id: a.todo.owner_user_id, link_type: 'partner', link_id: a.goal_id }).select('id'));
          done.todos++;
        }
      } else if (a.route === 'partner_to_target') {
        must(await supabase.from('sales_targets').insert({ business_id: businessId, ...a.row }).select('id'));
        done.partner_to_target++;
      } else if (a.route === 'target_update' && Object.keys(a.patch).length) {
        must(await supabase.from('sales_targets').update({ ...a.patch, updated_at: now.toISOString() }).eq('id', a.target_id).select('id'));
        done.target_update++;
      } else if (a.route === 'opp_insert') {
        must(await supabase.from('sales_opportunities').insert({ business_id: businessId, ...a.row }).select('id'));
        done.opp_insert++;
      } else if (a.route === 'opp_update' && Object.keys(a.patch).length) {
        must(await supabase.from('sales_opportunities').update({ ...a.patch, updated_at: now.toISOString() }).eq('id', a.opp_id).select('id'));
        done.opp_update++;
      }
    } catch (e) { done.errors.push({ record_id: a.record_id, name: a.name, error: e.message }); }
  }
  return done;
}
