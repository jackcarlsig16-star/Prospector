import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { installApolloFixture, apolloFixtureCalls } from './testing/apolloFixture.mjs';
import { syncActivity, ACTIVITY_MAX_CALLS } from './activitySync.js';

// FIX people-apollo-visibility-v1 F3a - the catch-up: batches of 30 back to back inside the step's own call budget.
// Fixture Apollo only (0 real calls); made-up ids, no addresses.
const B = 'b1';
const NOW = Date.now();
const hex = i => i.toString(16).padStart(24, '0'); // Apollo ids are 24-hex (apolloClient allowlist)
const msg = i => ({ id: hex(i), contact_id: `c${i}`, completed_at: new Date(NOW - i * 60e3).toISOString(), emailer_campaign_id: 's1', campaign_position: 1, from_email: null, stats: ['opened'] });
const activity = i => ({ num_opens: 1, emailer_message_events: [{ type: 'open', created_at: new Date(NOW - i * 60e3 + 3600e3).toISOString(), readable_user_agent: 'Gmail' }], contact: { id: `c${i}`, name: `Person ${i}` } });
// One message already fetched, so the run uses the steady-state batch of 30 (not the first backfill of 60).
const seed = () => fakeSupabase({ sales_email_messages: [{ business_id: B, apollo_message_id: 'old', activities_fetched_at: new Date(NOW - 864e5).toISOString() }], sales_email_activity: [], sales_prospect_state: [], sales_goals: [], sales_opportunities: [], partner_domains: [] });
const run = async (n, max = ACTIVITY_MAX_CALLS) => {
  const messages = Array.from({ length: n }, (_, i) => msg(i));
  const restore = installApolloFixture({}, null, { messages, activities: Object.fromEntries(messages.map((m, i) => [m.id, activity(i)])) });
  apolloFixtureCalls.length = 0;
  const s = seed();
  const ctx = { callCounter: { count: 0, max }, endpointCounts: {} };
  try { return { ...(await syncActivity({ ctx, supabase: s, businessId: B })), ctx, s }; } finally { restore(); }
};

test('catch-up: 45 waiting -> two batches in one run, nothing left, inside the budget', async () => {
  const r = await run(45);
  assert.deepEqual([r.counts.activities_fetched, r.counts.activity_batches, r.counts.backlog_after_run], [45, 2, 0]);
  assert.equal(r.ctx.callCounter.count, 3 + 45, '3 searches + 45 activity reads');
  assert.ok(r.ctx.callCounter.count <= ACTIVITY_MAX_CALLS);
  assert.equal(r.s.db.sales_email_activity.length, 45);
  assert.ok(!r.missing.some(m => /budget/.test(m)));
});

test('catch-up stops at the budget and says how many are left', async () => {
  const r = await run(100);
  const searches = apolloFixtureCalls.filter(c => c === 'GET /emailer_messages/search').length; // a full page of 100 asks for page 2
  const reads = ACTIVITY_MAX_CALLS - searches;
  assert.deepEqual([r.counts.activities_fetched, r.counts.backlog_after_run, r.ctx.callCounter.count], [reads, 100 - reads, ACTIVITY_MAX_CALLS]);
  assert.equal(r.counts.activity_batches, Math.ceil(reads / 30));
  assert.ok(r.missing.some(m => m === `activity: call budget spent - ${100 - reads} messages carried to the next run`), r.missing.join(' | '));
  assert.ok(apolloFixtureCalls.every(c => /^GET \/emailer_messages\//.test(c)), 'only the two allowlisted email reads');
});

test('nothing waiting -> one search pass, no activity reads, 0 left', async () => {
  const r = await run(0);
  assert.deepEqual([r.counts.activities_fetched, r.counts.activity_batches, r.counts.backlog_after_run, r.ctx.callCounter.count], [0, 0, 0, 3]);
});
