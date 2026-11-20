// scout-v3.1 Stage 1 - the follow-up resolver, asks that point back at the last answer, the inline draft addressed to
// the person, count-fill, the task verbs through a fake applyTodo (expect, batch id, 409, event undo), member
// possessives, a cited name once and read lines with no record id. fakeSupabase + the real sales module; reads through
// salesReads, writes through salesWrites. 0 Claude (a mock model), 0 Apollo. Names, titles, companies only - no '@'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { createRegistry } from '../scout/registry.js';
import { parseAsk, mergeVocab, buildContext, publicRead } from '../scout/retrieve.js';
import { ask, askDeps, resolveRefs, onceEach, followUpOf, SYSTEM } from '../scout/ask.js';
import { plan, act, undo, actDeps, resolveTargets } from '../scout/actions.js';
import { resolveFollowUp, resolvedLine } from '../scout/followUp.js';
import { VOCABULARY, register } from './scoutEntities.js';
import { salesReads, salesIntents, fillWords, fillPeople } from './scoutIntents.js';
import { salesWrites } from './scoutVerbs.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const u = n => `${n}0000000-0000-4000-8000-000000000000`;
const ana = { user: { id: u('a'), name: 'Ana', email: 'x' }, isPlatformOwner: false, roles: new Map([[A, 'member']]) };
const viewer = { user: { id: u('9'), name: 'Vi' }, isPlatformOwner: false, roles: new Map([[A, 'viewer']]) };
const TODAY = '2026-11-10', NOW = Date.parse('2026-11-10T20:00:00Z'); // a Tuesday
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const seed = () => fakeSupabase({
  businesses: [{ id: A, name: 'Alpha', features: { goals_sales: true } }],
  business_members: [{ business_id: A, user_id: u('a'), name: 'Ana Member', role: 'member' }, { business_id: A, user_id: u('b'), name: 'Bo Member', role: 'member' }],
  sales_settings: [{ business_id: A, buyer_titles: [], score_weights: null }],
  sales_goals: [{ id: u('1'), business_id: A, goal_type: 'partnership', name: 'Hilton Partners', owner_user_id: u('a'), pipeline_status: 'in_sequence', fit_level: null, snoozed_until: null, archived_at: null }],
  sales_opportunities: [{ id: u('3'), business_id: A, organization: 'Cloudflare', owner_user_id: u('a'), owner: 'Ana', stage: 'contacted', fit_level: null, archived_at: null }, { id: u('4'), business_id: A, organization: 'Northrop Grumman', owner_user_id: u('b'), owner: 'Bo', stage: 'target', fit_level: null, archived_at: null }],
  sales_targets: [{ id: u('5'), business_id: A, name: 'Mission Lane', owner_user_id: null, status: 'researching', fit_level: null }],
  sales_prospect_state: [{ business_id: A, contact_id: 'p1', name: 'Dana Mayer', status: 'new', snooze_until: null, opportunity_id: u('3'), goal_id: null }, { business_id: A, contact_id: 'p2', name: 'Meagan Earl', status: 'new', snooze_until: null, opportunity_id: u('3'), goal_id: null }],
  sales_week_goals: [], sales_week_goal_steps: [], sales_flow_events: [], sales_partner_events: [], partner_contacts: [], sales_call_notes: [], sales_targets_notes: [], business_anthropic_usage: [], sales_company_scores: [], microsoft_messages: [],
});
const reg = async () => { const r = createRegistry(); await register(r); return r; };
const vocab = mergeVocab([VOCABULARY, { sources: {}, members: [{ id: u('b'), name: 'Bo Member' }, { id: u('c'), name: 'Cyrus Vale' }] }]);
const p = (i, name, co, coId = `e${i}`) => ({ key: `people:prospect:p${i}`, entity: 'people', id: `prospect:p${i}`, title: name, company: { type: 'employer', id: coId, name: co } });
const task = (i, title) => ({ key: `todos:${u(String(i))}`, entity: 'todos', id: u(String(i)), title, company: null });
const ROWS = [p(1, 'Dana Mayer', 'Cloudflare', u('3')), p(2, 'Meagan Earl', 'Cloudflare', u('3')), p(3, 'Danilea Cruz', 'Northrop Grumman', u('4')), p(4, 'Lee Stone', 'MetLife'), p(5, 'Rae North', 'Hilton'), task(6, 'Call MetLife benefits lead'), task(7, 'Send Hilton the one-pager'), task(8, 'Follow up with Northrop')];
const person = (key, name, co, heat, band, extra = {}) => ({ key, name, title: 'VP People', company: co ? { type: 'employer', id: u('3'), name: co, stage: 'contacted' } : null, source: 'Apollo sequence', emails: { sent: 2, opened: 1, clicked: 0, replied: 0 }, last_email: { at: '2026-11-08T10:00:00Z', what: 'opened' }, heat, heat_band: band, visits: { visits_7d: 3, last_visit: '2026-11-09', seen_to: '2026-11-09' }, identified_at: null, status: 'new', snooze_until: null, ...extra });
const model = text => { const calls = []; askDeps.now = () => NOW; askDeps.callAnthropic = async a => { calls.push(a); return { content: [{ type: 'text', text }], usage: { input_tokens: 800, output_tokens: 50 } }; }; return calls; };
actDeps.now = () => NOW;
const titles = r => r.rows.map(x => x.title);
const REAL_WRITES = { ...salesWrites };

