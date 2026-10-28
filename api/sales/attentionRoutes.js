import { getSupabase, addDays } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { monthSpend, MONTHLY_CREDIT_CAP } from './visitPull.js';
import { STUCK_RUN_MINUTES } from './syncRunStatus.js';
import { TIDY_STALE_MS } from './tidyRoutes.js';
import { STALE_RUNNING_MS as RESEARCH_STALE_MS } from './partnerResearch.js';
import { dryRun as apolloDryRun } from './partnerApolloTouches.js';
import { dryRun as outlookDryRun } from './partnerOutlookTouches.js';
import { campaignActionRows } from './outreachRoutes.js';

// actions-home-attention-v1 D3/D4 - GET goals/attention: one read for the
// "Needs attention" drawer. Five sync sources, each { id, label, status, last_at,
// error } with status ok | stale | failed | running | not_connected, computed
// when read (no cron). Stale rules are REVISABLE (workflow-context E):
//   apollo    no success (or partial) in 24 h; the latest run errored or stuck = failed
//   outlook   the caller's own mailbox: no run in 24 h on a weekday; no grant = not_connected
//   visitors  no ok pull for today's LA date after 10 AM PT; an error row today = failed
//   tidy      same as visitors
//   research  failed only when the latest run errored (or died running)
// Plus the caller's counts: overdue to-dos (theirs), overdue waiting-on, held
// Apollo / Outlook partner moves, campaign sends due (theirs) and unanswered
// campaign replies (theirs). Reads only, service key, never an address.
// The two held-moves counts scan every stored Outlook message, so they are
// kept per workspace for HELD_CACHE_MS; ?fresh=1 (the drawer opening) reads anew.

export const SOURCES = [['apollo', 'Apollo (sequences, opens, replies)'], ['outlook', 'Outlook (mail + calendar)'], ['visitors', 'Website visitors'], ['headcount', 'Headcounts (Apollo)'], ['tidy', 'Tidy'], ['research', 'Research']];
export const DAY_MS = 864e5;
export const MORNING_HOUR = 10; // LA hour after which today's pull / Tidy should have run (REVISABLE)
export const OUTLOOK_DEAD_MS = 30 * 60e3;
export const VISITS_DEAD_MS = 10 * 60e3;
export const HELD_CACHE_MS = 15 * 60e3;
const heldCache = new Map(); // businessId -> { at, apollo, outlook }
const must = r => { if (r.error) throw Object.assign(new Error(r.error.message), { status: 500 }); return r.data; };
const laHour = now => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(now));
const laWeekday = now => new Date(`${laDateString(now)}T12:00:00Z`).getUTCDay();
const ERR_MAX = 300;
const line = (id, status, last_at = null, error = null, extra = {}) => ({ id, label: Object.fromEntries(SOURCES)[id], status, last_at, error: error ? String(error).slice(0, ERR_MAX) : null, ...extra });

// Apollo: the latest real run decides failed / running; otherwise the latest success decides ok / stale.
export function apolloLine(runs, now) {
  const latest = runs[0];
  const success = runs.find(r => ['success', 'partial'].includes(r.status));
  const lastOk = success ? success.finished_at || success.started_at : null;
  if (latest?.status === 'running') {
    return now - Date.parse(latest.started_at) > STUCK_RUN_MINUTES * 60e3
      ? line('apollo', 'failed', latest.started_at, `stuck - no finish after ${STUCK_RUN_MINUTES} min`) : line('apollo', 'running', latest.started_at);
  }
  if (latest?.status === 'error') return line('apollo', 'failed', latest.finished_at || latest.started_at, latest.error_text || 'the last sync failed', { last_ok_at: lastOk });
  if (!lastOk) return line('apollo', 'stale', null, null);
  // FIX people-apollo-visibility-v1 F3c: messages the last good run couldn't reach ("n messages left - Sync again").
  return line('apollo', now - Date.parse(lastOk) > DAY_MS ? 'stale' : 'ok', lastOk, null, { left: success.counts?.activity?.backlog_after_run || 0 });
}

// Outlook: the caller's own grant and runs (one run = up to 3 folder rows started together).
export function outlookLine(grant, runs, now) {
  if (!grant) return line('outlook', 'not_connected');
  if (grant.error) return line('outlook', 'failed', null, `${grant.error} - reconnect in Connections`);
  const latest = runs[0];
  if (!latest) return line('outlook', 'stale');
  const batch = runs.filter(r => Date.parse(latest.started_at) - Date.parse(r.started_at) < 5 * 60e3);
  const open = batch.find(r => !r.finished_at);
  if (open) return now - Date.parse(open.started_at) > OUTLOOK_DEAD_MS ? line('outlook', 'failed', open.started_at, 'the last sync never finished') : line('outlook', 'running', open.started_at);
  const failed = batch.find(r => r.error);
  if (failed) return line('outlook', 'failed', failed.started_at, `${failed.folder}: ${failed.error}`);
  const weekday = [1, 2, 3, 4, 5].includes(laWeekday(now));
  return line('outlook', weekday && now - Date.parse(latest.started_at) > DAY_MS ? 'stale' : 'ok', latest.finished_at || latest.started_at);
}

