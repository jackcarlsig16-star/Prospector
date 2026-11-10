import { getSupabase, addDays } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { mergePeople, SOURCE_WORD } from './peopleMerge.js';
import { cleanText } from './scrubText.js';
import { isMigrationPending, timelineFor, summarizePerson } from './personActivity.js';
import { readAllViews, writeAllViews, SAVED_VIEWS_MAX } from './scoresRoutes.js';
import { HEAT, HEAT_BANDS, visitSignal } from './heatScore.js';
import { visitIndex } from './visitJoin.js';
import { SIZE_BUCKETS } from '../../src/constants/headcount.js';

// people-v2 Stage 1 (P5) - GET goals/people/activity?window=7|30|90|all: ONE read for Pipeline › People. The rows are the
// union of the three contact tables merged by the P2 rule, each joined to its materialised email summary
// (sales_person_activity - the one heat rule's numbers, written by the sync), its company's latest web_visits row, the buyer
// flag (sales_settings.buyer_titles), the identified date (a visitor-identified person's filing date) and the last touch
// on any channel. The window keeps the rows whose last email signal or whose company's last visit falls inside it; the
// counts stay lifetime totals (the summary holds totals). Names and titles only - has_email is a boolean, an address never
// reaches the output (checked). 503 until the Stage 1 migration has run.
export const WINDOWS = { 7: 'last 7 days', 30: 'last 30 days', 90: 'last 90 days', all: 'all time' };
// heat-v2 D3/D5: the one rule the popover, the CSV and Scout's glossary describe - brackets + the fade schedule.
export const heatRuleOf = () => ({ hot: HEAT_BANDS.hotScore, warm: HEAT_BANDS.warmScore, fade: { fresh: HEAT.fadeFresh, mid: HEAT.fadeMid, old: HEAT.fadeOld, floor: HEAT.fadeFloor } });
export const NEEDS_TOUCH_DAYS = 14; // REVISABLE (spec P3)
const ADDRESS = /[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+\.[a-z]{2,}/i;
const must = r => { if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code }); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
// A name that is only an address (one real partner contact today) is no name: the row drops rather than reading "[email removed]".
const nameOf = v => { const t = cleanText(v, 120); return t && !/\[email removed\]/.test(t) ? t : null; };
export const isBuyerTitle = (title, buyerTitles) => { const t = String(title || '').toLowerCase(); return !!t && buyerTitles.some(b => { const x = String(b).toLowerCase(); return !!x && (t.includes(x) || x.includes(t)); }); };

export function windowOf(id, today) {
  const key = String(id) in WINDOWS ? String(id) : 'all';
  return { id: key, label: WINDOWS[key], since: key === 'all' ? null : addDays(today, -(Number(key) - 1)), until: today };
}

// The three tables in one shape (before the merge): { person_key, source, name, title, company, apollo_id, has_email, identified_at, last_touch_at, contact_id }.
export function peopleRows({ prospects = [], salesPeople = [], partnerContacts = [], opportunities = [], targets = [], partners = [] }) {
  const opp = new Map(opportunities.map(o => [o.id, o])), tgt = new Map(targets.map(t => [t.id, t])), goal = new Map(partners.map(g => [g.id, g]));
  // heat-size-v1 R6: the record's headcount rides on the company so the table can sort / filter by size.
  const company = (type, row) => (row ? { type, id: row.id, name: cleanText(row.organization || row.name, 160), stage: row.stage || row.status || row.pipeline_status || null, owner_user_id: row.owner_user_id || null, employees: row.employees ?? null, employees_source: row.employees_source || null } : null);
  const out = [];
  for (const p of prospects) {
    const o = p.opportunity_id ? opp.get(p.opportunity_id) : null, g = p.goal_id ? goal.get(p.goal_id) : null;
    out.push({ person_key: `prospect:${p.contact_id}`, source: 'prospect', name: nameOf(p.name), title: cleanText(p.title, 160) || null, company: o ? company('employer', o) : g ? company('partner', g) : p.company ? { type: 'account', id: null, name: cleanText(p.company, 160), stage: null, owner_user_id: null, employees: null, employees_source: null } : null,
      apollo_id: p.contact_id, contact_id: p.contact_id, has_email: !!p.email, identified_at: null, last_touch_at: null, status: p.status || null, owner: p.owner || null });
  }
  for (const p of salesPeople) {
    if (p.archived_at) continue;
    const c = p.company_type === 'employer' && p.opportunity_id ? company('employer', opp.get(p.opportunity_id)) : p.target_id ? company('target', tgt.get(p.target_id)) : p.company_name ? { type: 'parked', id: null, name: cleanText(p.company_name, 160), stage: null, owner_user_id: null, employees: null, employees_source: null } : null;
    const source = p.source_kind === 'web_visit' || p.visit_id ? 'visitor' : p.upload_id ? 'upload' : 'hand';
    out.push({ person_key: `person:${p.id}`, source, name: nameOf(p.name), title: cleanText(p.title, 160) || null, company: c, apollo_id: null, contact_id: null, has_email: false, identified_at: source === 'visitor' ? p.created_at || null : null, last_touch_at: null, status: null, owner: null });
  }
  for (const c of partnerContacts) {
    out.push({ person_key: `contact:${c.id}`, source: 'contact', name: nameOf(c.name), title: cleanText(c.title, 160) || null, company: company('partner', goal.get(c.goal_id)), apollo_id: c.apollo_contact_id || null, contact_id: c.apollo_contact_id || null, has_email: !!c.email, identified_at: null, last_touch_at: c.last_activity_at || null, status: null, owner: null, partner_contact_ids: [c.id] });
  }
  return out.filter(r => r.name);
}

