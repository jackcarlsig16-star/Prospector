import { apolloRequest } from './apolloClient.js';
import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { loadDupeContext } from './partnerDupeCheck.js';
import { laMonday, matchOf } from './scoutImport.js';
import { normName } from './intakeMatch.js';
import { cleanText } from './scrubText.js';
import { VISITOR_DOMAINS, US_500_FILTERS, SEED_SKIP, mergeResults, toVisit, liveMatch, knownSmall, prioritize, toWebSignal } from './visitRules.js';
import { loadOverrides, effectiveVisit } from './visitPriority.js';
import { windowFor, LOOKBACK_CAP } from './visitWindow.js';
import { autoCreateFromVisits, salesSettings } from './visitorRoutes.js';
import { hasRole } from '../lib/requireAuth.js';
import { scheduleRecompute } from './intentScoreRun.js';

// signals-v1 REV4 Stage 4 (D9) - Prospector's own daily website-visitor
// pull. Kicked by a Member's first Goals & Sales load of the LA day or by
// "Pull now" (force) - crons never fire on prod. One pull = balance, the
// visitor search over the window visitWindow.js computes (FIX visit-window-v1:
// days since the last ok run's window_end, so quiet days are covered; a
// backfill asks for backfill_days), the same search with the US/500+ filters,
// balance again. The measured delta goes to apollo_credit_spend every time,
// even 0, and a pull is refused once the LA month's recorded spend reaches
// 500 across ALL businesses (the Apollo account is shared). P1/P2 visits
// become 'web_visit' rows in the Signals review list; nothing else is
// proposed and nothing is written to Apollo.
export const MONTHLY_CREDIT_CAP = 500;
export const PAUSED = 'Visitor pull paused: 500 Apollo credits used this month';
export const TRIGGERS = ['pageload', 'manual', 'test'];
export const KINDS = ['daily', 'backfill'];
export const MAX_PAGES = 5;
const STALE_RUNNING_MS = 10 * 60e3;
const SEARCH_PATH = '/mixed_companies/search';
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const RUN_COLS = 'id, la_date, kind, window_start, window_end, lookback_days, status, calls, credits, error, created_at, updated_at';

export async function monthSpend(supabase, laMonth) {
  const rows = await selectAllPages(() => supabase.from('apollo_credit_spend').select('id, credits').eq('la_month', laMonth).order('id'));
  return rows.reduce((n, r) => n + (r.credits || 0), 0);
}

async function balance(ctx) {
  const json = await apolloRequest({ method: 'GET', path: '/users/api_profile', query: 'include_credit_usage=true', ctx });
  const n = json?.num_credits_remaining;
  if (typeof n !== 'number') throw new Error('Apollo credit balance unreadable');
  return n;
}

async function search(ctx, filters, lookbackDays) {
  const rows = { organizations: [], accounts: [] };
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await apolloRequest({ method: 'POST', path: SEARCH_PATH, ctx, body: { website_visitors_from_domains: VISITOR_DOMAINS, website_visitors_from_past: lookbackDays, per_page: 100, page, ...filters } });
    rows.organizations.push(...(json?.organizations || []));
    rows.accounts.push(...(json?.accounts || []));
    if (!json?.pagination || page >= json.pagination.total_pages) break;
  }
  return mergeResults(rows);
}

// The window end of the last ok run (any kind) - what the next window reaches back to.
async function lastOkWindowEnd(supabase, businessId) {
  const rows = must(await supabase.from('visit_pull_runs').select('window_end').eq('business_id', businessId).eq('status', 'ok').not('window_end', 'is', null).order('window_end', { ascending: false }).limit(1));
  return rows[0]?.window_end || null;
}

