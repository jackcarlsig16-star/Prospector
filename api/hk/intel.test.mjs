// node --test api/hk/intel.test.mjs
// grow-inbox-intel-v1 REV3 Stage 2 - B2 / B3 / B3a / B6 scorers, R1 research by name + Use, the M2 sweep and the
// Briefing route on the in-memory Supabase. Invented brands and people; Claude STUBBED (0 real calls), 0 Gmail, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from '../sales/testing/fakeSupabase.mjs';
import { INTEL_DEFAULTS, intelSettings, reachOf, rankReach, importanceOf, activityOf, inTargetCategory, isLocal } from './intelScore.js';
import { researchBrand, researchPrompt, parseWebsite, useDomainRoute, SWEEP_CALL_TYPE } from './brandResearch.js';
import { researchSweep, sweepQueue } from './researchSweep.js';
import { loadIntel } from './intelData.js';
import { briefingRoute, reachRoute } from './briefingRoutes.js';

const HK = 'biz-hk', ME = 'u-me', OTHER = 'u-other';
const NOW = new Date('2026-10-29T15:00:00Z');
const ids = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'sp', 'fp', 'dnc', 'mine', 'theirs', 'unclear', 'passed', 'warm', 'maxed', 'cat', 'chi', 'nofit'].map(k => [k, randomUUID()]));
const brand = (id, name, over = {}) => ({ id, business_id: HK, name, normalized_name: name.toLowerCase(), aliases: [], segment: 'sponsor_brand', status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_unclear: false, owner_hint: null, source: 'import', category: null, is_local: false, domain: null, heat: 0, heat_band: 'cold', created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z', archived_at: null, ...over });
const BRANDS = () => [
  brand(ids.a, 'Zz Alder Oats', { challenge_idea: '30-day oat run' }),
  brand(ids.b, 'Zz Birch Bars'),
  brand(ids.c, 'Zz Cedar Cola', { domain: 'cedarcola.invalid' }),
  brand(ids.sp, 'Zz Sponsor Co', { relationship: 'sponsor', status: 'sponsor', niche: 'oats' }),
  brand(ids.fp, 'Zz Founding Co', { relationship: 'founding_partner', status: 'sponsor' }),
  brand(ids.dnc, 'Zz Never Co', { relationship: 'do_not_contact' }),
  brand(ids.theirs, 'Zz Theirs Co', { owner_user_id: OTHER, status: 'claimed' }),
  brand(ids.unclear, 'Zz Unclear Co', { owner_unclear: true }),
  brand(ids.passed, 'Zz Passed Co', { status: 'passed' }),
  brand(ids.warm, 'Zz Warm Co'),
  brand(ids.maxed, 'Zz Maxed Co', { status: 'claimed', owner_user_id: ME }),
];
const contacts = [{ id: 'k1', business_id: HK, brand_id: ids.a, name: 'Ana', email: 'ana@alder.invalid' }, { id: 'k2', business_id: HK, brand_id: ids.b, name: 'Bo', email: null }];
const touches = [{ id: 'tw', business_id: HK, brand_id: ids.warm, sender_user_id: OTHER, channel: 'email', kind: 'cold', state: 'sent', sent_at: '2026-10-20T00:00:00Z' },
  ...[1, 2, 3].map(i => ({ id: `tm${i}`, business_id: HK, brand_id: ids.maxed, sender_user_id: ME, channel: 'email', kind: 'cold', state: 'sent', sent_at: `2026-10-0${i}T00:00:00Z` }))];
const members = [{ business_id: HK, user_id: ME, name: 'Rowan Example', role: 'owner', created_at: '2026-09-01T00:00:00Z' }, { business_id: HK, user_id: OTHER, name: 'Sky Example', role: 'member', created_at: '2026-09-02T00:00:00Z' }];
const fresh = (extra = {}) => fakeSupabase({
  hk_brands: BRANDS(), hk_contacts: contacts, hk_touches: touches, hk_replies: [], hk_domain_intel: [], hk_settings: [{ business_id: HK, timezone: 'America/Chicago', max_email_touches: 3, intel: {} }],
  business_members: members, hk_job_runs: [], hk_events: [], hk_signals: [], business_anthropic_usage: [], ...extra,
}, { now: () => NOW.getTime() });
const ctxOf = async (sb, meId = ME) => ({ ...(await loadIntel(sb, HK, NOW)), meId, now: NOW });
const reqOf = ({ method = 'GET', params = {}, query = {}, body = {}, user = ME, role = 'owner' } = {}) => ({ method, params: { businessId: HK, ...params }, query, body, auth: { user: { id: user, name: 'T' }, isPlatformOwner: false, roles: new Map([[HK, role]]) } });
const call = async (route, req, deps) => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; await route(req, r, deps); return r; };
const reply = (obj, searches = 2) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 4000, output_tokens: 600, server_tool_use: { web_search_requests: searches } }, stop_reason: 'end_turn' });
const answer = (over = {}) => ({ website_domain: 'alderoats.invalid', website_confidence: 'high', company: { name: 'Alder Oats', website: 'https://alderoats.invalid', what_they_do: 'Chicago oat milk maker', category: 'consumer brand' }, fit: { sponsor_fit: 'strong', why: 'Wellness audience', challenge_idea: '30-day oat run' }, next_step: 'track_as_brand', reason: 'fits', ...over });
const stub = (answers = [answer()]) => { const calls = []; let i = 0; return { calls, call: async opts => { calls.push(opts); const a = answers[Math.min(i++, answers.length - 1)]; if (a instanceof Error) throw a; return reply(a); } }; };
const brandRow = (sb, id) => sb.db.hk_brands.find(b => b.id === id);

