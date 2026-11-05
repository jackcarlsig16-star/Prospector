import { getSupabase, addDays, laStartOfDayMs, validate, fail } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { MONTHLY_CREDIT_CAP, monthSpend } from './visitPull.js';
import { loadPartnerData, peopleFirstTouched } from './partnerMetrics.js';
import { PERIODS, windows, buildPulse } from './pulseMath.js';

// dashboard-v3 Stage 2 - GET goals/pulse?period=&owner= : Home's seven numbers for the period on screen, the window
// before it and the sparkline, all from stored rows (0 Apollo, 0 Claude, nothing written). Owner narrows the email
// numbers to that member's mailboxes (sales_mailbox_owners), meetings to their calendar and first-touched to their
// partners; visitors are team-wide whatever the filter says (the tile is labelled). The title line: the last successful
// sync (when, its Apollo calls) and this month's visitor credits (apollo_credit_spend, every workspace).
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const monthStart = d => `${d.slice(0, 7)}-01`;

async function monthGoal(supabase, businessId, today) {
  const { data, error } = await supabase.from('sales_metric_targets').select('period_start, goal, unit')
    .eq('business_id', businessId).eq('period', 'month').eq('metric_key', 'partners_first_touched').lte('period_start', monthStart(today)).not('goal', 'is', null)
    .order('period_start', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const row = data[0];
  return row ? { goal: Number(row.goal), unit: row.unit || 'people', carried: row.period_start !== monthStart(today) } : null;
}

async function lastSync(supabase, businessId) {
  const { data, error } = await supabase.from('sales_sync_runs').select('finished_at, counts').eq('business_id', businessId).eq('status', 'success')
    .not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return { synced_at: data[0]?.finished_at || null, apollo_calls: data[0]?.counts?.apollo_calls ?? null };
}

export async function loadPulse(supabase, businessId, { period, owner = null }, now = new Date()) {
  const today = laDateString(now);
  const ws = windows(period, today);
  const from = ws[0].from;
  const fromIso = new Date(laStartOfDayMs(from)).toISOString();
  const boxes = owner ? must(await supabase.from('sales_mailbox_owners').select('mailbox_email, user_id').eq('business_id', businessId)).filter(m => m.user_id === owner).map(m => m.mailbox_email) : null;
  const inBoxes = (q, col) => (boxes ? q.in(col, boxes.length ? boxes : ['-']) : q);
  const [counts, opens, events, visits, partnerData, goal, sync, used] = await Promise.all([
    selectAllPages(() => inBoxes(supabase.from('sales_email_daily_counts').select('day, mailbox, delivered, hard_bounced, spam_blocked, opened, replied').eq('business_id', businessId), 'mailbox')
      .order('day').order('mailbox').order('sequence_id').order('step')),
    selectAllPages(() => inBoxes(supabase.from('sales_email_activity').select('id, apollo_message_id, sender, occurred_at, user_agent, tracking_service')
      .eq('business_id', businessId).eq('event', 'open').gte('occurred_at', fromIso), 'sender').order('id')),
    selectAllPages(() => { let q = supabase.from('microsoft_events').select('id, graph_id, ical_uid, user_id, external_domains, start_at, is_cancelled, created_at_graph').eq('business_id', businessId); if (owner) q = q.eq('user_id', owner); return q.order('start_at').order('id'); }),
    selectAllPages(() => supabase.from('web_visits').select('id, pulled_on, company_key').eq('business_id', businessId).gte('pulled_on', from).order('id')),
    loadPartnerData(supabase, businessId),
    monthGoal(supabase, businessId, today),
    lastSync(supabase, businessId),
    monthSpend(supabase, today.slice(0, 7)),
  ]);
  const ids = [...new Set(opens.map(o => o.apollo_message_id))];
  const msgs = ids.length ? await selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id, delivered_at').eq('business_id', businessId).in('apollo_message_id', ids).order('apollo_message_id')) : [];
  return buildPulse({
    period, today, now: now.getTime(), owner, counts, opens, deliveredAt: new Map(msgs.map(m => [m.apollo_message_id, m.delivered_at])), events, visits,
    people: peopleFirstTouched(partnerData, owner), goal, ...sync, credits: { used, cap: MONTHLY_CREDIT_CAP, month: today.slice(0, 7) },
  });
}

export async function pulseRoute(req, res) {
  const { period = 'this_week', owner } = req.query;
  if (!PERIODS.includes(period)) return res.status(400).json({ error: `period must be one of ${PERIODS.join('|')}` });
  const supabase = getSupabase();
  try {
    if (owner) {
      const v = await validate(supabase, req.params.businessId, { owner: { kind: 'member' } }, { owner });
      if (v.error) return fail(res, v);
    }
    res.json(await loadPulse(supabase, req.params.businessId, { period, owner: owner || null }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}

// GET goals/explorer - the Stage 3 Explorer's one read, stubbed to today's series: this week's days from the stored
// daily counts (sent / delivered / replied by send date). Stage 3 fills in the layers, splits and 8-week range.
export async function explorerRoute(req, res) {
  const supabase = getSupabase();
  try {
    const today = laDateString();
    const [{ from }] = windows('this_week', today).slice(-1);
    const rows = await selectAllPages(() => supabase.from('sales_email_daily_counts').select('day, delivered, hard_bounced, spam_blocked, replied')
      .eq('business_id', req.params.businessId).gte('day', from).lte('day', today).order('day').order('mailbox').order('sequence_id').order('step'));
    const days = [];
    for (let d = from; d <= today; d = addDays(d, 1)) {
      const r = rows.filter(x => x.day === d);
      days.push({ day: d, sent: r.reduce((n, x) => n + (x.delivered || 0) + (x.hard_bounced || 0) + (x.spam_blocked || 0), 0), delivered: r.reduce((n, x) => n + (x.delivered || 0), 0), replied: r.reduce((n, x) => n + (x.replied || 0), 0) });
    }
    res.json({ stub: 'Stage 3', today, from, by: 'day', series: days });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}
