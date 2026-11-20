import { cleanText, hasPii } from './scrubText.js';
import { addDays } from './goalsShared.js';
import { findCompany, findPerson, salesReads } from './scoutIntents.js';
import { normName } from './intakeMatch.js';
import { loadPerson } from './personWrite.js';
import { readType } from './readType.js';
import { linkFor } from './todoLink.js';
import { laMonday } from './goalsShared.js';
import { FIVE } from './todayRank.js';

// scout-v3 S1 + the Stage 0 rulings (R1-R9) - the sales module's verbs for Scout's plan / act / undo. Every write goes
// through an EXISTING route or its function with that route's guards, and every reverse is that route's own Undo:
//   assign        a PERSON row: the person's owner through applyPerson with expect + its event Undo (person-owner-v1 O5)
//                 partner: the assign signal + partner undo · employer / target: company fields with expect (R8) + flow undo
//   mark contacted  the person's status + a done to-do (employer) or an email touch with no stage move (partner) - R1
//   not a fit     prospect status 'dead' · target reject · employer / partner fit deprioritize - R2
//   snooze        prospect snooze_until · partner snooze signal; employers / targets / to-dos can't - R5-R7
//   draft email / copy for Claude write nothing - R3, R12
// scout-v3.1: draft email = the Write-email call itself (composeEmail, its cap, its usage row) addressed to the person
// of the row, returned as text - never sent (C2). Task verbs go through applyTodo with expect, the card's plan id as
// batch_id and the event's own Undo (C4): add (typed), done, reassign (the assign verb), snooze, due, drop.
// actions-v2 R2: This week's five - add a to-do to a slot (a commitment row that links it), remove = that row dropped.
// actions-v2 A3 / A4 / A6: Today's batches are verbs here too - finish (the to-do done + its person contacted, one Undo),
// reply to-dos (Q6: one to-do per unanswered reply), assign to the company's owner, link the company a to-do names -
// and "draft / what next / prep me" on a to-do row opens Today's work panel on that row (no call is made here).
// Stage moves, sends, deletes, client adds and Apollo writes have no verb here. salesWrites is swapped by tests.
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const lazy = (file, name) => async (...a) => (await import(file))[name](...a);
// A route handler called in process: the same validation, guards and DB trigger as the browser's request.
const viaRoute = (file, name) => async ({ params, body, auth }) => {
  let status = 200, out = null;
  const res = { status(s) { status = s; return res; }, json(b) { out = b; return res; } };
  await (await import(file))[name]({ params, body, query: {}, auth }, res);
  return { status, body: out };
};
export const salesWrites = {
  partnerSignal: lazy('./partnerSignals.js', 'applyPartnerSignal'),
  partnerUndo: lazy('./partnerSignals.js', 'undoPartnerSignal'),
  companyFields: lazy('./companyFields.js', 'editCompanyFields'),
  flowUndo: lazy('./flowEvents.js', 'undoFlow'),
  person: lazy('./personWrite.js', 'applyPerson'),
  personUndo: lazy('./personWrite.js', 'undoPersonEvent'),
  prospect: viaRoute('./huddleRoutes.js', 'updateProspectRoute'),
  todoOn: lazy('./companyPanel.js', 'todoOn'),
  todoUndoCreate: lazy('./todoWrite.js', 'undoCreate'),
  todo: lazy('./todoWrite.js', 'applyTodo'),
  todoLoad: lazy('./todoWrite.js', 'loadTodo'),
  todoEventUndo: lazy('./todoWrite.js', 'undoTodoEvent'),
  compose: lazy('./composeRoutes.js', 'composeEmail'),
  rejectTarget: lazy('./targetsRoutes.js', 'rejectTarget'),
  deprioritize: lazy('./fitActions.js', 'deprioritize'),
  linkable: lazy('./todayRoutes.js', 'linkableRecords'),
  weekGoalCreate: viaRoute('./goalsRoutes.js', 'createWeekGoalRoute'),
  weekGoalUpdate: viaRoute('./goalsRoutes.js', 'updateWeekGoalRoute'),
  dataKeys: lazy('./dataKeysFlag.js', 'dataKeysRan'),
};
const ok = r => { if (r.status >= 400) throw Object.assign(new Error(r.body?.error || 'failed'), { status: r.status, code: r.body?.code }); return r.body; };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND = { partners: 'partner', employers: 'employer', targets: 'target' };
const COMPANY_ENTITIES = Object.keys(KIND);
const KIND_NAME = { partner: 'Partner', employer: 'Employer', target: 'Target' };
const TABLE = { partner: ['sales_goals', 'name', ', pipeline_status, snoozed_until'], employer: ['sales_opportunities', 'organization', ', stage'], target: ['sales_targets', 'name', ', status'] };
const STATUS_WORD = { new: 'new', claimed: 'claimed', contacted: 'contacted', booked: 'booked', not_now: 'not now', dead: 'not a fit' };

