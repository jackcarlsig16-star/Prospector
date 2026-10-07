import { selectAllPages } from '../lib/selectAllPages.js';
import { laStartOfDayMs, addDays } from './goalsShared.js';
import { isAutomated } from './heatScore.js';
import { SCANNER_CLICK_WITHIN_SECONDS } from './nextBestAction.js';
import { FLAG_CATEGORY } from './huddleFlags.js';

// sales-huddle-v2 Stage 4 - Huddle numbers for one LA week, for the weekly
// report's §4 chips (and its finalize snapshot). Real = not a likely bot
// open / link scanner (isAutomated, same rule as the feed). Replies count by
// when the sync first saw them. weekEngagement is the email half alone, for
// the goal hero's 6-week trend, which never needs the flag to-dos.
export async function weekEngagement(supabase, businessId, weekStart) {
  const fromIso = new Date(laStartOfDayMs(weekStart)).toISOString();
  const toIso = new Date(laStartOfDayMs(addDays(weekStart, 7))).toISOString();
  const [events, replies] = await Promise.all([
    selectAllPages(() => supabase.from('sales_email_activity').select('id,apollo_message_id,event,occurred_at,user_agent,tracking_service')
      .eq('business_id', businessId).gte('occurred_at', fromIso).lt('occurred_at', toIso).order('id')),
    selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id')
      .eq('business_id', businessId).eq('replied', true).gte('replied_seen_at', fromIso).lt('replied_seen_at', toIso).order('apollo_message_id')),
  ]);
  const msgIds = [...new Set(events.map(e => e.apollo_message_id))];
  const msgs = msgIds.length ? await selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id,delivered_at')
    .eq('business_id', businessId).in('apollo_message_id', msgIds).order('apollo_message_id')) : [];
  const delivered = new Map(msgs.map(m => [m.apollo_message_id, m.delivered_at]));
  const real = events.filter(e => !isAutomated(e, delivered.get(e.apollo_message_id), SCANNER_CLICK_WITHIN_SECONDS));
  return {
    real_opens: real.filter(e => e.event === 'open').length,
    real_clicks: real.filter(e => e.event === 'click').length,
    replies: replies.length,
  };
}

// Flags handed off = flag to-dos created that week (carried copies don't
// count again); completed = flag to-dos marked done that week.
export async function huddleWeekCounts(supabase, businessId, weekStart) {
  const fromIso = new Date(laStartOfDayMs(weekStart)).toISOString();
  const toIso = new Date(laStartOfDayMs(addDays(weekStart, 7))).toISOString();
  const [engagement, flags] = await Promise.all([
    weekEngagement(supabase, businessId, weekStart),
    selectAllPages(() => supabase.from('sales_week_goals').select('id,created_at,completed_at,status,carried_from_id')
      .eq('business_id', businessId).eq('category', FLAG_CATEGORY).not('prospect_contact_id', 'is', null).order('id')),
  ]);
  const inWeek = iso => iso && iso >= fromIso && iso < toIso;
  return {
    ...engagement,
    flags_handed_off: flags.filter(f => !f.carried_from_id && inWeek(f.created_at)).length,
    flags_completed: flags.filter(f => f.status === 'done' && inWeek(f.completed_at)).length,
  };
}
