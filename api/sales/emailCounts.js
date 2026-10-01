import { apolloRequest } from './apolloClient.js';
import { laDateString } from './laDate.js';

// sales-email-trend-v1 REV2 Stage 2 - per-day email counts rebuilt from
// Apollo's message search, one Mon-Sun week per fetch. Method reconciled
// exactly against Apollo's own weekly numbers for Sep 14-20 (523 sent =
// 445 delivered + 7 hard bounced + 71 spam blocked). Facts the code relies
// on, all confirmed live 2026-10-01:
// - emailer_message_date_range is on delivery date, in PT days, and the
//   max is INCLUSIVE.
// - delivered / bounced / spam_blocked return non-overlapping sets, so
//   sent = their sum.
// - per_page max is 100 and no total count is returned.
const STATS = [
  ['delivered', 'delivered'],
  ['bounced', 'hard_bounced'],
  ['spam_blocked', 'spam_blocked'],
  ['opened', 'opened'],
  ['clicked', 'clicked'],
  ['replied', 'replied'],
];
const PER_PAGE = 100;
const MAX_PAGES_PER_STAT = 10;
// Late opens/replies keep landing on already-sent days, so recent weeks are
// re-fetched - but not on every Sync now click.
const REFRESH_AFTER_HOURS = 6;
const RECENT_WEEKS = 2;

// Backstop for this step's own counter in sync.js.
export const EMAIL_COUNTS_MAX_CALLS = RECENT_WEEKS * STATS.length * MAX_PAGES_PER_STAT;

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekStartOf(isoDate) {
  const dow = new Date(`${isoDate}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(isoDate, -((dow + 6) % 7));
}

export function weekStartsBetween(fromIso, toIso) {
  const out = [];
  for (let w = weekStartOf(fromIso); w <= toIso; w = addDays(w, 7)) out.push(w);
  return out;
}

async function fetchStat(ctx, stat, weekStart) {
  const messages = [];
  for (let page = 1; page <= MAX_PAGES_PER_STAT; page++) {
    const query = new URLSearchParams({
      'emailer_message_stats[]': stat,
      emailer_message_date_range_mode: 'completed_at',
      'emailer_message_date_range[min]': weekStart,
      'emailer_message_date_range[max]': addDays(weekStart, 6),
      per_page: String(PER_PAGE),
      page: String(page),
    }).toString();
    const json = await apolloRequest({ method: 'GET', path: '/emailer_messages/search', query, ctx });
    const batch = (json && json.emailer_messages) || [];
    messages.push(...batch);
    if (batch.length < PER_PAGE) return { messages, complete: true };
  }
  return { messages, complete: false };
}

// Returns the week's rows (one per day x mailbox x sequence x step with any
// activity) plus whether every stat was fully paged.
export async function fetchWeek(ctx, weekStart) {
  const byKey = new Map();
  const truncated = [];
  for (const [stat, column] of STATS) {
    const { messages, complete } = await fetchStat(ctx, stat, weekStart);
    if (!complete) truncated.push(stat);
    const seen = new Set();
    for (const m of messages) {
      if (!m.id || seen.has(m.id) || !m.completed_at) continue;
      seen.add(m.id);
      const key = [laDateString(new Date(m.completed_at)), m.from_email || 'unknown', m.emailer_campaign_id || '', typeof m.campaign_position === 'number' ? m.campaign_position : 0].join('|');
      if (!byKey.has(key)) {
        const [day, mailbox, sequenceId, step] = key.split('|');
        byKey.set(key, { day, mailbox, sequence_id: sequenceId, step: Number(step), delivered: 0, hard_bounced: 0, spam_blocked: 0, opened: 0, clicked: 0, replied: 0 });
      }
      byKey.get(key)[column] += 1;
    }
  }
  return { rows: [...byKey.values()], complete: truncated.length === 0, truncated };
}

// Replaces the week wholesale, so a re-fetch never double counts and a
// combination that dropped to zero disappears. The progress row is written
// last - if the insert fails, the week stays "not done" and reruns.
export async function writeWeek({ supabase, businessId, weekStart, rows, complete, truncated, calls }) {
  const weekEnd = addDays(weekStart, 6);
  const { error: delErr } = await supabase.from('sales_email_daily_counts').delete()
    .eq('business_id', businessId).gte('day', weekStart).lte('day', weekEnd);
  if (delErr) throw new Error(`email counts: clear week ${weekStart} failed: ${delErr.message}`);
  const now = new Date().toISOString();
  // Apollo's delivery-date filter is PT days, and so is our bucketing, so a
  // row can't fall outside its window - filtered anyway so a surprise can't
  // overwrite a neighbouring week.
  const inWeek = rows.filter(r => r.day >= weekStart && r.day <= weekEnd).map(r => ({ ...r, business_id: businessId, updated_at: now }));
  for (let i = 0; i < inWeek.length; i += 500) {
    const { error } = await supabase.from('sales_email_daily_counts').insert(inWeek.slice(i, i + 500));
    if (error) throw new Error(`email counts: insert week ${weekStart} failed: ${error.message}`);
  }
  const { error: progErr } = await supabase.from('sales_email_backfill_weeks').upsert({
    business_id: businessId, week_start: weekStart, fetched_at: now, apollo_calls: calls, complete,
    note: complete ? null : `page cap hit on: ${truncated.join(', ')}`,
  }, { onConflict: 'business_id,week_start' });
  if (progErr) throw new Error(`email counts: progress for ${weekStart} failed: ${progErr.message}`);
  return { rows: inWeek.length, dropped: rows.length - inWeek.length };
}

export async function syncWeek({ ctx, supabase, businessId, weekStart }) {
  const before = ctx.callCounter.count;
  const { rows, complete, truncated } = await fetchWeek(ctx, weekStart);
  const calls = ctx.callCounter.count - before;
  const written = await writeWeek({ supabase, businessId, weekStart, rows, complete, truncated, calls });
  return { weekStart, calls, complete, truncated, ...written };
}

// The Sync now / cron step: the current and previous week, each at most
// once per REFRESH_AFTER_HOURS. A CallCapError propagates to sync.js.
export async function refreshRecentWeeks({ ctx, supabase, businessId }) {
  const thisWeek = weekStartOf(laDateString());
  const weeks = [addDays(thisWeek, -7), thisWeek];
  const { data, error } = await supabase.from('sales_email_backfill_weeks').select('week_start, fetched_at')
    .eq('business_id', businessId).in('week_start', weeks);
  if (error) throw new Error(`email counts: read progress failed: ${error.message}`);
  const fetchedAt = new Map((data || []).map(r => [r.week_start, r.fetched_at]));
  const results = [];
  for (const weekStart of weeks) {
    const last = fetchedAt.get(weekStart);
    if (last && Date.now() - new Date(last).getTime() < REFRESH_AFTER_HOURS * 3600 * 1000) {
      results.push({ weekStart, skipped: 'fetched recently' });
      continue;
    }
    results.push(await syncWeek({ ctx, supabase, businessId, weekStart }));
  }
  return results;
}
