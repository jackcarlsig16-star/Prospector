import { getSupabase, laStartOfDayMs, laMonday, validate, fail } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { MONTHLY_CREDIT_CAP, monthSpend } from './visitPull.js';
import { loadPartnerData, peopleFirstTouched } from './partnerMetrics.js';
import { PERIODS, windows, buildPulse, buildEmailPulse } from './pulseMath.js';
import { mailboxLabels } from './explorerRoutes.js';
import { mailboxConnectionProblem } from '../../src/utils/mailboxStatus.js';

// dashboard-v3 Stage 2 - GET goals/pulse?period=&owner= : Home's seven numbers for the period on screen, the window
// before it and the sparkline, all from stored rows (0 Apollo, 0 Claude, nothing written). Owner narrows the email
// numbers to that member's mailboxes (sales_mailbox_owners), meetings to their calendar and first-touched to their
// partners; visitors are team-wide whatever the filter says (the tile is labelled). The title line: the last successful
// sync (when, its Apollo calls) and this month's visitor credits (apollo_credit_spend, every workspace).
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const monthStart = d => `${d.slice(0, 7)}-01`;

// The month goal, or - Stage 5 - the latest week goal on or before this Monday carried forward, the Scorecard's rule
// (goalsReportRoutes firstTouchedGoals): the goal Jack typed in October is a week row, and Home read "8" without its
// "/100" until this fallback.
export async function monthGoal(supabase, businessId, today) {
  const latest = async (period, start) => {
    const { data, error } = await supabase.from('sales_metric_targets').select('period_start, goal, unit')
      .eq('business_id', businessId).eq('period', period).eq('metric_key', 'partners_first_touched').lte('period_start', start).not('goal', 'is', null)
      .order('period_start', { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    return data[0] ? { goal: Number(data[0].goal), unit: data[0].unit || 'people', carried: data[0].period_start !== start } : null;
  };
  return (await latest('month', monthStart(today))) || latest('week', laMonday(today));
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
  const { period = 'this_week', owner, scope = 'home' } = req.query;
  if (!PERIODS.includes(period)) return res.status(400).json({ error: `period must be one of ${PERIODS.join('|')}` });
  if (!['home', 'email'].includes(scope)) return res.status(400).json({ error: 'scope must be home|email' });
  const supabase = getSupabase();
  try {
    if (scope === 'email') return res.json(await loadEmailPulse(supabase, req.params.businessId, { period }));
    if (owner) {
      const v = await validate(supabase, req.params.businessId, { owner: { kind: 'member' } }, { owner });
      if (v.error) return fail(res, v);
    }
    res.json(await loadPulse(supabase, req.params.businessId, { period, owner: owner || null }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}

// scope=email (Stage 4): the Email page's Pulse + mailbox tiles. Mailboxes = Apollo's latest snapshot (cap, connection
// problem) named by their owner (sales_mailbox_owners -> members), never the address.
export async function loadEmailPulse(supabase, businessId, { period }, now = new Date()) {
  const today = laDateString(now);
  const ws = windows(period, today);
  const from = period === 'this_week' ? ws[ws.length - 2].from : ws[0].from;
  const fromIso = new Date(laStartOfDayMs(from)).toISOString();
  const [counts, opens, events, owners, members, mailSnap, sync] = await Promise.all([
    selectAllPages(() => supabase.from('sales_email_daily_counts').select('day, mailbox, delivered, hard_bounced, spam_blocked, opened, replied').eq('business_id', businessId).gte('day', from)
      .order('day').order('mailbox').order('sequence_id').order('step')),
    selectAllPages(() => supabase.from('sales_email_activity').select('id, apollo_message_id, sender, occurred_at, user_agent, tracking_service')
      .eq('business_id', businessId).eq('event', 'open').gte('occurred_at', fromIso).order('id')),
    selectAllPages(() => supabase.from('microsoft_events').select('id, graph_id, ical_uid, user_id, external_domains, start_at, is_cancelled, created_at_graph').eq('business_id', businessId).order('start_at').order('id')),
    must(await supabase.from('sales_mailbox_owners').select('mailbox_email, user_id').eq('business_id', businessId)),
    supabase.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId).not('user_id', 'is', null).order('created_at').then(must),
    supabase.from('sales_raw_snapshots').select('payload, captured_at').eq('business_id', businessId).eq('entity', 'mailboxes').order('captured_at', { ascending: false }).limit(1).maybeSingle().then(must),
    lastSync(supabase, businessId),
  ]);
  const ids = [...new Set(opens.map(o => o.apollo_message_id))];
  const msgs = ids.length ? await selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id, delivered_at').eq('business_id', businessId).in('apollo_message_id', ids).order('apollo_message_id')) : [];
  const ownerOf = new Map(owners.map(o => [o.mailbox_email, o.user_id]));
  const firsts = members.map(m => ({ user_id: m.user_id, first: (m.profile?.display_name || m.name || '').trim().split(/\s+/)[0] || 'Member' }));
  const snap = (mailSnap?.payload || []).map(m => ({ ...m, snapshot_at: mailSnap.captured_at }));
  const emails = [...new Set([...snap.map(m => m.email), ...counts.map(r => r.mailbox)])].filter(Boolean);
  const labels = mailboxLabels(emails, ownerOf, firsts);
  const mailboxes = labels.map(({ email, label }) => { const m = snap.find(x => x.email === email); return { email, key: `mailbox:${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, label, cap: m?.email_daily_threshold ?? null, problem: m ? mailboxConnectionProblem(m) : null }; });
  return buildEmailPulse({ period, today, now: now.getTime(), counts, opens, deliveredAt: new Map(msgs.map(m => [m.apollo_message_id, m.delivered_at])), events, mailboxes, ...sync });
}
