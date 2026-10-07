import { createClient } from '@supabase/supabase-js';
import { stageIndex, ORG_TYPE_ENUM } from './pipelineStages.js';
import { laDateString } from './laDate.js';
import { scoreProspect, huddleSignals, isAutomated, HEAT_BANDS } from './heatScore.js';
import { nextBestAction, SCANNER_CLICK_WITHIN_SECONDS } from './nextBestAction.js';
import { selectAllPages } from '../lib/selectAllPages.js';

// sales-hot-prospects-v1 - server-only access, same posture as every other
// sales_* table (RLS enabled, zero policies).
function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}


const OWNERS = ['jack', 'cyrus', 'unassigned'];
const STATUSES = ['new', 'claimed', 'contacted', 'booked', 'not_now', 'dead'];
const NEXT_ACTIONS = ['call', 'email', 'linkedin', 'send_collateral', 'wait'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEETING_INDEX = stageIndex('meeting');

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r[key])) m.set(r[key], []);
    m.get(r[key]).push(r);
  }
  return m;
}

// GET /huddle - every prospect with a signal, scored, plus what the page
// header and the "Done" recap need. Excluded prospects (bounced,
// unsubscribed, a negative reply class, or already in pipeline at meeting+)
// are counted by reason rather than silently dropped.
export async function huddleRoute(req, res) {
  const supabase = getSupabase();
  const businessId = req.params.businessId;

  // The three big reads are paged: PostgREST caps a plain select at 1,000
  // rows, which used to drop signals silently past that size.
  let paged;
  try {
    paged = await Promise.all([
      selectAllPages(() => supabase.from('sales_prospect_state').select('*').eq('business_id', businessId).order('contact_id')),
      selectAllPages(() => supabase.from('sales_email_messages').select('*').eq('business_id', businessId).order('apollo_message_id')),
      selectAllPages(() => supabase.from('sales_email_activity').select('apollo_message_id,contact_id,event,occurred_at,user_agent,tracking_service').eq('business_id', businessId).order('id')),
    ]);
  } catch (e) { return res.status(500).json({ error: e.message }); }
  const [prospects, messages, events] = paged.map(data => ({ data }));
  const [opps, seqSnap, tags, huddles, statusEvents] = await Promise.all([
    supabase.from('sales_opportunities').select('id,stage,archived_at').eq('business_id', businessId),
    supabase.from('sales_raw_snapshots').select('payload').eq('business_id', businessId).eq('entity', 'sequences').order('captured_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('sales_sequence_tags').select('sequence_id,audience').eq('business_id', businessId),
    supabase.from('sales_huddles').select('huddle_at,started_by').eq('business_id', businessId).order('huddle_at', { ascending: false }).limit(1),
    supabase.from('sales_prospect_events').select('contact_id,to_value,changed_at,changed_by').eq('business_id', businessId).eq('field', 'status')
      .in('to_value', ['contacted', 'booked']).gte('changed_at', new Date(Date.now() - 3 * 864e5).toISOString()),
  ]);
  for (const r of [opps, seqSnap, tags, huddles, statusEvents]) {
    if (r.error) return res.status(500).json({ error: r.error.message });
  }

  const seqById = new Map((seqSnap.data?.payload || []).map(s => [s.id, s]));
  const audienceById = new Map((tags.data || []).map(t => [t.sequence_id, t.audience || 'employer']));
  const oppById = new Map((opps.data || []).map(o => [o.id, o]));
  const messagesByContact = groupBy(messages.data || [], 'contact_id');
  const eventsByContact = groupBy(events.data || [], 'contact_id');
  const excluded = { bounced: 0, unsubscribed: 0, negative_reply: 0, in_pipeline_meeting_plus: 0 };

  const out = [];
  const now = Date.now(), staleMs = HEAT_BANDS.recentDays * 864e5;
  for (const p of prospects.data || []) {
    const msgs = messagesByContact.get(p.contact_id) || [];
    const contactEvents = eventsByContact.get(p.contact_id) || [];
    const scored = scoreProspect(msgs, contactEvents);
    const opp = p.opportunity_id ? oppById.get(p.opportunity_id) : null;

    if (msgs.some(m => m.bounced)) { excluded.bounced++; continue; }
    if (p.email_unsubscribed) { excluded.unsubscribed++; continue; }
    if (scored.excluded_reply_class && !scored.badges.replied) { excluded.negative_reply++; continue; }
    if (opp && !opp.archived_at && stageIndex(opp.stage) >= MEETING_INDEX) { excluded.in_pipeline_meeting_plus++; continue; }

    const latest = [...msgs].sort((a, b) => (b.delivered_at || '').localeCompare(a.delivered_at || ''))[0] || {};
    const seq = seqById.get(latest.sequence_id);
    out.push({
      ...p,
      in_pipeline: !!(opp && !opp.archived_at),
      sequence: latest.sequence_id ? {
        id: latest.sequence_id,
        name: seq ? seq.name : null,
        cohort: seq ? seq.cohort : null,
        audience: audienceById.get(latest.sequence_id) || 'employer',
      } : null,
      step: latest.step ?? null,
      sender: latest.sender || null,
      apollo_url: `https://app.apollo.io/#/contacts/${p.contact_id}`,
      score: scored.score,
      why: scored.why,
      badges: scored.badges,
      last_signal_at: scored.last_signal_at,
      next_best_action: nextBestAction(msgs, contactEvents, scored),
      ...huddleSignals(msgs, contactEvents, scored, now, SCANNER_CLICK_WITHIN_SECONDS),
      // Stale: no signal and nobody touched the row in 7+ days.
      stale: (!scored.last_signal_at || now - Date.parse(scored.last_signal_at) > staleMs) && now - Date.parse(p.updated_at) > staleMs,
    });
  }
  out.sort((a, b) => b.score - a.score);

  const today = laDateString();
  const yesterday = laDateString(new Date(Date.now() - 864e5));
  const done = (statusEvents.data || []).filter(e => [today, yesterday].includes(laDateString(new Date(e.changed_at))));

  // "Since last huddle" strip (sales-huddle-v2). Without a huddle yet: last 24h.
  const lastHuddle = (huddles.data || [])[0] || null;
  const sinceIso = lastHuddle?.huddle_at || new Date(now - 864e5).toISOString();
  const deliveredById = new Map((messages.data || []).map(m => [m.apollo_message_id, m.delivered_at]));
  const recentEvents = (events.data || []).filter(e => e.occurred_at > sinceIso);
  const since = { since: sinceIso, replies: 0, real_clicks: 0, real_opens: 0, bot_hidden: 0, done: 0 };
  for (const e of recentEvents) {
    if (isAutomated(e, deliveredById.get(e.apollo_message_id), SCANNER_CLICK_WITHIN_SECONDS)) since.bot_hidden++;
    else if (e.event === 'click') since.real_clicks++;
    else if (e.event === 'open') since.real_opens++;
  }
  since.replies = (messages.data || []).filter(m => m.replied && m.replied_seen_at && m.replied_seen_at > sinceIso).length;
  const { count: doneSince, error: doneErr } = await supabase.from('sales_prospect_events').select('id', { count: 'exact', head: true })
    .eq('business_id', businessId).eq('field', 'status').in('to_value', ['contacted', 'booked']).gt('changed_at', sinceIso);
  if (doneErr) return res.status(500).json({ error: doneErr.message });
  since.done = doneSince;

  res.status(200).json({
    prospects: out,
    excluded,
    last_huddle: lastHuddle,
    since_last_huddle: since,
    done_recent: done,
    today,
  });
}

// PATCH /prospects/:contactId - only the huddle-owned fields. The DB
// trigger logs each changed field to sales_prospect_events with
// updated_by as "who". Optional `expect: { field: value }` makes it
// conditional (the Huddle's undo uses it): if a field no longer holds the
// expected value - someone changed it since - nothing is written and it's 409.
const PROSPECT_FIELDS = ['owner', 'status', 'next_action', 'next_action_due', 'snooze_until', 'notes'];
export async function updateProspectRoute(req, res) {
  const { expect, ...body } = req.body || {};
  if (expect !== undefined && (typeof expect !== 'object' || expect === null || Object.keys(expect).some(k => !PROSPECT_FIELDS.includes(k)))) {
    return res.status(400).json({ error: `expect must be an object of ${PROSPECT_FIELDS.join('|')}` });
  }
  const payload = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'owner') {
      if (!OWNERS.includes(value)) return res.status(400).json({ error: `owner must be one of ${OWNERS.join('|')}` });
    } else if (key === 'status') {
      if (!STATUSES.includes(value)) return res.status(400).json({ error: `status must be one of ${STATUSES.join('|')}` });
    } else if (key === 'next_action') {
      if (value !== null && !NEXT_ACTIONS.includes(value)) return res.status(400).json({ error: `next_action must be one of ${NEXT_ACTIONS.join('|')} or null` });
    } else if (key === 'next_action_due' || key === 'snooze_until') {
      if (value !== null && (typeof value !== 'string' || !DATE_RE.test(value))) return res.status(400).json({ error: `${key} must be YYYY-MM-DD or null` });
    } else if (key === 'notes') {
      if (value !== null && typeof value !== 'string') return res.status(400).json({ error: 'notes must be a string or null' });
    } else {
      return res.status(400).json({ error: `unknown field: ${key}` });
    }
    payload[key] = value;
  }
  if (!Object.keys(payload).length) return res.status(400).json({ error: 'nothing to update' });

  const supabase = getSupabase();
  let q = supabase.from('sales_prospect_state')
    .update({ ...payload, updated_by: req.auth.user.email, updated_at: new Date().toISOString() })
    .eq('business_id', req.params.businessId)
    .eq('contact_id', req.params.contactId);
  for (const [k, v] of Object.entries(expect || {})) q = v === null ? q.is(k, null) : q.eq(k, v);
  const { data, error } = await q.select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) {
    if (!expect) return res.status(404).json({ error: 'prospect not found' });
    const { data: exists } = await supabase.from('sales_prospect_state').select('contact_id').eq('business_id', req.params.businessId).eq('contact_id', req.params.contactId).maybeSingle();
    return exists ? res.status(409).json({ error: 'Someone changed this since - undo skipped, refresh to see it' }) : res.status(404).json({ error: 'prospect not found' });
  }
  res.status(200).json({ prospect: data });
}

