import { useState, useEffect, useCallback, useMemo } from 'react';
import { SA, SA_TYPE } from '../theme';
import { laWeekStart } from '../periods';
import { roleAtLeast } from '../../../constants/roles';
import { fetchMe } from '../../../utils/authSession';
import useMediaQuery from '../../../utils/useMediaQuery';
import RightRail from '../RightRail';
import Ring, { RingLegend } from '../charts/Ring';
import { goalsApi } from './goalsApi';
import ScorecardTable from './ScorecardTable';
import TodoList, { todoStatus } from './TodoList';
import PartnersView from './PartnersView';
import CompaniesView from './CompaniesView';
import ReportView from './ReportView';
import { exportWidgetCsv } from '../exportCsv';
import {
  cardStyle, labelStyle, h2Style, subStyle, numStyle, Chip, Btn, NeedsMigration, ErrorNote,
  addDays, monthOf, monthName, weekLabel, memberLookup, ownedBy, progressColor, pct, short,
} from './goalsUi';

// sales-goals-v1 REVISION 4 - Goals & Weekly Plan: week picker, right rail
// (views + person filter + summaries), Weekly report (Stage 6, default),
// This week, Partners, Companies; Export = report PDF + 4 CSVs.
// localStorage keys (per viewer conveniences, never shared state):
//   prospector_goals_view  - last view
//   prospector_goals_owner - last person filter, as a first-name slug
const VIEW_KEY = 'prospector_goals_view';
const OWNER_KEY = 'prospector_goals_owner';
const VIEWS = ['report', 'week', 'partners', 'companies'];

const readStored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStored = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
const slugOf = name => name.split(' ')[0].toLowerCase();

