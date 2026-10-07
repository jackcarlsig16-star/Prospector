import { selectAllPages } from '../lib/selectAllPages.js';
import { laStartOfDayMs, addDays } from './goalsShared.js';
import { TOUCH_STATUSES, FIRST_TOUCH_TYPES } from '../../src/constants/partnerPipeline.js';

// sales-partners-pipeline-v1 Stage 4 - partner scorecard numbers, computed
// from sales_partner_events (nothing typed). Used by the scorecard and the
// weekly report so both show the same counts.
//
//   partners_first_touched  partners whose FIRST touch falls in the week (flow):
//                           a move into a contact stage or a logged email/call/
//                           LinkedIn/meeting touch (partner-touch-log-v1), so a
//                           touch logged late counts in the week it happened
//   partner_meetings        moves to "Meeting set" in the week (flow)
//   tier1_touched_pct       Tier 1 partners touched by week end / Tier 1 total (stock)
//   partners_pilot_live     partners at Proposal/pilot or Live at week end (stock)
//
// Undone clicks don't count. Status at a past moment is rebuilt from the
// events (an undo records the restored status as its to_status), so later
// clicks don't rewrite an earlier week. Person filter = the partner's owner.
export const PARTNER_METRICS = ['partners_first_touched', 'tier1_touched_pct', 'partner_meetings', 'partners_pilot_live'];
export const PARTNER_FLOWS = ['partners_first_touched', 'partner_meetings'];

export async function loadPartnerData(supabase, businessId) {
  const [partners, events] = await Promise.all([
    selectAllPages(() => supabase.from('sales_goals').select('id, owner_user_id, tier, pipeline_status')
      .eq('business_id', businessId).eq('goal_type', 'partnership').is('archived_at', null).order('id')),
    selectAllPages(() => supabase.from('sales_partner_events').select('id, goal_id, event, from_status, to_status, touch_type, meta, at')
      .eq('business_id', businessId).order('at').order('id')),
  ]);
  const undone = new Set(events.filter(e => e.event === 'undo').map(e => e.meta?.undid).filter(Boolean));
  const byGoal = new Map();
  for (const e of events) { if (!byGoal.has(e.goal_id)) byGoal.set(e.goal_id, []); byGoal.get(e.goal_id).push(e); }
  return { partners, events, undone, byGoal };
}

// A touch logged late is dated in the past but moved the stage today, so the
// rebuilt chain can lag; a week that hasn't ended yet uses the real stage.
function statusAt(partner, goalEvents, ms, nowMs = Date.now()) {
  if (ms > nowMs) return partner.pipeline_status;
  const changes = (goalEvents || []).filter(e => e.to_status);
  const before = changes.filter(e => Date.parse(e.at) < ms);
  if (before.length) return before[before.length - 1].to_status;
  return changes.length ? changes[0].from_status : partner.pipeline_status;
}

export const isContact = e => TOUCH_STATUSES.includes(e.to_status) || (e.event === 'touch' && FIRST_TOUCH_TYPES.includes(e.touch_type));

// The partner's earliest live contact (a move into a contact stage or a
// counted touch) - the week it falls in is the partner's first-touched week.
export function firstContactEvent(data, goalId) {
  return (data.byGoal.get(goalId) || [])
    .filter(e => !data.undone.has(e.id) && e.event !== 'undo' && isContact(e))
    .reduce((min, e) => (!min || Date.parse(e.at) < Date.parse(min.at) ? e : min), null);
}

export function partnerWeekMetrics(data, weekStart, ownerUserId, nowMs = Date.now()) {
  const startMs = laStartOfDayMs(weekStart), endMs = laStartOfDayMs(addDays(weekStart, 7));
  const mine = data.partners.filter(p => !ownerUserId || p.owner_user_id === ownerUserId);
  const ids = new Set(mine.map(p => p.id));
  const live = e => !data.undone.has(e.id) && ids.has(e.goal_id) && e.event !== 'undo';
  const inWeek = e => { const t = Date.parse(e.at); return t >= startMs && t < endMs; };
  const moves = to => data.events.filter(e => live(e) && e.to_status === to && inWeek(e));

  const tier1 = mine.filter(p => p.tier === '1');
  const touched = tier1.filter(p => {
    const ev = data.byGoal.get(p.id) || [];
    return TOUCH_STATUSES.includes(statusAt(p, ev, endMs, nowMs))
      || ev.some(e => live(e) && isContact(e) && Date.parse(e.at) < endMs);
  });
  return {
    partners_first_touched: { value: mine.filter(p => { const f = firstContactEvent(data, p.id); return f && inWeek(f); }).length },
    partner_meetings: { value: moves('meeting_set').length },
    tier1_touched_pct: { value: tier1.length ? touched.length / tier1.length : null, touched: touched.length, total: tier1.length },
    partners_pilot_live: { value: mine.filter(p => ['proposal_pilot', 'live'].includes(statusAt(p, data.byGoal.get(p.id), endMs, nowMs))).length },
  };
}

// Current pipeline status × owner, for the weekly report's PDF table.
export function partnerBreakdown(data) {
  const out = {};
  for (const p of data.partners) {
    const owner = p.owner_user_id || 'unassigned';
    const status = p.pipeline_status || 'not_started';
    out[owner] = out[owner] || {};
    out[owner][status] = (out[owner][status] || 0) + 1;
  }
  return out;
}

export const partnerReportBlock = (data, weekStart) => ({ metrics: partnerWeekMetrics(data, weekStart, null), by_owner: partnerBreakdown(data) });
