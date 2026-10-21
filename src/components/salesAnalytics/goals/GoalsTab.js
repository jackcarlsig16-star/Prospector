import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { SA, SA_TYPE, SA_SHAPE, SA_THEME_ROOT_ID } from '../theme';
import { laWeekStart, laDateString } from '../periods';
import { FRAME_TOOLS_ID } from '../salesFrame';
import { roleAtLeast } from '../../../constants/roles';
import { fetchMe } from '../../../utils/authSession';
import useMediaQuery from '../../../utils/useMediaQuery';
import Segmented from '../../../ui/Segmented';
import Ring, { RingLegend } from '../charts/Ring';
import { goalsApi, TODOS_CHANGED } from './goalsApi';
import ScorecardTable from './ScorecardTable';
import { todoStatus } from './todoStatus';
import PartnersView from './PartnersView';
import CompaniesView from './CompaniesView';
import PipelineView from './PipelineView';
import ReportView from './ReportView';
import PlanWeekDrawer from './PlanWeekDrawer';
import { PlanNudge } from './PlanNudge';
import ActionsView from './ActionsView';
import { dayTitle } from './todayModel';
import { linkedTo, openTasks } from '../tasks/LinkedTasks';
import { exportWidgetCsv } from '../exportCsv';
import {
  subStyle, numStyle, Chip, Btn, ErrorNote,
  addDays, monthOf, monthName, weekLabel, weekOf, memberLookup, ownedBy, flashTo,
} from './goalsUi';

// sales-ia-v1 - the data hub behind Actions (sales-ia-v2 A1: ActionsView) /
// Pipeline / Dashboard (the v1 reports). `section` is the tab on screen and `view` its
// sub-view (SalesAnalyticsTab owns both, via salesNav.js, and draws the
// sub-view switch); this renders only that section, with its tools portaled
// into the frame row (sales-ia-v2 N2). Export = report PDF + 4 CSVs.
// localStorage key (per viewer convenience, never shared state):
//   prospector_goals_owner - last person filter, as a first-name slug
const OWNER_KEY = 'prospector_goals_owner';
// Earliest week the missing-headcount list reads from (a Monday, before any
// synced data) - the list covers every week.
const ALL_WEEKS_FROM = '2020-01-06';

const readStored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStored = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
const slugOf = name => name.split(' ')[0].toLowerCase();

// Design E - the one table from a link target to its home tab + sub-view.
// Commitment link_target values live in the database, so anything unknown
// still lands somewhere: the Dashboard, with the target logged.
const HOME = {
  'view:report': ['dashboard', 'weekly'], 'view:week': ['actions'], 'view:this_week': ['actions'],
  'view:partners': ['pipeline', 'partners'], 'view:companies': ['dashboard', 'sequenced'], 'view:pipeline': ['pipeline', 'companies'],
  'week:prev': ['actions'], overview: ['dashboard', 'analytics'], section: ['dashboard', 'weekly'], score: ['dashboard', 'scorecard'],
  missing: ['dashboard', 'sequenced'], huddle: ['pipeline', 'people'], plan: ['actions'],
};
export function homeOf(target) {
  if (!target) return null;
  if (target.partners) return { tab: 'pipeline', view: 'partners' };
  if (target.companies) return { tab: 'dashboard', view: 'sequenced' };
  if (typeof target !== 'string') return null;
  const row = HOME[target] || HOME[target.split(':')[0]];
  return row ? { tab: row[0], view: row[1] || null } : null;
}

