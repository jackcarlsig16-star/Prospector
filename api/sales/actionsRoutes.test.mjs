// node --test api/sales/actionsRoutes.test.mjs  (react-scripts' Jest only runs src/)
// sales-ia-v2 Stage 5 - the Actions list (ranking, kinds, company + priority) and
// the signal / suggestion Undo routes, against the in-memory Supabase. 0 network,
// 0 Claude, 0 Apollo. Made-up company names; no people's emails or phones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { buildActions, rankActions, listActions } from './actionsRoutes.js';
import { acceptSignal, dismissSignal, undoSignal } from './signalsRoutes.js';
import { acceptSuggestion, parkSuggestion, undoSuggestion, TIDY_CATEGORY } from './tidyRoutes.js';

const B = randomUUID(), JACK = randomUUID(), CY = randomUUID();
const P = { lake: randomUUID(), north: randomUUID() }, O = { mill: randomUUID() }, T = { zeta: randomUUID() };
const TODAY = '2026-10-21', WEEK = '2026-10-19';
const row = (kind, extra) => ({ id: randomUUID(), business_id: B, kind, status: 'open', week_start: WEEK, owner_user_id: JACK, created_at: '2026-10-19T10:00:00Z', steps: [], ...extra });
const companies = {
  partner: new Map([[P.lake, { name: 'Lakeshore Mutual', priority: 1 }], [P.north, { name: 'Northwind Benefits', priority: null }]]),
  employer: new Map([[O.mill, { name: 'Old Mill Union', priority: 3 }]]),
  target: new Map([[T.zeta, { name: 'Zeta Labs', priority: null }]]),
  apollo: new Map(),
};
const members = new Map([[JACK, 'Jack Zz'], [CY, 'Cyrus Yy']]);

