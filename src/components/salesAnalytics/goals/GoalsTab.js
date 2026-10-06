import { useState, useEffect, useCallback, useMemo } from 'react';
import { SA, SA_TYPE } from '../theme';
import { laWeekStart } from '../periods';
import { roleAtLeast } from '../../../constants/roles';
import { fetchMe } from '../../../utils/authSession';
import RightRail from '../RightRail';
import Ring, { RingLegend } from '../charts/Ring';
import { goalsApi } from './goalsApi';
import ScorecardTable from './ScorecardTable';
import TodoList, { todoStatus } from './TodoList';
import PartnersView from './PartnersView';
import CompaniesView from './CompaniesView';
import {
  cardStyle, labelStyle, h2Style, subStyle, numStyle, Chip, Btn, NeedsMigration, ErrorNote,
  addDays, monthOf, monthName, weekLabel, memberLookup, ownedBy, progressColor, pct, short,
} from './goalsUi';

// sales-goals-v1 REVISION 4 Stage 5 - Goals & Weekly Plan shell: week
// picker, right rail (views + person filter + summaries), This week,
// Partners, Companies. The Weekly report view is Stage 6.
// localStorage keys (per viewer conveniences, never shared state):
//   prospector_goals_view  - last view
//   prospector_goals_owner - last person filter, as a first-name slug
const VIEW_KEY = 'prospector_goals_view';
const OWNER_KEY = 'prospector_goals_owner';
const VIEWS = ['report', 'week', 'partners', 'companies'];

const readStored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStored = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
const slugOf = name => name.split(' ')[0].toLowerCase();

function useCompact() {
  const query = '(max-width: 1099px)';
  const [compact, setCompact] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = e => setCompact(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return compact;
}

export default function GoalsTab({ businessId }) {
  const compact = useCompact();
  const [weekStart, setWeekStart] = useState(() => laWeekStart());
  const [view, setView] = useState(() => {
    const v = new URLSearchParams(window.location.search).get('gview') || readStored(VIEW_KEY);
    return VIEWS.includes(v) ? v : 'week';
  });
  const [ownerSlug, setOwnerSlug] = useState(() => new URLSearchParams(window.location.search).get('owner') || readStored(OWNER_KEY) || 'team');
  const [members, setMembers] = useState([]);
  const [me, setMe] = useState(null);
  const [todos, setTodos] = useState([]);
  const [partners, setPartners] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [cadences, setCadences] = useState([]);
  const [scorecard, setScorecard] = useState(null);
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

  useEffect(() => { loadTodos(); }, [loadTodos]);
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
  const todoDone = myTodos.filter(t => todoStatus(t) === 'done').length;
  const todoLive = myTodos.filter(t => todoStatus(t) !== 'dropped').length;

  const views = [
    { id: 'report', name: 'Weekly report', meta: 'Stage 6' },
    { id: 'week', name: 'This week', meta: `${todoDone}/${todoLive} to-dos` },
    { id: 'partners', name: 'Partners', meta: `${myPartners.filter(p => p.priority === 1).length} P1` },
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
        </div>
      </header>

      {compact && rail}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <main style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          {errors.members && <ErrorNote message={errors.members.message} />}
          {me && !canEdit && <div style={{ ...subStyle, fontSize: 13 }}>You have view access to this workspace, so Goals is read-only for you.</div>}

          {view === 'report' && (
            <section style={cardStyle}>
              <span style={labelStyle}>Seif &amp; Jack weekly meeting · {weekLabel(weekStart)}</span>
              <h2 style={{ ...h2Style, marginTop: 4 }}>Weekly report</h2>
              <p style={{ ...subStyle, margin: '8px 0 0' }}>The fillable report, KPI table, finalize and PDF arrive in the next build stage (Stage 6). Commitments, to-dos, partners and companies are live in the other views.</p>
            </section>
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
