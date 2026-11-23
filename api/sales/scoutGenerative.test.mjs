// FIX scout-generative - the agenda intent and its read set, the fallback that answers instead of shrugging, the
// never-invent guard on a synthesis answer, the Try phrasings by overlap, one ask counted. fakeSupabase + stubbed
// reads + a mock model: 0 Claude, 0 Apollo, no writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { createRegistry } from '../scout/registry.js';
import { parseAsk, mergeVocab, buildContext, nearExamples } from '../scout/retrieve.js';
import { ask, askDeps, asksToday, SYSTEM, unsourcedNumbers, CALL_TYPE } from '../scout/ask.js';
import { salesIntents, salesReads, salesStanding, agendaWindow, agendaRead, AGENDA_CAPS, STANDING_CAPS } from './scoutIntents.js';
import { VOCABULARY } from './scoutEntities.js';
import { hasPii } from './scrubText.js';

const B = 'aaaaaaaa-0000-4000-8000-000000000001';
const ANA = 'u-ana', BO = 'u-bo';
const TODAY = '2026-11-23'; // a Monday
const NOW = Date.parse('2026-11-23T18:00:00Z');
const auth = { user: { id: ANA, name: 'Ana' }, isPlatformOwner: false, roles: new Map([[B, 'member']]) };
const vocab = mergeVocab([VOCABULARY, { members: [{ id: ANA, name: 'Ana Member' }, { id: BO, name: 'Bo Member' }] }]);
const route = q => salesIntents.filter(i => i.match(parseAsk(q, vocab, { today: TODAY }))).map(i => i.id).join('+') || 'none';