test('buildActions: six kinds, company + priority resolved, ranked overdue -> P1..P4 -> due -> age', () => {
  const todos = [
    row('todo', { id: 'todo-late', text: 'Send the deck', due_date: '2026-10-19', link_type: 'partner', link_id: P.north }),
    row('todo', { id: 'todo-today', text: 'Call back', due_date: TODAY, link_type: 'opportunity', link_id: O.mill, category: 'Signals' }),
    row('todo', { id: 'todo-later', text: 'Draft the one-pager', due_date: '2026-10-23', owner_user_id: CY }),
    row('todo', { id: 'todo-nodate', text: 'Read the S-1', due_date: null }),
    row('todo', { id: 'todo-done', text: 'Done one', status: 'done' }),
    row('todo', { id: 'todo-steps-done', text: 'Steps all ticked', steps: [{ done: true }, { done: true }] }),
    row('todo', { id: 'todo-dropped', text: 'Dropped', status: 'dropped' }),
  ];
  const flags = [row('todo', { id: 'flag-1', text: 'Follow up the benefits lead', prospect_contact_id: 'pc1', flagged_by: CY, flag_note: 'opened 3x', contacts: ['Benefits lead'], due_date: '2026-10-22', link_type: 'partner', link_id: P.lake })];
  const waiting = [
    row('waiting', { id: 'wait-late', text: 'the signed MSA', waiting_on: 'Pat', due_date: '2026-10-15', link_type: 'partner', link_id: P.north, owner_user_id: null }),
    row('waiting', { id: 'wait-fine', text: 'the deck', waiting_on: 'Sam', due_date: '2026-10-30', owner_user_id: null }),
  ];
  const signals = [
    { id: 'sig-web', status: 'new', source: 'web_visit', company_name: 'Acme Widgets', company_key: 'acme widgets', why_now: 'P1 Act today: US 500+ with 5+ visits', signal: '6 visits in 7 days', match: null, score: null, created_at: '2026-10-20T08:00:00Z' },
    { id: 'sig-scout', status: 'new', source: 'scout', company_name: 'Zeta Labs', company_key: 'zeta labs', who: 'Head of People', signal: 'Opened a new office', why_now: 'Hiring', score: 61, match: { type: 'target', id: T.zeta, name: 'Zeta Labs' }, created_at: '2026-10-20T09:00:00Z' },
    { id: 'sig-hot', status: 'new', source: 'scout', company_name: 'Hot Co', company_key: 'hot co', signal: 'Raised a round', why_now: null, score: 90, match: null, created_at: '2026-10-20T09:30:00Z' },
    { id: 'sig-old', status: 'dismissed', source: 'scout', company_name: 'Gone', company_key: 'gone', match: null, created_at: '2026-10-20T09:00:00Z' },
  ];
  const suggestions = [
    { id: 'sug-follow', status: 'proposed', kind: 'follow_up', ref_type: 'partner', ref_id: P.lake, text: 'Follow up Lakeshore Mutual', reason: 'Replied · last touch 12 d ago · no open to-do', created_at: '2026-10-21T06:00:00Z' },
    { id: 'sug-nudge-dup', status: 'proposed', kind: 'nudge', ref_type: 'todo', ref_id: 'wait-late', text: 'Nudge Pat', reason: 'dup of the waiting row', created_at: '2026-10-21T06:00:00Z' },
    { id: 'sug-visited', status: 'proposed', kind: 'visited_no_touch', ref_type: 'partner', ref_id: P.north, text: 'Reach out to Northwind Benefits', reason: 'Visited the site', created_at: '2026-10-21T06:00:00Z' },
    { id: 'sug-date', status: 'proposed', kind: 'set_a_date', ref_type: 'todo', ref_id: 'todo-nodate', text: 'Set a date or drop: Read the S-1', reason: 'Open for 9 days with no due date', created_at: '2026-10-21T06:00:00Z' },
  ];
  const commitments = [
    row('commitment', { id: 'focus-a', text: 'Book two meetings', plan_id: 'pl', plan_rank: 1, plan_reason: 'Pipeline is thin' }),
    row('commitment', { id: 'focus-done', text: 'Ship the deck', plan_id: 'pl', plan_rank: 2, status: 'done' }),
    row('commitment', { id: 'typed', text: 'Not planned', plan_id: null }),
  ];
  const refTodos = [{ id: 'todo-nodate', link_type: null, link_id: null }];
  const items = buildActions({ todos, flags, waiting, signals, suggestions, commitments, refTodos, companies, members, today: TODAY });
  const keys = items.map(i => i.key);
  // Overdue first (P2 waiting 6 d late, P2 to-do 2 d late), then P1 (flag on a P1 partner, web P1, scout score 90),
  // then P2 (to-do due today, Zeta signal, focus), then P3 (Old Mill's to-do? no - it is P3 by the employer's own priority
  // but due today... priority wins over kind default) etc.
  assert.deepEqual(keys.slice(0, 2), ['waiting-wait-late', 'todo-todo-late'], 'overdue rows first, most overdue first by due date');
  assert.deepEqual(keys.slice(2, 5), ['flag-flag-1', 'signal-sig-web', 'signal-sig-hot'], 'then P1: a flag on a P1 partner, a P1 website signal, a scout score >= 80');
  const by = Object.fromEntries(items.map(i => [i.key, i]));
  assert.equal(by['todo-todo-today'].priority, 3, "a to-do on an employer with its own P3 takes the employer's priority");
  assert.equal(by['todo-todo-later'].priority, 3, 'a to-do due later this week is P3');
  assert.equal(by['todo-todo-nodate'].priority, 3);
  assert.equal(by['signal-sig-scout'].priority, 2);
  assert.equal(by['tidy-sug-visited'].priority, 2);
  assert.equal(by['tidy-sug-follow'].priority, 1, "Tidy on Lakeshore takes the partner's P1");
  assert.equal(by['focus-focus-a'].priority, 2);
  assert.equal(by['focus-focus-done'].status, 'done', 'done Focus items come through for the fold');
  assert.equal(by['tidy-sug-nudge-dup'], undefined, 'a Tidy nudge for a waiting row already on the list is dropped');
  assert.equal(by['waiting-wait-fine'], undefined, 'a waiting row that is not overdue is not an action yet');
  for (const k of ['todo-todo-done', 'todo-todo-steps-done', 'todo-todo-dropped', 'signal-sig-old', 'focus-typed']) assert.equal(by[k], undefined, `${k} is out`);
  assert.deepEqual(by['signal-sig-web'].company, { type: 'visitor', id: 'acme widgets', name: 'Acme Widgets', priority: null, stage_label: 'Website visit' });
  assert.deepEqual(by['signal-sig-hot'].company, { type: null, id: null, name: 'Hot Co', priority: null });
  assert.deepEqual(by['signal-sig-scout'].company, { type: 'target', id: T.zeta, name: 'Zeta Labs', priority: null, stage_label: null, owner: null, last_touch_at: null });
  assert.equal(by['signal-sig-scout'].text, 'Reach out: Zeta Labs — Head of People');
  assert.deepEqual(by['todo-todo-today'].company, { type: 'employer', id: O.mill, name: 'Old Mill Union', priority: 3, stage_label: null, owner: null, last_touch_at: null });
  assert.equal(by['flag-flag-1'].why, 'Flagged by Cyrus · “opened 3x”');
  assert.deepEqual([by['waiting-wait-late'].late_days, by['waiting-wait-late'].why, by['waiting-wait-late'].text], [6, '6 d late', 'Waiting on Pat: the signed MSA']);
  assert.equal(by['todo-todo-today'].why, 'Signals');
  assert.equal(by['tidy-sug-date'].company, null);
  // Every text/why is free of "@" (L1 is the data's job, but the list never invents one).
  assert.ok(items.every(i => !/@/.test(`${i.text} ${i.why || ''}`)));
  // FIX actions-row-detail-v1: the row detail's source facts ride on the same row.
  assert.equal(by['tidy-sug-visited'].meta.rule, 'No touch in 14 days after a site visit');
  assert.deepEqual([by['flag-flag-1'].meta.flagged_by_name, by['flag-flag-1'].meta.flag_note], ['Cyrus', 'opened 3x']);
  assert.deepEqual([by['todo-todo-today'].meta.from_note, by['todo-todo-today'].meta.note_date], [false, null]);
  // rankActions is stable for ties and keeps blanks last within a priority.
  const ranked = rankActions([{ key: 'b', overdue: false, priority: 2, due_date: null, created_at: '1' }, { key: 'a', overdue: false, priority: 2, due_date: '2026-10-22', created_at: '2' }, { key: 'c', overdue: true, priority: 4, due_date: '2026-10-01', created_at: '3' }]);
  assert.deepEqual(ranked.map(r => r.key), ['c', 'a', 'b']);
});