test('C1 resolver: the ten Stage 0 phrasings resolve against the last answer\'s rows; a fresh question never does', () => {
  const cmd = (q, entities = null) => resolveFollowUp(q, ROWS, { entities }), q = text => resolveFollowUp(text, ROWS, { ask: true });
  const peopleAndCompanies = ['people', 'partners', 'employers', 'targets'];
  assert.deepEqual(titles(cmd('write an email to the second one', peopleAndCompanies)), ['Meagan Earl']);
  assert.deepEqual(titles(q('tell me about #3')), ['Danilea Cruz']);
  assert.deepEqual([q('what do we know about her').rows.length, q('what do we know about her').ambiguous], [0, true], 'five people: which one is never guessed');
  assert.deepEqual(titles(q('show me their tasks')), ROWS.map(r => r.title));
  assert.equal(q('what stage is that company in').ambiguous, true);
  assert.deepEqual(titles(cmd('snooze those until next week')).length, 8);
  assert.deepEqual(titles(q('tell me about Danilea')), ['Danilea Cruz']);
  assert.deepEqual(titles(q('what about the Cloudflare ones')), ['Dana Mayer', 'Meagan Earl']);
  assert.deepEqual(titles(cmd('snooze the first task until next week', ['people', 'todos', 'partners'])), ['Call MetLife benefits lead'], 'an ordinal with a noun counts inside that kind');
  assert.deepEqual(titles(cmd('write an email to the last one', peopleAndCompanies)), ['Rae North'], 'the last row the verb can use');
  // more of the rule
  assert.deepEqual(titles(q('the second and third')), ['Meagan Earl', 'Danilea Cruz']);
  assert.deepEqual(titles(q('show me those people')), ROWS.slice(0, 5).map(r => r.title));
  assert.deepEqual(titles(cmd('snooze those tasks')), ROWS.slice(5).map(r => r.title));
  assert.deepEqual(titles(q('what is on file for the last person')), ['Rae North']);
  assert.deepEqual(titles(cmd('assign the first 3 to Bo')), ['Dana Mayer', 'Meagan Earl', 'Danilea Cruz']);
  assert.deepEqual(titles(cmd('snooze row 2')), ['Meagan Earl']);
  const one = [ROWS[0]];
  assert.deepEqual(titles(resolveFollowUp('what do we know about her', one, { ask: true })), ['Dana Mayer']);
  const co = resolveFollowUp('what stage is that company in', one, { ask: true });
  assert.equal(co.company, true); assert.equal(resolvedLine(co), 'that company → Cloudflare');
  assert.equal(resolvedLine(cmd('write an email to the second one')), 'the second one → Meagan Earl, Cloudflare');
  assert.equal(resolvedLine(q('show me those people')), 'those people → Dana Mayer, Cloudflare · Meagan Earl, Cloudflare · Danilea Cruz, Northrop Grumman + 2 more');
  // a question that only shares words with a follow-up is a new question
  for (const fresh of ['top 5 hot people', 'who opened in the last 7 days', 'which companies opened their emails', 'people first-touched this week', 'how are we pacing this week', 'hot people visiting last week', 'what is our open rate this month', 'show me my open tasks'])
    assert.equal(q(fresh).how, 'none', fresh);
  // the command resolver keeps a menu pick
  assert.deepEqual(resolveTargets('whatever', ROWS, [ROWS[3].key]).rows.map(r => r.title), ['Lee Stone']);
  // followUpOf: nothing to point at / which one / not a follow-up
  assert.match(followUpOf('what about the second one', []).cant, /^Ask for a list first/);
  assert.match(followUpOf('email her', []).cant, /^Ask for a list first/);
  assert.equal(followUpOf('show my tasks for them', []), null, 'a pronoun with no last answer is left to the ask itself');
  assert.match(followUpOf('what do we know about her', ROWS).cant, /^Which one\?/);
  assert.match(followUpOf('tell me about #12', ROWS).cant, /has 8 rows/);
  assert.equal(followUpOf('top 5 hot people', ROWS), null);
});