const nz = v => (v == null ? 0 : Number(v));

// Pure: the merged, joined, windowed rows + the chip counts.
export function buildPeopleTable({ rows, activity = [], visits = [], buyerTitles = [], window: w, now = Date.now() }) {
  const today = laDateString(new Date(now));
  const act = new Map();
  for (const a of activity) { act.set(a.person_key, a); if (a.contact_id) act.set(`c:${a.contact_id}`, a); }
  const visitOf = visitIndex(visits);
  const sinceIso = w.since ? `${w.since}T00:00:00` : null;
  const needsSince = new Date(now - NEEDS_TOUCH_DAYS * 864e5).toISOString();
  const people = mergePeople(rows).map(p => {
    const a = p.source_keys.map(k => act.get(k)).find(Boolean) || p.apollo_ids.map(id => act.get(`c:${id}`)).find(Boolean) || null;
    const v = visitOf(p.company);
    const emails = { sent: nz(a?.sent), opened: nz(a?.opened_h), clicked: nz(a?.clicked), replied: nz(a?.replied), bot_opens: nz(a?.bot_opens) };
    const lastEmail = [a?.last_sent_at, a?.last_open_at, a?.last_click_at, a?.last_reply_at].filter(Boolean).sort().pop() || null;
    const lastEmailWhat = a ? (a.last_reply_at && a.last_reply_at === lastEmail ? 'replied' : a.last_click_at && a.last_click_at === lastEmail ? 'clicked' : a.last_open_at && a.last_open_at === lastEmail ? 'opened' : a.last_sent_at ? 'sent' : null) : null;
    const lastTouch = [lastEmail, p.last_touch_at].filter(Boolean).sort().pop() || null;
    const visitsRow = v ? { visits_7d: nz(v.visits_7d), last_visit: v.last_visit || v.seen_to || null, top_page: Array.isArray(v.top_paths) && v.top_paths[0] ? cleanText(String(v.top_paths[0].path || v.top_paths[0]), 200) : null, seen_to: v.seen_to || v.pulled_on || null } : null;
    return {
      key: p.key, sources: p.sources.map(s => SOURCE_WORD[s]), source: SOURCE_WORD[p.sources[0]], name: p.name, title: p.title, company: p.company, status: p.status, owner: p.owner,
      emails, last_email: lastEmail ? { at: lastEmail, what: lastEmailWhat, reply_class: a?.reply_class || null } : null,
      heat: a?.heat ?? null, heat_band: a?.heat_band ?? null, visits: visitsRow,
      identified_at: p.identified_at ? String(p.identified_at).slice(0, 10) : null,
      buyer: isBuyerTitle(p.title, buyerTitles), has_email: !!p.has_email, last_touch_at: lastTouch,
      in_window: !sinceIso || (lastEmail && lastEmail >= sinceIso) || (visitsRow?.seen_to && visitsRow.seen_to >= w.since) || (p.identified_at && String(p.identified_at) >= sinceIso),
    };
  });
  const shown = people.filter(r => r.in_window).map(({ in_window, ...r }) => r);
  const sevenDays = addDays(today, -6);
  const counts = {
    opened: shown.filter(r => r.emails.opened > 0).length, clicked: shown.filter(r => r.emails.clicked > 0).length, replied: shown.filter(r => r.emails.replied > 0).length, sent: shown.filter(r => r.emails.sent > 0).length,
    identified: shown.filter(r => r.identified_at).length, visited_7d: shown.filter(r => r.visits && r.visits.visits_7d > 0 && r.visits.seen_to >= sevenDays).length,
    buyer: shown.filter(r => r.buyer).length, hot: shown.filter(r => r.heat_band === 'hot').length,
    needs_touch: shown.filter(r => !r.last_touch_at || r.last_touch_at < needsSince).length,
  };
  shown.sort((a, b) => (b.heat ?? -1) - (a.heat ?? -1) || String(b.last_email?.at || '').localeCompare(String(a.last_email?.at || '')) || String(a.name).localeCompare(String(b.name)));
  const text = JSON.stringify(shown);
  if (ADDRESS.test(text)) throw new Error('people activity: an address reached the result - refused');
  return { rows: shown, n: shown.length, total: people.length, counts, window: w, heat_rule: heatRuleOf(), computed_at: activity.map(a => a.computed_at).filter(Boolean).sort().pop() || null, heat_pending: activity.filter(a => a.heat == null).length };
}

