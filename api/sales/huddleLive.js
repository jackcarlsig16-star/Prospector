import { createClient } from '@supabase/supabase-js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { scoreProspect, isAutomated } from './heatScore.js';
import { nextBestAction, SCANNER_CLICK_WITHIN_SECONDS } from './nextBestAction.js';
import { stageIndex } from './pipelineStages.js';
import { ownerSlug, openFlagRows } from './huddleFlags.js';

// huddle-live-feed-v1 - the Huddle's "Live" tab: one row per person, newest
// real activity first, Apollo's Emails list plus what Prospector knows. No
// new scoring: counts come from the event rows (bot opens / scanner clicks
// excluded by isAutomated, the same rule as the feed) and the next step is
// nextBestAction's label.
function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export const LIVE_FILTERS = ['replied', 'clicked', 'opened2', 'flagged_me'];
export const STALE_SYNC_MS = 2 * 3600e3;
const MEETING_INDEX = stageIndex('meeting');

const laTime = iso => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).toLowerCase();
const laDay = (iso, now) => {
  const d = new Date(iso);
  if (laDateString(d) === laDateString(new Date(now))) return 'today';
  const opts = now - d < 6 * 864e5 ? { weekday: 'short' } : { month: 'short', day: 'numeric' };
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', ...opts }).format(d);
};
const stepsText = steps => {
  const s = [...new Set(steps.filter(x => x != null))].sort((a, b) => a - b);
  if (!s.length) return '';
  return s.length === 1 ? `step ${s[0]}` : `steps ${s[0]}–${s[s.length - 1]}`;
};
const times = n => (n === 1 ? 'once' : `${n}×`);

function insightFor(r, now) {
  if (r.replied) {
    const seen = r.reply_seen_at ? ` — seen ${laDay(r.reply_seen_at, now)} ${laTime(r.reply_seen_at)} at sync` : '';
    const cls = r.reply_class ? ` (${r.reply_class.replace(/_/g, ' ')})` : '';
    return `Replied${cls}${seen} · ${r.handled ? 'handled' : 'not yet handled'}`;
  }
  const parts = [];
  if (r.real_opens) parts.push(`Opened ${times(r.real_opens)}${r.real_opens > 1 ? ` since ${laDay(r.first_real_open_at, now)}` : ''}${r.open_steps ? `, ${r.open_steps.includes('–') ? 'across' : 'on'} ${r.open_steps}` : ''}`);
  if (r.human_clicks) parts.push(`clicked ${times(r.human_clicks)}`);
  if (!parts.length) return 'Only automated opens/clicks (scanner timing or agent) — no sign a person read it';
  const s = parts.join(' · ');
  return s[0].toUpperCase() + s.slice(1);
}

