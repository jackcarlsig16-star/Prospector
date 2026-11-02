// grow-sponsor-deals-v1 Stage 2 - synthetic (invented names, the in-memory Supabase): month states, the relationship fix
// and every reader of relationship 'sponsor', money, month writes + Undo + archive, thread suggestions, the Inbox status
// line, the Instagram handle, the sheet re-import (fills, the December shift, upsert + never delete). 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { seed, reqOf, call, HK, JACK, PETE, ID, NOW } from './testing.mjs';
import { dealStageOf, relationshipFor, relationshipPatch, moneyByMonth, threadSuggestions, applyThreadFacts, statusLine, reachedByBrand, addMonths, chicagoMonth, detailPii } from './deals.js';
import { moneyRoute, addPeriodRoute, patchPeriodRoute, deletePeriodRoute, restorePeriodRoute, copyNextRoute } from './dealRoutes.js';
import { canContact } from './rules.js';
import { SPONSOR_RELATIONSHIPS, sponsorsNichesOf } from './hkShared.js';
import { valuesOf, applyFilters, parseFilters } from './brandFilters.js';
import { signalsFromRows } from './signals.js';
import { importanceOf, intelSettings, reachOf } from './intelScore.js';
import { pipelineRefusal } from './signalsRoutes.js';
import { sponsorsRoute } from './opsRoutes.js';
import { patchBrandRoute, getBrandRoute, handleOf } from './brandsRoutes.js';
import { chipFor } from './inboxRules.js';
import { parseSponsorTabs, planReimport, fillOf, changeWords } from './sponsorSheet.js';

const M = '2026-10'; // NOW = 2026-10-26 (Chicago)
const per = (brand_id, period, state = 'confirmed', over = {}) => ({ id: randomUUID(), business_id: HK, brand_id, period, kind: period === 'launch' ? 'launch' : 'monthly', state, amount_usd: null, paid: false, source: 'sheet', archived_at: null, ...over });
const brandRow = (id, name, over = {}) => ({ id, business_id: HK, name, normalized_name: name.toLowerCase(), aliases: [], segment: 'sponsor_brand', is_local: false, status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_hint: null, owner_unclear: false, archived_at: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...over });
const deps = sb => ({ supabase: sb, now: () => NOW });

test('S2 deal stage: prospect / discussing / sponsor / past / founding partner / declined', () => {
  const b = { relationship: 'sponsor' };
  assert.equal(dealStageOf({ relationship: 'prospect' }, [], M), 'prospect');
  assert.equal(dealStageOf(b, [per('x', '2026-11', 'discussing')], M), 'discussing');
  assert.equal(dealStageOf(b, [per('x', M), per('x', '2026-11', 'discussing')], M), 'sponsor', 'a sponsor talking renewal is still a sponsor');
  assert.equal(dealStageOf(b, [per('x', '2026-11')], M), 'sponsor');
  assert.equal(dealStageOf(b, [per('x', '2026-06'), per('x', '2026-07')], M), 'past_sponsor');
  assert.equal(dealStageOf({ relationship: 'founding_partner' }, [per('x', '2026-06')], M), 'founding_partner');
  assert.equal(dealStageOf(b, [per('x', '2026-06'), per('x', '2026-09', 'declined')], M), 'declined');
  assert.equal(dealStageOf(b, [per('x', '2026-08', 'discussing')], M), 'prospect', 'old discussing months nobody closed');
  assert.equal(addMonths('2026-12', 1), '2027-01'); assert.equal(addMonths('2027-01', -3), '2026-10');
  assert.equal(chicagoMonth(new Date('2026-11-01T03:00:00Z')), '2026-10', 'Chicago time, not UTC');
});

test('S2 relationship fix: sponsor only with a confirmed monthly month; discussing-only -> prospect; hand-set and founding partner / DNC unchanged', () => {
  assert.equal(relationshipFor({ relationship: 'sponsor' }, [per('x', M, 'discussing')]), 'prospect');
  assert.equal(relationshipFor({ relationship: 'sponsor' }, [per('x', '2026-06'), per('x', M, 'discussing')]), 'sponsor');
  assert.equal(relationshipFor({ relationship: 'prospect' }, [per('x', M)]), 'sponsor');
  assert.equal(relationshipFor({ relationship: 'sponsor' }, []), 'sponsor', 'marked by an owner, no months');
  assert.equal(relationshipFor({ relationship: 'founding_partner' }, [per('x', M, 'discussing')]), 'founding_partner');
  assert.equal(relationshipFor({ relationship: 'do_not_contact' }, [per('x', M)]), 'do_not_contact');
  assert.deepEqual(relationshipPatch({ relationship: 'sponsor', status: 'sponsor' }, [per('x', M, 'discussing')]), { relationship: 'prospect', status: 'replied' });
  assert.deepEqual(relationshipPatch({ relationship: 'prospect', status: 'candidate' }, [per('x', M)]), { relationship: 'sponsor', status: 'sponsor' });
  assert.equal(relationshipPatch({ relationship: 'sponsor', status: 'sponsor' }, [per('x', M)]), null);
});