test('B3 eligibility runs through can_contact: sponsor, founding partner, DNC, the other founder\'s, Unclear, passed, warm and 3-touch brands never appear', async () => {
  const ctx = await ctxOf(fresh());
  const names = rankReach(ctx.brands, ctx, { limit: null }).map(r => r.brand.name);
  assert.deepEqual(names.sort(), ['Zz Alder Oats', 'Zz Birch Bars', 'Zz Cedar Cola']);
});

test('B3 components: contact with an email, idea, website, researched, Chicago as local (category or flag), target category (case-insensitive), fit, heat, targeted, mine untouched, niche overlap, size', async () => {
  const sb = fresh({ hk_domain_intel: [{ id: 'i1', business_id: HK, domain: 'cedarcola.invalid', intel: { fit: { sponsor_fit: 'possible' } }, cost_usd: 0.04, researched_at: '2026-10-28T00:00:00Z' }] });
  const ctx = await ctxOf(sb);
  const parts = b => reachOf(b, ctx)?.parts.map(([k]) => k) || null;
  assert.deepEqual(parts(ctx.brands.find(b => b.id === ids.a)), ['draftable', 'idea']);
  assert.deepEqual(parts(ctx.brands.find(b => b.id === ids.b)), [], 'a contact without an email is not draftable');
  assert.deepEqual(parts(ctx.brands.find(b => b.id === ids.c)), ['website', 'researched', 'fit_possible']);
  assert.equal(reachOf(ctx.brands.find(b => b.id === ids.c), ctx).score, 10 + 5 + 10);
  const W = INTEL_DEFAULTS.weights;
  const extra = brand(ids.chi, 'Zz Chicago Co', { category: 'chicago', heat_band: 'hot', targeted_at: '2026-10-28T00:00:00Z', size_band: 'Large', niche: 'Oats' });
  const r = reachOf(extra, ctx);
  assert.deepEqual(r.parts.map(([k]) => k), ['local', 'heat_hot', 'targeted', 'niche_overlap', 'size_large']);
  assert.equal(r.score, W.local + W.heat_hot + W.targeted + W.niche_overlap + W.size_large);
  assert.deepEqual(r.why, ['Chicago local', 'Hot right now']);
  assert.equal(isLocal(brand(ids.e, 'x', { is_local: true })), true);
  for (const c of ['national cpg', 'Wellness', 'GYM/STUDIO']) assert.ok(inTargetCategory({ category: c }, ctx.settings.target_categories), c);
  assert.equal(inTargetCategory({ category: 'Founder' }, ctx.settings.target_categories), false, 'Founder is not a category target');
  assert.equal(inTargetCategory({ category: 'Chicago' }, ctx.settings.target_categories), false, 'Chicago counts as local, not a category');
  assert.ok(reachOf(brand(ids.cat, 'Zz Cat', { category: 'National CPG', heat_band: 'warm' }), ctx).parts.some(([k]) => k === 'category'));
  // Claimed 15 days ago (the brand.claimed event), then an unrelated edit yesterday (updated_at moves): still untouched.
  const mine = brand(ids.mine, 'Zz Mine', { owner_user_id: ME, status: 'claimed', updated_at: '2026-10-28T00:00:00Z' });
  const claimed = { ...ctx, claimedAt: { [ids.mine]: '2026-10-14T00:00:00Z' } };
  assert.ok(reachOf(mine, claimed).parts.some(([k]) => k === 'mine_untouched'), 'an edit after the claim does not reset it');
  assert.ok(!reachOf(mine, { ...ctx, claimedAt: { [ids.mine]: '2026-10-25T00:00:00Z' } }).parts.some(([k]) => k === 'mine_untouched'), 'claimed 4 days ago');
  assert.ok(!reachOf(mine, { ...ctx, claimedAt: {} }).parts.some(([k]) => k === 'mine_untouched'), 'no claim event, no credit (updated_at is never used)');
  const emailed = { ...claimed, touchesBy: { [ids.mine]: [{ id: 'tx', channel: 'email', state: 'sent', sent_at: '2026-10-20T00:00:00Z' }] } };
  assert.ok(!(reachOf(mine, emailed)?.parts || []).some(([k]) => k === 'mine_untouched'), 'an email sent since the claim (can_contact then holds it as warm)');
  ctx.intelByDomain['nofit.invalid'] = { intel: { fit: { sponsor_fit: 'not_a_fit' } }, researched_at: '2026-10-28T00:00:00Z' };
  assert.equal(reachOf(brand(ids.nofit, 'Zz No Fit', { domain: 'nofit.invalid' }), ctx), null, 'not a fit -> excluded');
  const custom = intelSettings({ weights: { idea: 50 }, target_categories: ['Founder'] });
  assert.equal(custom.weights.idea, 50); assert.equal(custom.weights.draftable, 15, 'merged, never replaced'); assert.deepEqual(custom.target_categories, ['Founder']);
});