// Visitors and Tidy share one daily rule: today's ok run = ok; an error today = failed; a fresh running row = running
// (a dead one = failed); none yet = ok before MORNING_HOUR (yesterday's stands), stale after.
export function dailyLine(id, runs, { now, dateOf, startedOf, deadMs, errorOf }) {
  const today = laDateString(now);
  const mine = runs.filter(r => dateOf(r) === today);
  const ok = mine.find(r => r.status === 'ok');
  const lastAny = runs[0] ? startedOf(runs[0]) : null;
  if (ok) return line(id, 'ok', startedOf(ok));
  const running = mine.find(r => r.status === 'running');
  if (running) return now - Date.parse(startedOf(running)) > deadMs ? line(id, 'failed', startedOf(running), 'the run never finished') : line(id, 'running', startedOf(running));
  const failed = mine.find(r => r.status === 'error');
  if (failed) return line(id, 'failed', startedOf(failed), errorOf(failed) || 'the run failed');
  return line(id, laHour(now) >= MORNING_HOUR ? 'stale' : 'ok', lastAny);
}

// FIX visit-window-v1 W6: what the last ok visitor pull covered, and whether a day is missing in front of it.
// companies = rows that run upserted (same pulled_on). gap = no ok run, or its window_end is older than yesterday.
export function visitWindow(runs, companies, now) {
  const today = laDateString(now);
  const ok = runs.filter(r => r.status === 'ok' && r.window_end).sort((a, b) => b.window_end.localeCompare(a.window_end) || b.la_date.localeCompare(a.la_date))[0] || null;
  return {
    window_start: ok?.window_start || null, window_end: ok?.window_end || null, lookback_days: ok?.lookback_days ?? null, kind: ok?.kind || null,
    companies: ok ? companies : 0, last_ok_at: ok ? ok.updated_at || ok.created_at : null, gap: !ok || ok.window_end < addDays(today, -1),
  };
}

export function researchLine(runs, now) {
  const latest = runs[0];
  if (!latest) return line('research', 'ok');
  if (latest.status === 'error') return line('research', 'failed', latest.created_at, latest.error || 'the last research run failed');
  if (['queued', 'running'].includes(latest.status)) {
    return now - Date.parse(latest.created_at) > RESEARCH_STALE_MS ? line('research', 'failed', latest.created_at, 'the run never finished') : line('research', 'running', latest.created_at);
  }
  return line('research', 'ok', latest.created_at);
}

// visitor-to-record-v1 V2a - the visitor PEOPLE pull's state (sales_settings.visitor_filters.visitor_people): what the
// Needs attention visitors line reads under the window. Counts and the list name only.
export function peoplePullLine(settings, peopleRuns = [], parked = 0) {
  const s = settings?.visitor_filters?.visitor_people || {};
  const latest = [...peopleRuns].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0] || null;
  const status = latest ? latest.status : s.last_pull_on ? 'ok' : null;
  return { last_on: s.last_pull_on || latest?.la_date || null, last_at: s.last_at || latest?.updated_at || null, status, counts: s.last_counts || null, list: s.list_name || null, list_count: s.list_count ?? null, error: latest?.status === 'error' ? latest.error : s.last_error || null, parked };
}

// FIX headcount-auto-v1 REV2 H5 / H6 - the Headcounts line: the last fill's result line, month-to-date Apollo spend from
// the shared ledger, failed only when Apollo started charging (paused) or the last run errored.
export function headcountLine(settings, monthSpent = 0, cap = 500) {
  const h = settings?.visitor_filters?.headcount || {};
  const status = h.charged ? 'failed' : h.last_error_at && (!h.last_at || h.last_error_at > h.last_at) ? 'failed' : 'ok';
  return { id: 'headcount', label: 'Headcounts (Apollo)', status, last_at: h.last_at || null, error: h.charged ? h.charged.message : status === 'failed' ? h.last_error : null, line: h.last_line || null, counts: h.last_counts || null, filled: h.last_filled || [], spend: { month: monthSpent, cap, daily_cap: settings?.headcount_daily_credits ?? 25, today: h.today?.day === laDateString(new Date()) ? h.today : null } };
}

const DRY_RUNS = { apollo: apolloDryRun, outlook: outlookDryRun };
export async function heldCounts(supabase, businessId, { fresh = false, now = Date.now(), dry = DRY_RUNS } = {}) {
  const hit = heldCache.get(businessId);
  if (!fresh && hit && now - hit.at < HELD_CACHE_MS) return hit;
  const [a, o] = await Promise.all([dry.apollo(supabase, businessId), dry.outlook(supabase, businessId, new Date(now))]);
  const out = { at: now, apollo: a.held.length, outlook: o.held.length };
  heldCache.set(businessId, out);
  return out;
}

