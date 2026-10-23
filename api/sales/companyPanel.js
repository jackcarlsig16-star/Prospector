import { getSupabase, addDays, laMonday, weekIsFinal, FINAL_ERROR } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { cleanText, hasPii } from './scrubText.js';
import { sourceColumns, logSource } from './leadSource.js';
import { ownerOrCaller, employerOwner } from './companyFields.js';
import { companySteps } from './companySteps.js';
import { laDateString } from './laDate.js';
import { normName } from './intakeMatch.js';
import { findDupes, loadDupeContext } from './partnerDupeCheck.js';
import { findOpportunity } from './opportunityMatch.js';
import { applyPartnerSignal, SignalError } from './partnerSignals.js';
import { listRuns, runsToday, RERUN_CAP_PER_DAY } from './partnerResearch.js';
import { loadOverrides, effectiveVisit } from './visitPriority.js';
import { OWNER_TEAMS } from '../../src/constants/ownership.js';
import { TOUCH_TYPE_IDS } from '../../src/constants/partnerPipeline.js';
import { personSignals, byStrength, signalText, INTEREST_DAYS, TIMELINE_DAYS } from './interestSignals.js';

// sales-ia-v2 P4 - one side panel for every Pipeline row type. GET
// goals/company?type=&id= returns the body sections (to-dos, waiting on them,
// website visits, signals, last notes and touches, people, research,
// decisions and terms); the writes here are the ones no other route had:
// Add to pipeline (a visitor / Apollo-only company becomes a target, partner
// or employer), Add note and Add contact for employers and targets, and a
// target's ownership / status. Partners keep going through partner signals.
// Nothing here returns an email or a phone number (L1): people are names,
// titles and LinkedIn links; free text passes cleanText.

export const PANEL_TYPES = ['partner', 'employer', 'target', 'apollo', 'visitor'];
export const ADD_FROM = ['visitor', 'apollo'];
export const ADD_TO = ['target', 'partner', 'employer'];
const RECORD_TYPES = ['partner', 'employer', 'target'];
const REF_TYPE = { partner: 'partner', employer: 'opportunity', target: 'target' };
const PROSPECT_COLS = 'contact_id, name, title, company, linkedin_url, status, owner, goal_id, opportunity_id';
const VISIT_WEEK_DAYS = 7;
const NOT_NOW_DAYS = 7;
const DISMISS_DAYS = 90;
const PEOPLE_LINE = /^(People|Person): /;
const LINK_TYPE = { partner: 'partner', employer: 'opportunity', target: 'target', apollo: 'company' };
const VISIT_TYPE = { partner: 'partner', employer: 'opportunity', target: 'target' };
const TARGET_STATUSES = ['proposed', 'researching'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINKEDIN_RE = /^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\//i;
const TERMS_LINE = /^\(\d{1,2}\/\d{1,2}\) Terms: /;
const NOTE_MAX = 2000;
const RECENT = 5;
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const slash = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const appendLine = (old, line) => (old ? `${old}\n${line}` : line);
const t = (v, max = 400) => (typeof v === 'string' ? v.split('\n').map(l => cleanText(l, max)).filter(Boolean).join('\n') : null);
const validId = (type, id) => typeof id === 'string' && id.trim() && id.length <= 200 && (!RECORD_TYPES.includes(type) || UUID.test(id));

async function memberNames(supabase, businessId) {
  const { data } = await supabase.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId).not('user_id', 'is', null);
  return new Map((data || []).map(m => [m.user_id, m.profile?.display_name || m.name]));
}

// company-workflow-v1 W4/W5 - the size columns the window and its steps read.
const SIZE_COLS = 'employees, employees_source, employees_at';
const REACH_COLS = 'reach_employees, reach_employees_source, reach_employees_at, reach_clients, reach_clients_source, reach_clients_at';
const pick = (row, cols) => Object.fromEntries(cols.split(', ').map(c => [c, row[c] ?? null]));

// The record behind a row, as the panel header reads it. null = gone.
async function loadRecord(supabase, businessId, type, id) {
  if (type === 'partner') {
    const g = must(await supabase.from('sales_goals').select(`id, name, pipeline_status, category, tier, hot, owner_user_id, owner_team, co_owner_name, no_double_touch, next_step, next_meeting_at, last_touch_at, channel, priority, priority_set_by, priority_set_at, notes, record_id, ${SIZE_COLS}, ${REACH_COLS}`)
      .eq('business_id', businessId).eq('id', id).eq('goal_type', 'partnership').maybeSingle());
    return g && { type, id: g.id, name: g.name, stage: g.pipeline_status || 'not_started', category: g.category, tier: g.tier, top: !!g.hot, owner_user_id: g.owner_user_id, owner_team: g.owner_team, co_owner_name: g.co_owner_name, no_double_touch: !!g.no_double_touch, next_step: g.next_step, next_step_due: g.next_meeting_at, last_touch_at: g.last_touch_at, channel: g.channel, priority: g.priority, priority_set_by: g.priority_set_by, priority_set_at: g.priority_set_at, record_id: g.record_id, notes: g.notes, ...pick(g, SIZE_COLS), ...pick(g, REACH_COLS) };
  }
  if (type === 'employer') {
    const o = must(await supabase.from('sales_opportunities').select(`id, organization, stage, org_type, owner, owner_user_id, owner_team, co_owner_name, tier, is_top, next_action, next_action_date, channel, priority, priority_set_by, priority_set_at, notes, decision_makers, champion, covered_lives, record_id, apollo_account_id, ${SIZE_COLS}`)
      .eq('business_id', businessId).eq('id', id).is('archived_at', null).maybeSingle());
    return o && { type, id: o.id, name: o.organization, stage: o.stage, org_type: o.org_type, owner: o.owner, owner_team: o.owner_team, co_owner_name: o.co_owner_name, tier: o.tier, top: !!o.is_top, next_step: o.next_action, next_step_due: o.next_action_date, channel: o.channel, priority: o.priority, priority_set_by: o.priority_set_by, priority_set_at: o.priority_set_at, covered_lives: o.covered_lives, record_id: o.record_id, notes: o.notes, decision_makers: o.decision_makers, champion: o.champion, apollo_linked: !!o.apollo_account_id, owner_user_id: o.owner_user_id, ...pick(o, SIZE_COLS) };
  }
  if (type === 'target') {
    const r = must(await supabase.from('sales_targets').select(`id, name, kind, status, suggested_category, owner_team, co_owner_name, owner_user_id, evidence, research_notes, channel, created_at, promoted_goal_id, ${SIZE_COLS}`)
      .eq('business_id', businessId).eq('id', id).maybeSingle());
    return r && { type, id: r.id, name: r.name, kind: r.kind, stage: r.status, category: r.suggested_category, owner_team: r.owner_team, co_owner_name: r.co_owner_name, channel: r.channel, created_at: r.created_at, evidence: r.evidence, research_notes: r.research_notes, promoted_goal_id: r.promoted_goal_id, owner_user_id: r.owner_user_id, ...pick(r, SIZE_COLS) };
  }
  if (type === 'apollo') {
    const a = must(await supabase.from('sales_sequenced_accounts').select('account_id, name, first_sequenced_at, sequence_id, employees').eq('business_id', businessId).eq('account_id', id).maybeSingle());
    return a && { type, id: a.account_id, name: a.name || 'Unnamed company', stage: 'sequenced', channel: 'apollo_outbound', first_sequenced_at: a.first_sequenced_at, sequence_id: a.sequence_id, employees: a.employees, employees_source: a.employees != null ? 'manual' : null };
  }
  const v = must(await supabase.from('web_visits').select('company_key, company_name, domain, pulled_on').eq('business_id', businessId).eq('company_key', id).order('pulled_on', { ascending: false }).limit(1));
  return v[0] && { type, id: v[0].company_key, name: v[0].company_name, stage: 'visited', channel: 'website_visit', domain: v[0].domain };
}

