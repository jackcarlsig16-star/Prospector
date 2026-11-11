// scout-v3 Stage 1 - the section planner, the sectioned answer, plan / act / undo and the Copy pack, on fakeSupabase
// with the real sales module registered. Reads go through the salesReads seam, writes through salesWrites (a fake
// route per verb). 0 Claude (a mock model), 0 Apollo. Names, titles and companies only - no '@' in any output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { createRegistry } from '../scout/registry.js';
import { parseAsk, splitAsk, mergeVocab, buildContext } from '../scout/retrieve.js';
import { ask, askDeps, sectioned, validateAsk } from '../scout/ask.js';
import { plan, act, undo, pack, parseDate, parseCommand, resolveTargets, actDeps, PLAN_TTL_MS, UNDO_MS, BATCH_MAX, openPlans } from '../scout/actions.js';
import { VOCABULARY, register } from './scoutEntities.js';
import { salesReads, salesIntents, rankTodos, TODO_RULE } from './scoutIntents.js';
import { salesWrites, salesVerbs } from './scoutVerbs.js';
import { copyPack, PACK_MAX } from './targetsRoutes.js';
import { editCompanyFields } from './companyFields.js';
import { buildPeopleTable, peopleRows, windowOf } from './peopleActivityRoutes.js';
import { readType, diskType } from './readType.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const u = n => `${n}0000000-0000-4000-8000-000000000000`;
const ana = { user: { id: u('a'), name: 'Ana', email: 'x' }, isPlatformOwner: false, roles: new Map([[A, 'member']]) };
const viewer = { user: { id: u('9'), name: 'Vi' }, isPlatformOwner: false, roles: new Map([[A, 'viewer']]) };
const TODAY = '2026-11-10', NOW = Date.parse('2026-11-10T20:00:00Z');
const seed = (extra = {}) => fakeSupabase({
  businesses: [{ id: A, name: 'Alpha', features: { goals_sales: true } }],
  business_members: [{ business_id: A, user_id: u('a'), name: 'Ana Member', role: 'member' }, { business_id: A, user_id: u('b'), name: 'Bo Member', role: 'member' }],
  sales_settings: [{ business_id: A, buyer_titles: [], score_weights: null }],
  sales_goals: [{ id: u('1'), business_id: A, goal_type: 'partnership', name: 'Hilton Partners', owner_user_id: u('a'), pipeline_status: 'in_sequence', fit_level: null, snoozed_until: null, archived_at: null }],
  sales_opportunities: [{ id: u('3'), business_id: A, organization: 'Cloudflare', owner_user_id: u('a'), owner: 'Ana', stage: 'contacted', fit_level: null, archived_at: null }, { id: u('4'), business_id: A, organization: 'Northrop Grumman', owner_user_id: u('b'), owner: 'Bo', stage: 'target', fit_level: null, archived_at: null }],
  sales_targets: [{ id: u('5'), business_id: A, name: 'Mission Lane', owner_user_id: null, status: 'researching', fit_level: null }],
  sales_prospect_state: [{ business_id: A, contact_id: 'c1', name: 'Dana Mayer', status: 'new', snooze_until: null, opportunity_id: u('3'), goal_id: null }, { business_id: A, contact_id: 'c2', name: 'Lee Stone', status: 'contacted', snooze_until: null, opportunity_id: null, goal_id: null }],
  sales_week_goals: [], sales_week_goal_steps: [], sales_flow_events: [], sales_partner_events: [], partner_contacts: [], sales_call_notes: [], sales_targets_notes: [], business_anthropic_usage: [], sales_company_scores: [], ...extra,
});
const reg = async () => { const r = createRegistry(); await register(r); return r; };
const vocab = mergeVocab([VOCABULARY, { sources: { brad: 'upside' } }]);
const signature = a => { const ids = salesIntents.filter(i => i.match(a)).map(i => i.id); return ids.length ? `${ids.join('+')}|${a.entity || ''}` : ''; };
const person = (key, name, co, heat, band, extra = {}) => ({ key, name, title: 'VP People', company: co ? { type: 'employer', id: u('3'), name: co, stage: 'contacted' } : null, source: 'Apollo sequence', emails: { sent: 2, opened: 1, clicked: 0, replied: 0 }, last_email: { at: '2026-11-08T10:00:00Z', what: 'opened' }, heat, heat_band: band, visits: { visits_7d: 3, last_visit: '2026-11-09', seen_to: '2026-11-09' }, identified_at: null, status: 'new', snooze_until: null, ...extra });
const todo = (i, due, owner = u('a'), text = `Send the deck to account ${i}`) => ({ id: u(String(i)), text, due_date: due, owner_user_id: owner, created_at: `2026-11-0${(i % 8) + 1}T00:00:00Z`, link_type: null, link_id: null, steps: [] });
const row = (entity, id, title, company = null) => ({ entity, id, title, company });
actDeps.now = () => NOW;

