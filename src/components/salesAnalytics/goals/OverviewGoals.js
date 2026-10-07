import { useState, useEffect } from 'react';
import { SA } from '../theme';
import { laWeekStart } from '../periods';
import { WORKFLOW_STEPS, TOUCH_STATUSES, stepOf, isTouched } from '../../../constants/partnerPipeline';
import { goalsApi } from './goalsApi';
import GoalHero from './GoalHero';
import { labelStyle, subStyle, numStyle, ErrorNote, DrillNumber, addDays } from './goalsUi';

// goals-surface-v1 Stage 5 - the top of Overview: the Goals hero (same
// component and endpoints, Team, this week) and a partner pipeline summary.
// Every number opens Goals -> Partners (Workflow) filtered to what it counts.
const ALL_WEEKS_FROM = '2020-01-06'; // same as GoalsTab's missing-headcount list
const stageKey = p => (stepOf(p.pipeline_status) === null ? 'paused' : WORKFLOW_STEPS[stepOf(p.pipeline_status)].id);

// Touches this week = live status moves into a contact stage (undone ones
// and the undo rows themselves don't count) - the same events the scorecard's
// partner rows read.
export function weekTouches(events) {
  const undone = new Set(events.filter(e => e.event === 'undo').map(e => e.meta?.undid));
  return events.filter(e => e.event !== 'undo' && !undone.has(e.id) && TOUCH_STATUSES.includes(e.to_status));
}

export function PartnerSummary({ partners, touches, onOpen }) {
  const stages = [...WORKFLOW_STEPS, { id: 'paused', label: 'Paused' }].map(s => ({ ...s, ids: partners.filter(p => stageKey(p) === s.id).map(p => p.id) }));
  const p1Untouched = partners.filter(p => p.priority === 1 && !isTouched(p)).map(p => p.id);
  const touchedIds = [...new Set(touches.map(e => e.goal_id))];
  const big = { ...numStyle, fontSize: 24, fontWeight: 600, lineHeight: 1.1, color: SA.text };
  return (
    <section aria-label="Partner pipeline" style={{ background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 14, padding: 16, display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 420px', minWidth: 0 }}>
        <span style={labelStyle}>Partner pipeline · {partners.length} partners</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 8 }}>
          {stages.map(s => (
            <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 10px', borderRadius: 10, background: SA.inset, border: `1px solid ${SA.border}` }}>
              {s.ids.length
                ? <DrillNumber onClick={() => onOpen({ partners: { stage: s.id } })} title={`Open partners at ${s.label}`} style={{ ...numStyle, fontSize: 18, fontWeight: 600, alignSelf: 'flex-start' }}>{s.ids.length}</DrillNumber>
                : <span style={{ ...numStyle, fontSize: 18, fontWeight: 600, color: SA.faint }}>0</span>}
              <span style={{ fontSize: 11, color: SA.muted }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>P1 untouched</span>
          <DrillNumber onClick={() => onOpen({ partners: { ids: p1Untouched, label: 'P1 untouched' } })} title="Open the P1 partners nobody has contacted yet"
            style={{ ...big, color: p1Untouched.length ? SA.warn : SA.text, alignSelf: 'flex-start' }}>{p1Untouched.length}</DrillNumber>
          <span style={{ ...subStyle, fontSize: 12 }}>P1 with no touch yet</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>Touches this week</span>
          <DrillNumber onClick={() => onOpen({ partners: { ids: touchedIds, label: 'Touched this week' } })} title="Open the partners touched this week"
            style={{ ...big, alignSelf: 'flex-start' }}>{touches.length}</DrillNumber>
          <span style={{ ...subStyle, fontSize: 12 }}>on {touchedIds.length} partner{touchedIds.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </section>
  );
}

export default function OverviewGoals({ businessId, canEdit, onOpenGoals, onFocusWidget, onOpenHuddle }) {
  const weekStart = laWeekStart();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [heroKey, setHeroKey] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.all([
      goalsApi.partners(businessId),
      goalsApi.partnerEvents(businessId, { from: weekStart, to: addDays(weekStart, 7) }),
      goalsApi.weekGoals(businessId, weekStart, weekStart, 'commitment'),
      goalsApi.companies(businessId, ALL_WEEKS_FROM, weekStart),
    ]).then(([partners, events, commitments, companies]) => {
      if (live) { setData({ partners, touches: weekTouches(events), commitments, missing: companies.companies.filter(c => c.employees == null).length }); setError(''); }
    }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId, weekStart]);

  // Hero cards from Overview: the same places they open from Goals.
  const drill = id => {
    if (id === 'in_sequence') return onFocusWidget('kpi_tiles');
    if (id === 'engagement') return onOpenHuddle({ feed: null });
    onOpenGoals({ audience: 'view:companies', missing: 'missing', partners: { partners: { stage: 'first_email_sent' } }, meetings: 'score:meetings_set' }[id]);
  };

  return (
    <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
      <GoalHero businessId={businessId} weekStart={weekStart} owner="team" commitments={data?.commitments || []} missingHeadcount={data?.missing || 0}
        canEdit={canEdit} reloadKey={heroKey} onDrill={drill} onGoalSaved={() => setHeroKey(k => k + 1)} />
      {error ? <ErrorNote message={error} />
        : !data ? <span style={{ ...subStyle, fontSize: 13 }}>Loading partners…</span>
        : <PartnerSummary partners={data.partners} touches={data.touches} onOpen={onOpenGoals} />}
    </div>
  );
}