// ── the reads the agenda imports, as the screens' own functions would answer
const todo = (id, text, due, owner = ANA, company = null, extra = {}) => ({ key: `todo:${id}`, kind: 'todo', id, text, due, overdue: !!due && due < TODAY, owner_user_id: owner, company, person: null, verb: 'next_steps', group: 'due', ...extra });
const CF = { type: 'employer', id: 'e1', name: 'Cloudflare' };
const ROWS = [
  todo('t1', 'Send Cloudflare the pilot terms', '2026-11-30', ANA, CF), todo('t2', 'Call the Hilton benefits lead', '2026-12-01', ANA), todo('t3', 'Draft the broker one-pager', '2026-12-01', BO),
  todo('t4', 'Chase the signed order form', '2026-11-18', ANA, CF), todo('t5', 'Update the pricing deck', '2026-11-25', ANA), todo('t6', 'No date on this one', null, ANA),
  todo('t7', 'Answer Dana about the rollout', '2026-12-03', ANA, CF, { group: 'reply' }),
];
const REVIEW = { key: 'review:n1', kind: 'review', id: 'n1', note_id: 'n1', text: 'Review the Seif call', call_date: '2026-11-20', group: 'due', owner_user_id: ANA };
const REPLY = { key: 'reply:prospect:p9', kind: 'reply', id: null, text: 'Reply to Lee Stone', company: { type: 'partner', id: 'g1', name: 'Marriott' }, person: { key: 'prospect:p9', name: 'Lee Stone' }, replied_at: '2026-11-21T10:00:00Z', reply_class: 'interested', group: 'reply', owner_user_id: ANA };
const viewFor = owner => {
  const mine = r => !owner || r.owner_user_id === owner;
  const rows = [...ROWS, REVIEW, REPLY].filter(mine);
  return { view: { groups: ['due', 'top', 'visited', 'reply', 'rest'].map(id => ({ id, rows: rows.filter(r => r.group === id) })), strip: [{ slot: 1, id: 'c1', todo_id: 't5', text: 'Update the pricing deck', company: null, due: '2026-11-25', status: 'open' }, { slot: 2, id: 'c2', todo_id: null, text: 'Book three partner calls', company: null, due: null, status: 'open' }],
    counts: { overdue: rows.filter(r => r.overdue).length }, today: TODAY } };
};
const top = (id, name, band, pin, next) => ({ type: 'employer', id, name, stage: 'contacted', owner: 'Ana', score: 80, band, rank: 1, groups: { heat: 30, fit: 20, impact: 20, recency: 10, pin: 0 }, why: { full: '900 employees · 6 visits this week' }, pin, next });
const TOP = [top('e1', 'Cloudflare', 'P1', { held: false, level: 1, days_left: 21 }, { text: 'Send the pilot terms', due: '2026-11-30' }), top('e2', 'Hilton', 'P2', { held: false, level: 1, days_left: 9 }, null), top('e3', 'Gusto', 'P1', null, null), top('e4', 'Zapier', 'P3', null, null)];
const metric = (key, name, group, source, unit, to_date, goal, nextGoal, extra = {}) => ({ key, name, group, source, unit, kind: 'flow', direction: 'up', this_week: { to_date, goal, progress: goal ? to_date / goal : null, pace: unit === 'count' ? to_date * 7 : null, delta: null, same_point_last_week: null }, last_week: null, series: [], next_week: { week_start: '2026-11-30', goal: nextGoal }, ...extra });
const WEEKLY = { week_start: '2026-11-23', elapsed: { days: 1 }, wording: {}, metrics: [metric('delivered', 'Delivered', 'Outbound', 'Apollo', 'count', 40, 400, 450), metric('replies', 'Replies', 'Outbound', 'Apollo', 'count', 2, null, 12), metric('human_open_rate', 'Human open rate', 'Outbound', 'Apollo', 'rate', 0.21, null, null), metric('total_in_sequence', 'In sequence', 'Outbound', 'Apollo', 'count', 300, 500, 500, { context: true })] };
const calls = [];
const stubReads = () => {
  calls.length = 0;
  salesReads.loadToday = async (sb, b, o = {}) => { calls.push(['today', o.filter?.owner || null, !!o.reviews]); return viewFor(o.filter?.owner || null); };
  salesReads.topTargets = async (sb, b, q) => { calls.push(['top', q.owner || null]); return { status: 200, body: { rows: TOP } }; };
  salesReads.loadWeekly = async () => { calls.push(['weekly']); return { status: 200, body: WEEKLY }; };
  salesReads.listScores = async () => ({ status: 200, body: { rows: [{ type: 'employer', id: 'e1', name: 'Cloudflare', score: 80, band: 'P1', touches: 3, last_touch_at: '2026-11-20T10:00:00Z', last_touch_channel: 'email', owner: 'Ana' }] } });
};
const ctx = { businessId: B, auth, today: TODAY, now: NOW };
const sb = () => fakeSupabase({ businesses: [{ id: B, name: 'Alpha', features: { goals_sales: true } }], sales_call_notes: [{ id: 'n0', business_id: B, title: 'Hilton intro', call_date: '2026-11-19', text: 'Talked about the pilot.', accepted_at: '2026-11-19T20:00:00Z' }], business_anthropic_usage: [] });

test('Stage 0 (f) + G1: the ten asks route right - nine to the agenda, "hot people visiting" still to people_visiting; a capital or a weekday is never a company; no existing intent is taken', () => {
  for (const q of ["what's on the agenda for next week", 'goals for next week', 'what should I focus on this week', 'catch me up', 'our priorities', 'my plan for Monday', "what's going on", 'what matters most right now', 'next week',
    "What's on the agenda for next week?", 'Goals for next week', 'Catch me up', 'Our priorities', 'My plan for Monday', "the team's agenda this week", 'Bo plan for next week']) assert.equal(route(q), 'agenda', q);
  assert.equal(route('hot people visiting'), 'people_visiting');
  // an agenda word inside a question another intent reads stays with that intent
  for (const [q, id] of [['how are we pacing this week', 'weekly'], ['did we hit our goals last week', 'weekly'], ['my tasks this week', 'todos'], ['what is due next week', 'todos'], ['who visited this week', 'visitors'], ['emails this week', 'emails'], ['who replied this week', 'people'], ['Hilton this week', 'brief'], ['top targets this week', 'top_targets']]) assert.equal(route(q), id, q);
  for (const i of salesIntents.filter(x => x.id !== 'agenda')) assert.ok(i.match(parseAsk(i.example, vocab, { today: TODAY })) && !route(i.example).includes('agenda'), i.example);
  assert.equal(salesIntents.find(i => i.id === 'agenda').suggest, true);
});

