import { goalsApi } from './goalsApi';

// top-targets-v1: the star IS the pin. Filled = pinned -> Unpin; hollow after the pin ran out -> Renew (30 more days);
// hollow otherwise -> Pin. A pin that ran out can also be unpinned (action 'unpin'). Returns the row patch for the screen's own list.
export const starAction = r => (r.top ? 'unpin' : r.pin_expired ? 'renew' : 'pin');
export const starLabel = r => `${r.top ? 'Unstar' : 'Star'} ${r.name}`;
export const EXPIRED_TITLE = 'Pin ran out';
export const RENEW_TITLE = 'Pin ran out - renew for 30 days';

export async function toggleStar(businessId, r, action = starAction(r)) {
  const out = await goalsApi.pinCompany(businessId, r.type, r.id, { action });
  return { top: !!out?.pin, pin_expired: false, pinned_until: out?.pin?.until ?? null };
}
