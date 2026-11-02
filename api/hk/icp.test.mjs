// grow-pitch-icp REV2 - synthetic: the ICP part of the reach score (retail +40 top signal, media -30, not researched +20),
// weights from hk_settings.intel.icp, Why score lists ICP first, the sweep order follows, the Partnerships view, Move to
// Partnerships (segment edit + Undo + Activity), Settings validation. 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed, reqOf, call, HK, JACK, NOW } from './testing.mjs';
import { icpOf, reachOf, rankReach, intelSettings, INTEL_DEFAULTS } from './intelScore.js';
import { intelPatch, getSettingsRoute } from './opsRoutes.js';
import { cardOf } from './briefingRoutes.js';
import { sweepQueue } from './researchSweep.js';
import { valuesOf, VIEWS } from './brandFilters.js';
import { patchBrandRoute, getBrandRoute } from './brandsRoutes.js';

const brand = (name, over = {}) => ({ id: randomUUID(), business_id: HK, name, normalized_name: name.toLowerCase(), aliases: [], segment: 'sponsor_brand', is_local: false, status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_hint: null, owner_unclear: false, archived_at: null, domain: `${name.toLowerCase().replace(/\W+/g, '')}.example`, created_at: '2026-10-01T00:00:00Z', ...over });
const intelRow = (domain, company) => ({ domain, intel: { company, fit: { sponsor_fit: 'possible' } }, researched_at: '2026-10-20T00:00:00Z' });
const ctxFor = (brands, intel = [], settings = intelSettings()) => ({ meId: JACK, meFirstName: 'Jack', settings, touchesBy: {}, repliesBy: {}, contactsBy: Object.fromEntries(brands.map(b => [b.id, [{ has_email: true }]])), intelByDomain: Object.fromEntries(intel.map(i => [i.domain, i])), sponsorsNiches: [], now: NOW, brands, periodsBy: {}, settingsRow: {}, members: [] });

test('I1 ICP verdicts: retail sponsor brand +40, not researched +20, media by segment or research words -30 (with the segment it would move to)', () => {
  assert.deepEqual(icpOf({ segment: 'sponsor_brand' }, { intel: { company: { industry: 'Food & Beverage', what_they_do: 'Granola bars' } } }), { key: 'retail', label: 'Retail brand', points: 40 });
  assert.deepEqual(icpOf({ segment: 'sponsor_brand' }, null), { key: 'unknown', label: 'Not researched yet', points: 20 });
  assert.deepEqual(icpOf({ segment: 'podcast' }, null), { key: 'media', label: 'Podcast', points: -30 });
  assert.deepEqual(icpOf({ segment: 'creator' }, null), { key: 'other', label: 'Creator', points: 0 });
  assert.deepEqual(icpOf({ segment: 'sponsor_brand' }, { intel: { company: { industry: 'Podcast / Media' } } }), { key: 'media', label: 'Looks like media', points: -30, looks_like: 'podcast' });
  assert.equal(icpOf({ segment: 'sponsor_brand' }, { intel: { company: { what_they_do: 'A Chicago charity for kids' } } }).looks_like, 'nonprofit');
  assert.equal(icpOf({ segment: 'sponsor_brand' }, { intel: { company: { industry: 'Publishing' } } }).looks_like, 'press');
  assert.equal(icpOf({ segment: 'sponsor_brand' }, { intel: { company: { industry: 'Cold-pressed juice' } } }).key, 'retail', 'whole words: pressed juice is retail');
  assert.equal(icpOf({ segment: 'sponsor_brand' }, { intel: { company: { what_they_do: 'Runs two podcasts' } } }).looks_like, 'podcast');
});

test('I1 ranking: a retail brand outranks an otherwise-equal podcast; ICP leads Why score; weights from hk_settings.intel.icp override', () => {
  const retail = brand('Zz Granola Co'), pod = brand('Zz Talk Show', { segment: 'podcast' }), fresh = brand('Zz Unknown Co');
  const intel = [intelRow(retail.domain, { industry: 'Food' }), intelRow(pod.domain, { industry: 'Podcast' })];
  const ctx = ctxFor([pod, fresh, retail], intel);
  const ranked = rankReach(ctx.brands, ctx, { limit: null });
  assert.deepEqual(ranked.map(r => [r.brand.name, r.icp.key, r.parts[0]]), [['Zz Granola Co', 'retail', ['icp', 40]], ['Zz Unknown Co', 'unknown', ['icp', 20]], ['Zz Talk Show', 'media', ['icp', -30]]]);
  assert.equal(ranked[0].score - ranked[2].score, 70, 'same other parts, +40 vs -30');
  assert.equal(ranked[0].why[0], 'ICP: retail brand');
  const card = cardOf(ranked[0], { ...ctx, repliesBy: {}, touchesBy: {}, contactsBy: {} }, JACK);
  assert.deepEqual([card.score_parts[0], card.icp.label], [{ key: 'icp', words: 'ICP: Retail brand', points: 40 }, 'Retail brand']);
  const flipped = ctxFor([pod, retail], intel, intelSettings({ icp: { retail: 0, media: 50 } }));
  assert.deepEqual(rankReach(flipped.brands, flipped, { limit: null }).map(r => r.brand.name), ['Zz Talk Show', 'Zz Granola Co']);
  assert.deepEqual(intelSettings({ icp: { media: -10 } }).icp, { retail: 40, media: -10, unknown: 20 });
  assert.deepEqual(INTEL_DEFAULTS.icp, { retail: 40, media: -30, unknown: 20 });
});

