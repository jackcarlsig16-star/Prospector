import { createClient } from '@supabase/supabase-js';
import { runSync } from './sync.js';
import { isAllowlistedBusiness } from './allowlist.js';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Every route checks this first and 403s - the real access gate for this
// feature (no real auth exists - A1b).
function checkAllowlist(req, res) {
  if (!isAllowlistedBusiness(req.params.businessId)) {
    res.status(403).json({ error: 'business is not allowlisted for sales analytics' });
    return false;
  }
  return true;
}

export async function syncRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  try {
    const result = await runSync({ businessId: req.params.businessId, trigger: 'manual' });
    if (result.refused) return res.status(429).json({ error: result.reason });
    if (result.error) return res.status(500).json({ error: result.error });
    res.status(200).json({ run: result.run });
  } catch (err) {
    console.error('[sales/sync]', err.message);
    res.status(500).json({ error: err.message });
  }
}

// trigger='test' rows are excluded here on purpose - this is the one route
// the UI's "last synced" / "last scheduled sync" chip reads from
// (SalesAnalyticsTab.js's fetchRuns(...)[0]), and a verification run must
// never appear there as if it were a real sync.
export async function runsRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('sales_sync_runs')
    .select('*')
    .eq('business_id', req.params.businessId)
    .neq('trigger', 'test')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ runs: data });
}

export async function metricsRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  const { from, to } = req.query;
  const supabase = getSupabase();
  let query = supabase.from('sales_metrics_daily').select('*').eq('business_id', req.params.businessId);
  if (from) query = query.gte('metric_date', from);
  if (to) query = query.lte('metric_date', to);
  const { data, error } = await query.order('metric_date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ metrics: data });
}

// sales-analytics-core-names-fix-v1 Part B - names/cohort/address lookup
// for the Sequence Leaderboard and Mailbox Health widgets, which only ever
// see Apollo's opaque ids through sales_metrics_daily. Reads the single
// latest raw snapshot per entity (order by captured_at desc, limit 1) -
// 0 Apollo calls, no new table, no change to sync logic.
// dashboard-v2 Stage 2 - extended with the new sequence fields (num_steps,
// is_performing_poorly, created_at, archived), the new mailbox fields
// (deliverability_score subset, email_daily_threshold, the connection-
// error fields), and each sequence's audience/sender_email joined in
// from sales_sequence_tags. Still 0 Apollo calls - reads only the latest
// raw snapshot per entity plus the tags table.
// sales-sequence-motion-v1 - is_partner replaced with audience
// ('employer'|'membership'|'channel_partner'); is_partner stays in the
// table for one release (read-only) but is no longer read here.
export async function entitiesRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  const supabase = getSupabase();
  const businessId = req.params.businessId;

  const [seqSnap, mailSnap, tags] = await Promise.all([
    supabase.from('sales_raw_snapshots').select('payload,captured_at').eq('business_id', businessId).eq('entity', 'sequences').order('captured_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('sales_raw_snapshots').select('payload,captured_at').eq('business_id', businessId).eq('entity', 'mailboxes').order('captured_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('sales_sequence_tags').select('sequence_id,audience,sender_email').eq('business_id', businessId),
  ]);
  if (seqSnap.error) return res.status(500).json({ error: seqSnap.error.message });
  if (mailSnap.error) return res.status(500).json({ error: mailSnap.error.message });
  if (tags.error) return res.status(500).json({ error: tags.error.message });

  const tagById = new Map((tags.data || []).map(t => [t.sequence_id, t]));

  const sequences = (seqSnap.data?.payload || []).map(s => {
    const tag = tagById.get(s.id);
    return {
      id: s.id,
      name: s.name,
      active: !!s.active,
      cohort: s.cohort,
      archived: !!s.archived,
      num_steps: s.num_steps ?? null,
      is_performing_poorly: !!s.is_performing_poorly,
      created_at: s.created_at || null,
      audience: tag ? (tag.audience || 'employer') : 'employer',
      sender_email: tag ? (tag.sender_email || null) : null,
    };
  });
  const mailboxes = (mailSnap.data?.payload || []).map(m => ({
    id: m.id,
    email: m.email,
    active: !!m.active,
    deliverability_score: m.deliverability_score || null,
    email_daily_threshold: m.email_daily_threshold ?? null,
    unlink_error_code: m.unlink_error_code || null,
    inactive_reason: m.inactive_reason || null,
    unlink_error_message: m.unlink_error_message || null,
    needs_reauth_at: m.needs_reauth_at || null,
    last_synced_at: m.last_synced_at || null,
    revoked_at: m.revoked_at || null,
    created_at: m.created_at || null,
    snapshot_at: mailSnap.data?.captured_at || null,
  }));
  const capturedAt = [seqSnap.data?.captured_at, mailSnap.data?.captured_at].filter(Boolean).sort().slice(-1)[0] || null;

  res.status(200).json({ sequences, mailboxes, captured_at: capturedAt });
}

