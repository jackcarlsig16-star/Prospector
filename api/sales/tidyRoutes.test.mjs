// node --test api/sales/tidyRoutes.test.mjs  (react-scripts' Jest only runs src/)
// call-notes-targets-v1 REV4 Stage 3 - run / guard / force / park / accept
// against the in-memory Supabase (with the partial unique index modelled):
// 0 network, 0 Claude, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { runTidy, listSuggestions, acceptSuggestion, parkSuggestion, skipKeys, TIDY_CATEGORY } from './tidyRoutes.js';

const NOW = Date.parse('2026-10-16T18:00:00Z'); // Thu Oct 16, 11:00 LA -> week of Mon Oct 12
const DAY = 864e5;
const iso = daysAgo => new Date(NOW - daysAgo * DAY).toISOString();
const B = randomUUID(), U = randomUUID();
const G = { gallagher: randomUUID(), aon: randomUUID(), locktonA: randomUUID(), locktonB: randomUUID(), mercer: randomUUID() };
const T = { fundrise: randomUUID(), deloitte: randomUUID() };
const W = { call: randomUUID(), flag: randomUUID(), dated: randomUUID() };
const partner = (id, name, extra) => ({ id, business_id: B, goal_type: 'partnership', archived_at: null, name, pipeline_status: 'not_started', last_touch_at: null, snoozed_until: null, owner_team: null, co_owner_name: null, no_double_touch: false, ...extra });
const seed = () => ({
  sales_goals: [
    partner(G.gallagher, 'Gallagher', { pipeline_status: 'first_email_sent', last_touch_at: iso(10) }),
    partner(G.aon, 'Aon', { pipeline_status: 'replied', last_touch_at: iso(2) }),
    partner(G.locktonA, 'Lockton'), partner(G.locktonB, 'Lockton Inc'),
    partner(G.mercer, 'Mercer', { pipeline_status: 'in_sequence', last_touch_at: iso(1), no_double_touch: true, owner_team: 'upside', co_owner_name: 'Brad' }),
    partner(randomUUID(), 'Archived Twin', { archived_at: iso(1) }),
  ],
  sales_targets: [
    { id: T.fundrise, business_id: B, name: 'Fundrise', status: 'researching', research_notes: null, created_at: iso(10) },
    { id: T.deloitte, business_id: B, name: 'Deloitte', status: 'researching', research_notes: 'Person: Ana', created_at: iso(10) },
  ],
  sales_week_goals: [
    { id: W.call, business_id: B, kind: 'todo', text: 'Call Pat', status: 'open', due_date: null, link_type: null, link_id: null, created_at: iso(10), prospect_contact_id: null, contacts: [], carried_from_id: null },
    { id: W.flag, business_id: B, kind: 'todo', text: 'Follow up: Pat · Gallagher', status: 'open', due_date: null, link_type: null, link_id: null, created_at: iso(6), prospect_contact_id: 'c1', contacts: ['Pat Example', 'Gallagher'], carried_from_id: null },
    { id: W.dated, business_id: B, kind: 'todo', text: 'Dated', status: 'open', due_date: '2026-10-20', link_type: null, link_id: null, created_at: iso(10), prospect_contact_id: null, contacts: [], carried_from_id: null },
  ],
  sales_partner_events: [{ id: randomUUID(), business_id: B, goal_id: G.mercer, event: 'touch', at: iso(1) }],
  partner_domains: [],
  sales_suggestions: [],
  sales_tidy_runs: [],
});
const unique = { sales_suggestions: r => (r.status === 'proposed' ? [r.business_id, r.kind, r.ref_type, r.ref_id, r.ref_id2 || r.ref_id].join('|') : null) };
const fresh = () => fakeSupabase(seed(), { unique });
const run = (sb, over = {}) => runTidy(sb, { businessId: B, trigger: 'test', now: NOW, ...over });
const snapshot = sb => JSON.stringify(['sales_goals', 'sales_targets', 'sales_partner_events', 'partner_domains'].map(t => sb.db[t]));

test('first run proposes each kind once and writes one ok run row', async () => {
  const sb = fresh();
  const r = await run(sb);
  assert.equal(r.status, 200);
  assert.equal(r.body.ran, true);
  assert.equal(r.body.created, 7);
  assert.deepEqual(r.body.run.counts.by_kind, { research_or_drop: 1, follow_up: 1, set_a_date: 1, duplicate: 1, reply_task: 1, check_co_owner: 1, flag_cold: 1 });
  assert.deepEqual(sb.db.sales_tidy_runs.map(x => [x.status, x.trigger]), [['ok', 'test']]);
  const texts = sb.db.sales_suggestions.map(s => s.text).sort();
  assert.deepEqual(texts, ['Check with Brad about Mercer', 'Flag Pat Example is going cold', 'Follow up Gallagher', 'Possible duplicate: Lockton / Lockton Inc', 'Reply/prep task for Aon', 'Research Fundrise or drop', 'Set a date or drop: Call Pat'].sort());
  assert.ok(sb.db.sales_suggestions.every(s => s.status === 'proposed' && s.business_id === B));
});

