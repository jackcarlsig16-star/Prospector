import { getSupabase } from './goalsShared.js';
import { RECORD_TABLE } from './leadSource.js';
import { cleanText, hasPii } from './scrubText.js';
import { normName } from './intakeMatch.js';
import { logFlow } from './flowEvents.js';
import { scheduleRecompute } from './intentScoreRun.js';
import { HAND_FIT_LEVELS, FIT_WORD, DEPRIORITIZE_REASON_IDS, DEPRIORITIZE_REASON_WORD, DEPRIORITIZE_NOTE_MAX } from '../../src/constants/fitLevels.js';

// homelover-flow-v1 F2 / F4 - Deprioritize with a reason, Bring back, and a hand-set Fit (Strong · Good · Low) on a
// partner, employer, target or (reason only) a visitor with no record. None of these moves a stage or an owner: a
// partner's pipeline_status is untouched (applyPartnerSignal stays the only mover), an employer keeps its stage and
// comes off the Map's default filter and the Due lists instead. Every write logs a flow event with prev + set, so
// Undo restores exactly. "Mostly outside US" also records us_footprint when nothing knew it (F3 axis 4).
export const DEPRIORITIZE_TYPES = ['partner', 'employer', 'target', 'visitor'];
const STAGE_COL = { partner: 'pipeline_status', employer: 'stage', target: 'status' };
const NAME_COL = { partner: 'name', employer: 'organization', target: 'name' };
const FIT_COLS = 'fit_level, fit_set_by, fit_set_at, deprioritized_reason, deprioritized_note, deprioritized_at, deprioritized_by, us_footprint, us_footprint_source, us_footprint_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const STALE = { error: 'This changed elsewhere - refresh', code: 'stale_stage' };
const pick = (row, keys) => Object.fromEntries(keys.map(k => [k, row?.[k] ?? null]));

function validNote(v) {
  if (v == null || v === '') return { value: null };
  if (typeof v !== 'string') return { error: 'note must be text' };
  const s = v.trim().replace(/\s+/g, ' ');
  if (s.length > DEPRIORITIZE_NOTE_MAX) return { error: `note must be at most ${DEPRIORITIZE_NOTE_MAX} characters` };
  if (hasPii(s)) return { error: "note can't hold an email address or phone number" };
  return { value: cleanText(s, DEPRIORITIZE_NOTE_MAX) || null };
}

async function recordRow(supabase, businessId, type, id) {
  if (type === 'visitor') {
    if (typeof id !== 'string' || !id.trim() || id.length > 200) return null;
    const seen = must(await supabase.from('web_visits').select('company_key, company_name').eq('business_id', businessId).eq('company_key', id).limit(1));
    if (!seen.length) return null;
    const rows = must(await supabase.from('visit_priority_override').select('*').eq('business_id', businessId).eq('company_key', id).limit(1));
    return { id, name: seen[0].company_name || id, stage: 'visited', override: rows[0] || null, ...pick(rows[0], ['deprioritized_reason', 'deprioritized_note', 'deprioritized_at', 'deprioritized_by']), fit_level: rows[0]?.deprioritized_reason ? 'deprioritized' : null };
  }
  if (!UUID.test(id || '')) return null;
  const q = supabase.from(RECORD_TABLE[type]).select(`id, ${NAME_COL[type]}, ${STAGE_COL[type]}, ${FIT_COLS}`).eq('business_id', businessId).eq('id', id);
  const row = must(await (type === 'partner' ? q.eq('goal_type', 'partnership') : type === 'employer' ? q.is('archived_at', null) : q).maybeSingle());
  return row && { ...row, name: row[NAME_COL[type]], stage: row[STAGE_COL[type]] || (type === 'partner' ? 'not_started' : null) };
}

