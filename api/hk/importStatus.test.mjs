// node --test api/hk/importStatus.test.mjs
// hkos-sheet-import-v1 Stage 1 - S3 status normalization on invented cells. 0 network, 0 DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStatus, parseDates, mostAdvanced, ADVANCE_ORDER } from './importStatus.js';

const TODAY = '2026-10-27';
const codes = r => r.warnings.map(w => w.code);
const run = o => normalizeStatus({ today: TODAY, ...o });

test('parseDates: M/D takes the default year, M/D/YY and M/D/YYYY keep theirs, ISO passes, junk is dropped', () => {
  assert.deepEqual(parseDates('9/12'), ['2026-09-12']);
  assert.deepEqual(parseDates('10/3/25'), ['2025-10-03']);
  assert.deepEqual(parseDates('6/1/2026, 6/9/26'), ['2026-06-01', '2026-06-09']);
  assert.deepEqual(parseDates('2026-10-03'), ['2026-10-03']);
  assert.deepEqual(parseDates('13/40 and 20%'), []);
  assert.deepEqual(parseDates(''), []);
});

test('"Email sent 9/12" -> sent, one cold email touch on that date, no warning', () => {
  const r = run({ status: 'Email sent 9/12' });
  assert.equal(r.status, 'sent');
  assert.deepEqual(r.touches, [{ kind: 'cold', channel: 'email', state: 'sent', at: '2026-09-12', sender: 'owner' }]);
  assert.deepEqual(codes(r), []); assert.equal(r.note, null);
});

test('"Email sent" with the date in the Outreach Date cell uses that cell', () => {
  const r = run({ status: 'Email sent', outreachDate: '2026-09-20' });
  assert.equal(r.status, 'sent'); assert.equal(r.touches[0].at, '2026-09-20');
});

test('"Email sent" with no date anywhere -> sent + a touch without a date + missing_date warning', () => {
  const r = run({ status: 'Email sent' });
  assert.equal(r.status, 'sent'); assert.equal(r.touches[0].at, null); assert.deepEqual(codes(r), ['missing_date']);
});

test('"Email drafted 10/3" -> drafted, a drafted cold touch, draft_not_linked warning', () => {
  const r = run({ status: 'Email drafted 10/3' });
  assert.equal(r.status, 'drafted');
  assert.deepEqual(r.touches, [{ kind: 'cold', channel: 'email', state: 'drafted', at: '2026-10-03', sender: 'owner' }]);
  assert.deepEqual(codes(r), ['draft_not_linked']);
});

test('"IG DM ready" -> claimed with a drafted Instagram DM touch', () => {
  const r = run({ status: 'IG DM ready' });
  assert.equal(r.status, 'claimed');
  assert.deepEqual(r.touches, [{ kind: 'dm_text', channel: 'ig_dm', state: 'drafted', at: null, sender: 'owner' }]);
  assert.deepEqual(codes(r), []);
});

test('"Meeting with Ana on 10/9" -> meeting; the date in the status is the sent touch when Outreach Date is empty', () => {
  const r = run({ status: 'Meeting with Ana on 10/9' });
  assert.equal(r.status, 'meeting'); assert.equal(r.touches.length, 1); assert.equal(r.touches[0].at, '2026-10-09');
});

test('"Responded with questions on 10/2" and "Replied on IG; email drafted 10/4" -> replied; the second also carries the draft', () => {
  const a = run({ status: 'Responded with questions on 10/2', outreachDate: '9/25' });
  assert.equal(a.status, 'replied'); assert.deepEqual(a.touches.map(t => [t.kind, t.at]), [['cold', '2026-09-25']]);
  const b = run({ status: 'Replied on IG; email drafted 10/4' });
  assert.equal(b.status, 'replied'); assert.deepEqual(b.touches.map(t => [t.kind, t.state, t.at]), [['cold', 'drafted', '2026-10-04']], 'the date belongs to the draft, not a send');
  assert.deepEqual(codes(b), ['draft_not_linked']);
});

test('"In" -> unmapped_status warning, text kept as the note, brand stays candidate', () => {
  const r = run({ status: 'In' });
  assert.equal(r.status, 'candidate'); assert.deepEqual(codes(r), ['unmapped_status']); assert.equal(r.note, 'In'); assert.deepEqual(r.touches, []);
});