test('D2: ten multi-part phrasings split into their parts, each part with its own intents; a single-part ask stays whole', () => {
  const asks = [
    ['pull me 5 most important prospects who are visiting and hot and show 5 most important tasks', ['people_visiting', 'todos']],
    ["who are our hottest prospects at Cloudflare and what's due this week", ['brief+people', 'todos']],
    ['show me hot targets and also my open tasks', ['ranked', 'todos']],
    ['who visited yesterday; what needs attention', ['visitors', 'attention']],
    ['1. top companies by score 2. people who opened our emails 3. tasks due this week', ['ranked', 'people', 'todos']],
    ['list our clients then show the referral funnel', ['clients', 'ranked+funnel']],
    ["what's our email to site rate and who replied this week", ['email_site', 'people']],
    ['pull the intel on Northrop Grumman and show my tasks for them', ['brief', 'todos']],
    ['which partners did we touch last week and which targets are hot', ['ranked', 'ranked']],
    ['hottest people on the site this week and the companies they work for', ['people_visiting']],
  ];
  for (const [q, want] of asks) {
    const { parts } = splitAsk(q, vocab, { today: TODAY, signature });
    assert.deepEqual(parts.map(p => salesIntents.filter(i => i.match(parseAsk(p, vocab, { today: TODAY }))).map(i => i.id).join('+')), want, q);
  }
  assert.equal(splitAsk('1. a 2. b 3. c 4. d 5. e 6. f 7. g', vocab, { today: TODAY, signature }).cut, 2);
  const a = parseAsk('pull me 5 most important prospects', vocab, { today: TODAY });
  assert.equal(a.limit, 5); assert.equal(a.entity, 'people');
  assert.equal(parseAsk('companies touched in the last 14 days', vocab, { today: TODAY }).limit, null);
  assert.equal(parseAsk('tasks due Nov 12', vocab, { today: TODAY }).limit, null);
  assert.equal(parseAsk('show me our leads', vocab, { today: TODAY }).entity, 'people');
  assert.equal(parseAsk("who's hot", vocab, { today: TODAY }).entity, 'people');
  assert.equal(parseAsk('who visited yesterday', vocab, { today: TODAY }).entity, null);
});

test('the exact Nov 10 ask -> ① five people ② five tasks: per-part reads, the count as a limit, tasks by the rule with no leftover-word filter, one model call, one usage row, no "@"', async () => {
  const sb = seed(), registry = await reg();
  const people = Array.from({ length: 8 }, (_, i) => person(`prospect:p${i}`, `Person ${i}`, 'Cloudflare', 90 - i, i < 7 ? 'hot' : 'warm'));
  people.push(person('prospect:zz', 'Snoozed Sam', 'Cloudflare', 99, 'hot', { snooze_until: '2026-12-01' }));
  salesReads.peopleActivity = async () => ({ status: 200, body: { rows: people } });
  const todos = [todo(1, null, u('b')), todo(2, '2026-11-20'), todo(3, '2026-11-01'), todo(4, '2026-11-12', u('b')), todo(5, '2026-10-20'), todo(6, null), todo(7, '2026-11-12'), todo(8, '2026-11-30')];
  salesReads.openTodosFor = async () => ({ rows: todos, total: todos.length });
  const calls = [];
  askDeps.now = () => NOW;
  askDeps.callAnthropic = async a => { calls.push(a); return { content: [{ type: 'text', text: 'Two parts: five people on the site and five tasks.\n@@ 1\n\n@@ 2\n' }], usage: { input_tokens: 900, output_tokens: 60 } }; };
  const r = await ask(sb, registry, { auth: ana, body: { q: 'pull me 5 most important prospects who are visiting and hot and show 5 most important tasks', scope: A } });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].messages.at(-1).content, /PART 1 of 2[\s\S]*PART 2 of 2/);
  assert.match(calls[0].messages.at(-1).content, /This question has 2 parts/);
  const [s1, s2] = r.body.sections;
  assert.equal(r.body.sections.length, 2);
  assert.equal(s1.rows.length, 5); assert.equal(s1.count, 5); assert.equal(s1.total, 7);
  assert.ok(s1.rows.every(x => x.entity === 'people' && x.row.kind === 'person' && x.row.company.type === 'employer'));
  assert.deepEqual(s1.rows.map(x => x.row.heat), [90, 89, 88, 87, 86]);
  assert.ok(!JSON.stringify(r.body).includes('Snoozed Sam'), 'R6: a snoozed person is hidden');
  assert.match(s1.read, /1 snoozed hidden/);
  assert.match(s1.rule, /ranked by heat/);
  assert.equal(s2.rows.length, 5); assert.equal(s2.count, 5); assert.equal(s2.total, 8);
  assert.ok(s2.rows.every(x => x.entity === 'todos' && x.row.kind === 'task'));
  assert.deepEqual(s2.rows.map(x => x.row.due), ['2026-10-20', '2026-11-01', '2026-11-12', '2026-11-12', '2026-11-20']);
  assert.deepEqual(s2.rows.slice(2, 4).map(x => x.row.owner), ['mine', 'another owner'], 'yours first on a tie');
  assert.equal(s2.rule, TODO_RULE);
  assert.equal(r.body.summary, 'Two parts: five people on the site and five tasks.');
  assert.ok(!JSON.stringify(r.body).includes('@'));
  assert.ok(!/Records \(/.test(r.body.answer_md));
});