test('B3 ties: owner hint = my first name (from business_members) -> idea -> any contact -> A-Z; no founder names in the code', async () => {
  const sb = fresh({ hk_brands: [
    brand(ids.d, 'Zz Delta'), brand(ids.e, 'Zz Echo', { owner_hint: 'rowan' }), brand(ids.f, 'Zz Foxtrot', { challenge_idea: 'x' }),
    brand(ids.g, 'Zz Golf'), brand(ids.h, 'Zz Hotel', { owner_hint: 'sky' }),
  ], hk_contacts: [{ id: 'k9', business_id: HK, brand_id: ids.g, name: 'G', email: null }], hk_touches: [] });
  const ctx = await ctxOf(sb);
  // idea adds 10, so Foxtrot leads on score; the rest tie at 0.
  assert.deepEqual(rankReach(ctx.brands, ctx, { meFirstName: 'Rowan' }).map(r => r.brand.name), ['Zz Foxtrot', 'Zz Echo', 'Zz Golf', 'Zz Delta', 'Zz Hotel']);
  const src = fs.readFileSync(new URL('./intelScore.js', import.meta.url), 'utf8') + fs.readFileSync(new URL('./researchSweep.js', import.meta.url), 'utf8');
  assert.ok(!/\b(jack|pete|cyrus)\b/i.test(src), 'no hard-coded founder names');
});

test('B2 importance: label, question, decline, status, sponsor, fit, heat, warm, unread, waiting (capped), new person, teammate; the top reason in words', () => {
  const c = { byId: { b1: { id: 'b1', status: 'replied', relationship: 'prospect', heat_band: 'hot' }, b2: { id: 'b2', status: 'candidate', relationship: 'sponsor', heat_band: 'cold' } }, warmBrands: new Set(['b1']), settings: intelSettings({}), now: NOW };
  const hot = importanceOf({ lane: 'needs_you', unread: true, snippet: 'What does a challenge cost?', date: '2026-10-26T15:00:00Z', chip: { kind: 'tracked', brand_id: 'b1', label: 'pricing' } }, c);
  assert.equal(hot.score, 40 + 20 + 25 + 25 + 10 + 10 + 6);
  assert.equal(hot.why, 'Replied: pricing question');
  const decline = importanceOf({ lane: 'needs_you', snippet: 'No thanks', date: NOW.toISOString(), chip: { kind: 'tracked', brand_id: 'b2', label: 'decline' } }, c);
  assert.deepEqual([decline.score, decline.why], [-20 + 20, 'A sponsor']);
  const person = importanceOf({ lane: 'needs_you', snippet: 'hi', date: '2026-10-01T00:00:00Z', intel_fit: 'strong', chip: { kind: 'untracked' } }, c);
  assert.deepEqual([person.score, person.why], [20 + 15 + 5, 'Strong fit'], 'waiting caps at +15');
  assert.equal(importanceOf({ lane: 'needs_you', date: NOW.toISOString(), chip: { kind: 'team' } }, c).score, 5);
  const ours = importanceOf({ lane: 'needs_you', latest_from_us: true, snippet: 'Does Tuesday work?', date: '2026-10-20T00:00:00Z', chip: { kind: 'tracked', brand_id: 'b2' } }, c);
  assert.ok(!ours.parts.includes('question') && !ours.parts.includes('waiting'), 'our own question is never theirs, and our message ends the wait');
});