// POST /prospects/:contactId/pipeline - creates the opportunity AND links it
// back via opportunity_id in one request, so the card can't end up with an
// orphan opportunity it doesn't know about. The link write goes through the
// same trigger as every other huddle change, so it's logged with who/when.
const OWNER_NAMES = { jack: 'Jack', cyrus: 'Cyrus' };

export async function addToPipelineRoute(req, res) {
  const { businessId, contactId } = req.params;
  const { org_type: orgType, cohort = null } = req.body || {};
  if (cohort !== null && typeof cohort !== 'string') return res.status(400).json({ error: 'cohort must be a string or null' });
  if (!ORG_TYPE_ENUM.includes(orgType)) return res.status(400).json({ error: `org_type must be one of ${ORG_TYPE_ENUM.join('|')}` });
  const supabase = getSupabase();

  const { data: p, error: pErr } = await supabase.from('sales_prospect_state').select('*')
    .eq('business_id', businessId).eq('contact_id', contactId).maybeSingle();
  if (pErr) return res.status(500).json({ error: pErr.message });
  if (!p) return res.status(404).json({ error: 'prospect not found' });
  if (!p.company || !p.company.trim()) return res.status(400).json({ error: 'prospect has no company - add it in Apollo first' });

  if (p.opportunity_id) {
    const { data: existing, error: oErr } = await supabase.from('sales_opportunities').select('id,archived_at').eq('id', p.opportunity_id).maybeSingle();
    if (oErr) return res.status(500).json({ error: oErr.message });
    if (existing && !existing.archived_at) return res.status(409).json({ error: 'already in pipeline' });
  }

  const { data: opp, error: insErr } = await supabase.from('sales_opportunities').insert({
    business_id: businessId,
    source: 'manual',
    organization: p.company.trim(),
    stage: 'responded',
    org_type: orgType,
    cohort,
    owner: OWNER_NAMES[p.owner] || null,
    champion: [p.name, p.title].filter(Boolean).join(', ') || null,
  }).select().single();
  if (insErr) return res.status(500).json({ error: insErr.message });

  const { data, error } = await supabase.from('sales_prospect_state')
    .update({ opportunity_id: opp.id, updated_by: req.auth.user.email, updated_at: new Date().toISOString() })
    .eq('business_id', businessId).eq('contact_id', contactId).select().single();
  if (error) return res.status(500).json({ error: `opportunity ${opp.id} created but not linked: ${error.message}` });
  res.status(201).json({ prospect: data, opportunity: opp });
}

