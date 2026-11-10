// node --test api/sales/visitTrend.test.mjs
// visitor-trend-v1 Stage 1 (T1, rulings R1-R3, R5): the windows come from the rows' (seen_from, seen_to); a backfill is
// hidden but seeds "first seen"; a Fri-Sun pull is one bar; two overlapping pulls on one day merge into one bar with the
// companies de-duplicated; a zero-length window is a day bar; new + returning = the window's companies; Sunday bars
// stay; the route clamps days. Invented companies, keys only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { buildTrend, visitorsTrend, coveredDays, windowLabel, clampDays, DAYS_DEFAULT } from './visitTrend.js';
import { seenBeforeKeys, isNewCompany } from './visitRules.js';

const B = '00000000-0000-4000-8000-0000000000b1';
let n = 0;
const row = (key, seen_from, seen_to, pulled_on = seen_to, visits_7d = 1) => ({ id: `r${String(++n).padStart(3, '0')}`, business_id: B, company_key: key, pulled_on, seen_from, seen_to, visits_7d });
const TODAY = '2026-11-10';
const ROWS = [
  // The Oct 27 backfill (14 d): hidden from the bars, but it is where a, b, c were first seen.
  row('a', '2026-10-13', '2026-10-27', '2026-10-27'), row('b', '2026-10-13', '2026-10-27', '2026-10-27'), row('c', '2026-10-13', '2026-10-27', '2026-10-27'),
  // The Oct 27 daily pull on the same day (Oct 26 -> 27): its own bar, a returning + d new.
  row('a', '2026-10-26', '2026-10-27'), row('d', '2026-10-26', '2026-10-27'),
  // A pre-fix zero-length window (Oct 21): a day bar.
  row('z', '2026-10-21', '2026-10-21'),
  // Thu Nov 5 (pulled Fri Nov 6): b returning, e new, 3 visits.
  row('b', '2026-11-05', '2026-11-06', '2026-11-06', 2), row('e', '2026-11-05', '2026-11-06', '2026-11-06', 1),
  // Mon Nov 9: the 06:30 Fri-Sun pull (a, f) and a later same-day re-pull Nov 8 -> 9 (f again with a newer count, g): ONE bar.
  row('a', '2026-11-06', '2026-11-09', '2026-11-09', 4), row('f', '2026-11-06', '2026-11-09', '2026-11-09', 1),
  row('f', '2026-11-08', '2026-11-09', '2026-11-09', 7), row('g', '2026-11-08', '2026-11-09', '2026-11-09', 2),
  // A Sunday pull (Nov 1, covering Sat Oct 31): its own bar.
  row('c', '2026-10-31', '2026-11-01'),
];
const RUNS = [
  { id: 'run-bf', business_id: B, la_date: '2026-10-27', kind: 'backfill', status: 'ok', window_start: '2026-10-13', window_end: '2026-10-27' },
  { id: 'run-d', business_id: B, la_date: '2026-10-27', kind: 'daily', status: 'ok', window_start: '2026-10-26', window_end: '2026-10-27' },
  // The Nov 9 run row after the re-pull overwrote it: says Nov 8 -> 9 - never read as a window (R2).
  { id: 'run-9', business_id: B, la_date: '2026-11-09', kind: 'daily', status: 'ok', window_start: '2026-11-08', window_end: '2026-11-09' },
];

test('coveredDays + windowLabel: a window covers seen_from .. seen_to - 1; a zero-length window covers its one day; labels read "Thu Nov 5" / "Fri–Sun Nov 6–8" / across a month end', () => {
  assert.deepEqual(coveredDays('2026-11-05', '2026-11-06'), ['2026-11-05']);
  assert.deepEqual(coveredDays('2026-11-06', '2026-11-09'), ['2026-11-06', '2026-11-07', '2026-11-08']);
  assert.deepEqual(coveredDays('2026-10-21', '2026-10-21'), ['2026-10-21']);
  assert.equal(windowLabel(['2026-11-05']), 'Thu Nov 5');
  assert.equal(windowLabel(['2026-11-06', '2026-11-07', '2026-11-08']), 'Fri–Sun Nov 6–8');
  assert.equal(windowLabel(['2026-10-30', '2026-10-31', '2026-11-01']), 'Fri–Sun Oct 30–Nov 1');
});

test('R5: the one rule - seen before = any row with seen_from before the first day; a row without seen_from never counts', () => {
  const rows = [{ company_key: 'a', seen_from: '2026-11-01' }, { company_key: 'b', seen_from: null }, { company_key: 'c', seen_from: '2026-11-05' }];
  const seen = seenBeforeKeys(rows, '2026-11-05');
  assert.deepEqual([...seen].sort(), ['a']);
  assert.deepEqual(['a', 'b', 'c', 'x'].map(k => isNewCompany(k, seen)), [false, true, true, true]);
});