// The ran-today guard: one visit_pull_runs row per business per LA day per
// kind. An 'ok' daily run blocks a second one unless forced; an ok backfill
// blocks another backfill that day, force or not; an 'error' or stale
// 'running' row is retried; a fresh 'running' row means someone else is
// pulling right now. The window the run covers is written on the row.
async function claimRun(supabase, businessId, today, win, force, now) {
  const stamp = new Date(now).toISOString();
  const windowCols = { window_start: win.window_start, window_end: win.window_end, lookback_days: win.lookback_days };
  const prior = must(await supabase.from('visit_pull_runs').select(RUN_COLS).eq('business_id', businessId).eq('la_date', today).eq('kind', win.kind).maybeSingle());
  if (prior) {
    if (prior.status === 'running' && now - Date.parse(prior.updated_at) < STALE_RUNNING_MS) return { busy: true };
    if (prior.status === 'ok' && (!force || win.kind === 'backfill')) return { done: prior };
    const rows = must(await supabase.from('visit_pull_runs').update({ status: 'running', calls: 0, credits: 0, error: null, updated_at: stamp, ...windowCols })
      .eq('id', prior.id).eq('status', prior.status).select(RUN_COLS));
    return rows.length ? { run: rows[0], first: false } : { busy: true };
  }
  const any = must(await supabase.from('visit_pull_runs').select('id').eq('business_id', businessId).limit(1));
  const ins = await supabase.from('visit_pull_runs').insert({ business_id: businessId, la_date: today, kind: win.kind, status: 'running', updated_at: stamp, ...windowCols }).select(RUN_COLS);
  if (ins.error?.code === '23505') return { busy: true };
  return { run: must(ins)[0], first: !any.length };
}

async function store(supabase, { businessId, userId, today, win, all, usIds, first, now, apollo = null }) {
  if (first) {
    const have = must(await supabase.from('sales_visit_skip').select('id').eq('business_id', businessId).limit(1));
    if (!have.length) must(await supabase.from('sales_visit_skip').insert(SEED_SKIP.map(n => ({ business_id: businessId, company_key: normName(n), reason: 'Seed (D10)' }))));
  }
  const week = laMonday(today);
  const [ctx, skipRows, signals, overrides] = await Promise.all([
    loadDupeContext(supabase, businessId),
    selectAllPages(() => supabase.from('sales_visit_skip').select('id, company_key').eq('business_id', businessId).order('id')),
    selectAllPages(() => supabase.from('sales_signals').select('id, source, signal_week, company_key, status, dismissed_until').eq('business_id', businessId).order('id')),
    loadOverrides(supabase, businessId),
  ]);
  const skip = new Set(skipRows.map(s => s.company_key));
  const byKey = new Map();
  for (const r of all) {
    const v = toVisit(r, usIds.has(r._org_id));
    if (!v.company_name || !v.company_key) continue;
    const prior = byKey.get(v.company_key);
    if (!prior || (v.visits_7d || 0) > (prior.visits_7d || 0)) byKey.set(v.company_key, v);
  }
  const stamp = new Date(now).toISOString();
  const rows = [], proposals = [], effective = [];
  for (const v of byKey.values()) {
    const match = liveMatch(v, ctx);
    const scored = { ...v, ...prioritize(v, { match, small: knownSmall(v, ctx), skip }) };
    rows.push({ business_id: businessId, pulled_on: today, seen_from: win.window_start, seen_to: win.window_end, ...scored, matched_type: match?.type || null, matched_id: match?.id || null, updated_at: stamp });
    // web_visits keeps the computed priority; a person's override decides the signal (and the auto-create bar).
    const eff = effectiveVisit(scored, overrides.get(v.company_key));
    effective.push({ ...eff, pulled_on: today, matched_type: match?.type || null, matched_id: match?.id || null, match_owner_team: match?.owner_team || null });
    if (eff.priority === 'P1' || eff.priority === 'P2') proposals.push(toWebSignal(eff, { businessId, week, userId, match, hint: matchOf(v.company_name, ctx) }));
  }
  const stored = rows.length ? must(await supabase.from('web_visits').upsert(rows, { onConflict: 'business_id,company_key,pulled_on' }).select('id, company_key')) : [];
  const idByKey = new Map(stored.map(r => [r.company_key, r.id]));
  // One open signal per company per week; a company dismissed in Signals
  // stays out until its dismissal runs out.
  const taken = new Set(signals.filter(s => s.source === 'web_visit' && s.signal_week === week).map(s => s.company_key));
  const parked = new Set(signals.filter(s => s.status === 'dismissed' && s.dismissed_until && s.dismissed_until >= today).map(s => s.company_key));
  let added = 0;
  for (const s of proposals) {
    if (taken.has(s.company_key) || parked.has(s.company_key)) continue;
    const ins = await supabase.from('sales_signals').insert(s).select('id');
    if (ins.error?.code === '23505') continue;
    must(ins);
    taken.add(s.company_key);
    added++;
  }
  const counts = { companies: rows.length, us_500: rows.filter(r => r.us_500).length, P1: 0, P2: 0, P3: 0, P4: 0, signals: added };
  for (const r of rows) counts[r.priority]++;
  // visitor-to-record-v1 V1 / V2b: a qualifying visit becomes an employer target (its signal auto-accepted) and, with
  // a domain, up to people_per_company people from one domain-scoped search - after the rows and signals are stored.
  const settings = await salesSettings(supabase, businessId);
  const auto = await autoCreateFromVisits(supabase, { businessId, userId, visits: effective.map(v => ({ ...v, id: idByKey.get(v.company_key) || null })), apollo, dupeCtx: ctx, settings, skip, week, now: new Date(now) });
  counts.auto = { created: auto.created.length, people: auto.people, searches: auto.searches, attached: auto.attached, waited: auto.waited, duplicates: auto.duplicates, capped: auto.capped, no_signal: auto.no_signal, search_errors: auto.search_errors };
  return counts;
}