test('buildActions: a call-note to-do carries the note date; a company carries stage, owner and last touch', () => {
  const co = { ...companies, partner: new Map([[P.lake, { name: 'Lakeshore Mutual', priority: 1, stage_label: 'Replied', owner: 'Jack', last_touch_at: '2026-10-09T15:00:00Z' }]]) };
  const todos = [row('todo', { id: 'todo-note', text: 'Send the pricing sheet', due_date: '2026-10-23', source_note_id: 'note-1', link_type: 'partner', link_id: P.lake })];
  const [it] = buildActions({ todos, notes: new Map([['note-1', '2026-10-14']]), companies: co, members, today: TODAY });
  assert.deepEqual([it.why, it.meta.from_note, it.meta.note_date], ['From call notes', true, '2026-10-14']);
  assert.deepEqual(it.company, { type: 'partner', id: P.lake, name: 'Lakeshore Mutual', priority: 1, stage_label: 'Replied', owner: 'Jack', last_touch_at: '2026-10-09T15:00:00Z' });
});

const seed = () => fakeSupabase({
  business_members: [{ business_id: B, user_id: JACK, name: 'Jack Zz' }, { business_id: B, user_id: CY, name: 'Cyrus Yy' }],
  sales_goals: [{ id: P.lake, business_id: B, goal_type: 'partnership', name: 'Lakeshore Mutual', priority: 1, archived_at: null, pipeline_status: 'replied', owner_user_id: JACK, last_touch_at: '2026-10-09T15:00:00Z' }],
  sales_opportunities: [{ id: O.mill, business_id: B, organization: 'Old Mill Union', priority: null, archived_at: null, notes: '(10/01) first line', stage: 'prospect', owner_team: 'upside' }],
  sales_opportunity_events: [{ id: randomUUID(), business_id: B, opportunity_id: O.mill, event_type: 'stage_change', changed_at: '2026-10-12T10:00:00Z' }],
  sales_targets: [],
  sales_week_goals: [
    row('todo', { id: 'todo-today', text: 'Call back', due_date: TODAY, link_type: 'partner', link_id: P.lake }),
    row('todo', { id: 'flag-1', text: 'Follow up the lead', prospect_contact_id: 'pc1', flagged_by: CY, contacts: ['Lead'] }),
    row('waiting', { id: 'wait-late', text: 'the MSA', waiting_on: 'Pat', due_date: '2026-10-10', week_start: '2026-10-05', link_type: 'opportunity', link_id: O.mill, owner_user_id: null }),
    row('commitment', { id: 'focus-a', text: 'Book two meetings', plan_id: 'pl', plan_rank: 1 }),
  ],
  sales_week_goal_steps: [],
  sales_signals: [
    { id: randomUUID(), business_id: B, status: 'new', source: 'scout', signal_week: WEEK, company_name: 'Brand New Co', company_key: 'brand new co', kind: 'employer', who: null, signal: 'Hiring', why_now: 'Fast', score: 50, match: null, created_at: '2026-10-20T09:00:00Z' },
    { id: randomUUID(), business_id: B, status: 'new', source: 'scout', signal_week: WEEK, company_name: 'Lakeshore Mutual', company_key: 'lakeshore mutual', kind: 'partner', who: null, signal: 'New CEO', why_now: 'Change', score: 70, match: { type: 'partner', id: P.lake, name: 'Lakeshore Mutual' }, created_at: '2026-10-20T09:00:00Z' },
    { id: randomUUID(), business_id: B, status: 'new', source: 'scout', signal_week: WEEK, company_name: 'Old Mill Union', company_key: 'old mill union', kind: 'employer', who: null, signal: 'Benefits RFP', why_now: null, score: 40, match: { type: 'opportunity', id: O.mill, name: 'Old Mill Union' }, created_at: '2026-10-20T09:00:00Z' },
  ],
  sales_suggestions: [{ id: randomUUID(), business_id: B, status: 'proposed', kind: 'follow_up', ref_type: 'partner', ref_id: P.lake, ref_id2: null, text: 'Follow up Lakeshore Mutual', reason: 'no open to-do', created_at: '2026-10-21T06:00:00Z' }],
  sales_partner_events: [], sales_week_report: [], sales_sequenced_accounts: [], partner_domains: [], sales_call_notes: [],
});

