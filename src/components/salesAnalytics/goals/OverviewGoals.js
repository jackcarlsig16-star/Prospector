import { useState, useEffect } from 'react';
import { SA } from '../theme';
import { laWeekStart } from '../periods';
import { WORKFLOW_STEPS, TOUCH_STATUSES, stepOf, isTouched } from '../../../constants/partnerPipeline';
import { goalsApi } from './goalsApi';
import { labelStyle, subStyle, numStyle, ErrorNote, DrillNumber, addDays, fmt, shortWeek } from './goalsUi';

// overview-home-v1 Stage 1 - the top of Overview: the Goals hero is one
// line here (Goals owns the cards; this answers "how is the engine
// running", Goals answers "am I on plan") and the partner pipeline summary
// stays (Jack 2026-10-08). Every number opens Goals filtered to what it
// counts.
const stageKey = p => (stepOf(p.pipeline_status) === null ? 'paused' : WORKFLOW_STEPS[stepOf(p.pipeline_status)].id);

// Touches this week = live status moves into a contact stage (undone ones
// and the undo rows themselves don't count) - the same events the scorecard's
// partner rows read.
export function weekTouches(events) {
  const undone = new Set(events.filter(e => e.event === 'undo').map(e => e.meta?.undid));
  return events.filter(e => e.event !== 'undo' && !undone.has(e.id) && TOUCH_STATUSES.includes(e.to_status));
}

// hero: GET /goals/hero for this week, team. "12/100" when the goal is set,
// the number alone when it isn't.
export function GoalLine({ hero, weekStart, onOpenGoals, onFocusWidget }) {
  const wk = [...(hero.earlier || []), ...(hero.scorecard?.weeks || [])].find(w => w.week_start === weekStart)?.metrics || {};
  const ft = hero.first_touched || {};
  const people = ft.unit === 'people';
  const of = (v, g) => (g == null ? fmt(v) : `${fmt(v)}/${fmt(g)}`);
  const items = [
    { key: 'first_touched', text: `${of(people ? (ft.people || []).length : wk.partners_first_touched?.value, ft.goal)} ${people ? 'people' : 'partners'} first-touched`, title: 'Open Goals › Partners (Sent)', go: () => onOpenGoals({ partners: { stage: 'first_email_sent' } }) },
    { key: 'meetings', text: `${of(wk.meetings_set?.value ?? 0, wk.meetings_set?.goal)} meetings`, title: 'Open the scorecard row', go: () => onOpenGoals('score:meetings_set') },
    { key: 'in_sequence', text: `${of(wk.total_in_sequence?.value, wk.total_in_sequence?.goal)} in sequence`, title: 'Open the week strip', go: () => onFocusWidget('week_strip') },
  ];
  return (
    <div aria-label="Goals this week" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px', fontSize: 13, color: SA.muted, minHeight: 24 }}>
      <span style={labelStyle}>{shortWeek(weekStart).replace('Wk', 'Week')}</span>
      {items.map(it => (
        <span key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: SA.faint }}>·</span>
          <DrillNumber onClick={it.go} title={it.title} style={{ ...numStyle, color: SA.text }}>{it.text}</DrillNumber>
        </span>
      ))}
      <span style={{ color: SA.faint }}>·</span>
      <DrillNumber onClick={() => onOpenGoals('view:week')} title="Open Goals" style={{ color: SA.link }}>Goals →</DrillNumber>
    </div>
  );
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

export default function OverviewGoals({ businessId, onOpenGoals, onFocusWidget }) {
  const weekStart = laWeekStart();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    Promise.all([
      goalsApi.partners(businessId),
      goalsApi.partnerEvents(businessId, { from: weekStart, to: addDays(weekStart, 7) }),
      goalsApi.hero(businessId, weekStart, null, false),
    ]).then(([partners, events, hero]) => {
      if (live) { setData({ partners, touches: weekTouches(events), hero }); setError(''); }
    }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [businessId, weekStart]);

  return (
    <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
      {error ? <ErrorNote message={error} />
        : !data ? <span style={{ ...subStyle, fontSize: 13 }}>Loading goals…</span>
        : <>
          <GoalLine hero={data.hero} weekStart={weekStart} onOpenGoals={onOpenGoals} onFocusWidget={onFocusWidget} />
          <PartnerSummary partners={data.partners} touches={data.touches} onOpen={onOpenGoals} />
        </>}
    </div>
  );
}