test('D2 details: a pronoun carries the part before\'s company into the to-do read; an empty part keeps its section with one line; labels of another part are dropped; D9 a named person is a brief', async () => {
  const sb = seed(), registry = await reg();
  salesReads.companyBrief = async () => ({ status: 200, body: { company: { type: 'employer', id: u('4'), name: 'Northrop Grumman' }, score: { score: 70, band: 'P1' }, next_step: null, lines: [{ ref: 'B1', kind: 'visit', text: 'Visited pricing twice' }] } });
  const linked = { ...todo(1, '2026-11-12'), link_type: 'opportunity', link_id: u('4'), text: 'Send the agreement' };
  salesReads.openTodosFor = async () => ({ rows: [linked, todo(2, null), { ...todo(3, null), text: 'Prep the Northrop Grumman deck' }], total: 3 });
  const c = await buildContext(sb, registry, { auth: ana, scope: A, q: 'pull the intel on Northrop Grumman and show my tasks for them', now: NOW });
  assert.deepEqual(c.parts.map(p => p.intent), ['brief', 'todos']);
  assert.deepEqual(c.parts[0].brief, { entity: 'employers', id: u('4') });
  assert.equal(c.parts[1].ask.carried, true);
  assert.equal(c.parts[1].count, 2);
  assert.deepEqual(c.parts[1].labels.map(l => c.items.get(l).row.link), [{ entity: 'employers', type: 'employer', id: u('4'), name: 'Northrop Grumman', open: { page: 'sales', params: { tab: 'pipeline', view: 'companies', open: `employer-${u('4')}` } } }, null], 'K1: the link reads employer, never opportunity; it carries its name and opener');
  const s = sectioned('Two parts.\n@@ 1\n[r1] [r3]\n@@ 2\nNothing is due.', { parts: [{ ...c.parts[0], labels: ['r1'] }, { ...c.parts[1], labels: [], count: 0 }], items: c.items });
  assert.deepEqual(s.sections[0].rows.map(x => x.id), [u('4')]);
  assert.equal(s.sections[1].rows.length, 0); assert.equal(s.sections[1].line, 'Nothing is due.');
  salesReads.peopleActivity = async () => ({ status: 200, body: { rows: [person('prospect:c1', 'Dana Mayer', 'Cloudflare', 68, 'hot')] } });
  salesReads.personDetail = async () => ({ status: 200, body: { timeline: [{ kind: 'reply', at: '2026-11-08T10:00:00Z', step: 2, automated: false, reply_class: 'interested' }], notes: 'Met at the conference' } });
  const b = await buildContext(sb, registry, { auth: ana, scope: A, q: 'pull the intel on Dana Mayer', now: NOW });
  assert.deepEqual(b.parts[0].brief, { entity: 'people', id: 'prospect:c1' });
  assert.match(b.pack, /Dana Mayer · reply step 2 \(interested\) · 2026-11-08/);
  const none = await buildContext(sb, registry, { auth: ana, scope: A, q: 'who are our hottest prospects at Cloudflare', now: NOW });
  assert.equal(none.parts[0].brief, null, 'a brief needs a brief word');
  const t = validateAsk({ q: 'and now?', thread: [{ role: 'assistant', content: 'Five people.', actions: ['assigned 3 to Bo · undone'] }] });
  assert.equal(t.thread[0].content, 'Five people.\n→ assigned 3 to Bo · undone');
  assert.deepEqual(rankTodos([todo(1, null), todo(2, '2026-11-12')], TODAY, u('a')).map(r => r.due_date), ['2026-11-12', null]);
});