// A guarded write: only while fit_level still holds what this request read (a teammate's click in between = 409).
async function writeFit(supabase, businessId, type, id, prevLevel, patch, now) {
  const q = supabase.from(RECORD_TABLE[type]).update({ ...patch, updated_at: now.toISOString() }).eq('business_id', businessId).eq('id', id);
  const rows = must(await (prevLevel == null ? q.is('fit_level', null) : q.eq('fit_level', prevLevel)).select('id'));
  if (!rows.length) throw err(409, 'changed since - reload and try again');
}

// POST goals/company/:type/:id/deprioritize { reason, note?, expect? } -> 200 { fit, event: { id }, before }
export async function deprioritize(supabase, { businessId, userId, type, id, body, now = new Date() }) {
  if (!DEPRIORITIZE_TYPES.includes(type)) return reply(400, { error: `type must be one of ${DEPRIORITIZE_TYPES.join('|')}` });
  const reason = body?.reason;
  if (!DEPRIORITIZE_REASON_IDS.includes(reason)) return reply(400, { error: `reason must be one of ${DEPRIORITIZE_REASON_IDS.join('|')}` });
  const note = validNote(body?.note);
  if (note.error) return reply(400, { error: note.error });
  if (reason === 'other' && !note.value) return reply(400, { error: 'say why in a few words (note)' });
  try {
    const r = await recordRow(supabase, businessId, type, id);
    if (!r) return reply(404, { error: `${type} not found` });
    if (body?.expect != null && type !== 'visitor' && r.stage !== body.expect) return reply(409, STALE);
    if (r.fit_level === 'deprioritized') return reply(409, { error: `${r.name} is already deprioritized (${DEPRIORITIZE_REASON_WORD[r.deprioritized_reason] || r.deprioritized_reason})` });
    const at = now.toISOString();
    const text = `Deprioritized · ${DEPRIORITIZE_REASON_WORD[reason]}${note.value ? ` · ${note.value}` : ''}`;
    let prev, set;
    if (type === 'visitor') {
      prev = pick(r.override, ['deprioritized_reason', 'deprioritized_note', 'deprioritized_at', 'deprioritized_by']);
      set = { deprioritized_reason: reason, deprioritized_note: note.value, deprioritized_at: at, deprioritized_by: userId };
      must(await supabase.from('visit_priority_override').upsert({ business_id: businessId, company_key: id, ...set, ...(r.override ? {} : { priority: null, not_a_fit: false, set_by: userId, set_at: at }) }, { onConflict: 'business_id,company_key' }).select('company_key'));
    } else {
      const footprint = reason === 'mostly_outside_us' && !r.us_footprint ? { us_footprint: 'mostly_outside_us', us_footprint_source: 'deprioritize', us_footprint_at: at } : {};
      set = { fit_level: 'deprioritized', fit_set_by: userId, fit_set_at: at, deprioritized_reason: reason, deprioritized_note: note.value, deprioritized_at: at, deprioritized_by: userId, ...footprint };
      prev = pick(r, Object.keys(set));
      await writeFit(supabase, businessId, type, id, r.fit_level, set, now);
    }
    const event = await logFlow(supabase, { businessId, recordType: type, recordId: id, kind: 'deprioritize', text, prev, set, meta: { reason, note: note.value, name: r.name }, byUser: userId, now });
    scheduleRecompute(supabase, businessId, 'signal');
    return reply(200, { fit: { level: 'deprioritized', reason, note: note.value, word: DEPRIORITIZE_REASON_WORD[reason] }, event: { id: event.id }, before: prev });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}
export async function deprioritizeRoute(req, res) {
  send(res, await deprioritize(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, type: req.params.type, id: req.params.id, body: req.body }));
}