test('every reader of relationship sponsor, after the fix: a discussing-only brand reads as a prospect, a confirmed one as a sponsor', async () => {
  const talk = brandRow(randomUUID(), 'Zz Talk Co', { domain: 'talk.example', niche: 'granola' }), spon = brandRow(randomUUID(), 'Zz Spon Co', { domain: 'spon.example', niche: 'juice' });
  const tp = [per(talk.id, M, 'discussing')], sp = [per(spon.id, '2026-09')];
  for (const [b, ps] of [[talk, tp], [spon, sp]]) Object.assign(b, relationshipPatch({ ...b, relationship: 'sponsor', status: 'sponsor' }, ps) || { relationship: 'sponsor', status: 'sponsor' });
  assert.deepEqual([talk.relationship, talk.status, spon.relationship], ['prospect', 'replied', 'sponsor']);
  // rules.js BLOCKING_RELATIONSHIPS (can_contact)
  assert.equal(canContact({ brand: talk, senderUserId: JACK, kind: 'bump' }).ok, true);
  assert.equal(canContact({ brand: spon, senderUserId: JACK, kind: 'bump' }).reason, 'sponsor');
  // hkShared SPONSOR_RELATIONSHIPS / sponsorsNichesOf
  assert.deepEqual([SPONSOR_RELATIONSHIPS.has(talk.relationship), sponsorsNichesOf([talk, spon]).map(s => s.name)], [false, ['Zz Spon Co']]);
  // brandFilters SPONSORS (the Sponsors view) + the Deal group
  const data = { brands: [talk, spon], touches: {}, replies: {}, hasEmail: new Set(), intel: new Set(), months: new Set([talk.id, spon.id]), periodsBy: { [talk.id]: tp, [spon.id]: sp }, threads: {} };
  const vt = valuesOf(talk, data, { meId: JACK, now: NOW }), vs = valuesOf(spon, data, { meId: JACK, now: NOW });
  assert.deepEqual([vt.view.includes('sponsors'), vs.view.includes('sponsors'), vt.deal_stage[0], vs.deal_stage[0]], [false, true, 'discussing', 'past_sponsor']);
  // signals.js sponsor_lapsed: only sponsors, only a confirmed month counts as covering this month
  const lapsed = ps => signalsFromRows({ businessId: HK, brands: [talk, spon], periods: ps, now: NOW }).filter(s => s.kind === 'sponsor_lapsed').map(s => s.brandId);
  assert.deepEqual(lapsed([...tp, ...sp]), [spon.id]);
  assert.deepEqual(lapsed([...tp, ...sp, per(spon.id, M, 'discussing')]), [spon.id], 'a discussing month is not this month covered');
  assert.deepEqual(lapsed([...tp, ...sp, per(spon.id, M)]), []);
  // intelScore B2 sponsor points
  const ctx = { settings: intelSettings(), byId: { [talk.id]: talk, [spon.id]: spon }, warmBrands: new Set(), now: NOW };
  const parts = id => importanceOf({ chip: { kind: 'tracked', brand_id: id }, date: NOW.toISOString(), snippet: '' }, ctx).parts;
  assert.deepEqual([parts(talk.id).includes('sponsor'), parts(spon.id).includes('sponsor')], [false, true]);
  // signalsRoutes pipelineRefusal
  assert.equal(pipelineRefusal(talk, JACK), null);
  assert.match(pipelineRefusal(spon, JACK), /is a sponsor - not for the Pipeline/);
  // B3 Send these 10 never lists a brand with a month in discussion
  const fresh = { ...talk, status: 'candidate' };
  const rctx = { meId: JACK, settings: intelSettings(), touchesBy: {}, repliesBy: {}, contactsBy: {}, intelByDomain: {}, sponsorsNiches: [], now: NOW, meFirstName: 'Jack' };
  assert.ok(reachOf(fresh, rctx));
  assert.equal(reachOf(fresh, { ...rctx, discussing: new Set([talk.id]) }), null);
});

