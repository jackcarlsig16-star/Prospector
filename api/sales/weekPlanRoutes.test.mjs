// node --test api/sales/weekPlanRoutes.test.mjs  (react-scripts' Jest only runs src/)
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblePlanContext } from './weekPlanContext.js';
import { toPlanProposals, proposeWeekPlanRoute, saveWeekPlanRoute, planDeps, FOCUS_CAP, DAILY_PROPOSE_CAP } from './weekPlanRoutes.js';

const BIZ = '00000000-0000-4000-8000-0000000000b1';
const JACK = '00000000-0000-4000-8000-00000000000a', CYRUS = '00000000-0000-4000-8000-00000000000c';
const WEEK = '2026-10-12', LAST = '2026-10-05';
const NOW = Date.parse('2026-10-13T18:00:00Z');
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ── A minimal in-memory Supabase: just the query shapes these routes use ────
function fakeSupabase(tables) {
  const db = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map(r => ({ ...r }))]));
  const log = [];
  const from = table => {
    db[table] ||= [];
    const filters = [];
    let op = 'select', payload = null, single = null, head = false, limit = null, wantRows = false;
    const q = {
      select(_cols, opts) { if (op === 'select') head = !!opts?.head; else wantRows = true; return q; },
      insert(rows) { op = 'insert'; payload = Array.isArray(rows) ? rows : [rows]; return q; },
      update(patch) { op = 'update'; payload = patch; return q; },
      delete() { op = 'delete'; return q; },
      eq(k, v) { filters.push(r => r[k] === v); return q; },
      neq(k, v) { filters.push(r => r[k] !== v); return q; },
      in(k, vs) { filters.push(r => vs.includes(r[k])); return q; },
      is(k, v) { filters.push(r => (r[k] ?? null) === v); return q; },
      not(k, _op, v) { filters.push(r => (r[k] ?? null) !== v); return q; },
      gte(k, v) { filters.push(r => r[k] >= v); return q; },
      lte(k, v) { filters.push(r => r[k] <= v); return q; },
      order() { return q; },
      limit(n) { limit = n; return q; },
      maybeSingle() { single = 'maybe'; return q; },
      single() { single = 'one'; return q; },
      then(resolve, reject) { try { resolve(run()); } catch (e) { reject(e); } },
    };
    const run = () => {
      const match = r => filters.every(f => f(r));
      let rows;
      if (op === 'insert') {
        rows = payload.map(r => ({ id: uid(1000 + db[table].length + log.length), created_at: new Date(NOW).toISOString(), ...r }));
        db[table].push(...rows);
      } else if (op === 'update') {
        rows = db[table].filter(match);
        for (const r of rows) Object.assign(r, payload);
      } else if (op === 'delete') {
        rows = db[table].filter(match);
        db[table] = db[table].filter(r => !match(r));
      } else rows = db[table].filter(match);
      log.push({ table, op, n: rows.length });
      if (head) return { count: rows.length, error: null };
      if (limit != null) rows = rows.slice(0, limit);
      const data = rows.map(r => ({ ...r }));
      if (single === 'one') return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: `expected 1 row, got ${data.length}` } };
      if (single === 'maybe') return { data: data[0] ?? null, error: null };
      return { data: op === 'select' || wantRows ? data : null, error: null };
    };
    return q;
  };
  return { from, db, log };
}

function call(handler, body, { userId = JACK } = {}) {
  return new Promise(resolve => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); } };
    handler({ params: { businessId: BIZ }, body, query: {}, auth: { user: { id: userId } } }, res);
  });
}

const members = [{ id: uid(1), business_id: BIZ, user_id: JACK }, { id: uid(2), business_id: BIZ, user_id: CYRUS }];