test('B6 activity: last inbound / outbound, threads, touches used, waiting days, open reply', () => {
  const t = [{ id: 't1', channel: 'email', kind: 'cold', state: 'sent', sent_at: '2026-10-20T15:00:00Z', gmail_thread_id: 'th1' }, { id: 't2', channel: 'email', kind: 'bump', state: 'sent', sent_at: '2026-10-25T15:00:00Z', gmail_thread_id: 'th1' }, { id: 't3', channel: 'email', state: 'drafted' }];
  assert.deepEqual(activityOf(t, [], { now: NOW }), { last_inbound: null, last_outbound: { at: '2026-10-25T15:00:00Z', kind: 'bump', channel: 'email' }, thread_count: 1, touches_used: 2, max_email_touches: 3, waiting_days: 4, open_reply: false });
  const a = activityOf(t, [{ id: 'r1', label: 'interested', handled: false, received_at: '2026-10-26T00:00:00Z', gmail_thread_id: 'th2' }], { now: NOW });
  assert.deepEqual([a.waiting_days, a.open_reply, a.thread_count, a.last_inbound.label], [null, true, 2, 'interested']);
});

test('R1 research by name: the prompt holds no address; high confidence -> suggestion, intel under the found domain, brand domain untouched; Use copies it with an Activity row', async () => {
  const sb = fresh(); const s = stub();
  const b = { ...brandRow(sb, ids.a), name: 'Zz Alder Oats (ana@alder.invalid, 312-555-0100)' };
  const p = researchPrompt({ brand: b });
  assert.ok(!/@|555-0100/.test(p.system + p.user), 'no address or phone in the prompt');
  assert.match(p.system, /OFFICIAL website - not a marketplace/);
  const r = await researchBrand({ D: { supabase: sb, call: s.call, now: () => NOW }, businessId: HK, uid: ME, brand: brandRow(sb, ids.a) });
  assert.deepEqual([r.status, r.domain, r.confidence, s.calls.length, s.calls[0].tools[0].max_uses, s.calls[0].callType], ['researched', 'alderoats.invalid', 'high', 1, 3, 'hk_inbox_analyze']);
  assert.ok(sb.db.hk_domain_intel.some(i => i.domain === 'alderoats.invalid' && i.intel.fit.sponsor_fit === 'strong'));
  assert.deepEqual([brandRow(sb, ids.a).domain, brandRow(sb, ids.a).domain_suggested, brandRow(sb, ids.a).domain_confidence], [null, 'alderoats.invalid', 'high']);
  assert.ok(sb.db.hk_signals.some(x => x.kind === 'research_strong_fit' && x.brand_id === ids.a));
  const again = await researchBrand({ D: { supabase: sb, call: s.call, now: () => NOW }, businessId: HK, uid: ME, brand: brandRow(sb, ids.a) });
  assert.deepEqual([again.status, s.calls.length], ['cached', 1], 'the 30-day cache answers, 0 calls');
  const used = await call(useDomainRoute, reqOf({ method: 'POST', params: { id: ids.a } }), { supabase: sb, now: () => NOW });
  assert.equal(used.code, 200, JSON.stringify(used.body));
  assert.equal(brandRow(sb, ids.a).domain, 'alderoats.invalid');
  assert.deepEqual(sb.db.hk_events.map(e => e.action), ['brand.domain_used']);
});