test('brandsRoutes relationship PATCH and the Sponsors screen after the fix; archived months hidden; Brand page carries the deal', async () => {
  const T = randomUUID();
  const sb = seed({ hk_brands: [brandRow(T, 'Zz Talk Co', { relationship: 'prospect', status: 'replied' }), brandRow(ID.juice, 'Northwind Juice', { relationship: 'sponsor', status: 'sponsor' })],
    hk_sponsor_periods: [per(T, M, 'discussing'), per(ID.juice, '2026-09'), per(ID.juice, '2026-08', 'confirmed', { archived_at: '2026-10-20T00:00:00Z' })], hk_brand_threads: [] });
  const s = await call(sponsorsRoute, reqOf(), deps(sb));
  assert.deepEqual(s.body.sponsors.map(b => [b.name, b.periods.map(p => `${p.period}:${p.state}`)]), [['Northwind Juice', ['2026-09:confirmed']]]);
  const p = await call(patchBrandRoute, reqOf({ method: 'PATCH', params: { id: T }, body: { relationship: 'sponsor' }, role: 'owner' }), deps(sb));
  assert.deepEqual([p.code, p.body.brand.relationship, p.body.brand.status], [200, 'sponsor', 'sponsor'], 'an owner can still mark a sponsor by hand');
  const g = await call(getBrandRoute, reqOf({ params: { id: ID.juice } }), deps(sb));
  assert.equal(g.code, 200, JSON.stringify(g.body));
  assert.deepEqual([g.body.sponsor_periods.length, g.body.deal.stage, g.body.deal.months.map(m => m.period)], [1, 'past_sponsor', ['2026-09']]);
});

test('S4 money: confirmed / paid / unpaid / discussing per month; no amounts = null dollars; the money route reads live brands + months only', async () => {
  const a = randomUUID(), b = randomUUID(), c = randomUUID();
  const ps = [per(a, '2026-11', 'confirmed', { amount_usd: 150, paid: true }), per(b, '2026-11', 'confirmed', { amount_usd: '150.00' }), per(c, '2026-11', 'discussing', { amount_usd: 150, paid: true }), per(a, '2026-12', 'declined'), per(b, '2026-10')];
  const m = moneyByMonth(ps, ['2026-10', '2026-11', '2026-12']);
  assert.deepEqual(m.months[1], { month: '2026-11', confirmed_usd: 300, paid_usd: 150, unpaid_usd: 150, discussing_usd: 150, confirmed: 2, discussing: 1, declined: 0, paid: 1, without_amount: 0 });
  assert.deepEqual([m.months[0].confirmed_usd, m.months[0].confirmed, m.months[2].declined], [null, 1, 1]);
  assert.deepEqual(m.totals, { confirmed_usd: 300, paid_usd: 150, unpaid_usd: 150, discussing_usd: 150, if_all_close_usd: 450 });
  const sb = seed({ hk_sponsor_periods: [per(ID.juice, M, 'confirmed', { amount_usd: 200 }), per(ID.old, M, 'confirmed', { amount_usd: 999 }), per(ID.juice, '2026-09', 'confirmed', { amount_usd: 50, archived_at: NOW.toISOString() })] });
  const r = await call(moneyRoute, reqOf({ role: 'viewer' }), deps(sb));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.this_month, r.body.months.map(x => x.month)[0], r.body.months.length, r.body.default_monthly_usd], [M, '2026-07', 7, 150]);
  assert.deepEqual(r.body.months.find(x => x.month === M).confirmed_usd, 200, 'archived brand + archived month left out');
  assert.equal(r.body.months.find(x => x.month === '2026-09').confirmed_usd, null);
  assert.equal((await call(moneyRoute, reqOf({ query: { from: '2026-12', to: '2026-11' } }), deps(sb))).code, 400);
});

