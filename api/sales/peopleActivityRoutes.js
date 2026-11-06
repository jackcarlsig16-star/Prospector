import { getSupabase, addDays } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { normName } from './intakeMatch.js';
import { mergePeople, SOURCE_WORD } from './peopleMerge.js';
import { cleanText } from './scrubText.js';
import { isMigrationPending } from './personActivity.js';
import { HEAT_BANDS } from './heatScore.js';

// people-v2 Stage 1 (P5) - GET goals/people/activity?window=7|30|90|all: ONE read for Pipeline › People. The rows are the
// union of the three contact tables merged by the P2 rule, each joined to its materialised email summary
// (sales_person_activity - the Huddle's numbers, written by the sync), its company's latest web_visits row, the buyer
// flag (sales_settings.buyer_titles), the identified date (a visitor-identified person's filing date) and the last touch
// on any channel. The window keeps the rows whose last email signal or whose company's last visit falls inside it; the
// counts stay lifetime totals (the summary holds totals). Names and titles only - has_email is a boolean, an address never
// reaches the output (checked). 503 until the Stage 1 migration has run.
export const WINDOWS = { 7: 'last 7 days', 30: 'last 30 days', 90: 'last 90 days', all: 'all time' };
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
  const company = (type, row) => (row ? { type, id: row.id, name: cleanText(row.organization || row.name, 160), stage: row.stage || row.status || row.pipeline_status || null, owner_user_id: row.owner_user_id || null } : null);
  const out = [];
  for (const p of prospects) {
    const o = p.opportunity_id ? opp.get(p.opportunity_id) : null, g = p.goal_id ? goal.get(p.goal_id) : null;
    out.push({ person_key: `prospect:${p.contact_id}`, source: 'prospect', name: nameOf(p.name), title: cleanText(p.title, 160) || null, company: o ? company('employer', o) : g ? company('partner', g) : p.company ? { type: 'account', id: null, name: cleanText(p.company, 160), stage: null, owner_user_id: null } : null,
      apollo_id: p.contact_id, contact_id: p.contact_id, has_email: !!p.email, identified_at: null, last_touch_at: null, status: p.status || null, owner: p.owner || null });
  }
  for (const p of salesPeople) {
    if (p.archived_at) continue;
    const c = p.company_type === 'employer' && p.opportunity_id ? company('employer', opp.get(p.opportunity_id)) : p.target_id ? company('target', tgt.get(p.target_id)) : p.company_name ? { type: 'parked', id: null, name: cleanText(p.company_name, 160), stage: null, owner_user_id: null } : null;
    const source = p.source_kind === 'web_visit' || p.visit_id ? 'visitor' : p.upload_id ? 'upload' : 'hand';
    out.push({ person_key: `person:${p.id}`, source, name: nameOf(p.name), title: cleanText(p.title, 160) || null, company: c, apollo_id: null, contact_id: null, has_email: false, identified_at: source === 'visitor' ? p.created_at || null : null, last_touch_at: null, status: null, owner: null });
  }
  for (const c of partnerContacts) {
    out.push({ person_key: `contact:${c.id}`, source: 'contact', name: nameOf(c.name), title: cleanText(c.title, 160) || null, company: company('partner', goal.get(c.goal_id)), apollo_id: c.apollo_contact_id || null, contact_id: c.apollo_contact_id || null, has_email: !!c.email, identified_at: null, last_touch_at: c.last_activity_at || null, status: null, owner: null, partner_contact_ids: [c.id] });
  }
  return out.filter(r => r.name);
}

const latestVisits = visits => { const m = new Map(); for (const v of visits) { const cur = m.get(v.company_key); if (!cur || v.pulled_on > cur.pulled_on) m.set(v.company_key, v); } return m; };
const nz = v => (v == null ? 0 : Number(v));

// Pure: the merged, joined, windowed rows + the chip counts.
export function buildPeopleTable({ rows, activity = [], visits = [], buyerTitles = [], window: w, now = Date.now() }) {
  const today = laDateString(new Date(now));
  const act = new Map();
  for (const a of activity) { act.set(a.person_key, a); if (a.contact_id) act.set(`c:${a.contact_id}`, a); }
  const byKey = latestVisits(visits);
  const byMatch = new Map([...byKey.values()].filter(v => v.matched_type && v.matched_id).map(v => [`${v.matched_type}:${v.matched_id}`, v]));
  const MATCH = { employer: 'opportunity', target: 'target', partner: 'partner' };
  const visitOf = c => (c ? (c.id && byMatch.get(`${MATCH[c.type]}:${c.id}`)) || byKey.get(normName(c.name)) || null : null);
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
  return { rows: shown, n: shown.length, total: people.length, counts, window: w, heat_threshold: HEAT_BANDS.hotScore, computed_at: activity.map(a => a.computed_at).filter(Boolean).sort().pop() || null, heat_pending: activity.filter(a => a.heat == null).length };
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
    all('sales_opportunities', 'id, organization, stage, owner_user_id, archived_at'),
    all('sales_targets', 'id, name, status, owner_user_id'),
    all('sales_goals', 'id, name, pipeline_status, owner_user_id', x => x.eq('goal_type', 'partnership')),
    all('web_visits', 'id, company_key, company_name, matched_type, matched_id, visits_7d, last_visit, seen_to, top_paths, pulled_on'),
    supabase.from('sales_settings').select('buyer_titles').eq('business_id', businessId).maybeSingle(),
  ]);
  const rows = peopleRows({ prospects, salesPeople, partnerContacts, opportunities: opportunities.filter(o => !o.archived_at), targets, partners });
  return reply(200, buildPeopleTable({ rows, activity, visits, buyerTitles: must(settings)?.buyer_titles || [], window: w, now }));
}

export async function peopleActivityRoute(req, res) {
  try { send(res, await peopleActivity(getSupabase(), req.params.businessId, { window: req.query.window })); }
  catch (e) { res.status(500).json({ error: e.message }); }
}
