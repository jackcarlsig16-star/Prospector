// company-window-v4 D2 - which drawers a viewer left open on a company, per viewer (localStorage), per company: the key
// prospector_company_drawers holds { "<type>-<id>": { <section>: bool, _at: ms } }, capped at DRAWERS_CAP companies
// with the oldest-touched evicted. A missing or malformed value reads as nothing open.
export const DRAWERS_KEY = 'prospector_company_drawers';
export const DRAWERS_CAP = 200;

function readAll() {
  try {
    const v = JSON.parse(localStorage.getItem(DRAWERS_KEY) || 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

export function readDrawers(companyKey) {
  const { _at, ...sections } = readAll()[companyKey] || {};
  return Object.fromEntries(Object.entries(sections).filter(([, v]) => typeof v === 'boolean'));
}

export function writeDrawer(companyKey, section, open, now = Date.now()) {
  const all = readAll();
  all[companyKey] = { ...(all[companyKey] || {}), [section]: !!open, _at: now };
  const keys = Object.keys(all).sort((a, b) => (all[b]._at || 0) - (all[a]._at || 0));
  for (const k of keys.slice(DRAWERS_CAP)) delete all[k];
  try { localStorage.setItem(DRAWERS_KEY, JSON.stringify(all)); } catch { /* private mode */ }
  return all;
}