test('S6 month writes: add (Settings default amount) moves the relationship; edit + Undo with expect; remove archives + Undo restores; copy to next month; never a delete', async () => {
  const T = randomUUID();
  const sb = seed({ hk_brands: [brandRow(T, 'Zz Talk Co', { relationship: 'prospect', status: 'replied' }), brandRow(ID.cafe, 'Copperleaf Cafe', { relationship: 'do_not_contact' })], hk_brand_threads: [] });
  const add = await call(addPeriodRoute, reqOf({ method: 'POST', params: { brandId: T }, body: { period: '2026-11', state: 'discussing' } }), deps(sb));
  assert.equal(add.code, 201, JSON.stringify(add.body));
  assert.deepEqual([add.body.period.state, add.body.period.amount_usd, add.body.period.source, add.body.relationship], ['discussing', 150, 'user', null]);
  assert.equal((await call(addPeriodRoute, reqOf({ method: 'POST', params: { brandId: T }, body: { period: '2026-11' } }), deps(sb))).code, 409);
  assert.equal((await call(addPeriodRoute, reqOf({ method: 'POST', params: { brandId: ID.cafe }, body: { period: '2026-11' } }), deps(sb))).code, 400, 'do not contact');
  const pid = add.body.period.id;
  const ch = await call(patchPeriodRoute, reqOf({ method: 'PATCH', params: { brandId: T, pid }, body: { state: 'confirmed', paid: true, details: { 'Challenge Name': 'Granola Week', Schedule: '11/01/2026 - 11/30/2026' } } }), deps(sb));
  assert.equal(ch.code, 200, JSON.stringify(ch.body));
  assert.deepEqual([ch.body.changed, ch.body.prev.state, ch.body.prev.paid, ch.body.relationship], [['state', 'paid', 'details'], 'discussing', false, { relationship: 'sponsor', status: 'sponsor' }]);
  assert.ok(sb.db.hk_sponsor_periods[0].paid_at && sb.db.hk_sponsor_periods[0].state_changed_by === JACK);
  assert.equal(sb.db.hk_brands.find(b => b.id === T).relationship, 'sponsor');
  const undo = await call(patchPeriodRoute, reqOf({ method: 'PATCH', params: { brandId: T, pid }, body: { ...ch.body.prev, expect: { state: 'confirmed', paid: true } } }), deps(sb));
  assert.deepEqual([undo.code, undo.body.period.state, undo.body.period.paid, undo.body.period.paid_at, sb.db.hk_brands.find(b => b.id === T).relationship], [200, 'discussing', false, null, 'prospect']);
  assert.equal((await call(patchPeriodRoute, reqOf({ method: 'PATCH', params: { brandId: T, pid }, body: { state: 'confirmed', expect: { state: 'confirmed' } } }), deps(sb))).code, 409, 'Undo refuses once it changed since');
  assert.equal((await call(patchPeriodRoute, reqOf({ method: 'PATCH', params: { brandId: T, pid }, body: { details: { Contact: 'ana@x.example' } } }), deps(sb))).code, 400);
  assert.equal((await call(patchPeriodRoute, reqOf({ method: 'PATCH', params: { brandId: T, pid }, body: { amount_usd: -5 } }), deps(sb))).code, 400);
  // remove = archive (owner role), Undo = restore
  assert.equal((await call(deletePeriodRoute, reqOf({ method: 'DELETE', params: { brandId: T, pid } }), deps(sb))).code, 403);
  const del = await call(deletePeriodRoute, reqOf({ method: 'DELETE', params: { brandId: T, pid }, role: 'owner' }), deps(sb));
  assert.deepEqual([del.code, del.body.undo, sb.db.hk_sponsor_periods.length, !!sb.db.hk_sponsor_periods[0].archived_at, sb.db.hk_sponsor_periods[0].archived_by], [200, { restore: pid }, 1, true, JACK]);
  assert.equal((await call(patchPeriodRoute, reqOf({ method: 'PATCH', params: { brandId: T, pid }, body: { state: 'confirmed' } }), deps(sb))).code, 409);
  const res = await call(restorePeriodRoute, reqOf({ method: 'POST', params: { brandId: T, pid }, role: 'owner' }), deps(sb));
  assert.deepEqual([res.code, sb.db.hk_sponsor_periods[0].archived_at], [200, null]);
  assert.equal((await call(restorePeriodRoute, reqOf({ method: 'POST', params: { brandId: T, pid }, role: 'owner' }), deps(sb))).code, 409);
  // add over an archived month brings that row back
  await call(deletePeriodRoute, reqOf({ method: 'DELETE', params: { brandId: T, pid }, role: 'owner' }), deps(sb));
  const again = await call(addPeriodRoute, reqOf({ method: 'POST', params: { brandId: T }, body: { period: '2026-11', amount_usd: null } }), deps(sb));
  assert.deepEqual([again.code, again.body.period.id, again.body.period.state, again.body.period.amount_usd, sb.db.hk_sponsor_periods.length], [201, pid, 'confirmed', null, 1]);
  // copy to next month: confirmed only, creates December in discussion
  const cp = await call(copyNextRoute, reqOf({ method: 'POST', params: { brandId: T, pid } }), deps(sb));
  assert.deepEqual([cp.code, cp.body.period.period, cp.body.period.state, cp.body.undo.archive === cp.body.period.id], [201, '2026-12', 'discussing', true]);
  assert.equal((await call(copyNextRoute, reqOf({ method: 'POST', params: { brandId: T, pid: cp.body.period.id } }), deps(sb))).code, 400);
  const acts = sb.db.hk_events.filter(e => e.entity_id === T).map(e => e.action);
  assert.deepEqual(acts, ['sponsor.period_added', 'sponsor.period_changed', 'brand.relationship', 'sponsor.period_undone', 'brand.relationship', 'sponsor.period_removed', 'sponsor.period_restored', 'sponsor.period_removed', 'sponsor.period_added', 'brand.relationship', 'sponsor.period_added']);
  assert.ok(sb.db.hk_events.every(e => !JSON.stringify(e.detail).includes('Granola Week')), 'Activity keeps detail labels, never their text');
  // an Undo on a sheet row makes it a sheet row again (a re-import may correct it later)
  const sh = per(T, '2027-02', 'confirmed', { source: 'sheet' }); sb.db.hk_sponsor_periods.push(sh);
  const e1 = await call(patchPeriodRoute, reqOf({ method: 'PATCH', params: { brandId: T, pid: sh.id }, body: { amount_usd: 200 } }), deps(sb));
  assert.deepEqual([e1.body.period.source, e1.body.prev], ['user', { amount_usd: null, source: 'sheet' }]);
  const e2 = await call(patchPeriodRoute, reqOf({ method: 'PATCH', params: { brandId: T, pid: sh.id }, body: { ...e1.body.prev, expect: { amount_usd: 200 } } }), deps(sb));
  assert.deepEqual([e2.body.period.source, e2.body.period.amount_usd], ['sheet', null]);
});

