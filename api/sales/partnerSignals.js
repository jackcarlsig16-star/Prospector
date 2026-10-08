import { laDateString } from './laDate.js';
import { addDays, isDate, laStartOfDayMs } from './goalsShared.js';
import { PIPELINE_STATUS_IDS, TOUCH_STATUSES, TOUCH_TYPE_IDS, touchStageMove } from '../../src/constants/partnerPipeline.js';

// sales-partners-pipeline-v1 Stage 2 - the one way a partner's pipeline state
// changes. The Partners buttons call it through partnersRoutes.js; Outlook
// detection (microsoft-connect-v1) will call it too, with by_user = null.
//
// Every signal writes exactly one sales_partner_events row. meta.prev holds
// the previous value of every sales_goals field the signal changed, so undo
// restores exactly what was there - including stamps like first_email_at.
//
// Signals:
//   { type: 'status', to: <pipeline_status> }   stamps last_touch_at on touch
//                                                statuses; first_email_at on
//                                                first_email_sent if empty
//   { type: 'assign', owner_user_id }            caller validates membership
//   { type: 'hot', hot: true|false }
//   { type: 'snooze', days?: 1-90 (default 7) }
//   { type: 'deprioritize' }                     -> pipeline_status 'paused'
//   { type: 'note', note }                       history only, not a touch
//   { type: 'touch', touch_type, date, contacts?, note?, move_to? }
//                                                partner-touch-log-v1: an email/
//                                                call/... that happened on date
//                                                (LA day, today or earlier). The
//                                                event is dated then; stage per
//                                                touchStageMove, never backwards.
//
// status, deprioritize and touch take an optional expect: the pipeline_status the
// caller's screen showed. If the partner has moved since (a teammate's
// click), the signal is refused with 409 instead of moving it from a stage
// the caller never saw - e.g. "Next: Mark sent" can't drag a Replied
// partner back to Sent (sales-partners-workflow-v1).

export const SIGNAL_TYPES = ['status', 'assign', 'hot', 'snooze', 'deprioritize', 'note', 'touch'];
export const UNDO_WINDOW_MS = 2 * 60e3; // client shows 5s; the slack covers slow networks
const NOTE_MAX = 2000;
const CONTACTS_MAX = 10, CONTACT_NAME_MAX = 80;

export class SignalError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const CHANGED = 'This partner was just changed by someone else - refresh and try again';

// When a touch on that LA day happened: now if it's today, else midday -
// clear of either edge of the day, so it lands in the right week.
export function touchTime(date, now) {
  return date === laDateString(now) ? now : new Date(laStartOfDayMs(date) + 12 * 3600e3);
}

const later = (a, b) => (!a || Date.parse(b) > Date.parse(a) ? b : a);

function planTouch(goal, signal, now) {
  if (!TOUCH_TYPE_IDS.includes(signal.touch_type)) throw new SignalError(`touch_type must be one of ${TOUCH_TYPE_IDS.join('|')}`);
  if (!isDate(signal.date)) throw new SignalError('date must be YYYY-MM-DD');
  if (signal.date > laDateString(now)) throw new SignalError("date can't be in the future");
  const contacts = signal.contacts ?? [];
  if (!Array.isArray(contacts) || contacts.length > CONTACTS_MAX || !contacts.every(c => typeof c === 'string')) {
    throw new SignalError(`contacts must be a list of up to ${CONTACTS_MAX} names`);
  }
  const seen = new Set();
  const names = contacts.map(c => c.trim().replace(/\s+/g, ' ')).filter(c => c && !seen.has(c.toLowerCase()) && seen.add(c.toLowerCase()));
  if (names.some(c => c.length > CONTACT_NAME_MAX)) throw new SignalError(`a contact name must be at most ${CONTACT_NAME_MAX} characters`);
  const note = typeof signal.note === 'string' ? signal.note.trim() : '';
  if (signal.note != null && typeof signal.note !== 'string') throw new SignalError('note must be text');
  if (note.length > NOTE_MAX) throw new SignalError(`note must be at most ${NOTE_MAX} characters`);
  const moveTo = signal.move_to ?? 'auto';
  if (moveTo !== 'auto' && moveTo !== 'none' && !PIPELINE_STATUS_IDS.includes(moveTo)) throw new SignalError(`move_to must be auto, none or one of ${PIPELINE_STATUS_IDS.join('|')}`);
  const to = touchStageMove(goal.pipeline_status, signal.touch_type, moveTo);
  if (to?.error) throw new SignalError(to.error, 409);

  const at = touchTime(signal.date, now).toISOString();
  const patch = {};
  if (to) patch.pipeline_status = to;
  // A backdated touch never pulls the last-touch stamp back in time.
  const touchAt = later(goal.last_touch_at, at);
  if (touchAt !== goal.last_touch_at) patch.last_touch_at = touchAt;
  if ((signal.touch_type === 'email' || to === 'first_email_sent') && (!goal.first_email_at || signal.date < goal.first_email_at)) patch.first_email_at = signal.date;
  return {
    patch,
    event: { event: 'touch', from_status: to ? goal.pipeline_status : null, to_status: to, note: note || null, touch_type: signal.touch_type, contact_names: names, at },
  };
}

