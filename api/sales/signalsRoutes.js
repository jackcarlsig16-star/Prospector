import { getSupabase, findRow, weekIsFinal, FINAL_ERROR, addDays } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { applyPartnerSignal } from './partnerSignals.js';
import { findDupes, loadDupeContext } from './partnerDupeCheck.js';
import { validateFields } from './pipelineRoutes.js';
import { ImportRefused } from './masterImport.js';
import { scoutImport, laMonday, DISMISS_DAYS } from './scoutImport.js';
import { SIGNAL_CHANNEL } from '../../src/constants/salesChannels.js';

// signals-v1 Stage 2 - the review queue for outside signals (D1). Import
// only proposes; a Member decides each row. Accept (D2-D4) makes ONE open
// to-do, plus: a new target (no match), a 'note' event on a matched partner
// (never a status signal), a "(M/D) Signal:" line on a matched employer's
// notes, or nothing more on a matched target. Writes run in a fixed order,
// each pushing its undo; any failure (or a teammate's accept in between)
// runs the undos and the request fails whole.

export const SIGNAL_CATEGORY = 'Signals';
export const SIGNAL_STATUSES = ['new', 'accepted', 'dismissed'];
const SOURCE_LABEL = { scout: 'Signal Scout', web_visit: 'Website visit' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS = 'id, source, signal_week, company_name, company_key, kind, kind_guessed, who, signal, why_now, first_line, score, upside_joint, match, status, dismissed_until, target_id, todo_id, created_at, decided_by, decided_at';
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const slash = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const appendLine = (old, line) => (old ? `${old}\n${line}` : line);

// The next Friday on or after the LA day of Accept; the to-do goes in that
// Friday's week, never the signal's own week (REVISABLE).
export const nextFriday = day => addDays(day, (5 - new Date(`${day}T12:00:00Z`).getUTCDay() + 7) % 7);

export const todoText = s => `Reach out: ${s.company_name}${s.who ? ` — ${s.who}` : ''}${s.upside_joint ? ' (cc Brad)' : ''}`;

// The record Accept writes to: an exact name match only, live before
// archived, partner > employer > target. Apollo-only accounts don't count.
const RANK = { partner: 0, opportunity: 1, target: 2 };
export function acceptMatch(name, ctx) {
  return findDupes({ name }, ctx).exact.filter(h => h.type in RANK)
    .sort((a, b) => a.archived - b.archived || RANK[a.type] - RANK[b.type])[0] || null;
}

// GET /goals/signals?status=new|accepted|dismissed|all -> { signals } (best score first)
export async function listSignals(supabase, businessId, status = 'new') {
  if (status !== 'all' && !SIGNAL_STATUSES.includes(status)) throw err(400, `status must be one of ${SIGNAL_STATUSES.join('|')}|all`);
  const rows = await selectAllPages(() => {
    const q = supabase.from('sales_signals').select(COLS).eq('business_id', businessId);
    return (status === 'all' ? q : q.eq('status', status)).order('created_at', { ascending: false }).order('id');
  });
  return rows.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.company_name.localeCompare(b.company_name));
}
export async function listSignalsRoute(req, res) {
  try { res.json({ signals: await listSignals(getSupabase(), req.params.businessId, req.query.status || 'new') }); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}

async function newOrReply(supabase, businessId, id) {
  if (!UUID.test(id || '')) return { fail: reply(404, { error: 'signal not found' }) };
  const { data, error } = await findRow(supabase, 'sales_signals', businessId, id);
  if (error) throw err(500, error.message);
  if (!data) return { fail: reply(404, { error: 'signal not found' }) };
  if (data.status !== 'new') return { fail: reply(409, { error: `${data.company_name} was already ${data.status}` }) };
  return { s: data };
}

// POST /goals/signals/:id/accept -> { signal, todo, via, record }
export async function acceptSignal(supabase, { businessId, userId, id, now = new Date() }) {
  const undo = [];
  try {
    const { s, fail } = await newOrReply(supabase, businessId, id);
    if (fail) return fail;
    const today = laDateString(now);
    const due = nextFriday(today);
    const week = laMonday(due);
    if (await weekIsFinal(supabase, businessId, week)) return reply(409, { error: FINAL_ERROR });
    const m = acceptMatch(s.company_name, await loadDupeContext(supabase, businessId));
    const stamp = slash(today);
    const detail = [s.signal, s.why_now && `Why now: ${s.why_now}`].filter(Boolean).join(' · ') || s.company_name;
    let link = null, targetId = null, via, record;

    if (!m) {
      const r = await supabase.from('sales_targets').insert({
        business_id: businessId, name: s.company_name, kind: s.kind, status: 'researching', source: s.source, signal_id: s.id, channel: SIGNAL_CHANNEL[s.source] || 'unknown',
        evidence: s.signal, owner_team: s.upside_joint ? 'both' : null, co_owner_name: s.upside_joint ? 'Brad' : null, created_by: userId,
      }).select().single();
      if (r.error?.code === '23505') throw err(409, `${s.company_name} is already a target - reload`);
      const t = must(r);
      undo.push(() => supabase.from('sales_targets').delete().eq('id', t.id));
      link = ['target', t.id]; targetId = t.id; via = 'new_target'; record = { type: 'target', id: t.id, name: t.name };
    } else if (m.type === 'partner') {
      const { event } = await applyPartnerSignal(supabase, {
        businessId, goalId: m.id, signal: { type: 'note', note: `${SOURCE_LABEL[s.source]} ${stamp}: ${detail}` }, byUser: userId, now, meta: { from_signal_id: s.id },
      });
      undo.push(() => supabase.from('sales_partner_events').delete().eq('id', event.id));
      link = ['partner', m.id]; via = 'partner'; record = { type: 'partner', id: m.id, name: m.name };
    } else if (m.type === 'opportunity') {
      const opp = must(await supabase.from('sales_opportunities').select('id, organization, notes').eq('business_id', businessId).eq('id', m.id).maybeSingle());
      if (!opp) throw err(409, `${m.name} changed since - reload`);
      const v = validateFields({ notes: appendLine(opp.notes, `(${stamp}) Signal: ${detail}`) });
      if (v.error) throw err(400, v.error);
      const q = supabase.from('sales_opportunities').update({ ...v.payload, updated_at: now.toISOString() }).eq('id', opp.id);
      const rows = must(await (opp.notes == null ? q.is('notes', null) : q.eq('notes', opp.notes)).select('id'));
      if (!rows.length) throw err(409, `${opp.organization} changed since - reload and accept again`);
      undo.push(() => supabase.from('sales_opportunities').update({ notes: opp.notes }).eq('id', opp.id));
      via = 'employer'; record = { type: 'opportunity', id: opp.id, name: opp.organization };
    } else {
      link = ['target', m.id]; targetId = m.id; via = 'target'; record = { type: 'target', id: m.id, name: m.name };
    }

    const todo = must(await supabase.from('sales_week_goals').insert({
      business_id: businessId, week_start: week, kind: 'todo', status: 'open', category: SIGNAL_CATEGORY, sort_order: 0,
      text: todoText(s), due_date: due, owner_user_id: userId, created_by: userId, link_type: link?.[0] || null, link_id: link?.[1] || null,
    }).select().single());
    undo.push(() => supabase.from('sales_week_goals').delete().eq('id', todo.id));

    const rows = must(await supabase.from('sales_signals').update({
      status: 'accepted', decided_by: userId, decided_at: now.toISOString(), updated_at: now.toISOString(), target_id: targetId, todo_id: todo.id,
      match: { type: record.type, id: record.id, name: record.name, via },
    }).eq('id', s.id).eq('status', 'new').select(COLS));
    if (!rows.length) throw err(409, `${s.company_name} was decided by someone else - reload`);
    return reply(200, { signal: rows[0], todo, via, record });
  } catch (e) {
    for (const f of undo.reverse()) { try { await f(); } catch (u) { console.error('[signals/accept] undo failed:', u.message); } }
    if (!e.status || e.status >= 500) console.error('[signals/accept]', e.message);
    return reply(e.status || 500, { error: e.message });
  }
}
export async function acceptSignalRoute(req, res) {
  send(res, await acceptSignal(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, id: req.params.id }));
}

