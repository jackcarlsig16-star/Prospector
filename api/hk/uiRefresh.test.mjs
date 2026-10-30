// node --test api/hk/uiRefresh.test.mjs
// grow-ui-refresh-v1 REV2 Stage 2 - the primary per brand (U2), Pitch + Undo (J1), Snooze (J7), Not a fit + Undo (J3),
// Log activity, the research batch + estimate (J8), research industry / context / a different website (U8), and the
// Why-score parts (J9). Invented brands on the in-memory Supabase; Claude stubbed; 0 network, 0 Gmail, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const { seed, reqOf, call, hasAt, HK, JACK, PETE, ID, NOW } = await import('./testing.mjs');
const A = await import('./brandActions.js');
const { primaryOf } = await import('./rules.js');
const { reachOf, rankReach } = await import('./intelScore.js');
const { loadIntel } = await import('./intelData.js');
const { briefingRoute } = await import('./briefingRoutes.js');
const { getBrandRoute, listBrandsRoute, patchBrandRoute } = await import('./brandsRoutes.js');
const { pipelineRoute } = await import('./signalsRoutes.js');
const R = await import('./brandResearch.js');
const { parseIntel } = await import('./inboxAnalyze.js');

const SHEET = randomUUID(), WARM = randomUUID(), MINE = randomUUID();
const now = () => NOW;
const members = [{ user_id: JACK, business_id: HK, name: 'Jack Example', role: 'owner', created_at: '2026-09-01T00:00:00Z' }, { user_id: PETE, business_id: HK, name: 'Pete Example', role: 'member', created_at: '2026-09-02T00:00:00Z' }];
const extraBrand = (id, name, over = {}) => ({ id, business_id: HK, name, normalized_name: name.toLowerCase(), aliases: [], segment: 'sponsor_brand', is_local: false, status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_unclear: false, source: 'import', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', archived_at: null, ...over });
const usage = (n, cost = 0.04) => Array.from({ length: n }, (_, i) => ({ id: `u${i}`, business_id: HK, call_type: i % 2 ? 'hk_research_sweep' : 'hk_inbox_analyze', cost_usd: cost, created_at: new Date(NOW.getTime() - (i + 1) * 864e5 * 3).toISOString(), user_id: JACK }));
let sb;
const fresh = (extra = {}) => {
  sb = seed({
    business_members: members,
    hk_domain_intel: [], business_anthropic_usage: [], hk_signals: [],
    ...extra,
  });
  sb.db.hk_brands.push(extraBrand(SHEET, 'Sable Socks', { owner_hint: 'pete', domain: 'sablesocks.example' }), extraBrand(WARM, 'Warm Kettle', { domain: 'warmkettle.example' }), extraBrand(MINE, 'Mine Mills', { owner_user_id: JACK, status: 'claimed', domain: 'minemills.example' }));
  sb.db.hk_touches.push({ id: 't-warm', business_id: HK, brand_id: WARM, sender_user_id: PETE, channel: 'email', kind: 'cold', subject: 'x', state: 'sent', sent_at: '2026-10-20T00:00:00Z', created_by: 'user', created_at: '2026-10-20T00:00:00Z' });
};
const brandOf = id => sb.db.hk_brands.find(b => b.id === id);
const as = (route, o = {}, d = {}) => call(route, reqOf({ method: 'POST', ...o }), { supabase: sb, now, ...d });
const answer = (over = {}) => JSON.stringify({ website_domain: 'bluefinrun.example', website_confidence: 'high', company: { name: 'Bluefin', what_they_do: 'A Chicago run club', industry: 'Running clubs and community fitness events nationwide', hq_city: 'Chicago', chicago_presence: 'yes', category: 'gym/studio' }, fit: { sponsor_fit: 'possible', why: 'Runners', challenge_idea: 'Miles month' }, next_step: 'track_as_brand', reason: 'fits', ...over });
const stubCall = (calls, { fail = null } = {}) => async args => { calls.push(args); if (fail && calls.length === fail) throw new Error('Claude is down'); return { content: [{ type: 'text', text: answer() }], usage: { input_tokens: 1000, output_tokens: 400, server_tool_use: { web_search_requests: 1 } }, stop_reason: 'end_turn' }; };

test('U2 primaryOf: each state, in priority order', () => {
  const free = { owner_user_id: null }, base = { meId: JACK, firstName: id => (id === PETE ? 'Pete' : null), researched: true, hasEmail: true, verdictOk: true };
  assert.deepEqual(primaryOf({ ...base, brand: free, replies: [{ handled: false }], touches: [{ state: 'drafted', sender_user_id: JACK }] }), { kind: 'open_reply', label: 'Open reply' });
  assert.equal(primaryOf({ ...base, brand: free, replies: [{ handled: true }], touches: [{ state: 'drafted', sender_user_id: JACK }] }).kind, 'open_draft');
  assert.deepEqual(primaryOf({ ...base, brand: { owner_user_id: PETE }, replies: [{ handled: false }] }), { kind: 'owned', label: 'Owned by Pete' });
  assert.equal(primaryOf({ ...base, brand: free }).kind, 'pitch');
  assert.equal(primaryOf({ ...base, brand: free, researched: false }).kind, 'research');
  assert.equal(primaryOf({ ...base, brand: free, researched: false, hasEmail: false }).kind, 'research');
  assert.equal(primaryOf({ ...base, brand: free, hasEmail: false }).kind, 'add_email');
  assert.equal(primaryOf({ ...base, brand: free, verdictOk: false }), null, 'a blocked brand gets no primary');
  assert.equal(primaryOf({ ...base, brand: { owner_user_id: JACK }, touches: [{ state: 'drafted', sender_user_id: PETE }] }).kind, 'pitch', "another member's draft is not the caller's");
});

test('U2 primary on the brand detail, the Brands list rows and the Briefing rows', async () => {
  fresh();
  sb.db.hk_contacts.push({ id: 'c-run', business_id: HK, brand_id: ID.run, name: 'Rae', email: 'rae@bluefinrun.example', is_primary: true, created_at: '2026-10-02T00:00:00Z' });
  sb.db.hk_domain_intel.push({ id: 'i-run', business_id: HK, domain: 'bluefinrun.example', intel: { company: { what_they_do: 'Run club', industry: 'Running' }, fit: { sponsor_fit: 'possible', challenge_idea: 'Miles' } }, cost_usd: 0.05, researched_at: '2026-10-25T00:00:00Z' });
  let r = await call(getBrandRoute, reqOf({ params: { id: ID.run } }), { supabase: sb });
  assert.deepEqual(r.body.primary, { kind: 'pitch', label: 'Pitch' });
  r = await call(getBrandRoute, reqOf({ params: { id: ID.yoga } }), { supabase: sb });
  assert.deepEqual(r.body.primary, { kind: 'owned', label: 'Owned by Pete' });
  r = await call(listBrandsRoute, reqOf({ query: { page: '1', limit: '50' } }), { supabase: sb, now });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.rows.map(x => [x.name, x.primary?.kind ?? null]));
  assert.deepEqual([by['Bluefin Run Club'], by['Harbor Yoga'], by['Northwind Juice'], by['Copperleaf Cafe'], by['Sable Socks'], by['Warm Kettle']], ['pitch', 'owned', null, null, 'research', null]);
  assert.ok(!hasAt(r.body.rows.map(x => x.primary)));
  r = await call(briefingRoute, reqOf({ query: { owner: 'me' } }), { supabase: sb, now, today: async () => ({ counts: {} }) });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const run = r.body.send.find(c => c.id === ID.run);
  assert.equal(run.primary.kind, 'pitch');
  assert.equal(run.research.industry, 'Running');
  assert.equal(run.research.cost_usd, 0.05);
});

test('J9 Why score: the parts are reachOf\'s real parts and they sum to the score', async () => {
  fresh();
  sb.db.hk_settings.push({ business_id: HK, intel: { target_categories: ['Run'] } });
  brandOf(ID.run).category = 'Run'; brandOf(ID.run).targeted_at = '2026-10-20T00:00:00Z';
  const r = await call(briefingRoute, reqOf({ query: { owner: 'me' } }), { supabase: sb, now, today: async () => ({ counts: {} }) });
  assert.ok(r.body.send.length >= 2);
  for (const c of r.body.send) {
    assert.equal(c.score_parts.reduce((n, p) => n + p.points, 0), c.score, c.name);
    assert.ok(c.score_parts.every(p => typeof p.words === 'string' && p.words.length), JSON.stringify(c.score_parts));
  }
  assert.ok(r.body.send.find(c => c.id === ID.run).score_parts.some(p => p.key === 'targeted'));
});

test('J1 Pitch refused for every can_contact block; noSend; the sheet owner asks first', async () => {
  fresh();
  brandOf(ID.run).owner_unclear = true;
  const passed = randomUUID(); sb.db.hk_brands.push(extraBrand(passed, 'Passed Pantry', { status: 'passed' }));
  const fetchCalls = []; const realFetch = globalThis.fetch; globalThis.fetch = async (...a) => { fetchCalls.push(a); throw new Error('no network'); };
  try {
    const cases = [[ID.juice, /is a sponsor/], [ID.cafe, /do not contact/], [ID.yoga, /owned by Pete/], [passed, /passed on/], [ID.run, /Unclear/], [WARM, /already has a thread/]];
    for (const [id, re] of cases) { const r = await as(A.pitchRoute, { params: { id } }); assert.equal(r.code, 409, `${id} ${JSON.stringify(r.body)}`); assert.match(r.body.error, re); }
    const ask = await as(A.pitchRoute, { params: { id: SHEET } });
    assert.equal(ask.code, 409);
    assert.deepEqual([ask.body.error, ask.body.confirm_sheet_owner], ["The sheet lists this as Pete's. Take it anyway?", true]);
    assert.equal(brandOf(SHEET).owner_user_id, null);
    const ok = await as(A.pitchRoute, { params: { id: SHEET }, body: { confirm_sheet_owner: true } });
    assert.equal(ok.code, 200, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.claimed, ok.body.command, brandOf(SHEET).owner_user_id, brandOf(SHEET).status], [true, 'hk pitch sablesocks.example', JACK, 'claimed']);
    assert.equal(sb.db.hk_events.filter(e => e.action === 'brand.claimed').at(-1).detail.note, "taken from Pete's sheet list");
    assert.deepEqual([fetchCalls.length, sb.db.hk_touches.length], [0, 3], 'no network call, no touch written: Pitch never sends');
  } finally { globalThis.fetch = realFetch; }
});