// ── Context builder ─────────────────────────────────────────────────────────
function planData(over = {}) {
  const partners = Array.from({ length: 70 }, (_, i) => ({ id: uid(100 + i), name: `Partner ${i}`, owner_user_id: JACK, tier: '2', pipeline_status: i < 3 ? 'meeting_set' : 'first_email_sent' }));
  return {
    goals: [
      { id: uid(20), kind: 'commitment', text: 'Close Upside pilot', status: 'open', owner_user_id: JACK, week_start: WEEK, created_at: '2026-10-12T16:00:00Z', steps: [] },
      { id: uid(21), kind: 'todo', text: 'Send Solidcore deck', status: 'open', owner_user_id: JACK, week_start: WEEK, due_date: '2026-10-14', created_at: '2026-10-12T16:00:00Z', steps: [] },
      { id: uid(22), kind: 'todo', text: 'Undated idea', status: 'open', owner_user_id: JACK, week_start: WEEK, due_date: null, created_at: '2026-10-01T16:00:00Z', steps: [] },
      { id: uid(23), kind: 'todo', text: 'Cyrus thing', status: 'open', owner_user_id: CYRUS, week_start: WEEK, created_at: '2026-10-12T16:00:00Z', steps: [] },
      { id: uid(24), kind: 'todo', text: 'Old copy', status: 'open', owner_user_id: JACK, week_start: LAST, created_at: '2026-10-05T16:00:00Z', steps: [] },
      { id: uid(25), kind: 'todo', text: 'Old copy', status: 'open', owner_user_id: JACK, week_start: WEEK, carried_from_id: uid(24), created_at: '2026-10-05T16:00:00Z', steps: [] },
      { id: uid(26), kind: 'todo', text: 'Flag: call Ana', status: 'open', owner_user_id: JACK, week_start: WEEK, prospect_contact_id: 'c1', flag_note: 'asked for pricing', created_at: '2026-10-12T16:00:00Z', steps: [] },
      { id: uid(27), kind: 'commitment', text: 'Last week done', status: 'done', owner_user_id: JACK, week_start: LAST, created_at: '2026-10-05T16:00:00Z', steps: [] },
      { id: uid(28), kind: 'commitment', text: 'Last week missed', status: 'open', owner_user_id: JACK, week_start: LAST, why_not_done: 'no reply', created_at: '2026-10-05T16:00:00Z', steps: [] },
    ],
    partnerData: { partners, events: [], undone: new Set(), byGoal: new Map(), contactsByGoal: new Map() },
    partnerExtra: partners.map((p, i) => ({ id: p.id, last_touch_at: i < 10 ? '2026-10-08T16:00:00Z' : '2026-07-01T16:00:00Z', next_step: null, snoozed_until: null })),
    mailboxes: [{ mailbox_email: 'jack@x.ai', user_id: JACK }, { mailbox_email: 'cyrus@x.ai', user_id: CYRUS }],
    replied: [
      { apollo_message_id: 'm1', contact_id: 'c1', sender: 'jack@x.ai', replied: true, reply_class: 'willing_to_meet', replied_at: '2026-10-10T16:00:00Z' },
      { apollo_message_id: 'm2', contact_id: 'c2', sender: 'jack@x.ai', replied: true, reply_class: 'out_of_office', replied_at: '2026-10-10T16:00:00Z' },
      { apollo_message_id: 'm3', contact_id: 'c3', sender: 'cyrus@x.ai', replied: true, reply_class: 'follow_up_question', replied_at: '2026-10-10T16:00:00Z' },
      { apollo_message_id: 'm4', contact_id: 'c4', sender: 'jack@x.ai', replied: true, reply_class: 'follow_up_question', replied_at: '2026-10-10T16:00:00Z' },
    ],
    recentDelivered: [], recentReplies: [],
    dailyCounts: [{ day: '2026-10-06', mailbox: 'jack@x.ai', delivered: 40 }, { day: '2026-10-06', mailbox: 'cyrus@x.ai', delivered: 25 }],
    targets: [{ period_start: WEEK, metric_key: 'meetings_set', goal: 3, actual: null }],
    accounts: [{ account_id: 'acc1', name: 'Norton' }],
    prospects: [
      // An email column here must never reach the text (the loader doesn't select it).
      { contact_id: 'c1', name: 'Ana Ruiz', title: 'VP People', company: 'Norton', status: 'new', email: 'ana@norton.com' },
      { contact_id: 'c2', name: 'Bo', company: 'Acme', status: 'new' },
      { contact_id: 'c3', name: 'Cy', company: 'Beta', status: 'new' },
      { contact_id: 'c4', name: 'Di', company: 'Gamma', status: 'contacted' },
    ],
    ...over,
  };
}

