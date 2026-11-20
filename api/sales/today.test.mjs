// node --test api/sales/today.test.mjs
// actions-v2 Stage 1 - the Today ranking (groups, first fit, order, the overdue fold, virtual reply rows, waiting rows,
// the five strip, chips), the verb picker (never blank), the grounds assembler, steps that cite a ground or are
// dropped, the work route (a draft addressed to the person in ONE call, Prep call, Next steps, Find people with no
// call, the cap, the gated prompt pack), the fixes list and the Scout batches (finish, reply to-dos, assign to the
// company owner, link) undone as one. 0 network, 0 Claude (a mock model), 0 Apollo. Made-up names; no '@' anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { buildToday, pickVerb, nbaOf, badgeCount, sourceOf, VERBS, VERB_IDS, OVERDUE_FOLD, GROUPS, STALE_DAYS } from './todayRank.js';
import { groundsFor, templateSteps, citedSteps, dateTokens, stepsAsk, promptPack, work, ASKS, STEPS_MAX } from './todayWork.js';
import { buildFixes, parseTodayQuery } from './todayRoutes.js';
import { createRegistry } from '../scout/registry.js';
import { plan, act, undo, actDeps } from '../scout/actions.js';
import { register } from './scoutEntities.js';
import { salesWrites } from './scoutVerbs.js';

const B = 'aaaaaaaa-0000-4000-8000-000000000001';
const u = n => `${n}0000000-0000-4000-8000-000000000000`;
const TODAY = '2026-11-19', NOW = Date.parse('2026-11-19T20:00:00Z');
const ANA = u('a'), BO = u('b');
const members = [{ id: ANA, name: 'Ana Member' }, { id: BO, name: 'Bo Member' }];
const CO = { cloud: u('1'), north: u('2'), flow: u('3'), qub: u('4') };
const scores = [
  { type: 'employer', id: CO.cloud, name: 'Cloudflare', score: 65, band: 'P1', pinned: false, stage: 'contacted', last_touch_at: '2026-11-10T10:00:00Z', last_touch_channel: 'email', owner_user_id: ANA },
  { type: 'employer', id: CO.north, name: 'Northrop Grumman', score: 72, band: 'P2', pinned: true, stage: 'target', last_touch_at: null, owner_user_id: BO },
  { type: 'target', id: CO.flow, name: 'Flowserve', score: 40, band: 'P3', pinned: false, stage: 'researching', owner_user_id: null },
  { type: 'employer', id: CO.qub, name: 'Qubika', score: 56, band: 'P2', pinned: false, stage: 'contacted', owner_user_id: ANA },
];
const person = (key, name, co, extra = {}) => ({ key, name, title: 'VP People', buyer: true, company: co ? { type: 'employer', id: co, name: scores.find(s => s.id === co).name } : null, owner_user_id: ANA,
  emails: { sent: 2, opened: 1, clicked: 0, replied: 0, bot_opens: 0 }, last_email: { at: '2026-11-12T10:00:00Z', what: 'opened', reply_class: null }, heat: 48, heat_band: 'hot', ...extra });
const people = [
  person('prospect:p1', 'Dana Mayer', CO.cloud),
  person('prospect:p2', 'Crys Pringle', CO.qub, { emails: { sent: 3, opened: 2, clicked: 1, replied: 1, bot_opens: 0 }, last_email: { at: '2026-11-17T10:00:00Z', what: 'replied', reply_class: 'willing_to_meet' }, heat: 108 }),
  person('prospect:p3', 'Lee Stone', null, { company: { type: 'account', id: null, name: 'Solid Co' }, emails: { sent: 1, opened: 0, clicked: 0, replied: 1, bot_opens: 0 }, last_email: { at: '2026-11-16T10:00:00Z', what: 'replied', reply_class: 'follow_up_question' } }),
  person('person:x9', 'Quiet Person', CO.cloud, { emails: { sent: 0, opened: 0, clicked: 0, replied: 0, bot_opens: 0 }, last_email: null, heat: null, heat_band: null }),
];
const visits = [{ company_key: 'qubika', company_name: 'Qubika', matched_type: 'opportunity', matched_id: CO.qub, visits_7d: 4, last_visit: '2026-11-17', seen_to: '2026-11-18', pulled_on: '2026-11-18', top_paths: [{ path: '/pricing' }] }];
let seq = 0;
const todo = (text, extra = {}) => ({ id: u(String(++seq).padStart(1, '0')).replace(/^./, c => c) && `${String(seq).padStart(8, '0')}-0000-4000-8000-000000000000`, kind: 'todo', status: 'open', text, due_date: null, owner_user_id: ANA, origin: 'manual', link_type: null, link_id: null, person_key: null, created_at: `2026-11-${String(10 + (seq % 9)).padStart(2, '0')}T10:00:00Z`, updated_at: '2026-11-18T10:00:00Z', snooze_until: null, ...extra });
const late = n => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
const flat = v => v.groups.flatMap(g => g.rows);

const TODOS = [
  todo('Send the benefits one-pager', { due_date: late(3), link_type: 'opportunity', link_id: CO.north }),
  todo('Confirm the December demo time', { due_date: TODAY }),
  todo('Old overdue A', { due_date: late(40) }), todo('Old overdue B', { due_date: late(20) }), todo('Old overdue C', { due_date: late(9) }), todo('Old overdue D', { due_date: late(5) }),
  todo('Email the People team', { due_date: '2026-11-20', link_type: 'opportunity', link_id: CO.cloud, person_key: 'prospect:p1' }),
  todo('Find the benefits lead', { link_type: 'target', link_id: CO.flow, owner_user_id: null, origin: 'call_notes' }),
  todo('Follow up after the pricing visit', { link_type: 'opportunity', link_id: CO.qub, owner_user_id: BO }),
  todo('Call Cloudflare about the pilot', { link_type: 'opportunity', link_id: CO.cloud }),
  todo('Draft the partner recap', { origin: 'system' }),
  todo('Ask Flowserve for the org chart', { owner_user_id: null }),
];
const WAITING = [{ id: u('w'), kind: 'waiting', status: 'open', text: 'the signed MSA', waiting_on: 'Pat', link_type: 'partner', link_id: u('9'), owner_user_id: null, due_date: null, created_at: '2026-11-01T10:00:00Z' }];
const base = { todos: TODOS, waiting: WAITING, scores, people, visits, members, today: TODAY };