test('I5 the research sweep queue follows the same ranking: unresearched retail before an unresearched podcast', () => {
  const pod = brand('Zz Pod Two', { segment: 'podcast' }), shop = brand('Zz Shop Two');
  const data = { ...ctxFor([pod, shop]), settings: { ...intelSettings(), retry_days: 30 } };
  assert.deepEqual(sweepQueue(data, { meIds: [JACK], now: NOW }).filter(x => x.kind === 'brand').map(x => x.brand.name), ['Zz Shop Two', 'Zz Pod Two']);
});

test('I4 Partnerships view: press, podcast, nonprofit, university, creator; sponsor brands never', () => {
  assert.ok(VIEWS.includes('partnerships'));
  const data = { touches: {}, replies: {}, hasEmail: new Set(), intel: new Set(), months: new Set(), threads: {}, periodsBy: {} };
  const inView = b => valuesOf(b, data, { meId: JACK, now: NOW }).view.includes('partnerships');
  assert.deepEqual(['press', 'podcast', 'nonprofit', 'university', 'creator', 'sponsor_brand'].map(s => inView(brand('Zz X', { segment: s }))), [true, true, true, true, true, false]);
});

test('I2 Move to Partnerships = a segment edit with an Activity row (brand.segment, prev) and Undo; the Brand page carries the ICP verdict', async () => {
  const b = brand('Zz Mediaish', { domain: 'mediaish.example' });
  const sb = seed({ hk_brands: [b], hk_domain_intel: [{ id: 'i1', business_id: HK, ...intelRow('mediaish.example', { industry: 'Podcast network' }) }], hk_brand_threads: [] });
  const deps = { supabase: sb, now: () => NOW };
  const g = await call(getBrandRoute, reqOf({ params: { id: b.id } }), deps);
  assert.equal(g.code, 200, JSON.stringify(g.body));
  assert.deepEqual(g.body.icp, { key: 'media', label: 'Looks like media', points: -30, looks_like: 'podcast' });
  const mv = await call(patchBrandRoute, reqOf({ method: 'PATCH', params: { id: b.id }, body: { segment: 'podcast' } }), deps);
  assert.deepEqual([mv.code, mv.body.brand.segment, mv.body.changed], [200, 'podcast', ['segment']]);
  const ev = sb.db.hk_events.at(-1);
  assert.deepEqual([ev.action, ev.detail.prev], ['brand.segment', { segment: 'sponsor_brand' }]);
  const undo = await call(patchBrandRoute, reqOf({ method: 'PATCH', params: { id: b.id }, body: { segment: 'sponsor_brand' } }), deps);
  assert.deepEqual([undo.code, sb.db.hk_brands[0].segment], [200, 'sponsor_brand']);
  assert.equal((await call(patchBrandRoute, reqOf({ method: 'PATCH', params: { id: b.id }, body: { segment: 'tv' } }), deps)).code, 400);
});

test('I3 Settings: ICP weights validated (whole numbers -100..100), merged into intel; GET /settings returns weights + the word list', async () => {
  assert.deepEqual(intelPatch({ icp: { retail: 50 } }, { pitch_goal: 3 }), { pitch_goal: 3, icp: { retail: 50 } });
  assert.throws(() => intelPatch({ icp: { media: -101 } }, {}), /from -100 to 100/);
  assert.throws(() => intelPatch({ icp: { retail: 1.5 } }, {}), /whole number/);
  const sb = seed({ hk_settings: [{ business_id: HK, intel: { icp: { retail: 55 } } }] });
  const r = await call(getSettingsRoute, reqOf(), { supabase: sb });
  assert.deepEqual([r.body.icp.weights, r.body.icp.words.slice(0, 3)], [{ retail: 55, media: -30, unknown: 20 }, ['media', 'podcast', 'press']]);
});

test('reachOf eligibility is unchanged by the ICP (can_contact, owner, sheet owner, snooze, discussing still exclude)', () => {
  const pod = brand('Zz Pod Owned', { segment: 'podcast', owner_user_id: 'u-other' }), snoozed = brand('Zz Snoozed', { snoozed_until: '2027-01-01T00:00:00Z' }), talk = brand('Zz Talking');
  const ctx = { ...ctxFor([pod, snoozed, talk]), discussing: new Set([talk.id]) };
  assert.deepEqual([reachOf(pod, ctx), reachOf(snoozed, ctx), reachOf(talk, ctx)], [null, null, null]);
});
