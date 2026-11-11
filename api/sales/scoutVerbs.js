import { cleanText } from './scrubText.js';
import { addDays } from './goalsShared.js';
import { findCompany, findPerson } from './scoutIntents.js';

// scout-v3 S1 + the Stage 0 rulings (R1-R9) - the sales module's verbs for Scout's plan / act / undo. Every write goes
// through an EXISTING route or its function with that route's guards, and every reverse is that route's own Undo:
//   assign        partner: the assign signal + partner undo · employer / target: company fields with expect (R8) + flow undo
//   mark contacted  the person's status + a done to-do (employer) or an email touch with no stage move (partner) - R1
//   not a fit     prospect status 'dead' · target reject · employer / partner fit deprioritize - R2
//   snooze        prospect snooze_until · partner snooze signal; employers / targets / to-dos can't - R5-R7
//   draft email / add task / copy for Claude open something and write nothing - R3, R4, R12
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
  prospect: viaRoute('./huddleRoutes.js', 'updateProspectRoute'),
  todoOn: lazy('./companyPanel.js', 'todoOn'),
  weekGoal: viaRoute('./goalsRoutes.js', 'updateWeekGoalRoute'),
  rejectTarget: lazy('./targetsRoutes.js', 'rejectTarget'),
  deprioritize: lazy('./fitActions.js', 'deprioritize'),
};
const ok = r => { if (r.status >= 400) throw Object.assign(new Error(r.body?.error || 'failed'), { status: r.status, code: r.body?.code }); return r.body; };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND = { partners: 'partner', employers: 'employer', targets: 'target' };
const COMPANY_ENTITIES = Object.keys(KIND);
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
const REASONS = [[/outside (the )?u\.?s/, 'mostly_outside_us', 'Mostly outside US'], [/too small/, 'too_small', 'Too small'], [/wrong industry/, 'wrong_industry', 'Wrong industry'], [/housing perk/, 'has_housing_perk', 'Has housing perk'], [/upside/, 'upside_owns', 'Upside owns']];

const assign = {
  id: 'assign', label: 'Assign', done: 'Assigned', lead: /^(?:re)?assign\b|^unassign\b/, accepts: ['people', ...COMPANY_ENTITIES], needs: 'member',
  async plan(sb, ctx, targets, args) {
    const list = targets.length ? targets : await named(sb, ctx.businessId, args.names || []);
    const members = await salesMembers(sb, ctx.businessId);
    const nameOf = id => (id ? members.find(m => m.id === id)?.name.split(/\s+/)[0] || 'another member' : 'Unassigned');
    const rows = [], seen = new Set();
    for (const t of list) {
      const { company, person } = await resolve(sb, ctx.businessId, t);
      if (!company) { rows.push(block(t, NO_RECORD)); continue; }
      // D5: a person has no owner; assigning a person row assigns their company.
      const row = { ...base(t, person ? `${company.name} (${t.title}'s company)` : company.name), kind: company.type, from: nameOf(company.owner_user_id), to: nameOf(args.owner_user_id) };
      const k = `${company.type}:${company.id}`;
      if (seen.has(k)) rows.push({ ...row, skipped: 'same company as a row above' });
      else if ((company.owner_user_id || null) === (args.owner_user_id || null)) rows.push({ ...row, skipped: `already ${row.to}` });
      else rows.push({ ...row, exec: { type: company.type, id: company.id, from: company.owner_user_id } });
      seen.add(k);
    }
    return { rows };
  },
  async act(sb, ctx, x, args) {
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
    if (h?.partner_event) await salesWrites.partnerUndo(sb, { businessId: ctx.businessId, goalId: x.id, eventId: h.partner_event, byUser: ctx.auth.user.id });
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
      else if (x.employer) undo.todo = (await salesWrites.todoOn(sb, { businessId: ctx.businessId, userId: ctx.auth.user.id, type: 'employer', id: x.employer, text: `Contacted ${x.name}`, today: ctx.today, done: true, now: new Date(ctx.now) })).id;
    } catch (e) {
      if (x.contact_id) await prospectPatch(ctx, x.contact_id, { status: x.before, expect: { status: 'contacted' } });
      throw e;
    }
    return { undo };
  },
  async undo(sb, ctx, x, h) {
    if (h.partner_event) await salesWrites.partnerUndo(sb, { businessId: ctx.businessId, goalId: x.partner.id, eventId: h.partner_event, byUser: ctx.auth.user.id });
    if (h.todo) ok(await salesWrites.weekGoal({ params: { businessId: ctx.businessId, id: h.todo }, body: { status: 'dropped' }, auth: ctx.auth }));
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
    if (x.target) return { undo: { reopen: ok(await salesWrites.rejectTarget(sb, { businessId: ctx.businessId, targetId: x.target, body: {} })).dropped || [] } };
    const r = await salesWrites.deprioritize(sb, { businessId: ctx.businessId, userId: ctx.auth.user.id, type: x.fit.type, id: x.fit.id, body: { reason: x.fit.reason, ...(x.fit.note ? { note: x.fit.note } : {}) } });
    return { undo: { flow_event: ok(r).event.id } };
  },
  async undo(sb, ctx, x, h) {
    if (x.contact_id) ok(await prospectPatch(ctx, x.contact_id, { status: h.status, expect: { status: 'dead' } }));
    else if (x.target) ok(await salesWrites.rejectTarget(sb, { businessId: ctx.businessId, targetId: x.target, body: { undo: true, reopen: h.reopen } }));
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
      if (t.entity === 'todos') { rows.push(block(t, "snoozing a task isn't available yet - change its due date in Actions")); continue; }
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
    if (x.partner) return { undo: { partner_event: (await salesWrites.partnerSignal(sb, { businessId: ctx.businessId, goalId: x.partner, signal: { type: 'snooze', days: x.days }, byUser: ctx.auth.user.id, meta: { origin: 'scout' } })).event.id } };
    const r = await prospectPatch(ctx, x.contact_id, { snooze_until: x.date, expect: { snooze_until: x.before } });
    if (r.status === 409) return { skipped: 'changed meanwhile' };
    ok(r); return { undo: { snooze_until: x.before } };
  },
  async undo(sb, ctx, x, h) {
    if (x.partner) await salesWrites.partnerUndo(sb, { businessId: ctx.businessId, goalId: x.partner, eventId: h.partner_event, byUser: ctx.auth.user.id });
    else ok(await prospectPatch(ctx, x.contact_id, { snooze_until: h.snooze_until, expect: { snooze_until: x.date } }));
  },
};