test('the verb picker is never blank and follows the order: reply -> call words -> person -> company with people -> company with none -> nothing linked', () => {
  const rec = { id: 'x', type: 'employer' };
  assert.equal(pickVerb({ replyOwed: true, company: rec, person: {} }), 'draft_reply');
  assert.equal(pickVerb({ text: 'Prep the Hilton call', company: rec }), 'prep_call');
  assert.equal(pickVerb({ text: 'Book a meeting', company: rec, person: {} }), 'prep_call');
  assert.equal(pickVerb({ text: 'Email them', company: rec, person: {} }), 'draft_email');
  assert.equal(pickVerb({ text: 'Email them', company: rec, companyPeople: 2 }), 'draft_email');
  assert.equal(pickVerb({ text: 'Email them', company: rec, companyPeople: 0 }), 'find_people');
  // no company RECORD: there is no Brief to draft from, whatever the text says
  assert.equal(pickVerb({ text: 'Confirm the demo call' }), 'next_steps');
  assert.equal(pickVerb({ replyOwed: true, person: {}, company: { id: null, name: 'Solid Co' } }), 'next_steps');
  assert.equal(pickVerb({}), 'next_steps');
  const rows = flat(buildToday({ ...base, filter: {} }));
  assert.equal(rows.filter(r => !VERBS[r.verb]).length, 0, 'never blank');
  assert.ok(rows.every(r => VERB_IDS.includes(r.verb)));
});

test('buildToday: five groups, a row once in the first group it fits, earliest due then score then newest, rank numbers run through', () => {
  const v = buildToday({ ...base, filter: {} });
  assert.deepEqual(v.groups.map(g => g.id), GROUPS.map(g => g[0]));
  const by = Object.fromEntries(v.groups.map(g => [g.id, g.rows.map(r => r.text)]));
  // P3: the rows shown come first, the folded overdue rows after them
  assert.deepEqual(by.due, ['Old overdue C', 'Old overdue D', 'Send the benefits one-pager', 'Confirm the December demo time', 'Old overdue A', 'Old overdue B']);
  // Cloudflare is P1; Northrop is pinned but its one to-do is overdue, so it sits in group 1 (first fit)
  assert.deepEqual(by.top, ['Email the People team', 'Call Cloudflare about the pilot']);
  // first fit holds for a virtual row too: Crys replied, and her company visited this week
  assert.deepEqual(by.visited.sort(), ['Follow up after the pricing visit', 'Reply to Crys Pringle']);
  assert.deepEqual(by.reply.sort(), ['Reply to Lee Stone', 'Waiting on Pat: the signed MSA']);
  assert.deepEqual(by.rest.sort(), ['Ask Flowserve for the org chart', 'Draft the partner recap', 'Find the benefits lead'].sort());
  const rows = flat(v);
  assert.equal(new Set(rows.map(r => r.key)).size, rows.length, 'a row appears once');
  // P3: the number is the display order - the shown rows read 1…n, a folded row has no number until the fold opens
  const shownRows = rows.filter(r => !r.folded);
  assert.deepEqual(shownRows.map(r => r.rank), shownRows.map((_, i) => i + 1));
  assert.deepEqual(rows.filter(r => r.folded).map(r => [r.rank, r.rank_open]), [[null, 5], [null, 6]]);
  assert.deepEqual(rows.map(r => r.rank_open), rows.map((_, i) => i + 1));
  assert.equal(rows.find(r => r.text === 'Email the People team').rank, 5);
  assert.equal(v.groups[4].collapsed, true);
  // verbs
  const verb = t => rows.find(r => r.text === t).verb;
  assert.equal(verb('Email the People team'), 'draft_email');
  assert.equal(verb('Call Cloudflare about the pilot'), 'prep_call');
  assert.equal(verb('Find the benefits lead'), 'find_people');
  assert.equal(verb('Confirm the December demo time'), 'next_steps');
  assert.equal(verb('Reply to Crys Pringle'), 'draft_reply');
  assert.equal(verb('Reply to Lee Stone'), 'next_steps', 'a reply from a person with no company record');
  assert.equal(verb('Send the benefits one-pager'), 'find_people', 'Northrop has no stored people');
  // the row's company and person come off the stored rows - nothing recomputed
  const row = rows.find(r => r.text === 'Email the People team');
  assert.deepEqual(row.company, { type: 'employer', id: CO.cloud, key: `employer-${CO.cloud}`, name: 'Cloudflare', score: 65, band: 'P1', pinned: false, owner_user_id: ANA, visits_7d: 0 });
  assert.deepEqual(row.person, { key: 'prospect:p1', name: 'Dana Mayer', title: 'VP People', heat: 48, heat_band: 'hot' });
  assert.equal(rows.find(r => r.text === 'Follow up after the pricing visit').company.visits_7d, 4);
  assert.equal(badgeCount(v), 8);
  assert.ok(!JSON.stringify(v).includes('@'));
});

test('Q1 the overdue fold: every row due today + the 3 most recent overdue; older ones stay in the count behind the fold', () => {
  const due = buildToday({ ...base, filter: {} }).groups[0];
  assert.equal(OVERDUE_FOLD, 3);
  assert.deepEqual(due.fold, { overdue: 5, hidden: 2, oldest_days: 40 });
  assert.deepEqual(due.rows.filter(r => r.folded).map(r => r.text), ['Old overdue A', 'Old overdue B']);
  assert.equal(due.n, 6, 'folded rows still count');
  assert.equal(due.rows.find(r => r.text === 'Confirm the December demo time').folded, undefined);
  const few = buildToday({ ...base, todos: TODOS.slice(0, 2), filter: {} }).groups[0];
  assert.equal(few.fold, null);
});