export async function salesMembers(sb, businessId) {
  const rows = must(await sb.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId).not('user_id', 'is', null));
  return rows.map(m => ({ id: m.user_id, name: cleanText((m.profile?.display_name || m.name || 'Member').trim(), 80) })).filter(m => m.name);
}
async function loadCompany(sb, businessId, type, id) {
  if (!TABLE[type] || !UUID.test(String(id || ''))) return null;
  const [table, nameCol, extra] = TABLE[type];
  const row = must(await sb.from(table).select(`id, ${nameCol}, owner_user_id, fit_level${extra}`).eq('business_id', businessId).eq('id', id).maybeSingle());
  return row ? { type, id: row.id, name: cleanText(row[nameCol], 160), owner_user_id: row.owner_user_id || null, fit_level: row.fit_level || null, stage: row.pipeline_status || row.stage || row.status || null, snoozed_until: row.snoozed_until || null } : null;
}
const prospectOf = async (sb, businessId, key) => (String(key).startsWith('prospect:') ? must(await sb.from('sales_prospect_state').select('contact_id, name, status, snooze_until, opportunity_id, goal_id').eq('business_id', businessId).eq('contact_id', String(key).slice('prospect:'.length)).maybeSingle()) : null);
// A row of the answer -> { company, prospect, person }: a company row is its own record; a person row resolves to
// their company's record (the prospect's link first, else the company the row carried) - null when there is none (K4).
async function resolve(sb, businessId, t) {
  if (KIND[t.entity]) return { company: await loadCompany(sb, businessId, KIND[t.entity], t.id), prospect: null, person: false };
  if (t.entity !== 'people') return { company: null, prospect: null, person: false };
  const prospect = await prospectOf(sb, businessId, t.id);
  const ref = prospect?.opportunity_id ? { type: 'employer', id: prospect.opportunity_id } : prospect?.goal_id ? { type: 'partner', id: prospect.goal_id } : t.company;
  return { company: ref ? await loadCompany(sb, businessId, ref.type, ref.id) : null, prospect, person: true };
}
const base = (t, title = t.title) => ({ key: t.key, kind: KIND[t.entity] || (t.entity === 'people' ? 'person' : t.entity), title });
const block = (t, reason) => ({ ...base(t), skipped: reason, blocked: true });
const NO_RECORD = 'no company record';
const named = async (sb, businessId, names) => (await Promise.all(names.map(n => findCompany(sb, businessId, n)))).filter(Boolean).map(c => ({ key: `${Object.keys(KIND).find(k => KIND[k] === c.type)}:${c.id}`, entity: Object.keys(KIND).find(k => KIND[k] === c.type), id: c.id, title: cleanText(c.name, 160), company: null }));
const prospectPatch = async (ctx, contactId, body) => salesWrites.prospect({ params: { businessId: ctx.businessId, contactId }, body, auth: ctx.auth });
// C4 - a to-do row of the answer, read fresh for the card; the act sends what the card showed as expect.
const todoOf = async (sb, ctx, t) => { const row = await salesWrites.todoLoad(sb, ctx.businessId, t.id); return row && row.kind === 'todo' && !row.prospect_contact_id ? row : null; };
const GONE = 'that to-do is no longer open';
async function todoAct(sb, ctx, x, patch, kind, expect) {
  try {
    const { event } = await salesWrites.todo(sb, { businessId: ctx.businessId, todoId: x.todo, patch, kind, expect, actor: ctx.auth.user.id, origin: 'scout', batchId: ctx.planId, now: new Date(ctx.now) });
    return event ? { undo: { todo_event: event.id } } : { skipped: 'nothing to change' };
  } catch (e) { if (e.status === 409) return { skipped: 'changed meanwhile' }; throw e; }
}
const todoUndo = (sb, ctx, h) => salesWrites.todoEventUndo(sb, { businessId: ctx.businessId, eventId: h.todo_event, actor: ctx.auth.user.id, now: new Date(ctx.now) });
const taskTitle = row => cleanText(row.text, 140);
const REASONS = [[/outside (the )?u\.?s/, 'mostly_outside_us', 'Mostly outside US'], [/too small/, 'too_small', 'Too small'], [/wrong industry/, 'wrong_industry', 'Wrong industry'], [/housing perk/, 'has_housing_perk', 'Has housing perk'], [/upside/, 'upside_owns', 'Upside owns']];

// person-owner-v1 O5 - what a typed assign names, when no row of the answer was picked: a company ("assign Cloudflare
// to Cyrus"), a company's people ("assign the Cloudflare people to Cyrus" - one row per person), or a person by full
// name or by a first name only one person carries ("assign Danilea to Cyrus").
const PEOPLE_WORD = /\b(people|contacts|prospects|leads)\b/;
async function assignTargets(sb, ctx, args) {
  const names = args.names || [];
  if (!names.length) return [];
  let people = null;
  const allPeople = async () => (people ||= await salesReads.peopleActivity(sb, ctx.businessId, { window: 'all', snoozed: 'all' }).then(r => (r.status === 200 ? r.body.rows : [])));
  const personRow = p => ({ key: `people:${p.key}`, entity: 'people', id: p.key, title: p.name });
  const out = [];
  for (const n of names) {
    const c = await findCompany(sb, ctx.businessId, n);
    if (c && PEOPLE_WORD.test(args.text || '')) { out.push(...(await allPeople()).filter(p => p.company?.id === c.id && p.company?.type === c.type).map(personRow)); continue; }
    if (c) { const entity = Object.keys(KIND).find(k => KIND[k] === c.type); out.push({ key: `${entity}:${c.id}`, entity, id: c.id, title: c.name }); continue; }
    const key = normName(n);
    const rows = await allPeople();
    const exact = rows.filter(p => normName(p.name) === key);
    const hits = exact.length ? exact : rows.filter(p => normName(p.name).split(' ')[0] === key);
    if (hits.length === 1) out.push(personRow(hits[0]));
  }
  return out;
}

