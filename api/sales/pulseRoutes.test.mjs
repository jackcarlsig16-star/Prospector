// node --test api/sales/pulseRoutes.test.mjs
// dashboard-v3 Stage 5 - the Pulse's first-touched goal: the month row when one is set, else the latest week goal on or
// before this Monday carried forward (the Scorecard's rule), else none. 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { monthGoal } from './pulseRoutes.js';

const B = randomUUID();
const row = (period, period_start, goal, metric_key = 'partners_first_touched') => ({ business_id: B, period, period_start, metric_key, goal, unit: 'people' });

test('monthGoal: a week goal from October carries into November (carried: true); a month row wins; nothing -> null', async () => {
  const s = fakeSupabase({ sales_metric_targets: [row('week', '2026-10-05', 100), row('week', '2026-12-07', 500), row('week', '2026-10-05', 12, 'sequences_running')] });
  assert.deepEqual(await monthGoal(s, B, '2026-11-05'), { goal: 100, unit: 'people', carried: true });
  const m = fakeSupabase({ sales_metric_targets: [row('week', '2026-10-05', 100), row('month', '2026-11-01', 120)] });
  assert.deepEqual(await monthGoal(m, B, '2026-11-05'), { goal: 120, unit: 'people', carried: false });
  const none = fakeSupabase({ sales_metric_targets: [row('week', '2026-12-07', 500)] });
  assert.equal(await monthGoal(none, B, '2026-11-05'), null);
});