test('listActions reads every source once and resolves companies from the referenced records', async () => {
  const s = seed();
  const { items, today, week_start } = await listActions(s, B, new Date(`${TODAY}T18:00:00Z`));
  assert.equal(today, TODAY); assert.equal(week_start, WEEK);
  const kinds = items.map(i => i.kind);
  assert.deepEqual([...new Set(kinds)].sort(), ['flag', 'focus', 'signal', 'tidy', 'todo', 'waiting']);
  assert.equal(items[0].key, 'waiting-wait-late', 'the overdue waiting row (from an older week) leads');
  assert.equal(items.find(i => i.key === 'todo-todo-today').company.name, 'Lakeshore Mutual');
  assert.equal(items.find(i => i.key === 'waiting-wait-late').company.name, 'Old Mill Union');
  assert.equal(items.find(i => i.kind === 'flag').why, 'Flagged by Cyrus');
  const lake = items.find(i => i.key === 'todo-todo-today').company;
  assert.deepEqual([lake.stage_label, lake.owner, lake.last_touch_at], ['Replied', 'Jack', '2026-10-09T15:00:00Z']);
  const mill = items.find(i => i.key === 'waiting-wait-late').company;
  assert.deepEqual([mill.owner, mill.last_touch_at], ['Upside', '2026-10-12T10:00:00Z'], 'employer owner falls back to the team; last touch = the latest stage event');
});

