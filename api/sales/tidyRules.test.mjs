// node --test api/sales/tidyRules.test.mjs  (react-scripts' Jest only runs src/)
// call-notes-targets-v1 REV4 Stage 3 - one test per Tidy rule, pure fixtures,
// a fixed clock: 0 network, 0 Claude, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { researchOrDrop, followUp, setADate, duplicates, replyTask, checkCoOwner, flagCold, waitingOverdue, interestFollowUp, runRules, keyOf, KINDS, DUE_DAYS } from './tidyRules.js';

const NOW = Date.parse('2026-10-16T18:00:00Z'); // Oct 16, 11:00 LA
const TODAY = '2026-10-16';
const iso = daysAgo => new Date(NOW - daysAgo * 864e5).toISOString();
const id = () => randomUUID();
const ctx = over => ({ now: NOW, today: TODAY, partners: [], targets: [], todos: [], flags: [], events: [], domains: [], ...over });
const partner = (name, extra) => ({ id: id(), name, pipeline_status: 'not_started', last_touch_at: null, snoozed_until: null, owner_team: null, co_owner_name: null, no_double_touch: false, ...extra });
const todo = (text, extra) => ({ id: id(), text, status: 'open', due_date: null, link_type: null, link_id: null, created_at: iso(10), prospect_contact_id: null, contacts: [], ...extra });

test('research_or_drop: researching > 7 d with no notes and no open to-do; notes, a to-do or a young target stop it', () => {
  const old = { id: id(), name: 'Fundrise', status: 'researching', research_notes: null, created_at: iso(8) };
  const noted = { ...old, id: id(), name: 'Plaid', research_notes: 'Person: Ana' };
  const young = { ...old, id: id(), name: 'Deloitte', created_at: iso(3) };
  const tasked = { ...old, id: id(), name: 'Lockton' };
  const out = researchOrDrop(ctx({ targets: [old, noted, young, tasked], todos: [todo('Research Lockton', { link_type: 'target', link_id: tasked.id })] }));
  assert.deepEqual(out.map(s => [s.ref_type, s.ref_id, s.text]), [['target', old.id, 'Research Fundrise or drop']]);
  assert.match(out[0].reason, /8 days/);
});

test('follow_up: Sent stages only, stale per isStalePartner, no open to-do', () => {
  const stale = partner('Gallagher', { pipeline_status: 'first_email_sent', last_touch_at: iso(9) });
  const fresh = partner('Aon', { pipeline_status: 'in_sequence', last_touch_at: iso(2) });
  const snoozed = partner('Mercer', { pipeline_status: 'in_sequence', last_touch_at: iso(20), snoozed_until: '2026-12-01' });
  const replied = partner('Marsh', { pipeline_status: 'replied', last_touch_at: iso(20) });
  const tasked = partner('Lockton', { pipeline_status: 'first_email_sent', last_touch_at: iso(20) });
  const out = followUp(ctx({ partners: [stale, fresh, snoozed, replied, tasked], todos: [todo('Call', { link_type: 'partner', link_id: tasked.id })] }));
  assert.deepEqual(out.map(s => s.text), ['Follow up Gallagher']);
  assert.equal(out[0].reason, '1st email sent · last touch 9 days ago · no open to-do');
});

test('set_a_date: open to-do with no due date for 7+ days; dated, done, young and flag rows are left alone', () => {
  const stuck = todo('Call Pat');
  const out = setADate(ctx({ todos: [stuck, todo('Dated', { due_date: '2026-10-20' }), todo('Done', { status: 'done' }), todo('Young', { created_at: iso(2) }), todo('Flag', { prospect_contact_id: 'c1' })] }));
  assert.deepEqual(out.map(s => [s.ref_type, s.ref_id, s.text]), [['todo', stuck.id, 'Set a date or drop: Call Pat']]);
});

