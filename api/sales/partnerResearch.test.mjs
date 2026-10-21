// node --test api/sales/partnerResearch.test.mjs  (react-scripts' Jest only runs src/)
// partner-add-research-v1 REV3 Stage 2 - the research run against the
// in-memory Supabase and a fixture Claude: row lifecycle, scrub, cap, error
// row, stale run, routes. 0 network, 0 Claude, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { research, kickResearch, listRuns, runsToday, parseResearch, researchSystem, listResearchRoute, runResearchRoute, RERUN_CAP_PER_DAY, MAX_SEARCHES, SEARCH_USD, STALE_RUNNING_MS } from './partnerResearch.js';

const B = randomUUID(), OTHER = randomUUID(), U = randomUUID();
const P = { bb: randomUUID(), lock: randomUUID(), other: randomUUID() };
const seed = () => ({
  businesses: [{ id: B, name: 'HomeLover', website_url: 'https://homelover.com', tagline: 'housing as a benefit' }],
  sales_goals: [
    { id: P.bb, business_id: B, goal_type: 'partnership', name: 'Brown & Brown', category: null, partner_role: null, sources: null, company_domain: null, angle: 'old angle' },
    { id: P.lock, business_id: B, goal_type: 'partnership', name: 'Lockton', category: '4. Mid-Market Benefits Brokers', partner_role: 'broker', sources: 'lockton.com/about', company_domain: 'lockton.com' },
    { id: randomUUID(), business_id: B, goal_type: 'partnership', name: 'Aon', category: '6. Enterprise Benefits Consultants' },
    { id: P.other, business_id: OTHER, goal_type: 'partnership', name: 'Elsewhere' },
  ],
  research_runs: [],
});
const reply = (obj, usage = { input_tokens: 1000, output_tokens: 500, server_tool_use: { web_search_requests: 2 } }) => ({ content: [{ type: 'text', text: `Sure:\n${JSON.stringify(obj)}` }], usage, stop_reason: 'end_turn' });
const GOOD = { website: 'https://www.bbinsurance.com/', domain: 'bbinsurance.com', website_confidence: 'high', source_urls: ['https://www.bbinsurance.com/about'], summary: 'Insurance broker for mid-market employers. Ask Pat at pat@bbinsurance.com or 813-222-4100.', mission: '"We help people."', size: '16,000 employees (2025 10-K)', hq_city: 'Daytona Beach, FL', recent_news: 'none found', housing_perk: 'no housing perk found', suggested_category: '4. Mid-Market Benefits Brokers', why_homelover: 'Their clients ask for financial wellness.', first_angle: 'Brokers win renewals with a benefit nobody else has.', watch_outs: 'Big brokerage, slow procurement.', titles: 'VP Benefits, Director of Partnerships' };

test('a run: running row -> done with scrubbed result, tokens, cost incl. searches, created_by, trigger; the partner row is untouched', async () => {
  const sb = fakeSupabase(seed());
  const calls = [];
  const row = await research(sb, { businessId: B, entityId: P.bb, trigger: 'manual', userId: U, call: async args => { calls.push(args); return reply(GOOD); } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].tools, [{ type: 'web_search_20260209', name: 'web_search', allowed_callers: ['direct'], max_uses: MAX_SEARCHES }]);
  assert.equal(calls[0].callType, 'partner_research'); assert.equal(calls[0].userId, U); assert.equal(calls[0].businessId, B);
  assert.match(calls[0].system, /CATEGORIES: \["4\. Mid-Market Benefits Brokers","6\. Enterprise Benefits Consultants"\]/);
  assert.match(calls[0].messages[0].content, /^COMPANY: Brown & Brown$/);
  assert.equal(row.status, 'done'); assert.equal(row.trigger, 'manual'); assert.equal(row.created_by, U); assert.equal(row.entity_type, 'partner');
  assert.equal(row.input_tokens, 1000); assert.equal(row.output_tokens, 500);
  assert.equal(row.cost_usd, Math.round(((1000 * 3 + 500 * 15) / 1e6 + 2 * SEARCH_USD) * 1e6) / 1e6);
  assert.equal(row.result.domain, 'bbinsurance.com'); assert.equal(row.result.web_searches, 2);
  assert.equal(row.result.summary, 'Insurance broker for mid-market employers. Ask Pat at [email removed] or [number removed].');
  assert.equal(row.result.suggested_category, '4. Mid-Market Benefits Brokers');
  assert.equal(sb.db.sales_goals.find(g => g.id === P.bb).angle, 'old angle');
  assert.equal(sb.db.sales_goals.find(g => g.id === P.bb).company_domain, null);
});

