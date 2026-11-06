import { TOUCH_STATUSES } from '../../../constants/partnerPipeline';

// goals-surface-v1 - this week's live partner touches: status moves into a contact stage, minus the ones undone
// (and the undo rows themselves). Counted on the businesses home page; OverviewGoals (its first home) left with
// dashboard-v3 Stage 4.
export function weekTouches(events) {
  const undone = new Set(events.filter(e => e.event === 'undo').map(e => e.meta?.undid));
  return events.filter(e => e.event !== 'undo' && !undone.has(e.id) && TOUCH_STATUSES.includes(e.to_status));
}
