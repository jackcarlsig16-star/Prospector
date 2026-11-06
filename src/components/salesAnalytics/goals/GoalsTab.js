import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_TYPE, SA_SHAPE, SA_THEME_ROOT_ID } from '../theme';
import { laWeekStart, laDateString } from '../periods';
import { FRAME_TOOLS_ID } from '../salesFrame';
import { roleAtLeast } from '../../../constants/roles';
import { fetchMe } from '../../../utils/authSession';
import useMediaQuery from '../../../utils/useMediaQuery';
import Segmented from '../../../ui/Segmented';
import { goalsApi, TODOS_CHANGED } from './goalsApi';
import ScorecardView from './ScorecardView';
import { todoStatus } from './todoStatus';
import PartnersView from './PartnersView';
import PipelineView from './PipelineView';
import PrioritiesView from './priorities/PrioritiesView';
import { writePeopleCompany } from '../salesNav';
import PlanWeekDrawer from './PlanWeekDrawer';
import { PlanNudge } from './PlanNudge';
import ActionsView from './ActionsView';
import AttentionDrawer from './AttentionDrawer';
import CampaignsView from './campaigns/CampaignsView';
import SourcesView from './SourcesView';
import ClientsView from './ClientsView';
import TeamEmailsSettings from './TeamEmailsSettings';
import HomeView, { PERIODS, DEFAULT_PERIOD } from './HomeView';
import TrackImprove from './TrackImprove';
import GoalsSection from './GoalsSection';
import { dayTitle } from './todayModel';
import { linkedTo } from '../tasks/LinkedTasks';
import { exportWidgetCsv } from '../exportCsv';
import {
  subStyle, numStyle, Chip, Btn, ErrorNote,
  addDays, monthOf, monthName, weekLabel, weekOf, memberLookup, ownedBy, flashTo,
} from './goalsUi';

// sales-ia-v1 - the data hub behind Actions (sales-ia-v2 A1: ActionsView; dashboard-v3 Stage 2: the week's commitments +
// Pipeline moves and Track & improve sit under it) / Pipeline / Dashboard (dashboard-v3: Home = HomeView's Pulse + Insights
// over GET goals/pulse, the 13 charts and the hero tiles are gone; Stage 1: the Scorecard is
// its own sub-view, the Weekly report + KPI table are gone, Sequenced too). `section` is the tab on screen
// and `view` its sub-view (SalesAnalyticsTab owns both, via salesNav.js, and
// draws the sub-view switch); this renders only that section, with its tools
// portaled into the frame row (sales-ia-v2 N2). Export = 4 CSVs.
// localStorage key (per viewer convenience, never shared state):
//   prospector_goals_owner - last person filter, as a first-name slug
const OWNER_KEY = 'prospector_goals_owner';
const readStored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStored = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
const slugOf = name => name.split(' ')[0].toLowerCase();

// Design E - the one table from a link target to its home tab + sub-view.
// Commitment link_target values live in the database, so anything unknown
// still lands somewhere: the Dashboard, with the target logged.
// dashboard-v3 Stage 1: the weekly report's links (view:report, section:*) and score:* open the Scorecard sub-view;
// Sequenced is gone, so companies / missing-headcount links open Email (its Sequences card from Stage 4).
const HOME = {
  'view:report': ['dashboard', 'scorecard'], 'view:week': ['actions'], 'view:this_week': ['actions'],
  'view:partners': ['pipeline', 'partners'], 'view:companies': ['dashboard', 'analytics'], 'view:pipeline': ['pipeline', 'companies'],
  'week:prev': ['actions'], overview: ['dashboard', 'analytics'], section: ['dashboard', 'scorecard'], score: ['dashboard', 'scorecard'],
  missing: ['dashboard', 'analytics'], huddle: ['pipeline', 'people'], plan: ['actions'],
};
export function homeOf(target) {
  if (!target) return null;
  if (target.partners) return { tab: 'pipeline', view: 'partners' };
  if (target.companies) return { tab: 'dashboard', view: 'analytics' };
  if (typeof target !== 'string') return null;
  const row = HOME[target] || HOME[target.split(':')[0]];
  return row ? { tab: row[0], view: row[1] || null } : null;
}