test('Q6 virtual reply rows + Q2 waiting rows: a reply with an open to-do on that person is not virtual; sources are the nine', () => {
  const v = buildToday({ ...base, filter: {} });
  const reply = flat(v).filter(r => r.kind === 'reply');
  assert.deepEqual(reply.map(r => [r.key, r.virtual, r.id, r.source, r.owner]), [['reply:prospect:p2', true, null, 'reply', 'Ana'], ['reply:prospect:p3', true, null, 'reply', 'Ana']]);
  const answered = buildToday({ ...base, todos: [...TODOS, todo('Reply to Crys', { person_key: 'prospect:p2' })], filter: {} });
  assert.deepEqual(flat(answered).filter(r => r.kind === 'reply').map(r => r.key), ['reply:prospect:p3']);
  assert.equal(flat(answered).find(r => r.text === 'Reply to Crys').verb, 'draft_reply', 'the to-do on a person whose last signal is a reply');
  const w = flat(v).find(r => r.kind === 'waiting');
  assert.deepEqual([w.group, w.source, w.owner_user_id, w.verb], ['reply', 'waiting', null, 'find_people']);
  assert.deepEqual([sourceOf('call_notes'), sourceOf('system'), sourceOf('nudge'), sourceOf('carry_over'), sourceOf(undefined)], ['call_notes', 'manual', 'signal', 'manual', 'manual']);
  assert.deepEqual(Object.keys(v.counts.sources), ['manual', 'scout', 'call_notes', 'signal', 'tidy', 'panel', 'plan', 'reply', 'waiting']);
});

test('chips and the owner filter: Mine / Team / Overdue / Undated counts, the source select, search; parseTodayQuery', () => {
  const mine = buildToday({ ...base, filter: { owner: ANA } });
  assert.deepEqual([mine.counts.mine, mine.counts.team, mine.counts.overdue, mine.counts.undated], [11, 15, 5, 2]);
  assert.equal(flat(mine).every(r => r.owner_user_id === ANA), true);
  assert.deepEqual(flat(buildToday({ ...base, filter: { owner: 'unassigned' } })).map(r => r.text).sort(), ['Ask Flowserve for the org chart', 'Find the benefits lead', 'Waiting on Pat: the signed MSA']);
  assert.equal(flat(buildToday({ ...base, filter: { owner: ANA, chip: 'overdue' } })).length, 5);
  assert.deepEqual(flat(buildToday({ ...base, filter: { chip: 'undated' } })).every(r => !r.due && r.kind === 'todo'), true);
  assert.deepEqual(flat(buildToday({ ...base, filter: { source: 'call_notes' } })).map(r => r.text), ['Find the benefits lead']);
  assert.deepEqual(flat(buildToday({ ...base, filter: { q: 'cloudflare' } })).map(r => r.text), ['Email the People team', 'Call Cloudflare about the pilot']);
  assert.deepEqual(parseTodayQuery({ owner: 'me', chips: 'overdue,snoozed', source: 'reply', q: ' x ' }, ANA), { owner: ANA, chip: 'overdue', snoozed: true, source: 'reply', q: 'x' });
  assert.deepEqual(parseTodayQuery({ owner: 'nope', source: 'nope' }, ANA), { owner: null, chip: null, snoozed: false, source: null, q: '' });
});

test('the five strip: this week\'s commitment rows sit above the list; a slot made from a to-do takes it out of the ranking', () => {
  const five = [{ id: u('f'), kind: 'commitment', status: 'open', text: 'Book two meetings', sort_order: 1, link_type: null, link_id: null }, { id: u('e'), kind: 'commitment', status: 'open', text: 'x', sort_order: 0, link_type: 'todo', link_id: TODOS[6].id }, { id: u('d'), kind: 'commitment', status: 'dropped', text: 'gone', sort_order: 2 }];
  const v = buildToday({ ...base, five, filter: {} });
  assert.deepEqual(v.strip.map(s => [s.slot, s.text, s.company, s.due]), [[1, 'Email the People team', 'Cloudflare', '2026-11-20'], [2, 'Book two meetings', null, null]]);
  assert.deepEqual(v.five, { used: 2, max: 5, can_add: false });
  assert.equal(buildToday({ ...base, five, filter: {}, flags: { data_keys: true } }).five.can_add, true);
  assert.equal(v.strip[0].todo_id, TODOS[6].id);
  assert.equal(flat(v).some(r => r.text === 'Email the People team'), false);
});

test('grounds: stored facts only, one id each, nothing with an address or phone shape; the NBA rule is NBA_RULES over the stored summary', () => {
  const v = buildToday({ ...base, filter: {} }), rows = flat(v);
  const row = rows.find(r => r.text === 'Follow up after the pricing visit');
  const crys = people[1];
  const g = groundsFor({ row, person: crys, visit: visits[0], score: scores[3], pinReason: null, siblings: [], notes: [{ call_date: '2026-11-12', title: 'Intro call', text: 'They asked about the pilot.\nReach me at 415-555-0199' }, { call_date: '2026-11-01', title: null, text: 'Budget resets in January' }] });
  assert.deepEqual(g.map(x => x.id), g.map((_, i) => `G${i + 1}`));
  assert.deepEqual(g.map(x => x.kind), ['visit', 'activity', 'nba', 'heat', 'title', 'stage', 'note', 'note']);
  assert.equal(g[0].text, 'Qubika was on the site: 4 visits in 7 days, last Nov 17; top page /pricing');
  assert.equal(g[1].text, 'Crys Pringle: 3 sent, 2 opened, 1 clicked, 1 replied; last replied Nov 17 (willing to meet)');
  assert.deepEqual([g[2].rule, g[2].text], ['book_meeting', 'Book meeting: Replied willing to meet']);
  assert.equal(g[5].text, 'Qubika is at contacted; no touch recorded');
  assert.ok(!/555/.test(JSON.stringify(g)), 'the phone in the note is scrubbed before it can be a ground');
  assert.deepEqual(nbaOf(people[3]), null, 'no email activity, no rule');
  assert.equal(nbaOf(people[0]).id, 'let_run');
  // pin, sibling to-dos
  const pinned = groundsFor({ row: rows.find(r => r.text === 'Send the benefits one-pager'), score: scores[1], pinReason: 'Brad intro', siblings: [{ text: 'Call them', due: '2026-11-21' }] });
  assert.deepEqual(pinned.map(x => x.text), ['Northrop Grumman is at target; no touch recorded', 'Northrop Grumman is pinned: Brad intro', '1 other open to-do on Northrop Grumman: "Call them" (due Nov 21)']);
  assert.deepEqual(groundsFor({ row: rows.find(r => r.text === 'Draft the partner recap') }), []);
});

