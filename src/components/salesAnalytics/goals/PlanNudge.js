import { useState, useEffect } from 'react';
import { SA, SA_SHAPE } from '../theme';
import { laWeekStart, laDateString } from '../periods';
import Button from '../../../ui/Button';

// weekly-plan-v1 Stage 2 - the Monday / Tuesday "Plan this week" nudge on
// Actions (sales-ia-v2 A1: Focus 5 itself is a kind on the Actions list).

export const isPlanDay = (today = laDateString()) => [1, 2].includes(new Date(`${today}T12:00:00Z`).getUTCDay());

const nudgeKey = (week, ownerId) => `prospector_plan_nudge_${week}_${ownerId}`;
const readDismissed = (week, ownerId) => { try { return localStorage.getItem(nudgeKey(week, ownerId)) === '1'; } catch { return false; } };

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