test('R1: low confidence stays a suggestion; a marketplace is never a website; nothing found sets research_attempted_at; Use refused when another brand has the domain', async () => {
  assert.deepEqual(parseWebsite(JSON.stringify({ website_domain: 'https://www.etsy.com/shop/x', website_confidence: 'high' })), { domain: null, confidence: null });
  assert.deepEqual(parseWebsite(JSON.stringify({ website_domain: 'birchbars.invalid', website_confidence: 'maybe' })), { domain: 'birchbars.invalid', confidence: 'low' });
  const sb = fresh(); const s = stub([answer({ website_domain: 'cedarcola.invalid', website_confidence: 'low' }), answer({ website_domain: null })]);
  const D = { supabase: sb, call: s.call, now: () => NOW };
  const low = await researchBrand({ D, businessId: HK, uid: ME, brand: brandRow(sb, ids.b) });
  assert.deepEqual([low.confidence, brandRow(sb, ids.b).domain_confidence, brandRow(sb, ids.b).domain], ['low', 'low', null]);
  const refused = await call(useDomainRoute, reqOf({ method: 'POST', params: { id: ids.b } }), { supabase: sb, now: () => NOW });
  assert.deepEqual([refused.code, refused.body.error], [409, 'Already on Zz Cedar Cola']);
  assert.equal(brandRow(sb, ids.b).domain, null);
  const none = await researchBrand({ D, businessId: HK, uid: ME, brand: brandRow(sb, ids.a) });
  assert.deepEqual([none.status, brandRow(sb, ids.a).research_attempted_at, brandRow(sb, ids.a).domain_suggested ?? null], ['not_found', NOW.toISOString(), null]);
  assert.equal(sb.db.hk_domain_intel.length, 1, 'nothing stored for not found');
});

const sweepD = (sb, s, extra = {}) => ({ supabase: sb, call: s.call, now: () => NOW, senders: () => [], ...extra });

test('M2 order: B3 top candidates without intel first (by name, else domain), then Needs-you senders; cache and attempted window skipped', async () => {
  const sb = fresh({ hk_domain_intel: [{ id: 'i1', business_id: HK, domain: 'cedarcola.invalid', intel: { fit: { sponsor_fit: 'weak' } }, cost_usd: 0.04, researched_at: '2026-10-20T00:00:00Z' }] });
  brandRow(sb, ids.b).research_attempted_at = '2026-10-15T00:00:00Z';
  const data = await loadIntel(sb, HK, NOW);
  const q = sweepQueue(data, { meIds: [ME], senders: [{ name: 'Ivy', domain: 'ivyfit.invalid' }, { name: 'Cedar', domain: 'cedarcola.invalid' }], now: NOW });
  assert.deepEqual(q.map(x => x.brand.name), ['Zz Alder Oats', 'Ivy'], 'Cedar cached, Birch attempted, the cached sender skipped');
});

test('M2 caps: N per Chicago day, the dollar cap, stop on error, never from page load, switch off = no call, cron once a day; usage call type hk_research_sweep', async () => {
  const many = Array.from({ length: 12 }, (_, i) => brand(randomUUID(), `Zz Sweep ${String(i).padStart(2, '0')}`));
  let sb = fresh({ hk_brands: many, hk_touches: [], hk_contacts: [] }); let s = stub();
  const r1 = await researchSweep({ businessId: HK, trigger: 'cron', d: sweepD(sb, s) });
  assert.deepEqual([r1.counts.calls, s.calls.length, r1.run.job, r1.run.trigger, r1.counts.stopped], [10, 10, 'research-sweep', 'cron', 'daily count']);
  assert.ok(s.calls.every(c => c.callType === SWEEP_CALL_TYPE));
  assert.deepEqual(await researchSweep({ businessId: HK, trigger: 'cron', d: sweepD(sb, s) }), { skipped: 'already ran today' });
  assert.equal((await researchSweep({ businessId: HK, trigger: 'manual', startedBy: ME, d: sweepD(sb, s) })).skipped, 'daily count reached');
  assert.equal(s.calls.length, 10);
  await assert.rejects(researchSweep({ businessId: HK, trigger: 'pageload', d: sweepD(sb, s) }), /never runs from a page load/);
  // Dollar cap: each stubbed call costs > $0.30, so a $1 cap stops after 4 (the 4th crosses it).
  sb = fresh({ hk_brands: many, hk_touches: [], hk_contacts: [] }); s = stub();
  const big = { ...s, call: async o => { const r = await s.call(o); r.usage.input_tokens = 100000; return r; } };
  const r2 = await researchSweep({ businessId: HK, trigger: 'manual', startedBy: ME, d: sweepD(sb, big) });
  assert.equal(r2.counts.stopped, 'dollar cap'); assert.ok(r2.counts.cost_usd >= 1 && r2.counts.calls < 10, JSON.stringify(r2.counts));
  // Error: stops at once, run marked partial with the message.
  sb = fresh({ hk_brands: many, hk_touches: [], hk_contacts: [] }); s = stub([answer(), new Error('upstream 529')]);
  const r3 = await researchSweep({ businessId: HK, trigger: 'manual', startedBy: ME, d: sweepD(sb, s) });
  assert.deepEqual([r3.run.status, r3.counts.calls, r3.counts.stopped, s.calls.length], ['partial', 1, 'error', 2]);
  // Switch off: no run row, no call.
  sb = fresh({ hk_brands: many, hk_touches: [], hk_contacts: [], hk_settings: [{ business_id: HK, timezone: 'America/Chicago', intel: { sweep: { on: false } } }] }); s = stub();
  assert.deepEqual(await researchSweep({ businessId: HK, trigger: 'cron', d: sweepD(sb, s) }), { skipped: 'off' });
  assert.deepEqual([s.calls.length, sb.db.hk_job_runs.length], [0, 0]);
  const runner = fs.readFileSync(new URL('./jobs/runner.js', import.meta.url), 'utf8');
  assert.ok(!/researchSweep|research-sweep/.test(runner), 'the page-load runner never references the sweep');
});

