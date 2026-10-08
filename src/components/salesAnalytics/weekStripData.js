import { laWeekStart } from './periods';
import { shortDate } from './emailTrendData';
import { getMetric, EMAIL_LOW_VOLUME_SENT } from './metrics.registry';

// overview-home-v1 Stage 1 - the week strip's numbers, from stored rows
// only: Apollo's day x mailbox counts (GET /email-counts) for the full
// population, the tracked half (GET /week-strip) for the human-open and
// real-reply estimates, partner events for meetings. Every rate is a ratio
// of range sums, never an average of daily rates. Opens and replies are
// over DELIVERED (Jack 2026-10-08: comparable to what Apollo shows Seif);
// delivered %, bounce % and spam are over SENT, as the trend chart has them.
// Stage 2: the same math per sender (mailbox table). (Named *Data, not
// weekStrip.js: macOS would merge that with WeekStrip.js.)

export const SPARK_WEEKS = 8;
// Presets whose counts the strip shows as per-week averages.
export const PER_WEEK = { four_weeks: 4 };

const EMAIL_FIELDS = ['delivered', 'hard_bounced', 'spam_blocked', 'opened', 'clicked', 'replied'];
const TRACKED_FIELDS = ['tracked_delivered', 'tracked_opens', 'tracked_bot_opens', 'tracked_replies', 'tracked_real_replies', 'meetings'];

export const TILES = [
  { id: 'sent', metric: 'sent', label: 'Sent', format: 'number', drill: 'email_trend' },
  { id: 'delivered_rate', metric: 'delivered_rate', label: 'Delivered', format: 'percent', drill: 'email_trend' },
  { id: 'bounce_rate', metric: 'bounce_rate', label: 'Bounce', format: 'percent', drill: 'email_trend', health: true },
  { id: 'spam_blocked', metric: 'spam_blocked', label: 'Spam blocks', format: 'number', drill: 'email_trend' },
  { id: 'open_rate', metric: 'open_rate', label: 'Open rate', format: 'percent', drill: 'email_trend' },
  { id: 'reply_rate', metric: 'reply_rate', label: 'Reply rate', format: 'percent', drill: 'email_trend' },
  { id: 'meetings', metric: 'meetings_set', label: 'Meetings set', format: 'number', drill: 'goals' },
];

export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const rate = (n, d) => (d > 0 ? n / d : null);

export function rangeTotals(data, from, to) {
  const t = Object.fromEntries([...EMAIL_FIELDS, ...TRACKED_FIELDS].map(f => [f, 0]));
  for (const r of data.emailRows) if (r.day >= from && r.day <= to) for (const f of EMAIL_FIELDS) t[f] += r[f] || 0;
  for (const d of data.days) if (d.day >= from && d.day <= to) for (const f of TRACKED_FIELDS) t[f] += d[f] || 0;
  t.sent = t.delivered + t.hard_bounced + t.spam_blocked;
  const manual = data.manualMeetings.filter(m => m.week_start >= from && m.week_start <= to);
  t.manual_meetings = manual.length ? manual.reduce((n, m) => n + m.actual, 0) : null;
  return t;
}

export function tileValues(t) {
  const openRate = rate(t.opened, t.delivered);
  const humanShare = t.tracked_opens > 0 ? 1 - t.tracked_bot_opens / t.tracked_opens : null;
  return {
    sent: t.sent,
    delivered_rate: rate(t.delivered, t.sent),
    bounce_rate: rate(t.hard_bounced, t.sent),
    spam_blocked: t.spam_blocked,
    open_rate: openRate,
    reply_rate: rate(t.replied, t.delivered),
    meetings: t.meetings,
    detail: {
      sent: t.sent, delivered: t.delivered, hard_bounced: t.hard_bounced, opened: t.opened, replied: t.replied,
      human_share: humanShare,
      human_open_rate: openRate !== null && humanShare !== null ? openRate * humanShare : null,
      tracked_opens: t.tracked_opens, tracked_bot_opens: t.tracked_bot_opens,
      tracked_replies: t.tracked_replies, tracked_real_replies: t.tracked_real_replies,
      manual_meetings: t.manual_meetings,
      low_volume: t.sent > 0 && t.sent < EMAIL_LOW_VOLUME_SENT,
    },
  };
}

