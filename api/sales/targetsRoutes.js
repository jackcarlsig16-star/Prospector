import { ownerOrCaller, employerOwner } from './companyFields.js';
import { applyTodo, applyTodos, relinkAll, loadTodo, isTodo } from './todoWrite.js';
import { getSupabase, findRow, weekIsFinal } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { cleanText } from './scrubText.js';
import { SOURCE_COLS, sourceOf, logSource } from './leadSource.js';
import { laDateString } from './laDate.js';
import { resolveCompany } from './intakeMatch.js';
import { findOpportunity } from './opportunityMatch.js';
import { applyPartnerSignal } from './partnerSignals.js';
import { moveTargetPeople, relinkParked } from './visitorPeopleMove.js';
import { OWNER_TEAMS } from '../../src/constants/ownership.js';
import { restampVisits, logRestamp } from './restampVisits.js';

// call-notes-targets-v1 - companies named in notes that aren't a partner or
// an employer yet. Written by Intake's Accept (Stage 1); Stage 2 promotes a
// target to a partner / employer, marks it not a fit, and builds the
// Copy-for-Claude bundle for a partner, employer or target.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET_COLS = `id, name, kind, status, suggested_category, owner_team, co_owner_name, no_double_touch, owner_user_id, employees, employees_source, employees_at, evidence, research_notes, promoted_goal_id, employer_id, source_note_id, channel, created_at, decided_at, ${SOURCE_COLS}`;
const NOTE_COLS = 'title, call_date, source_label';
const PROMOTE_TO = ['partner', 'employer'];
const REOPEN_MAX = 50;
const NOTE_MAX = 2000; // partnerSignals' note cap
const TOUCHES_MAX = 10;
const err = (status, error) => Object.assign(new Error(error), { status });
const must = r => { if (r.error) throw err(500, r.error.message); return r.data; };
const slash = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
// Multi-line text keeps its lines; each line is scrubbed on its own.
const cleanLines = (v, max) => (typeof v === 'string' ? v.split('\n').map(l => cleanText(l, max)).filter(Boolean).join('\n') : '');

export const withSource = ({ note, ...t }) => ({ ...t, source: note ? { label: note.source_label || note.title || null, date: note.call_date } : null });

