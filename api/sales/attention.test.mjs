// node --test api/sales/attention.test.mjs  (react-scripts' Jest only runs src/)
// actions-home-attention-v1 Stage 2 - each source's status rules (ok / stale / failed / running / dead running / not
// connected) and the counts, against the in-memory Supabase. Made-up names; 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { apolloLine, outlookLine, dailyLine, researchLine, visitWindow, attention, attentionCount, heldCounts, HELD_CACHE_MS } from './attentionRoutes.js';

const NOW = Date.parse('2026-10-22T19:00:00Z'); // Thu 12:00 LA
const EARLY = Date.parse('2026-10-22T15:00:00Z'); // Thu 08:00 LA
const SAT = Date.parse('2026-10-24T19:00:00Z');
const ago = h => new Date(NOW - h * 3600e3).toISOString();
const B = randomUUID(), JACK = randomUUID(), CY = randomUUID();

test('Apollo: ok within 24 h, stale after, failed on an errored or stuck latest run, running while fresh', () => {
  assert.equal(apolloLine([{ status: 'success', started_at: ago(3), finished_at: ago(3) }], NOW).status, 'ok');
  assert.equal(apolloLine([{ status: 'partial', started_at: ago(3), finished_at: ago(3) }], NOW).status, 'ok');
  assert.equal(apolloLine([{ status: 'success', started_at: ago(30), finished_at: ago(30) }], NOW).status, 'stale');
  assert.equal(apolloLine([], NOW).status, 'stale');
  // FIX people-apollo-visibility-v1 F3c - the last good run's leftover messages.
  assert.equal(apolloLine([{ status: 'success', started_at: ago(3), finished_at: ago(3), counts: { activity: { backlog_after_run: 13 } } }], NOW).left, 13);
  assert.equal(apolloLine([{ status: 'success', started_at: ago(3), finished_at: ago(3), counts: {} }], NOW).left, 0);
  const f = apolloLine([{ status: 'error', started_at: ago(1), finished_at: ago(1), error_text: 'Apollo 401' }, { status: 'success', started_at: ago(5), finished_at: ago(5) }], NOW);
  assert.deepEqual([f.status, f.error, f.last_ok_at], ['failed', 'Apollo 401', ago(5)]);
  assert.equal(apolloLine([{ status: 'running', started_at: ago(0.2) }], NOW).status, 'running');
  assert.match(apolloLine([{ status: 'running', started_at: ago(1) }], NOW).error, /stuck/);
});

test('Outlook: no grant = not connected; a grant error = failed; folder error, dead run, weekday staleness', () => {
  assert.equal(outlookLine(null, [], NOW).status, 'not_connected');
  assert.match(outlookLine({ error: 'token revoked' }, [], NOW).error, /token revoked - reconnect in Connections/);
  const run = (h, extra) => ({ folder: 'inbox', started_at: ago(h), finished_at: ago(h), error: null, ...extra });
  assert.equal(outlookLine({}, [run(2), run(2.01, { folder: 'sentitems' })], NOW).status, 'ok');
  assert.equal(outlookLine({}, [run(30)], NOW).status, 'stale');
  assert.equal(outlookLine({}, [{ ...run(30), started_at: new Date(SAT - 30 * 3600e3).toISOString() }], SAT).status, 'ok', 'no weekend staleness');
  assert.deepEqual([outlookLine({}, [run(1), run(1.01, { folder: 'calendar', error: 'Graph 503' })], NOW).status, outlookLine({}, [run(1), run(1.01, { folder: 'calendar', error: 'Graph 503' })], NOW).error], ['failed', 'calendar: Graph 503']);
  assert.equal(outlookLine({}, [{ folder: 'inbox', started_at: ago(0.1), finished_at: null }], NOW).status, 'running');
  assert.equal(outlookLine({}, [{ folder: 'inbox', started_at: ago(2), finished_at: null }], NOW).status, 'failed');
  assert.equal(outlookLine({}, [], NOW).status, 'stale');
});

