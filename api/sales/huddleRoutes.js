import { createClient } from '@supabase/supabase-js';
import { isAllowlistedBusiness } from './allowlist.js';
import { stageIndex, ORG_TYPE_ENUM } from './pipelineStages.js';
import { laDateString } from './laDate.js';
import { scoreProspect } from './heatScore.js';
import { nextBestAction } from './nextBestAction.js';

// sales-hot-prospects-v1 - server-only access, same posture as every other
// sales_* table (RLS enabled, zero policies).
function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function checkAllowlist(req, res) {
  if (!isAllowlistedBusiness(req.params.businessId)) {
    res.status(403).json({ error: 'business is not allowlisted for sales analytics' });
    return false;
  }
  return true;
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
  if (!checkAllowlist(req, res)) return;
  const supabase = getSupabase();
  const businessId = req.params.businessId;

  const [prospects, messages, events, opps, seqSnap, tags, huddles, statusEvents] = await Promise.all([
    supabase.from('sales_prospect_state').select('*').eq('business_id', businessId),
    supabase.from('sales_email_messages').select('*').eq('business_id', businessId),
    supabase.from('sales_email_activity').select('apollo_message_id,contact_id,event,occurred_at,user_agent,tracking_service').eq('business_id', businessId),
    supabase.from('sales_opportunities').select('id,stage,archived_at').eq('business_id', businessId),
    supabase.from('sales_raw_snapshots').select('payload').eq('business_id', businessId).eq('entity', 'sequences').order('captured_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('sales_sequence_tags').select('sequence_id,audience').eq('business_id', businessId),
    supabase.from('sales_huddles').select('huddle_at,started_by').eq('business_id', businessId).order('huddle_at', { ascending: false }).limit(1),
    supabase.from('sales_prospect_events').select('contact_id,to_value,changed_at,changed_by').eq('business_id', businessId).eq('field', 'status')
      .in('to_value', ['contacted', 'booked']).gte('changed_at', new Date(Date.now() - 3 * 864e5).toISOString()),
  ]);
  for (const r of [prospects, messages, events, opps, seqSnap, tags, huddles, statusEvents]) {
    if (r.error) return res.status(500).json({ error: r.error.message });
  }

  // PostgREST's default max-rows is 1000 - a full page means the list may be
  // cut off, which would silently drop signals. Surfaced, not hidden.
  const warnings = Object.entries({ prospects, messages, events })
    .filter(([, r]) => (r.data || []).length >= 1000)
    .map(([name]) => `${name} hit the 1000-row read limit - some data may be missing`);

  const seqById = new Map((seqSnap.data?.payload || []).map(s => [s.id, s]));
  const audienceById = new Map((tags.data || []).map(t => [t.sequence_id, t.audience || 'employer']));
  const oppById = new Map((opps.data || []).map(o => [o.id, o]));
  const messagesByContact = groupBy(messages.data || [], 'contact_id');
  const eventsByContact = groupBy(events.data || [], 'contact_id');
  const excluded = { bounced: 0, unsubscribed: 0, negative_reply: 0, in_pipeline_meeting_plus: 0 };

  const out = [];
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
    });
  }
  out.sort((a, b) => b.score - a.score);

  const today = laDateString();
  const yesterday = laDateString(new Date(Date.now() - 864e5));
  const done = (statusEvents.data || []).filter(e => [today, yesterday].includes(laDateString(new Date(e.changed_at))));

  res.status(200).json({
    prospects: out,
    excluded,
    last_huddle: (huddles.data || [])[0] || null,
    done_recent: done,
    today,
    warnings,
  });
}

// PATCH /prospects/:contactId - only the huddle-owned fields. The DB
// trigger logs each changed field to sales_prospect_events with
// updated_by as "who".
export async function updateProspectRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  const payload = {};
  for (const [key, value] of Object.entries(req.body || {})) {
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
    } else if (key === 'updated_by') {
      if (typeof value !== 'string' || !value.trim()) return res.status(400).json({ error: 'updated_by must be a non-empty string' });
    } else {
      return res.status(400).json({ error: `unknown field: ${key}` });
    }
    payload[key] = value;
  }
  if (!Object.keys(payload).some(k => k !== 'updated_by')) return res.status(400).json({ error: 'nothing to update' });

  const { data, error } = await getSupabase()
    .from('sales_prospect_state')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('business_id', req.params.businessId)
    .eq('contact_id', req.params.contactId)
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'prospect not found' });
  res.status(200).json({ prospect: data });
}

// POST /prospects/:contactId/pipeline - creates the opportunity AND links it
// back via opportunity_id in one request, so the card can't end up with an
// orphan opportunity it doesn't know about. The link write goes through the
// same trigger as every other huddle change, so it's logged with who/when.
const OWNER_NAMES = { jack: 'Jack', cyrus: 'Cyrus' };

export async function addToPipelineRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  const { businessId, contactId } = req.params;
  const { org_type: orgType, cohort = null, updated_by: updatedBy } = req.body || {};
  if (cohort !== null && typeof cohort !== 'string') return res.status(400).json({ error: 'cohort must be a string or null' });
  if (!ORG_TYPE_ENUM.includes(orgType)) return res.status(400).json({ error: `org_type must be one of ${ORG_TYPE_ENUM.join('|')}` });
  if (typeof updatedBy !== 'string' || !updatedBy.trim()) return res.status(400).json({ error: 'updated_by must be a non-empty string' });
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
    .update({ opportunity_id: opp.id, updated_by: updatedBy, updated_at: new Date().toISOString() })
    .eq('business_id', businessId).eq('contact_id', contactId).select().single();
  if (error) return res.status(500).json({ error: `opportunity ${opp.id} created but not linked: ${error.message}` });
  res.status(201).json({ prospect: data, opportunity: opp });
}

// POST /huddles - stamps huddle_at, which defines "since last huddle".
export async function startHuddleRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  const startedBy = req.body && typeof req.body.started_by === 'string' ? req.body.started_by : null;
  const { data, error } = await getSupabase()
    .from('sales_huddles')
    .insert({ business_id: req.params.businessId, started_by: startedBy })
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
  if (!checkAllowlist(req, res)) return;
  const { data, error } = await getSupabase()
    .from('sales_collateral').select('*').eq('business_id', req.params.businessId).order('title');
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ collateral: data });
}

export async function createCollateralRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  const { payload, error: vErr } = validateCollateral(req.body, { partial: false });
  if (vErr) return res.status(400).json({ error: vErr });
  const { data, error } = await getSupabase()
    .from('sales_collateral').insert({ ...payload, business_id: req.params.businessId }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ item: data });
}

export async function updateCollateralRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
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
  if (!checkAllowlist(req, res)) return;
  const { data, error } = await getSupabase()
    .from('sales_collateral').delete().eq('business_id', req.params.businessId).eq('id', req.params.id).select('id');
  if (error) return res.status(500).json({ error: error.message });
  if (!data.length) return res.status(404).json({ error: 'collateral not found' });
  res.status(200).json({ deleted: data[0].id });
}
