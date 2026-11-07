// scout-v2 REV3 B7 (REV2 D2) - where a Scout record lands. The server hands every item an opener:
//   { page: 'sales', params: { tab, view?, open? } }  open = '<type>-<id>' (the company window), 'person:<key>' (People),
//                                                      'todo:<id>' (Actions), 'note:' / 'insight:' (no reader: inline)
//   { page: 'accounts', params: { account } } · { page: 'business-intel' } · { page: <module>, hash } (its own routes)
// inline: true = no page reads that key, so the item opens its list AND Scout shows the record itself.
// The params go into the URL (a page that mounts now reads them); a page already on screen hears SCOUT_OPEN.
export const SCOUT_OPEN = 'prospector:scout-open';
const PARAMS = ['tab', 'view', 'open', 'account'];
const STALE = ['company', 'cname', 'channel', 'gview'];
export const PAGE_OF = { sales: 'sales-analytics', accounts: 'accounts', 'business-intel': 'overview' };

export function writeOpenParams(params = {}) {
  const u = new URL(window.location.href);
  for (const k of [...PARAMS, ...STALE]) u.searchParams.delete(k);
  for (const k of PARAMS) if (params[k]) u.searchParams.set(k, params[k]);
  window.history.replaceState(window.history.state, '', u);
}

// ?open=<prefix>:<key> -> key (People: person:<person key>, Actions: todo:<id>).
export const openKeyOf = (prefix, value) => (typeof value === 'string' && value.startsWith(`${prefix}:`) ? value.slice(prefix.length + 1) || null : null);
export const readOpenKey = (prefix, search = window.location.search) => openKeyOf(prefix, new URLSearchParams(search).get('open'));
export const readAccountParam = (search = window.location.search) => new URLSearchParams(search).get('account') || null;
export function clearUrlParam(name) {
  const u = new URL(window.location.href);
  if (!u.searchParams.has(name)) return;
  u.searchParams.delete(name);
  window.history.replaceState(window.history.state, '', u);
}
// A page already on screen: fn(params) for every Scout open. Returns the unsubscribe.
export function onScoutOpen(fn) {
  const h = e => fn(e.detail?.params || {});
  window.addEventListener(SCOUT_OPEN, h);
  return () => window.removeEventListener(SCOUT_OPEN, h);
}
export const announceOpen = opener => window.dispatchEvent(new CustomEvent(SCOUT_OPEN, { detail: opener }));