// initialTarget: a link from the Huddle or Analytics ({ target }, new object
// per click) - same targets as go() below.
export default function GoalsTab({ businessId, section, view, onNav, onOpenOverview, onOpenHuddle, initialTarget, analytics }) {
  const compact = useMediaQuery('(max-width: 1099px)');
  const [weekStart, setWeekStart] = useState(() => laWeekStart());
  const [ownerSlug, setOwnerSlug] = useState(() => new URLSearchParams(window.location.search).get('owner') || readStored(OWNER_KEY) || 'team');
  const [members, setMembers] = useState([]);
  const [me, setMe] = useState(null);
  const [todos, setTodos] = useState([]);
  const [partners, setPartners] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [cadences, setCadences] = useState([]);
  const [scorecard, setScorecard] = useState(null);
  const [commitments, setCommitments] = useState([]);
  const [lastWeekTodos, setLastWeekTodos] = useState([]);
  const [reportData, setReportData] = useState(null);
  const [kpiRows, setKpiRows] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [companyOwnerFocus, setCompanyOwnerFocus] = useState(null);
  const [allCompanies, setAllCompanies] = useState(null);
  const [missingOpen, setMissingOpen] = useState(false);
  const [partnerFocus, setPartnerFocus] = useState(null); // { stage?, tiers?, owner?, ids?, open? } - a link opening Partners filtered
  const [planOpen, setPlanOpen] = useState(false);
  const [plans, setPlans] = useState(null);
  const [toast, setToast] = useState('');
  const [errors, setErrors] = useState({});
  const [toolsSlot, setToolsSlot] = useState(null);
  useEffect(() => { setToolsSlot(document.getElementById(FRAME_TOOLS_ID)); }, []);
  const setError = useCallback((key, e) => setErrors(prev => ({ ...prev, [key]: e })), []);

  const lookup = useMemo(() => memberLookup(members), [members]);
  const ownerMember = members.find(m => slugOf(m.name) === ownerSlug);
  const owner = ownerMember ? ownerMember.user_id : 'team';
  const whoLabel = ownerMember ? lookup(owner).first : 'Team';
  const thisWeek = laWeekStart();
  const myRole = me?.memberships?.find(m => m.business_id === businessId)?.role;
  const canEdit = !!me && (me.profile?.is_platform_owner || roleAtLeast(myRole, 'member'));
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
  const loadCompanies = useCallback(() => goalsApi.companies(businessId, weekStart, weekStart)
    .then(d => { setCompanies(d.companies); setError('companies', null); }).catch(e => setError('companies', e)), [businessId, weekStart, setError]);

  const loadCommitments = useCallback(() => goalsApi.weekGoals(businessId, weekStart, weekStart, 'commitment')
    .then(g => { setCommitments(g); setError('commitments', null); }).catch(e => setError('commitments', e)), [businessId, weekStart, setError]);
  const loadReport = useCallback(() => goalsApi.report(businessId, weekStart)
    .then(d => { setReportData(d); setError('report', null); }).catch(e => { setReportData(null); setError('report', e); }), [businessId, weekStart, setError]);
  const loadKpi = useCallback(() => goalsApi.kpi(businessId, weekStart)
    .then(r => { setKpiRows(r); setError('kpi', null); }).catch(e => { setKpiRows(null); setError('kpi', e); }), [businessId, weekStart, setError]);

  useEffect(() => { loadTodos(); }, [loadTodos]);
  useEffect(() => {
    window.addEventListener(TODOS_CHANGED, loadTodos);
    return () => window.removeEventListener(TODOS_CHANGED, loadTodos);
  }, [loadTodos]);
  useEffect(() => { loadCommitments(); }, [loadCommitments]);
  useEffect(() => { loadReport(); }, [loadReport]);
  useEffect(() => { loadKpi(); }, [loadKpi]);
  useEffect(() => {
    goalsApi.weekGoals(businessId, addDays(weekStart, -7), addDays(weekStart, -7), 'todo').then(setLastWeekTodos).catch(() => setLastWeekTodos([]));
  }, [businessId, weekStart]);
  useEffect(() => { loadScorecard(); }, [loadScorecard]);
  const loadPlans = useCallback(() => { if (planOwner) goalsApi.weekPlans(businessId, planOwner).then(setPlans).catch(() => setPlans(null)); }, [businessId, planOwner]);
  useEffect(() => { loadPlans(); }, [loadPlans]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => { loadCompanies(); }, [loadCompanies]);
  useEffect(() => {
    goalsApi.companies(businessId, ALL_WEEKS_FROM, laWeekStart())
      .then(d => { setAllCompanies(d.companies); setError('allCompanies', null); }).catch(e => setError('allCompanies', e));
  }, [businessId, setError]);
  useEffect(() => {
    goalsApi.cadences(businessId, weekStart, addDays(weekStart, 14)).then(setCadences).catch(e => setError('cadences', e));
  }, [businessId, weekStart, setError]);

  // The person filter is remembered per viewer and mirrored in the URL
  // (?owner=cyrus); the tab and sub-view are SalesAnalyticsTab's (?tab=, ?view=).
  useEffect(() => {
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
  const myCompanies = companies.filter(c => ownedBy(owner, c.sequenced_by));
  const myAllCompanies = allCompanies && allCompanies.filter(c => ownedBy(owner, c.sequenced_by));
  const missingHeadcount = myAllCompanies ? myAllCompanies.filter(c => c.employees == null).length : null;
  const saveEmployees = async (accountId, employees) => {
    const c = await goalsApi.updateCompany(businessId, accountId, { employees });
    const patch = list => list && list.map(x => (x.account_id === c.account_id ? { ...x, employees: c.employees } : x));
    setCompanies(patch);
    setAllCompanies(patch);
    loadScorecard();
  };
  const myCadences = cadences.filter(c => ownedBy(owner, c.owner_user_id));
  const myCommitments = commitments.filter(c => ownedBy(owner, c.owner_user_id));

  const today = laDateString();
  const meId = me?.profile?.id;
  // Sequenced: "Companies sequenced by owner" ring (Design C - moved from the rail).
  const ownerParts = [...members.map(m => ({ id: m.user_id, label: lookup(m.user_id).first, count: companies.filter(c => c.sequenced_by === m.user_id).length, color: lookup(m.user_id).color }))];
  const unowned = companies.filter(c => !members.some(m => m.user_id === c.sequenced_by)).length;
  if (unowned) ownerParts.push({ id: 'unassigned', label: 'Unassigned', count: unowned, color: lookup(null).color });
  // The ring counts the whole team, so a slice picks that owner out on Team
  // (a person filter would hide the other slices).
  const focusCompanies = id => { setCompanyOwnerFocus(id); if (id) setOwnerSlug('team'); };
  const peopleSummary = (
    <section aria-label="Companies sequenced by owner" className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 20, background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusCard }}>
      <Ring parts={ownerParts} center={String(companies.length)} size={96} stroke={16} track={!companies.length} label="Companies sequenced by owner" onSelect={focusCompanies} selected={companyOwnerFocus} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ ...subStyle, fontSize: 12 }}>Companies sequenced, {weekLabel(weekStart).split(' · ')[0].toLowerCase()}</span>
        <RingLegend parts={ownerParts} onSelect={focusCompanies} selected={companyOwnerFocus} />
      </div>
    </section>
  );
  // Weekly report: live progress comes from the report endpoint (or the
  // frozen snapshot once final), merged onto the commitment rows.
  const final = reportData?.report?.status === 'final';
  const progressById = new Map(((final ? reportData.report.snapshot?.commitments : reportData?.commitments) || []).map(c => [c.id, c.progress]));
  const reportCommitments = myCommitments.map(c => ({ ...c, target_value: c.target_value == null ? null : Number(c.target_value), progress: progressById.get(c.id) ?? null }));
  const kpi = Object.fromEntries((kpiRows || []).map(r => [r.key, r]));
  const lastDone = lastWeekTodos.filter(t => todoStatus(t) === 'done').length;
  const partnerBlock = final ? reportData.report.snapshot?.partners : reportData?.partners;
  const pm = partnerBlock?.metrics || {};
  const hw = (final ? reportData.report.snapshot?.huddle : reportData?.huddle) || {};
  const chip = (k, v, src, to) => (v == null ? null : { k, v: typeof v === 'number' ? v.toLocaleString('en-US') : v, src, to });
  const autoChips = {
    s1: [chip('to-dos done last week', `${lastDone} of ${lastWeekTodos.filter(t => todoStatus(t) !== 'dropped').length}`, 'App', 'week:prev'), chip('companies sequenced', companies.length, 'Apollo', 'view:companies'), chip('positive replies', kpi.positive_responses?.this_week, 'Apollo', 'huddle:reply')],
    s3: [chip('companies in cadence', kpi.target_orgs?.this_week, 'Apollo', 'view:companies'), chip('new companies sequenced', companies.length, 'Apollo', 'view:companies'),
      chip('headcount known', `${companies.filter(c => c.employees != null).length} of ${companies.length} companies`, 'App', 'missing'), chip('partners tracked', `${partners.length} · ${partners.filter(x => x.priority === 1).length} P1`, 'App', 'view:partners')],
    s4: [chip('people in sequence', kpi.dm_contacted?.this_week, 'Apollo', 'overview:week_strip'), chip('new companies sequenced', companies.length, 'Apollo', 'view:companies'),
      // first-touch-people-v1: the row follows the goal's unit; a week frozen before people existed says "computed".
      partnerBlock?.first_touched_unit === 'people'
        ? chip(`people first-touched${pm.people_first_touched?.computed ? ' · computed' : ''}`, pm.people_first_touched?.value, 'App')
        : chip('partners first-touched', pm.partners_first_touched?.value, 'App', { partners: { stage: 'first_email_sent' } }),
      chip('partner meetings', pm.partner_meetings?.value, 'App', { partners: { stage: 'meeting_set' } }),
      chip('real opens', hw.real_opens, 'Apollo', 'huddle:open'), chip('real clicks', hw.real_clicks, 'Apollo', 'huddle:click'), chip('replies', hw.replies, 'Apollo', 'huddle:reply'),
      chip('flags handed off', hw.flags_handed_off, 'App', 'huddle:flags'), chip('flags completed', hw.flags_completed, 'App', 'huddle:flags')],
    // Meetings are typed in - there's no list behind them, so no link.
    s5: [chip('meetings set this week', kpi.meetings_set?.this_week, 'Manual'), chip('meetings held', kpi.meetings_held?.this_week, 'Manual')],
    s6: [chip('qualified opportunities', kpi.qualified_opps?.this_week, 'Pipeline', 'view:pipeline'), chip('covered lives in pipeline', kpi.covered_lives_pipeline?.this_week, 'Pipeline', 'view:pipeline')],
    s12: [chip('expected launches, 90 days', kpi.launches_90d?.this_week, 'Pipeline', 'view:pipeline')],
    s13: [chip('positive replies this week', kpi.positive_responses?.this_week, 'Apollo', 'huddle:reply')],
  };
  for (const k of Object.keys(autoChips)) autoChips[k] = autoChips[k].filter(Boolean);

  // Every Goals link goes through here (goals-surface-v1 Stage 4). Targets:
  // 'overview[:<widget>]', 'view:<view>', 'section:<key>', 'missing',
  // 'week:prev', 'score:<metric>', 'huddle[:feed|open|click|reply|flags]',
  // 'plan', { partners: { stage?, tiers?, owner? } }, { companies: <Monday> }.
  // homeOf() picks the tab + sub-view; the rest here is the focus inside it.
  const go = target => {
    const home = homeOf(target);
    if (!home) {
      console.warn(`sales-ia-v2: no home for link target ${JSON.stringify(target)} - opening the Dashboard`);
      return onNav('dashboard', 'weekly');
    }
    if (target.partners) { setPartnerFocus({ ...target.partners }); return onNav(home.tab, home.view); }
    if (target.companies) { setWeekStart(target.companies); return onNav(home.tab, home.view); }
    const [kind, arg] = target.split(/:(.*)/);
    if (kind === 'huddle') return onOpenHuddle && onOpenHuddle(null, !arg ? null : arg === 'flags' ? { flags: true } : { feed: arg === 'feed' ? null : arg });
    if (kind === 'overview') return onOpenOverview && onOpenOverview(arg);
    if (target === 'plan') setPlanOpen(true);
    if (target === 'view:partners') setPartnerFocus({});
    if (target === 'week:prev') setWeekStart(w => addDays(w, -7));
    if (kind === 'section') setTimeout(() => flashTo(`goals-sec-${arg}`), 50);
    if (kind === 'score') setTimeout(() => flashTo(`score-row-${arg}`), 120);
    if (kind === 'missing') { setMissingOpen(true); setTimeout(() => flashTo('goals-missing'), 80); }
    onNav(home.tab, home.view);
  };
  const openMissing = () => go('missing');
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
    { id: 'companies', label: 'Companies CSV', run: () => exportWidgetCsv('goals_companies', myCompanies, [
      { key: 'name', label: 'Company' }, { key: 'employees', label: 'Employees' }, { key: 'cohort', label: 'Cohort' },
      { label: 'Sequenced by', value: c => lookup(c.sequenced_by).name }, { key: 'mailbox_email', label: 'Mailbox' }, { key: 'first_sequenced_at', label: 'First email' }]) },
  ];

  // Design C - what the frame row carries per screen (sales-ia-v2 N2: one
  // fixed-height row, portaled into SalesAnalyticsTab's #sales-frame-tools).
  const showPeople = section === 'actions' || ['partners', 'sequenced', 'weekly', 'scorecard'].includes(view);
  const showWeek = section === 'actions' || ['sequenced', 'weekly', 'scorecard'].includes(view);
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
      {showPeople && <div style={{ flex: 'none' }}><Segmented label="Filter by person" items={people} value={ownerSlug} onChange={slug => { setOwnerSlug(slug); setCompanyOwnerFocus(null); }} /></div>}
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
      {section === 'actions' && canEdit && planOwner && <Btn primary onClick={() => setPlanOpen(true)}>Plan this week</Btn>}
      {section === 'dashboard' && <Btn primary id="sales-export-btn" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen(o => !o)}>Export</Btn>}
    </>
  );
  // The tools row scrolls sideways when narrow, so the Export menu is drawn
  // over the page (fixed) instead of inside it, where it would be clipped.
  const exportMenu = exportOpen && exportRect && createPortal(
    <div role="menu" className="no-print" style={{ position: 'fixed', right: window.innerWidth - exportRect.right, top: exportRect.bottom + 4, zIndex: 4010, minWidth: 220, background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 10, padding: 6, display: 'flex', flexDirection: 'column' }}>
      <button role="menuitem" type="button" style={{ all: 'unset', cursor: 'pointer', padding: '10px 12px', borderRadius: 8, color: SA.text }}
        onClick={() => { setExportOpen(false); onNav('dashboard', 'weekly'); setTimeout(() => window.print(), 400); }}>Weekly report PDF</button>
      {exports.map(x => (
        <button key={x.id} role="menuitem" type="button" disabled={x.disabled} title={x.disabled ? 'Needs the Stage 4 database update' : undefined}
          style={{ all: 'unset', cursor: x.disabled ? 'default' : 'pointer', padding: '10px 12px', borderRadius: 8, color: x.disabled ? SA.faint : SA.text }}
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
          <ActionsView businessId={businessId} canEdit={canEdit} meId={meId} members={members} lookup={lookup} onPlan={planOwner ? () => setPlanOpen(true) : null}
            onOpenFull={row => go(row.type === 'partner' ? { partners: { ids: [row.id], open: row.id, label: row.name } } : 'view:pipeline')} />
        </>}

        {section === 'dashboard' && view === 'weekly' && (
          <ReportView weekStart={weekStart} report={reportData?.report} reportError={errors.report} sections={reportData?.sections} infra={reportData?.infra}
            commitments={reportCommitments} commitmentsError={errors.commitments} kpiRows={kpiRows} kpiError={errors.kpi} autoChips={autoChips} partnerBlock={partnerBlock}
            canEdit={canEdit} lookup={lookup} members={members} defaultOwner={owner === 'team' ? me?.profile?.id : owner} onOpen={go} tasksFor={tasksFor} liveWeek={liveWeek}
            onSaveSection={(key, notes) => goalsApi.saveSection(businessId, weekStart, key, notes)}
            onSectionSaved={s => setReportData(d => (d ? { ...d, sections: [...d.sections.filter(x => x.section_key !== s.section_key), s] } : d))}
            onFinalize={async () => { await goalsApi.finalize(businessId, weekStart); await loadReport(); return true; }}
            onReopen={async () => { await goalsApi.reopen(businessId, weekStart); await loadReport(); }}
            onAddCommitment={async body => { await goalsApi.createWeekGoal(businessId, { ...body, kind: 'commitment', week_start: weekStart }); await Promise.all([loadCommitments(), loadReport()]); return true; }}
            onUpdateCommitment={async (goalId, body) => { await goalsApi.updateWeekGoal(businessId, goalId, body); await loadCommitments(); }}
            onCarryCommitments={async () => { const r = await goalsApi.carryOver(businessId, weekStart, 'commitment'); await Promise.all([loadCommitments(), loadReport()]); return r; }}
            onSaveTarget={async body => { await goalsApi.saveTarget(businessId, body); await Promise.all([loadKpi(), loadScorecard()]); }}
            onPlanWeek={canEdit && planOwner ? () => setPlanOpen(true) : null}
            infraHandlers={{
              onAdd: async body => { await goalsApi.createInfra(businessId, { ...body, week_start: weekStart }); await loadReport(); return true; },
              onUpdate: async (itemId, body) => { await goalsApi.updateInfra(businessId, itemId, body); await loadReport(); },
              onDelete: async itemId => { await goalsApi.deleteInfra(businessId, itemId); await loadReport(); },
              onCarry: async () => { const r = await goalsApi.carryInfra(businessId, weekStart); await loadReport(); return r; },
            }} />
        )}

        {section === 'dashboard' && view === 'scorecard' && (
          <ScorecardTable data={scorecard} error={errors.scorecard} weekStart={weekStart} ownerName={owner === 'team' ? null : whoLabel} canEdit={canEdit} onOpen={go}
            missingHeadcount={missingHeadcount} onFillHeadcount={openMissing}
            onSaveTarget={async body => { await goalsApi.saveTarget(businessId, body); await loadScorecard(); }} />
        )}

        {section === 'dashboard' && view === 'analytics' && analytics}

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

        {section === 'dashboard' && view === 'sequenced' && <>
          {peopleSummary}
          <CompaniesView weekStart={weekStart} companies={myCompanies} cadences={myCadences} lookup={lookup} members={members} owner={owner} whoLabel={whoLabel}
            canEdit={canEdit} error={errors.companies || errors.cadences}
            allCompanies={myAllCompanies} allError={errors.allCompanies} missingOpen={missingOpen} onMissingOpen={setMissingOpen}
            onSaveEmployees={saveEmployees}
            ownerFocus={companyOwnerFocus} onOwnerFocus={setCompanyOwnerFocus} tasksFor={liveWeek ? tasksFor : null}
            onCreateCadence={async body => { const c = await goalsApi.createCadence(businessId, body); setCadences(cs => [...cs, c]); }}
            onDeleteCadence={async cadenceId => { await goalsApi.deleteCadence(businessId, cadenceId); setCadences(cs => cs.filter(c => c.id !== cadenceId)); }} />
        </>}
        {section === 'pipeline' && view === 'companies' && (
          <PipelineView businessId={businessId} canEdit={canEdit} meId={meId}
            onOpenPartner={(id, name) => go({ partners: { ids: [id], open: id, label: name } })} onOpenCompanies={w => { setOwnerSlug('team'); go({ companies: w }); }} />
        )}
      </main>
      {planOpen && canEdit && planOwner && (
        <PlanWeekDrawer businessId={businessId} weekStart={weekStart} ownerId={planOwner} ownerName={lookup(planOwner).first} teamDefault={owner === 'team'} compact={compact}
          hasPlanned={commitments.some(c => c.owner_user_id === planOwner && c.plan_id && c.status === 'open')}
          onClose={() => setPlanOpen(false)}
          onSaved={() => { setPlanOpen(false); setToast('Focus 5 saved'); loadCommitments(); loadTodos(); loadReport(); loadPlans(); }} />
      )}
      {toast && (
        <div role="status" className="no-print" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 4005, padding: '10px 16px', borderRadius: 10, background: SA.surface2, border: `1px solid ${SA.border}`, color: SA.text, fontSize: 14 }}>{toast}</div>
      )}
    </div>
  );
}