const VISIT_COLS = 'id, company_key, pulled_on, first_visit, last_visit, visits_7d, top_paths, priority, priority_rule, noise_reason, matched_type, matched_id';
const visitOut = (v, o) => { const e = effectiveVisit(v, o); return { id: v.id, pulled_on: v.pulled_on, first_visit: v.first_visit, last_visit: v.last_visit, visits_7d: v.visits_7d, top_paths: (Array.isArray(v.top_paths) ? v.top_paths : []).slice(0, 5).map(p => cleanText(typeof p === 'string' ? p : p?.path || '', 120)).filter(Boolean), priority: e.priority, priority_rule: e.priority_rule }; };

async function visitsFor(supabase, businessId, type, id, key) {
  const byKey = must(await supabase.from('web_visits').select(VISIT_COLS).eq('business_id', businessId).eq('company_key', key).order('pulled_on', { ascending: false }).limit(14));
  const matched = VISIT_TYPE[type] ? must(await supabase.from('web_visits').select(VISIT_COLS).eq('business_id', businessId).eq('matched_type', VISIT_TYPE[type]).eq('matched_id', id).order('pulled_on', { ascending: false }).limit(14)) : [];
  const seen = new Set();
  return [...byKey, ...matched].filter(v => !seen.has(v.id) && seen.add(v.id)).sort((a, b) => b.pulled_on.localeCompare(a.pulled_on)).slice(0, 14);
}

async function linkedWork(supabase, businessId, type, id, kind, names) {
  if (!LINK_TYPE[type]) return [];
  const rows = must(await supabase.from('sales_week_goals').select('id, text, owner_user_id, due_date, status, week_start, waiting_on')
    .eq('business_id', businessId).eq('kind', kind).eq('link_type', LINK_TYPE[type]).eq('link_id', id).eq('status', 'open').order('due_date').order('id').limit(50));
  return rows.map(r => ({ id: r.id, text: cleanText(r.text, 300), owner_user_id: r.owner_user_id, owner: names.get(r.owner_user_id) || null, due_date: r.due_date, week_start: r.week_start, waiting_on: kind === 'waiting' ? cleanText(r.waiting_on, 120) : undefined }));
}