test('G1: the window is next week (Mon-Sun), the rest of this week, today, tomorrow, a weekday (the next one), else the 7 days ahead', () => {
  const w = q => { const x = agendaWindow(q, TODAY); return [x.from, x.to]; };
  assert.deepEqual(w("what's on the agenda for next week"), ['2026-11-30', '2026-12-06']);
  assert.deepEqual(w('what should I focus on this week'), ['2026-11-23', '2026-11-29']);
  assert.deepEqual(w('my plan for today'), ['2026-11-23', '2026-11-23']);
  assert.deepEqual(w('plan for tomorrow'), ['2026-11-24', '2026-11-24']);
  assert.deepEqual(w('my plan for Monday'), ['2026-11-30', '2026-11-30'], 'today is Monday: the next one');
  assert.deepEqual(w('my plan for thursday'), ['2026-11-26', '2026-11-26']);
  assert.deepEqual(w('catch me up'), ['2026-11-23', '2026-11-29']);
});

test('G1 + G5 + G6: the agenda is ONE request over three imported reads - due by day in the window, the five, pinned + P1 with their next step, this and next week\'s goals, calls to review, replies owed; "my" is mine, "our" the team; no calendar read is said', async () => {
  stubReads();
  const intent = salesIntents.find(i => i.id === 'agenda');
  const run = q => intent.run(sb(), { ...ctx, ask: parseAsk(q, vocab, { today: TODAY }) });
  const r = await run("what's on the agenda for next week");
  assert.deepEqual(calls, [['today', ANA, true], ['top', ANA], ['weekly']], 'three reads, once each, the caller\'s own');
  assert.equal(r.read, 'agenda 2026-11-30 to 2026-12-06 (mine) · goals/today · goals/top-targets · goals/weekly · no calendar read');
  const head = r.items[0];
  assert.match(head.text, /^AGENDA · window next week: Mon 2026-11-30, Tue 2026-12-01, Wed 2026-12-02, Thu 2026-12-03, Fri 2026-12-04, Sat 2026-12-05, Sun 2026-12-06 · today is Mon 2026-11-23 · scope mine · 3 to-dos due in the window · 1 overdue to-dos in all · 3 pinned or P1 companies · 1 calls waiting for review · 2 replies owed · no calendar read: meetings are not in this context$/);
  const by = g => r.items.filter(i => i.group === g);
  assert.deepEqual(by('Due').map(i => i.text), ['Send Cloudflare the pilot terms · open to-do · due Mon 2026-11-30 · mine · company Cloudflare', 'Call the Hilton benefits lead · open to-do · due Tue 2026-12-01 · mine', 'Answer Dana about the rollout · open to-do · due Thu 2026-12-03 · mine · company Cloudflare']);
  assert.deepEqual(by('Due')[0].row, { kind: 'task', id: 't1', text: 'Send Cloudflare the pilot terms', due: '2026-11-30', overdue: false, owner: 'mine', owner_user_id: ANA, link: { entity: 'employers', type: 'employer', id: 'e1', name: 'Cloudflare' }, verb: 'next_steps', steps: null });
  assert.deepEqual(by("This week's five").map(i => [i.entity, i.id]), [['todos', 't5'], ['agenda', 'five:c2']]);
  assert.deepEqual(by('Pinned and P1').map(i => i.title), ['Cloudflare', 'Hilton', 'Gusto']);
  assert.match(by('Pinned and P1')[0].text, / · next step: Send the pilot terms \(due Mon 2026-11-30\)$/); assert.match(by('Pinned and P1')[2].text, / · no next step set$/);
  assert.deepEqual(by('Goals').map(i => i.text), [
    "Delivered (Outbound) · this week (Nov 23–29) to date: 40 · this week's goal 400, 10 % of it · on pace for about 280 by Sunday · next week's (Nov 30–Dec 6) goal 450",
    "Replies (Outbound) · this week (Nov 23–29) to date: 2 · no goal typed for this week · on pace for about 14 by Sunday · next week's (Nov 30–Dec 6) goal 12",
  ], 'only rows with a typed goal this week or next; a context row never');
  assert.deepEqual(by('Calls to review').map(i => i.text), ['Review the Seif call · call 2026-11-20 · unreviewed']);
  assert.deepEqual(by('Replies owed').map(i => [i.entity, i.title]), [['todos', 'Answer Dana about the rollout'], ['people', 'Lee Stone']]);
  assert.match(by('Replies owed')[1].text, /^Reply to Lee Stone · company Marriott · they replied 2026-11-21 · reply read as interested · no to-do answers it yet$/);
  for (const i of r.items) assert.ok(!hasPii(i.text), i.text);
  // G5
  stubReads(); const team = await run('our priorities for next week');
  assert.deepEqual(calls.map(c => c[1] ?? null), [null, null, null]); assert.match(team.items[0].text, /scope the whole team/); assert.ok(team.items.some(i => i.id === 't3'), "Bo's to-do is in the team's week");
  stubReads(); await run('Bo plan for next week'); assert.deepEqual(calls[0], ['today', BO, true]);
  stubReads(); await run('what should I focus on for our goals this week'); assert.equal(calls[0][1], ANA, '"I" wins over "our"');
});