test('ruling 3: thread facts create a missing month (In discussion, email) and fill only an email row; confirm / amount / disagreement are suggestions; sheet rows and archived months untouched', async () => {
  const th = (month, stage, over = {}) => ({ id: randomUUID(), member_user_id: JACK, deal_month: month, deal_stage: stage, deal_amount_usd: null, last_at: '2026-10-20T00:00:00Z', ...over });
  const s = threadSuggestions([per('b', '2026-11', 'discussing', { source: 'sheet' }), per('b', '2026-09', 'confirmed', { amount_usd: 150 }), per('b', '2026-08', 'confirmed', { archived_at: 'x' })],
    [th('2026-12', 'scheduling', { deal_amount_usd: 200 }), th('2026-11', 'confirmed', { deal_amount_usd: 150 }), th('2026-09', 'confirmed', { deal_amount_usd: 175 }), th('2026-08', 'discussing'), th('2027-01', 'interested'), th('2027-02', 'declined')]);
  assert.deepEqual(s.create.map(c => [c.month, c.amount_usd]), [['2026-12', 200]]);
  assert.deepEqual(s.confirm.map(c => c.month), ['2026-11']);
  assert.deepEqual(s.use_amount.map(c => [c.month, c.amount_usd]), [['2026-11', 150]], 'a sheet row with no amount is offered, not written');
  assert.deepEqual(s.notes.map(n => n.words), ['Email says $175 - the month says $150']);
  const B = randomUUID();
  const sb = seed({ hk_brands: [brandRow(B, 'Zz Mail Co')], hk_sponsor_periods: [per(B, '2026-11', 'discussing', { source: 'email' })],
    hk_brand_threads: [{ ...th('2026-11', 'discussing', { deal_amount_usd: 125 }), business_id: HK, brand_id: B, link_state: 'linked' }, { ...th('2026-12', 'discussing'), business_id: HK, brand_id: B, link_state: 'linked' }, { ...th('2027-01', 'discussing', { member_user_id: PETE }), business_id: HK, brand_id: B, link_state: 'linked' }],
    hk_member_prefs: [{ business_id: HK, user_id: PETE, share_deal_status: false }] });
  const w = await applyThreadFacts(sb, { businessId: HK, brandId: B, now: NOW });
  assert.deepEqual(w, { created: 1, filled: 1 });
  assert.deepEqual(sb.db.hk_sponsor_periods.map(p => [p.period, p.state, p.source, p.amount_usd ?? null]).sort(), [['2026-11', 'discussing', 'email', 125], ['2026-12', 'discussing', 'email', null]], "Pete doesn't share his deal status: his thread writes nothing");
  assert.deepEqual(await applyThreadFacts(sb, { businessId: HK, brandId: B, now: NOW }), { created: 0, filled: 0 }, 'idempotent');
  assert.deepEqual(sb.db.hk_events.map(e => [e.action, e.actor_kind]), [['sponsor.period_by_email', 'system'], ['sponsor.amount_by_email', 'system']]);
});