test('duplicate: same normalized name or a shared confirmed domain; the pair is id-ordered so the key is stable', () => {
  const a = partner('Lockton Inc'), b = partner('Lockton'), c = partner('Marsh McLennan'), d = partner('MMA'), e = partner('Aon');
  const out = duplicates(ctx({ partners: [e, d, c, b, a], domains: [{ goal_id: c.id, domain: 'marsh.example' }, { goal_id: d.id, domain: 'marsh.example' }, { goal_id: e.id, domain: 'aon.example' }] }));
  assert.equal(out.length, 2);
  const byName = out.find(s => /Lockton/.test(s.text)), byDomain = out.find(s => /Marsh/.test(s.text));
  assert.deepEqual([byName.ref_id, byName.ref_id2], [a.id, b.id].sort());
  assert.equal(byDomain.reason, 'Both have the domain marsh.example');
  assert.equal(keyOf(byName), keyOf({ ...byName, ref_id: byName.ref_id, ref_id2: byName.ref_id2 }));
});

test('reply_task: Replied / Meeting set with no open to-do', () => {
  const r = partner('Aon', { pipeline_status: 'replied' }), m = partner('Mercer', { pipeline_status: 'meeting_set' }), t = partner('Marsh', { pipeline_status: 'replied' });
  const out = replyTask(ctx({ partners: [r, m, t, partner('Sent', { pipeline_status: 'first_email_sent' })], todos: [todo('Prep', { link_type: 'partner', link_id: t.id })] }));
  assert.deepEqual(out.map(s => s.text), ['Reply/prep task for Aon', 'Reply/prep task for Mercer']);
  assert.equal(out[1].reason, 'Meeting set with no open to-do');
});

test("check_co_owner: a touch within 7 d on a no-double-touch partner another team owns; HomeLover's own or untouched partners don't fire", () => {
  const upside = partner('Mercer', { no_double_touch: true, owner_team: 'upside', co_owner_name: 'Brad' });
  const both = partner('Marsh', { no_double_touch: true, owner_team: 'both', co_owner_name: null });
  const ours = partner('Aon', { no_double_touch: true, owner_team: 'homelover' });
  const stale = partner('Gallagher', { no_double_touch: true, owner_team: 'upside' });
  const events = [{ goal_id: upside.id, event: 'touch', at: iso(0) }, { goal_id: both.id, event: 'touch', at: iso(3) }, { goal_id: ours.id, event: 'touch', at: iso(1) }, { goal_id: stale.id, event: 'touch', at: iso(9) }, { goal_id: upside.id, event: 'status', at: iso(0) }];
  const out = checkCoOwner(ctx({ partners: [upside, both, ours, stale], events }));
  assert.deepEqual(out.map(s => s.text), ['Check with Brad about Mercer', 'Check with Both about Marsh']);
  assert.equal(out[0].reason, "Touched today · Upside owns it · don't double-touch");
});

test('flag_cold: an open flag older than 5 days', () => {
  const cold = todo('Follow up: Pat · Gallagher', { prospect_contact_id: 'c1', contacts: ['Pat Example', 'Gallagher'], created_at: iso(6) });
  const out = flagCold(ctx({ flags: [cold, todo('Follow up: Sam', { prospect_contact_id: 'c2', contacts: ['Sam'], created_at: iso(2) })] }));
  assert.deepEqual(out.map(s => [s.ref_type, s.ref_id, s.text]), [['flag', cold.id, 'Flag Pat Example is going cold']]);
});

test('runRules covers the ten kinds (REV5 adds nudge, signals-v1 visited_no_touch, company-panel-v2 interest_follow_up), each with a due rule; enrich is not a kind', () => {
  assert.equal(KINDS.length, 10);
  assert.ok(KINDS.includes('nudge'));
  assert.ok(KINDS.includes('visited_no_touch'));
  assert.ok(KINDS.includes('interest_follow_up')); assert.equal(DUE_DAYS.interest_follow_up, 0);
  assert.ok(!KINDS.includes('enrich'));
  for (const k of KINDS) assert.ok(k in DUE_DAYS, k);
  assert.deepEqual(runRules(ctx()), []);
});