// initialTarget: a link from the Huddle or Analytics ({ target }, new object
// per click) - same targets as go() below.
export default function GoalsTab({ businessId, section, view, onNav, onOpenHuddle, initialTarget, pipelineTarget = null, analytics, pageLoadFailures }) {
  const compact = useMediaQuery('(max-width: 1099px)');
  const [weekStart, setWeekStart] = useState(() => laWeekStart());
  // null until the first choice: actions-v2 REV2 A1 defaults it to the signed-in Member (Team for a Viewer).
  const [ownerSlug, setOwnerSlug] = useState(() => new URLSearchParams(window.location.search).get('owner') || readStored(OWNER_KEY) || null);
  const [members, setMembers] = useState([]);
  const [me, setMe] = useState(null);
  const [todos, setTodos] = useState([]);
  const [partners, setPartners] = useState([]);
  const [scorecard, setScorecard] = useState(null);
  const [commitments, setCommitments] = useState([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [partnerFocus, setPartnerFocus] = useState(null); // { stage?, tiers?, owner?, ids?, open? } - a link opening Partners filtered
  const [planOpen, setPlanOpen] = useState(false);
  const [plans, setPlans] = useState(null);
  const [toast, setToast] = useState('');
  const [period, setPeriod] = useState(DEFAULT_PERIOD); // Home: the Pulse window
  const [errors, setErrors] = useState({});
  const [toolsSlot, setToolsSlot] = useState(null);
  useEffect(() => { setToolsSlot(document.getElementById(FRAME_TOOLS_ID)); }, []);
  const setError = useCallback((key, e) => setErrors(prev => ({ ...prev, [key]: e })), []);

  const lookup = useMemo(() => memberLookup(members), [members]);
  const ownerMember = members.find(m => slugOf(m.name) === ownerSlug);
  const owner = ownerMember ? ownerMember.user_id : 'team';
  const thisWeek = laWeekStart();
  const myRole = me?.memberships?.find(m => m.business_id === businessId)?.role;
  const canEdit = !!me && (me.profile?.is_platform_owner || roleAtLeast(myRole, 'member'));
  const isAdmin = !!me && (me.profile?.is_platform_owner || roleAtLeast(myRole, 'admin'));
  const isOwner = !!me && (me.profile?.is_platform_owner || myRole === 'owner');
  // weekly-plan-v1: a plan is one person's; on Team it's the signed-in user's.
  const planOwner = owner === 'team' ? me?.profile?.id : owner;

  useEffect(() => {
    goalsApi.members(businessId).then(setMembers).catch(e => setError('members', e));
    goalsApi.partners(businessId).then(setPartners).catch(e => setError('partners', e));
    fetchMe().then(setMe).catch(() => setMe(null));
  }, [businessId, setError]);

  const loadTodos = useCallback(() => goalsApi.weekGoals(businessId, weekStart, weekStart, 'todo')
    .then(g => { setTodos(g); setError('todos', null); }).catch(e => setError('todos', e)), [businessId, weekStart, setError]);
  const loadScorecard = useCallback(() => goalsApi.scorecard(businessId, monthOf(weekStart), owner === 'team' ? null : owner)
    .then(d => { setScorecard(d); setError('scorecard', null); }).catch(e => { setScorecard(null); setError('scorecard', e); }), [businessId, weekStart, owner, setError]);

  const loadCommitments = useCallback(() => goalsApi.weekGoals(businessId, weekStart, weekStart, 'commitment')
    .then(g => { setCommitments(g); setError('commitments', null); }).catch(e => setError('commitments', e)), [businessId, weekStart, setError]);
  useEffect(() => { loadTodos(); }, [loadTodos]);
  useEffect(() => {
    window.addEventListener(TODOS_CHANGED, loadTodos);
    return () => window.removeEventListener(TODOS_CHANGED, loadTodos);
  }, [loadTodos]);
  useEffect(() => { loadCommitments(); }, [loadCommitments]);
  useEffect(() => { loadScorecard(); }, [loadScorecard]);
  const loadPlans = useCallback(() => { if (planOwner) goalsApi.weekPlans(businessId, planOwner).then(setPlans).catch(() => setPlans(null)); }, [businessId, planOwner]);
  useEffect(() => { loadPlans(); }, [loadPlans]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // The person filter is remembered per viewer and mirrored in the URL
  // (?owner=cyrus); the tab and sub-view are SalesAnalyticsTab's (?tab=, ?view=).
  useEffect(() => {
    if (ownerSlug || !me || !members.length) return;
    const mine = members.find(m => m.user_id === me.profile?.id);
    setOwnerSlug(mine && mine.role !== 'viewer' ? slugOf(mine.name) : 'team');
  }, [ownerSlug, me, members]);
  useEffect(() => {
    if (!ownerSlug) return;
    writeStored(OWNER_KEY, ownerSlug);
    const url = new URL(window.location.href);
    if (ownerSlug === 'team') url.searchParams.delete('owner'); else url.searchParams.set('owner', ownerSlug);
    window.history.replaceState(window.history.state, '', url);
  }, [ownerSlug]);

  const people = [
    { id: 'team', label: 'Team', color: SA.accent },
    ...members.map(m => ({ id: slugOf(m.name), label: lookup(m.user_id).first, color: lookup(m.user_id).color })),
  ];

  const myTodos = todos.filter(t => ownedBy(owner, t.owner_user_id));
  // task-drawer-v1 Stage 4 - to-dos linked to a commitment, goal, partner or
  // company, from the week on screen. The drawer only holds the current week,
  // so links into it (and partner/company/goal counts) show for that week only.
  const liveWeek = weekStart === thisWeek;
  const tasksFor = (type, id) => linkedTo(todos, type, id);
  const myPartners = partners.filter(p => ownedBy(owner, p.owner_user_id));
  const myCommitments = commitments.filter(c => ownedBy(owner, c.owner_user_id));

  const today = laDateString();
  const meId = me?.profile?.id;
  // Every Goals link goes through here (goals-surface-v1 Stage 4). Targets:
  // 'overview[:<widget>]', 'view:<view>', 'section:<key>', 'missing',
  // 'week:prev', 'score:<metric>', 'huddle[:feed|open|click|reply|flags]',
  // 'plan', { partners: { stage?, tiers?, owner? } }, { companies: <Monday> }.
  // homeOf() picks the tab + sub-view; the rest here is the focus inside it.
  const go = target => {
    const home = homeOf(target);
    if (!home) {
      console.warn(`sales-ia-v2: no home for link target ${JSON.stringify(target)} - opening the Dashboard`);
      return onNav('dashboard', 'overview');
    }
    if (target.partners) { setPartnerFocus({ ...target.partners }); return onNav(home.tab, home.view); }
    if (target.companies) { setWeekStart(target.companies); return onNav(home.tab, home.view); }
    const [kind, arg] = target.split(/:(.*)/);
    if (kind === 'huddle') return onOpenHuddle && onOpenHuddle(null, !arg ? null : arg === 'flags' ? { flags: true } : { feed: arg === 'feed' ? null : arg });
    if (target === 'plan') setPlanOpen(true);
    if (target === 'view:partners') setPartnerFocus({});
    if (target === 'week:prev') setWeekStart(w => addDays(w, -7));
      if (kind === 'section') setTimeout(() => flashTo(`goals-sec-${arg}`), 50);
    if (kind === 'score') setTimeout(() => flashTo(`score-row-${arg}`), 120);
    onNav(home.tab, home.view);
  };
  useEffect(() => {
    if (initialTarget) go(initialTarget.target);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTarget]);

  // CSV exports (REV4 Stage 6) - what's on screen for the selected week and
  // person filter.
  const exports = [
    { id: 'scorecard', label: 'Scorecard CSV', disabled: !scorecard, run: () => exportWidgetCsv('goals_scorecard', scorecard.weeks.flatMap(w => Object.entries(w.metrics).map(([k, m]) => ({ week_start: w.week_start, metric: k, actual: m.value, goal: m.goal, source: scorecard.sources[k] })))
      .concat(Object.entries(scorecard.month_total).map(([k, m]) => ({ week_start: `month ${scorecard.month}`, metric: k, actual: m.value, goal: m.goal, source: m.source }))),
      [{ key: 'week_start', label: 'Week' }, { key: 'metric', label: 'Metric' }, { key: 'actual', label: 'Actual' }, { key: 'goal', label: 'Goal' }, { key: 'source', label: 'Source' }]) },
    { id: 'todos', label: 'To-dos CSV', run: () => exportWidgetCsv('goals_todos', myTodos, [
      { key: 'category', label: 'Category' }, { key: 'text', label: 'To-do' }, { label: 'Owner', value: t => lookup(t.owner_user_id).name },
      { label: 'With', value: t => t.contacts.join('; ') }, { label: 'Status', value: t => ({ done: 'done', prog: 'in progress', not: 'not started', dropped: 'dropped' })[todoStatus(t)] },
      { label: 'Steps done', value: t => t.steps.filter(s => s.done).length }, { label: 'Steps', value: t => t.steps.map(s => `${s.done ? '[x]' : '[ ]'} ${s.text}`).join(' | ') }]) },
    { id: 'partners', label: 'Partners CSV', run: () => exportWidgetCsv('goals_partners', myPartners, [
      { key: 'name', label: 'Partner' }, { key: 'category', label: 'Category' }, { key: 'tier', label: 'Tier' }, { key: 'pipeline_status', label: 'Pipeline status' },
      { label: 'Priority', value: p => (p.priority ? `P${p.priority}` : '') }, { key: 'meeting_status', label: 'Meeting' },
      { key: 'next_step', label: 'Next step' }, { key: 'first_email_at', label: '1st email' }, { key: 'last_touch_at', label: 'Last touch' }, { label: 'Hot', value: p => (p.hot ? 'yes' : '') },
      { key: 'champion', label: 'Champion' }, { label: 'Owner', value: p => (p.owner_user_id ? lookup(p.owner_user_id).name : '') }, { key: 'angle', label: 'Angle' },
      { key: 'motto', label: 'Their words' }, { key: 'watch_outs', label: 'Watch out' }, { key: 'do_not_say', label: 'Do not say' }, { key: 'sources', label: 'Sources' }, { key: 'first_email_note', label: 'First email note' }]) },
  ];

  // Design C - what the frame row carries per screen (sales-ia-v2 N2: one
  // fixed-height row, portaled into SalesAnalyticsTab's #sales-frame-tools).
  const showPeople = section === 'actions' || ['partners', 'overview'].includes(view);
  const showWeek = section === 'actions'; // the Goals section under Actions follows this week; the Scorecard has its own month switch
  const overview = section === 'dashboard' && view === 'overview';
  const title = liveWeek ? dayTitle(today, compact) : weekOf(weekStart);
  const exportRect = exportOpen && document.getElementById('sales-export-btn')?.getBoundingClientRect();
  const tools = (
    <>
      {section === 'actions' && <h1 style={{ margin: '0 auto 0 0', ...SA_TYPE.pageTitle, fontSize: 22, color: SA.text, whiteSpace: 'nowrap' }}>{title}</h1>}
      {me && !canEdit && (
        <Chip title="You have view access to this workspace, so Sales & Marketing is read-only for you." style={{ height: 26, color: SA.soft, flex: 'none' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="2" /></svg>
          View only
        </Chip>
      )}
      {overview && <Segmented label="Period" items={PERIODS.map(([id, label]) => ({ id, label }))} value={period} onChange={setPeriod} />}
      {showPeople && <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>{!overview && <span className="ui-group-label" aria-hidden="true">Who</span>}<Segmented label="Filter by person" items={people} value={ownerSlug} onChange={setOwnerSlug} /></div>}
      {showWeek && <>
        <Btn aria-label="Previous week" onClick={() => setWeekStart(w => addDays(w, -7))}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg>
        </Btn>
        <div style={{ height: 36, padding: '0 12px', border: `1px solid ${SA.border}`, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10, background: SA.surface, flex: 'none' }}>
          <span style={{ fontWeight: 600, whiteSpace: 'nowrap', ...numStyle }}>{weekLabel(weekStart)}</span>
          <Chip style={{ height: 22 }}>{monthName(monthOf(weekStart))}</Chip>
        </div>
        <Btn aria-label="Next week" onClick={() => setWeekStart(w => addDays(w, 7))}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
        </Btn>
        {weekStart !== thisWeek && <Btn onClick={() => setWeekStart(thisWeek)}>This week</Btn>}
      </>}
      {section === 'actions' && me && <AttentionDrawer businessId={businessId} canEdit={canEdit} isAdmin={isAdmin} compact={compact} pageLoadFailures={pageLoadFailures} onNav={onNav} />}
      {section === 'actions' && canEdit && planOwner && <Btn primary onClick={() => setPlanOpen(true)}>Plan this week</Btn>}
      {section === 'dashboard' && view === 'overview' && <Btn primary id="sales-export-btn" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen(o => !o)}>Export</Btn>}
    </>
  );
  // The tools row scrolls sideways when narrow, so the Export menu is drawn
  // over the page (fixed) instead of inside it, where it would be clipped.
  const exportMenu = exportOpen && exportRect && createPortal(
    <div role="menu" className="no-print" style={{ position: 'fixed', right: window.innerWidth - exportRect.right, top: exportRect.bottom + 4, zIndex: 4010, minWidth: 220, background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 10, padding: 6, display: 'flex', flexDirection: 'column' }}>
      {exports.map(x => (
        <button key={x.id} role="menuitem" type="button" className="ui-btn ui-btn--secondary ui-btn--block" disabled={x.disabled} title={x.disabled ? 'Needs the Stage 4 database update' : undefined}
          style={{ height: 36, ...(x.disabled ? {} : { border: 0 }) }}
          onClick={() => { if (x.disabled) return; setExportOpen(false); x.run(); }}>{x.label}</button>
      ))}
    </div>,
    document.getElementById(SA_THEME_ROOT_ID) || document.body,
  );

  return (
    <div data-sales-section={section} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {toolsSlot && createPortal(tools, toolsSlot)}
      {exportMenu}

      <main style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {errors.members && <ErrorNote message={errors.members.message} />}

        {section === 'actions' && me && <>
          {canEdit && <PlanNudge week={weekStart} ownerId={planOwner} ownerName={lookup(planOwner).first} plans={plans} onPlan={() => setPlanOpen(true)} />}
          <ActionsView businessId={businessId} canEdit={canEdit} meId={meId} owner={owner} members={members} lookup={lookup}
            onOpenFull={row => go(row.type === 'partner' ? { partners: { ids: [row.id], open: row.id, label: row.name } } : 'view:pipeline')} />
          <GoalsSection businessId={businessId} weekStart={weekStart} members={ownerMember ? [ownerMember] : members} lookup={lookup} commitments={myCommitments} partners={partners} />
          <TrackImprove businessId={businessId} canEdit={canEdit} />
        </>}

        {overview && <HomeView businessId={businessId} period={period} owner={owner === 'team' ? null : owner} canEdit={canEdit} lookup={lookup}
          onOpenEmail={() => onNav('dashboard', 'analytics')} onOpenMap={() => onNav('pipeline', 'priorities')} onOpenActions={() => onNav('actions', null)} />}

        {section === 'dashboard' && view === 'sources' && <SourcesView businessId={businessId} partners={partners} isAdmin={isAdmin} canEdit={canEdit} members={members} meId={meId} onToast={setToast} />}
        {section === 'dashboard' && view === 'analytics' && analytics}
        {section === 'dashboard' && view === 'scorecard' && me && <ScorecardView businessId={businessId} isOwner={isOwner} toolsSlot={toolsSlot} onOpen={go} />}

        {section === 'pipeline' && view === 'partners' && (
          <PartnersView businessId={businessId} partners={myPartners} lookup={lookup} members={members} canEdit={canEdit} error={errors.partners}
            onUpdate={async (goalId, body) => { const g = await goalsApi.updatePartner(businessId, goalId, body); setPartners(ps => ps.map(p => (p.id === g.id ? { ...p, ...g } : p))); }}
            onSignal={(goalId, signal) => goalsApi.partnerSignal(businessId, goalId, signal)}
            onUndo={(goalId, eventId) => goalsApi.partnerUndo(businessId, goalId, eventId)}
            // Merge, never replace: a signal's reply is the sales_goals row, without the list's people_count.
            onReplace={g => setPartners(ps => ps.map(p => (p.id === g.id ? { ...p, ...g } : p)))}
            onPeople={goalId => goalsApi.partnerPeople(businessId, goalId)}
            onAddPerson={(goalId, body) => goalsApi.addPartnerPerson(businessId, goalId, body)}
            onDeletePerson={(goalId, personId) => goalsApi.deletePartnerPerson(businessId, goalId, personId)}
            onRefreshPeople={() => goalsApi.refreshPartnerPeople(businessId)}
            onCreateTask={body => goalsApi.createWeekGoal(businessId, { week_start: thisWeek, kind: 'todo', owner_user_id: (owner === 'team' ? me?.profile?.id : owner) || null, ...body })}
            onTouches={body => goalsApi.partnerTouches(businessId, body)}
            onDomains={goalId => goalsApi.partnerDomains(businessId, goalId)}
            onAddDomain={(goalId, body) => goalsApi.addPartnerDomain(businessId, goalId, body)}
            onUpdateDomain={(goalId, domainId, body) => goalsApi.updatePartnerDomain(businessId, goalId, domainId, body)}
            onDeleteDomain={(goalId, domainId) => goalsApi.deletePartnerDomain(businessId, goalId, domainId)}
            onAllDomains={() => goalsApi.allPartnerDomains(businessId)}
            onResearch={goalId => goalsApi.partnerResearch(businessId, goalId)}
            onRunResearch={goalId => goalsApi.runPartnerResearch(businessId, goalId)}
            onCheckApollo={goalId => goalsApi.checkPartnerApollo(businessId, goalId)}
            csvUrl={goalsApi.apolloCsvUrl(businessId)}
            onApolloMoves={() => goalsApi.apolloMoves(businessId)}
            onApplyApollo={(keys, includeHeld) => goalsApi.applyApolloMoves(businessId, keys, includeHeld)}
            onDismissApollo={key => goalsApi.dismissApolloMove(businessId, key)}
            onOutlookMoves={() => goalsApi.outlookMoves(businessId)}
            onApplyOutlook={(keys, includeHeld) => goalsApi.applyOutlookMoves(businessId, keys, includeHeld)}
            onDismissOutlook={key => goalsApi.dismissOutlookMove(businessId, key)}
            onRecordOutlook={() => goalsApi.recordOutlookTouches(businessId)}
            onRefresh={() => goalsApi.partners(businessId).then(setPartners).catch(e => setError('partners', e))}
            onEvents={goalId => goalsApi.partnerEvents(businessId, { goal_id: goalId })}
            onRank={async (goalId, order) => {
              const ranks = await goalsApi.partnerRank(businessId, goalId, order);
              setPartners(ps => ps.map(p => (p.id in ranks ? { ...p, sort_rank: ranks[p.id] } : p)));
            }}
            teamView={owner === 'team'} focusFilter={partnerFocus} tasksFor={liveWeek ? tasksFor : null}
            onDupeCheck={params => goalsApi.partnerDupeCheck(businessId, params)}
            onCreate={async body => { const g = await goalsApi.createPartner(businessId, { ...body, owner_user_id: owner === 'team' ? null : owner }); setPartners(ps => [...ps, g]); }} />
        )}

        {section === 'pipeline' && view === 'clients' && <ClientsView businessId={businessId} />}
        {section === 'settings' && view === 'team-emails' && me && (
          <TeamEmailsSettings businessId={businessId} meId={meId} isOwner={!!(me.profile?.is_platform_owner || myRole === 'owner')} />
        )}
        {section === 'pipeline' && view === 'campaigns' && me && (
          <CampaignsView businessId={businessId} canEdit={canEdit} members={members} lookup={lookup} meId={meId} />
        )}
        {section === 'pipeline' && view === 'priorities' && me && (
          <PrioritiesView businessId={businessId} canEdit={canEdit} isAdmin={isAdmin} meId={meId} onOpenPeople={company => { writePeopleCompany(company); onNav('pipeline', 'people'); }} />
        )}
        {section === 'pipeline' && view === 'companies' && (
          <PipelineView businessId={businessId} canEdit={canEdit} isAdmin={isAdmin} meId={meId} focusTarget={pipelineTarget}
            onOpenPartner={(id, name) => go({ partners: { ids: [id], open: id, label: name } })} onOpenCompanies={w => go({ companies: w })}
            onOpenPeople={company => { writePeopleCompany(company); onNav('pipeline', 'people'); }} />
        )}
      </main>
      {planOpen && canEdit && planOwner && (
        <PlanWeekDrawer businessId={businessId} weekStart={weekStart} ownerId={planOwner} ownerName={lookup(planOwner).first} teamDefault={owner === 'team'} compact={compact}
          hasPlanned={commitments.some(c => c.owner_user_id === planOwner && c.plan_id && c.status === 'open')}
          onClose={() => setPlanOpen(false)}
          onSaved={() => { setPlanOpen(false); setToast('Focus 5 saved'); loadCommitments(); loadTodos(); loadPlans(); }} />
      )}
      {toast && (
        <div role="status" className="no-print" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 4005, padding: '10px 16px', borderRadius: 10, background: SA.surface2, border: `1px solid ${SA.border}`, color: SA.text, fontSize: 14 }}>{toast}</div>
      )}
    </div>
  );
}
