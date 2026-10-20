import { getSupabase } from './goalsShared.js';
import { cleanText } from './scrubText.js';
import { laDateString } from './laDate.js';
import { normName } from './intakeMatch.js';
import { findDupes, loadDupeContext } from './partnerDupeCheck.js';
import { findOpportunity } from './opportunityMatch.js';
import { applyPartnerSignal, SignalError } from './partnerSignals.js';
import { listRuns, runsToday, RERUN_CAP_PER_DAY } from './partnerResearch.js';
import { hasPii } from './targetsRoutes.js';
import { loadOverrides, effectiveVisit } from './visitPriority.js';
import { OWNER_TEAMS } from '../../src/constants/ownership.js';

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

// The record behind a row, as the panel header reads it. null = gone.
async function loadRecord(supabase, businessId, type, id) {
  if (type === 'partner') {
    const g = must(await supabase.from('sales_goals').select('id, name, pipeline_status, category, tier, hot, owner_user_id, owner_team, co_owner_name, no_double_touch, next_step, next_meeting_at, last_touch_at, channel, priority, priority_set_by, priority_set_at, notes, record_id')
      .eq('business_id', businessId).eq('id', id).eq('goal_type', 'partnership').maybeSingle());
    return g && { type, id: g.id, name: g.name, stage: g.pipeline_status || 'not_started', category: g.category, tier: g.tier, top: !!g.hot, owner_user_id: g.owner_user_id, owner_team: g.owner_team, co_owner_name: g.co_owner_name, no_double_touch: !!g.no_double_touch, next_step: g.next_step, next_step_due: g.next_meeting_at, last_touch_at: g.last_touch_at, channel: g.channel, priority: g.priority, priority_set_by: g.priority_set_by, priority_set_at: g.priority_set_at, record_id: g.record_id, notes: g.notes };
  }
  if (type === 'employer') {
    const o = must(await supabase.from('sales_opportunities').select('id, organization, stage, org_type, owner, owner_team, co_owner_name, tier, is_top, next_action, next_action_date, channel, priority, priority_set_by, priority_set_at, notes, decision_makers, champion, covered_lives, record_id, apollo_account_id')
      .eq('business_id', businessId).eq('id', id).is('archived_at', null).maybeSingle());
    return o && { type, id: o.id, name: o.organization, stage: o.stage, org_type: o.org_type, owner: o.owner, owner_team: o.owner_team, co_owner_name: o.co_owner_name, tier: o.tier, top: !!o.is_top, next_step: o.next_action, next_step_due: o.next_action_date, channel: o.channel, priority: o.priority, priority_set_by: o.priority_set_by, priority_set_at: o.priority_set_at, covered_lives: o.covered_lives, record_id: o.record_id, notes: o.notes, decision_makers: o.decision_makers, champion: o.champion, apollo_linked: !!o.apollo_account_id };
  }
  if (type === 'target') {
    const r = must(await supabase.from('sales_targets').select('id, name, kind, status, suggested_category, owner_team, co_owner_name, evidence, research_notes, channel, created_at, promoted_goal_id')
      .eq('business_id', businessId).eq('id', id).maybeSingle());
    return r && { type, id: r.id, name: r.name, kind: r.kind, stage: r.status, category: r.suggested_category, owner_team: r.owner_team, co_owner_name: r.co_owner_name, channel: r.channel, created_at: r.created_at, evidence: r.evidence, research_notes: r.research_notes, promoted_goal_id: r.promoted_goal_id };
  }
  if (type === 'apollo') {
    const a = must(await supabase.from('sales_sequenced_accounts').select('account_id, name, first_sequenced_at, sequence_id, employees').eq('business_id', businessId).eq('account_id', id).maybeSingle());
    return a && { type, id: a.account_id, name: a.name || 'Unnamed company', stage: 'sequenced', channel: 'apollo_outbound', first_sequenced_at: a.first_sequenced_at, sequence_id: a.sequence_id, employees: a.employees };
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

async function peopleFor(supabase, businessId, record) {
  if (record.type === 'partner') {
    const rows = must(await supabase.from('partner_contacts').select('id, name, title, linkedin_url, source').eq('business_id', businessId).eq('goal_id', record.id).order('name').limit(50));
    return rows.map(p => ({ id: p.id, name: cleanText(p.name, 120), title: p.title ? cleanText(p.title, 160) : null, linkedin_url: p.linkedin_url || null, source: p.source }));
  }
  if (record.type === 'employer') {
    const lines = (record.decision_makers || '').split('\n').map(l => cleanText(l, 200)).filter(Boolean).map((name, i) => ({ id: `dm${i}`, name, title: null, linkedin_url: null, source: 'notes' }));
    return record.champion ? [{ id: 'champion', name: cleanText(record.champion, 200), title: 'Champion', linkedin_url: null, source: 'notes' }, ...lines] : lines;
  }
  return [];
}

async function decisionsFor(supabase, businessId, record) {
  if (record.type !== 'partner') return [];
  const notes = must(await supabase.from('sales_partner_events').select('at, note, meta').eq('business_id', businessId).eq('goal_id', record.id).eq('event', 'note').order('at', { ascending: false }).limit(200));
  return notes.filter(e => e.meta?.kind === 'decision').slice(0, 10).map(e => ({ at: e.at, text: cleanText(e.note, 400) }));
}

// GET /goals/company?type=&id= -> { record, todos, waiting, visits, signals, recent, people, research, decisions, terms }
export async function companyDetail(supabase, { businessId, type, id }) {
  if (!PANEL_TYPES.includes(type)) return reply(400, { error: `type must be one of ${PANEL_TYPES.join('|')}` });
  if (!validId(type, id)) return reply(400, { error: 'id is required' });
  try {
    const [names, record] = await Promise.all([memberNames(supabase, businessId), loadRecord(supabase, businessId, type, id)]);
    if (!record) return reply(404, { error: `${type} not found` });
    const key = type === 'visitor' ? id : normName(record.name);
    const [todos, waiting, visits, signals, recent, people, research, decisions, overrides] = await Promise.all([
      linkedWork(supabase, businessId, type, id, 'todo', names),
      linkedWork(supabase, businessId, type, id, 'waiting', names),
      visitsFor(supabase, businessId, type, id, key),
      supabase.from('sales_signals').select('id, source, kind, signal, why_now, status, signal_week, created_at').eq('business_id', businessId).eq('company_key', key).order('created_at', { ascending: false }).limit(10).then(must),
      recentFor(supabase, businessId, record),
      peopleFor(supabase, businessId, record),
      RECORD_TYPES.includes(type) ? Promise.all([listRuns(supabase, businessId, type, id), runsToday(supabase, businessId, type, id)]).then(([runs, today]) => ({ runs, today, cap: RERUN_CAP_PER_DAY })) : null,
      decisionsFor(supabase, businessId, record),
      loadOverrides(supabase, businessId),
    ]);
    const terms = (record.notes || '').split('\n').filter(l => TERMS_LINE.test(l)).map(l => cleanText(l, 400));
    const { notes, decision_makers, champion, ...head } = record;
    const out = {
      ...head, owner: type === 'partner' ? names.get(record.owner_user_id) || null : record.owner || null,
      priority_set_by: record.priority_set_by ? names.get(record.priority_set_by) || null : null,
      ...(type === 'partner' || type === 'employer' ? { next_step: record.next_step ? cleanText(record.next_step, 400) : null } : {}),
      ...(type === 'target' ? { evidence: t(record.evidence), research_notes: t(record.research_notes, 4000) } : {}),
      ...(type === 'employer' ? { notes: t(notes, 4000) } : {}),
    };
    return reply(200, {
      record: out, todos, waiting, visits: visits.map(v => visitOut(v, overrides.get(v.company_key))),
      signals: signals.map(s => ({ ...s, signal: cleanText(s.signal, 400), why_now: cleanText(s.why_now, 400) })),
      recent, people, research, decisions, terms,
    });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}
export async function companyDetailRoute(req, res) {
  send(res, await companyDetail(getSupabase(), { businessId: req.params.businessId, type: req.query.type, id: req.query.id }));
}

// POST /goals/company/add-to-pipeline { type: visitor|apollo, id, to: target|partner|employer, kind? }
// -> 201 { created: { type, id, name } } or 200 { already: { type, id, name } }.
// A visitor's web_visits rows are matched to the new record at once, so the
// board shows one row (the record, with its Visited cell) from the next load.
const RANK = { partner: 0, opportunity: 1, target: 2 };
export async function addToPipeline(supabase, { businessId, userId, body, now = new Date() }) {
  const { type, id, to = 'target', kind = null } = body || {};
  if (!ADD_FROM.includes(type)) return reply(400, { error: `type must be one of ${ADD_FROM.join('|')}` });
  if (!ADD_TO.includes(to)) return reply(400, { error: `to must be one of ${ADD_TO.join('|')}` });
  if (kind !== null && !['partner', 'employer'].includes(kind)) return reply(400, { error: 'kind must be partner, employer or null' });
  if (!validId(type, id)) return reply(400, { error: 'id is required' });
  try {
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
    const hit = findDupes({ name, domain: src.domain }, await loadDupeContext(supabase, businessId)).exact.filter(h => h.type in RANK).sort((a, b) => a.archived - b.archived || RANK[a.type] - RANK[b.type])[0];
    if (hit) return reply(200, { already: { type: hit.type === 'opportunity' ? 'employer' : hit.type, id: hit.id, name: hit.name } });
    let created;
    if (to === 'target') {
      const r = await supabase.from('sales_targets').insert({ business_id: businessId, name, kind: kind || 'employer', status: 'researching', channel, evidence: cleanText(evidence, 400), created_by: userId }).select('id, name').single();
      if (r.error?.code === '23505') return reply(409, { error: `${name} is already a target - reload` });
      created = { type: 'target', id: must(r).id, name };
    } else if (to === 'partner') {
      const r = await supabase.from('sales_goals').insert({ business_id: businessId, goal_type: 'partnership', name, pipeline_status: 'not_started', channel }).select('id, name').single();
      if (r.error?.code === '23505') return reply(409, { error: `${name} is already a partner - reload` });
      const goal = must(r);
      await applyPartnerSignal(supabase, { businessId, goalId: goal.id, signal: { type: 'note', note: cleanText(evidence, NOTE_MAX) }, byUser: userId, now, meta: type === 'visitor' ? { from_visit_key: id } : { from_apollo_account: true } });
      created = { type: 'partner', id: goal.id, name };
    } else {
      const found = await findOpportunity(supabase, businessId, { name, apolloAccountId: type === 'apollo' ? id : null });
      if (found) return reply(200, { already: { type: 'employer', id: found.id, name: found.organization } });
      const r = await supabase.from('sales_opportunities').insert({ business_id: businessId, organization: name, org_type: 'employer', stage: 'target', source: 'manual', channel, notes: `(${slash(today)}) ${cleanText(evidence, 400)}`, ...(type === 'apollo' ? { apollo_account_id: id } : {}) }).select('id, organization').single();
      if (r.error?.code === '23505') return reply(409, { error: `${name} is already in the pipeline - reload` });
      created = { type: 'employer', id: must(r).id, name };
    }
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
