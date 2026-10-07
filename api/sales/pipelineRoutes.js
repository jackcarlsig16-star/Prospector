import { createClient } from '@supabase/supabase-js';
import { STAGE_ENUM, ORG_TYPE_ENUM, compareStages } from './pipelineStages.js';
import { parseCsv, toCsv } from '../../src/utils/csv.js';
import { selectAllPages } from '../lib/selectAllPages.js';

// sales-pipeline-v1 - server-only access, same posture as every other
// sales_* table (RLS enabled, zero policies).
function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}


// Every column a caller may write via create/update. organization/
// business_id/source/id/created_at/updated_at/archived_at are either
// required-on-create, server-controlled, or handled by their own action
// (archive) - never accepted as a free-form field here.
const WRITABLE_FIELDS = [
  'organization', 'cohort', 'org_type', 'covered_lives', 'stage', 'probability', 'est_value',
  'owner', 'next_action', 'next_action_date', 'expected_close', 'expected_launch',
  'decision_makers', 'champion', 'objections', 'competitors', 'needed_to_advance', 'notes',
  'is_top', 'lost_reason',
];
const NUMERIC_FIELDS = ['covered_lives', 'probability', 'est_value'];
const DATE_FIELDS = ['next_action_date', 'expected_close', 'expected_launch'];
const STRING_FIELDS = ['organization', 'cohort', 'owner', 'next_action', 'decision_makers', 'champion', 'objections', 'competitors', 'needed_to_advance', 'notes', 'lost_reason'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Shared by create/update - same validation pattern as putSequenceTagRoute
// (api/sales/routes.js): unknown field -> 400, bad enum -> 400, wrong
// type -> 400. Returns { payload } on success or { error } on failure.
function validateFields(body) {
  const payload = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (!WRITABLE_FIELDS.includes(key)) return { error: `unknown field: ${key}` };
    if (value === null) { payload[key] = null; continue; }
    if (key === 'stage' && !STAGE_ENUM.includes(value)) return { error: `bad enum: stage must be one of ${STAGE_ENUM.join('|')}` };
    if (key === 'org_type' && !ORG_TYPE_ENUM.includes(value)) return { error: `bad enum: org_type must be one of ${ORG_TYPE_ENUM.join('|')}` };
    if (NUMERIC_FIELDS.includes(key) && typeof value !== 'number') return { error: `${key} must be a number or null` };
    if (key === 'is_top' && typeof value !== 'boolean') return { error: 'is_top must be a boolean' };
    if (DATE_FIELDS.includes(key) && (typeof value !== 'string' || !DATE_RE.test(value))) return { error: `${key} must be a YYYY-MM-DD date string or null` };
    if (STRING_FIELDS.includes(key) && typeof value !== 'string') return { error: `${key} must be a string` };
    payload[key] = value;
  }
  return { payload };
}