export async function sequenceTagsRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('sales_sequence_tags')
    .select('sequence_id,audience,sender_email,sender_checked_at,updated_at')
    .eq('business_id', req.params.businessId);
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ tags: data });
}

const AUDIENCE_VALUES = ['employer', 'membership', 'channel_partner'];

// PUT /sequence-tags/:sequenceId - body MUST be exactly { audience: one of
// AUDIENCE_VALUES }, nothing else (400 otherwise). sales-sequence-motion-v1
// replaces the old { is_partner: boolean } body - this route no longer
// accepts is_partner at all. sequenceId must exist in the latest sequences
// snapshot (404 otherwise) - guards against tagging a typo'd or stale id
// that no longer means anything. Never touches sender_email/
// sender_checked_at - only sync.js's senderLookup writes those.
export async function putSequenceTagRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  const businessId = req.params.businessId;
  const sequenceId = req.params.sequenceId;

  const bodyKeys = Object.keys(req.body || {});
  if (bodyKeys.length !== 1 || bodyKeys[0] !== 'audience' || !AUDIENCE_VALUES.includes(req.body.audience)) {
    return res.status(400).json({ error: `body must be exactly { audience: one of ${AUDIENCE_VALUES.join('|')} }` });
  }

  const supabase = getSupabase();
  const { data: snap, error: snapErr } = await supabase
    .from('sales_raw_snapshots')
    .select('payload')
    .eq('business_id', businessId)
    .eq('entity', 'sequences')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (snapErr) return res.status(500).json({ error: snapErr.message });

  const exists = Array.isArray(snap?.payload) && snap.payload.some(s => s.id === sequenceId);
  if (!exists) return res.status(404).json({ error: 'sequence not found in the latest snapshot' });

  const { data, error } = await supabase
    .from('sales_sequence_tags')
    .upsert(
      { business_id: businessId, sequence_id: sequenceId, audience: req.body.audience, updated_at: new Date().toISOString() },
      { onConflict: 'business_id,sequence_id' }
    )
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ tag: data });
}

// GET /cohort-breakdown - cohort x {direct, partner} company counts,
// computed at read time from the latest accounts snapshot (which carries
// contact_emailer_campaign_ids + contact_campaign_status_tally per
// account) plus the current tags. Same "in cadence" definition as the
// accounts adapter (>=1 active contact, audit A6f) and the same
// best-available-signal caveat: tally is a rollup across all of an
// account's sequences, not broken out per sequence, so an account counts
// toward every cohort/Partner status its assigned sequences touch.
// sales-sequence-motion-v1 - "partner" here means audience IN
// ('membership','channel_partner') - the response shape ({direct,
// partner} per cohort) is unchanged, only what counts as "partner"
// changed (used to be is_partner=true). The UI's own label moved to
// "Partner audiences"; this field name stays "partner" to avoid touching
// every consumer's response-shape assumption for a rename alone.
export async function cohortBreakdownRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  const businessId = req.params.businessId;
  const supabase = getSupabase();

  const [accSnap, seqSnap, tags] = await Promise.all([
    supabase.from('sales_raw_snapshots').select('payload,captured_at').eq('business_id', businessId).eq('entity', 'accounts').order('captured_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('sales_raw_snapshots').select('payload').eq('business_id', businessId).eq('entity', 'sequences').order('captured_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('sales_sequence_tags').select('sequence_id,audience').eq('business_id', businessId),
  ]);
  if (accSnap.error) return res.status(500).json({ error: accSnap.error.message });
  if (seqSnap.error) return res.status(500).json({ error: seqSnap.error.message });
  if (tags.error) return res.status(500).json({ error: tags.error.message });

  const cohortById = {};
  (seqSnap.data?.payload || []).forEach(s => { cohortById[s.id] = s.cohort; });
  const partnerIds = new Set((tags.data || []).filter(t => t.audience === 'membership' || t.audience === 'channel_partner').map(t => t.sequence_id));

  const breakdown = {};
  (accSnap.data?.payload || []).forEach(a => {
    const inCadence = (a.contact_campaign_status_tally?.active || 0) >= 1;
    if (!inCadence) return;
    const seqIds = a.contact_emailer_campaign_ids || [];
    const cohorts = new Set(seqIds.map(id => cohortById[id]).filter(Boolean));
    const hasPartnerAudience = seqIds.some(id => partnerIds.has(id));
    for (const cohort of cohorts) {
      if (!breakdown[cohort]) breakdown[cohort] = { direct: 0, partner: 0 };
      if (hasPartnerAudience) breakdown[cohort].partner += 1;
      else breakdown[cohort].direct += 1;
    }
  });

  res.status(200).json({ breakdown, captured_at: accSnap.data?.captured_at || null });
}
