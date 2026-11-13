import { getSupabase } from './goalsShared.js';
import { RECORD_TABLE } from './leadSource.js';
import { cleanText, hasPii } from './scrubText.js';
import { logFlow } from './flowEvents.js';
import { applyPartnerSignal, SignalError } from './partnerSignals.js';
import { scheduleRecompute } from './intentScoreRun.js';
import { pinState, pinPatch, isPinned, PIN_REASON_MAX } from './pinState.js';

// top-targets-v1 Q1 - the ONE writer of a pin. Pin / Renew / Unpin on a partner, an employer or a target:
//   employer / target  a guarded update + one sales_flow_events row (prev + set), undone by POST goals/flow/:id/undo
//   partner            the existing 'hot' signal (hot = pinned): its event row, undone by the partner undo route
// A pin lifts the company to P1 for 30 days (the score's clamp reads it - pinState.js); it never moves a stage or an
// owner. expect = the pinned_until the screen showed (null = not pinned): a mismatch is a 409, nothing written.
export const PIN_ACTIONS = ['pin', 'renew', 'unpin'];
const NAME_COL = { partner: 'name', employer: 'organization', target: 'name' };
const PIN_COLS = 'pinned_until, pin_reason, pinned_by, pinned_at';
const EXTRA_COLS = { partner: ', hot, priority, priority_set_at, priority_set_by', employer: ', is_top, priority, priority_set_at, priority_set_by', target: '' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (status, error, extra = {}) => Object.assign(new Error(error), { status, ...extra });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const sameTime = (a, b) => (a ? Date.parse(a) : null) === (b ? Date.parse(b) : null);
const TEXT = { pin: (n, r) => `Pinned${r ? ` · ${r}` : ''}`, renew: () => 'Pin renewed for 30 days', unpin: () => 'Unpinned' };

export function validReason(v) {
  if (v == null || v === '') return { value: null };
  if (typeof v !== 'string') return { error: 'reason must be text' };
  const s = v.trim().replace(/\s+/g, ' ');
  if (s.length > PIN_REASON_MAX) return { error: `reason must be at most ${PIN_REASON_MAX} characters` };
  if (hasPii(s)) return { error: "reason can't hold an email address or phone number" };
  return { value: cleanText(s, PIN_REASON_MAX) || null };
}

// -> 200 { pin: pinState | null, name, event: { id }, undo: { kind: 'flow' | 'partner', id } }
export async function applyPin(supabase, { businessId, userId = null, type, id, body = {}, now = new Date() }) {
  const { action, expect = undefined } = body || {};
  if (!RECORD_TABLE[type]) return reply(400, { error: 'type must be partner|employer|target' });
  if (!PIN_ACTIONS.includes(action)) return reply(400, { error: `action must be one of ${PIN_ACTIONS.join('|')}` });
  if (!UUID.test(id || '')) return reply(404, { error: `${type} not found` });
  const reason = validReason(body?.reason);
  if (reason.error) return reply(400, { error: reason.error });
  try {
    const q = supabase.from(RECORD_TABLE[type]).select(`id, ${NAME_COL[type]}, ${PIN_COLS}${EXTRA_COLS[type]}`).eq('business_id', businessId).eq('id', id);
    const row = must(await (type === 'partner' ? q.eq('goal_type', 'partnership') : type === 'employer' ? q.is('archived_at', null) : q).maybeSingle());
    if (!row) return reply(404, { error: `${type} not found` });
    const name = row[NAME_COL[type]];
    if (expect !== undefined && !sameTime(expect?.pinned_until ?? null, row.pinned_until)) return reply(409, { error: `${name}'s pin changed since you opened this - reloaded`, code: 'changed', pin: pinState(row, now.getTime()) });
    const pinned = isPinned(row, now.getTime());
    if (action === 'pin' && pinned) return reply(409, { error: `${name} is already pinned - renew it instead`, code: 'pinned' });
    if (action !== 'pin' && !row.pinned_until) return reply(409, { error: `${name} is not pinned`, code: 'not_pinned' });
    const patch = pinPatch(row, { type, action, reason: reason.value, userId, now: now.getTime() });

    if (type === 'partner') {
      const signal = action === 'unpin' ? { type: 'hot', hot: false } : { type: 'hot', hot: true, renew: action === 'renew', reason: reason.value };
      const out = await applyPartnerSignal(supabase, { businessId, goalId: id, signal, byUser: userId, now });
      scheduleRecompute(supabase, businessId, 'signal');
      return reply(200, { pin: pinState(out.goal, now.getTime()), name, event: { id: out.event.id }, undo: { kind: 'partner', id: out.event.id } });
    }
    const guard = supabase.from(RECORD_TABLE[type]).update({ ...patch, updated_at: now.toISOString() }).eq('business_id', businessId).eq('id', id);
    const rows = must(await (row.pinned_until == null ? guard.is('pinned_until', null) : guard.eq('pinned_until', row.pinned_until)).select(`id, ${PIN_COLS}${EXTRA_COLS[type]}`));
    if (!rows.length) return reply(409, { error: `${name}'s pin changed since you opened this - reloaded`, code: 'changed' });
    const prev = Object.fromEntries(Object.keys(patch).map(k => [k, row[k] ?? null]));
    const event = await logFlow(supabase, { businessId, recordType: type, recordId: id, kind: action === 'renew' ? 'pin_renew' : action, text: TEXT[action](name, reason.value), prev, set: patch, meta: { name }, byUser: userId, now });
    scheduleRecompute(supabase, businessId, 'signal');
    return reply(200, { pin: pinState(rows[0], now.getTime()), name, event: { id: event.id }, undo: { kind: 'flow', id: event.id } });
  } catch (e) {
    if (e instanceof SignalError || (e.status && e.status < 500)) return reply(e.status || 400, { error: e.message, ...(e.code ? { code: e.code } : {}) });
    console.error('[company/pin]', e.message);
    return reply(500, { error: e.message });
  }
}

// POST goals/company/:type/:id/pin { action: pin | renew | unpin, reason?, expect?: { pinned_until } } (Member)
export async function pinRoute(req, res) {
  const r = await applyPin(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, type: req.params.type, id: req.params.id, body: req.body });
  res.status(r.status).json(r.body);
}