test('a second run the same LA day is refused by the guard; force runs but the keys are skipped', async () => {
  const sb = fresh();
  const first = await run(sb);
  const again = await run(sb, { now: NOW + 3 * 3600e3 });
  assert.deepEqual([again.body.ran, again.body.reason, again.body.last_run.id], [false, 'Tidy already ran today', first.body.run.id]);
  assert.equal(sb.db.sales_tidy_runs.length, 1);
  const forced = await run(sb, { force: true, now: NOW + 3 * 3600e3 });
  assert.deepEqual([forced.body.ran, forced.body.created, forced.body.skipped], [true, 0, 7]);
  assert.equal(sb.db.sales_suggestions.length, 7);
  assert.equal(sb.db.sales_tidy_runs.length, 2);
  // The index path: a direct duplicate insert collides like Postgres would.
  const dup = sb.db.sales_suggestions[0];
  const ins = await sb.from('sales_suggestions').insert({ ...dup, id: undefined }).select('id');
  assert.equal(ins.error?.code, '23505');
});

test('a run on the next day with nothing new creates nothing; a bad trigger is 400', async () => {
  const sb = fresh();
  await run(sb);
  const next = await run(sb, { now: NOW + DAY });
  assert.deepEqual([next.body.ran, next.body.created, next.body.skipped], [true, 0, 7]);
  assert.equal((await run(sb, { trigger: 'cron' })).status, 400);
});

test('dismiss parks the key: not re-created while dismissed_until is ahead, re-proposed after', async () => {
  const sb = fresh();
  await run(sb);
  const s = sb.db.sales_suggestions.find(x => x.kind === 'follow_up');
  const parked = await parkSuggestion(sb, { businessId: B, userId: U, id: s.id, now: NOW });
  assert.equal(parked.status, 200);
  assert.deepEqual([parked.body.suggestion.status, parked.body.suggestion.dismissed_until, parked.body.suggestion.decided_by], ['dismissed', new Date(NOW + 7 * DAY).toISOString(), U]);
  const inside = await run(sb, { force: true, now: NOW + 3 * DAY });
  assert.deepEqual([inside.body.created, sb.db.sales_suggestions.filter(x => x.kind === 'follow_up').length], [0, 1]);
  // +8 d: Gallagher's key is free again, and Mercer (touched 1 d before NOW) is stale by now too.
  const after = await run(sb, { force: true, now: NOW + 8 * DAY });
  assert.deepEqual([after.body.created, sb.db.sales_suggestions.filter(x => x.kind === 'follow_up' && x.ref_id === G.gallagher).length], [2, 2]);
  assert.equal((await parkSuggestion(sb, { businessId: B, userId: U, id: s.id, now: NOW })).status, 409);
  assert.equal((await parkSuggestion(sb, { businessId: B, userId: U, id: randomUUID(), now: NOW })).status, 404);
});

test('accept creates exactly one open to-do linked to the record and writes nothing else', async () => {
  const sb = fresh();
  await run(sb);
  const before = snapshot(sb), todosBefore = sb.db.sales_week_goals.length;
  const s = sb.db.sales_suggestions.find(x => x.kind === 'research_or_drop');
  const r = await acceptSuggestion(sb, { businessId: B, userId: U, id: s.id, now: NOW });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t = r.body.todo;
  assert.deepEqual([t.text, t.kind, t.status, t.week_start, t.due_date, t.link_type, t.link_id, t.category, t.owner_user_id, t.created_by],
    ['Research Fundrise or drop', 'todo', 'open', '2026-10-12', '2026-10-19', 'target', T.fundrise, TIDY_CATEGORY, U, U]);
  assert.equal(sb.db.sales_week_goals.length, todosBefore + 1);
  assert.equal(snapshot(sb), before);
  assert.deepEqual([r.body.suggestion.status, r.body.suggestion.decided_by, r.body.open], ['accepted', U, null]);
  assert.equal((await acceptSuggestion(sb, { businessId: B, userId: U, id: s.id, now: NOW })).status, 409);
  // Quiet period: the accepted key is not proposed again right away (the target is still researching).
  const forced = await run(sb, { force: true, now: NOW + DAY });
  assert.equal(sb.db.sales_suggestions.filter(x => x.kind === 'research_or_drop').length, 1, JSON.stringify(forced.body));
  assert.equal(skipKeys(sb.db.sales_suggestions, NOW + 8 * DAY).size, 6);
});

test('accept on a duplicate pair creates no to-do and returns the two partners; a flag suggestion to-do has no link', async () => {
  const sb = fresh();
  await run(sb);
  const n = sb.db.sales_week_goals.length;
  const pair = sb.db.sales_suggestions.find(x => x.kind === 'duplicate');
  const r = await acceptSuggestion(sb, { businessId: B, userId: U, id: pair.id, now: NOW });
  assert.deepEqual([r.status, r.body.todo, r.body.open, sb.db.sales_week_goals.length], [200, null, [G.locktonA, G.locktonB].sort(), n]);
  const flag = sb.db.sales_suggestions.find(x => x.kind === 'flag_cold');
  const f = await acceptSuggestion(sb, { businessId: B, userId: U, id: flag.id, now: NOW });
  assert.deepEqual([f.body.todo.text, f.body.todo.link_type, f.body.todo.link_id, f.body.todo.due_date], ['Flag Pat Example is going cold', null, null, '2026-10-17']);
});

test('list returns proposed rows only, newest first, with the last run', async () => {
  const sb = fresh();
  await run(sb);
  const s = sb.db.sales_suggestions[0];
  await parkSuggestion(sb, { businessId: B, userId: U, id: s.id, now: NOW });
  const out = await listSuggestions(sb, B);
  assert.equal(out.suggestions.length, 6);
  assert.ok(out.suggestions.every(x => x.status === 'proposed'));
  assert.deepEqual([out.last_run.status, out.last_run.trigger, out.last_run.counts.proposed], ['ok', 'test', 7]);
});