async function recentFor(supabase, businessId, record) {
  if (record.type === 'partner') {
    const ev = must(await supabase.from('sales_partner_events').select('id, event, at, note, touch_type, contact_names, from_status, to_status, source, meta')
      .eq('business_id', businessId).eq('goal_id', record.id).in('event', ['note', 'touch', 'status', 'undo']).order('at', { ascending: false }).order('id', { ascending: false }).limit(RECENT));
    return ev.map(e => ({ id: e.id, event: e.event, at: e.at, note: e.note ? cleanText(e.note, 600) : null, touch_type: e.touch_type, contact_names: (e.contact_names || []).map(n => cleanText(n, 80)), from_status: e.from_status, to_status: e.to_status, source: e.source, meta: { kind: e.meta?.kind, direction: e.meta?.direction } }));
  }
  if (record.type === 'employer') {
    const [ev, done] = await Promise.all([
      supabase.from('sales_opportunity_events').select('id, event_type, from_stage, to_stage, changed_at').eq('business_id', businessId).eq('opportunity_id', record.id).neq('event_type', 'created').order('changed_at', { ascending: false }).limit(RECENT).then(must),
      supabase.from('sales_week_goals').select('id, text, completed_at').eq('business_id', businessId).eq('kind', 'todo').eq('link_type', 'opportunity').eq('link_id', record.id).eq('status', 'done').order('completed_at', { ascending: false }).limit(RECENT).then(must),
    ]);
    return [
      ...ev.map(e => ({ id: e.id, event: 'stage', at: e.changed_at, text: e.event_type === 'stage_change' ? `${e.from_stage} → ${e.to_stage}` : e.event_type })),
      ...done.filter(d => d.completed_at).map(d => ({ id: d.id, event: 'todo_done', at: d.completed_at, text: `Done: ${cleanText(d.text, 300)}` })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, RECENT);
  }
  return [];
}

// company-panel-v2 D4 - the people behind a record, never with an email or a
// phone: partners = partner_contacts plus the prospects D1 linked (deduped by
// name, the prospect carries the signal); employers = linked prospects (+ the
// champion); targets = the People lines in research_notes; Apollo-only =
// prospects whose company is the account's name (read-time, exact, no link
// stored); visitors = nobody.
async function prospectsFor(supabase, businessId, record) {
  const base = () => supabase.from('sales_prospect_state').select(PROSPECT_COLS).eq('business_id', businessId);
  if (record.type === 'partner') return must(await base().eq('goal_id', record.id).order('contact_id').limit(200));
  if (record.type === 'employer') return must(await base().eq('opportunity_id', record.id).order('contact_id').limit(200));
  if (record.type === 'apollo') { const key = normName(record.name); return key ? (await selectAllPages(() => base().order('contact_id'))).filter(p => normName(p.company) === key) : []; }
  return [];
}

// The email rows behind a set of people (last TIMELINE_DAYS of events).
async function emailFor(supabase, businessId, contactIds, now) {
  if (!contactIds.length) return { messages: [], events: [] };
  const since = new Date(now.getTime() - TIMELINE_DAYS * 864e5).toISOString();
  const [messages, events] = await Promise.all([
    selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id, contact_id, step, delivered_at, replied, replied_at, replied_seen_at, reply_class').eq('business_id', businessId).in('contact_id', contactIds).order('apollo_message_id')),
    selectAllPages(() => supabase.from('sales_email_activity').select('id, apollo_message_id, contact_id, step, event, occurred_at, user_agent, tracking_service').eq('business_id', businessId).in('contact_id', contactIds).in('event', ['open', 'click', 'reply']).gte('occurred_at', since).order('id')),
  ]);
  return { messages, events };
}

const personOut = p => ({ id: `p:${p.contact_id}`, contact_id: p.contact_id, name: cleanText(p.name, 120) || 'Unnamed', title: p.title ? cleanText(p.title, 160) : null, linkedin_url: p.linkedin_url || null, source: 'apollo', status: p.status || null, signal: null });
const peopleSort = (a, b) => (a.signal && b.signal ? byStrength(a.signal, b.signal) : a.signal ? -1 : b.signal ? 1 : a.name.localeCompare(b.name));

async function peopleFor(supabase, businessId, record, prospects, signals) {
  const withSignal = rows => rows.map(p => { const s = p.contact_id ? signals.get(p.contact_id)?.strongest : null; return { ...p, signal: s ? { kind: s.kind, count: s.count, step: s.step, at: s.at, text: signalText(s) } : null }; });
  if (record.type === 'partner') {
    const contacts = must(await supabase.from('partner_contacts').select('id, name, title, linkedin_url, source, apollo_contact_id').eq('business_id', businessId).eq('goal_id', record.id).order('name').limit(50));
    const rows = contacts.map(c => ({ id: c.id, contact_id: c.apollo_contact_id || null, name: cleanText(c.name, 120), title: c.title ? cleanText(c.title, 160) : null, linkedin_url: c.linkedin_url || null, source: c.source, status: null, signal: null }));
    const byName = new Map(rows.map(r => [normName(r.name), r]));
    for (const p of prospects.map(personOut)) {
      const hit = byName.get(normName(p.name));
      if (hit) { hit.contact_id = hit.contact_id || p.contact_id; hit.title = hit.title || p.title; hit.linkedin_url = hit.linkedin_url || p.linkedin_url; hit.status = p.status; }
      else { rows.push(p); byName.set(normName(p.name), p); }
    }
    return withSignal(rows).sort(peopleSort);
  }
  if (record.type === 'employer') {
    const rows = withSignal(prospects.map(personOut));
    if (record.champion) rows.push({ id: 'champion', contact_id: null, name: cleanText(record.champion, 200), title: 'Champion', linkedin_url: null, source: 'notes', status: null, signal: null });
    return rows.sort(peopleSort);
  }
  if (record.type === 'target') {
    return (record.research_notes || '').split('\n').filter(l => PEOPLE_LINE.test(l)).map((l, i) => ({ id: `t${i}`, contact_id: null, name: cleanText(l.replace(PEOPLE_LINE, ''), 200), title: null, linkedin_url: null, source: 'notes', status: null, signal: null }));
  }
  if (record.type === 'apollo') return withSignal(prospects.map(personOut)).sort(peopleSort);
  return [];
}

// L3: the band's items, strongest first (reply > click > 2+ opens > visits).
// L6: the merged Signals & visits rows, newest first. dismissed = a Not now
// on the newest signal (sales_suggestions, kind interest_follow_up, dismissed)
// hides the band until a newer signal arrives.
async function interestFor(supabase, businessId, record, { people, signals, timelineSignals, visits, scoutSignals, now }) {
  const nameOf = new Map(people.filter(p => p.contact_id).map(p => [p.contact_id, p.name]));
  const since = new Date(now.getTime() - INTEREST_DAYS * 864e5).toISOString();
  const today = laDateString(now);
  const items = [];
  for (const [contactId, s] of signals) {
    if (!s.strongest || !nameOf.has(contactId)) continue;
    items.push({ ...s.strongest, person: { contact_id: contactId, name: nameOf.get(contactId) }, text: `${nameOf.get(contactId)} ${signalText(s.strongest)}` });
  }
  const latestVisit = visits.find(v => (v.last_visit || v.pulled_on) >= addDays(today, -VISIT_WEEK_DAYS));
  if (latestVisit) items.push({ kind: 'visit', count: latestVisit.visits_7d ?? null, step: null, at: latestVisit.last_visit || latestVisit.pulled_on, id: latestVisit.id, person: null, top_paths: latestVisit.top_paths, text: `${latestVisit.visits_7d ?? '?'} site visits this week${latestVisit.top_paths?.length ? ` · ${latestVisit.top_paths.slice(0, 3).join(', ')}` : ''}` });
  items.sort(byStrength);
  // "Newer signal" means any reply, click, second open or visit - not only each person's strongest.
  const dayEnd = at => (at && at.length === 10 ? `${at}T23:59:59Z` : at || '');
  const every = [...items.filter(i => i.kind === 'visit')];
  for (const [contactId, s] of signals) if (nameOf.has(contactId)) every.push(...s.replies, ...s.clicks, ...(s.opens.length >= 2 ? s.opens : []));
  const newest = every.filter(e => e.id).sort((a, b) => dayEnd(b.at).localeCompare(dayEnd(a.at)))[0] || null;
  let dismissed = false;
  if (newest?.id && REF_TYPE[record.type]) {
    const rows = must(await supabase.from('sales_suggestions').select('id, ref_id2, status').eq('business_id', businessId).eq('kind', 'interest_follow_up').eq('ref_type', REF_TYPE[record.type]).eq('ref_id', record.id).eq('status', 'dismissed').limit(200));
    dismissed = rows.some(r => r.ref_id2 === newest.id);
  }
  const timeline = [];
  for (const [contactId, s] of timelineSignals) {
    const person = nameOf.has(contactId) ? { contact_id: contactId, name: nameOf.get(contactId) } : null;
    if (!person) continue;
    for (const r of s.replies) timeline.push({ id: r.id, kind: 'replied', at: r.at, step: r.step, person, count: null, text: `${person.name} replied${r.step != null ? ` to Step ${r.step}` : ''}` });
    for (const c of s.clicks) timeline.push({ id: c.id, kind: 'clicked', at: c.at, step: c.step, person, count: null, text: `${person.name} clicked${c.step != null ? ` Step ${c.step}` : ''}` });
    const byMsg = new Map();
    for (const o of s.opens) { const g = byMsg.get(o.message_id) || { ...o, count: 0 }; g.count++; if (o.at > g.at) { g.at = o.at; g.id = o.id; } byMsg.set(o.message_id, g); }
    for (const o of byMsg.values()) timeline.push({ id: o.id, kind: 'opened', at: o.at, step: o.step, person, count: o.count, text: `${person.name} opened${o.step != null ? ` Step ${o.step}` : ''}${o.count > 1 ? ` ×${o.count}` : ''}` });
  }
  for (const v of visits) timeline.push({ id: v.id, kind: 'visited', at: v.last_visit || v.pulled_on, step: null, person: null, count: v.visits_7d ?? null, text: `Visited${v.visits_7d != null ? ` · ${v.visits_7d} in 7 days` : ''}${v.top_paths?.length ? ` · ${v.top_paths.slice(0, 3).join(', ')}` : ''}`, top_paths: v.top_paths });
  for (const g of scoutSignals) timeline.push({ id: g.id, kind: 'signal', at: g.created_at, step: null, person: null, count: null, text: g.signal, status: g.status, source: g.source });
  timeline.sort((a, b) => dayEnd(b.at).localeCompare(dayEnd(a.at)));
  return { interest: { items, strongest: items[0] || null, newest_id: newest?.id || null, since, dismissed, show: items.length > 0 && !dismissed }, timeline: timeline.slice(0, 40) };
}

// L2: Last touch as the facts row shows it.
async function lastTouchFor(supabase, businessId, record) {
  if (record.type === 'partner') {
    if (!record.last_touch_at) return null;
    const ev = must(await supabase.from('sales_partner_events').select('touch_type, at').eq('business_id', businessId).eq('goal_id', record.id).eq('event', 'touch').order('at', { ascending: false }).limit(1));
    return { at: record.last_touch_at, touch_type: ev[0]?.touch_type || null };
  }
  if (record.type === 'employer') {
    const [ev, done] = await Promise.all([
      supabase.from('sales_opportunity_events').select('changed_at').eq('business_id', businessId).eq('opportunity_id', record.id).eq('event_type', 'stage_change').order('changed_at', { ascending: false }).limit(1).then(must),
      supabase.from('sales_week_goals').select('completed_at').eq('business_id', businessId).eq('kind', 'todo').eq('link_type', 'opportunity').eq('link_id', record.id).eq('status', 'done').order('completed_at', { ascending: false }).limit(1).then(must),
    ]);
    const stage = ev[0]?.changed_at || null, todo = done[0]?.completed_at || null;
    if (!stage && !todo) return null;
    return todo && (!stage || todo > stage) ? { at: todo, touch_type: 'done' } : { at: stage, touch_type: 'stage' };
  }
  return null;
}

// L1 / L6 Intel: the site the window links to and whether a person confirmed it.
async function siteFor(supabase, businessId, record, research) {
  if (record.type === 'partner') {
    const rows = must(await supabase.from('partner_domains').select('domain, is_primary').eq('business_id', businessId).eq('goal_id', record.id).eq('confirmed', true).limit(20));
    const primary = rows.find(r => r.is_primary) || rows[0];
    if (primary) return { domain: primary.domain, confirmed: true };
  }
  const done = research?.runs?.find(r => r.status === 'done' && r.result?.domain);
  if (done) return { domain: done.result.domain, confirmed: false };
  if (record.domain) return { domain: record.domain, confirmed: false };
  return null;
}

async function decisionsFor(supabase, businessId, record) {
  if (record.type !== 'partner') return [];
  const notes = must(await supabase.from('sales_partner_events').select('at, note, meta').eq('business_id', businessId).eq('goal_id', record.id).eq('event', 'note').order('at', { ascending: false }).limit(200));
  return notes.filter(e => e.meta?.kind === 'decision').slice(0, 10).map(e => ({ at: e.at, text: cleanText(e.note, 400) }));
}

// GET /goals/company?type=&id= -> { record (+ last_touch, site), interest, timeline, todos, waiting, visits, signals,
// recent, people, decision_makers, research, decisions, terms }
export async function companyDetail(supabase, { businessId, type, id, now = new Date() }) {
  if (!PANEL_TYPES.includes(type)) return reply(400, { error: `type must be one of ${PANEL_TYPES.join('|')}` });
  if (!validId(type, id)) return reply(400, { error: 'id is required' });
  try {
    const [names, record] = await Promise.all([memberNames(supabase, businessId), loadRecord(supabase, businessId, type, id)]);
    if (!record) return reply(404, { error: `${type} not found` });
    const key = type === 'visitor' ? id : normName(record.name);
    const prospects = await prospectsFor(supabase, businessId, record);
    const [todos, waiting, visits, signals, recent, research, decisions, overrides, email, lastTouch] = await Promise.all([
      linkedWork(supabase, businessId, type, id, 'todo', names),
      linkedWork(supabase, businessId, type, id, 'waiting', names),
      visitsFor(supabase, businessId, type, id, key),
      supabase.from('sales_signals').select('id, source, kind, signal, why_now, status, signal_week, created_at').eq('business_id', businessId).eq('company_key', key).order('created_at', { ascending: false }).limit(10).then(must),
      recentFor(supabase, businessId, record),
      RECORD_TYPES.includes(type) ? Promise.all([listRuns(supabase, businessId, type, id), runsToday(supabase, businessId, type, id)]).then(([runs, today]) => ({ runs, today, cap: RERUN_CAP_PER_DAY })) : null,
      decisionsFor(supabase, businessId, record),
      loadOverrides(supabase, businessId),
      emailFor(supabase, businessId, prospects.map(p => p.contact_id), now),
      lastTouchFor(supabase, businessId, record),
    ]);
    const personSig = personSignals({ messages: email.messages, events: email.events, now: now.getTime() });
    const timelineSig = personSignals({ messages: email.messages, events: email.events, now: now.getTime(), days: TIMELINE_DAYS });
    const people = await peopleFor(supabase, businessId, record, prospects, personSig);
    const visitRows = visits.map(v => visitOut(v, overrides.get(v.company_key)));
    const scoutSignals = signals.map(s => ({ ...s, signal: cleanText(s.signal, 400), why_now: cleanText(s.why_now, 400) }));
    const { interest, timeline } = await interestFor(supabase, businessId, record, { people, signals: personSig, timelineSignals: timelineSig, visits: visitRows, scoutSignals, now });
    const site = await siteFor(supabase, businessId, record, research);
    const terms = (record.notes || '').split('\n').filter(l => TERMS_LINE.test(l)).map(l => cleanText(l, 400));
    const { notes, decision_makers, champion, ...head } = record;
    const ownerName = record.owner_user_id ? names.get(record.owner_user_id) || null : null;
    const out = {
      ...head, owner: type === 'partner' ? ownerName : type === 'target' ? ownerName : record.owner || null, owner_name: ownerName,
      priority_set_by: record.priority_set_by ? names.get(record.priority_set_by) || null : null,
      ...(type === 'partner' || type === 'employer' ? { next_step: record.next_step ? cleanText(record.next_step, 400) : null } : {}),
      ...(type === 'target' ? { evidence: t(record.evidence), research_notes: t(record.research_notes, 4000) } : {}),
      ...(type === 'employer' ? { notes: t(notes, 4000), last_touch_at: lastTouch?.at || null } : {}),
      last_touch: lastTouch, site,
    };
    return reply(200, {
      record: out, interest, timeline, todos, waiting, visits: visitRows, signals: scoutSignals,
      recent, people, decision_makers: type === 'employer' ? (decision_makers || '').split('\n').map(l => cleanText(l, 200)).filter(Boolean) : [],
      research, decisions, terms,
      // company-workflow-v1 W1: the guided steps (one "next").
      steps: companySteps({ record: { ...record, last_touch: lastTouch }, research, site, ownerName, now: now.getTime() }),
    });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}
export async function companyDetailRoute(req, res) {
  send(res, await companyDetail(getSupabase(), { businessId: req.params.businessId, type: req.query.type, id: req.query.id }));
}

// A to-do on the record, open or already done (a "Contacted" touch).
async function todoOn(supabase, { businessId, userId, type, id, text, today, done = false, now }) {
  const week = laMonday(today);
  if (await weekIsFinal(supabase, businessId, week)) throw err(409, FINAL_ERROR);
  return must(await supabase.from('sales_week_goals').insert({
    business_id: businessId, week_start: week, kind: 'todo', status: done ? 'done' : 'open', text, due_date: today, link_type: LINK_TYPE[type], link_id: id,
    owner_user_id: userId, created_by: userId, sort_order: 0, contacts: [], ...(done ? { completed_at: now.toISOString() } : {}),
  }).select().single());
}
const personName = v => { if (v == null || v === '') return { value: null }; if (typeof v !== 'string') return { error: 'person must be text' }; const s = v.trim().replace(/\s+/g, ' ').slice(0, 120); return hasPii(s) ? { error: "person can't hold an email address or phone number" } : { value: s || null }; };
async function prospectOrNull(supabase, businessId, contactId) {
  if (contactId == null) return null;
  if (typeof contactId !== 'string' || !contactId.trim()) throw err(400, 'contact_id must be text');
  const row = must(await supabase.from('sales_prospect_state').select('contact_id, name, status, snooze_until').eq('business_id', businessId).eq('contact_id', contactId).maybeSingle());
  if (!row) throw err(404, 'person not found');
  return row;
}

// POST /goals/company/:type/:id/book-meeting { person? } -> 201 { todo, next_step, before }.
// Partner: next_step text only - never next_meeting_at (that means a meeting
// IS booked). Employer: next_action + next_action_date = today. Plus ONE open
// to-do due today on the record. Undo = before + the to-do dropped.
export async function bookMeeting(supabase, { businessId, userId, type, id, body, now = new Date() }) {
  if (!RECORD_TYPES.includes(type)) return reply(400, { error: `type must be one of ${RECORD_TYPES.join('|')}` });
  if (!validId(type, id)) return reply(400, { error: 'id is required' });
  const person = personName(body?.person);
  if (person.error) return reply(400, { error: person.error });
  try {
    const record = await loadRecord(supabase, businessId, type, id);
    if (!record) return reply(404, { error: `${type} not found` });
    const today = laDateString(now);
    const text = `Book meeting with ${person.value || record.name}`;
    let before = null;
    if (type === 'partner') {
      before = { next_step: record.next_step ?? null };
      must(await supabase.from('sales_goals').update({ next_step: text, updated_at: now.toISOString() }).eq('id', id).select('id'));
    } else if (type === 'employer') {
      before = { next_action: record.next_step ?? null, next_action_date: record.next_step_due ?? null };
      must(await supabase.from('sales_opportunities').update({ next_action: text, next_action_date: today, updated_at: now.toISOString() }).eq('id', id).select('id'));
    }
    const todo = await todoOn(supabase, { businessId, userId, type, id, text, today, now });
    return reply(201, { todo, next_step: text, before });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}
export async function bookMeetingRoute(req, res) {
  send(res, await bookMeeting(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, type: req.params.type, id: req.params.id, body: req.body }));
}

// POST /goals/company/:type/:id/contacted { contact_id?, person?, touch_type? } -> 200 { event?, todo?, person? }.
// Person: Huddle's status path (contacted). Partner: a touch that never moves
// the stage (move_to 'none', expect = the stage the screen showed). Employer /
// target: ONE done to-do on the record (what Last touch reads) - never a
// sales_opportunity_events row.
export async function markContacted(supabase, { businessId, userId, byUser, type, id, body, now = new Date() }) {
  if (!RECORD_TYPES.includes(type)) return reply(400, { error: `type must be one of ${RECORD_TYPES.join('|')}` });
  if (!validId(type, id)) return reply(400, { error: 'id is required' });
  const person = personName(body?.person);
  if (person.error) return reply(400, { error: person.error });
  const touchType = body?.touch_type ?? 'email';
  if (!TOUCH_TYPE_IDS.includes(touchType)) return reply(400, { error: `touch_type must be one of ${TOUCH_TYPE_IDS.join('|')}` });
  try {
    const record = await loadRecord(supabase, businessId, type, id);
    if (!record) return reply(404, { error: `${type} not found` });
    const prospect = await prospectOrNull(supabase, businessId, body?.contact_id);
    const today = laDateString(now);
    const who = person.value || (prospect?.name ? cleanText(prospect.name, 120) : null);
    const out = {};
    if (prospect) {
      must(await supabase.from('sales_prospect_state').update({ status: 'contacted', updated_by: byUser || userId, updated_at: now.toISOString() }).eq('business_id', businessId).eq('contact_id', prospect.contact_id).select('contact_id'));
      out.person = { contact_id: prospect.contact_id, before: { status: prospect.status } };
    }
    if (type === 'partner') {
      const { event } = await applyPartnerSignal(supabase, { businessId, goalId: id, signal: { type: 'touch', touch_type: touchType, date: today, move_to: 'none', expect: record.stage, contacts: who ? [who] : [] }, byUser: userId, now });
      out.event = { id: event.id, touch_type: event.touch_type, at: event.at, to_status: event.to_status };
    } else {
      out.todo = await todoOn(supabase, { businessId, userId, type, id, text: `Contacted ${who || record.name}`, today, done: true, now });
    }
    return reply(200, out);
  } catch (e) {
    if (e instanceof SignalError) return reply(e.status || 400, { error: e.message });
    return reply(e.status || 500, { error: e.message });
  }
}
export async function markContactedRoute(req, res) {
  send(res, await markContacted(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, byUser: req.auth.user.email, type: req.params.type, id: req.params.id, body: req.body }));
}

// Not now on a person: Huddle's not_now with a week's snooze (the server has no default).
export const notNowPatch = today => ({ status: 'not_now', snooze_until: addDays(today, NOT_NOW_DAYS) });

// POST /goals/company/:type/:id/not-now { contact_id? } -> 200 { person } or { dismissed: { signal_id, until } }.
// Without a person the band itself is parked: a dismissed interest_follow_up
// row keyed on the newest signal (sales_suggestions - no new store), so it
// stays hidden until a newer signal arrives. Partner / employer / target only.
export async function notNow(supabase, { businessId, userId, byUser, type, id, body, now = new Date() }) {
  if (!PANEL_TYPES.includes(type)) return reply(400, { error: `type must be one of ${PANEL_TYPES.join('|')}` });
  if (!validId(type, id)) return reply(400, { error: 'id is required' });
  try {
    const record = await loadRecord(supabase, businessId, type, id);
    if (!record) return reply(404, { error: `${type} not found` });
    const today = laDateString(now);
    const prospect = await prospectOrNull(supabase, businessId, body?.contact_id);
    if (prospect) {
      const patch = notNowPatch(today);
      must(await supabase.from('sales_prospect_state').update({ ...patch, updated_by: byUser || userId, updated_at: now.toISOString() }).eq('business_id', businessId).eq('contact_id', prospect.contact_id).select('contact_id'));
      return reply(200, { person: { contact_id: prospect.contact_id, ...patch, before: { status: prospect.status, snooze_until: prospect.snooze_until } } });
    }
    if (!REF_TYPE[type]) return reply(400, { error: 'Not now needs a person for this row - add it to the pipeline first' });
    const detail = await companyDetail(supabase, { businessId, type, id, now });
    if (detail.status !== 200) return detail;
    const newest = detail.body.interest.newest_id;
    if (!newest) return reply(400, { error: 'no interest to park' });
    const until = new Date(now.getTime() + DISMISS_DAYS * 864e5).toISOString();
    const row = { status: 'dismissed', dismissed_until: until, decided_at: now.toISOString(), decided_by: userId };
    const open = must(await supabase.from('sales_suggestions').select('id').eq('business_id', businessId).eq('kind', 'interest_follow_up').eq('ref_type', REF_TYPE[type]).eq('ref_id', id).eq('ref_id2', newest).eq('status', 'proposed').limit(1));
    if (open.length) must(await supabase.from('sales_suggestions').update(row).eq('id', open[0].id).select('id'));
    else must(await supabase.from('sales_suggestions').insert({ business_id: businessId, kind: 'interest_follow_up', ref_type: REF_TYPE[type], ref_id: id, ref_id2: newest, text: `Not now: ${cleanText(detail.body.interest.strongest.text, 300)}`, reason: null, ...row }).select('id'));
    return reply(200, { dismissed: { signal_id: newest, until } });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}
export async function notNowRoute(req, res) {
  send(res, await notNow(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, byUser: req.auth.user.email, type: req.params.type, id: req.params.id, body: req.body }));
}

// POST /goals/company/add-to-pipeline { type: visitor|apollo, id, to: target|partner|employer, kind? }
// -> 201 { created: { type, id, name } } or 200 { already: { type, id, name } }.
// A visitor's web_visits rows are matched to the new record at once, so the
// board shows one row (the record, with its Visited cell) from the next load.
const RANK = { partner: 0, opportunity: 1, target: 2 };

// A company -> a new target / partner / employer, unless it's already one
// (exact name or confirmed domain; live before archived, partner > employer
// > target). -> { already: { type, id, name } } | { created: { type, id, name } };
// a create that loses a race throws 409. A new partner gets the evidence as
// a note event (never a stage); also used by seif-campaign Promote. source
// (lead-source-v1) lands on a new record with its create event; an existing
// one keeps its own (first touch).
export async function insertCompanyRecord(supabase, { businessId, userId, name, domain = null, to, kind = null, channel, evidence, apolloAccountId = null, noteMeta = {}, source = null, owner = null, employees = null, now = new Date() }) {
  const src = source ? sourceColumns(source, { now }) : {};
  // company-workflow-v1 W3/W4: owner = { user_id, name } (a partner's goes through Assign); employees = a typed count.
  const emp = employees != null ? { employees, employees_source: 'manual', employees_at: now.toISOString() } : {};
  const created = async (type, id) => {
    if (source) await logSource(supabase, { businessId, type, id, to: src, reason: 'create', byUser: userId, at: now });
    return { created: { type, id, name } };
  };
  const hit = findDupes({ name, domain }, await loadDupeContext(supabase, businessId)).exact.filter(h => h.type in RANK).sort((a, b) => a.archived - b.archived || RANK[a.type] - RANK[b.type])[0];
  if (hit) return { already: { type: hit.type === 'opportunity' ? 'employer' : hit.type, id: hit.id, name: hit.name } };
  if (to === 'target') {
    const r = await supabase.from('sales_targets').insert({ business_id: businessId, name, kind: kind || 'employer', status: 'researching', channel, evidence: cleanText(evidence, 400), created_by: userId, ...src, ...emp, ...(owner ? { owner_user_id: owner.user_id } : {}) }).select('id, name').single();
    if (r.error?.code === '23505') throw err(409, `${name} is already a target - reload`);
    return created('target', must(r).id);
  }
  if (to === 'partner') {
    const r = await supabase.from('sales_goals').insert({ business_id: businessId, goal_type: 'partnership', name, pipeline_status: 'not_started', channel, ...src, ...emp }).select('id, name').single();
    if (r.error?.code === '23505') throw err(409, `${name} is already a partner - reload`);
    const goal = must(r);
    await applyPartnerSignal(supabase, { businessId, goalId: goal.id, signal: { type: 'note', note: cleanText(evidence, NOTE_MAX) }, byUser: userId, now, meta: noteMeta });
    if (owner) await applyPartnerSignal(supabase, { businessId, goalId: goal.id, signal: { type: 'assign', owner_user_id: owner.user_id }, byUser: userId, now });
    return created('partner', goal.id);
  }
  const found = await findOpportunity(supabase, businessId, { name, apolloAccountId });
  if (found) return { already: { type: 'employer', id: found.id, name: found.organization } };
  const r = await supabase.from('sales_opportunities').insert({ business_id: businessId, organization: name, org_type: 'employer', stage: 'target', source: 'manual', channel, notes: `(${slash(laDateString(now))}) ${cleanText(evidence, 400)}`, ...(apolloAccountId ? { apollo_account_id: apolloAccountId } : {}), ...src, ...emp, ...(owner ? employerOwner(owner) : {}) }).select('id, organization').single();
  if (r.error?.code === '23505') throw err(409, `${name} is already in the pipeline - reload`);
  return created('employer', must(r).id);
}

export async function addToPipeline(supabase, { businessId, userId, body, now = new Date() }) {
  const { type, id, to = 'target', kind = null, owner_user_id: pickedOwner = null } = body || {};
  if (!ADD_FROM.includes(type)) return reply(400, { error: `type must be one of ${ADD_FROM.join('|')}` });
  if (!ADD_TO.includes(to)) return reply(400, { error: `to must be one of ${ADD_TO.join('|')}` });
  if (kind !== null && !['partner', 'employer'].includes(kind)) return reply(400, { error: 'kind must be partner, employer or null' });
  if (!validId(type, id)) return reply(400, { error: 'id is required' });
  try {
    const who = await ownerOrCaller(supabase, businessId, pickedOwner, userId);
    if (who.error) return reply(400, { error: who.error });
    const src = await loadRecord(supabase, businessId, type, id);
    if (!src) return reply(404, { error: `${type} not found` });
    const name = cleanText(src.name, 160);
    if (!name) return reply(400, { error: 'the company has no usable name' });
    const today = laDateString(now);
    const visit = type === 'visitor' ? (await visitsFor(supabase, businessId, type, id, id))[0] : null;
    const evidence = type === 'visitor'
      ? `Visited the website: ${visit?.visits_7d ?? '?'} visits in 7 days, last ${visit?.last_visit || visit?.pulled_on || today}${visit?.top_paths?.length ? ` · ${(Array.isArray(visit.top_paths) ? visit.top_paths : []).slice(0, 3).map(p => (typeof p === 'string' ? p : p?.path || '')).filter(Boolean).join(', ')}` : ''}`
      : `Sequenced in Apollo since ${String(src.first_sequenced_at || '').slice(0, 10)}`;
    const channel = type === 'visitor' ? 'website_visit' : 'apollo_outbound';
    const out = await insertCompanyRecord(supabase, {
      businessId, userId, name, domain: src.domain, to, kind, channel, evidence, now,
      apolloAccountId: type === 'apollo' ? id : null, noteMeta: type === 'visitor' ? { from_visit_key: id } : { from_apollo_account: true },
      // A website visitor found us; an Apollo-only company is our own outbound.
      source: { source_kind: type === 'visitor' ? 'website' : 'homelover_outreach' },
      owner: who.person, employees: type === 'apollo' ? src.employees ?? null : null,
    });
    if (out.already) return reply(200, { already: out.already });
    const { created } = out;
    if (type === 'visitor') {
      must(await supabase.from('web_visits').update({ matched_type: VISIT_TYPE[created.type], matched_id: created.id }).eq('business_id', businessId).eq('company_key', id).is('matched_id', null));
    }
    return reply(201, { created });
  } catch (e) {
    if (!(e instanceof SignalError) && (!e.status || e.status >= 500)) console.error('[company/add-to-pipeline]', e.message);
    return reply(e.status || 500, { error: e.message });
  }
}
export async function addToPipelineRoute(req, res) {
  send(res, await addToPipeline(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, body: req.body }));
}

