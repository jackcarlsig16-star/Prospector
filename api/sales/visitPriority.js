import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { PRIORITIES } from '../../src/constants/salesChannels.js';
import { normName } from './intakeMatch.js';
import { scheduleRecompute } from './intentScoreRun.js';

// sales-ia-v2 P3 - a person's P1-P4 / Not a fit for a visiting company
// (visit_priority_override). The pull keeps writing its computed priority to
// web_visits and never touches this table; every reader shows
// override ?? computed via effectiveVisit(). Not a fit also puts the company
// on the skip list; picking any P value takes it off again.
// '*' so the homelover-flow-v1 F4 columns (deprioritized_reason / _note, 20261104_homelover_flow_v1.sql) ride along
// once that migration ran and nothing breaks before it.
const COLS = '*';
const NOT_A_FIT = 'Not a fit';
const reply = (status, body) => ({ status, body });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

export async function loadOverrides(supabase, businessId) {
  const rows = await selectAllPages(() => supabase.from('visit_priority_override').select(COLS).eq('business_id', businessId).order('company_key'));
  return new Map(rows.filter(o => o.not_a_fit || o.priority || o.deprioritized_reason).map(o => [o.company_key, o]));
}

// v: a web_visits-shaped row ({ priority 'P1'..'P4', priority_rule, noise_reason }).
// homelover-flow-v1 F4: a deprioritized visitor keeps its computed priority and carries deprioritized { reason, note }.
export function effectiveVisit(v, override) {
  if (!override) return v;
  const dep = override.deprioritized_reason ? { deprioritized: { reason: override.deprioritized_reason, note: override.deprioritized_note || null } } : {};
  if (override.not_a_fit) return { ...v, ...dep, priority: 'P4', priority_rule: NOT_A_FIT, noise_reason: NOT_A_FIT, computed_priority: v.priority, override };
  if (!override.priority) return override.deprioritized_reason ? { ...v, ...dep, override } : v;
  const p = `P${override.priority}`;
  return { ...v, ...dep, priority: p, priority_rule: `Set by hand (scored ${v.priority})`, noise_reason: p === 'P4' ? 'Set to P4 by hand' : null, computed_priority: v.priority, override };
}

// POST goals/visits/priority { company_key, priority: 1-4 | null, not_a_fit?: true }
// priority null without not_a_fit = back to the computed priority (Undo).
// intent-score-v1 S3: { record: { type, id } } in place of company_key = the override keyed by the record's name
// (normName), with or without a visit row - "Not a fit" on any company closes its score (<= 10).
const RECORD_TABLE = { partner: ['sales_goals', 'name'], employer: ['sales_opportunities', 'organization'], target: ['sales_targets', 'name'] };
async function recordKey(supabase, businessId, record) {
  if (!record || typeof record !== 'object' || !RECORD_TABLE[record.type] || typeof record.id !== 'string' || !record.id) return { error: 'record must be { type: partner|employer|target, id }' };
  const [table, col] = RECORD_TABLE[record.type];
  const row = must(await supabase.from(table).select(`id, ${col}`).eq('business_id', businessId).eq('id', record.id).maybeSingle());
  if (!row) return { status: 404, error: `${record.type} not found` };
  return { key: normName(row[col]) };
}

export async function setVisitPriority(supabase, { businessId, userId, body }) {
  const { company_key: givenKey, record = null, priority = null, not_a_fit: notAFit = false } = body || {};
  let key = givenKey;
  if (record) {
    const r = await recordKey(supabase, businessId, record).catch(e => ({ status: 500, error: e.message }));
    if (r.error) return reply(r.status || 400, { error: r.error });
    key = r.key;
  }
  if (typeof key !== 'string' || !key.trim() || key.length > 160) return reply(400, { error: 'company_key is required (up to 160 characters)' });
  if (priority !== null && !PRIORITIES.includes(priority)) return reply(400, { error: 'priority must be 1, 2, 3, 4 or null' });
  if (typeof notAFit !== 'boolean') return reply(400, { error: 'not_a_fit must be true or false' });
  if (notAFit && priority !== null) return reply(400, { error: 'send a priority or not_a_fit, not both' });
  try {
    if (!record) {
      const seen = must(await supabase.from('web_visits').select('id').eq('business_id', businessId).eq('company_key', key).limit(1));
      if (!seen.length) return reply(404, { error: 'No website visit from that company in this workspace' });
    }
    const skip = supabase.from('sales_visit_skip');
    if (notAFit) {
      const ins = await skip.insert({ business_id: businessId, company_key: key, reason: NOT_A_FIT, created_by: userId });
      if (ins.error && ins.error.code !== '23505') throw new Error(ins.error.message);
    } else if (priority !== null) {
      must(await skip.delete().eq('business_id', businessId).eq('company_key', key));
    } else {
      must(await skip.delete().eq('business_id', businessId).eq('company_key', key).eq('reason', NOT_A_FIT));
    }
    if (!notAFit && priority === null) {
      // A row that also carries a deprioritization (F4) keeps it; only the priority part comes off.
      const cur = must(await supabase.from('visit_priority_override').select(COLS).eq('business_id', businessId).eq('company_key', key).limit(1));
      if (cur[0]?.deprioritized_reason) must(await supabase.from('visit_priority_override').update({ priority: null, not_a_fit: false, set_by: userId, set_at: new Date().toISOString() }).eq('business_id', businessId).eq('company_key', key).select('company_key'));
      else must(await supabase.from('visit_priority_override').delete().eq('business_id', businessId).eq('company_key', key));
      scheduleRecompute(supabase, businessId, 'signal');
      return reply(200, { company_key: key, override: null });
    }
    const row = must(await supabase.from('visit_priority_override')
      .upsert({ business_id: businessId, company_key: key, priority, not_a_fit: notAFit, set_by: userId, set_at: new Date().toISOString() }, { onConflict: 'business_id,company_key' })
      .select(COLS));
    scheduleRecompute(supabase, businessId, 'signal');
    return reply(200, { company_key: key, override: row[0] });
  } catch (e) { return reply(500, { error: e.message }); }
}

export async function setVisitPriorityRoute(req, res) {
  const r = await setVisitPriority(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, body: req.body });
  res.status(r.status).json(r.body);
}