test('C1 on asks: the rows ride with the ask, the resolved record becomes the filter, the summary and the model\'s turn say what was resolved; nothing to resolve -> said plainly with no model call', async () => {
  const sb = seed(), registry = await reg();
  const people = [person('prospect:p1', 'Dana Mayer', 'Cloudflare', 90, 'hot'), person('prospect:p2', 'Meagan Earl', 'Cloudflare', 70, 'warm', { emails: { sent: 3, opened: 2, clicked: 0, replied: 1 } }), person('prospect:p9', 'Other Person', 'Cloudflare', 60, 'warm', { emails: { sent: 3, opened: 2, clicked: 0, replied: 1 } })];
  salesReads.peopleActivity = async () => ({ status: 200, body: { rows: people } });
  salesReads.personDetail = async () => ({ status: 200, body: { timeline: [{ kind: 'reply', at: '2026-11-08T10:00:00Z', subject: 'Re: housing', reply_class: 'follow_up_question' }], notes: 'Met at the expo' } });
  const rows = ROWS.slice(0, 2);
  let calls = model('She replied with a question on Nov 8. [r1]');
  const r = await ask(sb, registry, { auth: ana, body: { q: 'what do we know about the second one', scope: A, rows } });
  assert.equal(r.status, 200); assert.equal(calls.length, 1);
  assert.deepEqual(r.body.resolved, { phrase: 'the second one', line: 'the second one → Meagan Earl, Cloudflare', rows: [{ entity: 'people', id: 'prospect:p2', title: 'Meagan Earl' }] });
  assert.ok(r.body.summary.startsWith('the second one → Meagan Earl, Cloudflare. '));
  assert.match(calls[0].messages.at(-1).content, /This is a follow-up on the last answer: the second one → Meagan Earl, Cloudflare\. Answer about that record only\./);
  assert.equal(r.body.context_stats.intent, 'brief');
  // C7: the person brief's grid - Company is a field; a field with nothing on file is "—"
  assert.deepEqual(r.body.sections[0].brief, { entity: 'people', id: 'prospect:p2', grid: [{ label: 'Record', value: 'Person · VP People' }, { label: 'Owner', value: 'Unassigned' }, { label: 'Company', value: 'Cloudflare · contacted' }, { label: 'Visits', value: 'last visit 2026-11-09' }, { label: 'Last email', value: '2026-11-08 · opened' }, { label: 'Notes', value: 'Met at the expo' }] });
  assert.ok(r.body.sections[0].read.includes('goals/people/activity/person') && !r.body.sections[0].read.includes('prospect:'), r.body.sections[0].read);
  // "their tasks": the people's COMPANY is the to-do filter
  const linked = { id: u('6'), text: 'Send Cloudflare the agreement', due_date: '2026-11-12', owner_user_id: u('a'), created_at: '2026-11-01T00:00:00Z', link_type: 'opportunity', link_id: u('3'), steps: [] };
  const seen = [];
  salesReads.openTodosFor = async (_sb, _b, who) => { seen.push(who); return { rows: [linked, { ...linked, id: u('7'), text: 'Call another account', link_id: u('4') }], total: 2 }; };
  salesReads.companyBrief = async () => ({ status: 200, body: { company: { type: 'employer', id: u('3'), name: 'Cloudflare' }, score: null, next_step: null, lines: [] } });
  calls = model('One open task. [r1]');
  const t = await ask(sb, registry, { auth: ana, body: { q: 'show me their tasks', scope: A, rows } });
  assert.deepEqual(t.body.ask.company, ['Cloudflare']);
  assert.ok(t.body.context_stats.intent.includes('todos'));
  const packed = calls[0].messages.at(-1).content;
  assert.ok(packed.includes('Send Cloudflare the agreement') && !packed.includes('Call another account'), 'only that company\'s to-dos reach the model');
  assert.equal(t.body.resolved.line, 'their → Dana Mayer, Cloudflare · Meagan Earl, Cloudflare');
  // a people question about those people reads those people, not everyone who matches
  calls = model('One of them replied. [r1]');
  const who = await ask(sb, registry, { auth: ana, body: { q: 'which of those people replied', scope: A, rows } });
  assert.equal(who.body.context_stats.intent, 'people');
  assert.deepEqual(who.body.sections[0].rows.map(x => x.title), ['Meagan Earl'], 'Other Person replied too but was not in the last answer');
  // nothing to point at / more than one candidate: plain words, no model call, no ask spent
  calls = model('unused');
  const none = await ask(sb, registry, { auth: ana, body: { q: 'what about the second one', scope: A } });
  assert.equal(none.status, 200); assert.match(none.body.cant.reason, /^Ask for a list first/); assert.equal(none.body.answer_md, none.body.cant.reason); assert.deepEqual(none.body.sections, []);
  const which = await ask(sb, registry, { auth: ana, body: { q: 'what do we know about her', scope: A, rows } });
  assert.match(which.body.cant.reason, /^Which one\?/);
  assert.deepEqual(which.body.cant.candidates, [{ key: 'people:prospect:p1', entity: 'people', id: 'prospect:p1', title: 'Dana Mayer', sub: 'Cloudflare' }, { key: 'people:prospect:p2', entity: 'people', id: 'prospect:p2', title: 'Meagan Earl', sub: 'Cloudflare' }], 'the picker\'s rows');
  assert.equal(calls.length, 0); assert.equal(which.body.usage, null);
  // a fresh question with rows on screen is not a follow-up
  calls = model('Two people. [r1] [r2]');
  const fresh = await ask(sb, registry, { auth: ana, body: { q: 'who opened our emails', scope: A, rows } });
  assert.equal(fresh.body.resolved, undefined); assert.ok(!/follow-up/.test(calls[0].messages.at(-1).content));
  for (const b of [r, t, who, none, which, fresh]) assert.ok(!JSON.stringify(b.body).includes('@'));
});

const fakeTodoWrites = (todos, { stale = null } = {}) => {
  const log = [];
  Object.assign(salesWrites, {
    todoLoad: async (_sb, _b, id) => todos.find(x => x.id === id) || null,
    todo: async (_sb, a) => { if (stale && a.todoId === stale) throw Object.assign(new Error('This to-do changed since you opened it - reloaded'), { status: 409, code: 'changed' }); log.push(['todo', a.todoId, a.patch, a.kind, a.expect, a.origin, a.batchId]); return { todo: {}, event: { id: `ev-${a.todoId.slice(0, 1)}-${a.kind}` } }; },
    todoEventUndo: async (_sb, a) => { log.push(['todoEventUndo', a.eventId]); return {}; },
    todoOn: async (_sb, a) => { log.push(['todoOn', a.type, a.id, a.text, a.dueDate, a.origin, a.personKey, a.batchId]); return { id: 'new-1', event_id: 'ev-create' }; },
    compose: async (_sb, a) => { log.push(['compose', a.type, a.id, a.person]); return { status: 200, body: { draft: { subject: `An idea for ${a.person ? a.person.name.split(' ')[0] : 'the team'}`, body: `Hi ${a.person ? a.person.name.split(' ')[0] : 'there'},\n\nWorth 15 minutes?\n\nAna`, why: 'w' }, cost_usd: 0.0123, cap: { used: 4, max: 30 }, lint: { ok: true, issues: [], words: 9 } } }; },
  });
  return log;
};
const open = (i, text, extra = {}) => ({ id: u(String(i)), kind: 'todo', status: 'open', text, due_date: '2026-11-12', owner_user_id: u('a'), snooze_until: null, prospect_contact_id: null, ...extra });

