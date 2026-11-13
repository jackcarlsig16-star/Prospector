// top-targets-v1 (rulings of Nov 13, Q1) - the Pin, pure. A pin IS the hand-set priority clamp under a new name:
// pinned_until (when it stops lifting the company), pin_reason, pinned_by, pinned_at on the three record tables.
// Nothing here reads or writes a table; the writer (pinWrite.js), the score run and the Top targets route share it.
export const PIN_DAYS = 30; // REVISABLE - the clamp's length (the score's override_days)
export const PIN_REASON_MAX = 140;
const DAY = 864e5;
const ms = v => (v ? Date.parse(v) : NaN);

// Whole-second UTC in the spelling Postgres answers with, so an event's recorded value string-equals the stored one.
export const pgStamp = d => `${new Date(d).toISOString().slice(0, 19)}+00:00`;

// A pin lifts to P1. The one exception: a priority set by hand before the rename (the migration pinned those "as
// they are") keeps the band it was set to - recognisable because that priority's date IS the pin's date.
export function pinLevel(row) {
  const dated = row?.priority != null && row?.priority_set_at;
  return dated && ms(row.priority_set_at) === ms(row.pinned_at) ? Number(row.priority) : 1;
}
export const isPinned = (row, now = Date.now()) => Number.isFinite(ms(row?.pinned_until)) && ms(row.pinned_until) > now;

// -> { until, at, by, reason, level, days_left, held } | null. held = a level below P1: the company is held AT that
// band (it can sit under its own score), so the Top targets order does not put it first.
export function pinState(row, now = Date.now()) {
  if (!isPinned(row, now)) return null;
  const level = pinLevel(row);
  return { until: row.pinned_until, at: row.pinned_at || null, by: row.pinned_by || null, reason: row.pin_reason || null, level, days_left: Math.max(0, Math.ceil((ms(row.pinned_until) - now) / DAY)), held: level > 1 };
}

// What a row's star reads. top = a live pin (filled); pin_expired = a pin that ran out and was never unpinned
// (hollow, with Renew); pinned_until rides along as the writer's expect.
export const starOf = (row, now = Date.now()) => ({ top: isPinned(row, now), pin_expired: !!row?.pinned_until && !isPinned(row, now), pinned_until: row?.pinned_until || null });

// What the score's clamp reads (intentScore's override: { priority, not_a_fit, set_at }; it expires set_at + days).
// A dated priority with no pin at all still clamps as before (partner forms can still set one).
export function pinOverride(row, now = Date.now(), days = PIN_DAYS) {
  if (isPinned(row, now)) return { priority: pinLevel(row), not_a_fit: false, set_at: new Date(ms(row.pinned_until) - days * DAY).toISOString() };
  if (!row?.pinned_until && row?.priority != null && row?.priority_set_at) return { priority: Number(row.priority), not_a_fit: false, set_at: row.priority_set_at };
  return null;
}

// The columns one action sets. type: partner | employer | target. The star / hot columns follow the pin.
export function pinPatch(row, { type, action, reason = null, userId = null, now = Date.now() }) {
  const until = pgStamp(now + PIN_DAYS * DAY);
  const flag = type === 'employer' ? 'is_top' : type === 'partner' ? 'hot' : null;
  if (action === 'pin') return { pinned_until: until, pinned_at: pgStamp(now), pinned_by: userId, pin_reason: reason, ...(flag ? { [flag]: true } : {}) };
  if (action === 'renew') return { pinned_until: until, ...(reason ? { pin_reason: reason } : {}) };
  const wasThePin = row?.priority != null && row?.priority_set_at && ms(row.priority_set_at) === ms(row.pinned_at);
  return {
    pinned_until: null, pinned_at: null, pinned_by: null, pin_reason: null, ...(flag ? { [flag]: false } : {}),
    ...(wasThePin && type !== 'target' ? { priority: null, priority_set_at: null, priority_set_by: null } : {}),
  };
}
