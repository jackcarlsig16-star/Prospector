import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_TYPE, SA_SHAPE, SA_THEME_CSS, SA_THEME_ROOT_ID, saSans } from './theme';
import { ui } from '../../ui/kitTheme';
import { KIT_MAX_WIDTH } from '../../ui/tokens';
import AnalyticsView from './AnalyticsView';
import DailyHuddle from './DailyHuddle';
import GoalsTab, { homeOf } from './goals/GoalsTab';
import { OPEN_GOALS_WEEK } from './goals/goalsApi';
import { roleAtLeast } from '../../constants/roles';
import { fetchFlags, FLAGS_CHANGED } from './huddleApi';
import { fetchMe } from '../../utils/authSession';
import { TABS, DEFAULT_VIEW, readNav, writeNav, normalizeNav } from './salesNav';

// dashboard-v2 Stage 5 - the "print only this area" trick: hide
// everything on the page, then re-show only #sales-analytics-print-area
// and its descendants. Zero changes needed to Sidebar.js/
// the Scout bar - this app has no CSS classes anywhere (every component
// uses inline styles), so an opt-out approach (hide the sidebar
// specifically) would mean touching several unrelated files; this
// opt-in approach needs exactly one wrapper id instead.
// break-inside/page-break-inside: avoid on .print-avoid-break keeps a
// chart or table row from splitting across a page. print-color-adjust:
// exact keeps the real cohort/semantic colors on the printed page instead
// of browsers defaulting to grayscale-friendly stripping.
// sales-ia-v1: this <style> stays mounted on every tab - the Weekly report
// (Reports), the Huddle agenda and Analytics each mount their own
// #sales-analytics-print-area, one at a time.
const PRINT_STYLES = `
  .print-only { display: none; }
  @media print {
    /* Links on numbers (goals-surface-v1) print as plain numbers. */
    .sa-drill { text-decoration: none !important; }
    /* The app's global body background is dark (constants/tokens.js HUD
       theme) and "body * { visibility: hidden }" below only hides body's
       DESCENDANTS, never body itself - found while actually reading the
       rendered PDF: any page space the absolutely-positioned print area
       doesn't cover showed that dark background through as a stark black
       block, invisible as a bug on the old dark-on-dark PDF but glaring
       now that the print theme is white. */
    body { background: #FFFFFF; }
    /* Hidden (visibility) chrome still takes up height and printed trailing
       blank pages; collapse it. The print area is absolutely positioned
       against the page, so it isn't clipped. */
    #root { height: 0 !important; overflow: hidden !important; }
    body * { visibility: hidden; }
    #sales-analytics-print-area, #sales-analytics-print-area * { visibility: visible; }
    #sales-analytics-print-area { position: absolute; left: 0; top: 0; width: 100%; }
    .no-print { display: none !important; }
    .print-only { display: block !important; }
    .print-avoid-break { break-inside: avoid; page-break-inside: avoid; }
    .sa-scroll { max-height: none !important; overflow: visible !important; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { size: landscape letter; margin: 0.4in; }
  }
  /* overview-home-v1 - the week strip: 7 tiles in one row wherever the
     card is wide enough (the sidebar leaves ~1100px at 1440), 2 columns at
     phone width, 7 across on the landscape print page. */
  .sa-strip { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
  @media (min-width: 1200px), print { .sa-strip { grid-template-columns: repeat(7, minmax(0, 1fr)); } }
  @media print {
    /* overview-home-v1 - bands print in printOrder (widgets.registry.js):
       the widget list becomes a flex column only under print so CSS order
       applies (on screen it is block flow, where order does nothing); a
       widget flagged printPage starts a new page, so each band gets its
       own. Deltas print in text ink: the arrow carries the direction, and
       the status green/red sit under 3:1 on white. */
    .sa-widget-list { display: flex; flex-direction: column; }
    .sa-band-start { break-before: page; page-break-before: always; }
    .sa-delta { color: var(--sa-text) !important; }
  }
`;