export function plan(goal, signal, now) {
  const today = laDateString(now);
  if (['status', 'deprioritize', 'touch'].includes(signal?.type) && signal.expect !== undefined && (goal.pipeline_status || 'not_started') !== signal.expect) {
    throw new SignalError(CHANGED, 409);
  }
  switch (signal?.type) {
    case 'status': {
      if (!PIPELINE_STATUS_IDS.includes(signal.to)) throw new SignalError(`to must be one of ${PIPELINE_STATUS_IDS.join('|')}`);
      if (signal.to === goal.pipeline_status) throw new SignalError(`already ${signal.to}`, 409);
      const patch = { pipeline_status: signal.to };
      if (TOUCH_STATUSES.includes(signal.to)) patch.last_touch_at = now.toISOString();
      if (signal.to === 'first_email_sent' && !goal.first_email_at) patch.first_email_at = today;
      return { patch, event: { event: 'status', from_status: goal.pipeline_status, to_status: signal.to } };
    }
    case 'deprioritize':
      if (goal.pipeline_status === 'paused') throw new SignalError('already paused', 409);
      return { patch: { pipeline_status: 'paused' }, event: { event: 'deprioritize', from_status: goal.pipeline_status, to_status: 'paused' } };
    case 'assign':
      if (signal.owner_user_id !== null && typeof signal.owner_user_id !== 'string') throw new SignalError('owner_user_id must be a user id or null');
      if (signal.owner_user_id === goal.owner_user_id) throw new SignalError('already assigned to them', 409);
      return { patch: { owner_user_id: signal.owner_user_id }, event: { event: 'assign', meta: { to_owner: signal.owner_user_id } } };
    case 'hot':
      if (typeof signal.hot !== 'boolean') throw new SignalError('hot must be true or false');
      if (signal.hot === goal.hot) throw new SignalError(`already ${signal.hot ? 'hot' : 'not hot'}`, 409);
      return { patch: { hot: signal.hot }, event: { event: 'hot', meta: { hot: signal.hot } } };
    case 'snooze': {
      const days = signal.days ?? 7;
      if (!Number.isInteger(days) || days < 1 || days > 90) throw new SignalError('days must be a whole number from 1 to 90');
      const until = addDays(today, days);
      return { patch: { snoozed_until: until }, event: { event: 'snooze', meta: { until } } };
    }
    case 'note': {
      const note = typeof signal.note === 'string' ? signal.note.trim() : '';
      if (!note) throw new SignalError('note must be non-empty text');
      if (note.length > NOTE_MAX) throw new SignalError(`note must be at most ${NOTE_MAX} characters`);
      return { patch: {}, event: { event: 'note', note } };
    }
    case 'touch':
      return planTouch(goal, signal, now);
    default:
      throw new SignalError(`type must be one of ${SIGNAL_TYPES.join('|')}`);
  }
}

async function partnerOrThrow(supabase, businessId, goalId) {
  const { data, error } = await supabase.from('sales_goals').select('*')
    .eq('business_id', businessId).eq('id', goalId).eq('goal_type', 'partnership').maybeSingle();
  if (error) throw new SignalError(error.message, 500);
  if (!data) throw new SignalError('partner not found', 404);
  return data;
}