// Not ok = stale or failed (running is on its way; not connected is a choice, shown but not counted).
export const attentionCount = ({ sources, counts }) => sources.filter(s => s.status === 'stale' || s.status === 'failed').length + Object.values(counts).filter(n => n > 0).length;

export async function attention(supabase, { businessId, userId, fresh = false, now = Date.now(), dry = DRY_RUNS }) {
  const at = new Date(now);
  const today = laDateString(at);
  const since = new Date(now - 7 * DAY_MS).toISOString();
  const [syncRuns, grant, msRuns, allVisitRuns, tidyRuns, researchRuns, overdue, waiting, held, campaign, settings, parked, monthSpent] = await Promise.all([
    supabase.from('sales_sync_runs').select('status, started_at, finished_at, error_text, counts').eq('business_id', businessId).neq('trigger', 'test').order('started_at', { ascending: false }).limit(20).then(must),
    supabase.from('microsoft_grants').select('user_id, error').eq('user_id', userId).maybeSingle().then(must),
    supabase.from('microsoft_sync_runs').select('folder, started_at, finished_at, error').eq('user_id', userId).eq('dry_run', false).order('started_at', { ascending: false }).limit(6).then(must),
    supabase.from('visit_pull_runs').select('la_date, kind, window_start, window_end, lookback_days, status, error, created_at, updated_at').eq('business_id', businessId).gte('la_date', addDays(today, -7)).order('la_date', { ascending: false }).limit(20).then(must),
    supabase.from('sales_tidy_runs').select('status, started_at, finished_at, counts').eq('business_id', businessId).gte('started_at', since).order('started_at', { ascending: false }).limit(20).then(must),
    supabase.from('research_runs').select('status, error, created_at').eq('business_id', businessId).order('created_at', { ascending: false }).limit(1).then(must),
    selectAllPages(() => supabase.from('sales_week_goals').select('id').eq('business_id', businessId).eq('kind', 'todo').eq('owner_user_id', userId).eq('status', 'open').lt('due_date', today).order('id')),
    selectAllPages(() => supabase.from('sales_week_goals').select('id').eq('business_id', businessId).eq('kind', 'waiting').eq('status', 'open').lt('due_date', today).order('id')),
    heldCounts(supabase, businessId, { fresh, now, dry }),
    campaignActionRows(supabase, businessId, today),
    supabase.from('sales_settings').select('visitor_filters, headcount_daily_credits').eq('business_id', businessId).maybeSingle().then(must),
    supabase.from('sales_people').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('company_type', 'parked').is('archived_at', null).then(r => (r.error ? 0 : r.count || 0)),
    monthSpend(supabase, today.slice(0, 7)).catch(() => 0),
  ]);
  const peopleRuns = allVisitRuns.filter(r => r.kind === 'people');
  const visitRuns = allVisitRuns.filter(r => r.kind !== 'people');
  const lastOkPull = visitRuns.filter(r => r.status === 'ok' && r.window_end).sort((a, b) => b.window_end.localeCompare(a.window_end))[0];
  const pulled = lastOkPull ? await supabase.from('web_visits').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('pulled_on', lastOkPull.la_date).then(r => { if (r.error) throw Object.assign(new Error(r.error.message), { status: 500 }); return r.count || 0; }) : 0;
  const sources = [
    apolloLine(syncRuns, now),
    outlookLine(grant, msRuns, now),
    { ...dailyLine('visitors', visitRuns, { now, dateOf: r => r.la_date, startedOf: r => r.updated_at || r.created_at, deadMs: VISITS_DEAD_MS, errorOf: r => r.error }), window: visitWindow(visitRuns, pulled, now), people_pull: peoplePullLine(settings, peopleRuns, parked) },
    headcountLine(settings, monthSpent, MONTHLY_CREDIT_CAP),
    dailyLine('tidy', tidyRuns, { now, dateOf: r => laDateString(new Date(r.started_at)), startedOf: r => r.started_at, deadMs: TIDY_STALE_MS, errorOf: r => r.counts?.error }),
    researchLine(researchRuns, now),
  ];
  const counts = {
    overdue_todos: overdue.length, overdue_waiting: waiting.length, held_apollo: held.apollo, held_outlook: held.outlook,
    campaign_sends: campaign.sends.filter(r => r.owner_user_id === userId).length,
    campaign_replies: campaign.replies.filter(r => r.owner_user_id === userId).length,
  };
  return { today, sources, counts, held_at: new Date(held.at).toISOString(), n: attentionCount({ sources, counts }) };
}

// GET /goals/attention[?fresh=1] -> { today, sources, counts, held_at, n }
export async function attentionRoute(req, res) {
  try { res.json(await attention(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, fresh: ['1', 'true'].includes(String(req.query.fresh || '')) })); }
  catch (e) {
    console.error('[goals/attention]', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
}