test('S7 status line: new / saved brand with deal stage, owner words and open month / reached out (another member = who + date only); a contact address matches server-side', () => {
  const b = { id: 'b1', name: 'Zz Talk Co', relationship: 'prospect', owner_user_id: PETE, owner_hint: null, instagram_handle: 'zztalk' };
  const ctx = { byId: { b1: b }, periodsBy: { b1: [per('b1', '2026-11', 'discussing')] }, reachedBy: reachedByBrand([{ brand_id: 'b1', sender_user_id: PETE, state: 'sent', sent_at: '2026-10-03T15:00:00Z' }], [{ brand_id: 'b1', member_user_id: JACK, last_ours_at: '2026-09-01T00:00:00Z' }]), firstName: id => (id === PETE ? 'Pete' : 'Jack'), meId: JACK, now: NOW };
  assert.deepEqual(statusLine({ kind: 'untracked' }, ctx), { kind: 'new', line: 'New · not in Grow' });
  const s = statusLine({ kind: 'matches', brand_id: 'b1' }, ctx);
  assert.deepEqual([s.line, s.reached.line, s.reached.mine, s.instagram_handle], ["Zz Talk Co · In discussion · Pete's · Nov: in discussion", 'Pete emailed them Oct 3', false, 'zztalk']);
  assert.equal(statusLine({ kind: 'matches', brand_id: 'b1' }, { ...ctx, reachedBy: { b1: { member_user_id: JACK, at: '2026-10-23T20:00:00Z' } } }).reached.line, 'You emailed them 3 days ago');
  assert.equal(statusLine({ kind: 'self' }, ctx), null);
  const base = { threadId: 't', tracked: new Map(), brandsByDomain: {}, teamDomains: [], ignored: new Set() };
  const c = chipFor({ ...base, sender: { name: 'Ana', domain: 'gmail.com', email: 'Ana.Owner@gmail.com' }, brandsByEmail: { 'ana.owner@gmail.com': b } });
  assert.deepEqual([c.kind, c.brand_id, c.matched_by, JSON.stringify(c).includes('@')], ['matches', 'b1', 'contact', false]);
  assert.equal(chipFor({ ...base, sender: { name: 'X', domain: 'gmail.com', email: 'x@gmail.com' } }).kind, 'untracked');
});

test('S8 Instagram handle: @, URL and case normalized; the CHECK shape enforced; blank clears', () => {
  assert.equal(handleOf('@ZzTalk.Co'), 'zztalk.co');
  assert.equal(handleOf('https://www.instagram.com/zz_talk/?igsh=abc'), 'zz_talk');
  assert.equal(handleOf(''), null);
  assert.throws(() => handleOf('zz talk'), /Instagram handle/);
  assert.throws(() => handleOf('a'.repeat(31)), /Instagram handle/);
});

test('Deal group filters: deal stage / month (+ month:state) / paid / amount facets and values parse', () => {
  const a = brandRow('a', 'Zz A', { relationship: 'sponsor' }), b = brandRow('b', 'Zz B');
  const data = { brands: [a, b], touches: {}, replies: {}, hasEmail: new Set(), intel: new Set(), months: new Set(['a', 'b']), threads: {},
    periodsBy: { a: [per('a', '2026-11', 'confirmed', { amount_usd: 150, paid: true }), per('a', '2026-12', 'confirmed')], b: [per('b', '2026-11', 'discussing', { amount_usd: 150 })] } };
  const r = applyFilters(data, { filters: parseFilters({ month: '2026-11:discussing' }), facets: true, meId: JACK, now: NOW });
  assert.deepEqual(r.rows.map(x => x.id), ['b']);
  const f = applyFilters(data, { facets: true, meId: JACK, now: NOW }).facets;
  assert.deepEqual(f.deal_stage, [['discussing', 1], ['sponsor', 1]]);
  assert.deepEqual(f.month.map(x => x[0]), ['2026-12:confirmed', '2026-12', '2026-11:discussing', '2026-11:confirmed', '2026-11']);
  assert.deepEqual([f.paid, f.amount], [[['paid', 1], ['unpaid', 1]], [['set', 2], ['not_set', 1]]]);
  assert.throws(() => parseFilters({ month: '2026-13' }), /unknown month/);
});