// Appends one dated line to a text column, refusing if someone else changed
// it in between (same guard as Signals accept on an employer's notes).
async function appendGuarded(supabase, businessId, table, id, column, line, now) {
  const row = must(await supabase.from(table).select(`id, ${column}`).eq('business_id', businessId).eq('id', id).maybeSingle());
  if (!row) throw err(404, 'not found');
  const q = supabase.from(table).update({ [column]: appendLine(row[column], line), updated_at: now.toISOString() }).eq('id', id);
  const rows = must(await (row[column] == null ? q.is(column, null) : q.eq(column, row[column])).select('id'));
  if (!rows.length) throw err(409, 'changed since - reload and try again');
}

// POST /goals/company/:type/:id/note { note } (partner | employer | target)
export async function addNote(supabase, { businessId, userId, type, id, body, now = new Date() }) {
  if (!RECORD_TYPES.includes(type)) return reply(400, { error: `type must be one of ${RECORD_TYPES.join('|')}` });
  if (!validId(type, id)) return reply(400, { error: 'id is required' });
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if (!note) return reply(400, { error: 'note must be non-empty text' });
  if (note.length > NOTE_MAX) return reply(400, { error: `note must be at most ${NOTE_MAX} characters` });
  try {
    if (type === 'partner') {
      const { event } = await applyPartnerSignal(supabase, { businessId, goalId: id, signal: { type: 'note', note }, byUser: userId, now });
      return reply(201, { event_id: event.id });
    }
    const line = `(${slash(laDateString(now))}) ${cleanText(note, NOTE_MAX)}`;
    await appendGuarded(supabase, businessId, type === 'employer' ? 'sales_opportunities' : 'sales_targets', id, type === 'employer' ? 'notes' : 'research_notes', line, now);
    return reply(201, { line });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}
export async function addNoteRoute(req, res) {
  send(res, await addNote(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, type: req.params.type, id: req.params.id, body: req.body }));
}