test('signal Undo: a dismissed signal is new again; an accepted one loses its to-do and new target / partner note / employer line', async () => {
  const s = seed();
  const now = new Date(`${TODAY}T18:00:00Z`);
  const [fresh, onPartner, onEmployer] = s.db.sales_signals;
  // dismiss -> undo
  assert.equal((await dismissSignal(s, { businessId: B, userId: JACK, id: fresh.id, now })).status, 200);
  const u1 = await undoSignal(s, { businessId: B, id: fresh.id, now: new Date(now.getTime() + 5000) });
  assert.equal(u1.status, 200, JSON.stringify(u1.body));
  assert.deepEqual([u1.body.signal.status, u1.body.signal.dismissed_until, u1.body.signal.decided_by], ['new', null, null]);
  // accept (new target) -> undo removes the target and its to-do
  const a1 = await acceptSignal(s, { businessId: B, userId: JACK, id: fresh.id, now });
  assert.equal(a1.status, 200, JSON.stringify(a1.body));
  assert.equal(a1.body.via, 'new_target');
  assert.equal(s.db.sales_targets.length, 1);
  const u2 = await undoSignal(s, { businessId: B, id: fresh.id, now: new Date(now.getTime() + 5000) });
  assert.equal(u2.status, 200, JSON.stringify(u2.body));
  assert.equal(s.db.sales_targets.length, 0, 'the target Accept made is gone');
  assert.equal(s.db.sales_week_goals.find(g => g.id === a1.body.todo.id), undefined, 'its to-do is gone');
  const back = s.db.sales_signals.find(x => x.id === fresh.id);
  assert.deepEqual([back.status, back.target_id, back.todo_id, back.match], ['new', null, null, null]);
  // accept on a partner -> the note event with meta.from_signal_id comes off
  const a2 = await acceptSignal(s, { businessId: B, userId: JACK, id: onPartner.id, now });
  assert.equal(a2.status, 200, JSON.stringify(a2.body));
  assert.equal(s.db.sales_partner_events.filter(e => e.goal_id === P.lake && e.event === 'note').length, 1);
  assert.equal((await undoSignal(s, { businessId: B, id: onPartner.id, now })).status, 200);
  assert.equal(s.db.sales_partner_events.filter(e => e.goal_id === P.lake && e.event === 'note').length, 0);
  assert.equal(s.db.sales_signals.find(x => x.id === onPartner.id).status, 'new');
  // accept on an employer -> the appended "(M/D) Signal:" line comes off, the earlier notes stay
  const a3 = await acceptSignal(s, { businessId: B, userId: JACK, id: onEmployer.id, now });
  assert.equal(a3.status, 200, JSON.stringify(a3.body));
  assert.match(s.db.sales_opportunities[0].notes, /\(10\/21\) Signal: Benefits RFP$/);
  assert.equal((await undoSignal(s, { businessId: B, id: onEmployer.id, now })).status, 200);
  assert.equal(s.db.sales_opportunities[0].notes, '(10/01) first line');
  // guards: still new -> 409; too old -> 409; unknown -> 404
  assert.equal((await undoSignal(s, { businessId: B, id: onEmployer.id, now })).status, 409);
  await dismissSignal(s, { businessId: B, userId: JACK, id: onEmployer.id, now });
  assert.equal((await undoSignal(s, { businessId: B, id: onEmployer.id, now: new Date(now.getTime() + 11 * 60e3) })).status, 409);
  assert.equal((await undoSignal(s, { businessId: B, id: randomUUID(), now })).status, 404);
});

test('suggestion Undo: dismissed / snoozed / accepted back to proposed; the Tidy to-do Accept made is deleted when its id is sent', async () => {
  const s = seed();
  const now = Date.parse(`${TODAY}T18:00:00Z`);
  const sug = s.db.sales_suggestions[0];
  assert.equal((await parkSuggestion(s, { businessId: B, userId: JACK, id: sug.id, now })).status, 200);
  const u1 = await undoSuggestion(s, { businessId: B, userId: JACK, id: sug.id, body: {}, now: now + 5000 });
  assert.equal(u1.status, 200, JSON.stringify(u1.body));
  assert.deepEqual([u1.body.suggestion.status, u1.body.suggestion.dismissed_until, u1.body.suggestion.decided_at], ['proposed', null, null]);
  const a = await acceptSuggestion(s, { businessId: B, userId: JACK, id: sug.id, now });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.todo.category, TIDY_CATEGORY);
  // Someone else's id, or a to-do that is not an open Tidy one, is left alone.
  const other = s.db.sales_week_goals.find(g => g.id === 'todo-today');
  assert.equal((await undoSuggestion(s, { businessId: B, userId: JACK, id: sug.id, body: { todo_id: other.id === 'todo-today' ? randomUUID() : other.id }, now: now + 5000 })).status, 200);
  assert.ok(s.db.sales_week_goals.find(g => g.id === 'todo-today'), 'an unrelated to-do is untouched');
  assert.ok(s.db.sales_week_goals.find(g => g.id === a.body.todo.id), 'the Tidy to-do stays when its id was not sent');
  // Accept again, undo with the right id: the to-do is gone.
  const a2 = await acceptSuggestion(s, { businessId: B, userId: JACK, id: sug.id, now });
  assert.equal(a2.status, 200);
  const u3 = await undoSuggestion(s, { businessId: B, userId: JACK, id: sug.id, body: { todo_id: a2.body.todo.id }, now: now + 5000 });
  assert.equal(u3.status, 200, JSON.stringify(u3.body));
  assert.equal(s.db.sales_week_goals.find(g => g.id === a2.body.todo.id), undefined);
  assert.equal(s.db.sales_suggestions[0].status, 'proposed');
  assert.equal((await undoSuggestion(s, { businessId: B, userId: JACK, id: sug.id, body: {}, now })).status, 409, 'still proposed');
  assert.equal((await undoSuggestion(s, { businessId: B, userId: JACK, id: sug.id, body: { todo_id: 'nope' }, now })).status, 400);
});
