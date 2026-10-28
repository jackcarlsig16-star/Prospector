import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { cleanText, hasPii } from './scrubText.js';
import { laDateString } from './laDate.js';
import { RECORD_TYPES, RECORD_TABLE } from './leadSource.js';
import { indexDated, funnelOf, journeyLine, ALL_STAGES } from './sourceFunnel.js';

// brad-attribution-v1 Stage 2 - one record's funnel (the company window's Journey line, the Brief's ref line) and the
// F3 "Mark stage" writes. The one-record read pulls only that record's dated rows (the full gather is for the Sources
// page); web_visits is read whole because a visit matches by normName as well as by id. A mark is one more dated
// source - it never edits the record's stage. Upside lock (F7): a company that is Upside-owned AND no double touch
// keeps a read-only chain.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_COL = { partner: 'name', employer: 'organization', target: 'name' };
const LINK_TYPE = { partner: 'partner', employer: 'opportunity', target: 'target' };
const EXTRA_COLS = { partner: '', employer: '', target: ', status, decided_at' };
const NOTE_MAX = 200;
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const caught = (label, e) => {
  if (!e.status || e.status >= 500) console.error(`[stage-marks/${label}]`, e.message);
  return reply(e.status || 500, { error: e.message });
};
export const isLocked = r => ['upside', 'both'].includes(r.owner_team || '') && r.no_double_touch === true;

async function recordOr404(supabase, businessId, type, id) {
  if (!RECORD_TYPES.includes(type)) throw err(400, `type must be one of ${RECORD_TYPES.join('|')}`);
  if (!UUID.test(id || '')) throw err(404, `${type} not found`);
  const row = must(await supabase.from(RECORD_TABLE[type]).select(`id, ${NAME_COL[type]}, source_kind, source_partner_id, source_person, source_set_by, source_set_at, owner_team, no_double_touch, created_at${EXTRA_COLS[type]}`).eq('business_id', businessId).eq('id', id).maybeSingle());
  if (!row) throw err(404, `${type} not found`);
  return row;
}

// { funnel: { referred…lost, src }, journey, marks: [{ stage, at, note, reason, by }], locked }
export async function recordFunnel(supabase, { businessId, type, id, row = null }) {
  const r = row || await recordOr404(supabase, businessId, type, id);
  const scoped = (table, cols, build) => selectAllPages(() => build(supabase.from(table).select(cols).eq('business_id', businessId)).order('id'));
  const [visits, prospects, partnerEvents, oppEvents, doneTodos, marks, signals, partner] = await Promise.all([
    scoped('web_visits', 'id, company_name, matched_type, matched_id, seen_from, pulled_on', x => x),
    type === 'target' ? [] : selectAllPages(() => supabase.from('sales_prospect_state').select('contact_id, opportunity_id, goal_id').eq('business_id', businessId).eq(type === 'partner' ? 'goal_id' : 'opportunity_id', id).order('contact_id')),
    type === 'partner' ? scoped('sales_partner_events', 'id, goal_id, event, at, touch_type, to_status', x => x.eq('goal_id', id).in('event', ['touch', 'status'])) : [],
    type === 'employer' ? scoped('sales_opportunity_events', 'id, opportunity_id, event_type, to_stage, changed_at', x => x.eq('opportunity_id', id).in('event_type', ['created', 'stage_change'])) : [],
    scoped('sales_week_goals', 'id, link_type, link_id, completed_at, text', x => x.eq('kind', 'todo').eq('status', 'done').eq('link_type', LINK_TYPE[type]).eq('link_id', id)),
    scoped('sales_stage_marks', 'id, record_type, record_id, stage, at, note, reason, by_user', x => x.eq('record_type', type).eq('record_id', id)),
    type === 'target' ? scoped('sales_signals', 'id, source, status, decided_at, target_id', x => x.eq('status', 'accepted').eq('target_id', id)) : [],
    r.source_partner_id ? supabase.from('sales_goals').select('name').eq('business_id', businessId).eq('id', r.source_partner_id).maybeSingle().then(must) : null,
  ]);
  const ids = [...new Set(prospects.map(p => p.contact_id).filter(Boolean))];
  const messages = ids.length ? await selectAllPages(() => supabase.from('sales_email_messages').select('contact_id, apollo_message_id, delivered_at, replied, replied_at, reply_class').eq('business_id', businessId).in('contact_id', ids).eq('replied', true).order('apollo_message_id')) : [];
  const byIds = [...new Set(marks.map(m => m.by_user).filter(Boolean))];
  const team = new Map(byIds.length ? must(await supabase.from('business_members').select('user_id, name').eq('business_id', businessId).in('user_id', byIds)).map(m => [m.user_id, m.name || '']) : []);
  const idx = indexDated({ visits, prospects, messages, partnerEvents, oppEvents, doneTodos, marks, signals, targets: type === 'target' ? [{ id: r.id, status: r.status, decided_at: r.decided_at || null }] : [] });
  const funnel = funnelOf({ type, id: r.id, name: r[NAME_COL[type]], ...r }, idx);
  const referredBy = r.source_person ? `${r.source_person}${partner?.name ? ` (${partner.name})` : ''}` : partner?.name || null;
  return {
    funnel, journey: journeyLine(funnel, { referredBy }), locked: isLocked(r),
    marks: marks.map(m => ({ stage: m.stage, at: m.at, note: m.note || null, reason: m.reason, by: m.by_user ? (team.get(m.by_user) || '').split(' ')[0] || null : null })).sort((a, b) => ALL_STAGES.indexOf(a.stage) - ALL_STAGES.indexOf(b.stage)),
  };
}