test('context: owner scope, newest copy, caps, replies waiting by NBA, no emails', () => {
  const { inputs, text, ids } = assemblePlanContext(planData(), { ownerId: JACK, weekStart: WEEK, nowMs: NOW });
  const s = inputs.sections;
  assert.deepEqual(s.this_week_commitments.map(c => c.text), ['Close Upside pilot']);
  assert.deepEqual(s.todos.map(t => t.id), [uid(21), uid(22), uid(25)]); // dated first, then oldest; old copy replaced by its carry; no Cyrus, no flag
  assert.deepEqual(s.flags.map(f => [f.person, f.note]), [['Ana Ruiz', 'asked for pricing']]);
  assert.deepEqual(s.replies_waiting.map(r => [r.person, r.action, r.company_id]), [['Ana Ruiz', 'Book meeting', 'acc1']]); // OOO, Cyrus's mailbox, already contacted: out
  assert.equal(s.partners.length, 60);
  assert.deepEqual(inputs.trimmed.capped, { partners: 10 });
  assert.equal(s.partners[0].stage, 'Meeting set');
  assert.equal(s.last_week.numbers.sent, 40);
  assert.deepEqual(s.last_week.commitments.map(c => c.status), ['done', 'open']);
  assert.ok(!/@/.test(text) && !/@/.test(JSON.stringify(inputs)));
  assert.ok(ids.todo.has(uid(26)) && ids.todo.has(uid(21)) && !ids.todo.has(uid(24)));
  assert.ok(ids.commitment.has(uid(20)) && ids.company.has('acc1'));
});

test('context: over budget trims closed last-week items, then cold partners, then undated to-dos', () => {
  const full = assemblePlanContext(planData(), { ownerId: JACK, weekStart: WEEK, nowMs: NOW });
  const noClosed = full.text.length - 5;
  const a = assemblePlanContext(planData(), { ownerId: JACK, weekStart: WEEK, nowMs: NOW, maxChars: noClosed });
  assert.equal(a.inputs.trimmed.closed_last_week, 1);
  assert.equal(a.inputs.trimmed.cold_partners, 0);
  assert.deepEqual(a.inputs.sections.last_week.commitments.map(c => c.text), ['Last week missed']);

  const cold = full.inputs.sections.partners.filter(p => p.days_since >= 60).length;
  const b = assemblePlanContext(planData(), { ownerId: JACK, weekStart: WEEK, nowMs: NOW, maxChars: 900 });
  assert.equal(b.inputs.trimmed.closed_last_week, 1);
  assert.equal(b.inputs.trimmed.cold_partners, cold); // every partner untouched 60+ days goes before any to-do
  assert.ok(b.inputs.sections.partners.every(p => p.days_since < 60));
  assert.equal(b.inputs.trimmed.undated_todos, 2);
  assert.deepEqual(b.inputs.sections.todos.map(t => t.id), [uid(21)]);
  assert.ok(!b.ids.partner.has(uid(169)));
});

// ── Proposal validation ─────────────────────────────────────────────────────
test('proposals: unknown ids dropped, known kept, deduped, renumbered, capped at 10, no emails', () => {
  const ids = { commitment: new Set([uid(20)]), partner: new Set([uid(100)]), company: new Set(['acc1']), todo: new Set([uid(21)]) };
  const raw = { proposals: [
    { rank: 3, text: 'Book Ana at Norton', reason: 'Replied willing to meet Oct 10', kind: 'commitment', source: 'reply', link_type: 'company', link_id: 'company:acc1' },
    { rank: 1, text: 'Push Partner 0 to pilot', reason: 'Ana replied willing to meet on 2026-10-10', link_type: 'partner', link_id: uid(100) },
    { rank: 2, text: 'Invented partner', link_type: 'partner', link_id: uid(999) },
    { rank: 4, text: 'Send Solidcore deck', existing_todo_id: `todo:${uid(21)}`, kind: 'todo' },
    { rank: 5, text: 'Invented to-do', existing_todo_id: uid(998) },
    { rank: 6, text: 'push partner 0 to pilot!' },
    { rank: 7, text: 'Email ana@norton.com back', reason: 'call +1 (415) 555-0100' },
    ...Array.from({ length: 12 }, (_, i) => ({ rank: 8 + i, text: `Filler ${i}` })),
  ] };
  const out = toPlanProposals(raw, ids);
  assert.equal(out.length, 10);
  assert.deepEqual(out.slice(0, 4).map(p => [p.rank, p.text, p.link_type, p.link_id, p.existing_todo_id]), [
    [1, 'Push Partner 0 to pilot', 'partner', uid(100), null],
    [2, 'Book Ana at Norton', 'company', 'acc1', null],
    [3, 'Send Solidcore deck', null, null, uid(21)],
    [4, 'Email [email removed] back', null, null, null],
  ]);
  assert.equal(out[3].reason, 'call [number removed]');
  assert.equal(out[0].reason, 'Ana replied willing to meet on 2026-10-10');
  assert.equal(out[2].kind, 'todo');
  assert.ok(!out.some(p => /Invented/.test(p.text)));
});

