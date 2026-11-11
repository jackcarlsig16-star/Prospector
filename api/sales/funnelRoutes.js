import { getSupabase, addDays, isDate } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { funnelContext, funnelWindow, funnelDay, trend30, windowRange, WINDOW_KEYS, FUNNEL_SINCE, VISITS_SINCE, WORDING, STEPS } from './funnelMath.js';

// email-funnel-v1 Stage 1 - GET goals/funnel?windows=yesterday,7d,30d[&window=<from>_<to>][&days=30]: the funnel per
// window from the raw tables through funnelMath (the one function) plus the daily series from sales_funnel_days; and
// writeFunnelDays, the day writer the Apollo sync and the visitor pull call (F3: never a cron, never page load; the last
// write of the day wins). `ready` = delivered rows reach FUNNEL_SINCE (R5: the email's tables wait for it).
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
export const SERIES_DEFAULT = 30, SERIES_MIN = 7, SERIES_MAX = 90, CHUNK = 200;
const MISSING_TABLE = e => ['42P01', 'PGRST205'].includes(e?.code) || /sales_funnel_days|sales_email_delivered/i.test(String(e?.message || ''));
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

export async function loadFunnelRows(supabase, businessId) {
  const all = (table, cols, build = q => q, order = 'id') => selectAllPages(() => build(supabase.from(table).select(cols).eq('business_id', businessId)).order(order));
  const safe = p => p.catch(e => { if (MISSING_TABLE(e)) return []; throw e; });
  const [delivered, messages, events, prospects, partnerContacts, opportunities, targets, partners, sequenced, people, visits, runs, calEvents] = await Promise.all([
    safe(all('sales_email_delivered', 'apollo_message_id, contact_id, account_id, delivered_at, delivered_day', q => q, 'apollo_message_id')),
    all('sales_email_messages', 'apollo_message_id, delivered_at, replied, reply_class, replied_at, replied_seen_at', q => q, 'apollo_message_id'),
    all('sales_email_activity', 'id, apollo_message_id, event, occurred_at, user_agent, tracking_service'),
    all('sales_prospect_state', 'contact_id, name, company, opportunity_id, goal_id', q => q, 'contact_id'),
    all('partner_contacts', 'id, apollo_contact_id, goal_id'),
    all('sales_opportunities', 'id, organization, apollo_account_id'),
    all('sales_targets', 'id, name'),
    all('sales_goals', 'id, name', q => q.eq('goal_type', 'partnership')),
    all('sales_sequenced_accounts', 'account_id, name', q => q, 'account_id'),
    all('sales_people', 'id, name, company_name, opportunity_id, target_id, apollo_person_id, created_at', q => q.eq('source_kind', 'web_visit').is('archived_at', null)),
    all('web_visits', 'id, company_key, pulled_on, seen_from, seen_to, matched_type, matched_id'),
    all('visit_pull_runs', 'id, la_date, kind, status, window_start, window_end', q => q.eq('kind', 'backfill')),
    all('microsoft_events', 'id, graph_id, ical_uid, external_domains, start_at, is_cancelled, created_at_graph'),
  ]);
  return { delivered, messages, events, prospects, partnerContacts, opportunities, targets, partners, sequenced, people, visits, runs, calEvents };
}

export const clampSeries = v => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(SERIES_MAX, Math.max(SERIES_MIN, n)) : SERIES_DEFAULT; };
const parseWindows = v => (v == null || v === '' ? ['yesterday', '7d', '30d'] : String(v).split(',').map(s => s.trim()).filter(Boolean));
const parseCustom = v => { if (v == null || v === '') return null; const m = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(String(v)); return m && isDate(m[1]) && isDate(m[2]) && m[1] <= m[2] ? { from: m[1], to: m[2] } : false; };

// windows: WINDOW_KEYS; custom: { from, to } reported under the key 'window' (the email's send window).
export async function loadFunnel(supabase, businessId, { windows = ['yesterday', '7d', '30d'], custom = null, days = SERIES_DEFAULT, now = Date.now() } = {}) {
  const bad = windows.filter(k => !WINDOW_KEYS.includes(k));
  if (bad.length) return reply(400, { error: `windows must be from ${WINDOW_KEYS.join(', ')}` });
  if (custom === false) return reply(400, { error: 'window must be <from>_<to> as YYYY-MM-DD, from <= to' });
  const today = laDateString(new Date(now));
  const [rows, seriesRows] = await Promise.all([
    loadFunnelRows(supabase, businessId),
    selectAllPages(() => supabase.from('sales_funnel_days').select('day, delivered, people_emailed, companies_emailed, companies_no_record, human_opens, human_clicks, companies_visited, people_identified, replies, meetings, sides_present, window_days, computed_at').eq('business_id', businessId).gte('day', addDays(today, -(clampSeries(days) - 1))).lte('day', today).order('day')).catch(e => { if (MISSING_TABLE(e)) return []; throw e; }),
  ]);
  const ctx = funnelContext(rows);
  const out = {};
  for (const k of windows) { const r = windowRange(k, today); out[k] = { key: k, ...funnelWindow(ctx, r.from, r.to) }; }
  if (custom) out.window = { key: 'window', ...funnelWindow(ctx, custom.from, custom.to) };
  const deliveredSince = rows.delivered.map(d => d.delivered_day).sort()[0] || null;
  return reply(200, {
    today, since: FUNNEL_SINCE, visits_since: VISITS_SINCE, delivered_since: deliveredSince, ready: !!deliveredSince && deliveredSince <= FUNNEL_SINCE,
    steps: STEPS, wording: WORDING, windows: out, series: seriesRows, trend_30d: trend30(seriesRows, today),
  });
}

export async function funnelRoute(req, res) {
  try { send(res, await loadFunnel(getSupabase(), req.params.businessId, { windows: parseWindows(req.query.windows), custom: parseCustom(req.query.window), days: req.query.days })); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

// The day writer: every LA day from VISITS_SINCE (at most 90 back) through today, rewritten in full - cohort numbers for
// an old day keep moving as opens, clicks, replies and visits arrive. -> { rows, from, to, sides } or { pending: true }
// while the migration has not run.
export async function writeFunnelDays(supabase, businessId, { now = Date.now() } = {}) {
  const today = laDateString(new Date(now));
  const from = [VISITS_SINCE, addDays(today, -89)].sort().pop();
  const ctx = funnelContext(await loadFunnelRows(supabase, businessId));
  const computed_at = new Date(now).toISOString();
  const rows = [];
  for (let d = from; d <= today; d = addDays(d, 1)) rows.push({ business_id: businessId, ...funnelDay(ctx, d), computed_at });
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from('sales_funnel_days').upsert(rows.slice(i, i + CHUNK), { onConflict: 'business_id,day' });
    if (error) { if (MISSING_TABLE(error)) return { pending: true, rows: rows.length }; throw new Error(error.message); }
  }
  const sides = {};
  for (const r of rows) sides[r.sides_present] = (sides[r.sides_present] || 0) + 1;
  return { rows: rows.length, from, to: today, sides };
}