// POST /huddles - stamps huddle_at, which defines "since last huddle".
export async function startHuddleRoute(req, res) {
  const { data, error } = await getSupabase()
    .from('sales_huddles')
    .insert({ business_id: req.params.businessId, started_by: req.auth.user.email })
    .select('huddle_at,started_by')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ huddle: data });
}

function validateCollateral(body, { partial }) {
  const payload = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (key === 'title') {
      if (typeof value !== 'string' || !value.trim()) return { error: 'title must be a non-empty string' };
    } else if (key === 'url') {
      if (typeof value !== 'string' || !/^https?:\/\/\S+$/.test(value)) return { error: 'url must start with http:// or https://' };
    } else if (key === 'type' || key === 'snippet') {
      if (value !== null && typeof value !== 'string') return { error: `${key} must be a string or null` };
    } else if (key === 'cohort_tags') {
      if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) return { error: 'cohort_tags must be an array of strings' };
    } else {
      return { error: `unknown field: ${key}` };
    }
    payload[key] = value;
  }
  if (!partial && (!payload.title || !payload.url)) return { error: 'title and url are required' };
  return { payload };
}

export async function listCollateralRoute(req, res) {
  const { data, error } = await getSupabase()
    .from('sales_collateral').select('*').eq('business_id', req.params.businessId).order('title');
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ collateral: data });
}

