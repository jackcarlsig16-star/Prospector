import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_THEME_CSS, SA_THEME_ROOT_ID, saSans } from './theme';
import { ui } from '../../ui/kitTheme';
import Segmented from '../../ui/Segmented';
import Tag from '../../ui/Tag';
import AnalyticsView from './AnalyticsView';
import DailyHuddle from './DailyHuddle';
import GoalsTab, { homeOf } from './goals/GoalsTab';
import { goalsApi, OPEN_GOALS_WEEK, OPEN_GOALS_TARGET } from './goals/goalsApi';
import { laDateString } from './periods';
import { roleAtLeast } from '../../constants/roles';
import { fetchFlags, FLAGS_CHANGED } from './huddleApi';
import { fetchMe } from '../../utils/authSession';
import { TABS, SUB_VIEWS, DEFAULT_VIEW, readNav, writeNav, normalizeNav } from './salesNav';
import { FRAME_ROW_HEIGHT, FRAME_TOOLS_ID } from './salesFrame';

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

// sales-ia-v2 N1/N2 - Sales & Marketing: Sales = Dashboard · Pipeline ·
// Actions, Marketing shown disabled. This owns the tab + sub-view selection
// (URL ?tab= / ?view=, salesNav.js) and the one page frame every tab shares:
// full width, the tab row in the workspace header, then a fixed-height frame
// row (sub-view switch on the left, the screen's own tools portaled into
// #sales-frame-tools on the right) so switching tabs or toggling filters
// never moves what sits above. GoalsTab stays the data hub for Actions /
// Pipeline / Dashboard; Pipeline > People is DailyHuddle (the People table
// on its Live tab, Priorities and Done beside it).

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
    const open = () => { setGoalsTarget(null); nav('actions'); };
    window.addEventListener(OPEN_GOALS_WEEK, open);
    return () => window.removeEventListener(OPEN_GOALS_WEEK, open);
  }, [nav]);

  const openGoals = useCallback(target => { const home = homeOf(target); setGoalsTarget({ target }); nav(home ? home.tab : 'dashboard', home?.view); }, [nav]);
  useEffect(() => {
    const open = e => openGoals(e.detail.target);
    window.addEventListener(OPEN_GOALS_TARGET, open);
    return () => window.removeEventListener(OPEN_GOALS_TARGET, open);
  }, [openGoals]);
  const openHuddle = target => { setHuddleFocus(null); setHuddleTarget(target ? { ...target } : null); nav('pipeline', 'people'); };
  const clearFocus = useCallback(() => setOverviewFocus(null), []);
  const canEdit = !!me && (me.profile?.is_platform_owner || roleAtLeast(me.memberships?.find(m => m.business_id === businessId)?.role, 'member'));

  // call-notes-targets-v1 Stage 3 - Tidy runs once per LA day on a Member's
  // first Sales & Marketing visit; the server guard is the real gate, these keys
  // only save the call. Viewers never trigger it. signals-v1 Stage 4: the
  // website-visitor pull goes first so Tidy's "visited, no touch" sees it; a
  // failed pull is retried on the next load and never blocks Tidy.
  // localStorage keys (per browser): prospector_tidy_ran_<businessId>,
  // prospector_visits_ran_<businessId> = 'YYYY-MM-DD'
  // FIX loop-quickfixes Q5: a failed page-load pull / Tidy still never blocks the page; it shows in the Needs
  // attention drawer (actions-home-attention-v1) as Failed "on page load" ({ visits?, tidy? } = the error text).
  const [pageLoadFailures, setPageLoadFailures] = useState({});
  useEffect(() => {
    if (!canEdit) return;
    const today = laDateString();
    const ran = key => { try { return localStorage.getItem(key) === today; } catch { return false; } };
    const mark = key => { try { localStorage.setItem(key, today); } catch { /* private mode */ } };
    const visitsKey = `prospector_visits_ran_${businessId}`, tidyKey = `prospector_tidy_ran_${businessId}`;
    const pull = ran(visitsKey) ? Promise.resolve() : goalsApi.visitPull(businessId, { trigger: 'pageload' }).then(() => mark(visitsKey)).catch(e => setPageLoadFailures(f => ({ ...f, visits: e.message })));
    if (ran(tidyKey)) return;
    pull.then(() => goalsApi.runTidy(businessId, { trigger: 'pageload' })).then(() => mark(tidyKey)).catch(e => setPageLoadFailures(f => ({ ...f, tidy: e.message })));
  }, [businessId, canEdit]);

  // shell-facelift-v1 Stage 2 - the tab row sits in the workspace header's sticky row when that slot exists
  // (BusinessDetailPage), inline otherwise. Kit vars, not SA vars: the slot is outside #sales-analytics-root.
  // ui-clarity-v1 R1: text tabs with the kit's 3 px underline (.ui-tab, keyed on aria-current so the tabs stay
  // buttons for every verify script that clicks them), the "Sales" group label beside them (R7), Marketing
  // disabled with its dashed edge and "Coming soon". The row keeps its 38 px height (N2).
  // The flag badge sits on Actions (flags handed to you are actions) and
  // always keeps its slot so a new flag never shifts the tab labels.
  const tabBtn = (id, label, extra, more) => (
    <button key={id} type="button" className="ui-tab" aria-current={tab === id ? 'page' : undefined} onClick={() => { nav(id); setGoalsTarget(null); setHuddleTarget(null); }} {...more}>
      {label}{extra}
    </button>
  );
  const flagBadge = (
    <span aria-label={myFlagCount ? `${myFlagCount} flagged for you` : undefined} aria-hidden={myFlagCount ? undefined : true}
      style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: myFlagCount ? ui.warn : 'transparent', color: ui.ground, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontVariantNumeric: 'tabular-nums', visibility: myFlagCount ? 'visible' : 'hidden' }}>{myFlagCount || 0}</span>
  );
  const tabRow = (
    <div className="no-print" data-sales-tabrow style={{ display: 'inline-flex', alignItems: 'center', gap: 10, height: 38, marginBottom: tabsSlot ? 0 : 20 }}>
      <span className="ui-group-label" aria-hidden="true">Sales</span>
      <div role="navigation" aria-label="Sales" className="ui-tabs" style={{ height: 38, alignItems: 'center', overflow: 'visible' }}>
        {TABS.map(([id, label]) => tabBtn(id, label, id === 'actions' ? flagBadge : null))}
        {tabBtn('marketing', 'Marketing', <Tag color={ui.off}>Coming soon</Tag>, { disabled: true, 'aria-disabled': 'true', title: 'Marketing is coming soon', 'data-sales-marketing': true })}
      </div>
    </div>
  );
  const subViews = SUB_VIEWS[tab];
  const frameRow = (
    <div className="no-print" data-sales-frame style={{ height: FRAME_ROW_HEIGHT, display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, minWidth: 0 }}>
      <div data-sales-subviews style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, minHeight: 36 }}>
        {subViews && <span className="ui-group-label" aria-hidden="true">View</span>}
        {subViews && <Segmented label={`${TABS.find(([id]) => id === tab)[1]} views`} items={subViews.map(([id, label]) => ({ id, label }))} value={view} onChange={v => { nav(tab, v); setHuddleTarget(null); }} />}
      </div>
      <div id={FRAME_TOOLS_ID} style={{ flex: '1 1 auto', minWidth: 0, height: FRAME_ROW_HEIGHT, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, overflowX: 'auto', overflowY: 'hidden' }} />
    </div>
  );
  const people = tab === 'pipeline' && view === 'people';

  return (
    <div id={SA_THEME_ROOT_ID} style={{ ...saSans, background: SA.ground, color: SA.text, minHeight: '100%', padding: '0 0 32px' }}>
      <style>{SA_THEME_CSS}</style>
      <style>{PRINT_STYLES}</style>
      <div data-sales-tab={tab} style={{ maxWidth: 'none', margin: '0 auto' }}>

      {tabsSlot ? createPortal(tabRow, tabsSlot) : tabRow}
      {frameRow}

      {people
        ? <DailyHuddle businessId={businessId} focusContactId={huddleFocus} onFocused={() => setHuddleFocus(null)} focusTarget={huddleTarget} onOpenGoals={openGoals} />
        : <GoalsTab businessId={businessId} section={tab} view={view} onNav={nav} initialTarget={goalsTarget} pageLoadFailures={pageLoadFailures}
            onOpenOverview={widget => { setOverviewFocus(widget || null); nav('dashboard', 'analytics'); }}
            onOpenHuddle={(contactId, target) => { setHuddleFocus(contactId); setHuddleTarget(target ? { ...target } : null); nav('pipeline', 'people'); }}
            analytics={<AnalyticsView businessId={businessId} features={features} canEdit={canEdit} onOpenGoals={openGoals} onOpenHuddle={openHuddle} focusWidget={overviewFocus} onFocused={clearFocus} />} />}
      </div>
    </div>
  );
}