test('buildTrend: windows from the rows (the run rows are never the source), the backfill hidden but seeding first-seen, the Fri-Sun bar, the same-day overlap merge with de-duplicated companies, the zero-length day bar, the Sunday bar, new + returning = companies, since = the first bar', () => {
  const t = buildTrend({ rows: ROWS, runs: RUNS, today: TODAY, days: 30 });
  assert.deepEqual(t.windows.map(w => [w.label, w.start, w.end, w.companies, w.new, w.returning, w.visits_7d, w.merged]), [
    ['Wed Oct 21', '2026-10-21', '2026-10-21', 1, 1, 0, 1, 1],
    ['Mon Oct 26', '2026-10-26', '2026-10-27', 2, 1, 1, 2, 1],
    ['Sat Oct 31', '2026-10-31', '2026-11-01', 1, 0, 1, 1, 1],
    ['Thu Nov 5', '2026-11-05', '2026-11-06', 2, 1, 1, 3, 1],
    ['Fri–Sun Nov 6–8', '2026-11-06', '2026-11-09', 3, 2, 1, 13, 2],
  ]);
  const mon = t.windows[4];
  assert.deepEqual([mon.company_keys, mon.new_keys, mon.days], [['a', 'f', 'g'], ['f', 'g'], ['2026-11-06', '2026-11-07', '2026-11-08']], 'f once (its newer re-pull row, 7 visits), a returning (the backfill saw it), f + g new');
  assert.ok(t.windows.every(w => w.new + w.returning === w.companies && w.companies === w.company_keys.length));
  assert.ok(!t.windows.some(w => w.start === '2026-10-13'), 'the 14-day backfill is not a bar');
  assert.equal(t.windows[1].returning, 1, 'a on Oct 26 is returning only because the hidden backfill seeded it');
  assert.deepEqual([t.since, t.days, t.today], ['2026-10-21', 30, TODAY]);
  assert.deepEqual(t.summary, { windows: 5, companies: 8, company_windows: 9, new: 5, returning: 4, visits_7d: 20, busiest: { label: 'Fri–Sun Nov 6–8', start: '2026-11-06', companies: 3 } });
});

test('buildTrend: the range is window_end >= today - (days - 1); a shorter range drops the old bars and since moves; no rows = no windows, since null', () => {
  const t7 = buildTrend({ rows: ROWS, runs: RUNS, today: TODAY, days: 7 });
  assert.deepEqual(t7.windows.map(w => w.label), ['Thu Nov 5', 'Fri–Sun Nov 6–8']);
  assert.equal(t7.since, '2026-11-05');
  assert.equal(t7.windows[1].returning, 1, 'a stays returning: first-seen reads the whole table, not the range');
  const empty = buildTrend({ rows: [], runs: [], today: TODAY });
  assert.deepEqual([empty.windows, empty.since, empty.summary.busiest, empty.days], [[], null, null, DAYS_DEFAULT]);
});

test('buildTrend: a backfill is matched by pulled_on + its own window only - a daily pull on the backfill day keeps its bar; a run row whose window was overwritten hides nothing', () => {
  const overwritten = [{ id: 'x', business_id: B, la_date: '2026-10-27', kind: 'backfill', status: 'ok', window_start: '2026-10-26', window_end: '2026-10-27' }];
  const t = buildTrend({ rows: ROWS, runs: overwritten, today: TODAY, days: 30 });
  assert.ok(t.windows.some(w => w.start === '2026-10-13' && w.companies === 3), 'the real backfill rows show as a (wide) bar when no run row names their window - visible, never silently dropped');
  assert.ok(!t.windows.some(w => w.start === '2026-10-26'), 'the daily rows that match the overwritten window are hidden instead');
});

test('route: GET goals/visitors/trend reads web_visits + the backfill runs, clamps days to 7..90 (default 30), never returns a name', async () => {
  const db = fakeSupabase({ web_visits: [...ROWS, { ...row('other', '2026-11-05', '2026-11-06'), business_id: '00000000-0000-4000-8000-0000000000b2' }], visit_pull_runs: RUNS });
  const r = await visitorsTrend(db, B, { days: '30', now: Date.parse('2026-11-10T18:00:00Z') });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.windows.length, r.body.since, r.body.summary.companies], [5, '2026-10-21', 8], 'another workspace never leaks');
  assert.deepEqual([clampDays('30'), clampDays('3'), clampDays('400'), clampDays('x'), clampDays(undefined)], [30, 7, 90, 30, 30]);
  assert.equal((await visitorsTrend(db, B, { days: 'junk', now: Date.parse('2026-11-10T18:00:00Z') })).body.days, 30);
  assert.ok(!/company_name|@/.test(JSON.stringify(r.body)));
});