test('known fields go in the user message; the bad reply / cut-off reply end as an error row, never a stuck running one', async () => {
  const sb = fakeSupabase(seed());
  let args;
  const bad = await research(sb, { businessId: B, entityId: P.lock, trigger: 'create', call: async a => { args = a; return { content: [{ type: 'text', text: 'I could not find it.' }], usage: {} }; } });
  assert.match(args.messages[0].content, /known domain: lockton.com/); assert.match(args.messages[0].content, /category in our list: 4\./);
  assert.equal(bad.status, 'error'); assert.equal(bad.error, 'Could not read the AI reply'); assert.equal(bad.created_by, null); assert.equal(bad.trigger, 'create');
  const cut = await research(sb, { businessId: B, entityId: P.lock, trigger: 'manual', call: async () => ({ ...reply(GOOD), stop_reason: 'max_tokens' }) });
  assert.equal(cut.status, 'error'); assert.match(cut.error, /cut off/);
  const thrown = await research(sb, { businessId: B, entityId: P.lock, trigger: 'manual', call: async () => { throw new Error('ANTHROPIC_API_KEY not configured'); } });
  assert.equal(thrown.status, 'error'); assert.equal(thrown.error, 'ANTHROPIC_API_KEY not configured');
  assert.ok(sb.db.research_runs.every(r => r.status !== 'running'));
});