test('daily rule (visitors / Tidy): ok today, failed on an error today, running / dead running, stale only after 10 AM', () => {
  const opts = now => ({ now, dateOf: r => r.la_date, startedOf: r => r.at, deadMs: 10 * 60e3, errorOf: r => r.error });
  const row = (la_date, status, h, extra) => ({ la_date, status, at: ago(h), ...extra });
  assert.equal(dailyLine('visitors', [row('2026-10-22', 'ok', 3)], opts(NOW)).status, 'ok');
  assert.deepEqual(['status', 'error'].map(k => dailyLine('visitors', [row('2026-10-22', 'error', 1, { error: 'credit cap' })], opts(NOW))[k]), ['failed', 'credit cap']);
  assert.equal(dailyLine('visitors', [row('2026-10-22', 'running', 0.05)], opts(NOW)).status, 'running');
  assert.equal(dailyLine('visitors', [row('2026-10-22', 'running', 1)], opts(NOW)).status, 'failed');
  assert.equal(dailyLine('visitors', [row('2026-10-21', 'ok', 24)], opts(NOW)).status, 'stale');
  assert.equal(dailyLine('visitors', [row('2026-10-21', 'ok', 20)], opts(EARLY)).status, 'ok', 'before 10 AM yesterday stands');
  assert.equal(dailyLine('tidy', [], opts(NOW)).last_at, null);
});

test('research: failed only when the latest run errored or died running', () => {
  assert.equal(researchLine([], NOW).status, 'ok');
  assert.equal(researchLine([{ status: 'done', created_at: ago(40) }], NOW).status, 'ok');
  assert.deepEqual(['status', 'error'].map(k => researchLine([{ status: 'error', error: 'model timeout', created_at: ago(1) }], NOW)[k]), ['failed', 'model timeout']);
  assert.equal(researchLine([{ status: 'running', created_at: ago(0.05) }], NOW).status, 'running');
  assert.equal(researchLine([{ status: 'queued', created_at: ago(1) }], NOW).status, 'failed');
});

test('attention: the caller\'s counts (their overdue to-dos, campaign sends + replies), n = not-ok lines; no address in the reply', async () => {
  const today = '2026-10-22';
  const camp = randomUUID();
  const s = fakeSupabase({
    sales_sync_runs: [{ business_id: B, trigger: 'manual', status: 'success', started_at: '2026-10-15T18:00:00Z', finished_at: '2026-10-15T18:05:00Z' }],
    microsoft_grants: [{ user_id: JACK, account_email: 'jack@homelover.example', error: null }],
    microsoft_sync_runs: [{ user_id: JACK, business_id: B, folder: 'inbox', dry_run: false, started_at: ago(2), finished_at: ago(2), error: null }],
    visit_pull_runs: [{ business_id: B, la_date: today, kind: 'daily', window_start: '2026-10-21', window_end: today, lookback_days: 1, status: 'ok', error: null, created_at: ago(5), updated_at: ago(5) }],
    web_visits: [{ business_id: B, company_key: 'alder', pulled_on: today }, { business_id: B, company_key: 'birch', pulled_on: today }, { business_id: B, company_key: 'cedar', pulled_on: '2026-10-21' }],
    sales_tidy_runs: [{ business_id: B, status: 'error', started_at: ago(4), finished_at: ago(4), counts: { error: 'boom' } }],
    research_runs: [],
    sales_week_goals: [
      { id: randomUUID(), business_id: B, kind: 'todo', owner_user_id: JACK, status: 'open', due_date: '2026-10-20' },
      { id: randomUUID(), business_id: B, kind: 'todo', owner_user_id: CY, status: 'open', due_date: '2026-10-20' },
      { id: randomUUID(), business_id: B, kind: 'todo', owner_user_id: JACK, status: 'done', due_date: '2026-10-20' },
      { id: randomUUID(), business_id: B, kind: 'todo', owner_user_id: JACK, status: 'open', due_date: today },
      { id: randomUUID(), business_id: B, kind: 'waiting', status: 'open', due_date: '2026-10-19' },
    ],
    sales_goals: [], partner_contacts: [], sales_partner_events: [], sales_email_messages: [], partner_domains: [], microsoft_messages: [], microsoft_events: [], sales_mailbox_owners: [],
    sales_outreach_campaigns: [{ id: camp, business_id: B, name: 'Fall', status: 'active' }],
    sales_outreach_tracks: [], sales_outreach_steps: [], sales_outreach_events: [],
    sales_outreach_contacts: [
      { id: randomUUID(), campaign_id: camp, business_id: B, name: 'Ana', email: 'ana@alder.example', owner_user_id: JACK, status: 'active', next_due_date: '2026-10-21', current_step: 1 },
      { id: randomUUID(), campaign_id: camp, business_id: B, name: 'Ben', email: 'ben@birch.example', owner_user_id: JACK, status: 'active', next_due_date: '2026-10-29', current_step: 2 },
      { id: randomUUID(), campaign_id: camp, business_id: B, name: 'Cleo', email: 'cleo@cedar.example', owner_user_id: JACK, status: 'replied', current_step: 1 },
      { id: randomUUID(), campaign_id: camp, business_id: B, name: 'Dev', email: 'dev@dune.example', owner_user_id: CY, status: 'active', next_due_date: today, current_step: 1 },
    ],
  });
  const dry = { apollo: async () => ({ held: [] }), outlook: async () => ({ held: [] }) };
  const r = await attention(s, { businessId: B, userId: JACK, now: NOW, dry, fresh: true });
  assert.ok(!JSON.stringify(r).includes('@'), 'no address in the reply');
  assert.deepEqual(r.sources.map(x => [x.id, x.status]), [['apollo', 'stale'], ['outlook', 'ok'], ['visitors', 'ok'], ['tidy', 'failed'], ['research', 'ok']]);
  assert.equal(r.sources.find(x => x.id === 'tidy').error, 'boom');
  assert.deepEqual(r.sources.find(x => x.id === 'visitors').window, { window_start: '2026-10-21', window_end: today, lookback_days: 1, kind: 'daily', companies: 2, last_ok_at: ago(5), gap: false });
  assert.deepEqual(r.counts, { overdue_todos: 1, overdue_waiting: 1, held_apollo: 0, held_outlook: 0, campaign_sends: 1, campaign_replies: 1 });
  assert.equal(r.n, 2 + 4);
  const cy = await attention(s, { businessId: B, userId: CY, now: NOW, dry });
  assert.deepEqual([cy.sources[1].status, cy.counts.overdue_todos, cy.counts.campaign_sends, cy.counts.campaign_replies], ['not_connected', 1, 1, 0]);
  assert.equal(attentionCount({ sources: [{ status: 'running' }, { status: 'not_connected' }, { status: 'ok' }], counts: { a: 0 } }), 0);
});