// GET /goals/prospect-targets -> { targets } (rejected ones included: they are the
// "never again" memory; the list hides them behind a toggle).
export async function listProspectTargets(supabase, businessId) {
  const rows = await selectAllPages(() => supabase.from('sales_targets')
    .select(`${TARGET_COLS}, note:sales_call_notes(${NOTE_COLS})`)
    .eq('business_id', businessId).order('created_at', { ascending: false }).order('id'));
  return rows.map(withSource);
}
export async function listProspectTargetsRoute(req, res) {
  try { res.json({ targets: await listProspectTargets(getSupabase(), req.params.businessId) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

// The core functions below return { status, body }; the routes only send it.
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);

async function targetOrNull(supabase, businessId, id) {
  if (!UUID.test(id || '')) return null;
  const { data, error } = await findRow(supabase, 'sales_targets', businessId, id);
  if (error) throw err(500, error.message);
  return data;
}

// The lists resolveCompany matches against (same sources as Intake), minus
// the target being promoted.
async function companyContext(supabase, businessId, targetId) {
  const page = (table, cols, order) => selectAllPages(() => supabase.from(table).select(cols).eq('business_id', businessId).order(order));
  const [partners, opportunities, companies, targets] = await Promise.all([
    selectAllPages(() => supabase.from('sales_goals').select('id, name').eq('business_id', businessId).eq('goal_type', 'partnership').is('archived_at', null).order('id')),
    selectAllPages(() => supabase.from('sales_opportunities').select('id, organization').eq('business_id', businessId).is('archived_at', null).order('id')),
    page('sales_sequenced_accounts', 'account_id, name', 'account_id'),
    page('sales_targets', 'id, name, status', 'id'),
  ]);
  return { partners, opportunities, companies: companies.filter(c => c.name), targets: targets.filter(t => t.id !== targetId) };
}

async function sourceNote(supabase, target) {
  if (!target.source_note_id) return null;
  const { data } = await supabase.from('sales_call_notes').select(NOTE_COLS).eq('id', target.source_note_id).maybeSingle();
  return data || null;
}

// "From intake (Brad weekly 10/13, 2026-10-13): <evidence>" + research notes.
export function intakeNote(target, note) {
  const src = note ? ` (${[note.source_label || note.title, note.call_date].filter(Boolean).join(', ')})` : '';
  const head = `From intake${src}${target.evidence ? `: ${cleanText(target.evidence, 400)}` : ''}`;
  return [head, cleanLines(target.research_notes, 400)].filter(Boolean).join('\n').slice(0, NOTE_MAX);
}

export function validatePromote(body, target) {
  const { to, name, category, owner_team, co_owner_name, no_double_touch } = body || {};
  if (!PROMOTE_TO.includes(to)) return { error: `to must be one of ${PROMOTE_TO.join('|')}` };
  if (name != null && typeof name !== 'string') return { error: 'name must be text' };
  const finalName = cleanText(name ?? target.name, 160);
  if (!finalName) return { error: 'name is required' };
  if (category != null && typeof category !== 'string') return { error: 'category must be text or null' };
  if (owner_team != null && !OWNER_TEAMS.includes(owner_team)) return { error: `owner_team must be one of ${OWNER_TEAMS.join('|')} or null` };
  if (co_owner_name != null && typeof co_owner_name !== 'string') return { error: 'co_owner_name must be text or null' };
  if (no_double_touch != null && typeof no_double_touch !== 'boolean') return { error: 'no_double_touch must be true or false' };
  // A field the panel didn't send keeps the target's value.
  return {
    payload: {
      to, name: finalName,
      category: category === undefined ? target.suggested_category : cleanText(category, 120) || null,
      owner_team: owner_team === undefined ? target.owner_team : owner_team,
      co_owner_name: co_owner_name === undefined ? target.co_owner_name : cleanText(co_owner_name, 120) || null,
      no_double_touch: no_double_touch === undefined ? !!target.no_double_touch : no_double_touch,
    },
  };
}

// Rows the company panel reads by target id follow the new record: research
// runs and the web visits matched to the target. Signals and priority
// overrides key on the company name, so they follow on their own; to-dos
// are relinked by the partner path only (an employer has no link type yet).
// visitor-people-follow-record-v1 V1 / V5: the target's people move too, and parked people of the same name join.
async function moveTargetData(supabase, { businessId, userId, target, to, id, undo, manifest }) {
  const runs = must(await supabase.from('research_runs').update({ entity_type: to, entity_id: id })
    .eq('business_id', businessId).eq('entity_type', 'target').eq('entity_id', target.id).select('id'));
  if (runs.length) undo.push(() => supabase.from('research_runs').update({ entity_type: 'target', entity_id: target.id }).in('id', runs.map(r => r.id)));
  if (manifest) manifest.runs = runs.map(r => r.id);
  // data-keys-v1 K10: the visit rows matched to the target follow the new record, and still-unmatched rows of the
  // same name / domain join it (homelover-flow-v1 ruling F-d).
  const stamped = await restampVisits(supabase, { businessId, from: { type: 'target', id: target.id }, to: { type: to, id, name: target.name, domain: target.domain || null } });
  if (stamped.ids.length) undo.push(() => supabase.from('web_visits').update({ matched_type: 'target', matched_id: target.id }).in('id', stamped.ids));
  if (manifest) { manifest.visits = stamped.ids; manifest.people = []; }
  const people = await moveTargetPeople(supabase, { businessId, userId, targetId: target.id, to, id, undo, collect: manifest?.people });
  const parked = await relinkParked(supabase, { businessId, userId, type: to, id, name: target.name, undo, collect: manifest?.people });
  const visits = stamped.ids.length + stamped.matched;
  await logRestamp(supabase, { businessId, to: { type: to, id }, text: `Promoted from the target ${target.name} · ${visits} visit ${visits === 1 ? 'row' : 'rows'} followed`, moved: stamped.ids.length, matched: stamped.matched, meta: { from_target_id: target.id }, byUser: userId });
  return { research_moved: runs.length, visits_moved: visits, people_moved: people + parked };
}

// lead-source-v1: a promoted target hands its source on unchanged (a person's pick stays theirs).
const inheritedSource = target => (target.source_kind ? { ...sourceOf(target), source_set_by: target.source_set_by || null, source_set_at: new Date().toISOString() } : {});
const logInherited = (supabase, { businessId, target, type, id, userId }) => (target.source_kind
  ? logSource(supabase, { businessId, type, id, to: target, reason: 'promote', byUser: userId }) : null);

async function rollback(undo) {
  for (const f of undo.reverse()) { try { await f(); } catch (u) { console.error('[prospect-targets/promote] undo failed:', u.message); } }
}

// Target -> accepted, in one guarded write (a teammate's click in between = 409).
async function acceptTarget(supabase, target, extra, now) {
  const rows = must(await supabase.from('sales_targets')
    .update({ status: 'accepted', decided_at: now, updated_at: now, ...extra })
    .eq('id', target.id).eq('status', target.status).select(TARGET_COLS));
  if (!rows.length) throw err(409, `${target.name} changed since - reload and try again`);
  return rows[0];
}

// company-workflow-v1 W4: a promoted target hands its employee count (and where it came from) to the new record.
const inheritedEmployees = t => (t.employees != null ? { employees: t.employees, employees_source: t.employees_source, employees_at: t.employees_at } : {});

async function promoteToPartner(supabase, { businessId, userId, target, payload, note }) {
  const now = new Date().toISOString();
  const undo = [];
  try {
    const ins = await supabase.from('sales_goals').insert({
      business_id: businessId, goal_type: 'partnership', name: payload.name, category: payload.category,
      owner_team: payload.owner_team, co_owner_name: payload.co_owner_name, no_double_touch: payload.no_double_touch,
      pipeline_status: 'not_started', channel: target.channel || 'unknown', ...inheritedSource(target), ...inheritedEmployees(target),
    }).select().single();
    if (ins.error?.code === '23505') throw err(409, `${payload.name} is already a partner`);
    const goal = must(ins);
    undo.push(() => supabase.from('sales_goals').delete().eq('id', goal.id));
    await logInherited(supabase, { businessId, target, type: 'partner', id: goal.id, userId });
    undo.push(() => supabase.from('sales_source_events').delete().eq('record_type', 'partner').eq('record_id', goal.id));
    if (payload.owner) await applyPartnerSignal(supabase, { businessId, goalId: goal.id, signal: { type: 'assign', owner_user_id: payload.owner.user_id }, byUser: userId });
    const { event } = await applyPartnerSignal(supabase, {
      businessId, goalId: goal.id, signal: { type: 'note', note: intakeNote(target, note) }, byUser: userId,
      meta: { from_target_id: target.id, ...(target.source_note_id ? { from_note_id: target.source_note_id } : {}) },
    });
    undo.push(() => supabase.from('sales_partner_events').delete().eq('id', event.id));
    // R2: the target's to-dos follow it to the partner as one batch of 'link' events
    const moved_links = await relinkAll(supabase, { businessId, from: { link_type: 'target', link_id: target.id }, to: { link_type: 'partner', link_id: goal.id }, actor: userId, origin: 'panel' });
    const relinked = moved_links.ids;
    if (relinked.length) undo.push(moved_links.undo);
    const moved = await moveTargetData(supabase, { businessId, userId, target, to: 'partner', id: goal.id, undo });
    const updated = await acceptTarget(supabase, target, { promoted_goal_id: goal.id }, now);
    return { created: { type: 'partner', id: goal.id, name: goal.name }, goal, target: updated, relinked: relinked.length, ...moved };
  } catch (e) {
    await rollback(undo);
    throw e;
  }
}

async function promoteToEmployer(supabase, { businessId, userId, target, payload, apolloAccountId, manifest }) {
  const prev = { target_status: target.status, target_decided_at: target.decided_at ?? null };
  const found = await findOpportunity(supabase, businessId, { name: payload.name, apolloAccountId });
  if (found) return { already: { type: 'employer', id: found.id, name: found.organization } };
  const now = new Date().toISOString();
  // The target keeps the employer's id (data-keys-v1 K2: employer_id); the notes line is the readable trail.
  const notes = [`(${slash(laDateString())}) from target ${target.id}: ${cleanText(target.evidence, 400) || payload.name}`, cleanLines(target.research_notes, 400)].filter(Boolean).join('\n');
  const ins = await supabase.from('sales_opportunities').insert({
    business_id: businessId, organization: payload.name, org_type: 'employer', stage: 'target', source: 'manual', channel: target.channel || 'unknown', notes,
    owner_team: payload.owner_team, co_owner_name: payload.co_owner_name, no_double_touch: payload.no_double_touch,
    ...(apolloAccountId ? { apollo_account_id: apolloAccountId } : {}), ...inheritedSource(target), ...inheritedEmployees(target),
    ...(payload.owner ? employerOwner(payload.owner) : {}),
  }).select().single();
  if (ins.error?.code === '23505') throw err(409, `${payload.name} is already in the pipeline`);
  const opportunity = must(ins);
  const undo = [() => supabase.from('sales_opportunities').delete().eq('id', opportunity.id)];
  try {
    await logInherited(supabase, { businessId, target, type: 'employer', id: opportunity.id, userId });
    undo.push(() => supabase.from('sales_source_events').delete().eq('record_type', 'employer').eq('record_id', opportunity.id));
    const moved = await moveTargetData(supabase, { businessId, userId, target, to: 'employer', id: opportunity.id, undo, manifest });
    const updated = await acceptTarget(supabase, target, { employer_id: opportunity.id }, now);
    if (manifest) Object.assign(manifest, prev);
    return { created: { type: 'employer', id: opportunity.id, name: opportunity.organization }, opportunity, target: updated, relinked: 0, ...moved };
  } catch (e) {
    await rollback(undo);
    throw e;
  }
}

// POST /goals/prospect-targets/:id/promote { to, name?, category?, owner_team?,
// co_owner_name?, no_double_touch? } -> 201 { created: { type, id, name }, target }
// or 200 { already: { type, id, name } } when the name is a partner or
// employer already. Never a stage: a partner lands at not_started, an
// employer at target. To-dos linked to the target follow a new partner; for
// an employer they stay on the target (no opportunity link type - REV4 T3 a).
// Research runs and matched web visits follow either way (research_moved,
// visits_moved in the body).
export async function promoteTarget(supabase, { businessId, userId, targetId, body }) {
  try {
    const target = await targetOrNull(supabase, businessId, targetId);
    if (!target) return reply(404, { error: 'target not found' });
    if (target.status === 'accepted') return reply(409, { error: `${target.name} was already promoted` });
    const v = validatePromote(body, target);
    if (v.error) return reply(400, { error: v.error });
    // company-workflow-v1 W3: the owner person - a picked Member, else the target's own, else the caller.
    const who = await ownerOrCaller(supabase, businessId, body?.owner_user_id || target.owner_user_id || null, userId);
    if (who.error) return reply(400, { error: who.error });
    v.payload.owner = who.person;
    const [ctx, note] = await Promise.all([companyContext(supabase, businessId, target.id), sourceNote(supabase, target)]);
    const hit = resolveCompany(v.payload.name, ctx);
    if (hit && (hit.type === 'partner' || hit.type === 'opportunity')) return reply(200, { already: { type: hit.type === 'opportunity' ? 'employer' : hit.type, id: hit.id, name: hit.name } });
    const out = v.payload.to === 'partner'
      ? await promoteToPartner(supabase, { businessId, userId, target, payload: v.payload, note })
      : await promoteToEmployer(supabase, { businessId, userId, target, payload: v.payload, apolloAccountId: hit?.type === 'account' ? hit.id : null });
    return reply(out.already ? 200 : 201, out);
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('[prospect-targets/promote]', e.message);
    return reply(e.status || 500, { error: e.message });
  }
}
export async function promoteTargetRoute(req, res) {
  send(res, await promoteTarget(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, targetId: req.params.id, body: req.body }));
}

// company-progress-bar-v1 Stage 2 ruling 1 - Mark contacted on a target (any target, a website-visitor one too) adds it to
// the pipeline as an employer and moves it to Contacted (the DB trigger logs the stage_change). Same promotion as Promote
// to employer, plus the stage. Already a partner / employer by name = { already } and nothing is created.
// -> { created, stage: { before: target status, after: 'contacted' }, undo: manifest } | { already }.
export async function contactTarget(supabase, { businessId, userId, target, now = new Date() }) {
  const before = target.status;
  if (target.status === 'accepted' || target.status === 'rejected') throw err(409, `${target.name} is ${target.status === 'accepted' ? 'already promoted' : 'marked not a fit'} - reload`);
  const v = validatePromote({ to: 'employer' }, target);
  if (v.error) throw err(400, v.error);
  const who = await ownerOrCaller(supabase, businessId, target.owner_user_id || null, userId);
  if (who.error) throw err(400, who.error);
  v.payload.owner = who.person;
  const hit = resolveCompany(v.payload.name, await companyContext(supabase, businessId, target.id));
  if (hit && (hit.type === 'partner' || hit.type === 'opportunity')) return { already: { type: hit.type === 'opportunity' ? 'employer' : 'partner', id: hit.id, name: hit.name } };
  const manifest = {};
  const out = await promoteToEmployer(supabase, { businessId, userId, target, payload: v.payload, apolloAccountId: hit?.type === 'account' ? hit.id : null, manifest });
  if (out.already) return { already: { type: 'employer', id: out.already.id, name: out.already.name } };
  const id = out.created.id;
  must(await supabase.from('sales_opportunities').update({ stage: 'contacted', updated_at: now.toISOString() }).eq('business_id', businessId).eq('id', id).eq('stage', 'target').select('id'));
  return { created: { type: 'employer', id, name: out.created.name }, stage: { before, after: 'contacted' }, undo: { opportunity_id: id, ...manifest } };
}

// POST /goals/prospect-targets/:id/contacted-undo { opportunity_id, target_status, target_decided_at, runs, visits, people,
// todo_id? } - the Undo of contactTarget: the target's rows go back, then the new employer is deleted (its stage events
// cascade). Only an employer made from THIS target in the last UNDO_WINDOW_MS, and only rows still linked to it, move.
const UNDO_WINDOW_MS = 2 * 60 * 1000;
const RESTORABLE = ['proposed', 'researching'];
const idList = v => (Array.isArray(v) && v.length <= 500 && v.every(x => typeof x === 'string' || Number.isInteger(x)) ? v : null);
export async function undoContactTarget(supabase, { businessId, targetId, body, userId = null, now = new Date() }) {
  const b = body || {};
  if (!UUID.test(b.opportunity_id || '')) return reply(400, { error: 'opportunity_id is required' });
  if (!RESTORABLE.includes(b.target_status)) return reply(400, { error: `target_status must be one of ${RESTORABLE.join('|')}` });
  const runs = idList(b.runs ?? []), visits = idList(b.visits ?? []);
  const people = Array.isArray(b.people) && b.people.length <= 500 ? b.people : null;
  if (!runs || !visits || !people) return reply(400, { error: 'runs, visits and people must be lists' });
  if (people.some(p => !p || !['target', 'parked'].includes(p.company_type) || (p.target_id != null && p.target_id !== targetId))) return reply(400, { error: 'people must go back to this target or parked' });
  try {
    const target = await targetOrNull(supabase, businessId, targetId);
    if (!target) return reply(404, { error: 'target not found' });
    if (target.status !== 'accepted') return reply(409, { error: `${target.name} changed since - reload` });
    const opp = must(await supabase.from('sales_opportunities').select('id, notes, created_at, archived_at').eq('business_id', businessId).eq('id', b.opportunity_id).maybeSingle());
    if (!opp || !String(opp.notes || '').includes(`from target ${targetId}`)) return reply(404, { error: 'that employer was not made from this target' });
    if (now - new Date(opp.created_at) > UNDO_WINDOW_MS) return reply(409, { error: 'too late to undo - archive the employer instead' });
    const stamp = now.toISOString();
    if (runs.length) must(await supabase.from('research_runs').update({ entity_type: 'target', entity_id: targetId }).eq('business_id', businessId).eq('entity_type', 'employer').eq('entity_id', opp.id).in('id', runs).select('id'));
    if (visits.length) must(await supabase.from('web_visits').update({ matched_type: 'target', matched_id: targetId }).eq('business_id', businessId).eq('matched_type', 'employer').eq('matched_id', opp.id).in('id', visits).select('id'));
    for (const p of people) {
      must(await supabase.from('sales_people').update({ company_type: p.company_type, target_id: p.company_type === 'target' ? targetId : null, opportunity_id: null, updated_at: stamp })
        .eq('business_id', businessId).eq('id', p.id).eq('opportunity_id', opp.id).select('id'));
    }
    if (b.todo_id != null) {
      const todo = await loadTodo(supabase, businessId, b.todo_id);
      if (todo && isTodo(todo) && todo.link_type === 'employer' && todo.link_id === opp.id) await applyTodo(supabase, { businessId, row: todo, patch: { status: 'dropped' }, actor: userId, origin: 'panel', now });
    }
    must(await supabase.from('sales_source_events').delete().eq('business_id', businessId).eq('record_type', 'employer').eq('record_id', opp.id));
    must(await supabase.from('sales_opportunities').delete().eq('business_id', businessId).eq('id', opp.id).select('id'));
    const back = must(await supabase.from('sales_targets').update({ status: b.target_status, decided_at: b.target_decided_at ?? null, updated_at: stamp })
      .eq('business_id', businessId).eq('id', targetId).eq('status', 'accepted').select(TARGET_COLS));
    return reply(200, { target: back[0] || null, removed: { type: 'employer', id: opp.id } });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('[prospect-targets/contacted-undo]', e.message);
    return reply(e.status || 500, { error: e.message });
  }
}
export async function undoContactTargetRoute(req, res) {
  send(res, await undoContactTarget(getSupabase(), { businessId: req.params.businessId, targetId: req.params.id, body: req.body, userId: req.auth.user.id }));
}

// POST /goals/prospect-targets/:id/reject -> { target, dropped: [to-do ids] }
// Its open to-dos are dropped (never deleted, never done: done would be a
// finished task). { undo: true, reopen: [ids] } puts it back to researching
// and reopens those to-dos, within the client's undo window.
export async function rejectTarget(supabase, { businessId, targetId, body, userId = null }) {
  const now = new Date().toISOString();
  const { undo, reopen } = body || {};
  try {
    const target = await targetOrNull(supabase, businessId, targetId);
    if (!target) return reply(404, { error: 'target not found' });
    if (undo === true) {
      if (target.status !== 'rejected') return reply(409, { error: `${target.name} is not marked not-a-fit` });
      if (reopen != null && !(Array.isArray(reopen) && reopen.length <= REOPEN_MAX && reopen.every(id => UUID.test(id)))) return reply(400, { error: `reopen must be a list of up to ${REOPEN_MAX} to-do ids` });
      const rows = must(await supabase.from('sales_targets').update({ status: 'researching', decided_at: null, updated_at: now })
        .eq('id', target.id).eq('status', 'rejected').select(TARGET_COLS));
      if (!rows.length) return reply(409, { error: `${target.name} changed since - reload` });
      // R2: the undo reopens them as one batch ('undone')
      const back = reopen?.length ? must(await supabase.from('sales_week_goals').select('*')
        .eq('business_id', businessId).eq('kind', 'todo').eq('link_type', 'target').eq('link_id', target.id).eq('status', 'dropped').in('id', reopen)) : [];
      const reopened = back.length ? (await applyTodos(supabase, { businessId, todos: back, patch: { status: 'open' }, actor: userId, origin: 'panel' })).todos : [];
      return reply(200, { target: rows[0], reopened: reopened.map(r => r.id) });
    }
    if (target.status === 'accepted') return reply(409, { error: `${target.name} was promoted - archive the partner or opportunity instead` });
    if (target.status === 'rejected') return reply(409, { error: `${target.name} is already not a fit` });
    const open = must(await supabase.from('sales_week_goals').select('*')
      .eq('business_id', businessId).eq('kind', 'todo').eq('link_type', 'target').eq('link_id', target.id).eq('status', 'open'));
    // A finalized week is frozen: its to-dos stay as they are.
    const finalWeeks = new Set();
    for (const w of new Set(open.map(t => t.week_start))) if (await weekIsFinal(supabase, businessId, w)) finalWeeks.add(w);
    // R2: its open to-dos are dropped as one batch (kind 'drop', origin 'panel')
    const live = open.filter(t => !finalWeeks.has(t.week_start) && isTodo(t));
    const batch = live.length ? await applyTodos(supabase, { businessId, todos: live, patch: { status: 'dropped' }, actor: userId, origin: 'panel' }) : null;
    const dropped = batch ? batch.todos : [];
    const rows = must(await supabase.from('sales_targets').update({ status: 'rejected', decided_at: now, updated_at: now })
      .eq('id', target.id).eq('status', target.status).select(TARGET_COLS));
    if (!rows.length) {
      if (dropped.length) await applyTodos(supabase, { businessId, todos: dropped, patch: { status: 'open' }, actor: userId, origin: 'panel', batchId: batch.batchId });
      return reply(409, { error: `${target.name} changed since - reload` });
    }
    return reply(200, { target: rows[0], dropped: dropped.map(r => r.id), ...(batch ? { batch_id: batch.batchId } : {}) });
  } catch (e) {
    return reply(e.status || 500, { error: e.message });
  }
}
export async function rejectTargetRoute(req, res) {
  send(res, await rejectTarget(getSupabase(), { businessId: req.params.businessId, targetId: req.params.id, body: req.body, userId: req.auth.user.id }));
}

// ── Copy for Claude ──────────────────────────────────────────────────────────
// FIX claude-pack-dossier: the pack IS the dossier (dossier.js - one builder for Scout's copy verb, Today's prompt
// pack and every Copy for Claude button). No AI call. Every string passes cleanText; nothing is returned at all if an
// "@" or a phone shape is still in the result (stored linkedin.com/in/ links are the one allowed URL).
const BUNDLE_TYPES = ['partner', 'employer', 'target'];
export const PACK_MAX = 12000;
export const PACK_FULL_MAX = 40000;
const when = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' }) : '');
const onDay = d => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
const t = (v, max = 400) => cleanLines(v, max);

async function memberNames(supabase, businessId) {
  const { data } = await supabase.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId).not('user_id', 'is', null);
  return Object.fromEntries((data || []).map(m => [m.user_id, m.profile?.display_name || m.name]));
}

// A person (a People row key): their company's dossier with them first when a record holds them; else who they are,
// their heat and email / site signals and their timeline. Names, titles, companies only.
async function personBlock(supabase, businessId, key, names) {
  const { peopleActivity, personDetail } = await import('./peopleActivityRoutes.js');
  const all = await peopleActivity(supabase, businessId, { window: 'all', snoozed: 'all' });
  const p = all.status === 200 ? all.body.rows.find(r => r.key === key) : null;
  if (!p) throw err(404, 'person not found');
  if (p.company?.id && BUNDLE_TYPES.includes(p.company.type)) return recordBlock(supabase, businessId, { type: p.company.type, id: p.company.id, first: { key, name: p.name } }, names);
  const d = await personDetail(supabase, businessId, { key });
  const timeline = d.status === 200 ? d.body.timeline.filter(x => !x.automated).slice(0, TOUCHES_MAX).map(x => `- ${[when(x.at), x.kind, x.step != null ? `step ${x.step}` : null, x.reply_class, x.subject ? t(x.subject, 160) : null].filter(Boolean).join(' · ')}`) : [];
  return { flat: [
    `# ${t(p.name, 120)} — person`,
    [p.title ? t(p.title, 160) : null, p.company?.name ? t(p.company.name, 160) : 'no company on file', p.source].filter(Boolean).join(' · '),
    [p.heat != null ? `Heat: ${p.heat_band} (${p.heat})` : 'Heat: none yet', `Emails: ${p.emails.sent} sent, ${p.emails.opened} opened, ${p.emails.clicked} clicked, ${p.emails.replied} replied`, p.last_email ? `last ${p.last_email.what} ${when(p.last_email.at)}` : null].filter(Boolean).join(' · '),
    ...(p.visits ? [`Website: ${p.visits.visits_7d} visits in 7 days${p.visits.last_visit ? `, last ${onDay(String(p.visits.last_visit).slice(0, 10))}` : ''}${p.visits.top_page ? `, top page ${t(p.visits.top_page, 120)}` : ''}`] : []),
    ...(d.status === 200 && d.body.notes ? [`Note: ${t(d.body.notes, 400)}`] : []),
    '', `## Timeline (${timeline.length})`, ...(timeline.length ? timeline : ['- no email activity']),
  ] };
}
async function recordBlock(supabase, businessId, r, names) {
  if (r.type === 'person') return personBlock(supabase, businessId, r.id, names);
  const { dossier } = await import('./dossier.js');
  return { type: r.type, ...await dossier(supabase, { businessId, type: r.type, id: r.id, names, first: r.first || null }) };
}

// scout-v3 D10 - Copy for Claude from Scout and Today: Scope + date · each record's dossier · About us · Ask (the
// question typed, or the ask chip). P2: at most PACK_MAX characters (full: PACK_FULL_MAX), cut lines counted per
// section. -> { text, records, chars, cut } | { blocked: true }.
export async function copyPack(supabase, { businessId, question, scope, today, records, full = false }) {
  const names = await memberNames(supabase, businessId);
  const blocks = [];
  for (const r of records) {
    if (r.type !== 'person' && !(BUNDLE_TYPES.includes(r.type) && UUID.test(r.id || ''))) continue;
    try { blocks.push(await recordBlock(supabase, businessId, r, names)); } catch (e) { if (e.status !== 404) throw e; }
  }
  if (!blocks.length) throw err(404, 'no record to copy');
  const { buildPack } = await import('./dossier.js');
  const head = [`Scope: ${[scope ? t(scope, 80) : null, today].filter(Boolean).join(' · ')} · ${blocks.length} record${blocks.length === 1 ? '' : 's'}`];
  const pack = await buildPack(supabase, { businessId, blocks, head, ask: t(question, 500), max: full ? PACK_FULL_MAX : PACK_MAX });
  if (pack.blocked) { console.error('[copy-pack] blocked: scrub left an email or phone shape'); return pack; }
  return { ...pack, records: blocks.length };
}

// GET /goals/copy-bundle?type=partner|employer|target&id=<uuid>[&person=<people key>][&full=1] -> { markdown, chars, cut }.
// The markdown ends with "## Ask" - the caller appends what it wants. Viewer+: it is data they can already see.
export async function copyBundle(supabase, { businessId, type, id, person = null, full = false }) {
  if (!BUNDLE_TYPES.includes(type)) return reply(400, { error: `type must be one of ${BUNDLE_TYPES.join('|')}` });
  if (!UUID.test(id || '')) return reply(400, { error: 'id must be a uuid' });
  try {
    const names = await memberNames(supabase, businessId);
    const block = await recordBlock(supabase, businessId, { type, id, first: person ? { key: String(person).slice(0, 200), name: null } : null }, names);
    const { buildPack } = await import('./dossier.js');
    const pack = await buildPack(supabase, { businessId, blocks: [block], max: full ? PACK_FULL_MAX : PACK_MAX });
    if (pack.blocked) {
      console.error(`[copy-bundle] blocked ${type} ${id}: scrub left an email or phone shape`);
      return reply(500, { error: 'The bundle was blocked: it still held an email or phone shape', code: 'bundle_pii' });
    }
    return reply(200, { markdown: pack.text, chars: pack.chars, cut: pack.cut });
  } catch (e) {
    return reply(e.status || 500, { error: e.message });
  }
}
export async function copyBundleRoute(req, res) {
  send(res, await copyBundle(getSupabase(), { businessId: req.params.businessId, type: req.query.type, id: req.query.id, person: req.query.person || null, full: req.query.full === '1' }));
}