test('Briefing: tiles, Send these 10 (eligible only, with why and the Claude command), Waiting on them, signals, the research day; reach line; no address anywhere', async () => {
  const sb = fresh();
  const today = async () => ({ digest: { counts: { urgent: 1, replies: 2, drafts: 3, dm_ready: 1 } } });
  const r = await call(briefingRoute, reqOf(), { supabase: sb, now: () => NOW, today });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.send.map(c => [c.name, c.score, c.why]), [['Zz Alder Oats', 25, ['has a contact to email', 'has a challenge idea']], ['Zz Cedar Cola', 10, ['has a website']], ['Zz Birch Bars', 0, []]]);
  assert.equal(r.body.send[1].command, 'hk pitch cedarcola.invalid'); assert.equal(r.body.send[0].command, 'hk pitch Zz Alder Oats');
  assert.deepEqual([r.body.tiles.replies_waiting, r.body.tiles.drafts, r.body.tiles.dms_due, r.body.tiles.reply_rate_week, r.body.tiles.researched_today], [3, 3, 1, null, { n: 0, cap: 10 }]);
  assert.deepEqual(r.body.waiting.map(w => [w.name, w.waiting_days]), [['Zz Maxed Co', 26]]);
  assert.ok(r.body.signals && Array.isArray(r.body.signals.prospects));
  assert.equal(r.body.eligible, 3);
  assert.ok(!JSON.stringify(r.body).includes('@'), 'no address in the Briefing');
  const reach = await call(reachRoute, reqOf({ params: { id: ids.a } }), { supabase: sb, now: () => NOW });
  assert.deepEqual([reach.body.eligible, reach.body.score, reach.body.why], [true, 25, ['has a contact to email', 'has a challenge idea']]);
  const not = await call(reachRoute, reqOf({ params: { id: ids.sp } }), { supabase: sb, now: () => NOW });
  assert.deepEqual([not.body.eligible, not.body.score], [false, null]);
});

test('Settings intel patch: target categories + auto-research controls merge; weights stay read-only; bad values refused', async () => {
  const { intelPatch } = await import('./opsRoutes.js');
  const cur = { sweep: { on: true, n: 10 }, extra: 1 };
  assert.deepEqual(intelPatch({ target_categories: ['National CPG', ' Wellness ', 'National CPG'], sweep: { n: 1, cap_usd: 0.5, time: '05:15', on: false } }, cur),
    { extra: 1, target_categories: ['National CPG', 'Wellness'], sweep: { on: false, n: 1, cap_usd: 0.5, time: '05:15' } });
  for (const bad of [{ weights: { idea: 5 } }, { sweep: { n: 40 } }, { sweep: { cap_usd: 9 } }, { sweep: { time: '6:30pm' } }, { target_categories: 'gym' }]) assert.throws(() => intelPatch(bad, cur), /read-only|whole number|dollar cap|look like|list/);
});
