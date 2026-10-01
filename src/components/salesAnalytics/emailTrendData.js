import { laDateString, laWeekStart } from './periods';
import { EMAIL_LOW_VOLUME_SENT } from './metrics.registry';

// sales-email-trend-v1 REV2 - turns stored day x mailbox counts into chart
// buckets. Rates are always computed from summed counts (never an average
// of daily rates), with SENT as the denominator.

export const RANGES = [
  { id: '30d', label: '30d', days: 30 },
  { id: '90d', label: '90d', days: 90 },
  { id: 'all', label: 'All', days: null },
];

const noon = day => new Date(`${day}T12:00:00Z`);

function addDays(day, n) {
  const d = noon(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function bucketStart(day, granularity) {
  return granularity === 'week' ? laWeekStart(noon(day)) : day;
}

export function shortDate(day) {
  return noon(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function rate(n, sent) {
  return sent > 0 ? n / sent : null;
}

// Continuous buckets from the range start to today, so a no-send stretch
// shows as an empty slot instead of silently closing up the x-axis. Rates
// are null where nothing was sent; lines break there.
export function buildBuckets(rows, { granularity, rangeId }) {
  const today = laDateString();
  const firstDay = rows.reduce((min, r) => (r.day < min ? r.day : min), today);
  const range = RANGES.find(r => r.id === rangeId);
  // Snap to the bucket start so the first bucket is never a silently
  // truncated week.
  const fromDay = bucketStart(range.days ? addDays(today, -(range.days - 1)) : firstDay, granularity);
  const step = granularity === 'week' ? 7 : 1;

  const mailboxes = [...new Set(rows.map(r => r.mailbox))].sort();
  const buckets = [];
  for (let start = bucketStart(fromDay, granularity); start <= today; start = addDays(start, step)) {
    const end = addDays(start, step - 1);
    buckets.push({
      key: start,
      start,
      end,
      label: shortDate(start),
      partial: today >= start && today <= end,
      sentByMailbox: Object.fromEntries(mailboxes.map(m => [m, 0])),
      delivered: 0, hard_bounced: 0, spam_blocked: 0, opened: 0, clicked: 0, replied: 0,
    });
  }
  const byKey = new Map(buckets.map(b => [b.key, b]));
  for (const r of rows) {
    if (r.day < fromDay) continue;
    const b = byKey.get(bucketStart(r.day, granularity));
    if (!b) continue;
    for (const f of ['delivered', 'hard_bounced', 'spam_blocked', 'opened', 'clicked', 'replied']) b[f] += r[f];
    b.sentByMailbox[r.mailbox] += r.delivered + r.hard_bounced + r.spam_blocked;
  }
  for (const b of buckets) {
    b.sent = b.delivered + b.hard_bounced + b.spam_blocked;
    b.lowVolume = b.sent > 0 && b.sent < EMAIL_LOW_VOLUME_SENT;
    b.rates = {
      hardBounce: rate(b.hard_bounced, b.sent),
      spamBlock: rate(b.spam_blocked, b.sent),
      totalBounce: rate(b.hard_bounced + b.spam_blocked, b.sent),
      open: rate(b.opened, b.sent),
      reply: rate(b.replied, b.sent),
      click: rate(b.clicked, b.sent),
    };
    b.counts = {
      hardBounce: b.hard_bounced, spamBlock: b.spam_blocked, totalBounce: b.hard_bounced + b.spam_blocked,
      open: b.opened, reply: b.replied, click: b.clicked,
    };
  }
  return { buckets, mailboxes };
}

export function pct(v, digits = 1) {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`;
}
