// node --test api/hk/signals.test.mjs
// grow-signals-v1 Stage 2 - signal writers, heat, the Signals routes and + Target / + Pipeline on the in-memory Supabase.
// Invented brands and people; 0 network, 0 Claude, 0 Gmail, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fakeSupabase } from '../sales/testing/fakeSupabase.mjs';
import * as S from './signals.js';
import { listSignalsRoute, seenSignalsRoute, dismissSignalRoute, targetRoute, pipelineRoute, pipelineRefusal } from './signalsRoutes.js';
import { patchBrandRoute, createBrand, listBrandsRoute } from './brandsRoutes.js';

const HK = 'biz-hk', JACK = 'u-jack', PETE = 'u-pete';
const NOW = new Date('2026-10-29T15:00:00Z');
const B = { run: randomUUID(), yoga: randomUUID(), juice: randomUUID(), fp: randomUUID(), cafe: randomUUID(), unclear: randomUUID(), mine: randomUUID() };
const brand = (id, name, over = {}) => ({ id, business_id: HK, name, normalized_name: name.toLowerCase(), aliases: [], segment: 'sponsor_brand', status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_unclear: false, source: 'user_supplied', heat: 0, heat_band: 'cold', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', archived_at: null, ...over });
const fresh = (extra = {}) => fakeSupabase({
  hk_brands: [
    brand(B.run, 'Bluefin Run Club', { domain: 'bluefinrun.invalid' }),
    brand(B.yoga, 'Harbor Yoga', { owner_user_id: PETE, status: 'claimed' }),
    brand(B.juice, 'Northwind Juice', { relationship: 'sponsor', status: 'sponsor' }),
    brand(B.fp, 'Lakeshore Partners', { relationship: 'founding_partner', status: 'sponsor' }),
    brand(B.cafe, 'Copperleaf Cafe', { relationship: 'do_not_contact', dnc_reason: 'asked us to stop' }),
    brand(B.unclear, 'Prairie Climb', { owner_unclear: true }),
    brand(B.mine, 'Ember Coffee', { owner_user_id: JACK, status: 'sent' }),
  ],
  hk_signals: [], hk_events: [], hk_touches: [], hk_replies: [], hk_contacts: [], hk_sponsor_periods: [], hk_settings: [], hk_member_prefs: [],
  business_members: [{ business_id: HK, user_id: JACK, name: 'Jack Example', role: 'owner' }, { business_id: HK, user_id: PETE, name: 'Pete Example', role: 'member' }],
  accounts: [], projects: [], prospects: [], ...extra,
}, { now: () => NOW.getTime(), unique: { hk_signals: r => `${r.business_id}:${r.kind}:${r.ref_type}:${r.ref_id}`, hk_brands: r => (r.archived_at ? null : `${r.business_id}:${r.normalized_name}`) } });
const reqOf = ({ method = 'POST', params = {}, query = {}, body = {}, user = JACK, role = 'member' } = {}) => ({ method, params: { businessId: HK, ...params }, query, body, auth: { user: { id: user, name: 'T' }, isPlatformOwner: false, roles: new Map([[HK, role]]) } });
const call = async (route, req, deps) => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; await route(req, r, deps); return r; };
const deps = sb => ({ supabase: sb, now: () => NOW });
const sig = (kind, brandId, over = {}) => ({ businessId: HK, kind, brandId, occurredAt: NOW.toISOString(), source: 'user', refType: 'test', refId: `${kind}:${brandId}`, ...over });
const brandRow = (sb, id) => sb.db.hk_brands.find(b => b.id === id);

test('points, bands and decay: a 7-day-old signal counts half; bands Hot 40 / Warm 20 / Cool 5; floored at 0', () => {
  const b = brand(B.run, 'x');
  assert.equal(S.heatOf(b, [{ kind: 'reply_interest', points: 40, occurred_at: NOW.toISOString() }], NOW), 40);
  assert.equal(S.heatOf(b, [{ kind: 'reply_interest', points: 40, occurred_at: new Date(NOW - 7 * 864e5).toISOString() }], NOW), 20);
  assert.equal(S.heatOf(b, [{ kind: 'reply_interest', points: 40, occurred_at: new Date(NOW - 14 * 864e5).toISOString() }], NOW), 10);
  assert.equal(S.heatOf(b, [{ kind: 'reply_decline', points: -30, occurred_at: NOW.toISOString() }, { kind: 'reply_other', points: 15, occurred_at: NOW.toISOString() }], NOW), 0);
  assert.deepEqual([40, 39, 20, 19, 5, 4, 0].map(S.bandOf), ['hot', 'warm', 'warm', 'cool', 'cool', 'cold', 'cold']);
  assert.equal(S.heatOf(b, [{ kind: 'reply_interest', points: 40, occurred_at: NOW.toISOString(), dismissed_at: NOW.toISOString() }], NOW), 0, 'dismissed counts 0');
});

test('heat counts prospect brands only; sponsor-kind signals add 0 even on a prospect', () => {
  const s = [{ kind: 'reply_interest', points: 40, occurred_at: NOW.toISOString() }];
  assert.equal(S.heatOf(brand(B.juice, 'x', { relationship: 'sponsor' }), s, NOW), 0);
  assert.equal(S.heatOf(brand(B.cafe, 'x', { relationship: 'do_not_contact' }), s, NOW), 0);
  assert.equal(S.heatOf(brand(B.run, 'x'), [{ kind: 'sponsor_lapsed', points: 15, occurred_at: NOW.toISOString() }], NOW), 0);
});

test('auto-replies write no signal; an unlabeled reply is reply_other; labels map to their kinds', () => {
  assert.deepEqual(['interested', 'pricing', 'referral', 'decline', 'auto_reply', 'prefers_email', 'new_thread', 'other', null].map(S.replyKind), ['reply_interest', 'reply_pricing', 'reply_referral', 'reply_decline', null, 'reply_other', 'reply_other', 'reply_other', 'reply_other']);
  const out = S.signalsFromRows({ businessId: HK, brands: [brand(B.run, 'Bluefin Run Club')], replies: [{ id: 'r1', brand_id: B.run, label: 'auto_reply', received_at: NOW.toISOString() }, { id: 'r2', brand_id: B.run, label: 'pricing', received_at: NOW.toISOString() }], now: NOW });
  assert.deepEqual(out.map(s => [s.kind, s.refId]), [['reply_pricing', 'r2']]);
});

test('each signal is written once per ref: a re-run (live writer or backfill) writes nothing new', async () => {
  const sb = fresh();
  const set = [sig('reply_interest', B.run), sig('waiting_overdue', B.mine), sig('research_possible', null, { domain: 'newco.invalid', refType: 'domain_intel', refId: 'newco.invalid:0' })];
  assert.deepEqual(await S.writeAll(sb, set), { written: 3, skipped: 0, perKind: { reply_interest: 1, waiting_overdue: 1, research_possible: 1 } });
  assert.deepEqual(await S.writeAll(sb, set), { written: 0, skipped: 3, perKind: {} });
  assert.equal(sb.db.hk_signals.length, 3);
  await assert.rejects(S.writeSignal(sb, sig('not_a_kind', B.run)), /unknown signal kind/);
  await S.writeSignal(sb, sig('reply_other', B.run, { refId: 'pii', detail: 'call 312-555-0100 or ana@x.invalid' }));
  assert.equal(sb.db.hk_signals.at(-1).detail, null, 'an address / phone never lands in detail');
});

test('daily signals: overdue wait (once), sponsor lapsed per month, renewal dormant without deal_end and live with it; heat recomputed', async () => {
  const sb = fresh({ hk_sponsor_periods: [{ business_id: HK, brand_id: B.fp, period: '2026-10', kind: 'monthly' }] });
  const touches = [{ id: 't1', business_id: HK, brand_id: B.mine, channel: 'email', state: 'sent', sent_at: '2026-10-20T00:00:00Z' }];
  const r1 = await S.dailySignals(sb, { businessId: HK, brands: sb.db.hk_brands, touches, replies: [], followups: [], now: NOW });
  assert.deepEqual(r1.perKind, { waiting_overdue: 1, sponsor_lapsed: 1 }, 'Northwind lapsed; Lakeshore has October');
  assert.equal((await S.dailySignals(sb, { businessId: HK, brands: sb.db.hk_brands, touches, replies: [], followups: [], now: NOW })).written, 0);
  assert.equal(brandRow(sb, B.mine).heat_band, 'cool');
  assert.equal(brandRow(sb, B.juice).heat, 0, 'sponsor signal adds 0');
  const withDeal = sb.db.hk_brands.map(b => (b.id === B.juice ? { ...b, deal_end: '2026-11-15' } : b));
  const r3 = await S.dailySignals(sb, { businessId: HK, brands: withDeal, touches, replies: [], followups: [], now: NOW });
  assert.deepEqual(r3.perKind, { sponsor_renewal_due: 1 });
  const answered = S.signalsFromRows({ businessId: HK, brands: sb.db.hk_brands, touches, replies: [{ id: 'r', brand_id: B.mine, label: 'interested', received_at: '2026-10-22T00:00:00Z' }], now: NOW });
  assert.ok(!answered.some(s => s.kind === 'waiting_overdue'), 'a reply after the send ends the wait');
});

test('new_person_sender and sender_is_candidate are not written in v1 (viewing the inbox list writes nothing)', async () => {
  const sb = fresh();
  for (const kind of ['new_person_sender', 'sender_is_candidate']) {
    assert.equal(S.POINTS[kind], undefined);
    await assert.rejects(S.writeSignal(sb, sig(kind, B.run, { domain: 'newco.invalid', refType: 'domain', refId: 'newco.invalid' })), /unknown signal kind/);
  }
  assert.equal(S.inboxListSignals, undefined, 'no inbox-list writer exists');
  assert.equal(sb.db.hk_signals.length, 0);
});

test('domain -> brand: tracking a sender as a brand moves its domain signals onto it and heats it', async () => {
  const sb = fresh();
  await S.writeSignal(sb, sig('research_possible', null, { domain: 'newco.invalid', refType: 'domain_intel', refId: 'newco.invalid:0' }));
  await S.writeSignal(sb, sig('research_strong_fit', null, { domain: 'newco.invalid', refType: 'domain_intel', refId: 'newco.invalid:1' }));
  const { data } = await createBrand(sb, { businessId: HK, userId: JACK, body: { name: 'Newco Fitness', domain: 'newco.invalid' }, now: () => NOW });
  assert.ok(sb.db.hk_signals.every(s => s.brand_id === data.id));
  // The in-memory DB applies no column defaults; Postgres gives a new brand relationship 'prospect'.
  brandRow(sb, data.id).relationship = 'prospect';
  await S.recomputeHeat(sb, HK, { brandIds: [data.id], now: NOW });
  assert.deepEqual([brandRow(sb, data.id).heat, brandRow(sb, data.id).heat_band], [28, 'warm']);
});

test('meeting status writes meeting_set through the status writer', async () => {
  const sb = fresh();
  const r = await call(patchBrandRoute, reqOf({ method: 'PATCH', params: { id: B.mine }, body: { status: 'meeting' } }), deps(sb));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(sb.db.hk_signals.map(s => [s.kind, s.brand_id, s.points]), [['meeting_set', B.mine, 30]]);
  assert.equal(brandRow(sb, B.mine).heat_band, 'warm');
});

test('Signals routes: prospects vs Sponsors heading, seen, dismiss removes points (undo puts them back), logged', async () => {
  const sb = fresh();
  await S.writeAll(sb, [sig('reply_interest', B.run), sig('sponsor_lapsed', B.juice)]);
  await S.recomputeHeat(sb, HK, { now: NOW });
  const l = await call(listSignalsRoute, reqOf({ method: 'GET' }), deps(sb));
  assert.deepEqual([l.body.prospects.map(s => s.kind), l.body.sponsors.map(s => [s.kind, s.points]), l.body.unseen_hot_warm], [['reply_interest'], [['sponsor_lapsed', 0]], 1]);
  const id = l.body.prospects[0].id;
  assert.equal((await call(seenSignalsRoute, reqOf({ body: { ids: [id] } }), deps(sb))).body.seen, 1);
  assert.equal((await call(seenSignalsRoute, reqOf({ body: { ids: ['nope'] } }), deps(sb))).code, 400);
  assert.equal(brandRow(sb, B.run).heat_band, 'hot');
  await call(dismissSignalRoute, reqOf({ params: { id } }), deps(sb));
  assert.deepEqual([brandRow(sb, B.run).heat, brandRow(sb, B.run).heat_band], [0, 'cold']);
  assert.equal((await call(listSignalsRoute, reqOf({ method: 'GET' }), deps(sb))).body.prospects.length, 0);
  await call(dismissSignalRoute, reqOf({ params: { id }, body: { undo: true } }), deps(sb));
  assert.equal(brandRow(sb, B.run).heat_band, 'hot');
  assert.deepEqual(sb.db.hk_events.map(e => e.action), ['signal.dismissed', 'signal.restored']);
  assert.equal(sb.db.hk_signals.length, 2, 'nothing deleted');
});

test('+ Target: targeted_at/by + a targeted_by_user signal (+10, Cool); Undo clears it and dismisses that signal', async () => {
  const sb = fresh();
  const on = await call(targetRoute, reqOf({ params: { id: B.run }, body: { on: true } }), deps(sb));
  assert.equal(on.code, 200, JSON.stringify(on.body));
  assert.deepEqual([brandRow(sb, B.run).targeted_by, brandRow(sb, B.run).heat, brandRow(sb, B.run).heat_band, brandRow(sb, B.run).status], [JACK, 10, 'cool', 'candidate']);
  assert.equal((await call(targetRoute, reqOf({ params: { id: B.run }, body: { on: true } }), deps(sb))).body.already, true);
  await call(targetRoute, reqOf({ params: { id: B.run }, body: { on: false } }), deps(sb));
  assert.deepEqual([brandRow(sb, B.run).targeted_at, brandRow(sb, B.run).heat, sb.db.hk_signals.every(s => s.dismissed_at)], [null, 0, true]);
  assert.deepEqual(sb.db.hk_events.map(e => e.action), ['brand.targeted', 'brand.untargeted']);
  assert.equal((await call(targetRoute, reqOf({ params: { id: B.run }, body: {} }), deps(sb))).code, 400);
});

test('+ Pipeline refuses sponsor, founding partner, do-not-contact, the other founder\'s and Unclear brands; claims a candidate; Undo only while unchanged', async () => {
  const sb = fresh();
  for (const [id, why] of [[B.juice, /a sponsor/], [B.fp, /founding partner/], [B.cafe, /do not contact/], [B.yoga, /owned by Pete/], [B.unclear, /Unclear/]]) {
    const r = await call(pipelineRoute, reqOf({ params: { id } }), deps(sb));
    assert.equal(r.code, 409, id); assert.match(r.body.error, why);
  }
  const owner = await call(pipelineRoute, reqOf({ params: { id: B.yoga }, role: 'owner' }), deps(sb));
  assert.equal(owner.code, 409, 'an owner-role member still cannot take the other founder\'s brand');
  const ok = await call(pipelineRoute, reqOf({ params: { id: B.run } }), deps(sb));
  assert.deepEqual([ok.code, ok.body.brand.owner_user_id, ok.body.brand.status], [200, JACK, 'claimed']);
  const stale = await call(pipelineRoute, reqOf({ params: { id: B.run }, body: { undo: true, expect_updated_at: '2020-01-01T00:00:00Z' } }), deps(sb));
  assert.equal(stale.code, 409);
  const undo = await call(pipelineRoute, reqOf({ params: { id: B.run }, body: { undo: true, expect_updated_at: ok.body.brand.updated_at } }), deps(sb));
  assert.deepEqual([undo.code, brandRow(sb, B.run).owner_user_id, brandRow(sb, B.run).status], [200, null, 'candidate']);
  assert.deepEqual(sb.db.hk_events.map(e => e.action), ['brand.claimed', 'brand.released']);
  assert.equal(pipelineRefusal(brand(B.run, 'X', { status: 'passed' }), JACK), 'X was passed on');
});

test('Brands views: Hot leads = Hot + Warm, newest signal first; Targets = targeted brands, hottest first; rows carry heat', async () => {
  const sb = fresh();
  Object.assign(brandRow(sb, B.run), { heat: 45, heat_band: 'hot' });
  Object.assign(brandRow(sb, B.mine), { heat: 22, heat_band: 'warm', targeted_at: '2026-10-28T00:00:00Z', targeted_by: JACK });
  Object.assign(brandRow(sb, B.unclear), { heat: 6, heat_band: 'cool', targeted_at: '2026-10-29T00:00:00Z', targeted_by: JACK });
  await S.writeSignal(sb, sig('reply_interest', B.run, { occurredAt: '2026-10-27T00:00:00Z' }));
  await S.writeSignal(sb, sig('reply_pricing', B.mine, { occurredAt: '2026-10-29T00:00:00Z' }));
  const hot = await call(listBrandsRoute, reqOf({ method: 'GET', query: { view: 'hot' } }), deps(sb));
  assert.equal(hot.code, 200, JSON.stringify(hot.body));
  assert.deepEqual(hot.body.brands.map(b => [b.name, b.heat_band, b.last_signal_at.slice(0, 10)]), [['Ember Coffee', 'warm', '2026-10-29'], ['Bluefin Run Club', 'hot', '2026-10-27']]);
  const targets = await call(listBrandsRoute, reqOf({ method: 'GET', query: { view: 'targets' } }), deps(sb));
  assert.deepEqual(targets.body.brands.map(b => [b.name, b.heat, b.targeted_by]), [['Ember Coffee', 22, JACK], ['Prairie Climb', 6, JACK]]);
});