// POST /goals/company/:type/:id/contact { name, title?, linkedin_url? } - L1:
// never an email or a phone; any other field, or one hiding in the text, is 400.
export async function addContact(supabase, { businessId, userId, type, id, body, now = new Date() }) {
  if (!RECORD_TYPES.includes(type)) return reply(400, { error: `type must be one of ${RECORD_TYPES.join('|')}` });
  if (!validId(type, id)) return reply(400, { error: 'id is required' });
  const extra = Object.keys(body || {}).find(k => !['name', 'title', 'linkedin_url'].includes(k));
  if (extra) return reply(400, { error: 'Add contact takes name, title and LinkedIn URL only' });
  const text = (v, max, label) => {
    if (v == null || v === '') return { value: null };
    if (typeof v !== 'string') return { error: `${label} must be text` };
    const s = v.trim().replace(/\s+/g, ' ');
    if (s.length > max) return { error: `${label} must be at most ${max} characters` };
    if (hasPii(s)) return { error: `${label} can't hold an email address or phone number` };
    return { value: s || null };
  };
  const name = text(body?.name, 120, 'name'), title = text(body?.title, 160, 'title'), linkedin = text(body?.linkedin_url, 500, 'linkedin_url');
  const bad = [name, title, linkedin].find(x => x.error);
  if (bad) return reply(400, { error: bad.error });
  if (!name.value) return reply(400, { error: 'name is required' });
  if (linkedin.value && !LINKEDIN_RE.test(linkedin.value)) return reply(400, { error: 'linkedin_url must be a linkedin.com link' });
  const person = { name: name.value, title: title.value, linkedin_url: linkedin.value };
  try {
    if (type === 'partner') {
      const exists = must(await supabase.from('sales_goals').select('id').eq('business_id', businessId).eq('id', id).eq('goal_type', 'partnership').maybeSingle());
      if (!exists) return reply(404, { error: 'partner not found' });
      const row = must(await supabase.from('partner_contacts').insert({ business_id: businessId, goal_id: id, ...person, source: 'manual', created_by: userId }).select('id, name, title, linkedin_url, source').single());
      return reply(201, { person: row });
    }
    const line = [person.name, person.title, person.linkedin_url].filter(Boolean).join(' · ');
    await appendGuarded(supabase, businessId, type === 'employer' ? 'sales_opportunities' : 'sales_targets', id, type === 'employer' ? 'decision_makers' : 'research_notes', type === 'employer' ? line : `People: ${line}`, now);
    return reply(201, { person: { id: null, ...person, source: 'notes' } });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}
export async function addContactRoute(req, res) {
  send(res, await addContact(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, type: req.params.type, id: req.params.id, body: req.body }));
}