// POST /goals/visits/pull { force?, trigger?, backfill_days? } -> { ran: false, reason | paused } or
// { ran: true, run, counts, credits, window }. backfill_days (owner/admin, once per LA day) asks Apollo for that many
// days regardless of history; otherwise the window is days since the last ok run (visitWindow.js). A failed pull
// answers 502 with a short message and leaves visit_pull_runs.status = 'error'; the page carries on.
// injected (visitor-to-record-v1 Stage 4, the live verify only - runVisitPullRoute never passes it): { organizations,
// accounts?, us_ids? } stands in for Apollo's two visitor searches, so the rows go through the same scoring, storage,
// signals and auto-create as a real pull with 0 visitor calls, no run row and no credit row; only V2b's people search
// may call Apollo.
export async function runVisitPull(supabase, { businessId, userId, trigger = 'manual', force = false, backfillDays = null, now = Date.now(), injected = null }) {
  if (injected) {
    const today = laDateString(new Date(now)), win = windowFor(null, today);
    const ctx = { callCounter: { count: 0, max: 0 }, endpointCounts: {} };
    const all = mergeResults({ organizations: injected.organizations || [], accounts: injected.accounts || [] });
    const counts = await store(supabase, { businessId, userId, today, win, all, usIds: new Set(injected.us_ids || []), first: false, now, apollo: ctx });
    scheduleRecompute(supabase, businessId, 'visit_pull');
    return reply(200, { ran: true, injected: true, counts, credits: 0, window: win, calls: ctx.callCounter.count });
  }
  if (!TRIGGERS.includes(trigger)) return reply(400, { error: `trigger must be one of ${TRIGGERS.join('|')}` });
  if (typeof force !== 'boolean') return reply(400, { error: 'force must be true or false' });
  if (backfillDays != null && !(Number.isInteger(backfillDays) && backfillDays >= 1 && backfillDays <= LOOKBACK_CAP)) return reply(400, { error: `backfill_days must be a whole number from 1 to ${LOOKBACK_CAP}` });
  const today = laDateString(new Date(now)), laMonth = today.slice(0, 7);
  let claim, win;
  try {
    const spent = await monthSpend(supabase, laMonth);
    if (spent >= MONTHLY_CREDIT_CAP) return reply(200, { ran: false, paused: true, reason: PAUSED, spent });
    win = windowFor(await lastOkWindowEnd(supabase, businessId), today, { backfillDays });
    claim = await claimRun(supabase, businessId, today, win, force, now);
  } catch (e) {
    return reply(e.status || 500, { error: e.message });
  }
  if (claim.done) return reply(200, { ran: false, reason: win.kind === 'backfill' ? 'Already backfilled today' : 'Visitors already pulled today', last_run: claim.done });
  if (claim.busy) return reply(409, { error: 'A visitor pull is running - try again in a minute' });
  const ctx = { callCounter: { count: 0, max: 2 + 2 * MAX_PAGES }, endpointCounts: {} };
  let before = null, after = null, credits = 0;
  const finish = patch => supabase.from('visit_pull_runs').update({ ...patch, calls: ctx.callCounter.count, credits, updated_at: new Date().toISOString() }).eq('id', claim.run.id).select(RUN_COLS);
  const recordSpend = () => supabase.from('apollo_credit_spend').insert({
    business_id: businessId, la_month: laMonth, endpoint: SEARCH_PATH, ref: `visit_pull:${today}${win.kind === 'backfill' ? ':backfill' : ''}`, credits, balance_before: before, balance_after: after,
  });
  try {
    before = await balance(ctx);
    const all = await search(ctx, {}, win.lookback_days);
    const us = await search(ctx, US_500_FILTERS, win.lookback_days);
    after = await balance(ctx);
    credits = before - after;
    must(await recordSpend());
    const counts = await store(supabase, { businessId, userId, today, win, all, usIds: new Set(us.map(r => r._org_id)), first: claim.first, now, apollo: ctx });
    const run = must(await finish({ status: 'ok', error: null }))[0];
    scheduleRecompute(supabase, businessId, 'visit_pull');
    return reply(200, { ran: true, run, counts, credits, window: win });
  } catch (e) {
    // A search that spent before failing still gets its delta recorded.
    if (before != null && after == null) {
      try { after = await balance(ctx); credits = before - after; must(await recordSpend()); } catch (spendErr) { console.error('[visits/pull] spend not recorded', cleanText(String(spendErr.message || ''), 200)); }
    }
    const message = cleanText(String(e.message || 'failed'), 200);
    const closed = await finish({ status: 'error', error: message });
    if (closed.error) console.error('[visits/pull] could not close the run row', claim.run.id, closed.error.message);
    console.error('[visits/pull]', message);
    return reply(502, { error: `Visitor pull failed: ${message}` });
  }
}
export async function runVisitPullRoute(req, res) {
  const { force = false, trigger = 'manual', backfill_days: backfillDays = null } = req.body || {};
  if (backfillDays != null && !hasRole(req, req.params.businessId, 'admin')) return send(res, reply(403, { error: 'Only an owner or admin can backfill visitors' }));
  send(res, await runVisitPull(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, trigger, force, backfillDays }));
}

// GET /goals/visits/status -> { last_run, paused (the message, or null), spent, cap, today: { P1..P4 } }
// "today" = rows whose window ends today (seen_to), so a backfilled visit from last week is not counted as today's.
export async function visitStatus(supabase, businessId, now = Date.now()) {
  const today = laDateString(new Date(now));
  const [runs, spent, visits] = await Promise.all([
    supabase.from('visit_pull_runs').select(RUN_COLS).eq('business_id', businessId).order('la_date', { ascending: false }).order('updated_at', { ascending: false }).limit(1),
    monthSpend(supabase, today.slice(0, 7)),
    selectAllPages(() => supabase.from('web_visits').select('id, priority').eq('business_id', businessId).eq('seen_to', today).order('id')),
  ]);
  if (runs.error) throw err(500, runs.error.message);
  const counts = { P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const v of visits) counts[v.priority]++;
  return { last_run: runs.data?.[0] || null, paused: spent >= MONTHLY_CREDIT_CAP ? PAUSED : null, spent, cap: MONTHLY_CREDIT_CAP, today: counts };
}
export async function visitStatusRoute(req, res) {
  try { res.json(await visitStatus(getSupabase(), req.params.businessId)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}