const assign = {
  id: 'assign', label: 'Assign', done: 'Assigned', lead: /^(?:re)?assign\b|^unassign\b/, accepts: ['people', 'todos', ...COMPANY_ENTITIES], needs: 'member',
  async plan(sb, ctx, targets, args) {
    const list = targets.length ? targets : await assignTargets(sb, ctx, args);
    const members = await salesMembers(sb, ctx.businessId);
    const nameOf = id => (id ? members.find(m => m.id === id)?.name.split(/\s+/)[0] || 'another member' : 'Unassigned');
    const rows = [], seen = new Set();
    for (const t of list) {
      if (t.entity === 'todos') {
        const todo = await todoOf(sb, ctx, t);
        if (!todo || todo.status !== 'open') { rows.push(block(t, GONE)); continue; }
        const row = { ...base(t, taskTitle(todo)), kind: 'task', from: nameOf(todo.owner_user_id), to: nameOf(args.owner_user_id) };
        rows.push((todo.owner_user_id || null) === (args.owner_user_id || null) ? { ...row, skipped: `already ${row.to}` } : { ...row, exec: { todo: todo.id, from: todo.owner_user_id || null } });
        continue;
      }
      if (t.entity === 'people') {
        // O5 (D5 revised): a person row assigns the PERSON, never their company.
        const p = await loadPerson(sb, ctx.businessId, t.id);
        if (!p) { rows.push(block(t, 'that person is no longer on the list')); continue; }
        const row = { ...base(t, t.title || p.name), from: nameOf(p.owner_user_id), to: nameOf(args.owner_user_id) };
        if (seen.has(p.key)) rows.push({ ...row, skipped: 'same person as a row above' });
        else if ((p.owner_user_id || null) === (args.owner_user_id || null)) rows.push({ ...row, skipped: `already ${row.to}` });
        else rows.push({ ...row, exec: { person: p.key, from: p.owner_user_id } });
        seen.add(p.key);
        continue;
      }
      const { company } = await resolve(sb, ctx.businessId, t);
      if (!company) { rows.push(block(t, NO_RECORD)); continue; }
      const row = { ...base(t, company.name), kind: company.type, from: nameOf(company.owner_user_id), to: nameOf(args.owner_user_id) };
      const k = `${company.type}:${company.id}`;
      if (seen.has(k)) rows.push({ ...row, skipped: 'same company as a row above' });
      else if ((company.owner_user_id || null) === (args.owner_user_id || null)) rows.push({ ...row, skipped: `already ${row.to}` });
      else rows.push({ ...row, exec: { type: company.type, id: company.id, from: company.owner_user_id } });
      seen.add(k);
    }
    return { rows };
  },
  async act(sb, ctx, x, args) {
    if (x.todo) return todoAct(sb, ctx, x, { owner_user_id: args.owner_user_id ?? null }, 'reassign', { owner_user_id: x.from });
    if (x.person) {
      // one batch per card (the plan id), so a card of people is one batch of events
      try {
        const { event } = await salesWrites.person(sb, { businessId: ctx.businessId, personKey: x.person, fields: { owner_user_id: args.owner_user_id ?? null }, expect: { owner_user_id: x.from || null }, actor: ctx.auth.user.id, origin: 'scout', batchId: ctx.planId });
        return event ? { undo: { person_event: event.id } } : { skipped: 'already that owner' };
      } catch (e) { if (e.status === 409 && e.code === 'changed') return { skipped: 'owner changed meanwhile' }; throw e; }
    }
    if (x.type === 'partner') {
      const now = await loadCompany(sb, ctx.businessId, 'partner', x.id);
      if (!now) throw new Error('partner not found');
      if ((now.owner_user_id || null) !== (x.from || null)) return { skipped: 'owner changed meanwhile' };
      const { event } = await salesWrites.partnerSignal(sb, { businessId: ctx.businessId, goalId: x.id, signal: { type: 'assign', owner_user_id: args.owner_user_id }, byUser: ctx.auth.user.id, meta: { origin: 'scout' } });
      return { undo: { partner_event: event.id } };
    }
    const r = await salesWrites.companyFields(sb, { businessId: ctx.businessId, type: x.type, id: x.id, body: { owner_user_id: args.owner_user_id, expect: { owner_user_id: x.from || null } }, byUser: ctx.auth.user.id, origin: 'scout' });
    if (r.status === 409 && r.body?.code === 'changed') return { skipped: r.body.error };
    return { undo: { flow_event: ok(r).event?.id || null } };
  },
  async undo(sb, ctx, x, h) {
    if (h?.todo_event) await todoUndo(sb, ctx, h);
    else if (h?.person_event) await salesWrites.personUndo(sb, { businessId: ctx.businessId, eventId: h.person_event, actor: ctx.auth.user.id });
    else if (h?.partner_event) await salesWrites.partnerUndo(sb, { businessId: ctx.businessId, goalId: x.id, eventId: h.partner_event, byUser: ctx.auth.user.id });
    else if (h?.flow_event) ok(await salesWrites.flowUndo(sb, { businessId: ctx.businessId, eventId: h.flow_event, byUser: ctx.auth.user.id }));
    else throw new Error('nothing recorded to undo');
  },
};

const contacted = {
  id: 'contacted', label: 'Mark contacted', done: 'Marked contacted', lead: /^mark\b.*\bcontacted\b|^log (?:a |an )?(?:touch|email)\b/, accepts: ['people', ...COMPANY_ENTITIES],
  async plan(sb, ctx, targets, args) {
    const rows = [];
    if (!targets.length) targets = await named(sb, ctx.businessId, args?.names || []);
    for (const t of targets) {
      const { company, prospect, person } = await resolve(sb, ctx.businessId, t);
      if (!person && company?.type === 'partner') { rows.push({ ...base(t, company.name), from: null, to: 'email touch logged', exec: { partner: { id: company.id, stage: company.stage || 'not_started' }, name: null } }); continue; }
      if (!person) { rows.push(block(t, "mark a person contacted - a company's stage moves from its window")); continue; }
      if (!company) { rows.push(block(t, NO_RECORD)); continue; }
      const note = `${company.name}'s stage unchanged - advance it from its window`;
      const partner = company.type === 'partner' ? { id: company.id, stage: company.stage || 'not_started' } : null;
      if (!prospect) { rows.push(partner ? { ...base(t), from: null, to: 'email touch logged', note, exec: { partner, name: t.title } } : block(t, 'only sequenced people can be marked contacted')); continue; }
      if (prospect.status === 'contacted') { rows.push({ ...base(t), from: 'contacted', to: 'contacted', skipped: 'already contacted' }); continue; }
      rows.push({ ...base(t), from: STATUS_WORD[prospect.status] || prospect.status || 'new', to: 'contacted', note, exec: { contact_id: prospect.contact_id, before: prospect.status, name: t.title, partner, employer: company.type === 'employer' ? company.id : null } });
    }
    return { rows };
  },
  async act(sb, ctx, x) {
    const undo = {};
    if (x.contact_id) {
      const r = await prospectPatch(ctx, x.contact_id, { status: 'contacted', expect: { status: x.before } });
      if (r.status === 409) return { skipped: 'changed meanwhile' };
      ok(r); undo.status = x.before;
    }
    try {
      if (x.partner) undo.partner_event = (await salesWrites.partnerSignal(sb, { businessId: ctx.businessId, goalId: x.partner.id, signal: { type: 'touch', touch_type: 'email', date: ctx.today, move_to: 'none', expect: x.partner.stage, contacts: x.name ? [x.name] : [] }, byUser: ctx.auth.user.id, meta: { origin: 'scout' } })).event.id;
      else if (x.employer) undo.todo = (await salesWrites.todoOn(sb, { businessId: ctx.businessId, userId: ctx.auth.user.id, type: 'employer', id: x.employer, text: `Contacted ${x.name}`, today: ctx.today, done: true, now: new Date(ctx.now), origin: 'scout' })).id;
    } catch (e) {
      if (x.contact_id) await prospectPatch(ctx, x.contact_id, { status: x.before, expect: { status: 'contacted' } });
      throw e;
    }
    return { undo };
  },
  async undo(sb, ctx, x, h) {
    if (h.partner_event) await salesWrites.partnerUndo(sb, { businessId: ctx.businessId, goalId: x.partner.id, eventId: h.partner_event, byUser: ctx.auth.user.id });
    if (h.todo) await salesWrites.todoUndoCreate(sb, { businessId: ctx.businessId, todoId: h.todo, actor: ctx.auth.user.id });
    if (x.contact_id) ok(await prospectPatch(ctx, x.contact_id, { status: h.status, expect: { status: 'contacted' } }));
  },
};