// Only applies when every field it changes still holds the value this
// request read - a teammate's click in between makes it a 409, not a silently
// lost update (and keeps meta.prev true, so undo restores the right value).
function unchanged(query, goal, fields) {
  for (const k of fields) query = goal[k] === null || goal[k] === undefined ? query.is(k, null) : query.eq(k, goal[k]);
  return query;
}

async function write(supabase, goal, patch, event) {
  let updated = goal;
  if (Object.keys(patch).length) {
    const { data, error } = await unchanged(supabase.from('sales_goals')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', goal.id), goal, Object.keys(patch)).select();
    if (error) throw new SignalError(error.message, 500);
    if (!data.length) throw new SignalError(CHANGED, 409);
    updated = data[0];
  }
  const { data: row, error } = await supabase.from('sales_partner_events')
    .insert({ business_id: goal.business_id, goal_id: goal.id, ...event }).select().single();
  if (error) {
    // Keep state and history in step: no event row, no change.
    if (Object.keys(patch).length) {
      const back = Object.fromEntries(Object.keys(patch).map(k => [k, goal[k]]));
      await supabase.from('sales_goals').update(back).eq('id', goal.id);
    }
    throw new SignalError(error.message, 500);
  }
  return { goal: updated, event: row };
}

// source / meta are server-side only: the signal route never reads them
// from the body, so a browser can't label its own click "from Apollo".
export async function applyPartnerSignal(supabase, { businessId, goalId, signal, byUser = null, now = new Date(), source = 'manual', meta = {} }) {
  const goal = await partnerOrThrow(supabase, businessId, goalId);
  const { patch, event } = plan(goal, signal, now);
  const prev = Object.fromEntries(Object.keys(patch).map(k => [k, goal[k] ?? null]));
  return write(supabase, goal, patch, { ...event, source, meta: { ...meta, ...(event.meta || {}), prev }, by_user: byUser });
}

// Undo = the goal's latest-recorded event, not itself an undo, within the
// window. Recorded, not dated: a touch logged for last week is still the
// last thing done.
// Restores meta.prev and records an 'undo' event pointing at it.
export async function undoPartnerSignal(supabase, { businessId, goalId, eventId, byUser = null, now = new Date() }) {
  const goal = await partnerOrThrow(supabase, businessId, goalId);
  const { data: latest, error } = await supabase.from('sales_partner_events').select('*')
    .eq('goal_id', goal.id).order('recorded_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new SignalError(error.message, 500);
  if (!latest || latest.id !== eventId) throw new SignalError('only the latest change on this partner can be undone', 409);
  if (latest.event === 'undo') throw new SignalError('that change was already undone', 409);
  // An automatic move (Apollo / Outlook) stays undoable while it is still the
  // last thing that happened to the partner; only hand-made changes expire.
  if (latest.source === 'manual' && now - Date.parse(latest.recorded_at) > UNDO_WINDOW_MS) throw new SignalError('too late to undo', 409);
  const restore = latest.meta?.prev || {};
  const drift = Object.keys(restore).find(k => k !== 'last_touch_at' && k !== 'first_email_at' && String(goal[k] ?? '') !== String(eventResult(latest, k) ?? ''));
  if (drift) throw new SignalError(`${drift} changed since - undo skipped`, 409);
  return write(supabase, goal, restore, {
    event: 'undo', from_status: latest.to_status, to_status: latest.from_status,
    meta: { undid: latest.id, undid_event: latest.event, prev: Object.fromEntries(Object.keys(restore).map(k => [k, goal[k] ?? null])) },
    by_user: byUser,
  });
}

// The value an event set a field to, read back from what was recorded.
function eventResult(ev, key) {
  if (key === 'pipeline_status') return ev.to_status;
  if (key === 'owner_user_id') return ev.meta?.to_owner ?? null;
  if (key === 'hot') return ev.meta?.hot;
  if (key === 'snoozed_until') return ev.meta?.until;
  return undefined;
}