test('parse: category outside the list -> null, bad URLs dropped, no domain -> confidence low, unknown keys ignored', () => {
  const r = parseResearch(JSON.stringify({ ...GOOD, suggested_category: 'Brokers', source_urls: ['javascript:alert(1)', 'https://ok.com/a', 'https://ok.com/a'], extra: 'x' }), ['4. Mid-Market Benefits Brokers']);
  assert.equal(r.suggested_category, null); assert.deepEqual(r.source_urls, ['https://ok.com/a']); assert.equal('extra' in r, false);
  const none = parseResearch(JSON.stringify({ website: null, domain: null, website_confidence: 'high', summary: 'x' }), []);
  assert.equal(none.domain, null); assert.equal(none.website_confidence, 'low'); assert.equal(none.website, null);
  assert.throws(() => parseResearch('no json here', []), /Could not read/);
  assert.match(researchSystem({ name: 'HomeLover' }, []), /Never include any person's name, email address or phone number/);
});

// company-panel-v2 D3 - sells_to is one more capped text field; recent is up to 3 dated items with a real url.
test('parse: sells_to capped at 120; recent keeps at most 3 items with text, a YYYY-MM month and an http url, drops the rest; missing -> [] and null', () => {
  const r = parseResearch(JSON.stringify({ ...GOOD, sells_to: 'Mid-market employers and the brokers who serve them. '.repeat(5), recent: [
    { month: '2026-09', text: 'Raised a Series B', url: 'https://news.example/b' },
    { month: 'Sept 2026', text: 'Opened Chicago office', url: 'javascript:alert(1)' },
    { month: '2026-13', text: '' },
    'not an item',
    { month: '2026-07', text: 'Hired a CRO', url: 'https://news.example/cro' },
    { month: '2026-06', text: 'Fifth item is cut', url: null },
  ] }), []);
  assert.ok(r.sells_to.length <= 120 && r.sells_to.startsWith('Mid-market employers'));
  assert.deepEqual(r.recent, [
    { month: '2026-09', text: 'Raised a Series B', url: 'https://news.example/b' },
    { month: null, text: 'Opened Chicago office', url: null },
    { month: '2026-07', text: 'Hired a CRO', url: 'https://news.example/cro' },
  ]);
  const none = parseResearch(JSON.stringify(GOOD), []);
  assert.deepEqual(none.recent, []); assert.equal(none.sells_to, null);
  const sys = researchSystem({ name: 'HomeLover' }, []);
  assert.match(sys, /"sells_to": ""/); assert.match(sys, /"recent": \[\{"month": "YYYY-MM"/); assert.match(sys, /- sells_to: at most 20 words/); assert.match(sys, /- recent: up to 3 dated items/);
});

test(`cap: run ${RERUN_CAP_PER_DAY + 1} the same LA day is 429; yesterday's runs don't count; another partner is unaffected`, async () => {
  const sb = fakeSupabase(seed());
  const now = Date.parse('2026-10-16T18:00:00Z');
  for (let i = 0; i < RERUN_CAP_PER_DAY; i++) await research(sb, { businessId: B, entityId: P.bb, trigger: i ? 'manual' : 'create', call: async () => reply(GOOD), now });
  await assert.rejects(research(sb, { businessId: B, entityId: P.bb, trigger: 'manual', call: async () => reply(GOOD), now }), e => e.status === 429 && /cap/.test(e.message));
  assert.equal(await runsToday(sb, B, 'partner', P.bb, now), RERUN_CAP_PER_DAY);
  sb.db.research_runs.forEach(r => { r.created_at = new Date(now - 30 * 3600e3).toISOString(); });
  assert.equal(await runsToday(sb, B, 'partner', P.bb, now), 0);
  const ok = await research(sb, { businessId: B, entityId: P.lock, trigger: 'manual', call: async () => reply(GOOD), now });
  assert.equal(ok.status, 'done');
});

test('partner must be in the workspace (404); a stale running row is closed as an error by listRuns; newest first, 3 max', async () => {
  const sb = fakeSupabase(seed());
  await assert.rejects(research(sb, { businessId: B, entityId: P.other, trigger: 'manual', call: async () => reply(GOOD) }), e => e.status === 404);
  const now = Date.now();
  const run = await kickResearch(sb, { businessId: B, entityId: P.bb, trigger: 'manual', call: () => new Promise(() => {}) });
  assert.equal(run.status, 'running');
  assert.equal((await listRuns(sb, B, 'partner', P.bb, now))[0].status, 'running');
  const [closed] = await listRuns(sb, B, 'partner', P.bb, now + STALE_RUNNING_MS + 1);
  assert.equal(closed.status, 'error'); assert.match(closed.error, /did not finish/);
  for (let i = 0; i < 4; i++) { await research(sb, { businessId: B, entityId: P.lock, trigger: 'manual', call: async () => reply({ ...GOOD, summary: `run ${i}` }) }); sb.db.research_runs.at(-1).created_at = new Date(now + i * 1000).toISOString(); }
  const runs = await listRuns(sb, B, 'partner', P.lock);
  assert.equal(runs.length, 3); assert.equal(runs[0].result.summary, 'run 3');
});

const res = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const req = (goalId, role = 'member') => ({ params: { businessId: B, id: goalId }, auth: { user: { id: U }, isPlatformOwner: false, roles: new Map([[B, role]]) } });

test('routes: POST 202 running row then GET shows done with today/cap; 404 for a foreign partner; 429 at the cap', async () => {
  const sb = fakeSupabase(seed());
  let finish;
  const call = () => new Promise(r => { finish = () => r(reply(GOOD)); });
  let r = res(); await runResearchRoute(req(P.bb), r, sb, call);
  assert.equal(r.code, 202); assert.equal(r.body.run.status, 'running'); assert.equal(r.body.run.created_by, U);
  r = res(); await listResearchRoute(req(P.bb, 'viewer'), r, sb);
  assert.equal(r.code, 200); assert.equal(r.body.runs[0].status, 'running'); assert.equal(r.body.today, 1); assert.equal(r.body.cap, RERUN_CAP_PER_DAY);
  finish(); await new Promise(x => setTimeout(x, 5));
  r = res(); await listResearchRoute(req(P.bb), r, sb);
  assert.equal(r.body.runs[0].status, 'done'); assert.equal(r.body.runs[0].result.domain, 'bbinsurance.com');
  r = res(); await listResearchRoute(req(P.other), r, sb); assert.equal(r.code, 404);
  r = res(); await runResearchRoute(req(P.other), r, sb, call); assert.equal(r.code, 404);
  for (let i = 1; i < RERUN_CAP_PER_DAY; i++) await research(sb, { businessId: B, entityId: P.bb, trigger: 'manual', call: async () => reply(GOOD) });
  r = res(); await runResearchRoute(req(P.bb), r, sb, call); assert.equal(r.code, 429);
});

// sales-ia-v2 Stage 3 (P4) - the same run for an employer and a target.
import { listCompanyResearchRoute, runCompanyResearchRoute, RESEARCH_TYPES } from './partnerResearch.js';
const E = randomUUID(), T = randomUUID();
const seed2 = () => ({ ...seed(),
  sales_opportunities: [{ id: E, business_id: B, organization: 'Solidcore', archived_at: null }],
  sales_targets: [{ id: T, business_id: B, name: 'Zeta Labs', kind: 'partner', suggested_category: '4. Mid-Market Benefits Brokers', evidence: 'Opened a Chicago office' }],
});
const creq = (type, id) => ({ params: { businessId: B, type, id }, auth: { user: { id: U }, isPlatformOwner: false, roles: new Map([[B, 'member']]) } });

test('employer research: entity_type employer, the employer framing, no categories (suggested_category null); target research: its kind picks the framing and the evidence is in the prompt', async () => {
  const sb = fakeSupabase(seed2());
  let args;
  const row = await research(sb, { businessId: B, entityType: 'employer', entityId: E, trigger: 'manual', userId: U, call: async a => { args = a; return reply(GOOD); } });
  assert.equal(row.entity_type, 'employer'); assert.equal(row.entity_id, E); assert.equal(row.status, 'done');
  assert.match(args.system, /possible employer customer/); assert.match(args.system, /suggested_category: always null/); assert.match(args.system, /CATEGORIES: \[\]/);
  assert.match(args.messages[0].content, /^COMPANY: Solidcore$/);
  assert.equal(row.result.suggested_category, null);
  const t = await research(sb, { businessId: B, entityType: 'target', entityId: T, trigger: 'manual', call: async a => { args = a; return reply(GOOD); } });
  assert.equal(t.entity_type, 'target');
  assert.match(args.system, /possible channel partner/); assert.match(args.messages[0].content, /category in our list: 4\./); assert.match(args.messages[0].content, /sources we noted: Opened a Chicago office/);
  assert.equal(await runsToday(sb, B, 'partner', P.bb), 0, 'other entities never count against a partner');
  await assert.rejects(research(sb, { businessId: B, entityType: 'employer', entityId: P.bb, trigger: 'manual', call: async () => reply(GOOD) }), e => e.status === 404);
  await assert.rejects(research(sb, { businessId: B, entityType: 'visitor', entityId: E, trigger: 'manual', call: async () => reply(GOOD) }), e => e.status === 400);
  assert.deepEqual(RESEARCH_TYPES, ['partner', 'employer', 'target']);
});

test('company routes: POST /company/:type/:id/research 202 then GET lists it per entity; the cap is per company per day (5), 429 after', async () => {
  const sb = fakeSupabase(seed2());
  const call = async () => reply(GOOD);
  let r = res(); await runCompanyResearchRoute(creq('employer', E), r, sb, call);
  assert.equal(r.code, 202); assert.equal(r.body.run.entity_type, 'employer');
  await new Promise(x => setTimeout(x, 5));
  r = res(); await listCompanyResearchRoute(creq('employer', E), r, sb);
  assert.equal(r.code, 200); assert.equal(r.body.runs.length, 1); assert.equal(r.body.today, 1);
  r = res(); await listCompanyResearchRoute(creq('target', T), r, sb);
  assert.equal(r.body.runs.length, 0);
  r = res(); await listCompanyResearchRoute(creq('visitor', 'acme'), r, sb); assert.equal(r.code, 400);
  for (let i = 1; i < RERUN_CAP_PER_DAY; i++) await research(sb, { businessId: B, entityType: 'employer', entityId: E, trigger: 'manual', call });
  r = res(); await runCompanyResearchRoute(creq('employer', E), r, sb, call);
  assert.equal(r.code, 429); assert.match(r.body.error, /per company per day/);
});