test('held moves: read once per workspace for 15 min; fresh reads anew', async () => {
  let reads = 0;
  const dry = { apollo: async () => { reads++; return { held: [1, 2] }; }, outlook: async () => ({ held: [1] }) };
  const W = randomUUID();
  const a = await heldCounts(null, W, { now: NOW, dry });
  const b = await heldCounts(null, W, { now: NOW + HELD_CACHE_MS - 1, dry });
  const c = await heldCounts(null, W, { now: NOW + 60e3, dry, fresh: true });
  const d = await heldCounts(null, W, { now: NOW + 60e3 + HELD_CACHE_MS + 1, dry });
  assert.deepEqual([a.apollo, a.outlook, b.at, reads], [2, 1, NOW, 3]);
  assert.equal(c.at, NOW + 60e3);
  assert.equal(d.at, NOW + 60e3 + HELD_CACHE_MS + 1);
});

// FIX visit-window-v1 W6 - the visitors line's window + gap.
test('visit window: the last ok run\'s window and company count; gap when there is no ok run or its window_end is older than yesterday', () => {
  const run = (la_date, window_end, status = 'ok', extra = {}) => ({ la_date, kind: 'daily', window_start: '2026-10-01', window_end, lookback_days: 1, status, created_at: ago(3), updated_at: ago(2), ...extra });
  assert.deepEqual(visitWindow([], 0, NOW), { window_start: null, window_end: null, lookback_days: null, kind: null, companies: 0, last_ok_at: null, gap: true });
  assert.equal(visitWindow([run('2026-10-22', '2026-10-22')], 138, NOW).gap, false);
  assert.equal(visitWindow([run('2026-10-21', '2026-10-21')], 5, NOW).gap, false, 'yesterday is not a gap');
  assert.equal(visitWindow([run('2026-10-20', '2026-10-20')], 5, NOW).gap, true, 'two days back is');
  assert.equal(visitWindow([run('2026-10-22', '2026-10-22', 'error'), run('2026-10-19', '2026-10-19')], 5, NOW).window_end, '2026-10-19', 'an error run does not count');
  const w = visitWindow([run('2026-10-22', '2026-10-22'), run('2026-10-22', '2026-10-22', 'ok', { kind: 'backfill', window_start: '2026-10-08', lookback_days: 14, updated_at: ago(1) })], 138, NOW);
  assert.deepEqual([w.window_start, w.kind, w.companies, w.last_ok_at], ['2026-10-01', 'daily', 138, ago(2)], 'same window_end: the later la_date / first by sort wins, companies from the caller');
});