const notFit = {
  id: 'not_fit', label: 'Not a fit', done: 'Marked not a fit', lead: /^mark\b.*\bnot a fit\b|^not a fit\b|^deprioriti[sz]e\b/, accepts: ['people', ...COMPANY_ENTITIES],
  async plan(sb, ctx, targets, args) {
    const why = REASONS.find(([re]) => re.test(args.text || ''));
    const fit = why ? { reason: why[1], note: null, word: why[2] } : { reason: 'other', note: 'Not a fit', word: 'Not a fit' };
    const rows = [];
    if (!targets.length) targets = await named(sb, ctx.businessId, args?.names || []);
    for (const t of targets) {
      if (t.entity === 'people') {
        const prospect = await prospectOf(sb, ctx.businessId, t.id);
        if (!prospect) rows.push(block(t, 'only sequenced people can be marked not a fit'));
        else if (prospect.status === 'dead') rows.push({ ...base(t), from: 'not a fit', to: 'not a fit', skipped: 'already not a fit' });
        else rows.push({ ...base(t), from: STATUS_WORD[prospect.status] || prospect.status || 'new', to: 'not a fit', exec: { contact_id: prospect.contact_id, before: prospect.status } });
        continue;
      }
      const c = await loadCompany(sb, ctx.businessId, KIND[t.entity], t.id);
      if (!c) rows.push(block(t, NO_RECORD));
      else if (c.type === 'target') rows.push(c.stage === 'rejected' ? { ...base(t, c.name), from: 'not a fit', to: 'not a fit', skipped: 'already not a fit' } : c.stage === 'accepted' ? block(t, 'already promoted - mark its partner or employer instead') : { ...base(t, c.name), from: c.stage, to: 'not a fit', note: 'its open to-dos are dropped', exec: { target: c.id } });
      else rows.push(c.fit_level === 'deprioritized' ? { ...base(t, c.name), from: 'deprioritized', to: 'deprioritized', skipped: 'already deprioritized' } : { ...base(t, c.name), from: c.fit_level || 'fit by score', to: `deprioritized · ${fit.word}`, exec: { fit: { type: c.type, id: c.id, reason: fit.reason, note: fit.note } } });
    }
    return { rows };
  },
  async act(sb, ctx, x) {
    if (x.contact_id) { const r = await prospectPatch(ctx, x.contact_id, { status: 'dead', expect: { status: x.before } }); if (r.status === 409) return { skipped: 'changed meanwhile' }; ok(r); return { undo: { status: x.before } }; }
    if (x.target) return { undo: { reopen: ok(await salesWrites.rejectTarget(sb, { businessId: ctx.businessId, targetId: x.target, body: {}, userId: ctx.auth.user.id })).dropped || [] } };
    const r = await salesWrites.deprioritize(sb, { businessId: ctx.businessId, userId: ctx.auth.user.id, type: x.fit.type, id: x.fit.id, body: { reason: x.fit.reason, ...(x.fit.note ? { note: x.fit.note } : {}) } });
    return { undo: { flow_event: ok(r).event.id } };
  },
  async undo(sb, ctx, x, h) {
    if (x.contact_id) ok(await prospectPatch(ctx, x.contact_id, { status: h.status, expect: { status: 'dead' } }));
    else if (x.target) ok(await salesWrites.rejectTarget(sb, { businessId: ctx.businessId, targetId: x.target, body: { undo: true, reopen: h.reopen }, userId: ctx.auth.user.id }));
    else ok(await salesWrites.flowUndo(sb, { businessId: ctx.businessId, eventId: h.flow_event, byUser: ctx.auth.user.id }));
  },
};

export const SNOOZE_DEFAULT_DAYS = 7; // REVISABLE - "snooze her" with no date
const days = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5);
const snooze = {
  id: 'snooze', label: 'Snooze', done: 'Snoozed', lead: /^snooze\b/, accepts: ['people', 'todos', ...COMPANY_ENTITIES], needs: 'date',
  async plan(sb, ctx, targets, args) {
    const date = args.date || addDays(ctx.today, SNOOZE_DEFAULT_DAYS);
    const rows = [];
    if (!targets.length) targets = await named(sb, ctx.businessId, args?.names || []);
    for (const t of targets) {
      if (t.entity === 'todos') {
        const todo = await todoOf(sb, ctx, t);
        if (!todo || todo.status !== 'open') rows.push(block(t, GONE));
        else if (todo.snooze_until === date) rows.push({ ...base(t, taskTitle(todo)), kind: 'task', from: date, to: date, skipped: `already snoozed until ${date}` });
        else rows.push({ ...base(t, taskTitle(todo)), kind: 'task', from: todo.snooze_until ? `snoozed until ${todo.snooze_until}` : 'not snoozed', to: `until ${date}`, note: date < ctx.today ? "that's in the past - confirm or edit" : 'hidden from the open list until then', exec: { todo: todo.id, before: todo.snooze_until || null, date } });
        continue;
      }
      if (t.entity === 'people') {
        const prospect = await prospectOf(sb, ctx.businessId, t.id);
        if (!prospect) rows.push(block(t, 'only sequenced people can be snoozed for now'));
        else if (prospect.snooze_until === date) rows.push({ ...base(t), from: date, to: date, skipped: `already snoozed until ${date}` });
        else rows.push({ ...base(t), from: prospect.snooze_until ? `snoozed until ${prospect.snooze_until}` : 'not snoozed', to: `until ${date}`, note: date < ctx.today ? "that's in the past - confirm or edit" : 'hidden from People and Scout until then', exec: { contact_id: prospect.contact_id, before: prospect.snooze_until || null, date } });
        continue;
      }
      const c = await loadCompany(sb, ctx.businessId, KIND[t.entity], t.id);
      const n = days(ctx.today, date);
      if (!c) rows.push(block(t, NO_RECORD));
      else if (c.type !== 'partner') rows.push(block(t, 'snooze exists for partners and people; deprioritize is the other option'));
      else if (n < 1 || n > 90) rows.push(block(t, 'a partner snoozes for 1 to 90 days'));
      else rows.push({ ...base(t, c.name), from: c.snoozed_until ? `snoozed until ${c.snoozed_until}` : 'not snoozed', to: `until ${date}`, exec: { partner: c.id, days: n } });
    }
    return { rows, to: date, nearest: rows.some(r => /deprioritize/.test(r.skipped || '')) ? 'not_fit' : null };
  },
  async act(sb, ctx, x) {
    if (x.todo) return todoAct(sb, ctx, x, { snooze_until: x.date }, 'snooze', { snooze_until: x.before });
    if (x.partner) return { undo: { partner_event: (await salesWrites.partnerSignal(sb, { businessId: ctx.businessId, goalId: x.partner, signal: { type: 'snooze', days: x.days }, byUser: ctx.auth.user.id, meta: { origin: 'scout' } })).event.id } };
    const r = await prospectPatch(ctx, x.contact_id, { snooze_until: x.date, expect: { snooze_until: x.before } });
    if (r.status === 409) return { skipped: 'changed meanwhile' };
    ok(r); return { undo: { snooze_until: x.before } };
  },
  async undo(sb, ctx, x, h) {
    if (x.todo) await todoUndo(sb, ctx, h);
    else if (x.partner) await salesWrites.partnerUndo(sb, { businessId: ctx.businessId, goalId: x.partner, eventId: h.partner_event, byUser: ctx.auth.user.id });
    else ok(await prospectPatch(ctx, x.contact_id, { snooze_until: h.snooze_until, expect: { snooze_until: x.date } }));
  },
};

