// sales-ia-v2 N1 - the Sales & Marketing tabs (Dashboard · Pipeline ·
// Actions), their sub-views, and where the selection lives: ?tab= / ?view= in
// the URL, mirrored to localStorage as a per-viewer convenience. Every older
// home (sales-ia-v1 tabs, ?gview=, prospector_goals_view) maps to its new one.
// Dashboard > Overview (sales-ia-v2 D1) holds the charts with the Goals
// section (Weekly report + Scorecard) underneath; Analytics (email + Apollo
// widgets) and Sequenced (Apollo companies by week) ride along as sub-views;
// Sources (lead-source-v1 B4) = who brought each lead, by partner / rep / office.
export const TABS = [['dashboard', 'Dashboard'], ['pipeline', 'Pipeline'], ['actions', 'Actions']];
export const SUB_VIEWS = {
  pipeline: [['companies', 'Companies'], ['priorities', 'Priorities'], ['people', 'People'], ['partners', 'Partner workflow'], ['campaigns', 'Campaigns']],
  dashboard: [['overview', 'Overview'], ['sources', 'Sources'], ['analytics', 'Analytics'], ['sequenced', 'Sequenced']],
};
export const DEFAULT_TAB = 'actions';
export const DEFAULT_VIEW = { pipeline: 'companies', dashboard: 'overview' };
// The Website visitors report moved into Pipeline as a channel (?channel=).
export const VISITOR_CHANNEL = 'website_visit';

// The v1 Dashboard sub-views Weekly report and Scorecard are the Goals section of Overview now.
const dashView = v => (['weekly', 'scorecard'].includes(v) ? 'overview' : v);
// Old tab -> [tab, view (null = keep / default), channel?]
const OLD_TABS = {
  today: () => ['actions'],
  huddle: () => ['pipeline', 'people'],
  reports: v => (v === 'visitors' ? ['pipeline', 'companies', VISITOR_CHANNEL] : ['dashboard', dashView(v)]),
  dashboard: v => ['dashboard', dashView(v)],
  pipeline: v => ['pipeline', v === 'board' ? 'companies' : v],
};
const OLD_VIEWS = { sequenced: ['dashboard', 'sequenced'] };
const LEGACY = { report: ['dashboard', 'overview'], week: ['actions'], partners: ['pipeline', 'partners'], companies: ['dashboard', 'sequenced'], pipeline: ['pipeline', 'companies'] };

// localStorage keys: prospector_sales_tab + prospector_sales_view (written
// here); prospector_goals_view is read once for the mapping, never written.
const TAB_KEY = 'prospector_sales_tab';
const VIEW_KEY = 'prospector_sales_view';
const LEGACY_KEY = 'prospector_goals_view';
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };

function upgrade(tab, view) {
  if (tab === 'pipeline' && OLD_VIEWS[view]) return OLD_VIEWS[view];
  return OLD_TABS[tab] ? OLD_TABS[tab](view) : [tab, view];
}

export function normalizeNav(tab, view) {
  const [t0, v0, channel] = upgrade(tab, view);
  const t = TABS.some(([id]) => id === t0) ? t0 : DEFAULT_TAB;
  const ids = (SUB_VIEWS[t] || []).map(([id]) => id);
  const out = { tab: t, view: ids.includes(v0) ? v0 : DEFAULT_VIEW[t] || null };
  return channel ? { ...out, channel } : out;
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
  const nav = navFrom({ tab: p.get('tab'), view: p.get('view'), gview: p.get('gview'), storedTab: read(TAB_KEY), storedView: read(VIEW_KEY), storedLegacy: read(LEGACY_KEY) });
  if (nav.channel) {
    const url = new URL(window.location.href);
    url.searchParams.set('channel', nav.channel);
    window.history.replaceState(window.history.state, '', url);
  }
  return nav;
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

// company-panel-v2 - Pipeline > People filtered to one company: ?company=<partner|employer>:<id>&cname=<name>.
export function readPeopleCompany(search = window.location.search) {
  const p = new URLSearchParams(search);
  const [type, id] = (p.get('company') || '').split(':');
  return ['partner', 'employer'].includes(type) && id ? { type, id, name: p.get('cname') || '' } : null;
}
export function writePeopleCompany(company) {
  const url = new URL(window.location.href);
  if (company) { url.searchParams.set('company', `${company.type}:${company.id}`); url.searchParams.set('cname', company.name || ''); }
  else { url.searchParams.delete('company'); url.searchParams.delete('cname'); }
  window.history.replaceState(window.history.state, '', url);
}
