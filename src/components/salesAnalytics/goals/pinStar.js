import { goalsApi } from './goalsApi';

// top-targets-v1: the star IS the pin. Filled = pinned -> Unpin; hollow after the pin ran out -> Renew (30 more days);
// hollow otherwise -> Pin. A pin that ran out can also be unpinned (action 'unpin').
export const starAction = r => (r.top ? 'unpin' : r.pin_expired ? 'renew' : 'pin');
export const starLabel = r => `${r.top ? 'Unstar' : 'Star'} ${r.name}`;
export const EXPIRED_TITLE = 'Pin ran out';
const DONE = { pin: 'Pinned', renew: 'Pin renewed for 30 days', unpin: 'Unpinned', reason: 'Pin reason saved' };
const starFields = r => ({ top: !!r.top, pin_expired: !!r.pin_expired, pinned_until: r.pinned_until ?? null, pin_reason: r.pin_reason ?? null });

// The company window's pin control (the star's reason popover): one pin write from a screen that keeps its own rows -> { patch (the row's star fields now), text (the done line),
// undo() -> the star fields to put back }. expect = the pinned_until the screen showed.
export async function pinAct(businessId, r, action = starAction(r), reason = null) {
  const before = starFields(r);
  const out = await goalsApi.pinCompany(businessId, r.type, r.id, { action, ...(reason ? { reason } : {}), expect: { pinned_until: before.pinned_until } });
  const undo = out?.undo && (async () => {
    if (out.undo.kind === 'partner') await goalsApi.partnerUndo(businessId, r.id, out.undo.id); else await goalsApi.undoFlow(businessId, out.undo.id);
    return before;
  });
  return { patch: { top: !!out?.pin, pin_expired: false, pinned_until: out?.pin?.until ?? null, pin_reason: out?.pin?.reason ?? null }, text: `${r.name}: ${DONE[action]}`, undo: undo || null };
}
// The table stars' one-click toggle (no reason, no expect) -> the row patch for the screen's own list.
export async function toggleStar(businessId, r, action = starAction(r)) {
  const out = await goalsApi.pinCompany(businessId, r.type, r.id, { action });
  return { top: !!out?.pin, pin_expired: false, pinned_until: out?.pin?.until ?? null, pin_reason: out?.pin?.reason ?? null };
}