// The SPARK_WEEKS LA weeks ending with the week that holds `to`.
export function sparkWeeks(to) {
  const last = laWeekStart(new Date(`${to}T12:00:00Z`));
  return Array.from({ length: SPARK_WEEKS }, (_, i) => addDays(last, (i - SPARK_WEEKS + 1) * 7));
}

export function weeklySeries(data, to) {
  return sparkWeeks(to).map(week => ({ week, label: shortDate(week), values: tileValues(rangeTotals(data, week, addDays(week, 6))) }));
}

// "This week" compares like for like: the same weekdays of last week, not
// the header's equal-length window that ends on Sunday (Mon-Thu vs Thu-Sun).
export function compareRange(period, prevPeriod, preset) {
  if (preset !== 'this_week') return prevPeriod;
  return { from: addDays(period.from, -7), to: addDays(period.to, -7) };
}

// period / prevPeriod: the header picker's { from, to }. Deltas only with
// compare on, and only when both sides have a value. perWeek (4-week avg):
// counts are divided, rates are not.
export function buildStrip(data, { period, prevPeriod, compareEnabled, perWeek = null }) {
  const current = tileValues(rangeTotals(data, period.from, period.to));
  const previous = compareEnabled && prevPeriod ? tileValues(rangeTotals(data, prevPeriod.from, prevPeriod.to)) : null;
  const series = weeklySeries(data, period.to);
  return TILES.map(tile => {
    const scale = v => (v === null || !perWeek || tile.format !== 'number' ? v : Math.round(v / perWeek));
    const value = scale(current[tile.id]);
    const prev = previous ? scale(previous[tile.id]) : null;
    // A change that rounds to 0.0 pts is no change, not a red or green arrow.
    const raw = value !== null && prev !== null ? value - prev : null;
    const delta = raw !== null && tile.format === 'percent' && Math.abs(raw) < 0.0005 ? 0 : raw;
    const goodDirection = getMetric(tile.metric).goodDirection;
    return {
      ...tile, value, delta, perWeek,
      deltaGood: delta === null || delta === 0 ? null : goodDirection === 'down' ? delta < 0 : delta > 0,
      points: series.map(s => ({ x: s.week, label: s.label, y: s.values[tile.id] })),
      detail: current.detail,
    };
  });
}

// Per sender, over one range: Apollo's counts by mailbox plus the tracked
// human share by sender (the same address). last_send_day looks at all history.
export function perSender(data, from, to) {
  const boxes = new Map();
  const box = m => { if (!boxes.has(m)) boxes.set(m, { mailbox: m, ...Object.fromEntries(EMAIL_FIELDS.map(f => [f, 0])), tracked_opens: 0, tracked_bot_opens: 0, tracked_replies: 0, tracked_real_replies: 0, last_send_day: null }); return boxes.get(m); };
  for (const r of data.emailRows) {
    const b = box(r.mailbox);
    if (r.delivered > 0 && (!b.last_send_day || r.day > b.last_send_day)) b.last_send_day = r.day;
    if (r.day >= from && r.day <= to) for (const f of EMAIL_FIELDS) b[f] += r[f] || 0;
  }
  for (const s of data.senders || []) {
    if (s.day < from || s.day > to) continue;
    const b = box(s.sender);
    for (const f of ['tracked_opens', 'tracked_bot_opens', 'tracked_replies', 'tracked_real_replies']) b[f] += s[f] || 0;
  }
  return [...boxes.values()].map(b => {
    const sent = b.delivered + b.hard_bounced + b.spam_blocked;
    const openRate = rate(b.opened, b.delivered);
    const share = b.tracked_opens > 0 ? 1 - b.tracked_bot_opens / b.tracked_opens : null;
    return {
      ...b, sent,
      delivered_rate: rate(b.delivered, sent), bounce_rate: rate(b.hard_bounced, sent), open_rate: openRate, reply_rate: rate(b.replied, b.delivered),
      human_share: share, human_open_rate: openRate !== null && share !== null ? openRate * share : null,
    };
  }).sort((a, b) => b.sent - a.sent || a.mailbox.localeCompare(b.mailbox));
}

export function formatDelta(delta, format) {
  if (delta === null) return '—';
  const arrow = delta >= 0 ? '▲' : '▼';
  const n = Math.abs(delta);
  return format === 'percent' ? `${arrow} ${(n * 100).toFixed(1)} pts` : `${arrow} ${n.toLocaleString('en-US')}`;
}