test('G2: the fallback context carries the read set with the tighter caps - due by day (late ones too), the five, pins, goals for this and next week, calls, replies - then notes and companies touched; nothing is grouped', async () => {
  stubReads();
  const s = await salesStanding(sb(), ctx);
  assert.deepEqual(s.reads, ['my to-dos due by 2026-11-29 (2)', "this week's five (2)", 'pinned and P1 companies (3)', 'goals this and next week (2)', 'calls to review (1)', 'replies owed (2)', 'notes since 2026-11-09 (1)', 'companies touched since 2026-11-09 (1)', 'no calendar read']);
  assert.match(s.items[0].text, /^STANDING SUMMARY · window the 7 days ahead: Mon 2026-11-23, /); assert.ok(!s.items.some(i => /^AGENDA/.test(i.text)));
  const texts = s.items.map(i => i.text);
  assert.ok(texts.includes('Chase the signed order form · open to-do · due Wed 2026-11-18 (overdue) · mine · company Cloudflare'), 'a late to-do is due');
  assert.ok(texts.includes('Update the pricing deck · open to-do · due Wed 2026-11-25 · mine'));
  assert.ok(texts.some(t => t.startsWith('Delivered (Outbound) · this week (Nov 23–29) to date: 40 · this week\'s goal 400')) && texts.some(t => t.includes("next week's (Nov 30–Dec 6) goal 12")));
  assert.ok(texts.some(t => t.startsWith('Hilton intro · 2026-11-19')) && texts.some(t => t.startsWith('Cloudflare · employer · score 80 P1')));
  assert.ok(s.items.every(i => !('group' in i)));
  assert.deepEqual([STANDING_CAPS.due, STANDING_CAPS.pins, STANDING_CAPS.calls, AGENDA_CAPS.pins], [20, 5, 5, 10]);
  const many = Array.from({ length: 30 }, (_, i) => todo(`m${i}`, `Thing ${i}`, '2026-11-24'));
  salesReads.loadToday = async () => ({ view: { groups: [{ id: 'due', rows: many }, { id: 'reply', rows: [] }], strip: [], counts: { overdue: 0 } } });
  const capped = await agendaRead(sb(), ctx, { from: TODAY, to: '2026-11-29', label: 'x', whose: ANA, caps: STANDING_CAPS });
  assert.equal(capped.items.filter(i => i.group === 'Due').length, 20); assert.match(capped.head.text, /30 to-dos due in the window \(the first 20 listed\)/);
});

// ── through the ask route, with the sales intents registered on a stub registry
const registry = () => { const r = createRegistry(); r.register('sales', { appliesTo: b => !!b.features?.goals_sales, entities: [], openers: {}, intents: salesIntents, standing: salesStanding, vocabulary: VOCABULARY }); return r; };
const model = text => { const seen = []; askDeps.callAnthropic = async a => { seen.push(a); return { content: [{ type: 'text', text: typeof text === 'function' ? text(a) : text }], usage: { input_tokens: 2000, output_tokens: 200 } }; }; return seen; };
const lab = (content, words) => (new RegExp(`\\[(r\\d+)\\] ${words}`).exec(content) || [])[1];