const fakeWrites = () => {
  const log = [];
  Object.assign(salesWrites, {
    companyFields: async (sb, a) => { log.push(['companyFields', a.type, a.id, a.body, a.origin]); if (a.id === u('4')) return { status: 500, body: { error: 'the database said no' } }; return { status: 200, body: { event: { id: `flow-${a.id}` } } }; },
    flowUndo: async (sb, a) => { log.push(['flowUndo', a.eventId]); return { status: 200, body: {} }; },
    partnerSignal: async (sb, a) => { log.push(['partnerSignal', a.goalId, a.signal, a.meta]); return { event: { id: `pe-${a.signal.type}` } }; },
    partnerUndo: async (sb, a) => { log.push(['partnerUndo', a.eventId]); return {}; },
    prospect: async a => { log.push(['prospect', a.params.contactId, a.body]); return { status: 200, body: {} }; },
    todoOn: async (sb, a) => { log.push(['todoOn', a.type, a.id, a.text, a.done]); return { id: 'todo-1' }; },
    todoUndoCreate: async (_sb, a) => { log.push(['todoUndoCreate', a.todoId]); return {}; },
    rejectTarget: async (sb, a) => { log.push(['rejectTarget', a.targetId, a.body]); return { status: 200, body: { dropped: ['t1'] } }; },
    deprioritize: async (sb, a) => { log.push(['deprioritize', a.type, a.id, a.body]); return { status: 200, body: { event: { id: 'flow-fit' } } }; },
  });
  return log;
};
const answer = [row('targets', u('5'), 'Mission Lane'), row('employers', u('3'), 'Cloudflare'), row('employers', u('4'), 'Northrop Grumman'), row('people', 'prospect:c2', 'Lee Stone', { type: 'account', id: null, name: 'Marriott' })];

test('plan -> act -> undo: a single assign through the route with expect + origin; the batch card lists skipped rows; a per-row failure is reported with Retry on that row only; Undo restores the batch as one', async () => {
  const sb = seed(), registry = await reg(), log = fakeWrites();
  const one = await plan(sb, registry, { auth: ana, body: { scope: A, verb: 'assign', keys: [`targets:${u('5')}`], args: { owner_user_id: u('b') }, rows: answer } });
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.rows, [{ key: `targets:${u('5')}`, kind: 'target', title: 'Mission Lane', from: 'Unassigned', to: 'Bo', skipped: null, note: null }]);
  assert.equal(log.length, 0, 'a plan writes nothing');
  const did = await act(sb, registry, { auth: ana, body: { plan_id: one.body.plan_id } });
  assert.equal(did.body.line, 'Assigned 1 to Bo');
  assert.deepEqual(log[0], ['companyFields', 'target', u('5'), { owner_user_id: u('b'), expect: { owner_user_id: null } }, 'scout']);
  assert.equal((await act(sb, registry, { auth: ana, body: { plan_id: one.body.plan_id } })).status, 409);
  const back = await undo(sb, registry, { auth: ana, body: { plan_id: one.body.plan_id } });
  assert.equal(back.body.line, 'undone');
  assert.deepEqual(log[1], ['flowUndo', `flow-${u('5')}`]);
  assert.equal((await undo(sb, registry, { auth: ana, body: { plan_id: one.body.plan_id } })).status, 409);

  log.length = 0;
  const batch = await plan(sb, registry, { auth: ana, body: { scope: A, text: 'assign all four to Ana', rows: answer } });
  assert.equal(batch.body.verb, 'assign');
  assert.deepEqual(batch.body.rows.map(r => [r.title, r.from, r.to, r.skipped]), [['Mission Lane', 'Unassigned', 'Ana', null], ['Cloudflare', 'Ana', 'Ana', 'already Ana'], ['Northrop Grumman', 'Bo', 'Ana', null], ['Lee Stone', null, null, 'no company record']]);
  assert.deepEqual(batch.body.summary, { will: 2, skipped: 2 });
  const ran = await act(sb, registry, { auth: ana, body: { plan_id: batch.body.plan_id } });
  assert.equal(ran.body.line, 'Assigned 1 of 2 to Ana · Northrop Grumman failed: the database said no · 2 skipped');
  assert.deepEqual(ran.body.rows.map(r => r.ok), [true, false, false, false]);
  const retry = await act(sb, registry, { auth: ana, body: { plan_id: batch.body.plan_id, keys: [`employers:${u('4')}`] } });
  assert.equal(log.filter(l => l[0] === 'companyFields').length, 3, 'Retry runs the failed row only');
  assert.equal(retry.body.failed, 1);
  const un = await undo(sb, registry, { auth: ana, body: { plan_id: batch.body.plan_id } });
  assert.deepEqual(un.body.rows.map(r => [r.title, r.ok]), [['Mission Lane', true]]);
  const person = await plan(sb, registry, { auth: ana, body: { scope: A, text: 'assign Dana Mayer to Bo', rows: [row('people', 'prospect:c1', 'Dana Mayer')] } });
  assert.equal(person.body.rows[0].title, "Cloudflare (Dana Mayer's company)", 'D5');
  assert.equal(person.body.rows[0].kind, 'employer');
});

