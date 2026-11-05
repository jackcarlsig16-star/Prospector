import { addDays, laMonday, laStartOfDayMs } from './goalsShared.js';
import { humanShare, humanOpenRate, countExternalMeetings } from './scorecardMath.js';

// dashboard-v3 Stage 2 - Home's Pulse, pure. One period = SERIES windows of the same kind, oldest first, the last one
// the window on screen (this week / month / 90 days run to today, so they are partial); its delta is against the
// window before it, the sparkline is all SERIES values. Every number comes from stored rows (A9, one source per word):
// sent / delivered / replied from sales_email_daily_counts by send date; human opens = Apollo opens × the human share
// through the one bot rule (A4, scorecardMath); meetings = Outlook events with an external domain booked in the window
// (A5); visitors = companies seen by the daily pulls (a window without a pull is unknown, not 0); first-touched =
// people whose first touch falls in the window (partnerMetrics' merge) against the month goal.
export const PERIODS = ['this_week', 'last_week', '4_weeks', 'month', '90_days'];
export const PERIOD_LABEL = { this_week: 'This week', last_week: 'Last week', '4_weeks': '4 weeks', month: 'This month', '90_days': '90 days' };
export const SERIES = 5;
export const METRICS = ['sent', 'delivered_rate', 'human_open_rate', 'reply_rate', 'meetings', 'visitors', 'first_touched'];