// GET /opportunities?stage=&cohort=&owner=&is_top=&include_archived=
export async function listOpportunitiesRoute(req, res) {
  const supabase = getSupabase();
  const { stage, cohort, owner, is_top, include_archived } = req.query;
  try {
    const data = await selectAllPages(() => {
      let query = supabase.from('sales_opportunities').select('*').eq('business_id', req.params.businessId);
      if (!include_archived || include_archived === 'false') query = query.is('archived_at', null);
      if (stage) query = query.eq('stage', stage);
      if (cohort) query = query.eq('cohort', cohort);
      if (owner) query = query.eq('owner', owner);
      if (is_top === 'true') query = query.eq('is_top', true);
      return query.order('created_at', { ascending: false }).order('id');
    });
    res.status(200).json({ opportunities: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

export async function createOpportunityRoute(req, res) {
  const { payload, error } = validateFields(req.body);
  if (error) return res.status(400).json({ error });
  if (!payload.organization || !payload.organization.trim()) {
    return res.status(400).json({ error: 'organization is required' });
  }
  const supabase = getSupabase();
  const { data, error: insErr } = await supabase
    .from('sales_opportunities')
    .insert({ business_id: req.params.businessId, source: 'manual', ...payload })
    .select()
    .single();
  if (insErr) return res.status(500).json({ error: insErr.message });
  res.status(201).json({ opportunity: data });
}

export async function updateOpportunityRoute(req, res) {
  const businessId = req.params.businessId;
  const id = req.params.id;
  const { payload, error } = validateFields(req.body);
  if (error) return res.status(400).json({ error });

  const supabase = getSupabase();
  const { data: existing, error: findErr } = await supabase
    .from('sales_opportunities').select('id').eq('business_id', businessId).eq('id', id).maybeSingle();
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!existing) return res.status(404).json({ error: 'opportunity not found' });

  const { data, error: updErr } = await supabase
    .from('sales_opportunities')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (updErr) return res.status(500).json({ error: updErr.message });
  res.status(200).json({ opportunity: data });
}

export async function archiveOpportunityRoute(req, res) {
  const businessId = req.params.businessId;
  const id = req.params.id;
  const supabase = getSupabase();
  const { data: existing, error: findErr } = await supabase
    .from('sales_opportunities').select('id').eq('business_id', businessId).eq('id', id).maybeSingle();
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!existing) return res.status(404).json({ error: 'opportunity not found' });

  const now = new Date().toISOString();
  const { data, error: updErr } = await supabase
    .from('sales_opportunities')
    .update({ archived_at: now, updated_at: now })
    .eq('id', id)
    .select()
    .single();
  if (updErr) return res.status(500).json({ error: updErr.message });
  res.status(200).json({ opportunity: data });
}

export async function opportunityTemplateRoute(req, res) {
  const columns = [...WRITABLE_FIELDS, 'lost_reason'].filter((v, i, a) => a.indexOf(v) === i);
  const csv = toCsv([], columns.map(c => ({ label: c, key: c })));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sales-pipeline-template.csv"');
  res.status(200).send(csv);
}

// Case-insensitive, space/underscore-normalized header -> field map.
const HEADER_MAP = {
  'organization': 'organization', 'org': 'organization',
  'cohort': 'cohort',
  'org type': 'org_type', 'orgtype': 'org_type', 'audience': 'org_type',
  'covered lives': 'covered_lives',
  'stage': 'stage',
  'probability': 'probability',
  'est value': 'est_value', 'estimated value': 'est_value',
  'owner': 'owner',
  'next action': 'next_action',
  'next action date': 'next_action_date',
  'expected close': 'expected_close',
  'expected launch': 'expected_launch',
  'decision makers': 'decision_makers',
  'champion': 'champion',
  'objections': 'objections',
  'competitors': 'competitors',
  'needed to advance': 'needed_to_advance',
  'notes': 'notes',
  'is top': 'is_top',
  'lost reason': 'lost_reason',
};
function normalizeHeader(h) {
  return h.toLowerCase().trim().replace(/_/g, ' ').replace(/\s+/g, ' ');
}

// POST /opportunities/import - body { csv: string }. Header-mapped
// (case-insensitive), validated row by row, upsert by (business_id,
// lower(organization)) among non-archived rows. A blank cell never
// overwrites an existing value on update (Supabase-merge philosophy
// already established elsewhere in this app) - it's simply omitted from
// that row's payload, so new rows fall back to the column's own DB
// default and existing rows keep their current value. Rows are processed
// sequentially against one in-memory snapshot of existing organizations
// (fetched once - zero Apollo calls, dataset is small), updated as each
// row is applied, so two rows in the same CSV with the same org name
// correctly route the second one to UPDATE instead of a duplicate INSERT.
export async function importOpportunitiesRoute(req, res) {
  const businessId = req.params.businessId;
  const csvText = req.body?.csv;
  if (typeof csvText !== 'string' || !csvText.trim()) {
    return res.status(400).json({ error: 'body must be { csv: string }' });
  }

  const { headers, rows } = parseCsv(csvText);
  const fieldByHeader = {};
  for (const h of headers) {
    const field = HEADER_MAP[normalizeHeader(h)];
    if (field) fieldByHeader[h] = field;
  }

  const supabase = getSupabase();
  const { data: existingRows, error: fetchErr } = await supabase
    .from('sales_opportunities')
    .select('id,organization')
    .eq('business_id', businessId)
    .is('archived_at', null);
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  const existingByOrgLower = new Map(existingRows.map(r => [r.organization.toLowerCase(), r.id]));

  let inserted = 0, updated = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i];
    const rowNum = i + 1;
    const payload = {};
    let rowError = null;

    for (const [header, field] of Object.entries(fieldByHeader)) {
      const raw = (rawRow[header] || '').trim();
      if (!raw) continue;
      if (field === 'stage' && !STAGE_ENUM.includes(raw)) { rowError = `invalid stage "${raw}"`; break; }
      else if (field === 'org_type' && !ORG_TYPE_ENUM.includes(raw)) { rowError = `invalid org_type "${raw}"`; break; }
      else if (NUMERIC_FIELDS.includes(field)) {
        const n = Number(raw);
        if (!Number.isFinite(n)) { rowError = `invalid number for ${field}: "${raw}"`; break; }
        payload[field] = field === 'covered_lives' ? Math.round(n) : n;
      } else if (DATE_FIELDS.includes(field)) {
        if (!DATE_RE.test(raw)) { rowError = `invalid date for ${field}: "${raw}" (expected YYYY-MM-DD)`; break; }
        payload[field] = raw;
      } else if (field === 'is_top') {
        payload.is_top = ['true', 'yes', '1'].includes(raw.toLowerCase());
      } else {
        payload[field] = raw;
      }
    }

    if (rowError) { errors.push({ row: rowNum, reason: rowError }); continue; }
    if (!payload.organization) { errors.push({ row: rowNum, reason: 'organization is required' }); continue; }

    const orgLower = payload.organization.toLowerCase();
    const existingId = existingByOrgLower.get(orgLower);

    if (existingId) {
      const { error: updErr } = await supabase
        .from('sales_opportunities')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', existingId);
      if (updErr) { errors.push({ row: rowNum, reason: updErr.message }); continue; }
      updated++;
    } else {
      const { data: insData, error: insErr } = await supabase
        .from('sales_opportunities')
        .insert({ business_id: businessId, source: 'csv', ...payload })
        .select('id')
        .single();
      if (insErr) { errors.push({ row: rowNum, reason: insErr.message }); continue; }
      existingByOrgLower.set(orgLower, insData.id);
      inserted++;
    }
  }

  res.status(200).json({ inserted, updated, errors });
}