// sales-ia-v1 - four tabs (Today · Pipeline · Huddle · Reports). This owns
// the tab + sub-view selection (URL ?tab= / ?view=, salesNav.js); GoalsTab
// stays the data hub for Today / Pipeline / Reports and mounts Analytics
// under Reports. The Pipeline tab runs full width; the rest keep 1100.
export default function SalesAnalyticsTab({ businessId, features }) {
  const [tab, setTab] = useState(() => readNav().tab);
  const [views, setViews] = useState(() => { const n = readNav(); return { ...DEFAULT_VIEW, ...(n.view ? { [n.tab]: n.view } : {}) }; });
  const view = views[tab] || null;
  const [tabsSlot, setTabsSlot] = useState(null);
  useEffect(() => { setTabsSlot(document.getElementById('workspace-header-tabs')); }, []);
  const [huddleFocus, setHuddleFocus] = useState(null);
  const [huddleTarget, setHuddleTarget] = useState(null); // { feed } | { flags } from a Goals number
  const [overviewFocus, setOverviewFocus] = useState(null); // widget id a Goals number opens
  const [goalsTarget, setGoalsTarget] = useState(null); // { target } a Huddle / Analytics number opens in Goals
  const [me, setMe] = useState(null);
  const [myFlagCount, setMyFlagCount] = useState(0);

  const nav = useCallback((t, v) => {
    const n = normalizeNav(t, v);
    setTab(n.tab);
    if (n.view) setViews(vs => (vs[n.tab] === n.view ? vs : { ...vs, [n.tab]: n.view }));
  }, []);
  useEffect(() => { writeNav(tab, view); }, [tab, view]);

  // Badge on the Huddle tab: open flags handed to the viewer.
  useEffect(() => {
    let live = true;
    const count = () => Promise.all([fetchMe(), fetchFlags(businessId)])
      .then(([who, flags]) => { if (live) { setMe(who); setMyFlagCount(flags.filter(f => f.owner_user_id === who?.profile?.id).length); } })
      .catch(() => {});
    count();
    window.addEventListener(FLAGS_CHANGED, count);
    return () => { live = false; window.removeEventListener(FLAGS_CHANGED, count); };
  }, [businessId]);

  useEffect(() => {
    const open = () => { setGoalsTarget(null); nav('today'); };
    window.addEventListener(OPEN_GOALS_WEEK, open);
    return () => window.removeEventListener(OPEN_GOALS_WEEK, open);
  }, [nav]);

  const openGoals = target => { const home = homeOf(target); setGoalsTarget({ target }); nav(home ? home.tab : 'reports', home?.view); };
  const openHuddle = target => { setHuddleFocus(null); setHuddleTarget(target ? { ...target } : null); nav('huddle'); };
  const clearFocus = useCallback(() => setOverviewFocus(null), []);
  const canEdit = !!me && (me.profile?.is_platform_owner || roleAtLeast(me.memberships?.find(m => m.business_id === businessId)?.role, 'member'));

  // shell-facelift-v1 Stage 2 - the tab row sits in the workspace header's sticky row when that slot exists
  // (BusinessDetailPage), inline otherwise. Kit vars, not SA vars: the slot is outside #sales-analytics-root.
  const tabRow = (
    <div className="no-print" style={{ display: 'inline-flex', background: ui.surface2, border: `1px solid ${ui.border}`, borderRadius: SA_SHAPE.radiusInner, padding: 3, marginBottom: tabsSlot ? 0 : 20 }}>
      {TABS.map(([id, label]) => (
        <button key={id} onClick={() => { nav(id); setGoalsTarget(null); setHuddleTarget(null); }}
          style={{ ...SA_TYPE.body, fontSize: 13, border: 0, borderRadius: 7, padding: '0 14px', height: 32, cursor: 'pointer', background: tab === id ? ui.surface : 'transparent', color: tab === id ? ui.text : ui.muted, whiteSpace: 'nowrap' }}>
          {label}
          {id === 'huddle' && myFlagCount > 0 && (
            <span aria-label={`${myFlagCount} flagged for you`} style={{ marginLeft: 8, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: ui.warn, color: ui.ground, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{myFlagCount}</span>
          )}
        </button>
      ))}
    </div>
  );

  return (
    <div id={SA_THEME_ROOT_ID} style={{ ...saSans, background: SA.ground, color: SA.text, minHeight: '100%', padding: '0 0 32px' }}>
      <style>{SA_THEME_CSS}</style>
      <style>{PRINT_STYLES}</style>
      <div data-sales-tab={tab} style={{ maxWidth: tab === 'pipeline' ? 'none' : KIT_MAX_WIDTH, margin: '0 auto' }}>

      {tabsSlot ? createPortal(tabRow, tabsSlot) : tabRow}

      {tab === 'huddle'
        ? <DailyHuddle businessId={businessId} focusContactId={huddleFocus} onFocused={() => setHuddleFocus(null)} focusTarget={huddleTarget} onOpenGoals={openGoals} />
        : <GoalsTab businessId={businessId} section={tab} view={view} onNav={nav} initialTarget={goalsTarget}
            onOpenOverview={widget => { setOverviewFocus(widget || null); nav('reports', 'analytics'); }}
            onOpenHuddle={(contactId, target) => { setHuddleFocus(contactId); setHuddleTarget(target ? { ...target } : null); nav('huddle'); }}
            analytics={<AnalyticsView businessId={businessId} features={features} canEdit={canEdit} onOpenGoals={openGoals} onOpenHuddle={openHuddle} focusWidget={overviewFocus} onFocused={clearFocus} />} />}
      </div>
    </div>
  );
}