// POST /goals/signals/:id/dismiss -> { signal }. Parked DISMISS_DAYS: an
// import inside that window skips the same company.
export async function dismissSignal(supabase, { businessId, userId, id, now = new Date() }) {
  try {
    const { s, fail } = await newOrReply(supabase, businessId, id);
    if (fail) return fail;
    const rows = must(await supabase.from('sales_signals').update({
      status: 'dismissed', dismissed_until: addDays(laDateString(now), DISMISS_DAYS), decided_by: userId, decided_at: now.toISOString(), updated_at: now.toISOString(),
    }).eq('id', s.id).eq('status', 'new').select(COLS));
    if (!rows.length) return reply(409, { error: `${s.company_name} was decided by someone else - reload` });
    return reply(200, { signal: rows[0] });
  } catch (e) {
    return reply(e.status || 500, { error: e.message });
  }
}
export async function dismissSignalRoute(req, res) {
  send(res, await dismissSignal(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, id: req.params.id }));
}

// POST /goals/signals/scout-import { file: { name, data: base64 }, dryRun }
// Member+ (salesGate). Anything but dryRun: false is a preview: nothing written.
export async function scoutImportRoute(req, res) {
  const { file, dryRun } = req.body || {};
  try {
    res.json(await scoutImport(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, file, dryRun: dryRun !== false }));
  } catch (e) {
    if (e instanceof ImportRefused) return res.status(400).json({ error: `File refused: ${e.message}`, refused: true });
    res.status(e.status || 500).json({ error: e.message });
  }
}