// ── Propose route ───────────────────────────────────────────────────────────
function withDeps(sb, anthropic) {
  planDeps.getSupabase = () => sb;
  planDeps.buildPlanContext = async () => ({ inputs: { counts: { todos: 1 }, trimmed: {} }, text: 'ctx', ids: { commitment: new Set(), partner: new Set([uid(100)]), company: new Set(), todo: new Set() } });
  planDeps.callAnthropic = anthropic;
}
const reply = proposals => ({ content: [{ type: 'text', text: JSON.stringify({ proposals }) }], usage: { input_tokens: 1000, output_tokens: 200 }, stop_reason: 'end_turn' });

test('propose: one Claude call per propose, logged as week_plan; 429 at the daily cap; 502 when nothing valid', async () => {
  const calls = [];
  const sb = fakeSupabase({ business_members: members, business_anthropic_usage: [] });
  withDeps(sb, async args => { calls.push(args); sb.db.business_anthropic_usage.push({ user_id: args.userId, call_type: args.callType, created_at: new Date().toISOString() }); return reply([{ rank: 1, text: 'Push Partner 0', link_type: 'partner', link_id: uid(100) }]); });
  const ok = await call(proposeWeekPlanRoute, { week_start: WEEK, prompt: 'Upside intros' });
  assert.equal(ok.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].callType, 'week_plan');
  assert.equal(calls[0].max_tokens, 4096);
  assert.equal(calls[0].thinking, false);
  assert.equal(sb.db.business_anthropic_usage.length, 1);
  assert.equal(ok.body.proposals.length, 1);
  assert.ok(ok.body.usage.cost_usd > 0);

  for (let i = 1; i < DAILY_PROPOSE_CAP; i++) sb.db.business_anthropic_usage.push({ user_id: JACK, call_type: 'week_plan', created_at: new Date().toISOString() });
  const capped = await call(proposeWeekPlanRoute, { week_start: WEEK, prompt: 'again' });
  assert.equal(capped.status, 429);
  assert.equal(calls.length, 1);

  const sb2 = fakeSupabase({ business_members: members, business_anthropic_usage: [] });
  withDeps(sb2, async args => { calls.push(args); return reply([{ rank: 1, text: 'Made up', link_type: 'partner', link_id: uid(777) }]); });
  const bad = await call(proposeWeekPlanRoute, { week_start: WEEK, prompt: 'x' });
  assert.equal(bad.status, 502);
  assert.match(bad.body.error, /Nothing usable came back/);
});

test('propose: refuses a non-Monday, an oversize prompt and a non-member owner before calling Claude', async () => {
  let n = 0;
  withDeps(fakeSupabase({ business_members: members, business_anthropic_usage: [] }), async () => { n++; return reply([]); });
  assert.equal((await call(proposeWeekPlanRoute, { week_start: '2026-10-13', prompt: '' })).status, 400);
  assert.equal((await call(proposeWeekPlanRoute, { week_start: WEEK, prompt: 'x'.repeat(4001) })).status, 413);
  assert.equal((await call(proposeWeekPlanRoute, { week_start: WEEK, owner_user_id: uid(555), prompt: '' })).status, 400);
  assert.equal(n, 0);
});

// ── Save route ──────────────────────────────────────────────────────────────
const saveBody = (chosen, extra = {}) => ({ week_start: WEEK, owner_user_id: JACK, prompt: 'p', inputs: { counts: {} }, proposals: [], chosen, replace_open_planned: false, ...extra });
const commit = rank => ({ rank, text: `Commit ${rank}`, reason: `why ${rank}`, as: 'commitment' });

test(`save: at most ${FOCUS_CAP} planned commitments`, async () => {
  const sb = fakeSupabase({ business_members: members });
  planDeps.getSupabase = () => sb;
  const r = await call(saveWeekPlanRoute, saveBody([1, 2, 3, 4, 5, 6].map(commit)));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /At most 5/);
  assert.equal(sb.log.filter(l => l.op !== 'select').length, 0);
});

