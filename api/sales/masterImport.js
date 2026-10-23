import { parseCsv } from '../../src/utils/csv.js';
import { normalizeDomain, isConsumerDomain } from '../../src/constants/partnerDomains.js';
import { PIPELINE_STATUSES, PIPELINE_STATUS_IDS } from '../../src/constants/partnerPipeline.js';
import { STAGE_LABELS } from '../../src/components/salesAnalytics/pipelineStages.js';
import { OWNER_TEAMS } from '../../src/constants/ownership.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { normName, findByName, matchOwner } from './intakeMatch.js';
import { bulkStageRefusal } from './pipelineStages.js';
import { validateFields } from './pipelineRoutes.js';
import { applyPartnerSignal } from './partnerSignals.js';
import { addDays } from './goalsShared.js';
import { laDateString } from './laDate.js';
import { sourceDirectory, mapSheetSource, sourceColumns, sourceOf, isOpen, logSource } from './leadSource.js';

// master-pipeline-import-v1 - the HomeLover x Upside master sheet into
// partners (sales_goals), targets (sales_targets) and employers
// (sales_opportunities). plan() is pure and is the dry run; applyPlan()
// writes exactly what the plan says. Keyed on record_id, so a re-run only
// fills, moves an employer forward, or reports. Partners are never
// stage-moved and never touched (no last_touch_at, no touch events):
// ownership goes through the Assign signal, everything else is a plain
// fill-empty update. No partner_domains rows, no Apollo, no Claude.

// The sheet's own CSV export, read through this one map: sheet header ->
// field (+ parser). Headers match case/space-insensitively. A header not here
// is ignored and listed in the dry run, so a new sheet column = one entry.
// Record ID and Account are required headers; every other header is optional.
// The board's own export (pipelineBoard.js SHEET_COLUMNS) reads through the
// same map: Type, Stage (Prospector's labels or ids) and Prospector ID.
const stripNumber = v => v.replace(/^\d+\s*-\s*/, '');
const kindOf = v => v.toLowerCase().replace(/\s+/g, '_');
// Excel's CSV export writes dates as M/D/YYYY.
const isoDate = v => { const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : v; };
export const HEADER_MAP = {
  'Record ID': { field: 'record_id', required: true },
  'Prospector ID': { field: 'prospector_id' },
  'Account': { field: 'name', required: true },
  'Account Type': { field: 'kind', parse: kindOf },
  'Type': { field: 'kind', parse: kindOf },
  'Segment': { field: 'segment' },
  'Priority Tier': { field: 'tier', parse: v => (/^active$/i.test(v) ? 'active' : v.match(/^(\d)\b/)?.[1] ?? v) },
  'Funnel Stage': { field: 'funnel_stage', parse: v => (/^hold\b/i.test(stripNumber(v)) ? 'Hold' : stripNumber(v)) },
  'Stage': { field: 'stage' },
  'Owner Team': { field: 'owner_team', parse: v => v.toLowerCase() },
  'Owner': { field: 'owner_name' },
  'Next Step': { field: 'next_step' },
  'Next Step Due': { field: 'next_step_due', parse: isoDate },
  'Primary Email Domain': { field: 'company_domain', parse: v => v.split(/[\s,;]+/)[0] },
  'Primary Contact': { field: 'contact_name' },
  'Primary Title': { field: 'contact_title' },
  'Partner Path': { field: 'partner_path' },
  'Route In': { field: 'route_in' },
  'Broker on Account': { field: 'broker_on_account' },
  'Source': { field: 'source' },
  'Flags': { field: 'flags' },
  'Notes': { field: 'notes' },
};
const headerKey = h => h.toLowerCase().replace(/\s+/g, '');
const MAP_BY_KEY = new Map(Object.entries(HEADER_MAP).map(([h, m]) => [headerKey(h), m]));
// 'target' comes from the board's export (Type column) only.
const KINDS = ['partner', 'employer', 'association', 'health_plan', 'other', 'target'];
// A Primary Contact cell naming 2+ people is reported, not split.
const MULTI_PERSON = /;|\/|,|&|\band\b/i;
const TIERS = ['1', '2', '3', '4', 'active'];
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
// "Stage" is Prospector's own stage, label or id, per row type; matched
// ignoring case, spaces and punctuation ("Proposal / pilot" = proposal_pilot).
const stageKey = v => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
const stageIndex = pairs => new Map(pairs.flatMap(([id, label]) => [[stageKey(id), id], [stageKey(label), id]]));
const STAGES_BY_TYPE = {
  partner: stageIndex(PIPELINE_STATUSES.map(s => [s.id, s.label])),
  employer: stageIndex(Object.entries(STAGE_LABELS)),
  target: stageIndex([['proposed', 'Proposed'], ['researching', 'Researching']]),
};
// The row's stage for one record type: "Stage" wins over "Funnel Stage". null
// = the row says nothing; undefined = "Stage" isn't a stage of that type.
export function sheetStage(r, type) {
  if (r.stage) return STAGES_BY_TYPE[type].get(stageKey(r.stage));
  if (!r.funnel_stage || type === 'target') return null;
  return SHEET_STAGES[r.funnel_stage]?.[type === 'partner' ? 0 : 1] ?? null;
}
const PROSPECTOR_ID = /^(partner|employer|target):([\w-]+)$/;
const NOTE_FIELDS = [['segment', 'Segment'], ['partner_path', 'Partner path'], ['route_in', 'Route in'], ['broker_on_account', 'Broker on account'],
  ['source', 'Source'], ['flags', 'Flags'], ['notes', 'Notes']];

