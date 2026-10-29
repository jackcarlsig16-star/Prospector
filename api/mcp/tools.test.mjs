// node --test api/mcp/tools.test.mjs
// hkos-mcp-connector-v1 Stage 2 - the hk_* tools as Jack on synthetic fixtures (in-memory Supabase, a recording Gmail
// stub), and /mcp over real HTTP on an ephemeral port. Invented brands and people; addresses only on .invalid.
// 0 network beyond localhost, 0 Claude, 0 real Gmail, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
process.env.GOOGLE_TOKEN_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const { fakeSupabase } = await import('../sales/testing/fakeSupabase.mjs');
const { runTool, toolList, resetLimits, CALLS_PER_WINDOW } = await import('./tools.js');
const { mcpRoute } = await import('./mcpRoute.js');
const { sha256 } = await import('./oauth.js');

const HK = 'biz-hk', JACK = 'u-jack', PETE = 'u-pete';
const B = { yoga: randomUUID(), juice: randomUUID(), cafe: randomUUID(), run: randomUUID(), fp: randomUUID(), unclear: randomUUID(), granite: randomUUID(), granite2: randomUUID(), mine: randomUUID(), willow: randomUUID() };
const NOW = new Date('2026-10-28T20:00:00Z');
const MAILBOX = 'jack.work@humankind.invalid', CONTACT = 'ana@harboryoga.invalid';
const SUBJECT = 'HumanKind x Bluefin Run Club - a 5k streak challenge';
const GOOD_BODY = `Hi Ana - hope the week is going well.\n\nI'm Jack, co-founder of HumanKind, a free community wellness platform launched in Chicago in April. We're at 1,500+ members and 6,000+ verified challenge completions.\n\nYou can check out the community here: https://humankindcollective.app\n\nBluefin Run Club is a natural fit: a "5k streak" challenge with a race entry as the reward.\n\nEvery completion is verified, so you're driving real behavior, not clicks.\n\nWorth a 15-minute call to see if it makes sense?\n\nThanks,\nJack`;
const brand = (id, name, over = {}) => ({ id, business_id: HK, name, normalized_name: name.toLowerCase(), aliases: [], segment: 'sponsor_brand', status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_unclear: false, source: 'user_supplied', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', archived_at: null, ...over });

let sb, gcalls;
const fresh = () => {
  sb = fakeSupabase({
    hk_brands: [
      brand(B.yoga, 'Harbor Yoga', { owner_user_id: PETE, status: 'claimed', domain: 'harboryoga.invalid' }),
      brand(B.juice, 'Northwind Juice', { relationship: 'sponsor', status: 'sponsor', niche: 'cold-pressed juice' }),
      brand(B.cafe, 'Copperleaf Cafe', { relationship: 'do_not_contact', dnc_reason: 'asked us to stop' }),
      brand(B.run, 'Bluefin Run Club', { domain: 'bluefinrun.invalid', aliases: ['Bluefin Runners'] }),
      brand(B.fp, 'Lakeshore Partners', { relationship: 'founding_partner', status: 'sponsor' }),
      brand(B.unclear, 'Prairie Climb', { owner_unclear: true }),
      brand(B.granite, 'Granite Gym', { domain: 'granitegym.invalid' }),
      brand(B.granite2, 'Granite Gym Loop', { aliases: ['Granite Gym'] }),
      brand(B.willow, 'Willow Pilates', { domain: 'willowpilates.invalid' }),
      brand(B.mine, 'Ember Coffee', { owner_user_id: JACK, status: 'replied', next_due_at: '2026-10-27T00:00:00Z' }),
    ],
    hk_contacts: [{ id: 'c-ana', business_id: HK, brand_id: B.run, name: 'Ana Example', title: 'Founder', email: CONTACT, is_primary: true, created_at: '2026-10-02T00:00:00Z' }],
    hk_touches: [{ id: 't-pete', business_id: HK, brand_id: B.willow, sender_user_id: PETE, channel: 'email', kind: 'cold', subject: 'SECRET SUBJECT', body_text: 'SECRET BODY', state: 'sent', sent_at: '2026-10-20T00:00:00Z', gmail_thread_id: 'th-secret', created_by: 'user', created_at: '2026-10-20T00:00:00Z' }],
    hk_replies: [{ id: 'r-1', business_id: HK, brand_id: B.mine, from_name: 'Bo', from_domain: 'ember.invalid', received_at: '2026-10-28T10:00:00Z', label: 'interested', urgent: true, handled: false, summary: 'Wants a call', created_at: '2026-10-28T10:00:00Z' }],
    hk_events: [], hk_sponsor_periods: [], hk_job_runs: [], hk_sync_runs: [], hk_gmail_sync_state: [],
    hk_settings: [{ business_id: HK, members_stat: 1500, completions_stat: 6000, subject_format: 'HumanKind x [Brand] - [descriptor]', banned_phrases: ['synergies'], bump_after_days: 5, final_after_days: 14, max_email_touches: 3, timezone: 'America/Chicago' }],
    hk_member_prefs: [{ business_id: HK, user_id: JACK, avatar_slot: 1, signature_text: 'Jack\nCo-founder, HumanKind' }],
    business_members: [{ business_id: HK, user_id: JACK, name: 'Jack Example', role: 'owner' }, { business_id: HK, user_id: PETE, name: 'Pete Example', role: 'member' }],
    businesses: [{ id: HK, name: 'HumanKind', features: { hk_sales: true } }],
    profiles: [{ id: JACK, display_name: 'Jack Example', is_platform_owner: false }],
    hk_oauth_tokens: [], accounts: [], projects: [], prospects: [],
  }, { now: () => NOW.getTime() });
  gcalls = [];
  resetLimits();
};
const rec = (name, ret) => async (...a) => { gcalls.push(name); return typeof ret === 'function' ? ret(...a) : ret; };
const gmail = { createDraft: rec('createDraft', () => ({ id: 'draft-1', message: { id: 'dmsg-1', threadId: 'th-new' } })), getMessage: rec('getMessage', null), searchMessages: rec('searchMessages', { messages: [] }), getThread: rec('getThread', { messages: [] }) };
const d = () => ({ supabase: sb, gmail, now: () => NOW, slackUrl: null, mailbox: async (biz, uid) => (uid === JACK ? { grant: { id: 'g1', google_email: MAILBOX, error: null }, tether: { purposes: ['drafts'] }, state: 'ok' } : null), tokenFor: async () => 'tok', tokenForGrant: async () => 'tok' });
const ctx = (user = JACK, role = 'owner') => ({ auth: { user: { id: user, name: user === JACK ? 'Jack Example' : 'Pete Example' }, isPlatformOwner: false, roles: new Map([[HK, role]]) }, businessId: HK, origin: 'https://prospector.example', d: d() });
const call = async (name, args, c = ctx()) => { const r = await runTool(c, name, args); return { isError: !!r.isError, body: JSON.parse(r.content[0].text) }; };

test('tools list: 7 tools, read-only hints, every schema closed, and no tool takes a user / owner / mailbox / sender argument', () => {
  const tools = toolList();
  assert.deepEqual(tools.map(t => t.name), ['hk_settings', 'hk_check', 'hk_claim', 'hk_brand', 'hk_draft_save', 'hk_due', 'hk_update']);
  assert.deepEqual(tools.filter(t => t.annotations.readOnlyHint).map(t => t.name), ['hk_settings', 'hk_check', 'hk_brand', 'hk_due']);
  const keys = [];
  const walk = s => { if (s.type === 'object') { assert.equal(s.additionalProperties, false); for (const [k, v] of Object.entries(s.properties)) { keys.push(k); walk(v); } } if (s.type === 'array') walk(s.items); };
  tools.forEach(t => walk(t.inputSchema));
  assert.deepEqual(keys.filter(k => /user|owner|mailbox|sender|inbox|founder|email/i.test(k)), []);
});

test('server-side input checks: unknown fields, wrong types and caps are refused before any work (hk_check max 25)', async () => {
  fresh();
  for (const [name, args] of [['hk_brand', { brand: 'Granite Gym', user_id: PETE }], ['hk_settings', { mailbox: 'x' }], ['hk_check', { brands: [{ name: 'A', owner: PETE }] }], ['hk_check', { brands: Array.from({ length: 26 }, (_, i) => ({ name: `Brand ${i}` })) }], ['hk_update', { brand: 'Granite Gym', status: 'sent' }], ['hk_claim', { brand: 42 }], ['hk_brand', []]]) {
    const r = await call(name, args);
    assert.ok(r.isError, `${name} ${JSON.stringify(args).slice(0, 60)}`);
  }
  assert.equal((await call('hk_check', { brands: Array.from({ length: 25 }, (_, i) => ({ name: `Brand ${i}` })) })).isError, false);
  assert.equal(sb.db.hk_brands.filter(b => b.owner_user_id === JACK).length, 1, 'nothing changed');
});

test('hk_check: the Verdict banner verdicts; warm for the other founder = founder + date + link only, never subject or body', async () => {
  fresh();
  const { body } = await call('hk_check', { brands: [{ name: 'Northwind Juice' }, { name: 'Copperleaf Cafe' }, { name: 'Harbor Yoga' }, { name: 'Willow Pilates', domain: 'willowpilates.invalid' }, { name: 'Totally New Brand' }, { name: 'Bluefin' }, { name: 'Fresh Squeeze', niche: 'Cold-Pressed Juice' }] });
  assert.deepEqual(body.results.map(r => r.verdict), ['sponsor', 'do_not_contact', 'owned_by', 'warm', 'clear', 'possible_duplicate', 'niche_warning']);
  const warm = body.results[3];
  assert.deepEqual([warm.founder_user_id, warm.founder, warm.last_at, warm.brand_url], [PETE, 'Pete', '2026-10-20T00:00:00Z', `https://prospector.example/#hk/brands/${B.willow}`]);
  assert.ok(!/SECRET|th-secret/.test(JSON.stringify(body)), 'no subject, body or thread id');
});

test('hk_claim refuses sponsor, founding partner, do-not-contact, the other founder\'s brand and Unclear; claims an unclaimed one', async () => {
  fresh();
  for (const [ref, why] of [['Northwind Juice', /sponsor/], ['Lakeshore Partners', /founding partner/], ['Copperleaf Cafe', /do not contact/], ['Harbor Yoga', /owned by Pete/], ['Prairie Climb', /Unclear/]]) {
    const r = await call('hk_claim', { brand: ref });
    assert.ok(r.isError, ref); assert.match(r.body.error, why, ref);
  }
  const owner = await call('hk_claim', { brand: 'Harbor Yoga' }, ctx(JACK, 'owner'));
  assert.ok(owner.isError, 'an owner-role member still cannot take the other founder\'s brand through the connector');
  assert.equal(sb.db.hk_brands.filter(b => b.owner_user_id === JACK).length, 1, 'nothing claimed');
  const ok = await call('hk_claim', { brand: 'bluefinrun.invalid' });
  assert.deepEqual([ok.isError, ok.body.claimed, ok.body.brand.owner_user_id, ok.body.brand.status], [false, true, JACK, 'claimed']);
  assert.equal((await call('hk_claim', { brand: 'Bluefin Run Club' })).body.already_yours, true);
});

test('hk_brand: exact name, alias or domain; partial or ambiguous -> candidates, nothing picked', async () => {
  fresh();
  for (const ref of ['Bluefin Run Club', 'bluefin runners', 'https://www.bluefinrun.invalid/about']) {
    const r = await call('hk_brand', { brand: ref });
    assert.deepEqual([r.isError, r.body.brand.id], [false, B.run], ref);
  }
  const r = await call('hk_brand', { brand: 'Bluefin Run Club' });
  assert.equal(r.body.contacts[0].email, CONTACT, 'member sees contact emails, as the Brand page does');
  const partial = await call('hk_brand', { brand: 'Bluefin' });
  assert.ok(partial.isError); assert.deepEqual(partial.body.candidates.map(c => c.id), [B.run]);
  const amb = await call('hk_brand', { brand: 'Granite Gym' });
  assert.ok(amb.isError); assert.match(amb.body.error, /more than one/); assert.deepEqual(amb.body.candidates.map(c => c.id).sort(), [B.granite, B.granite2].sort());
});

test('hk_draft_save: lint failure returns the problems and writes nothing; success = one Gmail draft via the stub (created_by claude), brand Drafted, never sent', async () => {
  fresh();
  const bad = await call('hk_draft_save', { brand: 'Bluefin Run Club', kind: 'cold', subject: SUBJECT, body_markdown: GOOD_BODY.replace('a natural fit:', 'a natural fit —').replace('Worth a 15-minute call to see if it makes sense?', 'Thoughts?') });
  assert.ok(bad.isError); assert.deepEqual(bad.body.problems.map(p => p.rule).sort(), ['call_ask', 'dash']);
  assert.deepEqual([sb.db.hk_touches.length, gcalls.includes('createDraft')], [1, false]);
  const refused = await call('hk_draft_save', { brand: 'Harbor Yoga', kind: 'cold', subject: SUBJECT, body_markdown: GOOD_BODY });
  assert.ok(refused.isError, 'other founder\'s brand: can_contact refuses');
  const ok = await call('hk_draft_save', { brand: 'Bluefin Run Club', contact: 'Ana Example', kind: 'cold', subject: SUBJECT, body_markdown: GOOD_BODY, challenge: '5k streak' });
  assert.equal(ok.isError, false, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.saved_as, ok.body.sent, gcalls.filter(c => c === 'createDraft').length], ['gmail_draft', false, 1]);
  const t = sb.db.hk_touches.at(-1);
  assert.deepEqual([t.created_by, t.sender_user_id, t.state, t.lint_passed], ['claude', JACK, 'drafted', true]);
  assert.deepEqual([sb.db.hk_brands.find(b => b.id === B.run).status, sb.db.hk_brands.find(b => b.id === B.run).owner_user_id], ['drafted', JACK]);
  assert.ok(!gcalls.some(c => /send/i.test(c)));
});

test('hk_draft_save: 20 per Chicago day through the connector, then a polite refusal', async () => {
  fresh();
  for (let i = 0; i < 20; i++) sb.db.hk_touches.push({ id: `t-${i}`, business_id: HK, brand_id: B.mine, sender_user_id: JACK, channel: 'email', kind: 'cold', state: 'drafted', drafted_at: '2026-10-28T15:00:00Z', created_by: 'claude', created_at: '2026-10-28T15:00:00Z' });
  const r = await call('hk_draft_save', { brand: 'Bluefin Run Club', kind: 'cold', subject: SUBJECT, body_markdown: GOOD_BODY });
  assert.ok(r.isError); assert.match(r.body.error, /20 drafts/); assert.equal(gcalls.includes('createDraft'), false);
});

test('hk_settings, hk_due, hk_update; every call writes one Activity row as Claude via connector', async () => {
  fresh();
  const s = await call('hk_settings', {});
  assert.deepEqual([s.body.pitch.members_stat, s.body.caps.max_email_touches, s.body.you.user_id], [1500, 3, JACK]);
  assert.deepEqual(s.body.mailboxes.map(m => [m.founder, m.you, m.state]), [['Jack', true, 'ok'], ['Pete', false, 'not linked']]);
  assert.ok(!JSON.stringify(s.body).includes('@'), 'statuses only, no mailbox address');
  const due = await call('hk_due');
  assert.deepEqual([due.body.urgent_replies.map(r => r.brand_id), due.body.follow_ups_due.map(f => f.brand_id)], [[B.mine], [B.mine]]);
  const up = await call('hk_update', { brand: 'Ember Coffee', status: 'meeting', note: 'call booked Thursday' });
  assert.deepEqual([up.isError, up.body.brand.status], [false, 'meeting']);
  const rows = sb.db.hk_events.filter(e => e.action.startsWith('connector.'));
  assert.deepEqual(rows.map(e => [e.action, e.actor_kind, e.actor_user_id, e.detail.via, e.detail.ok]), [['connector.hk_settings', 'claude', JACK, 'connector', true], ['connector.hk_due', 'claude', JACK, 'connector', true], ['connector.hk_update', 'claude', JACK, 'connector', true]]);
  assert.equal(rows[2].entity_id, B.mine);
  assert.equal(sb.db.hk_events.find(e => e.action === 'brand.status').detail.reason, 'call booked Thursday');
});

test('hk_update refuses a brand the caller does not own (unclaimed -> claim first; the other founder\'s -> owner only); nothing changes', async () => {
  fresh();
  const un = await call('hk_update', { brand: 'Bluefin Run Club', status: 'meeting' });
  assert.ok(un.isError); assert.match(un.body.error, /isn't claimed yet - claim it first \(hk_claim\)/);
  const other = await call('hk_update', { brand: 'Harbor Yoga', status: 'passed' });
  assert.ok(other.isError); assert.match(other.body.error, /owned by Pete - only the owner sets its status/);
  assert.deepEqual([sb.db.hk_brands.find(b => b.id === B.run).status, sb.db.hk_brands.find(b => b.id === B.yoga).status], ['candidate', 'claimed']);
  assert.equal(sb.db.hk_events.filter(e => e.action === 'brand.status').length, 0);
});

test('Settings connector routes: lists only the caller\'s active connections; revoke is the caller\'s own family only; a viewer is refused', async () => {
  fresh();
  const { connectorRoute, revokeConnectorRoute } = await import('./connectorRoutes.js');
  const tok = (id, fam, kind, user, over = {}) => ({ id, family_id: fam, token_hash: id.padEnd(64, '0'), kind, client_id: 'hkc_a', user_id: user, business_id: HK, scope: 'hk', expires_at: '2026-11-20T00:00:00Z', revoked_at: null, last_used_at: null, created_at: '2026-10-28T18:00:00Z', ...over });
  sb.db.hk_oauth_tokens.push(tok('a1', 'fam-a', 'access', JACK, { last_used_at: '2026-10-28T19:30:00Z' }), tok('r1', 'fam-a', 'refresh', JACK), tok('r2', 'fam-old', 'refresh', JACK, { revoked_at: '2026-10-27T00:00:00Z' }), tok('r3', 'fam-pete', 'refresh', PETE));
  sb.db.hk_oauth_clients = [{ client_id: 'hkc_a', name: 'Claude' }];
  const req = (user, role = 'owner', params = {}) => ({ method: 'GET', params: { businessId: HK, ...params }, query: {}, body: {}, protocol: 'https', get: () => 'prospector.example', auth: { user: { id: user }, isPlatformOwner: false, roles: new Map([[HK, role]]) } });
  const res = () => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
  const l = res(); await connectorRoute(req(JACK), l, { supabase: sb, now: () => NOW });
  assert.deepEqual(l.body, { mcp_url: 'https://prospector.example/mcp', connections: [{ family_id: 'fam-a', client_name: 'Claude', created_at: '2026-10-28T18:00:00Z', last_used_at: '2026-10-28T19:30:00Z' }], last_call_at: '2026-10-28T19:30:00Z' });
  assert.ok(!JSON.stringify(l.body).includes('token_hash'));
  const v = res(); await connectorRoute(req(JACK, 'viewer'), v, { supabase: sb }); assert.equal(v.code, 403);
  const theirs = res(); await revokeConnectorRoute(req(JACK, 'owner', { familyId: 'fam-pete' }), theirs, { supabase: sb, now: () => NOW });
  assert.equal(theirs.code, 404); assert.equal(sb.db.hk_oauth_tokens.find(t => t.id === 'r3').revoked_at, null);
  const mine = res(); await revokeConnectorRoute(req(JACK, 'owner', { familyId: 'fam-a' }), mine, { supabase: sb, now: () => NOW });
  assert.deepEqual(mine.body, { revoked: 2 });
  assert.ok(sb.db.hk_oauth_tokens.filter(t => t.family_id === 'fam-a').every(t => t.revoked_at));
  assert.equal(sb.db.hk_events.at(-1).action, 'connector.revoked');
  const after = res(); await connectorRoute(req(JACK), after, { supabase: sb, now: () => NOW });
  assert.deepEqual(after.body.connections, []);
});

test(`limit: ${CALLS_PER_WINDOW} tool calls per user per 10 minutes`, async () => {
  fresh();
  for (let i = 0; i < CALLS_PER_WINDOW; i++) await runTool(ctx(), 'hk_settings', {});
  const r = await call('hk_settings', {});
  assert.ok(r.isError); assert.match(r.body.error, /60 connector calls/);
  assert.equal((await call('hk_settings', {}, ctx(PETE, 'member'))).isError, false, 'per user');
});

test('/mcp over HTTP: 401 + WWW-Authenticate without a token; initialize + tools/list + tools/call with one; GET is 405', async () => {
  fresh();
  sb.db.hk_oauth_tokens.push({ id: 'tok-1', family_id: 'fam-1', token_hash: sha256('a'.repeat(43)), kind: 'access', client_id: 'hkc_x', user_id: JACK, business_id: HK, scope: 'hk', expires_at: '2026-10-28T21:00:00Z', revoked_at: null });
  const app = express(); app.use(express.json()); app.all('/mcp', (req, res) => mcpRoute(req, res, d()));
  const server = app.listen(0); const url = `http://127.0.0.1:${server.address().port}/mcp`;
  try {
    const rpc = (body, auth = true) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { authorization: `Bearer ${'a'.repeat(43)}` } : {}) }, body: JSON.stringify(body) });
    const no = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, false);
    assert.equal(no.status, 401); assert.match(no.headers.get('www-authenticate'), /^Bearer resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"$/);
    const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
    assert.equal(init.status, 200); assert.equal((await init.json()).result.serverInfo.name, 'humankind-grow');
    const list = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    assert.equal(list.result.tools.length, 7);
    const callRes = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'hk_settings', arguments: {} } })).json();
    assert.equal(JSON.parse(callRes.result.content[0].text).pitch.members_stat, 1500);
    assert.equal((await fetch(url)).status, 405);
  } finally { server.close(); }
});
