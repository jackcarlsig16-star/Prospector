import { useState, useEffect, useCallback } from 'react';
import { SA, SA_SHAPE } from '../theme';
import { laWeekStart, laDateString } from '../periods';
import { goalsApi, TODOS_CHANGED } from './goalsApi';
import { Chip, labelStyle, ErrorNote } from './goalsUi';
import Button from '../../../ui/Button';

// weekly-plan-v1 Stage 2 - "Focus" (planned commitments) and the Monday /
// Tuesday "Plan this week" nudge, shared by Goals and the Huddle.

export const isPlanDay = (today = laDateString()) => [1, 2].includes(new Date(`${today}T12:00:00Z`).getUTCDay());

const nudgeKey = (week, ownerId) => `prospector_plan_nudge_${week}_${ownerId}`;
const readDismissed = (week, ownerId) => { try { return localStorage.getItem(nudgeKey(week, ownerId)) === '1'; } catch { return false; } };

// A planned commitment carries no link; its chip comes from the proposal of
// the same rank in the plan that created it.
export function focusLink(commitment, plans) {
  const plan = (plans || []).find(p => p.id === commitment.plan_id);
  return (plan?.proposals || []).find(p => p.rank === commitment.plan_rank)?.link_name || null;
}

export function PlanNudge({ week, ownerId, ownerName, plans, onPlan }) {
  const [dismissed, setDismissed] = useState(() => readDismissed(week, ownerId));
  useEffect(() => { setDismissed(readDismissed(week, ownerId)); }, [week, ownerId]);
  if (!ownerId || !plans || dismissed || week !== laWeekStart() || !isPlanDay() || plans.some(p => p.week_start === week)) return null;
  const dismiss = () => {
    // prospector_plan_nudge_<week_start>_<owner> = '1' - this week's nudge dismissed (per viewer)
    try { localStorage.setItem(nudgeKey(week, ownerId), '1'); } catch { /* private mode */ }
    setDismissed(true);
  };
  return (
    <div role="status" className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderRadius: SA_SHAPE.radiusInner, border: `1px solid color-mix(in srgb, var(--sa-accent) 40%, var(--sa-border))`, background: SA.surface }}>
      <span style={{ flex: '1 1 220px', fontSize: 14 }}>No plan for {ownerName ? `${ownerName}'s` : 'this'} week yet. Pick the five that matter.</span>
      <Button variant="primary" onClick={onPlan}>Plan this week</Button>
      <Button variant="ghost" onClick={dismiss}>Dismiss</Button>
    </div>
  );
}

// The Huddle's Focus strip for one owner: this week's planned commitments.
// sales-ia-v2 P5: done items fold into "n done ▸" (open to see or untick them)
// instead of staying in the list struck through.
export default function FocusStrip({ businessId, ownerId, ownerName, canEdit, onPlan }) {
  const week = laWeekStart();
  const [goals, setGoals] = useState(null);
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState('');
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(() => {
    if (!ownerId) return;
    Promise.all([goalsApi.weekGoals(businessId, week, week, 'commitment'), goalsApi.weekPlans(businessId, ownerId)])
      .then(([g, p]) => { setGoals(g); setPlans(p); setError(''); }).catch(e => setError(e.message));
  }, [businessId, week, ownerId]);
  useEffect(() => {
    load();
    window.addEventListener(TODOS_CHANGED, load);
    return () => window.removeEventListener(TODOS_CHANGED, load);
  }, [load]);

  const toggle = async c => {
    try {
      const g = await goalsApi.updateWeekGoal(businessId, c.id, { status: c.status === 'done' ? 'open' : 'done' });
      setGoals(gs => gs.map(x => (x.id === g.id ? { ...x, ...g } : x)));
    } catch (e) { setError(e.message); }
  };

  if (!ownerId || !goals) return error ? <div style={{ marginBottom: 16 }}><ErrorNote message={error} /></div> : null;
  const focus = goals.filter(g => g.plan_id && g.owner_user_id === ownerId && g.status !== 'dropped')
    .sort((a, b) => (a.plan_rank ?? 99) - (b.plan_rank ?? 99));
  if (!focus.length) {
    if (!canEdit || !isPlanDay()) return null;
    return (
      <div className="no-print" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PlanNudge week={week} ownerId={ownerId} ownerName={ownerName} plans={plans} onPlan={onPlan} />
        {plans?.some(p => p.week_start === week) && (
          <span style={{ fontSize: 13, color: SA.muted }}>Focus · <button type="button" onClick={onPlan} style={{ all: 'unset', cursor: 'pointer', color: SA.link }}>Plan this week</button></span>
        )}
      </div>
    );
  }
  const doneItems = focus.filter(c => c.status === 'done');
  const done = doneItems.length;
  const item = c => {
    const link = focusLink(c, plans);
    return (
      <li key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minHeight: 36 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 240px', minWidth: 0, cursor: canEdit ? 'pointer' : 'default' }} title={c.plan_reason || undefined}>
          <input type="checkbox" checked={c.status === 'done'} disabled={!canEdit} onChange={() => toggle(c)} style={{ width: 18, height: 18, accentColor: 'var(--sa-accent)', flex: 'none' }} />
          <span style={{ fontSize: 14, color: c.status === 'done' ? SA.muted : SA.text, overflowWrap: 'anywhere' }}>{c.text}</span>
        </label>
        {link && <Chip color={SA.link}>→ {link}</Chip>}
      </li>
    );
  };
  return (
    <section aria-label="Focus" className="no-print" style={{ marginBottom: 16, padding: '12px 16px', borderRadius: SA_SHAPE.radiusInner, border: `1px solid ${SA.border}`, background: SA.surface }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span style={labelStyle}>Focus{ownerName ? ` · ${ownerName}` : ''}</span>
        <span style={{ fontSize: 12, color: SA.muted, fontVariantNumeric: 'tabular-nums' }}>{done} of {focus.length} done</span>
      </div>
      {error && <ErrorNote message={error} />}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {focus.filter(c => c.status !== 'done').map(item)}
        {done > 0 && (
          <li style={{ minHeight: 32, display: 'flex', alignItems: 'center' }}>
            <button type="button" aria-expanded={showDone} onClick={() => setShowDone(o => !o)} style={{ all: 'unset', cursor: 'pointer', fontSize: 13, color: SA.muted, fontVariantNumeric: 'tabular-nums' }}>{done} done {showDone ? '▾' : '▸'}</button>
          </li>
        )}
        {showDone && doneItems.map(item)}
      </ul>
    </section>
  );
}