test('C2 draft: "write an email to the second one" drafts inline to THAT person through the one compose call - { subject, body, cost }, never a send; a draft holding a phone shape is withheld; the cap and a Viewer are can\'t-do', async () => {
  const sb = seed(), registry = await reg(), log = fakeTodoWrites([]);
  salesReads.peopleActivity = async () => ({ status: 200, body: { rows: [person('prospect:p1', 'Dana Mayer', 'Cloudflare', 90, 'hot'), person('prospect:p2', 'Meagan Earl', 'Cloudflare', 70, 'warm', { title: 'Head of Benefits' })] } });
  const d = await plan(sb, registry, { auth: ana, body: { scope: A, inline: true, text: 'write an email to the second one', rows: ROWS } });
  assert.equal(d.status, 200); assert.equal(d.body.verb, 'draft'); assert.equal(d.body.plan_id, undefined, 'nothing to confirm');
  assert.deepEqual(log, [['compose', 'employer', u('3'), { person_key: 'prospect:p2', name: 'Meagan Earl', title: 'Head of Benefits' }]]);
  assert.deepEqual(d.body.draft, { to: { person_key: 'prospect:p2', name: 'Meagan Earl', title: 'Head of Benefits' }, company: { type: 'employer', id: u('3'), name: 'Cloudflare' }, cost: { usd: 0.0123 }, cap: { used: 4, max: 30 }, subject: 'An idea for Meagan', body: 'Hi Meagan,\n\nWorth 15 minutes?\n\nAna', lint: { ok: true, issues: 0 } });
  assert.deepEqual(d.body.open, { panel: 'compose', type: 'employer', id: u('3'), name: 'Cloudflare', to: 'Meagan Earl', prefill: { subject: 'An idea for Meagan', body: 'Hi Meagan,\n\nWorth 15 minutes?\n\nAna' } });
  assert.equal(d.body.line, 'Drafted to Meagan Earl — nothing sent');
  // a company: addressed to the company, as before
  log.length = 0;
  const c = await plan(sb, registry, { auth: ana, body: { scope: A, inline: true, text: 'write an email to Cloudflare', rows: [] } });
  assert.deepEqual(log[0], ['compose', 'employer', u('3'), null]); assert.equal(c.body.draft.to, null); assert.match(c.body.draft.body, /^Hi there,/);
  // withheld
  const good = salesWrites.compose;
  salesWrites.compose = async () => ({ status: 200, body: { draft: { subject: 'Call me', body: 'Hi Meagan,\n\nRing 415-555-0134 any time.\n\nAna', why: '' }, cost_usd: 0.01, cap: { used: 5, max: 30 }, lint: null } });
  const w = await plan(sb, registry, { auth: ana, body: { scope: A, inline: true, text: 'write an email to the second one', rows: ROWS } });
  assert.equal(w.body.draft.withheld, true); assert.match(w.body.draft.reason, /^Draft withheld/); assert.equal(w.body.draft.body, undefined); assert.equal(w.body.open.prefill, undefined);
  assert.deepEqual(w.body.draft.cost, { usd: 0.01 }, 'the call was made: its cost still shows');
  assert.ok(!JSON.stringify(w.body).includes('555'));
  // the Write-email cap
  salesWrites.compose = async () => ({ status: 429, body: { error: 'Write email cap reached (30 per day for this workspace)', used: 30, max: 30 } });
  assert.match((await plan(sb, registry, { auth: ana, body: { scope: A, inline: true, text: 'write an email to the second one', rows: ROWS } })).body.cant.reason, /^Write email cap reached/);
  salesWrites.compose = good;
  // a client that does not ask for the inline draft gets the panel opened and NO call (the screen before Stage 2)
  log.length = 0;
  const old = await plan(sb, registry, { auth: ana, body: { scope: A, text: 'write an email to the second one', rows: ROWS } });
  assert.deepEqual(old.body.open, { panel: 'compose', type: 'employer', id: u('3'), name: 'Cloudflare', to: 'Meagan Earl' }); assert.equal(old.body.draft, undefined); assert.equal(log.length, 0);
  // a command with several candidates asks which one, with the rows to pick from (people only: the verb's kinds)
  const amb = await plan(sb, registry, { auth: ana, body: { scope: A, inline: true, text: 'write an email to her', rows: ROWS } });
  assert.match(amb.body.cant.reason, /^Which one\?/); assert.deepEqual(amb.body.cant.candidates.map(c => c.title), ['Dana Mayer', 'Meagan Earl', 'Danilea Cruz', 'Lee Stone', 'Rae North']); assert.deepEqual(amb.body.cant.pills, []);
  // one at a time; a Viewer never drafts
  assert.match((await plan(sb, registry, { auth: ana, body: { scope: A, inline: true, text: 'write an email to those people', rows: ROWS } })).body.cant.reason, /one draft at a time/);
  log.length = 0;
  const v = await plan(sb, registry, { auth: viewer, body: { scope: A, inline: true, text: 'write an email to the second one', rows: ROWS } });
  assert.equal(v.status, 403); assert.equal(log.length, 0);
  assert.ok(!JSON.stringify([d.body, c.body, w.body]).includes('@'));
});

