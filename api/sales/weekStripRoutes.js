import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { getSupabase, laStartOfDayMs, isDate } from './goalsShared.js';
import { isBotOpen } from './heatScore.js';

// overview-home-v1 Stage 1 - the week strip's tracked half, per LA day,
// from rows the syncs already stored (0 Apollo calls). Apollo's daily counts
// (GET /email-counts) cover every message sent; these cover only the
// messages the hot-prospects sync tracked (sales_email_messages /
// sales_email_activity), so the strip shows them as estimates next to
// Apollo's numbers, never in their place. Replies are dated by when the
// sync first saw them (Apollo gives no reply timestamp), opens by the
// open event, meetings by the partner event.
//
// REVISABLE (Jack 2026-10-08, "classified real replies"): a reply is real
// unless Apollo classed it as an auto-reply; not_interested is a person.
export const AUTO_REPLY_CLASSES = ['out_of_office', 'unsubscribe', 'already_left_company_or_not_right_person'];

const laDay = iso => laDateString(new Date(iso));

export function meetingEventsByDay(events) {
  const undone = new Set(events.filter(e => e.event === 'undo').map(e => e.meta?.undid).filter(Boolean));
  const out = new Map();
  for (const e of events) {
    if (e.event === 'undo' || undone.has(e.id) || e.to_status !== 'meeting_set' || e.from_status === 'meeting_set') continue;
    const day = laDay(e.at);
    out.set(day, (out.get(day) || 0) + 1);
  }
  return out;
}

export async function weekStripRoute(req, res) {
  const { from } = req.query;
  if (!isDate(from)) return res.status(400).json({ error: 'from must be YYYY-MM-DD' });
  const businessId = req.params.businessId;
  const fromIso = new Date(laStartOfDayMs(from)).toISOString();
  const supabase = getSupabase();
  try {
    const [delivered, opens, replies, events, manual] = await Promise.all([
      selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id,delivered_at')
        .eq('business_id', businessId).gte('delivered_at', fromIso).order('apollo_message_id')),
      selectAllPages(() => supabase.from('sales_email_activity').select('id,apollo_message_id,occurred_at,user_agent,tracking_service')
        .eq('business_id', businessId).eq('event', 'open').gte('occurred_at', fromIso).order('id')),
      selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id,reply_class,replied_seen_at')
        .eq('business_id', businessId).eq('replied', true).gte('replied_seen_at', fromIso).order('apollo_message_id')),
      selectAllPages(() => supabase.from('sales_partner_events').select('id,event,from_status,to_status,meta,at')
        .eq('business_id', businessId).order('at').order('id')),
      supabase.from('sales_metric_targets').select('period_start,actual').eq('business_id', businessId)
        .eq('period', 'week').eq('metric_key', 'meetings_set').gte('period_start', from).not('actual', 'is', null).order('period_start'),
    ]);
    if (manual.error) throw new Error(manual.error.message);

    // An open's message may have been delivered before `from`.
    const openIds = [...new Set(opens.map(o => o.apollo_message_id))];
    const openMsgs = openIds.length ? await selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id,delivered_at')
      .eq('business_id', businessId).in('apollo_message_id', openIds).order('apollo_message_id')) : [];
    const deliveredAt = new Map(openMsgs.map(m => [m.apollo_message_id, m.delivered_at]));

    const days = new Map();
    const bump = (day, field, n = 1) => {
      if (day < from) return;
      if (!days.has(day)) days.set(day, { day, tracked_delivered: 0, tracked_opens: 0, tracked_bot_opens: 0, tracked_replies: 0, tracked_real_replies: 0, meetings: 0 });
      days.get(day)[field] += n;
    };
    for (const m of delivered) bump(laDay(m.delivered_at), 'tracked_delivered');
    for (const o of opens) {
      const day = laDay(o.occurred_at);
      bump(day, 'tracked_opens');
      if (isBotOpen(o, deliveredAt.get(o.apollo_message_id))) bump(day, 'tracked_bot_opens');
    }
    for (const r of replies) {
      const day = laDay(r.replied_seen_at);
      bump(day, 'tracked_replies');
      if (!AUTO_REPLY_CLASSES.includes(r.reply_class)) bump(day, 'tracked_real_replies');
    }
    for (const [day, n] of meetingEventsByDay(events)) bump(day, 'meetings', n);

    res.status(200).json({
      days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
      manual_meetings: manual.data.map(r => ({ week_start: r.period_start, actual: Number(r.actual) })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