// R3: exactly what the two buttons do today, opened by Scout - a company opens the Write email panel (its one draft
// call counts under the Write email cap; the panel's reply carries the cost), a person copies the draft bundle (0 AI).
const draft = {
  id: 'draft', label: 'Draft email', lead: /^(?:draft|write)\b/, accepts: ['people', ...COMPANY_ENTITIES],
  async plan(sb, ctx, targets, args) {
    const list = targets.length ? targets : await named(sb, ctx.businessId, args.names || []);
    if (list.length !== 1) return { cant: { reason: list.length ? 'I open one draft at a time - name one record.' : 'Tell me who the draft is for.', nearest: 'draft' } };
    const { company, person } = await resolve(sb, ctx.businessId, list[0]);
    if (!company) return { cant: { reason: `${list[0].title} has ${NO_RECORD} - add the company to the pipeline first.` } };
    return person
      ? { open: { copy: 'bundle', type: company.type, id: company.id, person: list[0].title }, line: `Draft bundle for ${list[0].title} copied - paste it into Claude. Scout never sends.` }
      : { open: { panel: 'compose', type: company.type, id: company.id, name: company.name }, line: `Opened Write email for ${company.name} - one draft call under the Write email cap. Scout never sends.` };
  },
};

// R4: task writes wait for the to-do history; "+ Task" and "add a task ..." open quick capture prefilled.
const TASK_LEAD = /^(?:\+ ?task\b|(?:add|create|make|new)\b(?: (?:a|an|the|me))*(?: (?:task|to-?do|todo))?(?: (?:to|for|that says|:))?)\s*/;
const addTask = {
  id: 'add_task', label: 'Add task', lead: /^(?:add|create|make|new)\b.*\b(?:task|to-?do|todo)\b|^\+ ?task\b/, free: true,
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
    return { open: { quick_capture: { text: text[0].toUpperCase() + text.slice(1), due_date: args.date || null, past: !!args.when?.past, link: company ? { type: company.type, id: company.id, name: company.name } : null } }, line: 'Opened - save it there' };
  },
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

export const salesVerbs = [assign, notFit, contacted, draft, snooze, addTask, copy];

const PACK_TYPE = { ...KIND, people: 'person' };
export async function salesPack(sb, ctx, { q, records }) {
  const { copyPack } = await import('./targetsRoutes.js');
  return copyPack(sb, { businessId: ctx.businessId, question: q, scope: ctx.business?.name || null, today: ctx.today, records: records.filter(r => PACK_TYPE[r.entity]).map(r => ({ type: PACK_TYPE[r.entity], id: r.id })) });
}