// POST goals/company/:type/:id/bring-back -> 200 { fit: { level: null }, event: { id } }. Clears the deprioritization
// (and a US footprint it had set as a side effect); a Fit set by hand before it is gone too - the score decides again.
export async function bringBack(supabase, { businessId, userId, type, id, now = new Date() }) {
  if (!DEPRIORITIZE_TYPES.includes(type)) return reply(400, { error: `type must be one of ${DEPRIORITIZE_TYPES.join('|')}` });
  try {
    const r = await recordRow(supabase, businessId, type, id);
    if (!r) return reply(404, { error: `${type} not found` });
    if (r.fit_level !== 'deprioritized') return reply(409, { error: `${r.name} is not deprioritized` });
    let prev, set;
    if (type === 'visitor') {
      set = { deprioritized_reason: null, deprioritized_note: null, deprioritized_at: null, deprioritized_by: null };
      prev = pick(r.override, Object.keys(set));
      must(await supabase.from('visit_priority_override').update(set).eq('business_id', businessId).eq('company_key', id).select('company_key'));
    } else {
      set = { fit_level: null, fit_set_by: null, fit_set_at: null, deprioritized_reason: null, deprioritized_note: null, deprioritized_at: null, deprioritized_by: null, ...(r.us_footprint_source === 'deprioritize' ? { us_footprint: null, us_footprint_source: null, us_footprint_at: null } : {}) };
      prev = pick(r, Object.keys(set));
      await writeFit(supabase, businessId, type, id, 'deprioritized', set, now);
    }
    const event = await logFlow(supabase, { businessId, recordType: type, recordId: id, kind: 'bring_back', text: `Brought back (was ${DEPRIORITIZE_REASON_WORD[r.deprioritized_reason] || 'deprioritized'})`, prev, set, meta: { name: r.name }, byUser: userId, now });
    scheduleRecompute(supabase, businessId, 'signal');
    return reply(200, { fit: { level: null }, event: { id: event.id }, before: prev });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}
export async function bringBackRoute(req, res) {
  send(res, await bringBack(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, type: req.params.type, id: req.params.id }));
}

// PATCH goals/company/:type/:id/fit { level: strong | good | low | null } -> 200 { fit: { level }, event: { id } }.
// A hand-set level wins over the score until cleared (null). Not on a deprioritized record (Bring back first).
export async function setFit(supabase, { businessId, userId, type, id, body, now = new Date() }) {
  if (!RECORD_TABLE[type]) return reply(400, { error: 'type must be partner|employer|target' });
  const level = body?.level ?? null;
  if (level !== null && !HAND_FIT_LEVELS.includes(level)) return reply(400, { error: `level must be one of ${HAND_FIT_LEVELS.join('|')} or null` });
  try {
    const r = await recordRow(supabase, businessId, type, id);
    if (!r) return reply(404, { error: `${type} not found` });
    if (r.fit_level === 'deprioritized') return reply(409, { error: `${r.name} is deprioritized - bring it back first`, code: 'deprioritized' });
    if ((r.fit_level || null) === level) return reply(200, { fit: { level }, event: null, unchanged: true });
    const set = { fit_level: level, fit_set_by: level ? userId : null, fit_set_at: level ? now.toISOString() : null };
    const prev = pick(r, Object.keys(set));
    await writeFit(supabase, businessId, type, id, r.fit_level, set, now);
    const event = await logFlow(supabase, { businessId, recordType: type, recordId: id, kind: 'fit_set', text: level ? `Fit set to ${FIT_WORD[level]}` : 'Fit cleared (score decides)', prev, set, meta: { name: r.name }, byUser: userId, now });
    scheduleRecompute(supabase, businessId, 'signal');
    return reply(200, { fit: { level }, event: { id: event.id }, before: prev });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}
export async function setFitRoute(req, res) {
  send(res, await setFit(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, type: req.params.type, id: req.params.id, body: req.body }));
}

// For the Map / Pipeline / report readers: a visitor's deprioritization lives on its override row (keyed by name).
export const visitorDeprioritized = (overrides, name) => { const o = overrides?.get?.(normName(name || '')); return o?.deprioritized_reason ? { reason: o.deprioritized_reason, note: o.deprioritized_note || null } : null; };