export default function GoalsTab({ businessId, onOpenOverview }) {
  const compact = useMediaQuery('(max-width: 1099px)');
  const [weekStart, setWeekStart] = useState(() => laWeekStart());
  const [view, setView] = useState(() => {
    const v = new URLSearchParams(window.location.search).get('gview') || readStored(VIEW_KEY);
    return VIEWS.includes(v) ? v : 'report';
  });
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
  const [errors, setErrors] = useState({});
  const setError = useCallback((key, e) => setErrors(prev => ({ ...prev, [key]: e })), []);

  const lookup = useMemo(() => memberLookup(members), [members]);
  const ownerMember = members.find(m => slugOf(m.name) === ownerSlug);
  const owner = ownerMember ? ownerMember.user_id : 'team';
  const whoLabel = ownerMember ? lookup(owner).first : 'Team';
  const thisWeek = laWeekStart();
  const myRole = me?.memberships?.find(m => m.business_id === businessId)?.role;
  const canEdit = !!me && (me.profile?.is_platform_owner || roleAtLeast(myRole, 'member'));

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
  useEffect(() => { loadCommitments(); }, [loadCommitments]);
  useEffect(() => { loadReport(); }, [loadReport]);
  useEffect(() => { loadKpi(); }, [loadKpi]);
  useEffect(() => {
    goalsApi.weekGoals(businessId, addDays(weekStart, -7), addDays(weekStart, -7), 'todo').then(setLastWeekTodos).catch(() => setLastWeekTodos([]));
  }, [businessId, weekStart]);
  useEffect(() => { loadScorecard(); }, [loadScorecard]);
  useEffect(() => { loadCompanies(); }, [loadCompanies]);
  useEffect(() => {
    goalsApi.cadences(businessId, weekStart, addDays(weekStart, 14)).then(setCadences).catch(e => setError('cadences', e));
  }, [businessId, weekStart, setError]);

  // Selection is remembered per viewer and mirrored in the URL so a link
  // opens the same view (?owner=cyrus&gview=partners).
  useEffect(() => {
    writeStored(VIEW_KEY, view);
    writeStored(OWNER_KEY, ownerSlug);
    const url = new URL(window.location.href);
    url.searchParams.set('gview', view);
    if (ownerSlug === 'team') url.searchParams.delete('owner'); else url.searchParams.set('owner', ownerSlug);
    window.history.replaceState(window.history.state, '', url);
  }, [view, ownerSlug]);

  const people = [
    { id: 'team', name: 'Team', color: SA.accent },
    ...members.map(m => ({ id: slugOf(m.name), name: lookup(m.user_id).first, color: lookup(m.user_id).color })),
  ];

  const myTodos = todos.filter(t => ownedBy(owner, t.owner_user_id));
  const myPartners = partners.filter(p => ownedBy(owner, p.owner_user_id));
  const myCompanies = companies.filter(c => ownedBy(owner, c.sequenced_by));
  const myCadences = cadences.filter(c => ownedBy(owner, c.owner_user_id));
  const myCommitments = commitments.filter(c => ownedBy(owner, c.owner_user_id));
  const todoDone = myTodos.filter(t => todoStatus(t) === 'done').length;
  const todoLive = myTodos.filter(t => todoStatus(t) !== 'dropped').length;

  const views = [
    { id: 'report', name: 'Weekly report', meta: reportData?.report?.status === 'final' ? 'final' : `${myCommitments.length} commitments` },
    { id: 'week', name: 'This week', meta: `${todoDone}/${todoLive} to-dos` },
    { id: 'partners', name: 'Partners', meta: `${myPartners.length} · ${myPartners.filter(p => p.hot).length} hot` },
    { id: 'companies', name: 'Companies', meta: `${myCompanies.length} sequenced` },
  ];

  // Rail summaries
  const ownerParts = [...members.map(m => ({ label: lookup(m.user_id).first, count: companies.filter(c => c.sequenced_by === m.user_id).length, color: lookup(m.user_id).color }))];
  const unowned = companies.filter(c => !members.some(m => m.user_id === c.sequenced_by)).length;
  if (unowned) ownerParts.push({ label: 'Unassigned', count: unowned, color: lookup(null).color });
  const peopleSummary = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <Ring parts={ownerParts} center={String(companies.length)} size={96} stroke={16} track={!companies.length} label="Companies sequenced by owner" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ ...subStyle, fontSize: 12 }}>Companies sequenced, {weekLabel(weekStart).split(' · ')[0].toLowerCase()}</span>
        <RingLegend parts={ownerParts} />
      </div>
    </div>
  );
  const glanceRows = scorecard ? [
    ['Total audience', 'outbound_audience', short],
    ['Total in sequence', 'total_in_sequence', v => v?.toLocaleString('en-US') ?? '—'],
    ['Sequences running', 'sequences_running', v => v ?? '—'],
    ['Open rate', 'open_rate', pct],
  ].map(([name, key, f]) => {
    const m = scorecard.month_total[key];
    const p = m.value != null && m.goal ? m.value / m.goal : null;
    return { name, value: f(m.value), p };
  }) : [];
  const glance = (
    <div style={{ ...cardStyle, padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={labelStyle}>{monthName(monthOf(weekStart))} at a glance{owner !== 'team' ? ' · team' : ''}</span>
      {errors.scorecard?.needsMigration ? <NeedsMigration what="Month at a glance" />
        : errors.scorecard ? <ErrorNote message={errors.scorecard.message} />
        : !scorecard ? <span style={subStyle}>Loading…</span>
        : glanceRows.map(g => (
          <div key={g.name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={subStyle}>{g.name}</span>
              <span style={{ ...numStyle, fontWeight: 600 }}>{g.p == null ? g.value : `${Math.round(g.p * 100)}%`}</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: SA.track }}>
              <div style={{ height: 6, borderRadius: 999, width: `${g.p == null ? 0 : Math.min(100, Math.round(g.p * 100))}%`, background: progressColor(g.p) }} />
            </div>
            {g.p == null && <span style={{ ...subStyle, fontSize: 11 }}>no month goal set</span>}
          </div>
        ))}
    </div>
  );

  // Weekly report: live progress comes from the report endpoint (or the
  // frozen snapshot once final), merged onto the commitment rows.
  const final = reportData?.report?.status === 'final';
  const progressById = new Map(((final ? reportData.report.snapshot?.commitments : reportData?.commitments) || []).map(c => [c.id, c.progress]));
  const reportCommitments = myCommitments.map(c => ({ ...c, target_value: c.target_value == null ? null : Number(c.target_value), progress: progressById.get(c.id) ?? null }));
  const kpi = Object.fromEntries((kpiRows || []).map(r => [r.key, r]));
  const lastDone = lastWeekTodos.filter(t => todoStatus(t) === 'done').length;
  const chip = (k, v, src) => (v == null ? null : { k, v: typeof v === 'number' ? v.toLocaleString('en-US') : v, src });
  const autoChips = {
    s1: [chip('to-dos done last week', `${lastDone} of ${lastWeekTodos.filter(t => todoStatus(t) !== 'dropped').length}`, 'App'), chip('companies sequenced', companies.length, 'Apollo'), chip('positive replies', kpi.positive_responses?.this_week, 'Apollo')],
    s3: [chip('companies in cadence', kpi.target_orgs?.this_week, 'Apollo'), chip('new companies sequenced', companies.length, 'Apollo'), chip('partners tracked', `${partners.length} · ${partners.filter(x => x.priority === 1).length} P1`, 'App')],
    s4: [chip('people in sequence', kpi.dm_contacted?.this_week, 'Apollo'), chip('new companies sequenced', companies.length, 'Apollo')],
    s5: [chip('meetings set this week', kpi.meetings_set?.this_week, 'Manual'), chip('meetings held', kpi.meetings_held?.this_week, 'Manual')],
    s6: [chip('qualified opportunities', kpi.qualified_opps?.this_week, 'Pipeline'), chip('covered lives in pipeline', kpi.covered_lives_pipeline?.this_week, 'Pipeline')],
    s12: [chip('expected launches, 90 days', kpi.launches_90d?.this_week, 'Pipeline')],
    s13: [chip('positive replies this week', kpi.positive_responses?.this_week, 'Apollo')],
  };
  for (const k of Object.keys(autoChips)) autoChips[k] = autoChips[k].filter(Boolean);

  const openTarget = target => {
    if (target === 'overview') return onOpenOverview && onOpenOverview();
    if (target.startsWith('view:')) return setView({ this_week: 'week' }[target.slice(5)] || target.slice(5));
    if (target.startsWith('section:')) {
      setView('report');
      setTimeout(() => document.getElementById(`goals-sec-${target.slice(8)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  };

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

  const rail = (
    <RightRail views={views} view={view} onView={setView} people={people} owner={ownerSlug} onOwner={setOwnerSlug}
      peopleSummary={peopleSummary} compact={compact}>
      {glance}
    </RightRail>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>HomeLover · Command Center</span>
          <h1 style={{ margin: 0, ...SA_TYPE.pageTitle, fontSize: compact ? 28 : 34, color: SA.text }}>Goals &amp; Weekly Plan</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Btn aria-label="Previous week" onClick={() => setWeekStart(w => addDays(w, -7))}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg>
          </Btn>
          <div style={{ height: 44, padding: '0 16px', border: `1px solid ${SA.border}`, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10, background: SA.surface }}>
            <span style={{ fontWeight: 600, ...numStyle }}>{weekLabel(weekStart)}</span>
            <Chip style={{ height: 22 }}>{monthName(monthOf(weekStart))}</Chip>
          </div>
          <Btn aria-label="Next week" onClick={() => setWeekStart(w => addDays(w, 7))}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
          </Btn>
          {weekStart !== thisWeek && <Btn onClick={() => setWeekStart(thisWeek)}>This week</Btn>}
          <div style={{ position: 'relative' }} className="no-print">
            <Btn primary aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen(o => !o)}>Export</Btn>
            {exportOpen && (
              <div role="menu" style={{ position: 'absolute', right: 0, top: 48, zIndex: 20, minWidth: 220, background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 10, padding: 6, display: 'flex', flexDirection: 'column' }}>
                <button role="menuitem" type="button" style={{ all: 'unset', cursor: 'pointer', padding: '10px 12px', borderRadius: 8, color: SA.text }}
                  onClick={() => { setExportOpen(false); setView('report'); setTimeout(() => window.print(), 400); }}>Weekly report PDF</button>
                {exports.map(x => (
                  <button key={x.id} role="menuitem" type="button" disabled={x.disabled} title={x.disabled ? 'Needs the Stage 4 database update' : undefined}
                    style={{ all: 'unset', cursor: x.disabled ? 'default' : 'pointer', padding: '10px 12px', borderRadius: 8, color: x.disabled ? SA.faint : SA.text }}
                    onClick={() => { if (x.disabled) return; setExportOpen(false); x.run(); }}>{x.label}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {compact && rail}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <main style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {errors.members && <ErrorNote message={errors.members.message} />}
          {me && !canEdit && <div style={{ ...subStyle, fontSize: 13 }}>You have view access to this workspace, so Goals is read-only for you.</div>}

          {view === 'report' && (
            <ReportView weekStart={weekStart} report={reportData?.report} reportError={errors.report} sections={reportData?.sections} infra={reportData?.infra}
              commitments={reportCommitments} commitmentsError={errors.commitments} kpiRows={kpiRows} kpiError={errors.kpi} autoChips={autoChips}
              canEdit={canEdit} lookup={lookup} members={members} defaultOwner={owner === 'team' ? me?.profile?.id : owner} onOpen={openTarget}
              onSaveSection={(key, notes) => goalsApi.saveSection(businessId, weekStart, key, notes)}
              onSectionSaved={s => setReportData(d => (d ? { ...d, sections: [...d.sections.filter(x => x.section_key !== s.section_key), s] } : d))}
              onFinalize={async () => { await goalsApi.finalize(businessId, weekStart); await loadReport(); return true; }}
              onReopen={async () => { await goalsApi.reopen(businessId, weekStart); await loadReport(); }}
              onAddCommitment={async body => { await goalsApi.createWeekGoal(businessId, { ...body, kind: 'commitment', week_start: weekStart }); await Promise.all([loadCommitments(), loadReport()]); return true; }}
              onUpdateCommitment={async (goalId, body) => { await goalsApi.updateWeekGoal(businessId, goalId, body); await loadCommitments(); }}
              onCarryCommitments={async () => { const r = await goalsApi.carryOver(businessId, weekStart, 'commitment'); await Promise.all([loadCommitments(), loadReport()]); return r; }}
              onSaveTarget={async body => { await goalsApi.saveTarget(businessId, body); await Promise.all([loadKpi(), loadScorecard()]); }}
              infraHandlers={{
                onAdd: async body => { await goalsApi.createInfra(businessId, { ...body, week_start: weekStart }); await loadReport(); return true; },
                onUpdate: async (itemId, body) => { await goalsApi.updateInfra(businessId, itemId, body); await loadReport(); },
                onDelete: async itemId => { await goalsApi.deleteInfra(businessId, itemId); await loadReport(); },
                onCarry: async () => { const r = await goalsApi.carryInfra(businessId, weekStart); await loadReport(); return r; },
              }} />
          )}

          {view === 'week' && <>
            <ScorecardTable data={scorecard} error={errors.scorecard} weekStart={weekStart} ownerName={owner === 'team' ? null : whoLabel} canEdit={canEdit}
              onSaveTarget={async body => { await goalsApi.saveTarget(businessId, body); await loadScorecard(); }} />
            <TodoList todos={myTodos} lookup={lookup} members={members} whoLabel={whoLabel} defaultOwner={owner === 'team' ? me?.profile?.id : owner}
              canEdit={canEdit} error={errors.todos}
              onToggleStep={async s => {
                const step = await goalsApi.updateStep(businessId, s.id, { done: !s.done });
                setTodos(ts => ts.map(t => (t.id === step.goal_id ? { ...t, steps: t.steps.map(x => (x.id === step.id ? step : x)) } : t)));
              }}
              onAddTodo={async body => {
                const goal = await goalsApi.createWeekGoal(businessId, { ...body, kind: 'todo', week_start: weekStart });
                setTodos(ts => [...ts, { ...goal, steps: [] }]);
                return goal;
              }}
              onAddStep={async (t, text) => {
                const step = await goalsApi.createStep(businessId, t.id, { text, sort_order: t.steps.length });
                setTodos(ts => ts.map(x => (x.id === t.id ? { ...x, steps: [...x.steps, step] } : x)));
              }}
              onCarry={async () => { const r = await goalsApi.carryOver(businessId, weekStart, 'todo'); await loadTodos(); return r; }} />
          </>}

          {view === 'partners' && (
            <PartnersView partners={myPartners} lookup={lookup} members={members} canEdit={canEdit} error={errors.partners}
              onUpdate={async (goalId, body) => { const g = await goalsApi.updatePartner(businessId, goalId, body); setPartners(ps => ps.map(p => (p.id === g.id ? g : p))); }}
              onSignal={(goalId, signal) => goalsApi.partnerSignal(businessId, goalId, signal)}
              onUndo={(goalId, eventId) => goalsApi.partnerUndo(businessId, goalId, eventId)}
              onReplace={g => setPartners(ps => ps.map(p => (p.id === g.id ? g : p)))}
              onCreate={async body => { const g = await goalsApi.createPartner(businessId, { ...body, owner_user_id: owner === 'team' ? null : owner }); setPartners(ps => [...ps, g]); }} />
          )}

          {view === 'companies' && (
            <CompaniesView weekStart={weekStart} companies={myCompanies} cadences={myCadences} lookup={lookup} members={members} owner={owner} whoLabel={whoLabel}
              canEdit={canEdit} error={errors.companies || errors.cadences}
              onSaveEmployees={async (accountId, employees) => {
                const c = await goalsApi.updateCompany(businessId, accountId, { employees });
                setCompanies(cs => cs.map(x => (x.account_id === c.account_id ? { ...x, employees: c.employees } : x)));
                loadScorecard();
              }}
              onCreateCadence={async body => { const c = await goalsApi.createCadence(businessId, body); setCadences(cs => [...cs, c]); }}
              onDeleteCadence={async cadenceId => { await goalsApi.deleteCadence(businessId, cadenceId); setCadences(cs => cs.filter(c => c.id !== cadenceId)); }} />
          )}
        </main>
        {!compact && <div style={{ flex: '0 0 300px', minWidth: 0 }}>{rail}</div>}
      </div>
    </div>
  );
}