test('R8: the employer / target assign route is compare-and-set with expect - a changed owner is 409 "owner changed to <x> meanwhile", never overwritten; no expect behaves as before', async () => {
  const sb = seed();
  const stale = await editCompanyFields(sb, { businessId: A, type: 'employer', id: u('4'), body: { owner_user_id: u('a'), expect: { owner_user_id: null } }, byUser: u('a') });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'changed'); assert.match(stale.body.error, /owner changed to Bo meanwhile/);
  assert.equal(sb.db.sales_opportunities.find(o => o.id === u('4')).owner_user_id, u('b'));
  const good = await editCompanyFields(sb, { businessId: A, type: 'employer', id: u('4'), body: { owner_user_id: u('a'), expect: { owner_user_id: u('b') } }, byUser: u('a'), origin: 'scout' });
  assert.equal(good.status, 200);
  assert.equal(sb.db.sales_flow_events.at(-1).meta.origin, 'scout');
  assert.equal((await editCompanyFields(sb, { businessId: A, type: 'target', id: u('5'), body: { employees: 10, expect: { owner_user_id: null } } })).status, 400);
  assert.equal((await editCompanyFields(sb, { businessId: A, type: 'target', id: u('5'), body: { owner_user_id: u('b') }, byUser: u('a') })).status, 200);
});