test('S3 sheet: fills -> states (green argb + theme 7, yellow, none with content, none name-only skipped), launch = confirmed, December shift by values, no contacts in details, dates kept', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const fill = (cell, c) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: c }; };
  const H = ['Name', 'Status', 'Type', 'Contact', 'Challenge Sponsor?', 'Challenge Name', 'Challange Schedule'];
  const nov = wb.addWorksheet('November Confirmed Sponsors'); nov.addRow(['Name', 'Paid?', 'Amount', ...H.slice(1)]);
  nov.addRow(['Zz Green', 'Yes', 150, 'Done', 'Reward', 'ana@green.invalid', 'Yes', 'Green Week', '11/01/2026 - 11/30/2026']); fill(nov.getRow(2).getCell(1), { argb: 'FF6AA84F' });
  nov.addRow(['Zz Theme', 'No', 150, '', 'Raffle']); fill(nov.getRow(3).getCell(1), { theme: 7 });
  nov.addRow(['Zz Yellow', 'Y', '$150', 'Waiting']); fill(nov.getRow(4).getCell(1), { argb: 'FFFFFF00' });
  nov.addRow(['Zz Plain', '', '', 'Talking']);
  nov.addRow(['Zz Bare']);
  const dec = wb.addWorksheet('December Confirmed Sponsors'); dec.addRow(H);
  dec.addRow(['Zz Green', 'Y', 150, 'Done', 'Reward']); fill(dec.getRow(2).getCell(1), { theme: 7 });
  dec.addRow(['Zz Yellow', 'N', 150]); fill(dec.getRow(3).getCell(1), { argb: 'FFFFFF00' });
  const launch = wb.addWorksheet('Confirmed Launch Sponsors'); launch.addRow(['Name', 'Type', 'Contact', 'Challenge Name']); launch.addRow(['Zz Green', 'Reward', 'Jo Founder', 'Launch Lap']);
  const buf = await wb.xlsx.writeBuffer(); const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(buf);
  assert.equal(fillOf(wb2.getWorksheet('November Confirmed Sponsors').getRow(3).getCell(1)), 'green');
  const { tabs } = parseSponsorTabs(wb2);
  const n = tabs.find(t => t.period === '2026-11'), d = tabs.find(t => t.period === '2026-12'), l = tabs.find(t => t.kind === 'launch');
  assert.deepEqual(n.rows.map(r => [r.name, r.state, r.paid, r.amount_usd]), [['Zz Green', 'confirmed', true, 150], ['Zz Theme', 'confirmed', false, 150], ['Zz Yellow', 'confirmed', true, 150], ['Zz Plain', 'discussing', false, null]]);
  assert.deepEqual(n.rows.map(r => r.paid_override), [false, false, true, false], 'ruling 1: yellow but paid -> confirmed');
  assert.deepEqual(n.skipped.map(s => s.name), ['Zz Bare']);
  assert.deepEqual(n.rows[0].details, { Status: 'Done', 'Challenge Sponsor?': 'Yes', 'Challenge Name': 'Green Week', 'Challange Schedule': '11/01/2026 - 11/30/2026' });
  assert.equal(n.rows[0].deal_type, 'Reward');
  assert.ok(!JSON.stringify(tabs).includes('ana@'), 'Contact never read into a month');
  assert.deepEqual([d.shifted, n.shifted, d.rows.map(r => [r.state, r.paid, r.amount_usd, r.details.Status || null, r.deal_type])], [true, false, [['confirmed', true, 150, 'Done', 'Reward'], ['discussing', false, 150, null, null]]]);
  assert.deepEqual([l.rows[0].state, JSON.stringify(l.rows[0].details).includes('Jo Founder')], ['confirmed', false]);
  assert.equal(detailPii('call 312-555-0100'), true);
});