export async function peopleActivity(supabase, businessId, { window: id = 'all', now = Date.now() } = {}) {
  const today = laDateString(new Date(now));
  const w = windowOf(id, today);
  const all = (table, cols, build = x => x) => selectAllPages(() => build(supabase.from(table).select(cols).eq('business_id', businessId)).order('id'));
  let activity;
  try { activity = await selectAllPages(() => supabase.from('sales_person_activity').select('person_key, contact_id, sent, opened_h, bot_opens, clicked, replied, last_sent_at, last_open_at, last_click_at, last_reply_at, reply_class, heat, heat_band, computed_at').eq('business_id', businessId).order('person_key')); }
  catch (e) { if (isMigrationPending(e)) return reply(503, { error: 'Run supabase/migrations/20261106_people_v2_stage1.sql first (sales_person_activity is missing)', migration_pending: true }); throw e; }
  const [prospects, salesPeople, partnerContacts, opportunities, targets, partners, visits, settings] = await Promise.all([
    selectAllPages(() => supabase.from('sales_prospect_state').select('contact_id, name, title, company, opportunity_id, goal_id, status, owner, email').eq('business_id', businessId).order('contact_id')),
    all('sales_people', 'id, company_type, opportunity_id, target_id, name, title, source_kind, visit_id, upload_id, archived_at, created_at, company_name'),
    all('partner_contacts', 'id, goal_id, name, title, email, apollo_contact_id, last_activity_at'),
    all('sales_opportunities', 'id, organization, stage, owner_user_id, archived_at, employees, employees_source'),
    all('sales_targets', 'id, name, status, owner_user_id, employees, employees_source'),
    all('sales_goals', 'id, name, pipeline_status, owner_user_id, employees, employees_source', x => x.eq('goal_type', 'partnership')),
    all('web_visits', 'id, company_key, company_name, matched_type, matched_id, visits_7d, last_visit, seen_to, top_paths, pulled_on'),
    supabase.from('sales_settings').select('buyer_titles').eq('business_id', businessId).maybeSingle(),
  ]);
  const rows = peopleRows({ prospects, salesPeople, partnerContacts, opportunities: opportunities.filter(o => !o.archived_at), targets, partners });
  return reply(200, { ...buildPeopleTable({ rows, activity, visits, buyerTitles: must(settings)?.buyer_titles || [], window: w, now }), history_since: await historySince(supabase, businessId) });
}

// heat-v2 R7: the day the heat history starts = the earliest day row, never a constant; null until the first run after
// the Stage 1 migration (or while that migration is pending).
export async function historySince(supabase, businessId) {
  const { data, error } = await supabase.from('sales_person_heat_days').select('day').eq('business_id', businessId).order('day').limit(1).maybeSingle();
  if (error) { if (/sales_person_heat_days|42P01|PGRST205/.test(`${error.code} ${error.message}`)) return null; throw new Error(error.message); }
  return data?.day || null;
}