test('the verb matrix: mark contacted = the person\'s status + a done to-do and no stage move; not a fit by record kind; snooze for prospects and partners only; draft and add task open and write nothing', async () => {
  const sb = seed(), registry = await reg(), log = fakeWrites();
  const go = async (text, rows) => { const p = await plan(sb, registry, { auth: ana, body: { scope: A, text, rows } }); return p.body.plan_id ? { p, a: await act(sb, registry, { auth: ana, body: { plan_id: p.body.plan_id } }) } : { p }; };
  const dana = row('people', 'prospect:c1', 'Dana Mayer'), lee = row('people', 'prospect:c2', 'Lee Stone'), visitor = row('people', 'person:v1', 'Vic Visitor', { type: 'employer', id: u('3'), name: 'Cloudflare' });
  let r = await go('mark Dana Mayer contacted', [dana]);
  assert.equal(r.p.body.rows[0].note, "Cloudflare's stage unchanged - advance it from its window");
  assert.deepEqual(log, [['prospect', 'c1', { status: 'contacted', expect: { status: 'new' } }], ['todoOn', 'employer', u('3'), 'Contacted Dana Mayer', true]]);
  await undo(sb, registry, { auth: ana, body: { plan_id: r.p.body.plan_id } });
  assert.deepEqual(log.slice(2), [['todoUndoCreate', 'todo-1'], ['prospect', 'c1', { status: 'new', expect: { status: 'contacted' } }]]);
  assert.match((await go('mark Lee Stone contacted', [lee])).p.body.cant.reason, /no company record/);
  assert.match((await go('mark Cloudflare contacted', [row('employers', u('3'), 'Cloudflare')])).p.body.cant.reason, /stage moves from its window/);
  log.length = 0;
  r = await go('mark Hilton Partners contacted', [row('partners', u('1'), 'Hilton Partners')]);
  assert.deepEqual(log[0][2], { type: 'touch', touch_type: 'email', date: TODAY, move_to: 'none', expect: 'in_sequence', contacts: [] });

  log.length = 0;
  r = await go('mark them not a fit', [dana, row('targets', u('5'), 'Mission Lane'), row('employers', u('3'), 'Cloudflare'), visitor]);
  assert.deepEqual(r.p.body.rows.map(x => [x.title, x.to, x.skipped]), [['Dana Mayer', 'not a fit', null], ['Mission Lane', 'not a fit', null], ['Cloudflare', 'deprioritized · Not a fit', null], ['Vic Visitor', null, 'only sequenced people can be marked not a fit']]);
  assert.deepEqual(log.map(l => l[0]), ['prospect', 'rejectTarget', 'deprioritize']);
  assert.deepEqual(log[2][3], { reason: 'other', note: 'Not a fit' });
  await undo(sb, registry, { auth: ana, body: { plan_id: r.p.body.plan_id } });
  assert.deepEqual(log.slice(3), [['prospect', 'c1', { status: 'new', expect: { status: 'dead' } }], ['rejectTarget', u('5'), { undo: true, reopen: ['t1'] }], ['flowUndo', 'flow-fit']]);

  log.length = 0;
  r = await go('snooze Dana Mayer until Thursday', [dana]);
  assert.equal(r.p.body.to, '2026-11-12');
  assert.deepEqual(log[0], ['prospect', 'c1', { snooze_until: '2026-11-12', expect: { snooze_until: null } }]);
  await undo(sb, registry, { auth: ana, body: { plan_id: r.p.body.plan_id } });
  assert.deepEqual(log[1], ['prospect', 'c1', { snooze_until: null, expect: { snooze_until: '2026-11-12' } }]);
  r = await go('snooze Hilton Partners for in 2 weeks', [row('partners', u('1'), 'Hilton Partners')]);
  assert.deepEqual(log.at(-1)[2], { type: 'snooze', days: 14 });
  const emp = await go('snooze Cloudflare until Thursday', [row('employers', u('3'), 'Cloudflare')]);
  assert.match(emp.p.body.cant.reason, /snooze exists for partners and people; deprioritize is the other option/);
  assert.deepEqual(emp.p.body.cant.nearest, { id: 'not_fit', label: 'Not a fit' });
  assert.match((await go('snooze this until Thursday', [row('todos', u('6'), 'Call Hilton')])).p.body.cant.reason, /isn't available yet/);
  const past = await go('snooze Dana Mayer until Nov 3', [dana]);
  assert.equal(past.p.body.when.past, true); assert.match(past.p.body.rows[0].note, /in the past - confirm or edit/);

  log.length = 0;
  const d1 = await go('draft an email to Cloudflare', [row('employers', u('3'), 'Cloudflare')]);
  assert.deepEqual(d1.p.body.open, { panel: 'compose', type: 'employer', id: u('3'), name: 'Cloudflare', to: null });
  assert.equal(d1.p.body.line, 'Opened Write email for Cloudflare — nothing sent');
  // FIX scout-action-feedback-v1: a person's Draft email opens their company's panel and the line names them; the
  // clipboard bundle is its own verb; a person with no company record can't draft, Copy draft bundle is the nearest.
  const d2 = await go('draft an email to Dana Mayer', [dana]);
  assert.deepEqual(d2.p.body.open, { panel: 'compose', type: 'employer', id: u('3'), name: 'Cloudflare', to: 'Dana Mayer' });
  assert.equal(d2.p.body.line, 'Opened Write email for Cloudflare · address it to Dana Mayer');
  const b1 = await go('copy the draft bundle for Dana Mayer', [dana]);
  assert.equal(b1.p.body.verb, 'bundle');
  assert.deepEqual(b1.p.body.open, { copy: 'bundle', type: 'employer', id: u('3'), person: 'Dana Mayer' });
  assert.deepEqual((await go('copy draft bundle for Cloudflare', [row('employers', u('3'), 'Cloudflare')])).p.body.open, { copy: 'bundle', type: 'employer', id: u('3'), person: 'Cloudflare' });
  const d3 = await go('draft an email to Lee Stone', [lee]);
  assert.match(d3.p.body.cant.reason, /^Lee Stone has no company record, so there is no Write email panel to open/);
  assert.deepEqual(d3.p.body.cant.nearest, { id: 'bundle', label: 'Copy draft bundle' });
  assert.deepEqual((await go('copy draft bundle for Lee Stone', [lee])).p.body.open, { copy: 'bundle', type: 'target', records: [{ entity: 'people', id: lee.id }], person: 'Lee Stone' });
  const t = await go('add a task to call Cloudflare Thursday', []);
  assert.deepEqual(t.p.body.open, { quick_capture: { text: 'Call Cloudflare', due_date: '2026-11-12', past: false, link: { type: 'employer', id: u('3'), name: 'Cloudflare' }, person_key: null } });
  assert.equal(t.p.body.line, 'Opened quick capture — save it there');
  const t2 = await go('add a task for this', [lee]);
  assert.deepEqual(t2.p.body.open.quick_capture, { text: 'Follow up with Lee Stone', due_date: null, past: false, link: null, person_key: 'prospect:c2' });
  const c = await go('copy this for Claude', [dana]);
  assert.deepEqual(c.p.body.open, { pack: { records: [{ entity: 'people', id: 'prospect:c1' }] } });
  assert.equal(log.length, 0, 'opens write nothing');
  assert.equal(openPlans() >= 0, true);
});

test('can\'t-do: a Viewer is 403; a pronoun with no answer; verbs outside the matrix (send, delete, stage, client, Apollo) with the pills; over 25 rows; a plan expires in 2 minutes; Undo expires; a plain question is not a command', async () => {
  const sb = seed(), registry = await reg(), log = fakeWrites();
  const v = await plan(sb, registry, { auth: viewer, body: { scope: A, text: 'assign those to Bo', rows: answer } });
  assert.equal(v.status, 403); assert.match(v.body.cant.reason, /view access/);
  const none = await plan(sb, registry, { auth: ana, body: { scope: A, text: 'assign those to Bo', rows: [] } });
  assert.match(none.body.cant.reason, /Ask for a list first/);
  const pills = ['assign', 'not_fit', 'contacted', 'draft', 'snooze', 'add_task', 'copy'];
  for (const text of ['send them an email', 'delete those', 'move Cloudflare to proposal', 'mark Cloudflare as a client', 'add them to the sequence']) {
    const r = await plan(sb, registry, { auth: ana, body: { scope: A, text, rows: answer } });
    assert.match(r.body.cant.reason, /Scout never sends, deletes, or moves a stage/, text);
    assert.deepEqual(r.body.cant.pills.map(p => p.id), pills);
  }
  assert.deepEqual((await plan(sb, registry, { auth: ana, body: { scope: A, text: 'send them an email', rows: answer } })).body.cant.nearest, { id: 'draft', label: 'Draft email' });
  assert.match((await plan(sb, registry, { auth: ana, body: { scope: A, text: 'assign those to Zed', rows: answer } })).body.cant.reason, /don't know a member called "zed"/);
  const many = Array.from({ length: BATCH_MAX + 1 }, (_, i) => row('employers', u('3'), `Co ${i}`)).map((r, i) => ({ ...r, id: `${u('3').slice(0, -2)}${String(i).padStart(2, '0')}` }));
  assert.match((await plan(sb, registry, { auth: ana, body: { scope: A, text: 'assign all to Bo', rows: many } })).body.cant.reason, /Narrow it to 25 or fewer/);
  assert.deepEqual((await plan(sb, registry, { auth: ana, body: { scope: A, text: 'who visited yesterday', rows: answer } })).body, { command: false });
  assert.equal((await plan(sb, registry, { auth: ana, body: { scope: 'all', text: 'assign those to Bo', rows: answer } })).status, 400);

  const p = await plan(sb, registry, { auth: ana, body: { scope: A, text: 'assign Mission Lane to Bo', rows: answer }, now: NOW });
  const late = await act(sb, registry, { auth: ana, body: { plan_id: p.body.plan_id }, now: NOW + PLAN_TTL_MS + 1 });
  assert.equal(late.status, 410); assert.equal(log.length, 0);
  const p2 = await plan(sb, registry, { auth: ana, body: { scope: A, text: 'assign Mission Lane to Bo', rows: answer }, now: NOW });
  const other = await act(sb, registry, { auth: { ...ana, user: { id: u('b') } }, body: { plan_id: p2.body.plan_id }, now: NOW + 1000 });
  assert.equal(other.status, 404, 'a plan belongs to who made it');
  await act(sb, registry, { auth: ana, body: { plan_id: p2.body.plan_id }, now: NOW + 1000 });
  const tooLate = await undo(sb, registry, { auth: ana, body: { plan_id: p2.body.plan_id }, now: NOW + 1000 + UNDO_MS + 1 });
  assert.equal(tooLate.status, 409); assert.equal(tooLate.body.error, 'Undo expired · open the record to change it');
  const p3 = await plan(sb, registry, { auth: ana, body: { scope: A, text: 'assign Mission Lane to Bo', rows: answer }, now: NOW });
  await plan(sb, registry, { auth: ana, body: { scope: A, text: 'assign Cloudflare to Bo', rows: answer }, now: NOW });
  assert.equal((await act(sb, registry, { auth: ana, body: { plan_id: p3.body.plan_id }, now: NOW })).status, 404, 'a new plan cancels the open card');
});

test('D7 dates and the command reader: next weekday never today, tomorrow / next week / in n days / Nov 12 / 11/20, a past date flagged; targets by name, "the first 3", "row 2", all', () => {
  const d = t => parseDate(t, TODAY);
  assert.equal(d('until Tuesday').date, '2026-11-17', 'today is Tuesday: the NEXT one');
  assert.equal(d('thursday').date, '2026-11-12'); assert.equal(d('tomorrow').date, '2026-11-11'); assert.equal(d('next week').date, '2026-11-16');
  assert.equal(d('in 3 days').date, '2026-11-13'); assert.equal(d('Nov 12').date, '2026-11-12'); assert.equal(d('11/20').date, '2026-11-20');
  assert.deepEqual([d('Nov 3').date, d('Nov 3').past], ['2026-11-03', true]);
  assert.equal(d('assign those to Bo'), null);
  assert.deepEqual(resolveTargets('assign the cloudflare ones to bo', answer).rows.map(r => r.title), ['Cloudflare']);
  assert.equal(resolveTargets('assign the first 3 to bo', answer).rows.length, 3);
  assert.deepEqual(resolveTargets('snooze row 2', answer).rows.map(r => r.title), ['Cloudflare']);
  assert.equal(resolveTargets('assign all four to bo', answer).rows.length, 4);
  assert.equal(parseCommand('Please assign those to Bo', salesVerbs).verb.id, 'assign');
  assert.equal(parseCommand('pull everything on Northrop for Claude', salesVerbs).verb.id, 'copy');
  assert.equal(parseCommand('what should I focus on', salesVerbs), null);
  assert.equal(readType('opportunity'), 'employer'); assert.equal(diskType('employer'), 'opportunity'); assert.equal(readType('partner'), 'partner');
});

test('D10 / R12: one builder - a company pack carries the Brief\'s lines, a person pack their signals and their company; capped at 6,000 characters by dropping the oldest list lines; a pack that still holds an "@" is not copied', async () => {
  const contacts = Array.from({ length: 50 }, (_, i) => ({ id: u('c') + i, business_id: A, goal_id: u('1'), name: `Contact Number ${i}`, title: `Senior Director of People Operations and Total Rewards, Region ${i} `.repeat(2), role_in_notes: null }));
  const sb = seed({ partner_contacts: contacts });
  const big = await copyPack(sb, { businessId: A, question: 'pull everything on Hilton Partners', scope: 'Alpha', today: TODAY, records: [{ type: 'partner', id: u('1') }] });
  assert.ok(big.chars <= PACK_MAX && big.text.length === big.chars);
  assert.ok(big.trimmed > 0); assert.match(big.text, /older lines trimmed to fit/);
  assert.match(big.text, /^Question: pull everything on Hilton Partners\nScope: Alpha · 2026-11-10 · 1 record\n\n# Hilton Partners — partner/);
  assert.ok(!big.text.includes('@'));
  const trip = seed({ partner_contacts: [{ id: u('c'), business_id: A, goal_id: u('1'), name: 'Pat Lee', title: 'VP HR @Hilton', role_in_notes: null }] });
  assert.deepEqual(await copyPack(trip, { businessId: A, question: 'q', scope: 'Alpha', today: TODAY, records: [{ type: 'partner', id: u('1') }] }), { blocked: true });
  const registry = await reg();
  const r = await pack(trip, registry, { auth: viewer, body: { scope: A, q: 'q', records: [{ entity: 'partners', id: u('1') }] } });
  assert.equal(r.status, 422); assert.equal(r.body.blocked, true);
  salesReads.peopleActivity = async () => ({ status: 200, body: { rows: [] } });
  const ok = await pack(sb, registry, { auth: ana, body: { scope: A, q: 'copy this', records: [{ entity: 'employers', id: u('3') }] } });
  assert.equal(ok.status, 200); assert.equal(ok.body.records, 1); assert.match(ok.body.text, /# Cloudflare — employer/);
});

test('R6: the People read hides a snoozed person until the day and counts them; snoozed=only / all for the chip', () => {
  const rows = peopleRows({ prospects: [{ contact_id: 'c1', name: 'Dana Mayer', title: 'VP', company: 'Cloudflare', status: 'new', snooze_until: '2026-11-20' }, { contact_id: 'c2', name: 'Lee Stone', title: 'VP', company: 'Marriott', status: 'new', snooze_until: '2026-11-01' }] });
  const t = mode => buildPeopleTable({ rows, window: windowOf('all', TODAY), now: NOW, snoozed: mode });
  assert.deepEqual(t('hide').rows.map(r => r.name), ['Lee Stone']); assert.equal(t('hide').snoozed, 1);
  assert.deepEqual(t('only').rows.map(r => r.name), ['Dana Mayer']);
  assert.equal(t('all').rows.length, 2);
});