test('G1 + G3 + G6 through the route: the answer is the model\'s synthesis, the rows ride in their sections (Due · This week\'s five · Pinned and P1 · Goals · Calls to review · Replies owed) cited or not; every number traces; ONE model call, one ask counted', async () => {
  stubReads();
  const db = sb();
  const seen = model(a => { const c = a.messages.at(-1).content; return `Monday: [${lab(c, 'Send Cloudflare the pilot terms')}] is the one dated item. Tuesday: [${lab(c, 'Call the Hilton benefits lead')}].\n\nGoals: Delivered is at 40 against 400 this week [${lab(c, 'Delivered \\(Outbound\\)')}], and next week's goal is 450. There is 1 overdue to-do in all [r1].\n\nI'd push the pilot terms first: [${lab(c, 'Cloudflare · employer')}] is pinned with 21 d left. Meetings are not included: there is no calendar read.`; });
  const r = await ask(db, registry(), { auth, body: { q: "what's on the agenda for next week", scope: B }, now: NOW });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(seen.length, 1); assert.equal(await asksToday({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ gte: async () => ({ count: 1, error: null }) }) }) }) }) }, ANA, NOW), 1);
  assert.equal(seen[0].callType, CALL_TYPE);
  const content = seen[0].messages.at(-1).content;
  assert.match(content, /\[r1\] AGENDA · window next week: Mon 2026-11-30/); assert.ok(!content.includes('No specific read matched'));
  assert.equal(r.body.context_stats.intent, 'agenda');
  assert.deepEqual(r.body.sections.map(s => [s.title, s.count]), [['Due', 3], ["This week's five", 2], ['Pinned and P1', 3], ['Goals', 2], ['Calls to review', 1], ['Replies owed', 2]]);
  assert.deepEqual(r.body.sections[0].rows.map(x => x.title), ['Send Cloudflare the pilot terms', 'Call the Hilton benefits lead', 'Answer Dana about the rollout']);
  assert.equal(r.body.sections[0].rows[0].row.kind, 'task'); assert.equal(r.body.sections[2].rows[0].row.kind, 'company');
  assert.match(r.body.summary, /^Monday: Send Cloudflare the pilot terms is the one dated item\. Tuesday: Call the Hilton benefits lead\./);
  assert.match(r.body.summary, /I'd push the pilot terms first: Cloudflare is pinned with 21 d left\./);
  assert.match(r.body.summary, /Goals: Delivered is at 40 against 400 this week, and next week's goal is 450\. There is 1 overdue to-do in all\./, 'a quiet row is cited without its title in the prose');
  assert.ok(!/Agenda window|· goal/.test(r.body.summary));
  assert.equal(r.body.unverified, undefined, 'a synthesis whose numbers are all in the context is clean'); assert.ok(!/Check:/.test(r.body.summary));
  assert.equal(r.body.try, undefined, 'a matched, full answer offers no Try');
  // an invented number or date is named under the answer (the guard, on a synthesis)
  model(a => `Monday: [${lab(a.messages.at(-1).content, 'Send Cloudflare the pilot terms')}]. Delivered is at 40 of 400, up 37 % on last week, and Dec 15 is the deadline. I'd start with the 3 due items.`);
  const bad = await ask(db, registry(), { auth, body: { q: "what's on the agenda for next week", scope: B }, now: NOW });
  assert.deepEqual(bad.body.unverified, ['37 %', '15']);
  assert.match(bad.body.summary, /\n\nCheck: 37 %, 15 are not in what Scout read\.$/);
  askDeps.callAnthropic = null;
});