export async function peopleActivityRoute(req, res) {
  try { send(res, await peopleActivity(getSupabase(), req.params.businessId, { window: req.query.window })); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

// ---- people-v2 Stage 2 (P4): the pinned detail - GET goals/people/activity/:key -> { key, timeline, notes, sources }.
// A prospect's timeline reads its messages + events; a partner contact's through its Apollo contact id; a
// visitor-identified or hand-added person has no email rows (an empty timeline) and shows its note. Never an address.
const KEY = /^(prospect|contact|person):(.+)$/;
export async function personDetail(supabase, businessId, { key }) {
  const m = KEY.exec(String(key || ''));
  if (!m) return reply(400, { error: 'key must be prospect:<contact id> | contact:<id> | person:<id>' });
  const [, kind, id] = m;
  let contactId = null, notes = null, company = null, identifiedAt = null;
  if (kind === 'prospect') {
    const p = must(await supabase.from('sales_prospect_state').select('contact_id, notes, opportunity_id, goal_id, company').eq('business_id', businessId).eq('contact_id', id).maybeSingle());
    if (!p) return reply(404, { error: 'person not found' });
    contactId = p.contact_id; notes = p.notes || null;
    company = p.opportunity_id ? { opportunity_id: p.opportunity_id } : p.goal_id ? { goal_id: p.goal_id } : p.company ? { name: p.company } : null;
  } else if (kind === 'contact') {
    const c = must(await supabase.from('partner_contacts').select('id, apollo_contact_id, role_in_notes, goal_id').eq('business_id', businessId).eq('id', id).maybeSingle());
    if (!c) return reply(404, { error: 'person not found' });
    contactId = c.apollo_contact_id || null; notes = c.role_in_notes || null;
    company = c.goal_id ? { goal_id: c.goal_id } : null;
  } else {
    const p = must(await supabase.from('sales_people').select('id, note, company_type, opportunity_id, target_id, company_name, source_kind, created_at').eq('business_id', businessId).eq('id', id).maybeSingle());
    if (!p) return reply(404, { error: 'person not found' });
    notes = p.note || null;
    company = p.company_type === 'employer' && p.opportunity_id ? { opportunity_id: p.opportunity_id } : p.target_id ? { target_id: p.target_id } : p.company_name ? { name: p.company_name } : null;
    identifiedAt = p.source_kind === 'web_visit' ? p.created_at || null : null;
  }
  const [messages, events] = contactId ? await Promise.all([
    selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id,contact_id,sequence_id,step,delivered_at,replied,reply_class,replied_seen_at,replied_at,subject,num_opens,num_clicks,last_opened_at,last_clicked_at,bounced').eq('business_id', businessId).eq('contact_id', contactId).order('apollo_message_id')),
    selectAllPages(() => supabase.from('sales_email_activity').select('id,apollo_message_id,contact_id,step,event,occurred_at,user_agent,tracking_service').eq('business_id', businessId).eq('contact_id', contactId).order('id')),
  ]) : [[], []];
  const heat = await liveHeat(supabase, businessId, { messages, events, company, identifiedAt });
  const body = { key, timeline: timelineFor(messages, events).map(t => ({ ...t, subject: t.subject ? cleanText(t.subject, 160) : t.subject ?? null })), notes: notes ? cleanText(notes, 500) : null, heat };
  if (ADDRESS.test(JSON.stringify(body))) throw new Error('people detail: an address reached the result - refused');
  return reply(200, body);
}
// heat-size-v1 Stage 2 (Stage 1 choice 1): the pinned card's heat is computed live by the writer's own function over the
// person's rows, their company's latest visit row (the same join as the table) and their identification date - nothing
// stored, no new column. null when the person has no email row and no visit signal (the table shows "—" for them too).
async function liveHeat(supabase, businessId, { messages, events, company, identifiedAt }) {
  let ref = null;
  if (company?.opportunity_id) { const o = must(await supabase.from('sales_opportunities').select('id, organization').eq('business_id', businessId).eq('id', company.opportunity_id).maybeSingle()); ref = o ? { type: 'employer', id: o.id, name: o.organization } : null; }
  else if (company?.goal_id) { const g = must(await supabase.from('sales_goals').select('id, name').eq('business_id', businessId).eq('id', company.goal_id).maybeSingle()); ref = g ? { type: 'partner', id: g.id, name: g.name } : null; }
  else if (company?.target_id) { const t = must(await supabase.from('sales_targets').select('id, name').eq('business_id', businessId).eq('id', company.target_id).maybeSingle()); ref = t ? { type: 'target', id: t.id, name: t.name } : null; }
  else if (company?.name) ref = { type: 'account', id: null, name: company.name };
  const visits = ref ? await selectAllPages(() => supabase.from('web_visits').select('id, company_key, matched_type, matched_id, visits_7d, unique_visitors_7d, last_visit, seen_to, pulled_on').eq('business_id', businessId).order('id')) : [];
  const visit = visitIndex(visits)(ref);
  if (!messages.length && !events.length && !visitSignal({ visit, identifiedAt })) return null;
  const s = summarizePerson(messages, events, Date.now(), visit, identifiedAt);
  return { score: s.heat, band: s.heat_band, why: s.why };
}
export async function personDetailRoute(req, res) {
  try { send(res, await personDetail(getSupabase(), req.params.businessId, { key: req.params.key })); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

// ---- P7 "Share view": saved filters keyed kind 'people' in sales_settings.saved_views, beside the Map's and the Explorer's.
export const VIEW_CHIPS = ['opened', 'clicked', 'replied', 'sent', 'identified', 'visited_7d', 'buyer', 'hot', 'needs_touch', 'mine'];
export function cleanViewState(s = {}) {
  const chips = (Array.isArray(s.chips) ? s.chips : []).map(String).filter(c => VIEW_CHIPS.includes(c));
  const str = (v, max) => (typeof v === 'string' ? cleanText(v, max) : '');
  return { chips: [...new Set(chips)], source: str(s.source, 40), stage: str(s.stage, 40), owner: str(s.owner, 60), window: String(s.window) in WINDOWS ? String(s.window) : 'all', q: str(s.q, 120), sizes: [...new Set((Array.isArray(s.sizes) ? s.sizes : []).map(String).filter(x => SIZE_BUCKETS.some(([id]) => id === x)))] };
}
const PEOPLE_KIND = 'people';
export async function listPeopleViews(supabase, businessId) { return reply(200, { views: (await readAllViews(supabase, businessId)).filter(v => v.kind === PEOPLE_KIND) }); }
export async function savePeopleView(supabase, { businessId, userId, body = {}, now = Date.now() }) {
  const name = cleanText(String(body.name || ''), 60);
  if (!name) return reply(400, { error: 'name is required (up to 60 characters)' });
  const all = await readAllViews(supabase, businessId);
  const mine = all.filter(v => v.kind === PEOPLE_KIND);
  if (all.length >= SAVED_VIEWS_MAX && !mine.some(v => v.name === name)) return reply(409, { error: `At most ${SAVED_VIEWS_MAX} saved views - delete one first` });
  const entry = { id: mine.find(v => v.name === name)?.id || `v_${Math.random().toString(36).slice(2, 10)}`, kind: PEOPLE_KIND, name, state: cleanViewState(body.state), created_by: userId, created_at: new Date(now).toISOString() };
  const views = [...all.filter(v => !(v.kind === PEOPLE_KIND && v.name === name)), entry];
  await writeAllViews(supabase, businessId, views, now);
  return reply(201, { view: entry, views: views.filter(v => v.kind === PEOPLE_KIND) });
}
export async function deletePeopleView(supabase, { businessId, id, now = Date.now() }) {
  const all = await readAllViews(supabase, businessId);
  if (!all.some(v => v.kind === PEOPLE_KIND && v.id === id)) return reply(404, { error: 'view not found' });
  const views = all.filter(v => v.id !== id);
  await writeAllViews(supabase, businessId, views, now);
  return reply(200, { views: views.filter(v => v.kind === PEOPLE_KIND) });
}
export async function listPeopleViewsRoute(req, res) { try { send(res, await listPeopleViews(getSupabase(), req.params.businessId)); } catch (e) { res.status(500).json({ error: e.message }); } }
export async function savePeopleViewRoute(req, res) { try { send(res, await savePeopleView(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, body: req.body || {} })); } catch (e) { res.status(500).json({ error: e.message }); } }
export async function deletePeopleViewRoute(req, res) { try { send(res, await deletePeopleView(getSupabase(), { businessId: req.params.businessId, id: req.params.id })); } catch (e) { res.status(500).json({ error: e.message }); } }