// PATCH /goals/company/target/:id { owner_team?, status?, allow_backward? } -
// a target's ownership and its one forward step (proposed -> researching);
// back to proposed only with allow_backward (Undo / Jump with confirm).
export async function updateTarget(supabase, { businessId, id, body, now = new Date() }) {
  if (!validId('target', id)) return reply(400, { error: 'id is required' });
  const { owner_team: team, status, allow_backward: allowBackward, ...rest } = body || {};
  const unknown = Object.keys(rest)[0];
  if (unknown) return reply(400, { error: `unknown field: ${unknown}` });
  if (team !== undefined && team !== null && !OWNER_TEAMS.includes(team)) return reply(400, { error: `owner_team must be one of ${OWNER_TEAMS.join('|')} or null` });
  if (status !== undefined && !TARGET_STATUSES.includes(status)) return reply(400, { error: `status must be one of ${TARGET_STATUSES.join('|')}` });
  if (allowBackward !== undefined && typeof allowBackward !== 'boolean') return reply(400, { error: 'allow_backward must be true or false' });
  try {
    const target = must(await supabase.from('sales_targets').select('id, name, status, owner_team').eq('business_id', businessId).eq('id', id).maybeSingle());
    if (!target) return reply(404, { error: 'target not found' });
    const patch = { updated_at: now.toISOString() };
    if (team !== undefined) patch.owner_team = team;
    if (status !== undefined && status !== target.status) {
      if (!TARGET_STATUSES.includes(target.status)) return reply(409, { error: `${target.name} was already ${target.status}` });
      if (status === 'proposed' && !allowBackward) return reply(409, { error: `proposed is behind ${target.status} - use Jump to stage and confirm`, code: 'backward_stage' });
      patch.status = status;
    }
    const rows = must(await supabase.from('sales_targets').update(patch).eq('id', id).eq('status', target.status).select('id, name, status, owner_team, co_owner_name, channel'));
    if (!rows.length) return reply(409, { error: `${target.name} changed since - reload` });
    return reply(200, { target: rows[0] });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}
export async function updateTargetRoute(req, res) {
  send(res, await updateTarget(getSupabase(), { businessId: req.params.businessId, id: req.params.id, body: req.body }));
}