test('steps: a template from the matched NBA rule needs no model text; a model step is kept only when it cites ONE real ground - "based on" is the ground\'s text', () => {
  const grounds = [{ id: 'G1', kind: 'visit', text: 'Qubika was on the site: 4 visits in 7 days' }, { id: 'G2', kind: 'nba', rule: 'book_meeting', text: 'Book meeting: Replied willing to meet' }, { id: 'G3', kind: 'nba', rule: 'let_run', text: 'Let sequence run' }];
  const rule = templateSteps(grounds);
  assert.deepEqual(rule, [{ text: 'Book the meeting', ground: 'G2', based_on: 'Book meeting: Replied willing to meet', source: 'rule' }]);
  assert.deepEqual(templateSteps([grounds[2]]), [], 'let_run has no step');
  const steps = citedSteps([
    { text: 'Mention the pricing page they read', ground: 'G1' },
    { text: 'Ask about their Q1 budget', ground: null }, { text: 'Invented step', ground: 'G9' }, { text: 'No ground at all' },
    { text: 'Book the meeting', ground: 'G2' }, { text: 'Write to them at 415-555-0199', ground: 'G1' }, { text: 'Two grounds', ground: ['G1', 'G2'] },
  ], grounds, rule);
  assert.deepEqual(steps, [rule[0], { text: 'Mention the pricing page they read', ground: 'G1', based_on: 'Qubika was on the site: 4 visits in 7 days', source: 'model' }]);
  assert.equal(citedSteps(Array.from({ length: 9 }, (_, i) => ({ text: `Step ${i}`, ground: 'G1' })), grounds).length, STEPS_MAX);
  assert.deepEqual(citedSteps('nonsense', grounds), []);
  assert.match(stepsAsk(grounds, { replyTo: 'Crys Pringle', tone: 'shorter' }), /REPLY, not a first email: Crys Pringle[\s\S]*shorter[\s\S]*\[G1\] Qubika/);
  assert.equal(stepsAsk([]), '');
});

const material = (extra = {}) => { const v = buildToday({ ...base, filter: {} }); return { view: v, todos: TODOS, people, scores, visitOf: c => (c.id === CO.qub ? visits[0] : null), members, ...extra }; };
const auth = { user: { id: ANA, name: 'Ana Member' } };
const sbNotes = () => fakeSupabase({ sales_call_notes: [], sales_opportunities: [{ id: CO.north, business_id: B, pin_reason: 'Brad intro' }], sales_goals: [], sales_targets: [] });
const deps = (over = {}) => {
  const log = [];
  return { log, d: {
    loadToday: async () => material(),
    compose: async (_sb, a) => { log.push(['compose', a.type, a.id, a.person, a.extra.ask]); return { status: 200, body: { draft: { subject: 'An idea for Dana', body: 'Hi Dana,\n\nWorth 15 minutes?\n\nAna', why: 'w' }, lint: { ok: true, issues: [] }, cost_usd: 0.0131, cap: { used: 3, max: 30 }, extra: { steps: [{ text: 'Follow up on the visit', ground: 'G1' }, { text: 'Made up', ground: 'G77' }] } } }; },
    cap: async () => ({ used: 2, max: 30 }),
    brief: async () => ({ status: 200, body: { markdown: '# Brief: Cloudflare\n- [B1] Cloudflare, employer' } }),
    pack: async (_sb, a) => { log.push(['pack', a.records, a.question]); return { text: `Question: ${a.question}\nScope: 2026-11-19 · 1 record\n\n## Cloudflare\n- stage contacted`, records: 1, chars: 80 }; },
    call: async a => { log.push(['call', a.callType, a.model, a.max_tokens, a.system, a.messages[0].content]); return { content: [{ type: 'text', text: JSON.stringify({ brief: 'Open with the pilot.', steps: [{ text: 'Ask about the pilot', ground: 'G1' }, { text: 'Ungrounded' }] }) }], usage: { input_tokens: 900, output_tokens: 120 } }; },
    ...over,
  } };
};
const keyOf = text => flat(material().view).find(r => r.text === text).key;

test('work: Draft email is ONE call (the Write-email call) addressed to the row\'s person, returning the draft and its cited steps; To = name · title · company', async () => {
  const { log, d } = deps();
  const r = await work(sbNotes(), { businessId: B, auth, key: keyOf('Email the People team'), body: {}, now: NOW, deps: d });
  assert.equal(r.status, 200);
  assert.equal(r.body.verb, 'draft_email');
  const calls = log.filter(l => l[0] === 'compose');
  assert.equal(calls.length, 1); assert.equal(log.filter(l => l[0] === 'call').length, 0);
  assert.deepEqual(calls[0].slice(1, 4), ['employer', CO.cloud, { person_key: 'prospect:p1', name: 'Dana Mayer', title: 'VP People' }]);
  assert.match(calls[0][4], /GROUNDS[\s\S]*\[G1\] Dana Mayer: 2 sent, 1 opened/);
  assert.deepEqual(r.body.draft, { to: { name: 'Dana Mayer', title: 'VP People', company: 'Cloudflare' }, tone: null, subject: 'An idea for Dana', body: 'Hi Dana,\n\nWorth 15 minutes?\n\nAna', lint: { ok: true, issues: 0 } });
  assert.deepEqual(r.body.steps.map(s => [s.text, s.ground, s.source]), [['Follow up on the visit', 'G1', 'model']]);
  assert.equal(r.body.steps[0].based_on, r.body.grounds[0].text);
  assert.deepEqual(r.body.usage, { calls: 1, cost_usd: 0.0131, cap: { used: 3, max: 30 } });
  assert.deepEqual(r.body.prompt_pack.asks.map(a => a.id), ASKS.map(a => a[0]));
  assert.ok(r.body.prompt_pack.asks.every(a => a.text.startsWith(`Question: ${ASKS.find(x => x[0] === a.id)[2]}`) && a.chars === a.text.length));
  assert.ok(!JSON.stringify(r.body).includes('@'));
  // tone rides in the same call
  const warm = await work(sbNotes(), { businessId: B, auth, key: keyOf('Email the People team'), body: { tone: 'warmer' }, now: NOW, deps: d });
  assert.equal(warm.body.draft.tone, 'warmer'); assert.match(log.filter(l => l[0] === 'compose')[1][4], /warmer/);
  assert.equal((await work(sbNotes(), { businessId: B, auth, key: keyOf('Email the People team'), body: { tone: 'louder' }, now: NOW, deps: d })).status, 400);
});