test('save: replace_open_planned drops only this owner\'s open planned commitments; existing to-do linked, not duplicated', async () => {
  const sb = fakeSupabase({
    business_members: members, sales_week_report: [], sales_week_plans: [], sales_goals: [],
    sales_week_goals: [
      { id: uid(40), business_id: BIZ, week_start: WEEK, kind: 'commitment', status: 'open', owner_user_id: JACK, plan_id: uid(9), why_not_done: null },
      { id: uid(41), business_id: BIZ, week_start: WEEK, kind: 'commitment', status: 'open', owner_user_id: JACK, plan_id: null },
      { id: uid(42), business_id: BIZ, week_start: WEEK, kind: 'commitment', status: 'open', owner_user_id: CYRUS, plan_id: uid(9) },
      { id: uid(43), business_id: BIZ, week_start: WEEK, kind: 'commitment', status: 'done', owner_user_id: JACK, plan_id: uid(9) },
      { id: uid(44), business_id: BIZ, week_start: WEEK, kind: 'todo', status: 'open', owner_user_id: JACK, link_type: null, link_id: null, text: 'Send Solidcore deck' },
      { id: uid(45), business_id: BIZ, week_start: WEEK, kind: 'todo', status: 'open', owner_user_id: JACK, link_type: null, link_id: null, text: 'Book Upside call' },
    ],
  });
  planDeps.getSupabase = () => sb;
  const r = await call(saveWeekPlanRoute, saveBody([
    commit(1), commit(2), commit(3), commit(4), commit(5),
    { rank: 6, text: 'Draft follow-up', reason: 'r', as: 'todo', link_to_rank: 1, due_date: '2026-10-15' },
    { rank: 7, text: 'Send Solidcore deck', reason: 'due Oct 14', as: 'todo', existing_todo_id: uid(44), link_to_rank: 2 },
    { rank: 8, text: 'Book Upside call', reason: 'r', as: 'commitment', existing_todo_id: uid(45) },
  ].filter(c => c.rank !== 5), { replace_open_planned: true }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const g = id => sb.db.sales_week_goals.find(x => x.id === id);
  assert.equal(g(uid(40)).status, 'dropped');
  assert.match(g(uid(40)).why_not_done, /^replanned /);
  assert.equal(g(uid(41)).status, 'open');
  assert.equal(g(uid(42)).status, 'open');
  assert.equal(g(uid(43)).status, 'done');
  assert.deepEqual(r.body.dropped, [uid(40)]);

  const commits = r.body.commitments;
  assert.equal(commits.length, 5);
  assert.ok(commits.every(c => c.plan_id === r.body.plan.id && c.plan_reason && c.link_type === undefined));
  const byRank = new Map(commits.map(c => [c.plan_rank, c]));
  assert.equal(r.body.todos.length, 1);
  assert.deepEqual([r.body.todos[0].link_type, r.body.todos[0].link_id, r.body.todos[0].plan_rank], ['commitment', byRank.get(1).id, 6]);
  assert.deepEqual([g(uid(44)).link_type, g(uid(44)).link_id, g(uid(44)).plan_rank], ['commitment', byRank.get(2).id, 7]);
  assert.deepEqual([g(uid(45)).link_type, g(uid(45)).link_id], ['commitment', byRank.get(8).id]);
  assert.equal(sb.db.sales_week_goals.filter(x => x.kind === 'todo' && x.text === 'Send Solidcore deck').length, 1);
  assert.equal(sb.db.sales_week_goals.filter(x => x.kind === 'todo' && x.text === 'Book Upside call').length, 1);
  assert.equal(sb.db.sales_week_plans.length, 1);
  assert.equal(sb.db.sales_week_plans[0].chosen_count, 7);
});

test('save: an existing to-do from another workspace or already closed is refused before any write', async () => {
  const sb = fakeSupabase({
    business_members: members, sales_week_report: [], sales_week_plans: [],
    sales_week_goals: [{ id: uid(50), business_id: BIZ, week_start: WEEK, kind: 'todo', status: 'done' }],
  });
  planDeps.getSupabase = () => sb;
  const r = await call(saveWeekPlanRoute, saveBody([{ rank: 1, text: 'x', as: 'todo', existing_todo_id: uid(50) }]));
  assert.equal(r.status, 400);
  assert.equal(sb.db.sales_week_plans.length, 0);
});