// The body of a mark: { stage, at: 'YYYY-MM-DD' (an LA day, not in the future), note? }.
export function validateMark(body = {}, { today }) {
  if (!ALL_STAGES.includes(body.stage)) return { error: `stage must be one of ${ALL_STAGES.join('|')}` };
  const at = String(body.at || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(at) || Number.isNaN(Date.parse(`${at}T12:00:00Z`)) || new Date(`${at}T12:00:00Z`).toISOString().slice(0, 10) !== at) return { error: 'at must be a date (YYYY-MM-DD)' };
  if (at > today) return { error: "at can't be in the future" };
  if (at < '2015-01-01') return { error: 'at is too far back' };
  if (body.note != null && typeof body.note !== 'string') return { error: 'note must be text' };
  if (body.note && hasPii(body.note)) return { error: "note can't hold an email address or phone number" };
  if (body.note && body.note.trim().length > NOTE_MAX) return { error: `note must be ${NOTE_MAX} characters or fewer` };
  return { mark: { stage: body.stage, at, note: cleanText(body.note || '', NOTE_MAX) || null } };
}

// PUT /goals/stage-marks/:type/:id { stage, at, note? } (Members) - one mark per record + stage; a second PUT replaces it.
// -> { previous (the mark it replaced, for Undo), ...recordFunnel }
export async function putMark(supabase, { businessId, type, id, userId, body = {}, now = new Date() }) {
  try {
    const row = await recordOr404(supabase, businessId, type, id);
    if (isLocked(row)) return reply(409, { error: 'Upside-owned with no double touch - this chain is read-only' });
    const v = validateMark(body, { today: laDateString(now) });
    if (v.error) return reply(400, { error: v.error });
    const prev = must(await supabase.from('sales_stage_marks').select('stage, at, note').eq('business_id', businessId).eq('record_type', type).eq('record_id', id).eq('stage', v.mark.stage).maybeSingle());
    must(await supabase.from('sales_stage_marks').upsert({ business_id: businessId, record_type: type, record_id: id, ...v.mark, by_user: userId, reason: 'manual', updated_at: now.toISOString() }, { onConflict: 'business_id,record_type,record_id,stage' }).select('id'));
    return reply(200, { previous: prev || null, ...(await recordFunnel(supabase, { businessId, type, id, row })) });
  } catch (e) { return caught('put', e); }
}

// DELETE /goals/stage-marks/:type/:id/:stage (Members) - removes the hand mark only; dated rows stay as they are.
export async function deleteMark(supabase, { businessId, type, id, stage }) {
  try {
    const row = await recordOr404(supabase, businessId, type, id);
    if (isLocked(row)) return reply(409, { error: 'Upside-owned with no double touch - this chain is read-only' });
    if (!ALL_STAGES.includes(stage)) return reply(400, { error: `stage must be one of ${ALL_STAGES.join('|')}` });
    must(await supabase.from('sales_stage_marks').delete().eq('business_id', businessId).eq('record_type', type).eq('record_id', id).eq('stage', stage).select('id'));
    return reply(200, await recordFunnel(supabase, { businessId, type, id, row }));
  } catch (e) { return caught('delete', e); }
}

const ctx = req => ({ businessId: req.params.businessId, userId: req.auth.user.id, type: req.params.type, id: req.params.id, stage: req.params.stage, body: req.body || {} });
export async function putMarkRoute(req, res) { send(res, await putMark(getSupabase(), ctx(req))); }
export async function deleteMarkRoute(req, res) { send(res, await deleteMark(getSupabase(), ctx(req))); }