test('work: a draft or a pack that holds an address or phone shape is withheld with the reason; the cap and a missing row are said plainly', async () => {
  const leaky = deps({
    compose: async () => ({ status: 200, body: { draft: { subject: 'Hi', body: 'Call me on 415-555-0199', why: '' }, cost_usd: 0.01, cap: { used: 3, max: 30 }, extra: null } }),
    pack: async () => ({ blocked: true }),
  });
  const r = await work(sbNotes(), { businessId: B, auth, key: keyOf('Email the People team'), body: {}, now: NOW, deps: leaky.d });
  assert.deepEqual(r.body.draft, { to: { name: 'Dana Mayer', title: 'VP People', company: 'Cloudflare' }, tone: null, withheld: true, reason: 'Draft withheld: it held an address or phone shape. Try again.' });
  assert.deepEqual(r.body.prompt_pack, { blocked: true, reason: 'Not copied: the pack still held an address or phone shape.' });
  assert.equal(r.body.note, 'Nothing to suggest beyond the draft.');
  assert.deepEqual(promptPack({ text: 'Question: q\nReach 415-555-0199', records: 1 }).asks.map(a => a.blocked), [true, true, true]);
  const capped = deps({ compose: async () => ({ status: 429, body: { error: 'Write email cap reached (30 per day for this workspace)', used: 30, max: 30 } }) });
  assert.equal((await work(sbNotes(), { businessId: B, auth, key: keyOf('Email the People team'), body: {}, now: NOW, deps: capped.d })).status, 429);
  assert.equal((await work(sbNotes(), { businessId: B, auth, key: 'todo:nope', body: {}, now: NOW, deps: deps().d })).status, 404);
  assert.equal((await work(sbNotes(), { businessId: B, auth, key: keyOf('Email the People team'), body: { verb: 'sing' }, now: NOW, deps: deps().d })).status, 400);
});