test('C3 count-fill: fewer than the count asked in the band -> the next bands of the same read fill it and the pill + read say so; rows keep their real band; never padded past the read; no count or enough rows -> no fill', async () => {
  const sb = seed(), registry = await reg();
  const mk = (n, band, heat) => Array.from({ length: n }, (_, i) => person(`prospect:${band}${i}`, `${band[0].toUpperCase()}${band.slice(1)} Person ${i}`, 'Cloudflare', heat - i, band));
  salesReads.peopleActivity = async () => ({ status: 200, body: { rows: [...mk(1, 'hot', 95), ...mk(6, 'warm', 60), ...mk(2, 'cold', 10)] } });
  const calls = model('Five people.');
  const r = await ask(sb, registry, { auth: ana, body: { q: 'pull me 5 most important prospects who are visiting and hot', scope: A } });
  const s = r.body.sections[0];
  assert.equal(s.fill.text, '5 people · 1 hot · 4 warm to make 5');
  assert.deepEqual([s.fill.asked, s.fill.strict, s.fill.counts], [5, 1, [{ band: 'hot', n: 1 }, { band: 'warm', n: 4 }]]);
  assert.match(s.read, / · filled: 5 people · 1 hot · 4 warm to make 5$/);
  assert.ok(calls[0].messages.at(-1).content.split('\n').filter(l => /^\[r\d+\]/.test(l)).length === 5);
  const c = await buildContext(sb, registry, { auth: ana, scope: A, q: 'pull me 5 most important prospects who are visiting and hot', now: NOW });
  assert.deepEqual([...c.items.values()].map(x => x.row.heat_band), ['hot', 'warm', 'warm', 'warm', 'warm'], 'each row keeps its real band');
  assert.equal(c.parts[0].count, 5);
  // not enough on file: said, never padded
  salesReads.peopleActivity = async () => ({ status: 200, body: { rows: [...mk(1, 'hot', 95), ...mk(2, 'warm', 60)] } });
  const few = await buildContext(sb, registry, { auth: ana, scope: A, q: '5 hot prospects visiting the site', now: NOW });
  assert.equal(few.parts[0].fill.text, '3 people · 1 hot · 2 warm to make 3 (5 asked - that is every one on file)'); assert.equal(few.items.size, 3);
  // enough hot ones, or no count: the strict list, no fill
  salesReads.peopleActivity = async () => ({ status: 200, body: { rows: [...mk(6, 'hot', 95), ...mk(3, 'warm', 60)] } });
  assert.equal((await buildContext(sb, registry, { auth: ana, scope: A, q: '5 hot prospects visiting the site', now: NOW })).parts[0].fill, null);
  salesReads.peopleActivity = async () => ({ status: 200, body: { rows: [...mk(1, 'hot', 95), ...mk(6, 'warm', 60)] } });
  const strict = await buildContext(sb, registry, { auth: ana, scope: A, q: 'hot prospects visiting the site', now: NOW });
  assert.equal(strict.parts[0].fill, null); assert.equal(strict.items.size, 1, 'never silently loosened');
  assert.equal(fillPeople(mk(2, 'warm', 60), { band: 'P1', bandKind: 'heat', limit: 3 }).fill.text, '2 people · 0 hot · 2 warm to make 2 (3 asked - that is every one on file)');
  assert.equal(fillWords('companies', 5, [{ band: 'hot', n: 2 }, { band: 'warm', n: 3 }]), '5 companies · 2 hot · 3 warm to make 5');
  // companies: P1 -> P2 -> P3 through the same scores read
  const score = (i, band) => ({ type: 'employer', id: `${i}0000000-0000-4000-8000-0000000000ee`, name: `${band} Co ${i}`, score: 80 - i, band, rank: i, owner: null, stage: 'target', last_touch_at: null });
  const asked = [];
  salesReads.listScores = async (_sb, _b, query) => { asked.push(query.band); const rows = query.band === 'P1' ? [score(1, 'P1'), score(2, 'P1')] : query.band === 'P2' ? [3, 4, 5, 6].map(i => score(i, 'P2')) : []; return { status: 200, body: { rows, counts: { shown: rows.length } } }; };
  const co = await buildContext(sb, registry, { auth: ana, scope: A, q: 'show me 5 hot employers', now: NOW });
  assert.deepEqual(asked, ['P1', 'P2']);
  assert.equal(co.parts[0].fill.text, '5 companies · 2 hot · 3 warm to make 5');
  assert.deepEqual([...co.items.values()].map(x => x.row.band), ['P1', 'P1', 'P2', 'P2', 'P2']);
});

