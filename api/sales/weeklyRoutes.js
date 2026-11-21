import { getSupabase, isMonday, addDays, laMonday } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { hasPii } from './scrubText.js';
import { loadFunnelRows } from './funnelRoutes.js';
import { funnelContext } from './funnelMath.js';
import { loadPartnerData, peopleFirstTouched } from './partnerMetrics.js';
import { lastSyncedValue, targetsFor, firstTouchedGoals } from './goalsReportRoutes.js';
import { loadMembers } from './teamEmails/send.js';
import { buildWeekly, memberRows, pinsMade, weekList, weeklyWindows, clampWeeks, SYNCED, MANUAL_KEYS, MEMBER_KEYS, UNASSIGNED } from './weeklyMetrics.js';

// weekly-funnel-v1 Stage 1 - GET goals/weekly?weeks=12 (Viewer): every registry row as a weekly series with its goals,
// this week on pace and last week against its goal - all from stored rows (0 Apollo, 0 Claude, nothing written); and
// PUT goals/weekly/manual (Member): the ONE write path of a typed number (W5 - last write wins, who and when kept).
const reply = (status, body) => ({ status, body });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
export const NOTE_MAX = 140;

// email-by-member-v1 M2 - ?member=team (default) | <user id> | unassigned | all. A member's read is the SAME registry
// over the rows of the mailboxes sales_mailbox_owners gives that member (MEMBER_KEYS only, goals stay the team's);
// "all" = one row set per sending member, the unassigned mailboxes when there are any, and the team, off one load.
// No mailbox address is in any response - a member is a name, an unmapped mailbox is "Unassigned mailbox".
export async function loadWeekly(supabase, businessId, { weeks, member = 'team', now = Date.now() } = {}) {
  const n = clampWeeks(weeks);
  const today = laDateString(new Date(now));
  const list = weekList(today, n), windows = weeklyWindows(today, n), goalWeeks = [...list, addDays(list[list.length - 1], 7)];
  const [rows, counts, partnerData, flow, goals, firstTouched, manualRows, members, synced, ownerRows] = await Promise.all([
    loadFunnelRows(supabase, businessId),
    selectAllPages(() => supabase.from('sales_email_daily_counts').select('day, mailbox, delivered, hard_bounced, spam_blocked, opened, replied').eq('business_id', businessId).gte('day', list[0])
      .order('day').order('mailbox').order('sequence_id').order('step')),
    loadPartnerData(supabase, businessId),
    selectAllPages(() => supabase.from('sales_flow_events').select('id, kind, at, undone_at').eq('business_id', businessId).eq('kind', 'pin').order('at').order('id')),
    targetsFor(supabase, businessId, 'week', goalWeeks),
    firstTouchedGoals(supabase, businessId, goalWeeks),
    selectAllPages(() => supabase.from('sales_manual_metrics').select('metric_key, week_start, value, entered_by, entered_at, note').eq('business_id', businessId).gte('week_start', list[0]).order('week_start').order('metric_key')),
    loadMembers(supabase, businessId),
    Promise.all(Object.entries(SYNCED).flatMap(([key, metric]) => windows.map(async w => [`${key}|${w.from}|${w.to}`, await lastSyncedValue(supabase, businessId, metric, w.from, w.to)]))),
    supabase.from('sales_mailbox_owners').select('mailbox_email, user_id').eq('business_id', businessId),
  ]);
  const owners = must(ownerRows);
  const ownerOf = new Map(owners.map(o => [o.mailbox_email, o.user_id])), memberIds = new Set(members.map(x => x.userId));
  const senders = members.filter(x => owners.some(o => o.user_id === x.userId)).map(x => ({ id: x.userId, name: x.firstName || 'a member' }));
  const loose = m => !!m && !memberIds.has(ownerOf.get(m));
  const unassigned = new Set([...counts.map(r => r.mailbox), ...rows.delivered.map(d => d.mailbox)].filter(loose)).size;
  const ctxOf = (r, c) => ({
    now,
    pulse: { counts: c, opens: r.events.filter(e => e.event === 'open'), deliveredAt: new Map(r.messages.map(x => [x.apollo_message_id, x.delivered_at])), events: r.calEvents, visits: [], people: peopleFirstTouched(partnerData, null), now },
    funnel: funnelContext(r), partnerData, synced: new Map(synced), pins: pinsMade(flow, partnerData),
    manual: new Map(manualRows.map(x => [`${x.metric_key}|${x.week_start}`, x])),
  });
  const team = () => buildWeekly(ctxOf(rows, counts), { today, weeks: n, goals, firstTouched, names: new Map(members.map(x => [x.userId, x.firstName])) });
  const one = who => {
    const scoped = who.id === UNASSIGNED.id ? memberRows({ rows, counts }, loose) : memberRows({ rows, counts }, m => !!m && ownerOf.get(m) === who.id, who.id);
    return buildWeekly(ctxOf(scoped.rows, scoped.counts), { today, weeks: n, keys: MEMBER_KEYS });
  };
  const frame = { members: senders, unassigned_mailboxes: unassigned };
  if (member === 'team' || member == null || member === '') return reply(200, { ...team(), member: { id: 'team', name: 'Team' }, ...frame });
  if (member === 'all') {
    const t = team(), { metrics, groups, ...head } = t;
    const whos = [...senders, ...(unassigned ? [UNASSIGNED] : [])];
    return reply(200, { ...head, ...frame, rows: [...whos.map(w => ({ ...w, metrics: one(w).metrics })), { id: 'team', name: 'Team', metrics: metrics.filter(x => MEMBER_KEYS.includes(x.key)) }] });
  }
  const found = members.find(x => x.userId === member);
  if (member !== UNASSIGNED.id && !found) return reply(400, { error: 'member must be team, all, unassigned or a member of this workspace' });
  const who = found ? { id: found.userId, name: found.firstName || 'a member' } : UNASSIGNED;
  return reply(200, { ...one(who), member: who, ...frame });
}

