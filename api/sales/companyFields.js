import { getSupabase } from './goalsShared.js';

// company-workflow-v1 W3/W4/W5 - the numbers and the owner person on a company record (20261023_company_workflow_v1.sql):
//   employees (+ _source research | manual, _at) on partners, employers and targets;
//   reach_employees / reach_clients (+ _source, _at) on partners - what a PEO / HR / benefits platform covers across
//   its clients, never mixed with its own headcount;
//   owner_user_id on employers and targets (partners change owner only through the Assign signal, FIX-7).
// A typed value (source 'manual') is never overwritten by research; research only fills an empty or research value.
export const RECORD_TABLE = { partner: 'sales_goals', employer: 'sales_opportunities', target: 'sales_targets' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBERS = { partner: ['employees', 'reach_employees', 'reach_clients'], employer: ['employees'], target: ['employees'] };
// research result key -> record column
const FROM_RESEARCH = { employees_count: 'employees', reach_employees: 'reach_employees', reach_clients: 'reach_clients' };
const NUMBER_MAX = 50_000_000;
// A whole number >= 0 (a numeric string is read, commas allowed); anything else is null.
export const wholeNumber = v => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*[\d,]+\s*$/.test(v) ? Number(v.replace(/[,\s]/g, '')) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= NUMBER_MAX ? Math.round(n) : null;
};
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const cols = type => NUMBERS[type].flatMap(c => [c, `${c}_source`, `${c}_at`]).join(', ');

// A member of this workspace who can own work (not a Viewer) -> { user_id, name } | null.
export async function ownerPerson(supabase, businessId, userId) {
  if (!userId || !UUID.test(String(userId))) return null;
  const m = must(await supabase.from('business_members').select('user_id, name, role').eq('business_id', businessId).eq('user_id', userId).maybeSingle());
  return m && m.role !== 'viewer' ? { user_id: m.user_id, name: m.name || '' } : null;
}
// The member a typed owner names (first or full name, case-insensitive; exactly one) -> user id | null.
export async function memberNamed(supabase, businessId, text) {
  const k = String(text || '').trim().toLowerCase();
  if (!k) return null;
  const rows = must(await supabase.from('business_members').select('user_id, name, role').eq('business_id', businessId).not('user_id', 'is', null));
  const hits = rows.filter(m => m.role !== 'viewer' && m.name && [m.name.trim().toLowerCase(), m.name.trim().split(' ')[0].toLowerCase()].includes(k));
  return hits.length === 1 ? hits[0].user_id : null;
}
// An employer keeps its owner text (the board's Owner column, first names) in step with the person.
export const employerOwner = person => (person ? { owner_user_id: person.user_id, owner: person.name.split(' ')[0] || null } : { owner_user_id: null, owner: null });

// The picked owner when there is one (must be a Member), else the caller. -> { person } | { error }.
export async function ownerOrCaller(supabase, businessId, picked, callerId) {
  if (picked != null && picked !== '') {
    const person = await ownerPerson(supabase, businessId, picked);
    return person ? { person } : { error: 'owner_user_id must be a Member of this workspace' };
  }
  return { person: await ownerPerson(supabase, businessId, callerId) };
}

// After a done research run: fill employees (and a partner's reach) from the result unless a person typed them.
export async function applyResearchNumbers(supabase, { businessId, type, id, result, now = new Date() }) {
  if (!RECORD_TABLE[type] || !result) return { written: [] };
  const row = must(await supabase.from(RECORD_TABLE[type]).select(`id, ${cols(type)}`).eq('business_id', businessId).eq('id', id).maybeSingle());
  if (!row) return { written: [] };
  const written = [];
  for (const [key, col] of Object.entries(FROM_RESEARCH)) {
    if (!NUMBERS[type].includes(col)) continue;
    const value = wholeNumber(result[key]);
    if (value == null || row[`${col}_source`] === 'manual' || row[col] === value) continue;
    const q = supabase.from(RECORD_TABLE[type]).update({ [col]: value, [`${col}_source`]: 'research', [`${col}_at`]: now.toISOString() }).eq('id', id);
    const rows = must(await (row[`${col}_source`] == null ? q.is(`${col}_source`, null) : q.eq(`${col}_source`, row[`${col}_source`])).select('id'));
    if (rows.length) written.push(col);
  }
  return { written };
}

// PATCH /goals/company/:type/:id/fields { employees?, reach_employees?, reach_clients?, owner_user_id? } (Members):
// a typed number is source 'manual' (null clears it); owner_user_id is employers / targets only.
export async function editCompanyFields(supabase, { businessId, type, id, body = {}, now = new Date() }) {
  try {
    if (!RECORD_TABLE[type]) return reply(400, { error: `type must be one of ${Object.keys(RECORD_TABLE).join('|')}` });
    if (!UUID.test(id || '')) return reply(404, { error: `${type} not found` });
    const allowed = [...NUMBERS[type], ...(type === 'partner' ? [] : ['owner_user_id'])];
    const keys = Object.keys(body);
    const bad = keys.find(k => !allowed.includes(k));
    if (bad) return reply(400, { error: bad === 'owner_user_id' ? "a partner's owner changes through Assign" : `${bad} can't be set on a ${type}` });
    if (!keys.length) return reply(400, { error: 'nothing to change' });
    const patch = {};
    for (const k of keys.filter(x => x !== 'owner_user_id')) {
      const v = body[k] === null || body[k] === '' ? null : wholeNumber(body[k]);
      if (body[k] !== null && body[k] !== '' && v == null) return reply(400, { error: `${k} must be a whole number` });
      Object.assign(patch, { [k]: v, [`${k}_source`]: v == null ? null : 'manual', [`${k}_at`]: v == null ? null : now.toISOString() });
    }
    if ('owner_user_id' in body) {
      const person = body.owner_user_id ? await ownerPerson(supabase, businessId, body.owner_user_id) : null;
      if (body.owner_user_id && !person) return reply(400, { error: 'owner_user_id must be a Member of this workspace' });
      Object.assign(patch, type === 'employer' ? employerOwner(person) : { owner_user_id: person?.user_id ?? null });
    }
    const select = `id, ${cols(type)}${type === 'partner' ? '' : ', owner_user_id'}${type === 'employer' ? ', owner' : ''}`;
    const rows = must(await supabase.from(RECORD_TABLE[type]).update({ ...patch, updated_at: now.toISOString() }).eq('business_id', businessId).eq('id', id).select(select));
    if (!rows.length) return reply(404, { error: `${type} not found` });
    return reply(200, { fields: rows[0] });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}
export async function editCompanyFieldsRoute(req, res) {
  const r = await editCompanyFields(getSupabase(), { businessId: req.params.businessId, type: req.params.type, id: req.params.id, body: req.body || {} });
  res.status(r.status).json(r.body);
}