// Pure: every person with an open, click or reply. bot_only rows (no real
// signal) are kept and flagged; the route drops them unless show_bots.
// statusEvents: sales_prospect_events status -> contacted/booked rows.
export function buildLiveRows({ prospects, messages, events, flags, members, statusEvents, seqById, oppById, now = Date.now() }) {
  const by = (rows, key) => { const m = new Map(); for (const r of rows) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); } return m; };
  const msgsBy = by(messages, 'contact_id'), eventsBy = by(events, 'contact_id'), contactedBy = by(statusEvents, 'contact_id');
  const flagBy = new Map(flags.map(f => [f.prospect_contact_id, f]));
  const memberName = new Map(members.map(m => [m.user_id, m.name]));
  const today = laDateString(new Date(now));
  const rows = [];
  for (const p of prospects) {
    const msgs = msgsBy.get(p.contact_id) || [];
    const evs = (eventsBy.get(p.contact_id) || []).filter(e => e.event === 'open' || e.event === 'click');
    const replies = msgs.filter(m => m.replied);
    if (!evs.length && !replies.length) continue;
    const deliveredById = new Map(msgs.map(m => [m.apollo_message_id, m.delivered_at]));
    const stepById = new Map(msgs.map(m => [m.apollo_message_id, m.step]));
    const tagged = evs.map(e => ({ ...e, automated: isAutomated(e, deliveredById.get(e.apollo_message_id), SCANNER_CLICK_WITHIN_SECONDS), step: e.step ?? stepById.get(e.apollo_message_id) ?? null }));
    const real = tagged.filter(e => !e.automated);
    const realOpens = real.filter(e => e.event === 'open').sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    const seen = replies.map(m => m.replied_seen_at).filter(Boolean).sort();
    const replySeenAt = seen.length ? seen[seen.length - 1] : null;
    const timeline = [
      ...tagged.map(e => ({ kind: e.event, at: e.occurred_at, step: e.step, automated: e.automated, message_id: e.apollo_message_id })),
      ...replies.map(m => ({ kind: 'reply', at: m.replied_seen_at, step: m.step ?? null, automated: false, seen_at_sync: true, reply_class: m.reply_class || null, message_id: m.apollo_message_id })),
      ...msgs.filter(m => m.delivered_at).map(m => ({ kind: 'sent', at: m.delivered_at, step: m.step ?? null, automated: false, message_id: m.apollo_message_id })),
    ].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    // Last activity = newest real open/click/reply. A reply with no seen time
    // (pre-column rows) still counts as real activity at its delivery time.
    const realTimes = [...real.map(e => e.occurred_at), ...replies.map(m => m.replied_seen_at || m.delivered_at)].filter(Boolean).sort();
    const botTimes = tagged.filter(e => e.automated).map(e => e.occurred_at).sort();
    const lastReal = realTimes.length ? realTimes[realTimes.length - 1] : null;
    const last = lastReal || botTimes[botTimes.length - 1] || null;
    const lastItem = timeline.find(t => t.at === last && t.kind !== 'sent') || null;
    const lastMsg = msgs.find(m => m.apollo_message_id === lastItem?.message_id) || [...msgs].sort((a, b) => (b.delivered_at || '').localeCompare(a.delivered_at || ''))[0] || {};
    const seq = seqById.get(lastMsg.sequence_id);
    const contacted = (contactedBy.get(p.contact_id) || []).map(e => e.changed_at).sort();
    const lastContactedAt = contacted.length ? contacted[contacted.length - 1] : null;
    const flag = flagBy.get(p.contact_id);
    const opp = p.opportunity_id ? oppById.get(p.opportunity_id) : null;
    const nba = nextBestAction(msgs, evs, scoreProspect(msgs, evs));
    const row = {
      contact_id: p.contact_id, name: p.name || null, company: p.company || null, title: p.title || null, owner: p.owner || 'unassigned',
      status: p.status, linkedin_url: p.linkedin_url || null,
      apollo_url: `https://app.apollo.io/#/contacts/${p.contact_id}`,
      linkedin_search_url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([p.name, p.company].filter(Boolean).join(' '))}`,
      sequence: lastMsg.sequence_id ? { id: lastMsg.sequence_id, name: seq ? seq.name : null } : null,
      step: lastMsg.step ?? null,
      sequence_ids: [...new Set(msgs.map(m => m.sequence_id).filter(Boolean))],
      sent: msgs.filter(m => m.delivered_at).length,
      real_opens: realOpens.length,
      bot_opens: tagged.filter(e => e.event === 'open' && e.automated).length,
      human_clicks: real.filter(e => e.event === 'click').length,
      scanner_clicks: tagged.filter(e => e.event === 'click' && e.automated).length,
      replied: replies.length > 0,
      reply_class: replies.map(m => m.reply_class).find(Boolean) || null,
      reply_seen_at: replySeenAt,
      first_real_open_at: realOpens[0]?.occurred_at || null,
      open_steps: stepsText(realOpens.map(e => e.step)) || null,
      last_activity_at: last,
      last_activity_kind: lastItem?.kind || null,
      bot_only: !lastReal,
      flag: flag ? { goal_id: flag.id, owner_user_id: flag.owner_user_id, owner_name: memberName.get(flag.owner_user_id) || null } : null,
      last_contacted_at: lastContactedAt,
      contacted_today: !!lastContactedAt && laDateString(new Date(lastContactedAt)) === today,
      in_pipeline: !!(opp && !opp.archived_at),
      in_pipeline_meeting_plus: !!(opp && !opp.archived_at && stageIndex(opp.stage) >= MEETING_INDEX),
      unsubscribed: !!p.email_unsubscribed,
      next_step: { id: nba.id, label: nba.label, reason: nba.reason },
      timeline,
    };
    row.handled = !!flag || (!!lastContactedAt && (!replySeenAt || lastContactedAt >= replySeenAt));
    row.insight = insightFor(row, now);
    rows.push(row);
  }
  return rows.sort((a, b) => (b.last_activity_at || '').localeCompare(a.last_activity_at || '') || a.contact_id.localeCompare(b.contact_id));
}

// Pure. sinceIso set = only signals after it (the four numbers' drill rule).
export function matchesFilter(r, filter, { sinceIso = null, userId = null } = {}) {
  const after = t => !sinceIso || (t && t > sinceIso);
  const real = kind => r.timeline.some(t => t.kind === kind && !t.automated && after(t.at));
  if (filter === 'replied') return r.replied && (!sinceIso || after(r.reply_seen_at));
  if (filter === 'clicked') return real('click');
  if (filter === 'opened2') return r.real_opens >= 2 && real('open');
  if (filter === 'flagged_me') return !!r.flag && r.flag.owner_user_id === userId;
  return true;
}

// GET /huddle/live?filter=&since=huddle&owner=<user_id|unassigned>&sequence=&q=&show_bots=1&offset=0&limit=25
export async function liveRoute(req, res) {
  const { businessId } = req.params;
  const { filter, since, owner, sequence, q } = req.query;
  if (filter && !LIVE_FILTERS.includes(filter)) return res.status(400).json({ error: `filter must be one of ${LIVE_FILTERS.join('|')}` });
  if (since && since !== 'huddle') return res.status(400).json({ error: 'since must be huddle' });
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
  const showBots = req.query.show_bots === '1';
  const supabase = getSupabase();
  try {
    const [prospects, messages, events, goalRows, statusEvents] = await Promise.all([
      selectAllPages(() => supabase.from('sales_prospect_state').select('contact_id,name,title,company,linkedin_url,email_unsubscribed,owner,status,opportunity_id').eq('business_id', businessId).order('contact_id')),
      selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id,contact_id,sequence_id,step,delivered_at,replied,reply_class,replied_seen_at').eq('business_id', businessId).order('apollo_message_id')),
      selectAllPages(() => supabase.from('sales_email_activity').select('id,apollo_message_id,contact_id,step,event,occurred_at,user_agent,tracking_service').eq('business_id', businessId).in('event', ['open', 'click']).order('id')),
      selectAllPages(() => supabase.from('sales_week_goals').select('id,owner_user_id,status,carried_from_id,prospect_contact_id,week_start').eq('business_id', businessId).not('prospect_contact_id', 'is', null).order('week_start', { ascending: false }).order('id')),
      selectAllPages(() => supabase.from('sales_prospect_events').select('id,contact_id,changed_at').eq('business_id', businessId).eq('field', 'status').in('to_value', ['contacted', 'booked']).order('id')),
    ]);
    const [members, opps, seqSnap, huddles, runs] = await Promise.all([
      supabase.from('business_members').select('user_id,name').eq('business_id', businessId),
      supabase.from('sales_opportunities').select('id,stage,archived_at').eq('business_id', businessId),
      supabase.from('sales_raw_snapshots').select('payload').eq('business_id', businessId).eq('entity', 'sequences').order('captured_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('sales_huddles').select('huddle_at').eq('business_id', businessId).order('huddle_at', { ascending: false }).limit(1),
      supabase.from('sales_sync_runs').select('status,started_at,finished_at').eq('business_id', businessId).neq('trigger', 'test').order('started_at', { ascending: false }).limit(10),
    ]);
    for (const r of [members, opps, seqSnap, huddles, runs]) if (r.error) throw new Error(r.error.message);

    const now = Date.now();
    // A sync with no row for it (e.g. a newer one that died mid-run) never counts as fresh.
    const done = runs.data.find(r => r.finished_at && ['success', 'partial'].includes(r.status)) || null;
    const syncedAt = done?.finished_at || null;
    const sync = {
      synced_at: syncedAt,
      stale: !syncedAt || now - Date.parse(syncedAt) > STALE_SYNC_MS,
      running: runs.data.some(r => r.status === 'running' && r.started_at > (done?.started_at || '')),
    };
    const sinceIso = huddles.data[0]?.huddle_at || new Date(now - 864e5).toISOString();
    const seqById = new Map((seqSnap.data?.payload || []).map(s => [s.id, s]));
    const oppById = new Map((opps.data || []).map(o => [o.id, o]));
    const all = buildLiveRows({ prospects, messages, events, flags: openFlagRows(goalRows), members: members.data, statusEvents, seqById, oppById, now });

    const userId = req.auth.user.id;
    const humanRows = all.filter(r => !r.bot_only);
    const numbers = Object.fromEntries(LIVE_FILTERS.map(f => [f, humanRows.filter(r => matchesFilter(r, f, { sinceIso: f === 'flagged_me' ? null : sinceIso, userId })).length]));

    let ownerSlugFilter = null;
    if (owner && owner !== 'unassigned') {
      const m = members.data.find(x => x.user_id === owner);
      if (!m) return res.status(400).json({ error: 'owner must be a member user id or unassigned' });
      ownerSlugFilter = ownerSlug(m.name);
    }
    const needle = (q || '').trim().toLowerCase();
    const rows = all.filter(r => (showBots || !r.bot_only)
      && (!filter || matchesFilter(r, filter, { sinceIso: since === 'huddle' && filter !== 'flagged_me' ? sinceIso : null, userId }))
      && (!owner || (owner === 'unassigned' ? r.owner === 'unassigned' : r.owner === ownerSlugFilter))
      && (!sequence || r.sequence_ids.includes(sequence))
      && (!needle || `${r.name || ''} ${r.company || ''}`.toLowerCase().includes(needle)));
    const page = rows.slice(offset, offset + limit);
    const seqIds = [...new Set(humanRows.flatMap(r => r.sequence_ids))];
    res.status(200).json({
      rows: page,
      total: rows.length,
      next_offset: offset + limit < rows.length ? offset + limit : null,
      numbers,
      since: sinceIso,
      bot_only_count: all.length - humanRows.length,
      sequences: seqIds.map(id => ({ id, name: seqById.get(id)?.name || null })).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
      sync,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