// scout-v3.1 C2 - Draft email writes the draft inline: ONE Write-email call (composeEmail - its daily cap, its usage row,
// its cost) addressed to the person of the row when there is one (their first name in the greeting; the company facts
// stay the Brief's), returned as { subject, body, cost } - never a send. A draft that holds an address or phone shape
// is withheld with the reason. `open` still names the Write email panel, prefilled, for "Open in Write email".
// The inline draft is asked for by the client (args.inline): a client that does not ask gets the panel opened, as
// before, and no call is made here - so the screen that opens the panel never pays for two drafts.
const draft = {
  id: 'draft', label: 'Draft email', lead: /^(?:draft|write)\b/, accepts: ['people', 'todos', ...COMPANY_ENTITIES],
  async plan(sb, ctx, targets, args) {
    if (targets.length === 1 && targets[0].entity === 'todos') return workOpen(targets[0], 'draft_email');
    const list = targets.length ? targets : await named(sb, ctx.businessId, args.names || []);
    if (list.length !== 1) return { cant: { reason: list.length ? 'I open one draft at a time - name one record.' : 'Tell me who the draft is for.', nearest: 'draft' } };
    const { company, person } = await resolve(sb, ctx.businessId, list[0]);
    if (!company) return { cant: { reason: `${list[0].title} has ${NO_RECORD}, so there is no Write email panel to open - add the company to the pipeline first.`, nearest: person ? 'bundle' : null } };
    if (!args.inline) return { open: { panel: 'compose', type: company.type, id: company.id, name: company.name, to: person ? list[0].title : null }, line: person ? `Opened Write email for ${company.name} · address it to ${list[0].title}` : `Opened Write email for ${company.name} — nothing sent` };
    let to = null;
    if (person) {
      const row = await salesReads.peopleActivity(sb, ctx.businessId, { window: 'all', snoozed: 'all' }).then(r => (r.status === 200 ? r.body.rows.find(p => p.key === list[0].id) : null));
      to = { person_key: list[0].id, name: cleanText(row?.name || list[0].title, 120), title: row?.title ? cleanText(row.title, 160) : null };
    }
    const r = await salesWrites.compose(sb, { businessId: ctx.businessId, userId: ctx.auth.user.id, userName: ctx.auth.user.name, type: company.type, id: company.id, person: to, now: ctx.now });
    if (r.status === 429) return { cant: { reason: r.body.error, nearest: 'bundle' } };
    if (r.status !== 200) throw Object.assign(new Error(r.body?.error || 'The draft failed - try again'), { status: r.status });
    const about = { to, company: { type: company.type, id: company.id, name: company.name }, cost: { usd: r.body.cost_usd ?? null }, cap: r.body.cap || null };
    const open = { panel: 'compose', type: company.type, id: company.id, name: company.name, to: to?.name || null };
    const d = r.body.draft;
    if (hasPii(`${d.subject}\n${d.body}`)) return { draft: { ...about, withheld: true, reason: 'Draft withheld: it held an address or phone shape. Regenerate, or open Write email.' }, open, line: 'Draft withheld — nothing sent' };
    return { draft: { ...about, subject: d.subject, body: d.body, lint: r.body.lint ? { ok: r.body.lint.ok, issues: r.body.lint.issues.length } : null }, open: { ...open, prefill: { subject: d.subject, body: d.body } }, line: `Drafted to ${to?.name || company.name} — nothing sent` };
  },
};

// The draft bundle for the clipboard: the company's copy-bundle, or the person's own pack when no company record
// holds them. The client fetches it, appends the playbook prompt and writes the copied line with the real length.
const bundle = {
  id: 'bundle', label: 'Copy draft bundle', pill: false, lead: /^copy (?:the |a )?draft bundle\b/, accepts: ['people', ...COMPANY_ENTITIES],
  async plan(sb, ctx, targets, args) {
    const list = targets.length ? targets : await named(sb, ctx.businessId, args.names || []);
    if (list.length !== 1) return { cant: { reason: list.length ? 'I copy one draft bundle at a time - name one record.' : 'Tell me who the draft bundle is for.', nearest: 'bundle' } };
    const { company, person } = await resolve(sb, ctx.businessId, list[0]);
    if (company) return { open: { copy: 'bundle', type: company.type, id: company.id, person: person ? list[0].title : company.name }, line: null };
    if (person) return { open: { copy: 'bundle', type: 'target', records: [{ entity: 'people', id: list[0].id }], person: list[0].title }, line: null };
    return { cant: { reason: `${list[0].title} has ${NO_RECORD}.` } };
  },
};