export async function createCollateralRoute(req, res) {
  const { payload, error: vErr } = validateCollateral(req.body, { partial: false });
  if (vErr) return res.status(400).json({ error: vErr });
  const { data, error } = await getSupabase()
    .from('sales_collateral').insert({ ...payload, business_id: req.params.businessId }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ item: data });
}

export async function updateCollateralRoute(req, res) {
  const { payload, error: vErr } = validateCollateral(req.body, { partial: true });
  if (vErr) return res.status(400).json({ error: vErr });
  const { data, error } = await getSupabase()
    .from('sales_collateral').update({ ...payload, updated_at: new Date().toISOString() })
    .eq('business_id', req.params.businessId).eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'collateral not found' });
  res.status(200).json({ item: data });
}

export async function deleteCollateralRoute(req, res) {
  const { data, error } = await getSupabase()
    .from('sales_collateral').delete().eq('business_id', req.params.businessId).eq('id', req.params.id).select('id');
  if (error) return res.status(500).json({ error: error.message });
  if (!data.length) return res.status(404).json({ error: 'collateral not found' });
  res.status(200).json({ deleted: data[0].id });
}

// GET /huddle/feed?days=7&before=<iso>&limit=100 - newest-first opens,
// clicks and replies (sales-huddle-v2 Stage 2). Replies carry the time the
// sync first saw them (replied_seen_at), labelled as such - Apollo has no
// reply time. automated = likely bot open / link scanner (hidden by default
// in the UI). Opens carry nth: which open of that email this was.
export async function huddleFeedRoute(req, res) {
  const businessId = req.params.businessId;
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 31);
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const before = req.query.before;
  if (before && Number.isNaN(Date.parse(before))) return res.status(400).json({ error: 'before must be an ISO timestamp' });
  const fromIso = new Date(Date.now() - days * 864e5).toISOString();
  const supabase = getSupabase();
  try {
    const [events, replies] = await Promise.all([
      selectAllPages(() => supabase.from('sales_email_activity').select('id,apollo_message_id,contact_id,event,step,occurred_at,user_agent,tracking_service')
        .eq('business_id', businessId).gte('occurred_at', fromIso).order('occurred_at', { ascending: false }).order('id')),
      selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id,contact_id,step,reply_class,replied_seen_at')
        .eq('business_id', businessId).eq('replied', true).gte('replied_seen_at', fromIso).order('replied_seen_at', { ascending: false }).order('apollo_message_id')),
    ]);
    const msgIds = [...new Set(events.map(e => e.apollo_message_id))];
    const contactIds = [...new Set([...events, ...replies].map(x => x.contact_id))];
    const [msgs, priorOpens, people] = await Promise.all([
      msgIds.length ? selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id,delivered_at').eq('business_id', businessId).in('apollo_message_id', msgIds).order('apollo_message_id')) : [],
      msgIds.length ? selectAllPages(() => supabase.from('sales_email_activity').select('id,apollo_message_id,occurred_at').eq('business_id', businessId).eq('event', 'open').in('apollo_message_id', msgIds).order('id')) : [],
      contactIds.length ? selectAllPages(() => supabase.from('sales_prospect_state').select('contact_id,name,company,owner').eq('business_id', businessId).in('contact_id', contactIds).order('contact_id')) : [],
    ]);
    const deliveredById = new Map(msgs.map(m => [m.apollo_message_id, m.delivered_at]));
    const opensByMsg = groupBy(priorOpens, 'apollo_message_id');
    const personById = new Map(people.map(p => [p.contact_id, p]));
    const item = (x, extra) => {
      const p = personById.get(x.contact_id) || {};
      return { contact_id: x.contact_id, name: p.name || null, company: p.company || null, owner: p.owner || 'unassigned', step: x.step ?? null, ...extra };
    };
    let items = [
      ...events.map(e => item(e, {
        key: `a:${e.id}`, kind: e.event, at: e.occurred_at,
        automated: isAutomated(e, deliveredById.get(e.apollo_message_id), SCANNER_CLICK_WITHIN_SECONDS),
        nth: e.event === 'open' ? (opensByMsg.get(e.apollo_message_id) || []).filter(o => o.occurred_at <= e.occurred_at).length : null,
      })),
      ...replies.map(m => item(m, { key: `r:${m.apollo_message_id}`, kind: 'reply', at: m.replied_seen_at, seen_at_sync: true, reply_class: m.reply_class || null, automated: false })),
    ].sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
    if (before) items = items.filter(i => i.at < before);
    const page = items.slice(0, limit);
    res.status(200).json({ items: page, next_before: items.length > limit ? page[page.length - 1].at : null, days });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