test('J1 Pitch claims once, copies the command (no "@"), Undo releases only its own claim', async () => {
  fresh();
  const noDomain = randomUUID(); sb.db.hk_brands.push(extraBrand(noDomain, 'Ana@Shop Bakery'));
  let r = await as(A.pitchRoute, { params: { id: noDomain } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.ok(!hasAt(r.body.command) && !hasAt(r.body.words), r.body.command);
  r = await as(A.pitchRoute, { params: { id: ID.run } });
  assert.deepEqual([r.body.claimed, r.body.command, r.body.words], [true, 'hk pitch bluefinrun.example', 'Claimed. Copied hk pitch bluefinrun.example. Paste into Claude.']);
  const again = await as(A.pitchRoute, { params: { id: ID.run } });
  assert.deepEqual([again.body.claimed, again.body.command], [false, 'hk pitch bluefinrun.example']);
  assert.equal(sb.db.hk_events.filter(e => e.action === 'brand.claimed' && e.entity_id === ID.run).length, 1, 'claimed once');
  const stale = await as(A.pitchRoute, { params: { id: ID.run }, body: { undo: true, expect_updated_at: '2026-01-01T00:00:00Z' } });
  assert.equal(stale.code, 409);
  const undo = await as(A.pitchRoute, { params: { id: ID.run }, body: { undo: true, expect_updated_at: r.body.brand.updated_at } });
  assert.equal(undo.code, 200, JSON.stringify(undo.body));
  assert.deepEqual([brandOf(ID.run).owner_user_id, brandOf(ID.run).status, undo.body.undone], [null, 'candidate', true]);
  // A brand + Pipeline claimed: Pitch copies the command and its Undo refuses (that claim is not Pitch's).
  const pipe = await call(pipelineRoute, reqOf({ method: 'POST', params: { id: SHEET }, body: { confirm_sheet_owner: true } }), { supabase: sb, now });
  assert.equal(pipe.code, 200, JSON.stringify(pipe.body));
  const p2 = await as(A.pitchRoute, { params: { id: SHEET } });
  assert.equal(p2.body.claimed, false);
  const u2 = await as(A.pitchRoute, { params: { id: SHEET }, body: { undo: true, expect_updated_at: brandOf(SHEET).updated_at } });
  assert.equal(u2.code, 409);
  assert.equal(brandOf(SHEET).owner_user_id, JACK);
});

test('J7 Snooze: 14 days out of Send these 10 (B3), off brings it back; Activity rows kept', async () => {
  fresh();
  const data0 = await loadIntel(sb, HK, NOW);
  assert.ok(reachOf(data0.brands.find(b => b.id === ID.run), { ...data0, meId: JACK, now: NOW }));
  let r = await as(A.snoozeRoute, { params: { id: ID.run }, body: { on: true } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.brand.snoozed_until, new Date(NOW.getTime() + 14 * 864e5).toISOString());
  let data = await loadIntel(sb, HK, NOW);
  assert.ok(!rankReach(data.brands, { ...data, meId: JACK, now: NOW }, { meFirstName: 'Jack', limit: null }).some(x => x.brand.id === ID.run), 'snoozed: out of B3');
  const later = new Date(NOW.getTime() + 15 * 864e5);
  assert.ok(reachOf(data.brands.find(b => b.id === ID.run), { ...data, meId: JACK, now: later }), 'back after 14 days');
  r = await as(A.snoozeRoute, { params: { id: ID.run }, body: { on: false } });
  assert.equal(brandOf(ID.run).snoozed_until, null);
  assert.deepEqual(sb.db.hk_events.map(e => e.action), ['brand.snoozed', 'brand.unsnoozed']);
  assert.equal((await as(A.snoozeRoute, { params: { id: ID.run }, body: {} })).code, 400);
});

test('J3 Not a fit: passed + reason (default, edited), never do not contact; Undo restores; stale Undo and sponsors refused', async () => {
  fresh();
  let r = await as(A.notAFitRoute, { params: { id: ID.run } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual([brandOf(ID.run).status, brandOf(ID.run).pass_reason, brandOf(ID.run).relationship], ['passed', 'Not a fit', 'prospect']);
  assert.equal((await as(A.notAFitRoute, { params: { id: ID.run }, body: { reason: 'Only sells wholesale, call 312-555-0100' } })).code, 400, 'a phone in the reason is refused');
  r = await as(A.notAFitRoute, { params: { id: ID.run }, body: { reason: 'Only sells wholesale' } });
  assert.equal(brandOf(ID.run).pass_reason, 'Only sells wholesale');
  assert.equal(brandOf(ID.run).status, 'passed');
  const stale = await as(A.notAFitRoute, { params: { id: ID.run }, body: { undo: true, expect_updated_at: 'old' } });
  assert.equal(stale.code, 409);
  const undo = await as(A.notAFitRoute, { params: { id: ID.run }, body: { undo: true, expect_updated_at: r.body.brand.updated_at } });
  assert.equal(undo.code, 200, JSON.stringify(undo.body));
  assert.deepEqual([brandOf(ID.run).status, brandOf(ID.run).pass_reason], ['candidate', null]);
  assert.equal((await as(A.notAFitRoute, { params: { id: ID.juice } })).code, 409);
  assert.equal((await as(A.notAFitRoute, { params: { id: ID.yoga } })).code, 403, "another founder's brand");
  assert.ok(!hasAt(sb.db.hk_events));
});

test('Log activity: an outside touch (channel by kind, date, scrubbed note off the Activity row); bad input refused; Undo discards', async () => {
  fresh();
  assert.equal((await as(A.logActivityRoute, { params: { id: ID.run }, body: { what: 'called', date: '2026-10-21', note: 'reach her at rae@bluefin.example' } })).code, 400, 'an address in the note is refused');
  const r = await as(A.logActivityRoute, { params: { id: ID.run }, body: { what: 'called', date: '2026-10-21', note: 'Spoke to Rae, call back next week' } });
  assert.equal(r.code, 201, JSON.stringify(r.body));
  const t = sb.db.hk_touches.find(x => x.id === r.body.touch_id);
  assert.deepEqual([t.kind, t.channel, t.state, t.subject, t.sent_at, t.sender_user_id], ['outside', 'phone', 'sent', 'Called', '2026-10-21T17:00:00.000Z', JACK]);
  assert.equal(t.body_text, 'Spoke to Rae, call back next week');
  assert.equal(brandOf(ID.run).last_touch_at, '2026-10-21T17:00:00.000Z');
  const ev = sb.db.hk_events.at(-1);
  assert.deepEqual([ev.action, ev.detail.what, ev.detail.date, 'note' in ev.detail], ['touch.logged', 'Called', '2026-10-21', false]);
  for (const body of [{ what: 'faxed', date: '2026-10-21' }, { what: 'other', date: '2026-10-21' }, { what: 'met', date: '2026-12-01' }, { what: 'met', date: '10/21' }, { what: 'met' }]) assert.equal((await as(A.logActivityRoute, { params: { id: ID.run }, body })).code, 400, JSON.stringify(body));
  const li = await as(A.logActivityRoute, { params: { id: ID.run }, body: { what: 'linkedin', date: '2026-10-22' } });
  assert.deepEqual([li.code, sb.db.hk_touches.find(x => x.id === li.body.touch_id).channel, li.body.what], [201, 'linkedin', 'LinkedIn']);
  const u = await as(A.logActivityRoute, { params: { id: ID.run }, body: { undo: r.body.touch_id } });
  assert.equal(u.code, 200);
  assert.equal(t.state, 'discarded');
  assert.ok(sb.db.hk_touches.includes(t), 'never deleted');
  assert.equal((await as(A.logActivityRoute, { params: { id: ID.run }, body: { undo: r.body.touch_id } })).code, 409);
});

test('J8 estimate: every research-type call; under 3 rows "no estimate yet"; batch <= 10, estimate only without confirm (0 calls)', async () => {
  fresh({ business_anthropic_usage: usage(2) });
  const calls = [];
  let r = await as(A.researchBatchRoute, { body: { brand_ids: [ID.run, SHEET] } }, { call: stubCall(calls) });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.estimate, { n: 2, per_call: null, total_usd: null, words: 'no estimate yet' });
  fresh({ business_anthropic_usage: [...usage(3, 0.04), { id: 'other', business_id: HK, call_type: 'hk_reply_label', cost_usd: 9, created_at: NOW.toISOString() }] });
  r = await as(A.researchBatchRoute, { body: { brand_ids: [ID.run, SHEET] } }, { call: stubCall(calls) });
  assert.deepEqual(r.body.estimate, { n: 2, per_call: 0.04, total_usd: 0.08, words: 'about $0.08' });
  assert.equal(calls.length, 0);
  const eleven = Array.from({ length: 11 }, () => randomUUID());
  assert.equal((await as(A.researchBatchRoute, { body: { brand_ids: eleven } })).code, 400);
  assert.equal((await as(A.researchBatchRoute, { body: { brand_ids: [ID.run, ID.run] } })).code, 400);
  assert.equal((await as(A.researchBatchRoute, { body: { brand_ids: [ID.old] } })).code, 404, 'archived');
  const b = await call(briefingRoute, reqOf({ query: { owner: 'me' } }), { supabase: sb, now, today: async () => ({ counts: {} }) });
  assert.deepEqual(b.body.research_estimate, { per_call: 0.04, rows: 3 });
});

test('Research batch with confirm: one call per brand, stops on the first error, stops before the daily dollar cap', async () => {
  fresh({ business_anthropic_usage: usage(3, 0.04) });
  let calls = [];
  let r = await as(A.researchBatchRoute, { body: { brand_ids: [ID.run, SHEET, MINE], confirm: true } }, { call: stubCall(calls, { fail: 2 }) });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual([calls.length, r.body.results.length, r.body.stopped], [2, 1, 'Claude is down']);
  assert.deepEqual([r.body.results[0].status, r.body.results[0].domain, r.body.results[0].fit], ['researched', 'bluefinrun.example', 'possible']);
  assert.ok(r.body.cost_usd > 0);
  assert.ok(calls.every(c => c.max_tokens && c.model && c.tools[0].max_uses === 3), 'max_tokens + model set, <= 3 searches');
  fresh({ business_anthropic_usage: [...usage(3, 0.04), { id: 'today', business_id: HK, call_type: 'hk_research_sweep', cost_usd: 0.97, created_at: NOW.toISOString() }] });
  calls = [];
  r = await as(A.researchBatchRoute, { body: { brand_ids: [ID.run, SHEET], confirm: true } }, { call: stubCall(calls) });
  assert.deepEqual([calls.length, r.body.stopped], [0, 'daily cap ($1.00)']);
});

test('U8 research: industry (<= 40), the team\'s context (scrubbed) in the prompt, a different website becomes a suggestion only', async () => {
  fresh();
  assert.equal(parseIntel(answer()).company.industry.length <= 40, true);
  for (const bad of ['They sponsor 5Ks. Ask ana@bluefin.example', 'Call 312-555-0100']) assert.equal((await call(patchBrandRoute, reqOf({ method: 'PATCH', params: { id: ID.run }, body: { research_context: bad } }), { supabase: sb, now })).code, 400, bad);
  let r = await call(patchBrandRoute, reqOf({ method: 'PATCH', params: { id: ID.run }, body: { research_context: 'They sponsor 5Ks.' } }), { supabase: sb, now });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(brandOf(ID.run).research_context, 'They sponsor 5Ks.');
  assert.equal((await call(patchBrandRoute, reqOf({ method: 'PATCH', params: { id: ID.run }, body: { research_context: 'x'.repeat(301) } }), { supabase: sb, now })).code, 400);
  const input = await call(R.researchInputRoute, reqOf({ params: { id: ID.run } }), { supabase: sb });
  assert.match(input.body.input, /Context from the team: They sponsor 5Ks\./);
  assert.ok(!hasAt(input.body));
  const calls = [];
  r = await call(R.researchBrandRoute, reqOf({ method: 'POST', params: { id: ID.run }, body: { click: true, website: 'https://bluefin-runners.example/about' } }), { supabase: sb, now, call: stubCall(calls) });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.match(calls[0].messages[0].content, /Website: bluefin-runners\.example/);
  assert.match(calls[0].messages[0].content, /Context from the team/);
  assert.deepEqual([brandOf(ID.run).domain, brandOf(ID.run).domain_suggested, r.body.suggested], ['bluefinrun.example', 'bluefin-runners.example', true]);
  assert.equal((await call(R.researchBrandRoute, reqOf({ method: 'POST', params: { id: ID.run }, body: { click: true, website: 'amazon.com' } }), { supabase: sb, now, call: stubCall(calls) })).code, 400);
});

test('U4/U5 Briefing rows carry the best contact in words (no address, no Apollo wording), is_local, the brand idea; Waiting rows say when a bump is due', async () => {
  fresh();
  sb.db.hk_contacts.push({ id: 'c-run', business_id: HK, brand_id: ID.run, name: 'Rae Runner', title: 'Marketing lead', email: 'rae@bluefinrun.example', email_source: 'import', is_primary: true, created_at: '2026-10-02T00:00:00Z' });
  brandOf(ID.run).challenge_idea = 'Miles month';
  brandOf(MINE).next_due_at = '2026-10-25T00:00:00Z';
  sb.db.hk_touches.push({ id: 't-mine', business_id: HK, brand_id: MINE, sender_user_id: JACK, channel: 'email', kind: 'cold', subject: 'x', state: 'sent', sent_at: '2026-10-18T00:00:00Z', created_by: 'user', created_at: '2026-10-18T00:00:00Z' });
  const r = await call(briefingRoute, reqOf({ query: { owner: 'me' } }), { supabase: sb, now, today: async () => ({ counts: {} }) });
  const run = r.body.send.find(c => c.id === ID.run);
  assert.deepEqual(run.contact, { name: 'Rae Runner', title: 'Marketing lead', has_email: true, source: 'Email on file · from the sheet' });
  assert.deepEqual([run.is_local, run.challenge_idea, run.command], [false, 'Miles month', 'hk pitch bluefinrun.example']);
  assert.ok(!hasAt(r.body.send) && !/apollo/i.test(JSON.stringify(r.body.send)));
  const w = r.body.waiting.find(x => x.id === MINE);
  assert.equal(w.due, true);
});

test('U5 Waiting on them follows the owner toggle by the touch\'s sender; a 270-day-old sheet send shows Open (due false), a recent one due a bump shows Bump', async () => {
  fresh();
  const OLD = randomUUID(); sb.db.hk_brands.push(extraBrand(OLD, 'Old Sheet Send', { owner_user_id: PETE, status: 'sent', next_due_at: '2026-02-01T00:00:00Z' }));
  sb.db.hk_touches.push({ id: 't-old', business_id: HK, brand_id: OLD, sender_user_id: PETE, channel: 'email', kind: 'cold', subject: 'x', state: 'sent', sent_at: new Date(NOW.getTime() - 270 * 864e5).toISOString(), created_by: 'system', created_at: '2026-10-30T00:00:00Z' });
  brandOf(MINE).next_due_at = '2026-10-25T00:00:00Z'; brandOf(MINE).status = 'sent';
  sb.db.hk_touches.push({ id: 't-mine', business_id: HK, brand_id: MINE, sender_user_id: JACK, channel: 'email', kind: 'cold', subject: 'x', state: 'sent', sent_at: '2026-10-18T00:00:00Z', created_by: 'user', created_at: '2026-10-18T00:00:00Z' });
  const brief = async owner => (await call(briefingRoute, reqOf({ query: { owner } }), { supabase: sb, now, today: async () => ({ counts: {} }) })).body.waiting;
  const mine = await brief('me');
  assert.deepEqual(mine.map(w => [w.name, w.due]), [['Mine Mills', true]], 'Jack sees only what Jack sent');
  const all = await brief('all');
  const old = all.find(w => w.id === OLD);
  assert.deepEqual([old.waiting_days, old.due], [270, false], '270 days old: Open, never Bump');
  assert.deepEqual((await brief(PETE)).map(w => w.name).sort(), ['Old Sheet Send', 'Warm Kettle'], "Pete's toggle = Pete's sends (Harbor Yoga replied)");
});