export async function weeklyRoute(req, res) {
  try { const r = await loadWeekly(getSupabase(), req.params.businessId, { weeks: req.query.weeks, member: req.query.member }); res.status(r.status).json(r.body); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

// { metric_key, week_start, value, note? } - value null clears the cell (it reads "—"). Only this week and last week
// take a number (Cyrus types Monday's numbers for last week).
export async function saveManual(supabase, { businessId, userId, body, now = Date.now() }) {
  const allowed = ['metric_key', 'week_start', 'value', 'note'];
  const unknown = Object.keys(body || {}).find(k => !allowed.includes(k));
  if (unknown) return reply(400, { error: `unknown field: ${unknown}` });
  const { metric_key, week_start, value } = body || {};
  if (!MANUAL_KEYS.includes(metric_key)) return reply(400, { error: `bad enum: metric_key must be one of ${MANUAL_KEYS.join('|')}` });
  if (!isMonday(week_start)) return reply(400, { error: 'week_start must be a Monday (YYYY-MM-DD)' });
  if (!(value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0))) return reply(400, { error: 'value must be a number >= 0 or null' });
  let note = null;
  if (body.note != null && body.note !== '') {
    if (typeof body.note !== 'string') return reply(400, { error: 'note must be text' });
    note = body.note.trim().replace(/\s+/g, ' ');
    if (note.length > NOTE_MAX) return reply(400, { error: `note must be at most ${NOTE_MAX} characters` });
    if (hasPii(note)) return reply(400, { error: "note can't hold an email address or phone number" });
  }
  const mon = laMonday(laDateString(new Date(now)));
  if (![mon, addDays(mon, -7)].includes(week_start)) return reply(409, { error: 'Only this week and last week take a typed number', code: 'week_closed' });
  const row = must(await supabase.from('sales_manual_metrics').upsert({ business_id: businessId, metric_key, week_start, value, note: note || null, entered_by: userId, entered_at: new Date(now).toISOString() }, { onConflict: 'business_id,metric_key,week_start' })
    .select('metric_key, week_start, value, entered_by, entered_at, note').single());
  return reply(200, { metric: row });
}

export async function manualRoute(req, res) {
  try { const r = await saveManual(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, body: req.body }); res.status(r.status).json(r.body); }
  catch (e) { res.status(500).json({ error: e.message }); }
}