test('S3 plan: add / change / unchanged / leave (DB-only, archived, edited in Grow) / unmatched; yellow-only sponsor -> prospect; never a delete', () => {
  const G = randomUUID(), Y = randomUUID(), U = randomUUID(), K = randomUUID(), J = randomUUID();
  const brands = [brandRow(G, 'Zz Green', { relationship: 'sponsor', status: 'sponsor' }), brandRow(Y, 'Zz Yellow', { relationship: 'sponsor', status: 'sponsor' }), brandRow(U, 'Zz User', { relationship: 'sponsor', status: 'sponsor' }), brandRow(K, 'Zz Kept', { aliases: ['Zz Kept Too'] }), brandRow(J, 'Zz Just', { relationship: 'sponsor', status: 'sponsor' })];
  const periods = [per(G, '2026-11'), per(Y, '2026-11'), per(U, '2026-11', 'confirmed', { source: 'user', amount_usd: 99 }), per(J, '2026-11'), per(K, '2026-11', 'confirmed', { archived_at: 'x' })];
  const row = (name, state, over = {}) => ({ ref: `Nov:${name}`, name, state, paid: false, amount_usd: 150, deal_type: null, details: {}, warnings: [], ...over });
  const tabs = [{ name: 'November', kind: 'monthly', period: '2026-11', shifted: false, skipped: [], rows: [row('Zz Green', 'confirmed', { paid: true }), row('Zz Yellow', 'discussing'), row('Zz User', 'discussing'), row('Zz Kept Too', 'confirmed'), row('Zz New Place', 'confirmed')] },
    { name: 'December', kind: 'monthly', period: '2026-12', shifted: true, skipped: [], rows: [row('ZZ GREEN', 'discussing')] }];
  const p = planReimport({ tabs, brands, periods });
  const nov = p.tabs[0];
  assert.match(changeWords({ period: '2026-11', next: { state: 'confirmed', amount_usd: 150, paid: true }, paid_override: true }), /Nov 2026 → confirmed \$150, paid \(sheet yellow but paid → confirmed\)/);
  assert.deepEqual([nov.would_fill, nov.would_mark_discussing, nov.would_leave.sort(), nov.unmatched], [['Zz Green'], ['Zz Yellow'], ['Zz Just (in Grow, not on the sheet)', 'Zz Kept (removed in Grow)', 'Zz User (edited in Grow - user)'], ['Zz New Place']]);
  assert.deepEqual(p.tabs[1].would_add, ['Zz Green (in discussion)']);
  assert.deepEqual(p.writes.map(w => [w.brand, w.period, w.next.state, !!w.period_id]), [['Zz Green', '2026-11', 'confirmed', true], ['Zz Yellow', '2026-11', 'discussing', true], ['Zz Green', '2026-12', 'discussing', false]]);
  assert.deepEqual(p.relationships.map(r => [r.brand, r.from, r.to, r.status_to]), [['Zz Yellow', 'sponsor', 'prospect', 'replied']]);
  const reordered = { ...tabs[0], rows: [row('Zz Green', 'confirmed', { details: { B: '2', A: '1' } })] };
  assert.equal(planReimport({ tabs: [reordered], brands, periods: [per(G, '2026-11', 'confirmed', { amount_usd: 150, details: { A: '1', B: '2' } })] }).tabs[0].unchanged, 1, 'jsonb key order is not a change');
  assert.equal(planReimport({ tabs, brands, periods: [...periods.slice(0, 2).map(x => ({ ...x, state: x.brand_id === Y ? 'discussing' : 'confirmed', amount_usd: 150, paid: x.brand_id === G })), ...periods.slice(2)] }).tabs[0].unchanged, 2, 're-runnable: a second run changes nothing it already wrote');
  const fam = planReimport({ tabs: [{ name: 'T', kind: 'monthly', period: '2026-11', shifted: false, skipped: [], rows: [row('LSQP', 'confirmed'), row('Logan Square Pilates', 'confirmed'), row('PBK', 'confirmed'), row('Protein Bar and Kitchen', 'confirmed'), row('CBA', 'confirmed'), row('The Crib / Mahogany Tours', 'confirmed')] }], brands: [], periods: [] }).families;
  assert.deepEqual(fam.map(f => f.join(' / ')).sort(), ['LSQP / Logan Square Pilates', 'PBK / Protein Bar and Kitchen']);
});
