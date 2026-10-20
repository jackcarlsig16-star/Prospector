// sales-ia-v1 - the four Goals & Sales tabs, their sub-views, and where the
// selection lives: ?tab= / ?view= in the URL, mirrored to localStorage as a
// per-viewer convenience. Old ?gview= links and a stored prospector_goals_view
// map to the new homes (Design E) and the old key is dropped on first write.
export const TABS = [['today', 'Today'], ['pipeline', 'Pipeline'], ['huddle', 'Huddle'], ['reports', 'Reports']];
export const SUB_VIEWS = {
  pipeline: [['board', 'Board'], ['partners', 'Partner workflow'], ['sequenced', 'Sequenced']],
  reports: [['weekly', 'Weekly report'], ['scorecard', 'Scorecard'], ['analytics', 'Analytics'], ['visitors', 'Website visitors']],
};
export const DEFAULT_VIEW = { pipeline: 'board', reports: 'weekly' };
const LEGACY = { report: ['reports', 'weekly'], week: ['today'], partners: ['pipeline', 'partners'], companies: ['pipeline', 'sequenced'], pipeline: ['pipeline', 'board'] };

// localStorage keys: prospector_sales_tab + prospector_sales_view (written
// here); prospector_goals_view is read once for the mapping, never written.
const TAB_KEY = 'prospector_sales_tab';
const VIEW_KEY = 'prospector_sales_view';
const LEGACY_KEY = 'prospector_goals_view';
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };

export function normalizeNav(tab, view) {
  const t = TABS.some(([id]) => id === tab) ? tab : 'today';
  const ids = (SUB_VIEWS[t] || []).map(([id]) => id);
  return { tab: t, view: ids.includes(view) ? view : DEFAULT_VIEW[t] || null };
}

// URL ?tab= wins, then an old ?gview=, then what this browser last showed
// (new keys first, the old Goals view only while no new key exists).
export function navFrom({ tab, view, gview, storedTab, storedView, storedLegacy }) {
  if (tab) return normalizeNav(tab, view);
  const legacy = LEGACY[gview] || (!storedTab && LEGACY[storedLegacy]);
  if (legacy) return normalizeNav(legacy[0], legacy[1]);
  return normalizeNav(storedTab, storedView);
}

export function readNav() {
  const p = new URLSearchParams(window.location.search);
  return navFrom({ tab: p.get('tab'), view: p.get('view'), gview: p.get('gview'), storedTab: read(TAB_KEY), storedView: read(VIEW_KEY), storedLegacy: read(LEGACY_KEY) });
}

export function writeNav(tab, view) {
  try {
    localStorage.setItem(TAB_KEY, tab);
    if (view) localStorage.setItem(VIEW_KEY, view); else localStorage.removeItem(VIEW_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* private mode */ }
  const url = new URL(window.location.href);
  url.searchParams.set('tab', tab);
  if (view) url.searchParams.set('view', view); else url.searchParams.delete('view');
  url.searchParams.delete('gview');
  window.history.replaceState(window.history.state, '', url);
}