test('C4 task verbs: each a card, each through applyTodo with expect + origin scout + the card\'s batch id, each undone by its event; a changed to-do is skipped; a typed add is a card that creates one to-do', async () => {
  const sb = seed(), registry = await reg();
  const todos = [open(6, 'Call MetLife benefits lead'), open(7, 'Send Hilton the one-pager', { owner_user_id: u('b'), due_date: '2026-11-11' }), open(8, 'Follow up with Northrop', { due_date: null })];
  const log = fakeTodoWrites(todos);
  const go = async text => { const pl = await plan(sb, registry, { auth: ana, body: { scope: A, text, rows: ROWS } }); return pl.body.plan_id ? { p: pl, a: await act(sb, registry, { auth: ana, body: { plan_id: pl.body.plan_id } }) } : { p: pl }; };
  // done
  let r = await go('mark the first task done');
  assert.equal(r.p.body.verb, 'task_done');
  assert.deepEqual(r.p.body.rows, [{ key: `todos:${u('6')}`, kind: 'task', title: 'Call MetLife benefits lead', from: 'open', to: 'done', skipped: null, note: null }]);
  assert.deepEqual(log, [['todo', u('6'), { status: 'done' }, 'done', { status: 'open' }, 'scout', r.p.body.plan_id]]);
  assert.equal(r.a.body.line, 'Marked done 1'); assert.equal(r.a.body.can_undo, true);
  assert.equal((await undo(sb, registry, { auth: ana, body: { plan_id: r.p.body.plan_id } })).body.line, 'undone');
  assert.deepEqual(log[1], ['todoEventUndo', 'ev-6-done']);
  // snooze a batch: one batch id, one Undo
  log.length = 0;
  r = await go('snooze those tasks until next week');
  assert.equal(r.p.body.verb, 'snooze'); assert.equal(r.p.body.to, '2026-11-16'); assert.equal(r.p.body.rows.length, 3);
  assert.deepEqual(r.p.body.rows[0], { key: `todos:${u('6')}`, kind: 'task', title: 'Call MetLife benefits lead', from: 'not snoozed', to: 'until 2026-11-16', skipped: null, note: 'hidden from the open list until then' });
  assert.deepEqual(log.map(l => [l[1], l[2], l[3], l[4]]), [6, 7, 8].map(i => [u(String(i)), { snooze_until: '2026-11-16' }, 'snooze', { snooze_until: null }]));
  assert.equal(new Set(log.map(l => l[6])).size, 1); assert.equal(log[0][6], r.p.body.plan_id);
  assert.equal(r.a.body.line, 'Snoozed 3 of 3 until 2026-11-16');
  await undo(sb, registry, { auth: ana, body: { plan_id: r.p.body.plan_id } });
  assert.deepEqual(log.slice(3).map(l => l[0]), ['todoEventUndo', 'todoEventUndo', 'todoEventUndo']);
  // reassign (the assign verb on a task row)
  log.length = 0;
  r = await go('reassign the first task to Bo');
  assert.deepEqual(r.p.body.rows.map(x => [x.kind, x.title, x.from, x.to]), [['task', 'Call MetLife benefits lead', 'Ana', 'Bo']]);
  assert.deepEqual(log[0].slice(1, 6), [u('6'), { owner_user_id: u('b') }, 'reassign', { owner_user_id: u('a') }, 'scout']);
  assert.match((await go('assign the second task to Bo')).p.body.rows[0].skipped, /already Bo/);
  // due
  log.length = 0;
  r = await go('move the third task to Friday');
  assert.equal(r.p.body.verb, 'task_due');
  assert.deepEqual(r.p.body.rows.map(x => [x.from, x.to]), [['no date', 'due 2026-11-13']]);
  assert.deepEqual(log[0].slice(1, 5), [u('8'), { due_date: '2026-11-13' }, 'due', { due_date: null }]);
  assert.match((await go('move the third task')).p.body.cant.reason, /^Say the new date/);
  // drop
  log.length = 0;
  r = await go('drop the last task');
  assert.deepEqual(r.p.body.rows.map(x => [x.title, x.from, x.to]), [['Follow up with Northrop', 'open', 'dropped']]);
  assert.deepEqual(log[0].slice(1, 5), [u('8'), { status: 'dropped' }, 'drop', { status: 'open' }]);
  // changed meanwhile (409) = a skipped row, never an overwrite; a to-do that is gone is said
  const stale = fakeTodoWrites(todos, { stale: u('6') });
  r = await go('mark the first task done');
  assert.equal(r.a.body.done, 0); assert.equal(r.a.body.rows[0].skipped, 'changed meanwhile'); assert.equal(r.a.body.can_undo, false); assert.equal(stale.length, 0);
  fakeTodoWrites([{ ...todos[0], status: 'done' }, todos[1], todos[2]]);
  assert.match((await go('mark the first task done')).p.body.cant.reason, /no longer open/);
  // a task verb on a person row does not apply
  assert.match((await plan(sb, registry, { auth: ana, body: { scope: A, verb: 'task_done', keys: [ROWS[0].key], rows: ROWS } })).body.cant.reason, /doesn't apply to those rows/);
  // add: a typed task is a card -> one to-do through todoOn -> the create event's Undo
  const made = fakeTodoWrites(todos);
  r = await go('add a task to call Cloudflare Thursday');
  assert.equal(r.p.body.verb, 'add_task');
  assert.deepEqual(r.p.body.fields, { task: 'Call Cloudflare', linked_to: 'Cloudflare', linked_detail: 'Employer · Contacted', link: { type: 'employer', id: u('3'), name: 'Cloudflare' }, person_key: null, owner: 'Ana', due: '2026-11-12', due_note: '"thursday" read as the next one' });
  assert.deepEqual(r.p.body.rows.map(x => [x.kind, x.title, x.to]), [['task', 'Call Cloudflare', 'open to-do · due 2026-11-12']]);
  assert.deepEqual(made, [['todoOn', 'employer', u('3'), 'Call Cloudflare', '2026-11-12', 'scout', null, r.p.body.plan_id]]);
  assert.equal(r.a.body.line, 'Added 1');
  await undo(sb, registry, { auth: ana, body: { plan_id: r.p.body.plan_id } });
  assert.deepEqual(made[1], ['todoEventUndo', 'ev-create']);
  made.length = 0;
  r = await go('add a task to review the deck');
  assert.deepEqual([r.p.body.fields.linked_to, r.p.body.fields.due, r.p.body.fields.due_note], [null, TODAY, 'no date said - due today']);
  assert.deepEqual(made[0].slice(1, 5), [null, null, 'Review the deck', TODAY]);
  // the older verbs keep their words: "mark ... contacted" is not "mark ... done"; a stage move is still refused
  assert.equal((await plan(sb, registry, { auth: ana, body: { scope: A, text: 'mark Dana Mayer contacted', rows: ROWS.slice(0, 1) } })).body.verb, 'contacted');
  assert.match((await plan(sb, registry, { auth: ana, body: { scope: A, text: 'move Cloudflare to the proposal stage', rows: [] } })).body.cant.reason, /can't move a stage/);
  assert.equal((await plan(sb, registry, { auth: viewer, body: { scope: A, text: 'mark the first task done', rows: ROWS } })).status, 403);
});

test('C5 possessives: a member\'s first name is a member token, never a company - "<member>\'s top 5 / targets / tasks" read that member and run no brief or ranked read', async () => {
  const intents = a => salesIntents.filter(i => i.match(a)).map(i => i.id);
  const top = parseAsk("Cyrus's top 5", vocab, { today: TODAY });
  assert.deepEqual([top.company, top.member, intents(top)], [[], { id: u('c'), name: 'Cyrus' }, ['top_targets']]);
  assert.deepEqual(intents(parseAsk("Cyrus's tasks", vocab, { today: TODAY })), ['todos']);
  assert.deepEqual(intents(parseAsk('show me Cyrus tasks', vocab, { today: TODAY })), ['todos']);
  assert.deepEqual(intents(parseAsk("Bo's targets", vocab, { today: TODAY })), ['ranked']);
  assert.deepEqual(intents(parseAsk('my top targets', vocab, { today: TODAY })), ['top_targets'], 'ranked stands down for the one ranking');
  assert.deepEqual(parseAsk('what do we know about Cyrus Industries', vocab, { today: TODAY }).company, ['Industries'], 'the member word is taken out of the name; the rest still searches');
  assert.equal(parseAsk('what do we know about Hilton', vocab, { today: TODAY }).member, null);
  assert.ok(!parseAsk("Cyrus's tasks", vocab, { today: TODAY }).terms.includes('cyruss'));
  // through the real module: the glossary supplies the members
  const sb = seed(), registry = await reg();
  const seen = [];
  salesReads.topTargets = async (_sb, _b, query) => { seen.push(['top', query]); return { status: 200, body: { rows: [], n: 0, total: 0, pinned: 0 } }; };
  salesReads.openTodosFor = async (_sb, _b, who) => { seen.push(['todos', who]); return { rows: [], total: 0 }; };
  salesReads.listScores = async (_sb, _b, query) => { seen.push(['scores', query.owner]); return { status: 200, body: { rows: [], counts: { shown: 0 } } }; };
  salesReads.companyBrief = async () => { seen.push(['brief']); return { status: 404, body: {} }; };
  const a = await buildContext(sb, registry, { auth: ana, scope: A, q: "Bo's top 5", now: NOW });
  assert.equal(a.stats.intent, 'top_targets'); assert.deepEqual(seen, [['top', { owner: u('b'), limit: 5 }]]);
  assert.ok(!UUID.test(a.parts[0].read), a.parts[0].read);
  seen.length = 0;
  const b = await buildContext(sb, registry, { auth: ana, scope: A, q: "Bo's tasks", now: NOW });
  assert.equal(b.stats.intent, 'todos'); assert.deepEqual(seen, [['todos', u('b')]]); assert.match(b.parts[0].read, /^openTodos \(0 open, Bo's\)/);
  seen.length = 0;
  await buildContext(sb, registry, { auth: ana, scope: A, q: "Bo's targets", now: NOW });
  assert.deepEqual(seen, [['scores', u('b')]]);
});

test('C6: a cited name appears once (the prompt says so and a post-pass enforces it); a read line carries read labels and counts, never a record id', async () => {
  assert.match(SYSTEM, /never write a record's name next to its label/);
  const items = new Map([['r1', { entity: 'people', id: 'prospect:p1', title: 'Dana Mayer' }], ['r2', { entity: 'employers', id: u('3'), title: 'Cloudflare' }]]);
  assert.equal(resolveRefs('- Dana Mayer [r1]: replied Nov 8\n- **Cloudflare** ([r2]) visited twice', items).answer_md, '- Dana Mayer: replied Nov 8\n- **Cloudflare** visited twice');
  assert.equal(resolveRefs('Dana Mayer, [r1], is the hottest. [r1] replied.', items).answer_md, 'Dana Mayer, is the hottest. Dana Mayer replied.');
  assert.equal(onceEach('Cloudflare - Cloudflare is P1; Cloudflare again later', ['Cloudflare']), 'Cloudflare is P1; Cloudflare again later');
  assert.equal(onceEach('Dana Mayer (Dana Mayer)', ['Dana Mayer']), 'Dana Mayer');
  assert.equal(onceEach('Dana Mayer and Dana Mayers team', ['Dana Mayer']), 'Dana Mayer and Dana Mayers team');
  assert.equal(publicRead(`goals/brief/employer/${u('3')} + goals/people/activity/prospect:abc123`), 'goals/brief/employer + goals/people/activity/person');
  assert.equal(publicRead(`goals/top-targets {"owner":"${u('b')}","limit":5} · 5 of 49 · 2 pinned`), 'goals/top-targets {"owner":"a member","limit":5} · 5 of 49 · 2 pinned');
  assert.equal(publicRead('openTodos (12 open, mine) · for Hilton'), 'openTodos (12 open, mine) · for Hilton');
  const sb = seed(), registry = await reg();
  salesReads.companyBrief = async () => ({ status: 200, body: { company: { type: 'employer', id: u('3'), name: 'Cloudflare' }, score: { score: 70, band: 'P1' }, next_step: null, lines: [{ ref: 'B1', kind: 'visit', text: 'Visited pricing twice' }] } });
  salesReads.peopleActivity = async () => ({ status: 200, body: { rows: [] } });
  model('It is a hot employer. [r1]');
  const r = await ask(sb, registry, { auth: ana, body: { q: 'what do we know about Cloudflare', scope: A } });
  assert.equal(r.body.sections[0].read, 'goals/brief/employer');
  assert.deepEqual(r.body.sections[0].brief.grid.map(g => [g.label, g.value]), [['Record', 'employer'], ['Owner', 'Unassigned'], ['Visits', 'Visited pricing twice'], ['Last touch', '—'], ['Notes', '—'], ['People', '—']]);
  assert.ok(r.body.context_stats.reads.every(x => !UUID.test(x) && !/prospect:|person:/.test(x)), JSON.stringify(r.body.context_stats.reads));
  assert.ok(!/Records \(/.test(r.body.answer_md)); assert.ok(!JSON.stringify(r.body).includes('@'));
});

test('C4 through the REAL writers (no fakes): done -> the row and its event (origin scout, the card\'s batch id) -> Undo by the event; a typed add creates one linked to-do due on the day said, and Undo drops it', async () => {
  Object.assign(salesWrites, REAL_WRITES);
  const sb = seed(), registry = await reg();
  sb.db.sales_todo_events = []; sb.db.sales_weekly_reports = [];
  // the fake hands back the stored object on select('*'); a database hands back a copy - without one the event's
  // "before" would alias the row it is about to change
  const from0 = sb.from.bind(sb);
  sb.from = t => { const b = from0(t); if (t !== 'sales_week_goals') return b; const one = b.maybeSingle.bind(b); b.maybeSingle = async () => { const r = await one(); return r.data ? { ...r, data: { ...r.data } } : r; }; return b; };
  const id = u('6');
  sb.db.sales_week_goals.push({ id, business_id: A, kind: 'todo', status: 'open', text: 'Call MetLife benefits lead', due_date: '2026-11-12', owner_user_id: u('a'), snooze_until: null, prospect_contact_id: null, link_type: null, link_id: null, person_key: null, completed_at: null, week_start: '2026-11-09', updated_at: '2026-11-09T00:00:00Z' });
  const rows = [task(6, 'Call MetLife benefits lead')];
  const card = await plan(sb, registry, { auth: ana, body: { scope: A, text: 'mark the first task done', rows } });
  assert.equal(card.status, 200, JSON.stringify(card.body)); assert.equal(sb.db.sales_todo_events.length, 0, 'a plan writes nothing');
  const did = await act(sb, registry, { auth: ana, body: { plan_id: card.body.plan_id } });
  assert.equal(did.body.done, 1, JSON.stringify(did.body));
  assert.equal(sb.db.sales_week_goals[0].status, 'done');
  assert.deepEqual(sb.db.sales_todo_events.map(e => [e.kind, e.origin, e.batch_id, e.before.status, e.after.status, e.actor_user_id]), [['done', 'scout', card.body.plan_id, 'open', 'done', u('a')]]);
  const back = await undo(sb, registry, { auth: ana, body: { plan_id: card.body.plan_id } });
  assert.equal(back.body.line, 'undone', JSON.stringify(back.body));
  assert.equal(sb.db.sales_week_goals[0].status, 'open');
  assert.deepEqual(sb.db.sales_todo_events.map(e => e.kind), ['done', 'undo']);
  // a row that changed after the card was drawn is skipped, never overwritten
  const stale = await plan(sb, registry, { auth: ana, body: { scope: A, text: 'snooze the first task until Friday', rows } });
  sb.db.sales_week_goals[0].snooze_until = '2026-11-30';
  const skipped = await act(sb, registry, { auth: ana, body: { plan_id: stale.body.plan_id } });
  assert.deepEqual([skipped.body.done, skipped.body.rows[0].skipped], [0, 'changed meanwhile']); assert.equal(sb.db.sales_week_goals[0].snooze_until, '2026-11-30');
  // add
  const add = await plan(sb, registry, { auth: ana, body: { scope: A, text: 'add a task to call Cloudflare Thursday', rows: [] } });
  const made = await act(sb, registry, { auth: ana, body: { plan_id: add.body.plan_id } });
  assert.equal(made.body.done, 1, JSON.stringify(made.body));
  const todo = sb.db.sales_week_goals.find(t => t.text === 'Call Cloudflare');
  assert.deepEqual([todo.status, todo.due_date, todo.link_type, todo.link_id, todo.owner_user_id, todo.origin], ['open', '2026-11-12', 'opportunity', u('3'), u('a'), 'scout']);
  assert.deepEqual(sb.db.sales_todo_events.at(-1).kind, 'create'); assert.equal(sb.db.sales_todo_events.at(-1).batch_id, add.body.plan_id);
  await undo(sb, registry, { auth: ana, body: { plan_id: add.body.plan_id } });
  assert.equal(sb.db.sales_week_goals.find(t => t.text === 'Call Cloudflare').status, 'dropped');
});