test('work: Prep call = one call with the Brief + grounds; Next steps = one call, steps only - none at all when nothing is stored; Find people = no call; no record = 422', async () => {
  const { log, d } = deps();
  const prep = await work(sbNotes(), { businessId: B, auth, key: keyOf('Call Cloudflare about the pilot'), body: {}, now: NOW, deps: d });
  assert.equal(prep.body.verb, 'prep_call');
  const call = log.find(l => l[0] === 'call');
  assert.deepEqual([call[1], call[3]], ['intent_compose', 900]);
  assert.match(call[4], /"brief"/); assert.match(call[5], /# Brief: Cloudflare[\s\S]*GROUNDS[\s\S]*The to-do: Call Cloudflare about the pilot/);
  assert.deepEqual(prep.body.brief, { text: 'Open with the pilot.' });
  assert.deepEqual(prep.body.steps.map(s => s.text), ['Ask about the pilot']);
  assert.equal(prep.body.usage.calls, 1); assert.deepEqual(prep.body.usage.cap, { used: 3, max: 30 }); assert.equal(typeof prep.body.usage.cost_usd, 'number');
  assert.equal(log.filter(l => l[0] === 'compose').length, 0);
  // Next steps on a row with nothing stored: no call
  log.length = 0;
  const none = await work(sbNotes(), { businessId: B, auth, key: keyOf('Draft the partner recap'), body: {}, now: NOW, deps: d });
  assert.deepEqual([none.status, none.body.verb, none.body.steps, none.body.usage.calls, none.body.prompt_pack], [200, 'next_steps', [], 0, null]);
  assert.match(none.body.note, /Nothing stored/); assert.equal(log.filter(l => l[0] !== 'pack').length, 0);
  // Next steps asked on a row with grounds: one call, steps only
  const next = await work(sbNotes(), { businessId: B, auth, key: keyOf('Email the People team'), body: { verb: 'next_steps' }, now: NOW, deps: d });
  assert.equal(next.body.brief, undefined); assert.equal(next.body.draft, undefined); assert.equal(next.body.usage.calls, 1);
  assert.doesNotMatch(log.find(l => l[0] === 'call')[4], /"brief"/);
  // Find people: stored people at the company that no open to-do names, hottest first; no call
  log.length = 0;
  const find = await work(sbNotes(), { businessId: B, auth, key: keyOf('Email the People team'), body: { verb: 'find_people' }, now: NOW, deps: d });
  assert.deepEqual(find.body.people, [{ key: 'person:x9', name: 'Quiet Person', title: 'VP People', heat: null, heat_band: null, buyer: true }], 'Dana is on an open to-do already');
  assert.equal(log.filter(l => l[0] === 'call' || l[0] === 'compose').length, 0);
  // the Draft button on a found person addresses that person; a person from another company is refused
  await work(sbNotes(), { businessId: B, auth, key: keyOf('Email the People team'), body: { verb: 'draft_email', person: { key: 'person:x9' } }, now: NOW, deps: d });
  assert.equal(log.find(l => l[0] === 'compose')[3].name, 'Quiet Person');
  assert.equal((await work(sbNotes(), { businessId: B, auth, key: keyOf('Email the People team'), body: { verb: 'draft_email', person: { key: 'prospect:p2' } }, now: NOW, deps: d })).status, 400);
  assert.equal((await work(sbNotes(), { businessId: B, auth, key: keyOf('Confirm the December demo time'), body: { verb: 'draft_email' }, now: NOW, deps: d })).status, 422);
  // the cap stops Prep call before any call
  const full = deps({ cap: async () => ({ used: 30, max: 30 }) });
  assert.equal((await work(sbNotes(), { businessId: B, auth, key: keyOf('Call Cloudflare about the pilot'), body: {}, now: NOW, deps: full.d })).status, 429);
  assert.equal(full.log.filter(l => l[0] === 'call').length, 0);
});

test('A4 fixes: worst first, never more than five, a failed feed on top; each button is a Scout verb with its rows (25 at most)', () => {
  const team = buildToday({ ...base, filter: {} }), mine = { groups: [{ rows: flat(team).filter(r => r.owner_user_id === ANA) }] };
  const records = [{ type: 'target', id: CO.flow, name: 'Flowserve' }, { type: 'opportunity', id: CO.cloud, name: 'Cloudflare' }];
  const f = buildFixes({ team, mine, todos: TODOS, records, feeds: [{ id: 'apollo', label: 'Apollo sync', failed: false, line: 'ok' }] });
  assert.deepEqual(f.items.map(i => [i.id, i.n, i.action?.verb, i.action?.rows.length]), [['replies', 2, 'reply_todos', 2], ['unowned', 2, 'assign_owner', 2], ['unlinked', 7, 'link_named', 1], ['undated', 2, 'task_due', 2]]);
  assert.equal(f.n, 4, 'a healthy feed does not count');
  assert.equal(f.items[0].title, '2 replies have no to-do'); assert.equal(f.items[0].action.label, 'Add 2 to-dos');
  assert.deepEqual(f.items[0].action.rows[0], { entity: 'people', id: 'prospect:p2', title: 'Crys Pringle', company: { type: 'employer', id: CO.qub, name: 'Qubika' } });
  assert.match(f.items[2].note, /1 name a company in their text/);
  assert.equal(f.items[3].action.needs, 'date');
  const bad = buildFixes({ team, mine, todos: TODOS, records, feeds: [{ id: 'apollo', label: 'Apollo sync', failed: true, line: 'timed out' }, { id: 'visitors', label: 'Site visitors', failed: true, line: 'no pull' }] });
  assert.deepEqual(bad.items.map(i => i.id), ['feed:apollo', 'feed:visitors', 'replies', 'unowned', 'unlinked']);
  assert.equal(bad.n, 5);
  assert.ok(!JSON.stringify(f).includes('@'));
});

// --- the Scout batches -------------------------------------------------------------------------------------------
const ana = { user: { id: ANA, name: 'Ana', email: 'x' }, isPlatformOwner: false, roles: new Map([[B, 'member']]) };
const seed = todos => fakeSupabase({
  businesses: [{ id: B, name: 'Alpha', features: { goals_sales: true } }],
  business_members: [{ business_id: B, user_id: ANA, name: 'Ana Member', role: 'member' }, { business_id: B, user_id: BO, name: 'Bo Member', role: 'member' }],
  sales_goals: [],
  sales_opportunities: [{ id: CO.cloud, business_id: B, organization: 'Cloudflare', owner_user_id: BO, stage: 'contacted', fit_level: null, archived_at: null }, { id: CO.qub, business_id: B, organization: 'Qubika', owner_user_id: null, stage: 'contacted', fit_level: null, archived_at: null }],
  sales_targets: [],
  sales_prospect_state: [{ business_id: B, contact_id: 'p1', name: 'Dana Mayer', status: 'new', snooze_until: null, opportunity_id: CO.cloud, goal_id: null }, { business_id: B, contact_id: 'p2', name: 'Crys Pringle', status: 'contacted', snooze_until: null, opportunity_id: CO.qub, goal_id: null }],
  sales_week_goals: todos.map(t => ({ ...t, business_id: B })),
});
let MIGRATED = false;
const fakeWrites = todos => {
  const log = [];
  Object.assign(salesWrites, {
    dataKeys: async () => MIGRATED,
    weekGoalCreate: async ({ body }) => { log.push(['weekGoalCreate', body.kind, body.link_type, body.link_id, body.text, body.week_start]); return { status: 201, body: { goal: { id: 'slot-new' } } }; },
    weekGoalUpdate: async ({ params, body }) => { log.push(['weekGoalUpdate', params.id, body.status, body.expect || null]); return { status: 200, body: { goal: {} } }; },
    todoLoad: async (_sb, _b, id) => todos.find(x => x.id === id) || null,
    todo: async (_sb, a) => { log.push(['todo', a.todoId, a.patch, a.kind, a.expect, a.origin, a.batchId]); return { todo: {}, event: { id: `ev-${log.length}` } }; },
    todoEventUndo: async (_sb, a) => { log.push(['todoEventUndo', a.eventId]); return {}; },
    todoOn: async (_sb, a) => { log.push(['todoOn', a.type, a.id, a.text, a.dueDate, a.origin, a.personKey, a.batchId]); return { id: 'new', event_id: `ev-${log.length}` }; },
    prospect: async ({ params, body }) => { log.push(['prospect', params.contactId, body.status, body.expect]); return { status: 200, body: {} }; },
    linkable: async () => [{ type: 'opportunity', id: CO.cloud, name: 'Cloudflare' }, { type: 'opportunity', id: CO.qub, name: 'Qubika' }],
  });
  return log;
};
const trow = t => ({ entity: 'todos', id: t.id, title: t.text });
const run = async (sb, registry, body) => { const p = await plan(sb, registry, { auth: ana, body: { scope: B, ...body } }); return { p, a: p.body.plan_id ? await act(sb, registry, { auth: ana, body: { plan_id: p.body.plan_id } }) : null }; };
actDeps.now = () => NOW;

test('A3 "Done and mark contacted": one card row, the to-do done through applyTodo and the person\'s status with no stage move, ONE Undo puts both back', async () => {
  const withPerson = TODOS[6], plain = TODOS[9];
  const sb = seed(TODOS), registry = createRegistry(); await register(registry);
  const log = fakeWrites(TODOS);
  const r = await run(sb, registry, { verb: 'task_finish', rows: [trow(withPerson), trow(plain)], keys: [`todos:${withPerson.id}`, `todos:${plain.id}`] });
  assert.deepEqual(r.p.body.rows.map(x => [x.title, x.from, x.to, x.note]), [
    ['Email the People team', 'open', 'done · Dana Mayer contacted', "the company's stage is unchanged"],
    ['Call Cloudflare about the pilot', 'open', 'done', 'no person on this to-do - marked done only'],
  ]);
  assert.deepEqual(log.map(l => l[0]), ['todo', 'prospect', 'todo']);
  assert.deepEqual(log[0].slice(1), [withPerson.id, { status: 'done' }, 'done', { status: 'open' }, 'scout', r.p.body.plan_id]);
  assert.deepEqual(log[1], ['prospect', 'p1', 'contacted', { status: 'new' }]);
  assert.equal(new Set(log.filter(l => l[0] === 'todo').map(l => l[6])).size, 1, 'one batch id');
  assert.equal(r.a.body.line, 'Finished 2 of 2'); assert.equal(r.a.body.can_undo, true);
  log.length = 0;
  const back = await undo(sb, registry, { auth: ana, body: { plan_id: r.p.body.plan_id } });
  assert.equal(back.body.line, 'undone');
  assert.deepEqual(log.map(l => l[0]), ['prospect', 'todoEventUndo', 'todoEventUndo']);
  assert.deepEqual(log[0], ['prospect', 'p1', 'new', { status: 'contacted' }]);
});

test('Q6 reply to-dos, A4 assign to the company owner and link the named company: each a card, each one batch, each undone as one', async () => {
  const sb = seed(TODOS), registry = createRegistry(); await register(registry);
  const log = fakeWrites(TODOS);
  // reply to-dos: one per person, the person key and the company record; a person with no record is still added, unlinked
  let r = await run(sb, registry, { verb: 'reply_todos', rows: [{ entity: 'people', id: 'prospect:p2', title: 'Crys Pringle' }, { entity: 'people', id: 'prospect:p9', title: 'Lee Stone' }], keys: ['people:prospect:p2', 'people:prospect:p9'] });
  assert.deepEqual(r.p.body.rows.map(x => [x.title, x.to, x.note]), [['Crys Pringle', `open to-do · due ${TODAY}`, 'linked to Qubika'], ['Lee Stone', `open to-do · due ${TODAY}`, 'no company record']]);
  assert.deepEqual(log, [['todoOn', 'employer', CO.qub, 'Reply to Crys Pringle', TODAY, 'scout', 'prospect:p2', r.p.body.plan_id], ['todoOn', null, null, 'Reply to Lee Stone', TODAY, 'scout', 'prospect:p9', r.p.body.plan_id]]);
  log.length = 0;
  await undo(sb, registry, { auth: ana, body: { plan_id: r.p.body.plan_id } });
  assert.deepEqual(log.map(l => l[0]), ['todoEventUndo', 'todoEventUndo']);
  // assign: the company's owner per row; no company or no owner = listed and left Unassigned
  log.length = 0;
  const unowned = [{ ...TODOS[7], link_type: 'opportunity', link_id: CO.cloud }, { ...TODOS[11] }, { ...TODOS[8], owner_user_id: null }];
  fakeWrites(unowned).length = 0;
  const log2 = fakeWrites(unowned);
  r = await run(sb, registry, { verb: 'assign_owner', rows: unowned.map(trow), keys: unowned.map(t => `todos:${t.id}`) });
  assert.deepEqual(r.p.body.rows.map(x => [x.from, x.to, x.skipped, x.note]), [['Unassigned', 'Bo', null, "Cloudflare's owner"], ['Unassigned', 'Unassigned', 'no company to take an owner from', null], ['Unassigned', 'Unassigned', 'Qubika has no owner', null]]);
  assert.deepEqual(log2, [['todo', unowned[0].id, { owner_user_id: BO }, 'reassign', { owner_user_id: null }, 'scout', r.p.body.plan_id]]);
  assert.equal(r.a.body.line, 'Assigned 1 · 2 skipped');
  // link: exactly one record named
  const loose = [{ ...TODOS[9], link_type: null, link_id: null }, { ...TODOS[10] }, { ...TODOS[1], text: 'Compare Cloudflare and Qubika' }];
  const log3 = fakeWrites(loose);
  r = await run(sb, registry, { verb: 'link_named', rows: loose.map(trow), keys: loose.map(t => `todos:${t.id}`) });
  assert.deepEqual(r.p.body.rows.map(x => [x.to, x.skipped]), [['Cloudflare', null], ['no company', 'names no company'], ['no company', 'names more than one company']]);
  assert.deepEqual(log3, [['todo', loose[0].id, { link_type: 'opportunity', link_id: CO.cloud }, 'link', { link_type: null, link_id: null }, 'scout', r.p.body.plan_id]]);
});

test('A6 Scout opens the work panel on a to-do row: "draft the email for the first one", "what should I do next on #2", "prep me for ..."; with no to-do pointed at it stays a question', async () => {
  const sb = seed(TODOS), registry = createRegistry(); await register(registry);
  fakeWrites(TODOS);
  const rows = [trow(TODOS[6]), trow(TODOS[9])];
  const go = text => plan(sb, registry, { auth: ana, body: { scope: B, text, rows } });
  let r = await go('draft the email for the first one');
  assert.deepEqual(r.body.open, { panel: 'today_work', key: `todo:${TODOS[6].id}`, verb: 'draft_email' }); assert.equal(r.body.plan_id, undefined);
  r = await go('what should I do next on #2');
  assert.deepEqual(r.body.open, { panel: 'today_work', key: `todo:${TODOS[9].id}`, verb: 'next_steps' });
  r = await go('prep me for the second one');
  assert.deepEqual(r.body.open, { panel: 'today_work', key: `todo:${TODOS[9].id}`, verb: 'prep_call' });
  assert.deepEqual((await go('what should I do next')).body, { command: false }, 'no to-do named: the ask answers it');
  assert.deepEqual((await plan(sb, registry, { auth: ana, body: { scope: B, text: 'what should I do next on #1', rows: [] } })).body, { command: false });
});

test('R3 reply to-dos carry origin reply once the data-keys migration has run; R2 This week\'s five: add and remove are verbs behind the same flag, each undone', async () => {
  const slot = { id: u('5'), business_id: B, kind: 'commitment', status: 'open', week_start: '2026-11-16', text: 'Email the People team', link_type: 'todo', link_id: TODOS[6].id };
  const sb = fakeSupabase({ businesses: [{ id: B, name: 'Alpha', features: { goals_sales: true } }], business_members: [{ business_id: B, user_id: ANA, name: 'Ana Member', role: 'member' }], sales_goals: [], sales_opportunities: [], sales_targets: [], sales_prospect_state: [], sales_week_goals: [...TODOS.map(t => ({ ...t, business_id: B })), slot] });
  const registry = createRegistry(); await register(registry);
  const log = fakeWrites(TODOS);
  // before the migration: both five verbs say why, and nothing is planned
  let r = await run(sb, registry, { verb: 'five_add', rows: [trow(TODOS[9])], keys: [`todos:${TODOS[9].id}`] });
  assert.match(r.p.body.cant.reason, /data-keys database update/); assert.equal(r.a, null);
  r = await run(sb, registry, { verb: 'five_remove', rows: [trow(TODOS[6])], keys: [`todos:${TODOS[6].id}`] });
  assert.match(r.p.body.cant.reason, /data-keys database update/);
  assert.equal(log.length, 0);
  MIGRATED = true;
  try {
    r = await run(sb, registry, { verb: 'reply_todos', rows: [{ entity: 'people', id: 'prospect:p9', title: 'Lee Stone' }], keys: ['people:prospect:p9'] });
    assert.equal(log[0][5], 'reply');
    log.length = 0;
    // add: a to-do already in the five is skipped; the other becomes a commitment row that links it
    r = await run(sb, registry, { verb: 'five_add', rows: [trow(TODOS[6]), trow(TODOS[9])], keys: [`todos:${TODOS[6].id}`, `todos:${TODOS[9].id}`] });
    assert.deepEqual(r.p.body.rows.map(x => [x.title, x.to, x.skipped]), [['Email the People team', "this week's five", 'already one of the five'], ['Call Cloudflare about the pilot', "this week's five", null]]);
    assert.deepEqual(log, [['weekGoalCreate', 'commitment', 'todo', TODOS[9].id, 'Call Cloudflare about the pilot', '2026-11-16']]);
    log.length = 0;
    await undo(sb, registry, { auth: ana, body: { plan_id: r.p.body.plan_id } });
    assert.deepEqual(log, [['weekGoalUpdate', 'slot-new', 'dropped', null]]);
    log.length = 0;
    // remove: the slot's row is dropped (never deleted); Undo opens it again
    r = await run(sb, registry, { verb: 'five_remove', rows: [trow(TODOS[6]), trow(TODOS[9])], keys: [`todos:${TODOS[6].id}`, `todos:${TODOS[9].id}`] });
    assert.deepEqual(r.p.body.rows.map(x => [x.from, x.to, x.skipped]), [["this week's five", 'the list', null], [null, null, 'not one of the five']]);
    assert.deepEqual(log, [['weekGoalUpdate', slot.id, 'dropped', { status: 'open' }]]);
    log.length = 0;
    await undo(sb, registry, { auth: ana, body: { plan_id: r.p.body.plan_id } });
    assert.deepEqual(log, [['weekGoalUpdate', slot.id, 'open', null]]);
  } finally { MIGRATED = false; }
});

test('R1 bulk drop: an Everything-else to-do untouched for 30+ days is marked stale; a dated or recent row is not', () => {
  const old = { ...TODOS[10], created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-05T10:00:00Z' };
  const v = buildToday({ ...base, todos: [old, { ...TODOS[11], created_at: '2026-11-10T10:00:00Z', updated_at: null }, TODOS[1]], filter: {} });
  assert.equal(STALE_DAYS, 30);
  assert.deepEqual(v.groups[4].rows.map(r => [r.text, r.stale]), [['Ask Flowserve for the org chart', false], ['Draft the partner recap', true]]);
  assert.equal(flat(v).find(r => r.text === 'Confirm the December demo time').stale, undefined);
});

test('D38 a failed call still answers with what needed no call: the row, the grounds, the rule\'s step and the prompt pack', async () => {
  const sb = fakeSupabase({ sales_call_notes: [], sales_opportunities: [] });
  const view = buildToday({ ...base, filter: {} });
  const deps = { loadToday: async () => ({ view, todos: TODOS, people, scores, visitOf: () => null, members }), pack: async () => ({ text: 'Question: q\nCloudflare · employer', records: [{ type: 'employer' }] }),
    compose: async () => { throw new Error('timeout'); }, cap: async () => ({ used: 0, max: 30 }), brief: async () => ({ status: 200, body: { markdown: 'Brief' } }), call: async () => { throw new Error('timeout'); } };
  const key = flat(view).find(r => r.text === 'Email the People team').key;
  const r = await work(sb, { businessId: B, auth: ana, key, body: {}, now: NOW, deps });
  assert.equal(r.status, 502); assert.match(r.body.error, /The draft failed: timeout/);
  assert.equal(r.body.prompt_pack.asks.length, ASKS.length); assert.ok(r.body.grounds.length > 0); assert.equal(r.body.draft, undefined);
  const prep = await work(sb, { businessId: B, auth: ana, key: flat(view).find(x => x.text === 'Call Cloudflare about the pilot').key, body: {}, now: NOW, deps });
  assert.equal(prep.status, 502); assert.equal(prep.body.prompt_pack.asks.length, ASKS.length);
});

test('C2 steps carry no invented dates: a step naming a date its own ground does not name is dropped (the "by Nov 16" case); a date the ground names is kept in any spelling', () => {
  const grounds = [
    { id: 'G1', kind: 'note', text: 'Call note Nov 12 (Intro call): they want pricing for 400 employees and a second call' },
    { id: 'G2', kind: 'nba', text: 'Reply today: Replied with a follow-up question', rule: 'reply_today' },
    { id: 'G3', kind: 'stage', text: 'Acme is at contacted; last touch Nov 9 by email' },
    { id: 'G4', kind: 'todos', text: '1 other open to-do on Acme: "Send the deck" (due Nov 21)' },
  ];
  const kept = raw => citedSteps(raw, grounds).map(s => s.text);
  assert.deepEqual(kept([{ text: 'Send the pricing proposal by Nov 16', ground: 'G1' }]), [], 'Nov 16 is in no ground: the model made it up');
  assert.deepEqual(kept([
    { text: 'Send the pricing they asked for on the Nov 12 call', ground: 'G1' },
    { text: 'Answer the follow-up question today', ground: 'G2' },
    { text: 'Book the second call for Thursday', ground: 'G1' },
    { text: 'Follow up tomorrow morning', ground: 'G2' },
    { text: 'Send the deck before it is due on November 21st', ground: 'G4' },
    { text: 'Check in again next week', ground: 'G3' },
    { text: 'Reference the 11/9 email when you write', ground: 'G3' },
    { text: 'Send the deck by 2026-11-21', ground: 'G3' },
    { text: 'Ask who else joins the second call', ground: 'G1' },
  ]).slice(0, 9), ['Send the pricing they asked for on the Nov 12 call', 'Answer the follow-up question today', 'Send the deck before it is due on November 21st', 'Reference the 11/9 email when you write', 'Ask who else joins the second call'].slice(0, STEPS_MAX));
  // the date must be in the step's OWN ground, not just any ground
  assert.deepEqual(kept([{ text: 'Send it by Nov 21', ground: 'G1' }]), []);
  assert.deepEqual([...dateTokens('by November 16th, or Tues 11/18; in 3 days, end of the month, next week, in December')].sort(), ['dec', 'edge of month', 'in 3 day', 'next week', 'nov 16', 'nov 18', 'tuesday']);
  assert.deepEqual([...dateTokens('Ask for 400 seats, step 2 of 3, a may-be and the March of Dimes')], []);
});