// call-notes-targets-v1 REV5 - waiting rows (what a counterpart owes us).
const waitingRow = (who, text, extra) => ({ id: id(), text, waiting_on: who, status: 'open', due_date: null, link_type: 'partner', link_id: null, ...extra });

test('reply_task: an open waiting row on the partner counts as handled', () => {
  const p = partner('Equifax', { pipeline_status: 'meeting_set' });
  assert.equal(replyTask(ctx({ partners: [p] })).length, 1);
  assert.deepEqual(replyTask(ctx({ partners: [p], waiting: [waitingRow('Dana', 'Send the pricing sheet', { link_id: p.id })] })), []);
  assert.equal(replyTask(ctx({ partners: [p], waiting: [waitingRow('Dana', 'x', { link_id: p.id, status: 'done' })] })).length, 1);
});

test('waiting_overdue: fires once for a row 2+ days late; 1 day late, no date or done = nothing', () => {
  const p = partner('Equifax');
  const late = waitingRow('Dana', 'Confirm the bundle price', { link_id: p.id, due_date: '2026-10-14' });
  const rows = [late, waitingRow('Dana', 'x', { link_id: p.id, due_date: '2026-10-15' }), waitingRow('Dana', 'y', { link_id: p.id }), waitingRow('Dana', 'z', { link_id: p.id, due_date: '2026-10-01', status: 'done' })];
  const out = waitingOverdue(ctx({ partners: [p], waiting: rows }));
  assert.deepEqual(out.map(s => [s.kind, s.ref_type, s.ref_id, s.text]), [['nudge', 'todo', late.id, 'Nudge Dana at Equifax']]);
  assert.match(out[0].reason, /Confirm the bundle price · 2 days late/);
  assert.equal(runRules(ctx({ partners: [p], waiting: rows })).filter(s => s.kind === 'nudge').length, 1);
  assert.equal(DUE_DAYS.nudge, 0);
});

// company-panel-v2 D7 - one follow-up per linked person per signal; the key is the record + the signal's event id.
test('interest_follow_up: a linked person with a signal proposes once per signal (keyOf de-dupes); a person with an open to-do of their own is skipped; a signal with no event id never proposes', () => {
  const partnerId = id(), oppId = id(), click = id(), reply = id();
  const interest = [
    { ref_type: 'partner', ref_id: partnerId, contact_id: 'c-pat', name: 'Pat Lee', signal: { id: click, kind: 'click', count: 1, step: 1, at: '2026-10-15T12:00:00Z' } },
    { ref_type: 'opportunity', ref_id: oppId, contact_id: 'c-dana', name: 'Dana Q', signal: { id: reply, kind: 'reply', count: 1, step: 2, at: '2026-10-14T12:00:00Z' } },
    { ref_type: 'opportunity', ref_id: oppId, contact_id: 'c-busy', name: 'Busy Person', signal: { id: id(), kind: 'opens', count: 2, step: 1, at: '2026-10-14T12:00:00Z' } },
  ];
  const out = interestFollowUp(ctx({ interest, todos: [todo('Follow up: Busy', { prospect_contact_id: 'c-busy' })] }));
  assert.deepEqual(out.map(s => [s.kind, s.ref_type, s.ref_id, s.ref_id2, s.text]), [
    ['interest_follow_up', 'partner', partnerId, click, 'Follow up with Pat Lee — clicked Step 1'],
    ['interest_follow_up', 'opportunity', oppId, reply, 'Follow up with Dana Q — replied Step 2'],
  ]);
  assert.match(out[1].reason, /Dana Q replied Step 2 on 2026-10-14/);
  assert.equal(keyOf(out[0]), `interest_follow_up|partner|${partnerId}|${click}`);
  assert.notEqual(keyOf(out[0]), keyOf({ ...out[0], ref_id2: id() }));
  assert.deepEqual(interestFollowUp(ctx({ interest: [], todos: [] })), []);
  assert.deepEqual(runRules(ctx({ interest })).filter(s => s.kind === 'interest_follow_up').length, 3);
});