test('G3: the guard - a number must be written in the context or the question; a date\'s parts count; commas and leading zeros do not; a small bare count is the model\'s own counting', () => {
  const src = ['[r1] Delivered (Outbound) · this week (Nov 23–29) to date: 1,240 · goal 400, 35 % of it', '[r2] Send the terms · due Mon 2026-12-01 · score 80'];
  assert.deepEqual(unsourcedNumbers('Delivered is 1240 (35 %) against 400. Dec 1 is the day. Three items, 2 of them late, score 80.', src), []);
  assert.deepEqual(unsourcedNumbers('That is 310 % of goal, about $5,000, by Dec 7 or the 14th; 60 delivered.', src), ['310 %', '$5,000', '7', '14', '60']);
  assert.deepEqual(unsourcedNumbers('In 15 minutes', [...src, 'what can I do in 15 minutes']), [], 'the question counts');
  assert.deepEqual(unsourcedNumbers('', src), []);
});

test('G2 + G4: no intent -> the context opens with the standing line and the nearest phrasings, the answer is whatever the model reasons (no scripted shrug), and the body carries three Try phrasings by word overlap; a short answer on a matched ask gets them too', async () => {
  stubReads();
  const db = sb();
  const seen = model('You have two to-dos due this week and a reply owed. Suggestion: clear the late order form first, then the pricing deck, then answer the reply, because the late one blocks the pilot and the other two are quick wins for the week ahead of you.\n\nRead: to-dos, goals, notes.');
  const r = await ask(db, registry(), { auth, body: { q: 'what do we know that is worth doing', scope: B }, now: NOW });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.context_stats.intent, 'none');
  const content = seen[0].messages.at(-1).content;
  assert.match(content, /No specific read matched this question; the context below is the standing summary \(my to-dos due by 2026-11-29 \(2\) · .* · no calendar read\)\. Closer phrasings: /);
  assert.ok(content.includes('this week\'s goal 400') && content.includes('due Wed 2026-11-18 (overdue)'), 'the fallback context carries goals and due-by-day');
  assert.match(r.body.summary, /^You have two to-dos due this week/);
  assert.equal(r.body.try.length, 3);
  assert.deepEqual(r.body.try.slice(0, 2).sort(), ['how are our emails doing this month', 'what do we know about Hilton'], 'the nearest by the words shared, not the fixed first three');
  // pure: overlap first, then the suggest ones, then the list order
  const intents = [{ id: 'a', example: 'my top targets', suggest: true }, { id: 'b', example: 'who visited yesterday', suggest: true }, { id: 'c', example: 'show me my open tasks' }, { id: 'weekly', example: 'how are we pacing this week', title: 'Weekly funnel' }];
  assert.deepEqual(nearExamples('is our pacing fine', intents), ['how are we pacing this week', 'my top targets', 'who visited yesterday']);
  assert.deepEqual(nearExamples('zzz', intents), ['my top targets', 'who visited yesterday', 'show me my open tasks']);
  // a matched ask with a thin answer
  model('Nothing is due.');
  const thin = await ask(db, registry(), { auth, body: { q: 'catch me up', scope: B }, now: NOW });
  assert.equal(thin.body.context_stats.intent, 'agenda'); assert.equal(thin.body.try.length, 3);
  askDeps.callAnthropic = null;
});

test('G2 + G3: SYSTEM - facts only from the context and cited, judgement is Scout\'s and marked; the scripted shrug and "Answer ONLY" are gone; the agenda synthesis is asked for', () => {
  assert.ok(SYSTEM.includes('Every FACT (a record, a number, a date, a name) comes only from the CONTEXT lines in the user message and is cited; your reasoning, grouping, ordering and recommendations are yours: say them plainly, as judgement, not as fact.'));
  assert.ok(SYSTEM.includes('When the context opens with "No specific read matched", answer the question as well as the context allows: reason over it, group it, recommend. End with one line: what was read, and up to three closer phrasings.'));
  assert.ok(SYSTEM.includes('A recommendation line starts with "I\'d" or "Suggestion:"'));
  assert.ok(SYSTEM.includes('When a context line starts with "AGENDA", answer with a synthesis'));
  assert.ok(!SYSTEM.includes('Answer ONLY from the CONTEXT') && !SYSTEM.includes('that nothing in it answers the question'));
  assert.ok(SYSTEM.includes('Never invent a record, a number, a date or a contact detail.'), 'the never-invent line stays');
});
