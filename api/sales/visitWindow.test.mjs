// node --test api/sales/visitWindow.test.mjs
// FIX visit-window-v1 Stage 1 - the pure window rule and the migration text. No DB, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { windowFor, LOOKBACK_CAP, BACKFILL_DAYS } from './visitWindow.js';

const TODAY = '2026-10-27';

test('no history -> 1 day: window yesterday..today, kind daily', () => {
  assert.deepEqual(windowFor(null, TODAY), { kind: 'daily', lookback_days: 1, window_start: '2026-10-26', window_end: TODAY });
  assert.deepEqual(windowFor(undefined, TODAY), windowFor(null, TODAY));
  assert.deepEqual(windowFor('not a date', TODAY), windowFor(null, TODAY));
});

test('last ok run ended yesterday -> 1 (the normal daily run); ended today (Pull now again) -> still 1, never 0', () => {
  assert.equal(windowFor('2026-10-26', TODAY).lookback_days, 1);
  assert.deepEqual(windowFor(TODAY, TODAY), { kind: 'daily', lookback_days: 1, window_start: '2026-10-26', window_end: TODAY });
  assert.equal(windowFor('2026-10-28', TODAY).lookback_days, 1, 'a window end in the future clamps to 1');
});

test('3-day gap: last ok window ended on the 23rd -> lookback 4 covers the 24th, 25th, 26th and today', () => {
  assert.deepEqual(windowFor('2026-10-23', TODAY), { kind: 'daily', lookback_days: 4, window_start: '2026-10-23', window_end: TODAY });
});

test('cap: a 60-day gap asks for LOOKBACK_CAP (30) days; the cap is an option', () => {
  assert.equal(windowFor('2026-08-28', TODAY).lookback_days, LOOKBACK_CAP);
  assert.equal(windowFor('2026-08-28', TODAY).window_start, '2026-09-27');
  assert.equal(windowFor('2026-08-28', TODAY, { cap: 7 }).lookback_days, 7);
});

test('backfill 14: ignores history (even an ok run yesterday), kind backfill, window today-14..today; still capped', () => {
  assert.deepEqual(windowFor('2026-10-26', TODAY, { backfillDays: BACKFILL_DAYS }), { kind: 'backfill', lookback_days: 14, window_start: '2026-10-13', window_end: TODAY });
  assert.equal(windowFor(null, TODAY, { backfillDays: 14 }).lookback_days, 14);
  assert.equal(windowFor(null, TODAY, { backfillDays: 90 }).lookback_days, LOOKBACK_CAP);
  assert.equal(windowFor(null, TODAY, { backfillDays: 0 }).lookback_days, 1);
});

test('DST and month edges: the day count is calendar days, not 24-hour blocks', () => {
  assert.equal(windowFor('2026-10-31', '2026-11-02').lookback_days, 2);
  assert.equal(windowFor('2026-02-27', '2026-03-02').lookback_days, 3);
  assert.throws(() => windowFor(null, '27/10/2026'), /LA date/);
});

test('migration text: the four run columns with the daily|backfill CHECK, the index recreated per (business_id, la_date, kind), seen_from / seen_to with the backfill of existing rows, no deletes, proof rows', () => {
  const sql = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'supabase', 'migrations', '20261027_fix_visit_window_v1.sql'), 'utf8');
  assert.ok(sql.includes("ALTER TABLE public.visit_pull_runs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'daily' CHECK (kind IN ('daily', 'backfill'));"));
  for (const c of ['window_start date', 'window_end date', 'lookback_days int']) assert.ok(sql.includes(`ALTER TABLE public.visit_pull_runs ADD COLUMN IF NOT EXISTS ${c}`), c);
  assert.ok(sql.includes('UPDATE public.visit_pull_runs SET window_end = la_date, window_start = la_date - 1, lookback_days = 1 WHERE window_end IS NULL;'));
  assert.ok(sql.includes('DROP INDEX IF EXISTS public.visit_pull_runs_day_idx;'));
  assert.ok(sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS visit_pull_runs_day_idx ON public.visit_pull_runs (business_id, la_date, kind);'));
  for (const c of ['seen_from date', 'seen_to date']) assert.ok(sql.includes(`ALTER TABLE public.web_visits ADD COLUMN IF NOT EXISTS ${c};`), c);
  assert.ok(sql.includes('UPDATE public.web_visits SET seen_from = pulled_on, seen_to = pulled_on WHERE seen_from IS NULL OR seen_to IS NULL;'));
  assert.doesNotMatch(sql, /DELETE FROM|DROP TABLE|DROP COLUMN/);
  assert.equal((sql.match(/^UPDATE /gm) || []).length, 2, 'exactly the two backfills');
  assert.ok(sql.includes('-- Proof - expect 5 rows'));
  assert.ok(!sql.includes('@'));
});