const monthStart = d => `${d.slice(0, 7)}-01`;
const addMonths = (first, n) => { const d = new Date(`${first}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return `${d.toISOString().slice(0, 7)}-01`; };

export function windows(period, today) {
  const mon = laMonday(today);
  const out = [];
  if (period === 'this_week') for (let i = SERIES - 1; i >= 0; i--) out.push({ from: addDays(mon, -7 * i), to: i ? addDays(mon, -7 * i + 6) : today });
  else if (period === 'last_week') for (let i = SERIES; i >= 1; i--) out.push({ from: addDays(mon, -7 * i), to: addDays(mon, -7 * i + 6) });
  else if (period === '4_weeks') { const start = addDays(mon, -21); for (let i = SERIES - 1; i >= 0; i--) out.push({ from: addDays(start, -28 * i), to: i ? addDays(start, -28 * i + 27) : today }); }
  else if (period === 'month') { const m0 = monthStart(today); for (let i = SERIES - 1; i >= 0; i--) { const f = addMonths(m0, -i); out.push({ from: f, to: i ? addDays(addMonths(f, 1), -1) : today }); } }
  else if (period === '90_days') for (let i = SERIES - 1; i >= 0; i--) out.push({ from: addDays(today, -90 * i - 89), to: addDays(today, -90 * i) });
  else throw new Error(`unknown period ${period}`);
  return out;
}

const sum = (rows, f) => rows.reduce((n, r) => n + (f(r) || 0), 0);
const inDays = (w, d) => d >= w.from && d <= w.to;
const msRange = w => [laStartOfDayMs(w.from), laStartOfDayMs(addDays(w.to, 1))];
const inMs = (w, iso) => { const [a, b] = msRange(w); const t = Date.parse(iso); return t >= a && t < b; };
const rate = (n, d) => (d ? n / d : null);
const uniq = (rows, f) => new Set(rows.map(f)).size;

// Which week of the month `today` is in, the Scorecard's way (goalsUi.weeksOfMonth: a week belongs to the month its
// Monday falls in; a day before the month's first Monday counts as week 1).
export function weeksIn(today) {
  const mon = laMonday(today), m0 = monthStart(today);
  let n = 0;
  for (let d = m0; d <= mon; d = addDays(d, 1)) if (laMonday(d) === d) n++;
  return Math.max(1, n);
}

// Upcoming external meetings on the synced calendars (not cancelled, ≥ 1 external domain, one per iCalUId): how many
// and the next one, from `now`.
export function upcomingExternal(events, now) {
  const seen = new Set();
  const up = events.filter(e => {
    if (e.is_cancelled || !(e.external_domains || []).length || Date.parse(e.start_at) < now) return false;
    const key = e.ical_uid || e.graph_id;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  return { upcoming: up.length, next_at: up[0] ? new Date(Date.parse(up[0].start_at)).toISOString() : null };
}

function windowValues(w, { counts, opens, deliveredAt, events, visits, people, now }) {
  const rows = counts.filter(r => inDays(w, r.day));
  const sent = sum(rows, r => r.delivered) + sum(rows, r => r.hard_bounced) + sum(rows, r => r.spam_blocked);
  const delivered = sum(rows, r => r.delivered), opened = sum(rows, r => r.opened), replied = sum(rows, r => r.replied);
  const share = humanShare(opens.filter(o => inMs(w, o.occurred_at)), deliveredAt);
  const [weekStartMs, weekEndMs] = msRange(w);
  const pulled = visits.filter(v => inDays(w, v.pulled_on));
  return {
    sent, delivered, opened, replied,
    delivered_rate: rate(delivered, sent),
    apollo_open_rate: rate(opened, delivered),
    human_share: share,
    human_open_rate: humanOpenRate({ delivered, opened, share }),
    reply_rate: rate(replied, delivered),
    meetings: countExternalMeetings({ events, weekStartMs, weekEndMs, now }).booked,
    pulled_days: uniq(pulled, v => v.pulled_on),
    visitors: uniq(pulled, v => v.pulled_on) ? uniq(pulled, v => v.company_key) : null,
    first_touched: people.filter(p => inMs(w, p.first_touch_at)).length,
  };
}

const metric = (key, kind, vals, extra = {}) => {
  const series = vals.map(v => v[key]);
  const value = series[series.length - 1], prev = series[series.length - 2];
  const delta = value == null || prev == null ? null : value - prev;
  return { value: value ?? null, prev: prev ?? null, delta, delta_pct: kind === 'count' && delta != null && prev > 0 ? delta / prev : null, series, kind, better: 'up', ...extra };
};

// goal: { goal, unit, carried } for the month of `today`, or null.
export function buildPulse({ period, today, now = Date.now(), owner = null, counts = [], opens = [], deliveredAt = new Map(), events = [], visits = [], people = [], goal = null, synced_at = null, apollo_calls = null, credits = { used: 0, cap: 0 } }) {
  const ws = windows(period, today);
  const vals = ws.map(w => windowValues(w, { counts, opens, deliveredAt, events, visits, people, now }));
  const cur = vals[vals.length - 1];
  const upcoming = upcomingExternal(events, now);
  return {
    period, label: PERIOD_LABEL[period], today, owner, from: ws[ws.length - 1].from, to: ws[ws.length - 1].to, prev: ws[ws.length - 2], windows: ws,
    synced_at, apollo_calls, credits,
    metrics: {
      sent: metric('sent', 'count', vals, { source: 'Apollo · by send date' }),
      delivered_rate: metric('delivered_rate', 'rate', vals, { delivered: cur.delivered, sent: cur.sent, source: 'delivered ÷ sent · by send date' }),
      human_open_rate: metric('human_open_rate', 'rate', vals, { apollo_open_rate: cur.apollo_open_rate, human_share: cur.human_share, opened: cur.opened, delivered: cur.delivered, source: 'tracked, bots hidden' }),
      reply_rate: metric('reply_rate', 'rate', vals, { replied: cur.replied, delivered: cur.delivered, ever: sum(counts, r => r.replied), source: 'replies ÷ delivered' }),
      meetings: metric('meetings', 'count', vals, { ...upcoming, source: 'Outlook events with an external domain', scope: owner ? 'owner' : 'team' }),
      visitors: metric('visitors', 'count', vals, { pulled_days: cur.pulled_days, source: 'companies seen · pulls look back 7 d', scope: 'team' }),
      first_touched: metric('first_touched', 'count', vals, { goal: goal?.goal ?? null, unit: goal?.unit || 'people', carried: !!goal?.carried, weeks_in: weeksIn(today), source: `${goal?.unit || 'people'} first-touched · month goal` }),
    },
  };
}
