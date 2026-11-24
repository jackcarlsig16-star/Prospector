import { useState, useEffect, useCallback } from 'react';
import { SA, SA_THEME_CSS, SA_THEME_ROOT_ID, saSans } from './theme';
import { ui } from '../../ui/kitTheme';
import Tabs from '../../ui/Tabs';
import { IconTarget, IconTable, IconCheck, IconMap, IconPeople, IconFlow, IconMegaphone, IconSource, IconMail, IconHome, IconScorecard, IconPhone } from '../../ui/icons';
import AnalyticsView from './AnalyticsView';
import PeopleTable from './people/PeopleTable';
import GoalsTab, { homeOf } from './goals/GoalsTab';
import { goalsApi, OPEN_GOALS_WEEK, OPEN_GOALS_TARGET, OPEN_PIPELINE_RECORD, PAGE_LOAD_FAILURES } from './goals/goalsApi';
import { laDateString } from './periods';
import { roleAtLeast } from '../../constants/roles';
import { pageloadSync } from './salesApi';
import { fetchMe } from '../../utils/authSession';
import { TABS, DEFAULT_VIEW, readNav, writeNav, normalizeNav, readOpenParam, subViewsFor } from './salesNav';
import { onScoutOpen } from '../scout/scoutOpen';
import { FRAME_ROW_HEIGHT, FRAME_TOOLS_ID, FRAME_CSS } from './salesFrame';
import useMediaQuery from '../../utils/useMediaQuery';

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
`;

// sales-ia-v2 N1/N2 - the sales pages: Dashboard · Pipeline · Actions · Settings. app-shell-v2 D11: the shell's left
// nav picks the page (there is no tab strip here any more); this still owns the tab + sub-view selection
// (URL ?tab= / ?view=, salesNav.js) and the one page frame every tab shares:
// full width, then a fixed-height frame
// row (sub-view switch on the left, the screen's own tools portaled into
// #sales-frame-tools on the right) so switching tabs or toggling filters
// never moves what sits above. GoalsTab stays the data hub for Actions /
// Pipeline / Dashboard; Pipeline > People is people/PeopleTable (people-v2: the one table
// on its Live tab, Priorities and Done beside it).

const SUB_VIEW_ICON = { 'top-targets': IconTarget, companies: IconTable, clients: IconCheck, priorities: IconMap, people: IconPeople, partners: IconFlow, campaigns: IconMegaphone, overview: IconHome, analytics: IconMail, scorecard: IconScorecard, sources: IconSource, calls: IconPhone, 'team-emails': IconMail };

export default function SalesAnalyticsTab({ businessId }) {
  const [tab, setTab] = useState(() => readNav().tab);
  const phone = useMediaQuery('(max-width: 760px)');
  const [views, setViews] = useState(() => { const n = readNav(); return { ...DEFAULT_VIEW, ...(n.view ? { [n.tab]: n.view } : {}) }; });
  const view = views[tab] || null;
  const [huddleTarget, setHuddleTarget] = useState(null); // { feed } | { flags } from a Goals number
  const [goalsTarget, setGoalsTarget] = useState(null); // { target } a Huddle / Analytics number opens in Goals
  const [pipelineTarget, setPipelineTarget] = useState(null); // { key, section, n } a record the header "+" added (one-plus-button-v1)
  const [me, setMe] = useState(null);
  // dashboard-v3 A7 (REVISABLE): Pipeline › Campaigns stays hidden until sales_outreach_* holds a row; when it first shows,
  // a dot marks it until it is opened once. localStorage key (per browser): prospector_campaigns_seen_<businessId> = '1'.
  const [campaignCount, setCampaignCount] = useState(null);
  const [campaignsSeen, setCampaignsSeen] = useState(() => { try { return localStorage.getItem(`prospector_campaigns_seen_${businessId}`) === '1'; } catch { return true; } });
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => goalsApi.campaigns(businessId)).then(l => { if (live) setCampaignCount(l.length); }).catch(() => { if (live) setCampaignCount(0); });
    return () => { live = false; };
  }, [businessId]);

  const nav = useCallback((t, v) => {
    const n = normalizeNav(t, v);
    setTab(n.tab);
    if (n.view) setViews(vs => (vs[n.tab] === n.view ? vs : { ...vs, [n.tab]: n.view }));
  }, []);
  useEffect(() => { writeNav(tab, view); }, [tab, view]);

  useEffect(() => { let live = true; Promise.resolve().then(() => fetchMe()).then(who => { if (live) setMe(who); }).catch(() => {}); return () => { live = false; }; }, [businessId]);

  useEffect(() => {
    const open = () => { setGoalsTarget(null); nav('actions'); };
    window.addEventListener(OPEN_GOALS_WEEK, open);
    return () => window.removeEventListener(OPEN_GOALS_WEEK, open);
  }, [nav]);

  useEffect(() => {
    const open = e => { setPipelineTarget({ key: e.detail?.key, section: e.detail?.section || null, from: e.detail?.from || null, n: Date.now() }); nav('pipeline', 'companies'); };
    window.addEventListener(OPEN_PIPELINE_RECORD, open);
    return () => window.removeEventListener(OPEN_PIPELINE_RECORD, open);
  }, [nav]);
  // scout-v2 B7: a Scout open while this tab is on screen - a company key opens its window (as OPEN_PIPELINE_RECORD
  // does); anything else moves to its tab / view, whose list reads the rest of the key.
  useEffect(() => onScoutOpen(p => {
    const key = readOpenParam(`?open=${encodeURIComponent(p.open || '')}`);
    if (key) { setPipelineTarget({ key, section: null, n: Date.now() }); nav('pipeline', 'companies'); }
    else if (p.tab) nav(p.tab, p.view);
  }), [nav]);
  const openGoals = useCallback(target => { const home = homeOf(target); setGoalsTarget({ target }); nav(home ? home.tab : 'dashboard', home?.view); }, [nav]);
  useEffect(() => {
    const open = e => openGoals(e.detail.target);
    window.addEventListener(OPEN_GOALS_TARGET, open);
    return () => window.removeEventListener(OPEN_GOALS_TARGET, open);
  }, [openGoals]);
  const openHuddle = target => { setHuddleTarget(target ? { ...target } : null); nav('pipeline', 'people'); };
  const canEdit = !!me && (me.profile?.is_platform_owner || roleAtLeast(me.memberships?.find(m => m.business_id === businessId)?.role, 'member'));

  // call-notes-targets-v1 Stage 3 - Tidy runs once per LA day on a Member's
  // first Sales & Marketing visit; the server guard is the real gate, these keys
  // only save the call. Viewers never trigger it. signals-v1 Stage 4: the
  // website-visitor pull goes first so Tidy's "visited, no touch" sees it; a
  // failed pull is retried on the next load and never blocks Tidy.
  // localStorage keys (per browser): prospector_tidy_ran_<businessId>,
  // prospector_visits_ran_<businessId>, prospector_apollo_sync_ran_<businessId> = 'YYYY-MM-DD'
  // FIX people-apollo-visibility-v1 F3b: the Apollo sync starts alongside (the cron never fires); the server skips it
  // when it already ran today, the last sync is fresh or another started in the last 10 min.
  // FIX loop-quickfixes Q5: a failed page-load pull / Tidy / Apollo sync never blocks the page; it shows in the Needs
  // attention drawer (actions-home-attention-v1) as Failed "on page load" ({ visits?, tidy?, apollo? } = the error text).
  const [pageLoadFailures, setPageLoadFailures] = useState({});
  // app-shell-v2 Q8: the Needs attention drawer lives in the shell's header now - it hears the failures from here.
  useEffect(() => { window.dispatchEvent(new CustomEvent(PAGE_LOAD_FAILURES, { detail: { businessId, failures: pageLoadFailures } })); }, [businessId, pageLoadFailures]);
  useEffect(() => {
    if (!canEdit) return;
    const today = laDateString();
    const ran = key => { try { return localStorage.getItem(key) === today; } catch { return false; } };
    const mark = key => { try { localStorage.setItem(key, today); } catch { /* private mode */ } };
    const visitsKey = `prospector_visits_ran_${businessId}`, tidyKey = `prospector_tidy_ran_${businessId}`, apolloKey = `prospector_apollo_sync_ran_${businessId}`;
    if (!ran(apolloKey)) pageloadSync(businessId).then(() => mark(apolloKey)).catch(e => setPageLoadFailures(f => ({ ...f, apollo: e.message })));
    const pull = ran(visitsKey) ? Promise.resolve() : goalsApi.visitPull(businessId, { trigger: 'pageload' }).then(() => mark(visitsKey)).catch(e => setPageLoadFailures(f => ({ ...f, visits: e.message })));
    if (ran(tidyKey)) return;
    pull.then(() => goalsApi.runTidy(businessId, { trigger: 'pageload' })).then(() => mark(tidyKey)).catch(e => setPageLoadFailures(f => ({ ...f, tidy: e.message })));
  }, [businessId, canEdit]);

  const subViews = subViewsFor(tab, view)?.filter(([id]) => id !== 'campaigns' || campaignCount > 0) || null;
  const campaignsNew = campaignCount > 0 && !campaignsSeen;
  const subLabel = (id, label) => (id === 'campaigns' && campaignsNew ? <>{label}<span aria-label="new" title="New: the first campaign is in" style={{ width: 7, height: 7, borderRadius: 999, background: ui.accent, display: 'inline-block', marginLeft: 6 }} /></> : label);
  // companies-v2 C1: the sub-views are second-level underline tabs; the row's own rule runs under the tools too, and the
  // tabs sit on it (-1 px) so the two rules are one line.
  // FIX pipeline-390-toolbar-v1 T1: on a phone the frame stacks - the tab strip (scrolling inside its row, the selected
  // tab kept in view by Tabs) above the tools row (FRAME_CSS hides it while empty) - so a screen's tools never sit on
  // the tabs. Wider than 760 px nothing changes (T2).
  const frameRow = (
    <div className="no-print" data-sales-frame data-frame-rows={phone ? 2 : 1} data-campaigns={campaignCount ?? 'loading'} style={{ display: 'flex', marginBottom: 16, minWidth: 0, borderBottom: subViews ? `1px solid ${ui.subTabRule}` : undefined,
      ...(phone ? { flexDirection: 'column', alignItems: 'stretch', gap: 0, minHeight: FRAME_ROW_HEIGHT } : { height: FRAME_ROW_HEIGHT, alignItems: subViews ? 'flex-end' : 'center', gap: 12 }) }}>
      <div data-sales-subviews style={{ display: 'flex', alignItems: 'flex-end', minWidth: 0, minHeight: 36, marginBottom: subViews && !phone ? -1 : 0 }}>
        {subViews && <Tabs level="sub" label={`${TABS.find(([id]) => id === tab)[1]} views`} items={subViews.map(([id, label]) => ({ id, label: subLabel(id, label), icon: SUB_VIEW_ICON[id] }))} value={view} onChange={v => { if (v === 'campaigns' && !campaignsSeen) { setCampaignsSeen(true); try { localStorage.setItem(`prospector_campaigns_seen_${businessId}`, '1'); } catch { /* private mode */ } } nav(tab, v); setHuddleTarget(null); }} />}
      </div>
      <div id={FRAME_TOOLS_ID} />
    </div>
  );
  const people = tab === 'pipeline' && view === 'people';

  return (
    <div id={SA_THEME_ROOT_ID} style={{ ...saSans, background: SA.ground, color: SA.text, minHeight: '100%', padding: '0 0 32px' }}>
      <style>{SA_THEME_CSS}</style>
      <style>{PRINT_STYLES}</style>
      <style>{FRAME_CSS}</style>
      <div data-sales-tab={tab} style={{ maxWidth: 'none', margin: '0 auto' }}>

      {frameRow}

      {people
        ? <PeopleTable businessId={businessId} canEdit={canEdit} me={me} initialTarget={huddleTarget} />
        : <GoalsTab businessId={businessId} section={tab} view={view} onNav={nav} initialTarget={goalsTarget} pipelineTarget={pipelineTarget}
            onOpenHuddle={(contactId, target) => { setHuddleTarget(target ? { ...target } : null); nav('pipeline', 'people'); }}
            analytics={<AnalyticsView businessId={businessId} canEdit={canEdit} />} />}
      </div>
    </div>
  );
}