// C4: a typed "add a task to call MetLife Thursday" is a card (Task · Linked to · Owner · Due) -> Confirm -> one
// to-do through todoOn (origin scout, the record link, the person key) -> the create event's Undo.
const TASK_LEAD = /^(?:\+ ?task\b|(?:add|create|make|new)\b(?: (?:a|an|the|me))*(?: (?:task|to-?do|todo))?(?: (?:to|for|that says|:))?)\s*/;
const addTask = {
  id: 'add_task', label: 'Add task', done: 'Added', lead: /^(?:add|create|make|new)\b.*\b(?:task|to-?do|todo)\b|^\+ ?task\b/, free: true,
  async plan(sb, ctx, targets, args) {
    const list = targets.length ? targets : await named(sb, ctx.businessId, args.names || []);
    const hit = list[0] ? await resolve(sb, ctx.businessId, list[0]) : null;
    const company = hit?.company || null;
    // The words come from what was typed (its capitals kept), minus the verb's lead-in and the date phrase.
    let text = String(args.raw || '').replace(/^(?:(?:please|scout|can you|could you)[,\s]+)+/i, '').replace(new RegExp(TASK_LEAD.source, 'i'), '');
    if (args.when?.phrase) text = text.replace(new RegExp(`\\s*${args.when.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), '');
    text = cleanText(text.replace(/\s+/g, ' ').trim(), 200);
    if (!text || /^(?:for |on )?(?:this|that|it|them|those|these|him|her)$/i.test(text)) text = list[0] ? `Follow up with ${list[0].title}` : '';
    if (!text) return { cant: { reason: 'Tell me what the task is, like "add a task to call MetLife Thursday".', nearest: 'add_task' } };
    const task = text[0].toUpperCase() + text.slice(1);
    // a person row reached only through its company's name ("call Cloudflare") links the company, not that person
    const typed = String(args.raw || '').toLowerCase();
    const viaCompany = !!list[0]?.company?.name && typed.includes(list[0].company.name.toLowerCase()) && !typed.includes(String(list[0].title).toLowerCase());
    const person_key = list[0]?.entity === 'people' && !viaCompany ? list[0].id : null;
    // "+ Task" on a row (a menu pick: no typed words) stays quick capture, prefilled - REVISABLE (C4).
    if (!String(args.raw || '').trim()) return { open: { quick_capture: { text: task, due_date: args.date || null, past: !!args.when?.past, link: company ? { type: company.type, id: company.id, name: company.name } : null, person_key } }, line: 'Opened quick capture — save it there' };
    const due = args.date || ctx.today;
    const weekday = args.when && /^(?:(?:until|till|til|by|on|due|for)\s+)?(?:sun|mon|tue|wed|thu|fri|sat)/i.test(args.when.phrase);
    const dueNote = args.when?.past ? "that date is in the past - confirm or edit" : weekday ? `"${args.when.phrase}" read as the next one` : args.date ? null : 'no date said - due today';
    const me = (await salesMembers(sb, ctx.businessId)).find(m => m.id === ctx.auth.user.id)?.name.split(/\s+/)[0] || 'you';
    return {
      fields: { task, linked_to: company?.name || null, linked_detail: company ? [KIND_NAME[company.type], company.stage ? String(company.stage).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : null].filter(Boolean).join(' · ') : null, link: company ? { type: company.type, id: company.id, name: company.name } : null, person_key, owner: me, due, due_note: dueNote },
      rows: [{ key: 'todos:new', kind: 'task', title: task, from: null, to: `open to-do · due ${due}`, note: [company ? `linked to ${company.name}` : 'not linked to a record', dueNote].filter(Boolean).join(' · '), exec: { create: { text: task, due_date: due, link: company ? { type: company.type, id: company.id } : null, person_key } } }],
    };
  },
  async act(sb, ctx, x) {
    const c = x.create;
    const todo = await salesWrites.todoOn(sb, { businessId: ctx.businessId, userId: ctx.auth.user.id, type: c.link?.type || null, id: c.link?.id || null, text: c.text, today: ctx.today, dueDate: c.due_date, now: new Date(ctx.now), origin: c.origin || 'scout', personKey: c.person_key, batchId: ctx.planId });
    return { undo: { todo_event: todo.event_id } };
  },
  async undo(sb, ctx, x, h) { await todoUndo(sb, ctx, h); },
};

// C4 - the task-row verbs: each a card, each through applyTodo with expect, each undone by its event.
const taskVerb = ({ id, label, done, lead, needs, to, patch, kind, expectOf, fromOf, ready }) => ({
  id, label, done, lead, needs, accepts: ['todos'], pill: false,
  async plan(sb, ctx, targets, args) {
    const no = ready ? ready(args) : null;
    if (no) return { cant: { reason: no, nearest: id } };
    const rows = [];
    for (const t of targets) {
      const todo = await todoOf(sb, ctx, t);
      if (!todo || todo.status !== 'open') { rows.push(block(t, GONE)); continue; }
      const row = { ...base(t, taskTitle(todo)), kind: 'task', from: fromOf(todo), to: to(args) };
      rows.push(row.from === row.to ? { ...row, skipped: `already ${row.to}` } : { ...row, ...(args.when?.past ? { note: "that date is in the past - confirm or edit" } : {}), exec: { todo: todo.id, expect: expectOf(todo) } });
    }
    return { rows, to: needs === 'date' ? args.date : null };
  },
  act: (sb, ctx, x, args) => todoAct(sb, ctx, x, patch(args), kind, x.expect),
  undo: (sb, ctx, x, h) => todoUndo(sb, ctx, h),
});
const TASK_WORD = '(?:task|tasks|to-?dos?|todos?)';
const taskDone = taskVerb({ id: 'task_done', label: 'Mark done', done: 'Marked done', lead: new RegExp(`^(?:mark\\b.*\\b(?:done|complete|completed|finished)\\b|(?:complete|finish|check off|close out)\\b.*\\b${TASK_WORD}\\b|done with\\b)`), to: () => 'done', fromOf: () => 'open', patch: () => ({ status: 'done' }), kind: 'done', expectOf: t => ({ status: t.status }) });
const taskDrop = taskVerb({ id: 'task_drop', label: 'Drop task', done: 'Dropped', lead: new RegExp(`^(?:drop\\b|cancel\\b.*\\b${TASK_WORD}\\b)`), to: () => 'dropped', fromOf: () => 'open', patch: () => ({ status: 'dropped' }), kind: 'drop', expectOf: t => ({ status: t.status }) });
const STAGE_WORD = '(?:stage|stages|pipeline|contacted|meeting|proposal|client|signed|won|lost)';
const taskDue = taskVerb({ id: 'task_due', label: 'Change due date', done: 'Moved', needs: 'date', lead: new RegExp(`^(?:(?:move|push|change|set|reschedule)\\b(?!.*\\b${STAGE_WORD}\\b).*\\b(?:due|date|${TASK_WORD})\\b|due\\b|reschedule\\b)`), ready: a => (a.date ? null : 'Say the new date, like "move the first task to Friday".'), to: a => `due ${a.date}`, fromOf: t => (t.due_date ? `due ${String(t.due_date).slice(0, 10)}` : 'no date'), patch: a => ({ due_date: a.date }), kind: 'due', expectOf: t => ({ due_date: t.due_date ?? null }) });

// actions-v2 A6 - a to-do row's work panel, opened from Scout: the same route the row's own verb calls.
const workOpen = (t, verb) => ({ open: { panel: 'today_work', key: `todo:${t.id}`, verb }, line: `Opened the work panel on "${t.title}" — nothing sent` });
const WORK_ASKS = [[/^(?:what should i do next|whats next|what next|next steps?)\b/, 'next_steps'], [/^prep(?:are)?(?: me)?\b/, 'prep_call']];
const workPanel = {
  id: 'work', label: 'Open the work panel', pill: false, free: true, accepts: ['todos'], lead: /^(?:what should i do next|whats next|what next|next steps?|prep(?:are)?(?: me)?)\b/,
  async plan(sb, ctx, targets, args) {
    // no to-do row pointed at: this is a question for the ask, not a command
    if (targets.length !== 1) return targets.length ? { cant: { reason: 'I open one to-do at a time - name one, like "what should I do next on #4".' } } : { pass: true };
    return workOpen(targets[0], WORK_ASKS.find(([re]) => re.test(args.text || ''))?.[1] || null);
  },
};

// A3 - "Done and mark <person> contacted": the to-do done and its person's status in ONE row, ONE Undo. The person's
// status goes the way Mark contacted goes (R1): no stage moves; only a sequenced person has a status to set.
const taskFinish = {
  id: 'task_finish', label: 'Done and mark contacted', done: 'Finished', pill: false, accepts: ['todos'], lead: /^finish\b/,
  async plan(sb, ctx, targets) {
    const rows = [];
    for (const t of targets) {
      const todo = await todoOf(sb, ctx, t);
      if (!todo || todo.status !== 'open') { rows.push(block(t, GONE)); continue; }
      const prospect = todo.person_key ? await prospectOf(sb, ctx.businessId, todo.person_key) : null;
      const who = prospect?.name ? cleanText(prospect.name, 120) : null;
      const mark = !!prospect && prospect.status !== 'contacted';
      const note = mark ? "the company's stage is unchanged" : prospect ? `${who} is already contacted` : todo.person_key ? 'only sequenced people can be marked contacted - the to-do is marked done' : 'no person on this to-do - marked done only';
      rows.push({ ...base(t, taskTitle(todo)), kind: 'task', from: 'open', to: mark ? `done · ${who} contacted` : 'done', note, exec: { todo: todo.id, expect: { status: todo.status }, contact_id: mark ? prospect.contact_id : null, before: mark ? prospect.status : null } });
    }
    return { rows };
  },
  async act(sb, ctx, x) {
    const r = await todoAct(sb, ctx, x, { status: 'done' }, 'done', x.expect);
    if (r.skipped || !x.contact_id) return r;
    try {
      const p = await prospectPatch(ctx, x.contact_id, { status: 'contacted', expect: { status: x.before } });
      if (p.status === 409) return { ...r, to: 'done · the person changed meanwhile' };
      ok(p);
    } catch (e) { await todoUndo(sb, ctx, r.undo); throw e; }
    return { undo: { ...r.undo, status: x.before } };
  },
  async undo(sb, ctx, x, h) {
    if ('status' in h) ok(await prospectPatch(ctx, x.contact_id, { status: h.status, expect: { status: 'contacted' } }));
    await todoUndo(sb, ctx, h);
  },
};

// Q6 - "Add n to-dos" for the replies nobody answers: one open to-do per person (their key, their company's record).
// R3: origin 'reply' once the data-keys migration has widened the table's CHECK; 'scout' until then.
const replyTodos = {
  id: 'reply_todos', label: 'Add reply to-dos', done: 'Added', pill: false, accepts: ['people'], lead: /^add\b.*\bto-?dos?\b.*\brepl/,
  async plan(sb, ctx, targets) {
    const rows = [];
    const origin = (await salesWrites.dataKeys(sb, ctx.now)) ? 'reply' : 'scout';
    for (const t of targets) {
      const has = must(await sb.from('sales_week_goals').select('id').eq('business_id', ctx.businessId).eq('kind', 'todo').eq('status', 'open').eq('person_key', t.id)).length > 0;
      if (has) { rows.push({ ...base(t), from: null, to: 'open to-do', skipped: 'already has an open to-do' }); continue; }
      const { company } = await resolve(sb, ctx.businessId, t);
      rows.push({ ...base(t), from: null, to: `open to-do · due ${ctx.today}`, note: company ? `linked to ${company.name}` : NO_RECORD, exec: { create: { text: `Reply to ${t.title}`, due_date: ctx.today, link: company ? { type: company.type, id: company.id } : null, person_key: t.id, origin } } });
    }
    return { rows };
  },
  act: (sb, ctx, x) => addTask.act(sb, ctx, x),
  undo: (sb, ctx, x, h) => todoUndo(sb, ctx, h),
};

// A4 - "Assign with Scout": each unowned to-do goes to the owner of the company it is linked to; a to-do whose
// company has no owner (or that has no company) is listed and left Unassigned.
const assignOwner = {
  id: 'assign_owner', label: 'Assign to the company owner', done: 'Assigned', pill: false, accepts: ['todos'], lead: /^assign\b.*\bcompany(?:s|'s)? owners?\b/,
  async plan(sb, ctx, targets) {
    const members = await salesMembers(sb, ctx.businessId);
    const nameOf = id => members.find(m => m.id === id)?.name.split(/\s+/)[0] || null;
    const rows = [];
    for (const t of targets) {
      const todo = await todoOf(sb, ctx, t);
      if (!todo || todo.status !== 'open') { rows.push(block(t, GONE)); continue; }
      const row = { ...base(t, taskTitle(todo)), kind: 'task', from: nameOf(todo.owner_user_id) || 'Unassigned' };
      if (todo.owner_user_id) { rows.push({ ...row, to: row.from, skipped: 'already has an owner' }); continue; }
      const c = todo.link_id ? await loadCompany(sb, ctx.businessId, readType(todo.link_type), todo.link_id) : null;
      const owner = c?.owner_user_id && nameOf(c.owner_user_id) ? c.owner_user_id : null;
      rows.push(owner ? { ...row, to: nameOf(owner), note: `${c.name}'s owner`, exec: { todo: todo.id, to: owner } } : { ...row, to: 'Unassigned', skipped: c ? `${c.name} has no owner` : 'no company to take an owner from' });
    }
    return { rows };
  },
  act: (sb, ctx, x) => todoAct(sb, ctx, x, { owner_user_id: x.to }, 'reassign', { owner_user_id: null }),
  undo: (sb, ctx, x, h) => todoUndo(sb, ctx, h),
};

// A4 - "Link n": an unlinked to-do whose text names exactly ONE record (todoLink's rule) is linked to it.
const linkNamed = {
  id: 'link_named', label: 'Link to the company named', done: 'Linked', pill: false, accepts: ['todos'], lead: /^link\b/,
  async plan(sb, ctx, targets) {
    const records = await salesWrites.linkable(sb, ctx.businessId);
    const rows = [];
    for (const t of targets) {
      const todo = await todoOf(sb, ctx, t);
      if (!todo || todo.status !== 'open') { rows.push(block(t, GONE)); continue; }
      const row = { ...base(t, taskTitle(todo)), kind: 'task', from: 'no company' };
      if (todo.link_type) { rows.push({ ...row, from: 'linked', to: 'linked', skipped: 'already linked' }); continue; }
      const m = linkFor(todo.text, records);
      rows.push(m?.link ? { ...row, to: cleanText(m.link.name, 160), exec: { todo: todo.id, link: { link_type: m.link.link_type, link_id: m.link.link_id } } } : { ...row, to: 'no company', skipped: m ? 'names more than one company' : 'names no company' });
    }
    return { rows };
  },
  act: (sb, ctx, x) => todoAct(sb, ctx, x, x.link, 'link', { link_type: null, link_id: null }),
  undo: (sb, ctx, x, h) => todoUndo(sb, ctx, h),
};

// R2 - This week's five. A slot is a commitment row of the current week that links ONE to-do (link_type 'todo'); the
// table only admits that link once the data-keys migration has run, so both verbs say so until then.
const FIVE_WAITS = "This week's five takes a to-do once the data-keys database update has run.";
const fiveSlots = async (sb, ctx) => must(await sb.from('sales_week_goals').select('id, status, link_type, link_id').eq('business_id', ctx.businessId).eq('kind', 'commitment').eq('week_start', laMonday(ctx.today))).filter(c => c.status !== 'dropped');
const slotPatch = (ctx, id, body) => salesWrites.weekGoalUpdate({ params: { businessId: ctx.businessId, id }, body, auth: ctx.auth });
const fiveAdd = {
  id: 'five_add', label: "Add to this week's five", done: 'Added', pill: false, accepts: ['todos'], lead: /^add\b.*\bweeks? five\b/,
  async plan(sb, ctx, targets) {
    if (!(await salesWrites.dataKeys(sb, ctx.now))) return { cant: { reason: FIVE_WAITS } };
    const slots = await fiveSlots(sb, ctx);
    const inFive = new Set(slots.filter(c => c.link_type === 'todo').map(c => c.link_id));
    let free = FIVE - slots.length;
    const rows = [];
    for (const t of targets) {
      const todo = await todoOf(sb, ctx, t);
      if (!todo || todo.status !== 'open') { rows.push(block(t, GONE)); continue; }
      const row = { ...base(t, taskTitle(todo)), kind: 'task', from: 'the list', to: "this week's five" };
      if (inFive.has(todo.id)) rows.push({ ...row, skipped: 'already one of the five' });
      else if (free <= 0) rows.push({ ...row, skipped: 'the five are full - remove one first' });
      else { free--; rows.push({ ...row, note: 'out of the ranking until Monday', exec: { five: { todo: todo.id, text: taskTitle(todo) } } }); }
    }
    return { rows };
  },
  async act(sb, ctx, x) {
    const r = ok(await salesWrites.weekGoalCreate({ params: { businessId: ctx.businessId }, body: { week_start: laMonday(ctx.today), kind: 'commitment', text: x.five.text, link_type: 'todo', link_id: x.five.todo, owner_user_id: ctx.auth.user.id }, auth: ctx.auth }));
    return { undo: { slot: r.goal.id } };
  },
  async undo(sb, ctx, x, h) { ok(await slotPatch(ctx, h.slot, { status: 'dropped' })); },
};
const fiveRemove = {
  id: 'five_remove', label: "Remove from this week's five", done: 'Removed', pill: false, accepts: ['todos'], lead: /^(?:remove|take)\b.*\bweeks? five\b/,
  async plan(sb, ctx, targets) {
    if (!(await salesWrites.dataKeys(sb, ctx.now))) return { cant: { reason: FIVE_WAITS } };
    const slots = await fiveSlots(sb, ctx);
    return { rows: targets.map(t => { const slot = slots.find(c => c.link_type === 'todo' && c.link_id === t.id); return slot ? { ...base(t), kind: 'task', from: "this week's five", to: 'the list', exec: { slot: slot.id, before: slot.status } } : block(t, 'not one of the five'); }) };
  },
  async act(sb, ctx, x) {
    const r = await slotPatch(ctx, x.slot, { status: 'dropped', expect: { status: x.before } });
    if (r.status === 409) return { skipped: 'changed meanwhile' };
    ok(r); return { undo: { status: x.before } };
  },
  async undo(sb, ctx, x, h) { ok(await slotPatch(ctx, x.slot, { status: h.status })); },
};

const PACK_ENTITIES = ['people', ...COMPANY_ENTITIES];
const copy = {
  id: 'copy', label: 'Copy for Claude', lead: /^copy\b|\bfor claude\b/, accepts: PACK_ENTITIES, free: true,
  async plan(sb, ctx, targets, args) {
    let list = targets;
    if (!list.length) list = await named(sb, ctx.businessId, args.names || []);
    if (!list.length) for (const n of args.names || []) { const p = await findPerson(sb, ctx.businessId, n, ctx.today); if (p) list.push({ entity: 'people', id: p.key, title: p.name }); }
    if (!list.length) return { cant: { reason: 'Tell me which record to copy, or ask for a brief first.', nearest: 'copy' } };
    return { open: { pack: { records: list.slice(0, 10).map(t => ({ entity: t.entity, id: t.id })) } }, line: null };
  },
};

// Order = which lead wins: "mark ... contacted / not a fit" before "mark ... done"; the narrower assign and add first.
export const salesVerbs = [assignOwner, assign, notFit, contacted, taskFinish, taskDone, taskDue, taskDrop, workPanel, draft, bundle, snooze, fiveAdd, fiveRemove, replyTodos, addTask, linkNamed, copy];

const PACK_TYPE = { ...KIND, people: 'person' };
export async function salesPack(sb, ctx, { q, records }) {
  const { copyPack } = await import('./targetsRoutes.js');
  return copyPack(sb, { businessId: ctx.businessId, question: q, scope: ctx.business?.name || null, today: ctx.today, records: records.filter(r => PACK_TYPE[r.entity]).map(r => ({ type: PACK_TYPE[r.entity], id: r.id })) });
}