test('"Done." and "Need to set up" (sponsor-tab words) are unmapped here too - the plan keeps them as period notes', () => {
  for (const s of ['Done.', 'Need to set up']) { const r = run({ status: s }); assert.equal(r.status, 'candidate'); assert.deepEqual(codes(r), ['unmapped_status']); assert.equal(r.note, s); }
});

test('two dates in Outreach Date -> cold + bump sent, status bumped; three -> final_sent; four -> extra_dates warning', () => {
  const two = run({ outreachDate: '9/1/2026, 9/8/26' });
  assert.equal(two.status, 'bumped'); assert.deepEqual(two.touches.map(t => t.kind), ['cold', 'bump']);
  const three = run({ outreachDate: '9/1\n9/8\n9/15' });
  assert.equal(three.status, 'final_sent'); assert.deepEqual(three.touches.map(t => [t.kind, t.at]), [['cold', '2026-09-01'], ['bump', '2026-09-08'], ['final', '2026-09-15']]);
  const four = run({ outreachDate: '9/1, 9/8, 9/15, 9/22' });
  assert.equal(four.touches.length, 3); assert.deepEqual(codes(four), ['extra_dates']);
});

test('dates with a "replied" status: the touches come from the dates, the status from the text (more advanced)', () => {
  const r = run({ status: 'Replied 10/5', outreachDate: '9/1, 9/8' });
  assert.equal(r.status, 'replied'); assert.deepEqual(r.touches.map(t => t.kind), ['cold', 'bump']);
});

test('a future date is imported as given and flagged once', () => {
  const r = run({ status: 'Email sent 12/24' });
  assert.equal(r.touches[0].at, '2026-12-24'); assert.deepEqual(codes(r), ['future_date']); assert.equal(r.warnings[0].detail, '2026-12-24');
  const past = run({ status: 'Email sent 12/24/25' });
  assert.deepEqual(codes(past), []);
});

test('empty status with no date -> candidate, nothing else; a lone date -> sent', () => {
  const none = run({}); assert.equal(none.status, 'candidate'); assert.deepEqual(none.touches, []); assert.deepEqual(none.warnings, []);
  const dated = run({ outreachDate: '2026-08-14' }); assert.equal(dated.status, 'sent'); assert.equal(dated.touches[0].kind, 'cold');
});

test("Jack's column on Pete's row -> an extra outside email touch sent by Jack", () => {
  const r = run({ status: 'IG DM ready', jackOutreach: '10/1' });
  assert.deepEqual(r.touches.at(-1), { kind: 'outside', channel: 'email', state: 'sent', at: '2026-10-01', sender: 'jack' });
  assert.equal(r.status, 'claimed', 'an outside touch does not move the status');
});

test('unknown text -> unmapped_status, note kept, dates still read', () => {
  const r = run({ status: 'Waiting on their marketing lead', outreachDate: '9/30' });
  assert.equal(r.status, 'sent'); assert.deepEqual(codes(r), ['unmapped_status']); assert.equal(r.note, 'Waiting on their marketing lead');
});

test('"sent" (Jack tab) reads as sent; whitespace and case do not matter', () => {
  const r = run({ status: '  SENT ', outreachDate: '10/10' });
  assert.equal(r.status, 'sent'); assert.equal(r.touches[0].at, '2026-10-10');
});

test('status order: mostAdvanced follows candidate < claimed < drafted < sent < bumped < final_sent < replied < meeting < signed < sponsor', () => {
  assert.equal(ADVANCE_ORDER.join(','), 'candidate,claimed,drafted,sent,bumped,final_sent,replied,meeting,signed,sponsor');
  assert.equal(mostAdvanced('drafted', 'sent'), 'sent'); assert.equal(mostAdvanced('meeting', 'sent'), 'meeting'); assert.equal(mostAdvanced('sponsor', 'replied'), 'sponsor');
});

test('no cell ever yields an address or a phone in the output', () => {
  const r = run({ status: 'Replied ana@brand.invalid 312-555-0100 on 10/2', outreachDate: '9/1' });
  assert.ok(!JSON.stringify({ status: r.status, touches: r.touches, warnings: r.warnings }).includes('@'), 'touches/warnings carry no address');
  assert.equal(r.status, 'replied');
});