// GET /opportunities/movement?from=YYYY-MM-DD&to=YYYY-MM-DD
// Classifies every non-archived opportunity by what happened to it within
// [from, to], using sales_opportunity_events (not the live `stage` column
// alone) to reconstruct stage-at-start and stage-at-end of the window -
// correct even if the opportunity has moved again since `to`. Buckets are
// mutually exclusive, checked in this priority order (REVISABLE, not
// specified explicitly by the SPEC): added (created within the window) >
// lost (newly reached within the window) > forward/back (net stage
// movement) > stalled (no net movement, but genuinely neglected) > none
// (no net movement, not neglected - excluded from every bucket).
export async function movementRoute(req, res) {
  const businessId = req.params.businessId;
  const { from, to } = req.query;
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return res.status(400).json({ error: 'from and to are required, YYYY-MM-DD' });
  }

  const supabase = getSupabase();
  let opps, events;
  try {
    opps = await selectAllPages(() => supabase.from('sales_opportunities').select('*').eq('business_id', businessId).is('archived_at', null).order('id'));
    const open = new Set(opps.map(o => o.id));
    // Filtered to open opportunities here rather than with .in(ids), which
    // grows the URL with every opportunity.
    events = (await selectAllPages(() => supabase.from('sales_opportunity_events')
      .select('opportunity_id,event_type,from_stage,to_stage,changed_at')
      .eq('business_id', businessId)
      .lte('changed_at', `${to}T23:59:59.999Z`)
      .order('changed_at', { ascending: true }).order('id'))).filter(e => open.has(e.opportunity_id));
  } catch (e) { return res.status(500).json({ error: e.message }); }

  const eventsByOpp = new Map();
  for (const ev of events) {
    if (!eventsByOpp.has(ev.opportunity_id)) eventsByOpp.set(ev.opportunity_id, []);
    eventsByOpp.get(ev.opportunity_id).push(ev);
  }

  const fromMs = new Date(`${from}T00:00:00.000Z`).getTime();
  const nowMs = new Date(`${to}T23:59:59.999Z`).getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const buckets = { moved_forward: [], moved_back: [], added: [], lost: [], stalled: [] };

  for (const opp of opps) {
    const oppEvents = eventsByOpp.get(opp.id) || [];
    const createdEvent = oppEvents.find(e => e.event_type === 'created');
    const createdInWindow = createdEvent && new Date(createdEvent.changed_at).getTime() >= fromMs;
    if (createdInWindow) { buckets.added.push(opp); continue; }

    const beforeWindow = oppEvents.filter(e => new Date(e.changed_at).getTime() < fromMs);
    const stageAtStart = beforeWindow.length ? beforeWindow[beforeWindow.length - 1].to_stage : (createdEvent ? createdEvent.to_stage : opp.stage);
    const stageAtEnd = oppEvents.length ? oppEvents[oppEvents.length - 1].to_stage : opp.stage;

    if (stageAtEnd === 'lost' && stageAtStart !== 'lost') { buckets.lost.push(opp); continue; }

    const cmp = compareStages(stageAtStart, stageAtEnd);
    if (cmp === 'forward') { buckets.moved_forward.push(opp); continue; }
    if (cmp === 'back') { buckets.moved_back.push(opp); continue; }

    const lastEvent = oppEvents[oppEvents.length - 1];
    const daysSinceChange = lastEvent ? (nowMs - new Date(lastEvent.changed_at).getTime()) / DAY_MS : Infinity;
    const nextActionPast = !!(opp.next_action_date && opp.next_action_date < to);
    if (nextActionPast || daysSinceChange >= 14) buckets.stalled.push(opp);
  }

  res.status(200).json(buckets);
}