export class ImportRefused extends Error {}

// No email address and no phone number may enter: the whole file is refused
// and the message names the record, never the value.
const PHONE = /\+?\d[\d\s().-]{7,}\d/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID_FIELDS = new Set(['record_id', 'prospector_id']);
// input: CSV text, or { headers, rows } already read from an .xlsx.
function readSheet(input) {
  const { headers, rows } = typeof input === 'object' && input ? input : parseCsv(String(input || '').replace(/^\uFEFF/, ''));
  const missing = Object.entries(HEADER_MAP).filter(([h, m]) => m.required && !headers.some(x => headerKey(x) === headerKey(h))).map(([h]) => h);
  if (missing.length) throw new ImportRefused(`missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
  rows.forEach((r, i) => {
    for (const [k, v] of Object.entries(r)) {
      // Ids are digit runs by design (a uuid can hold "41234567-8901"); "@" is still checked.
      const phone = ID_FIELDS.has(MAP_BY_KEY.get(headerKey(k))?.field) ? null : v.match(PHONE);
      if (v.includes('@') || (phone && !ISO_DATE.test(phone[0]))) {
        const id = r[headers.find(x => headerKey(x) === 'recordid')];
        throw new ImportRefused(`row ${i + 1} (${id || 'no Record ID'}, ${k}): contains ${v.includes('@') ? 'an "@"' : 'a phone number'} - remove it and re-export`);
      }
    }
  });
  const fields = new Set(headers.map(h => MAP_BY_KEY.get(headerKey(h))?.field).filter(Boolean));
  return { headers, rows, ignored: headers.filter(h => h && !MAP_BY_KEY.has(headerKey(h))), hasNotes: NOTE_FIELDS.some(([k]) => fields.has(k)) };
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

// recordIdRequired: the master sheet has one on every row; a board export
// only where the import set it (Prospector ID / name match the rest).
export function readInput(text, { recordIdRequired = true } = {}) {
  const { rows, ignored, hasNotes } = readSheet(text);
  const invalid = [];
  const multiPerson = [];
  const seen = new Set();
  const seenIds = new Set();
  const valid = [];
  const people = new Map();
  for (const raw of rows) {
    const r = {};
    for (const [h, v] of Object.entries(raw)) {
      const m = MAP_BY_KEY.get(headerKey(h));
      if (!m) continue;
      const val = one(v);
      if (val || !r[m.field]) r[m.field] = val && m.parse ? m.parse(val) : val;
    }
    for (const { field } of Object.values(HEADER_MAP)) if (r[field] == null) r[field] = '';
    const bad = [];
    if (r.prospector_id) {
      const m = r.prospector_id.match(PROSPECTOR_ID);
      if (!m) bad.push(`Prospector ID "${r.prospector_id}"`);
      else if (seenIds.has(r.prospector_id)) bad.push('Prospector ID appears twice');
      else { seenIds.add(r.prospector_id); r.pid = { type: m[1], id: m[2] }; r.kind = m[1]; }
    }
    if (!r.record_id) { if (recordIdRequired) bad.push('Record ID is empty'); }
    else if (seen.has(r.record_id)) bad.push('Record ID appears twice');
    if (!r.name) bad.push('Account is empty');
    if (!KINDS.includes(r.kind)) bad.push(`Account Type "${r.kind}"`);
    if (r.stage && !Object.values(STAGES_BY_TYPE).some(m => m.has(stageKey(r.stage)))) bad.push(`Stage "${r.stage}"`);
    if (r.tier && !TIERS.includes(r.tier)) bad.push(`Priority Tier "${r.tier}"`);
    if (r.funnel_stage && !(r.funnel_stage in SHEET_STAGES)) bad.push(`Funnel Stage "${r.funnel_stage}"`);
    if (r.owner_team && !OWNER_TEAMS.includes(r.owner_team)) bad.push(`Owner Team "${r.owner_team}"`);
    if (r.next_step_due && !DATE_RE.test(r.next_step_due)) bad.push(`Next Step Due "${r.next_step_due}"`);
    if (r.owner_name.length > 120) bad.push('Owner over 120 characters');
    if (r.company_domain) {
      const d = normalizeDomain(r.company_domain);
      if (!d || isConsumerDomain(d)) bad.push(`Primary Email Domain "${r.company_domain}"`);
      else r.company_domain = d;
    }
    if (r.record_id) seen.add(r.record_id);
    if (bad.length) { invalid.push({ record_id: r.record_id, name: r.name, reason: bad.join('; ') }); continue; }
    valid.push(r);
    if (!r.contact_name) continue;
    if (MULTI_PERSON.test(r.contact_name)) multiPerson.push({ record_id: r.record_id, name: r.name });
    else people.set(r.record_id, [{ name: r.contact_name, title: r.contact_title || null, role: null }]);
  }
  return { accounts: valid, contacts: people, invalid, ignored, multiPerson, hasNotes };
}

export async function loadState(supabase, businessId) {
  const all = (table, cols, extra = q => q) => selectAllPages(() => extra(supabase.from(table).select(cols).eq('business_id', businessId)).order('id'));
  const [partners, domains, opps, targets, contacts, todos, sequenced] = await Promise.all([
    all('sales_goals', 'id, name, record_id, tier, category, owner_user_id, owner_team, co_owner_name, next_step, notes, company_domain, pipeline_status, last_touch_at, source_kind, source_partner_id, source_person, source_office, source_campaign_id, route_in, source_note, source_set_by',
      q => q.eq('goal_type', 'partnership').is('archived_at', null)),
    all('partner_domains', 'id, goal_id, domain', q => q.eq('confirmed', true)),
    all('sales_opportunities', '*', q => q.is('archived_at', null)),
    all('sales_targets', 'id, name, record_id, kind, status, suggested_category, owner_team, co_owner_name, research_notes'),
    all('partner_contacts', 'id, goal_id, name, title, role_in_notes'),
    all('sales_week_goals', 'id, text, status, kind', q => q.eq('kind', 'todo').eq('status', 'open')),
    selectAllPages(() => supabase.from('sales_sequenced_accounts').select('account_id, name').eq('business_id', businessId).order('account_id')),
  ]);
  const [{ data: members, error: mErr }, { data: snap, error: sErr }] = await Promise.all([
    supabase.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId).not('user_id', 'is', null),
    supabase.from('sales_raw_snapshots').select('payload').eq('business_id', businessId).eq('entity', 'accounts')
      .order('captured_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (mErr || sErr) throw new Error((mErr || sErr).message);
  const accountDomains = new Map((Array.isArray(snap?.payload) ? snap.payload : []).map(a => [a.id, normalizeDomain(a.domain || '')]));
  return {
    partners, domains, opps, targets, contacts, todos,
    sequenced: sequenced.map(s => ({ ...s, domain: accountDomains.get(s.account_id) || null })),
    members: (members || []).map(m => ({ id: m.user_id, name: m.name, display_name: m.profile?.display_name || null })),
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

function partnerStageCompare(current, sheet) {
  const now = current || 'not_started';
  if (!sheet || sheet === now) return null;
  if (sheet === 'paused' || now === 'paused') return 'differs';
  return PIPELINE_STATUS_IDS.indexOf(sheet) > PIPELINE_STATUS_IDS.indexOf(now) ? 'ahead' : 'behind';
}

function matchPartner(r, state) {
  if (r.pid?.type === 'partner') { const p = state.partners.find(x => x.id === r.pid.id); return p ? { row: p, by: 'prospector_id' } : null; }
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
  if (r.pid?.type === 'employer') { const o = state.opps.find(x => x.id === r.pid.id); return o ? { row: o, by: 'prospector_id' } : null; }
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

// Only a Prospector record can be duplicated, so only partners and employers
// hold a row back. A sequenced Apollo account just links: exact (or domain)
// match fills apollo_account_id, a partial name is reported, never linked.
function possibleFor(r, state) {
  const p = findByName(r.name, state.partners, 'name', true);
  if (p) return `partner ${p.name}`;
  const o = findByName(r.name, state.opps, 'organization', true);
  return o ? `employer ${o.organization}` : null;
}

function noteLines(r, extra = [], { segment = true } = {}) {
  return [...extra, ...NOTE_FIELDS.filter(([k]) => r[k] && (segment || k !== 'segment')).map(([k, label]) => `${label}: ${r[k]}`)];
}

export function plan(state, input, { acceptPossible = [], today = laDateString() } = {}) {
  const actions = [];
  const report = {
    counts: { partner_update: 0, partner_to_target: 0, target_update: 0, opp_insert: 0, opp_update: 0, skipped: 0, invalid: input.invalid.length },
    differences: [], partner_stages: [], opp_stage_moves: [], opp_stage_refused: [], target_stages: [], stage_mismatches: [], unmatched: [],
    possibles: [], apollo_possibles: [], apollo_links: 0, kind_mismatches: [], skipped: [], invalid: input.invalid, contacts: { partner_insert: 0, partner_update: 0, opp_lines: 0, target_lines: 0 }, todos: 0,
  };
  const diff = (r, field, prospector, sheet) => report.differences.push({ record_id: r.record_id, name: r.name, field, prospector, sheet });
  // lead-source-v1: the sheet's Source / Route in / Broker on account -> the record's source (D5 rulings). A new
  // record takes it; an existing one only while its source is open (never set, or an automatic unknown) and the
  // sheet says something different. Applied after the row's own write, with an 'import' event.
  const dir = sourceDirectory(state.partners, [...state.partners, ...state.opps, ...state.targets]);
  const sheetSource = r => (r.source || r.route_in || r.broker_on_account ? mapSheetSource({ source: r.source, route_in: r.route_in, broker: r.broker_on_account }, dir).source : null);
  const same = (row, s) => Object.keys(s).every(k => (row[k] ?? null) === (s[k] ?? null));
  const sourceFor = (row, r) => { const s = sheetSource(r); return s && (!row || (isOpen(row) && !same(row, s))) ? { from: row ? sourceOf(row) : null, to: s } : null; };
  const skip = (r, reason) => { report.counts.skipped++; report.skipped.push({ record_id: r.record_id, name: r.name, reason }); };
  // "Jack" / "Cyrus" or a member's full name (the board exports display names) = that member.
  const ownerId = r => (r.owner_name ? matchOwner(r.owner_name, state.members)
    || matchOwner(r.owner_name, state.members.map(m => ({ id: m.id, name: m.display_name || '' }))) : null);
  const isMember = r => /^(jack|cyrus)$/i.test(r.owner_name) || !!ownerId(r);
  // A row whose Stage names another record type's stage: reported, never guessed.
  const stageFor = (r, type) => {
    const s = sheetStage(r, type);
    if (s === undefined) report.stage_mismatches.push({ record_id: r.record_id, name: r.name, sheet: r.stage, type });
    return s || null;
  };
  const notesFor = (existing, r, lines) => (input.hasNotes !== false && r.record_id ? withBlock(existing, r.record_id, lines) : existing);

  for (const r of input.accounts) {
    r.co_owner_name = r.owner_name && !isMember(r) ? r.owner_name : '';
    const people = input.contacts.get(r.record_id) || [];
    const accepted = acceptPossible.includes(r.record_id);
    const isPartner = r.kind === 'partner' || r.kind === 'target';
    const oppHit = isPartner ? null : matchOpp(r, state);
    const partnerHit = oppHit || r.pid?.type === 'target' ? null : matchPartner(r, state);
    if (r.pid && !oppHit && !partnerHit && !(r.pid.type === 'target' && state.targets.some(t => t.id === r.pid.id))) {
      report.unmatched.push({ record_id: r.record_id, name: r.name, reason: 'Prospector ID not found (deleted or archived since the export)' });
      skip(r, 'Prospector ID not found');
      continue;
    }
    if (!isPartner && partnerHit) report.kind_mismatches.push({ record_id: r.record_id, name: r.name, sheet_kind: r.kind, prospector: `partner ${partnerHit.row.name}` });

    if (partnerHit) {
      const p = partnerHit.row;
      const a = { route: 'partner_update', record_id: r.record_id, name: r.name, goal_id: p.id, matched_by: partnerHit.by, patch: {}, assign: {}, contacts: [], todo: null };
      if (r.record_id && p.record_id && p.record_id !== r.record_id) diff(r, 'record_id', p.record_id, r.record_id);
      else if (!p.record_id && r.record_id) a.patch.record_id = r.record_id;
      for (const [field, value] of [['tier', r.tier], ['next_step', r.next_step], ['company_domain', r.company_domain]]) {
        if (!value) continue;
        if (empty(p[field])) a.patch[field] = value;
        else if (one(String(p[field])).toLowerCase() !== value.toLowerCase()) diff(r, field, p[field], value);
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
      const notes = notesFor(p.notes, r, noteLines(r));
      if ((notes || null) !== (p.notes || null)) a.patch.notes = notes;
      const to = stageFor(r, 'partner');
      const dir = partnerStageCompare(p.pipeline_status, to);
      if (dir) report.partner_stages.push({ record_id: r.record_id, name: r.name, goal_id: p.id, prospector: p.pipeline_status || 'not_started', to, sheet: r.stage || r.funnel_stage, dir });
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
      a.source = sourceFor(p, r);
      actions.push(a);
      continue;
    }

    if (isPartner) {
      const t = r.pid?.type === 'target' ? state.targets.find(x => x.id === r.pid.id)
        : (r.record_id && state.targets.find(x => x.record_id === r.record_id)) || state.targets.find(x => x.name.trim().toLowerCase() === r.name.toLowerCase());
      const lines = people.map(c => `${c.name}${c.title ? ` — ${c.title}` : ''}`);
      if (t) {
        if (t.status === 'rejected') { skip(r, 'a rejected target (never again)'); continue; }
        const patch = {};
        if (!t.record_id && r.record_id) patch.record_id = r.record_id;
        const to = stageFor(r, 'target');
        if (to && to !== t.status) report.target_stages.push({ record_id: r.record_id, name: r.name, target_id: t.id, prospector: t.status, to });
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
        name: r.name, kind: 'partner', status: 'proposed', evidence: r.record_id ? `master sheet ${r.record_id}` : 'joint sheet', suggested_category: r.category || null,
        owner_team: r.owner_team || null, co_owner_name: r.co_owner_name || null, record_id: r.record_id || null, research_notes: lines.join('\n') || null,
        channel: 'import', owner_user_id: ownerId(r) || null,
      }, source: sourceFor(null, r) });
      continue;
    }

    const stage = stageFor(r, 'employer');
    const extra = [...(r.company_domain ? [`Domain: ${r.company_domain}`] : []), ...(['health_plan', 'other'].includes(r.kind) ? [`Account type: ${r.kind === 'health_plan' ? 'Health plan' : 'Other'}`] : [])];
    const dmLines = people.map(c => `${c.name}${c.title ? ` — ${c.title}` : ''}${c.role ? ` (${c.role})` : ''}`);
    const seq = sequencedFor(r, state);
    const owner = /^(jack|cyrus)$/i.test(r.owner_name) ? r.owner_name[0].toUpperCase() + r.owner_name.slice(1).toLowerCase() : isMember(r) ? r.owner_name : null;
    if (oppHit) {
      const o = oppHit.row;
      const patch = {};
      if (r.record_id && o.record_id && o.record_id !== r.record_id) diff(r, 'record_id', o.record_id, r.record_id);
      else if (!o.record_id && r.record_id) patch.record_id = r.record_id;
      // A hand-typed non-member owner comes back from the board's export as Owner: it's the owner, not a co-owner.
      const coOwner = r.co_owner_name && r.co_owner_name.toLowerCase() !== (o.owner || '').toLowerCase() ? r.co_owner_name : '';
      for (const [field, value] of [['cohort', r.segment], ['tier', r.tier === 'active' ? '' : r.tier], ['next_action', r.next_step], ['next_action_date', r.next_step_due], ['owner', owner]]) {
        if (!value) continue;
        if (empty(o[field])) patch[field] = value;
        else if (one(String(o[field])).toLowerCase() !== value.toLowerCase()) diff(r, field, o[field], value);
      }
      const orgType = r.kind === 'association' ? 'membership' : 'employer';
      if (oppHit.by !== 'prospector_id' && o.org_type !== orgType) diff(r, 'org_type', o.org_type, orgType);
      if (r.owner_team && r.owner_team !== o.owner_team) patch.owner_team = r.owner_team;
      if (coOwner && coOwner !== o.co_owner_name) patch.co_owner_name = coOwner;
      if (seq && empty(o.apollo_account_id)) { patch.apollo_account_id = seq.account_id; report.apollo_links++; }
      if (stage && stage !== o.stage) {
        const refusal = stage === 'lost' ? 'Lost is set by hand in the panel' : bulkStageRefusal(o.stage, stage);
        if (refusal) report.opp_stage_refused.push({ record_id: r.record_id, name: r.name, opp_id: o.id, prospector: o.stage, sheet: stage, reason: refusal });
        else { patch.stage = stage; report.opp_stage_moves.push({ record_id: r.record_id, name: r.name, opp_id: o.id, from: o.stage, to: stage }); }
      }
      const notes = notesFor(o.notes, r, noteLines(r, extra, { segment: false }));
      if ((notes || null) !== (o.notes || null)) patch.notes = notes;
      const dm = mergeLines(o.decision_makers, dmLines);
      if (dm) { patch.decision_makers = dm; report.contacts.opp_lines += dmLines.filter(l => !(o.decision_makers || '').toLowerCase().includes(personName(l))).length; }
      report.counts.opp_update++;
      actions.push({ route: 'opp_update', record_id: r.record_id, name: r.name, opp_id: o.id, matched_by: oppHit.by, patch, source: sourceFor(o, r) });
      continue;
    }
    const possible = possibleFor(r, state);
    if (possible && !accepted) { report.possibles.push({ record_id: r.record_id, name: r.name, possible }); skip(r, `possible match: ${possible} (--accept-possible ${r.record_id} to import as new)`); continue; }
    if (seq) report.apollo_links++;
    else {
      const partial = findByName(r.name, state.sequenced, 'name', true);
      if (partial) report.apollo_possibles.push({ record_id: r.record_id, name: r.name, possible: partial.name });
    }
    const fields = {
      organization: r.name, org_type: r.kind === 'association' ? 'membership' : 'employer', stage: stage && stage !== 'lost' ? stage : 'target',
      ...(r.segment ? { cohort: r.segment } : {}), ...(r.tier && r.tier !== 'active' ? { tier: r.tier } : {}), ...(r.next_step ? { next_action: r.next_step } : {}),
      ...(r.next_step_due ? { next_action_date: r.next_step_due } : {}), ...(owner ? { owner } : {}),
      ...(r.owner_team ? { owner_team: r.owner_team } : {}), ...(r.co_owner_name ? { co_owner_name: r.co_owner_name } : {}),
      ...(dmLines.length ? { decision_makers: dmLines.join('\n') } : {}),
    };
    const notes = r.record_id ? withBlock(null, r.record_id, noteLines(r, extra, { segment: false })) : null;
    if (notes) fields.notes = notes;
    const { payload, error } = validateFields(fields);
    if (error) { skip(r, error); continue; }
    report.contacts.opp_lines += dmLines.length;
    report.counts.opp_insert++;
    actions.push({ route: 'opp_insert', record_id: r.record_id, name: r.name, row: { ...payload, record_id: r.record_id || null, apollo_account_id: seq?.account_id || null, source: 'csv', channel: 'import', owner_user_id: ownerId(r) || null }, source: sourceFor(null, r) });
  }
  return { actions, report };
}

// A to-do lands in this LA week (Monday), linked to the partner.
const mondayOf = d => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

export async function applyPlan(supabase, businessId, { actions }, { now = new Date(), byUser = null } = {}) {
  const done = { partner_update: 0, assign: 0, partner_to_target: 0, target_update: 0, opp_insert: 0, opp_update: 0, contacts: 0, todos: 0, sources: 0, errors: [] };
  const week = mondayOf(laDateString(now));
  const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
  const TABLE = { partner: 'sales_goals', employer: 'sales_opportunities', target: 'sales_targets' };
  // A person's source set between the preview and now still wins (the update only lands on a row nobody picked for).
  const writeSource = async (type, id, src) => {
    if (!src || !id) return;
    const rows = must(await supabase.from(TABLE[type]).update(sourceColumns(src.to, { now })).eq('id', id).is('source_set_by', null).select('id'));
    if (rows.length) { await logSource(supabase, { businessId, type, id, from: src.from, to: src.to, reason: 'import', byUser, at: now }); done.sources++; }
  };
  for (const a of actions) {
    try {
      if (a.route === 'partner_update') {
        if (Object.keys(a.patch).length) { must(await supabase.from('sales_goals').update({ ...a.patch, updated_at: now.toISOString() }).eq('id', a.goal_id).select('id')); done.partner_update++; }
        if (Object.keys(a.assign).length) {
          await applyPartnerSignal(supabase, { businessId, goalId: a.goal_id, signal: { type: 'assign', ...a.assign }, byUser, now, meta: { from_import: a.record_id } });
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
        await writeSource('partner', a.goal_id, a.source);
      } else if (a.route === 'partner_to_target') {
        const [t] = must(await supabase.from('sales_targets').insert({ business_id: businessId, ...a.row }).select('id'));
        done.partner_to_target++;
        await writeSource('target', t?.id, a.source);
      } else if (a.route === 'target_update' && Object.keys(a.patch).length) {
        must(await supabase.from('sales_targets').update({ ...a.patch, updated_at: now.toISOString() }).eq('id', a.target_id).select('id'));
        done.target_update++;
      } else if (a.route === 'opp_insert') {
        const [o] = must(await supabase.from('sales_opportunities').insert({ business_id: businessId, ...a.row }).select('id'));
        done.opp_insert++;
        await writeSource('employer', o?.id, a.source);
      } else if (a.route === 'opp_update') {
        if (Object.keys(a.patch).length) {
          must(await supabase.from('sales_opportunities').update({ ...a.patch, updated_at: now.toISOString() }).eq('id', a.opp_id).select('id'));
          done.opp_update++;
        }
        await writeSource('employer', a.opp_id, a.source);
      }
    } catch (e) { done.errors.push({ record_id: a.record_id, name: a.name, error: e.message }); }
  }
  return done;
}
