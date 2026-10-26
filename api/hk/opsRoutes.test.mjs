// node --test api/hk/opsRoutes.test.mjs
// hkos-data-foundation-v1 Stage 2 - sponsors, review, activity, settings, prefs + the shell's prefs seeding, on the
// in-memory Supabase (api/hk/testing.mjs fixtures).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sponsorsRoute, addPeriodRoute, deletePeriodRoute, duplicatesRoute, decideDuplicateRoute, warningsRoute, activityRoute, getSettingsRoute, patchSettingsRoute, confirmStatsRoute, getPrefsRoute, patchPrefsRoute, duplicatePairs } from './opsRoutes.js';
import { patchBrandRoute } from './brandsRoutes.js';
import { shellPayload, memberPrefs } from './shell.js';
import { seed, reqOf, call, hasAt, HK, JACK, PETE, ID, NOW } from './testing.mjs';

const deps = sb => ({ supabase: sb, now: () => NOW });

test('sponsors: current sponsors with periods, the DNC list with reason + who marked it; period rules; delete is owner-only', async () => {
  const sb = seed();
  let r = await call(addPeriodRoute, reqOf({ method: 'POST', params: { brandId: ID.juice }, body: { period: 'launch' } }), deps(sb));
  assert.deepEqual([r.code, r.body.period.kind], [201, 'launch']);
  assert.equal((await call(addPeriodRoute, reqOf({ method: 'POST', params: { brandId: ID.juice }, body: { period: '2026-09', note: 'first monthly' } }), deps(sb))).code, 201);
  assert.equal((await call(addPeriodRoute, reqOf({ method: 'POST', params: { brandId: ID.juice }, body: { period: '2026-13' } }), deps(sb))).code, 400);
  assert.equal((await call(addPeriodRoute, reqOf({ method: 'POST', params: { brandId: ID.run }, body: { period: '2026-09' } }), deps(sb))).code, 400, 'periods belong to sponsors');
  await call(patchBrandRoute, reqOf({ method: 'PATCH', params: { id: ID.run }, body: { relationship: 'do_not_contact', dnc_reason: 'declined twice' }, user: PETE }), deps(sb));
  const s = (await call(sponsorsRoute, reqOf(), deps(sb))).body;
  assert.deepEqual(s.sponsors.map(x => [x.name, x.periods.map(p => p.period)]), [['Northwind Juice', ['2026-09', 'launch']]]);
  assert.deepEqual(s.dnc.map(x => [x.name, x.dnc_reason, x.marked_by]).sort(), [['Bluefin Run Club', 'declined twice', PETE], ['Copperleaf Cafe', 'asked us to stop', null]]);
  assert.ok(!hasAt(s));
  const pid = sb.db.hk_sponsor_periods[0].id;
  assert.equal((await call(deletePeriodRoute, reqOf({ method: 'DELETE', params: { brandId: ID.juice, pid } }), deps(sb))).code, 403);
  assert.equal((await call(deletePeriodRoute, reqOf({ method: 'DELETE', params: { brandId: ID.juice, pid }, role: 'owner' }), deps(sb))).code, 200);
  assert.equal(sb.db.hk_sponsor_periods.length, 1);
  assert.equal(sb.db.hk_events.at(-1).action, 'sponsor.period_removed');
  assert.equal((await call(deletePeriodRoute, reqOf({ method: 'DELETE', params: { brandId: ID.juice, pid }, platformOwner: true, role: 'viewer' }), deps(sb))).code, 404);
});

test('review: duplicate pairs by domain and name, a not_duplicate decision hides the pair, merge moves children and archives the loser', async () => {
  const sb = seed();
  const studio = { id: 'b-studio', business_id: HK, name: 'Harbor Yoga Studio', normalized_name: 'harbor yoga studio', aliases: [], segment: 'sponsor_brand', status: 'candidate', relationship: 'prospect', created_at: '2026-10-05T00:00:00Z' };
  const runInc = { id: 'b-runinc', business_id: HK, name: 'Bluefin Run Club Inc', normalized_name: 'bluefin run club', domain: 'bluefinrun.example', aliases: ['BRC'], segment: 'sponsor_brand', status: 'claimed', owner_user_id: PETE, relationship: 'prospect', created_at: '2026-10-06T00:00:00Z' };
  sb.db.hk_brands.push(studio, runInc);
  sb.db.hk_contacts.push({ id: 'c-run', business_id: HK, brand_id: 'b-runinc', name: 'Lee Example', is_primary: true, created_at: '2026-10-06T00:00:00Z' });
  sb.db.hk_touches.push({ id: 't-run', business_id: HK, brand_id: 'b-runinc', sender_user_id: PETE, channel: 'ig_dm', kind: 'dm_text', state: 'sent', created_by: 'user', created_at: '2026-10-07T00:00:00Z' });
  let pairs = (await call(duplicatesRoute, reqOf(), deps(sb))).body.pairs;
  assert.deepEqual(pairs.map(p => [p.a.name, p.b.name, p.reason]), [['Bluefin Run Club', 'Bluefin Run Club Inc', 'same_domain'], ['Harbor Yoga', 'Harbor Yoga Studio', 'name_contains']]);
  assert.ok(!hasAt(pairs));
  let r = await call(decideDuplicateRoute, reqOf({ method: 'POST', body: { brand_a: ID.yoga, brand_b: 'b-studio', verdict: 'not_duplicate' } }), deps(sb));
  assert.equal(r.code, 200);
  pairs = (await call(duplicatesRoute, reqOf(), deps(sb))).body.pairs;
  assert.deepEqual(pairs.map(p => p.reason), ['same_domain']);
  assert.equal((await call(decideDuplicateRoute, reqOf({ method: 'POST', body: { brand_a: ID.run, brand_b: 'b-runinc', verdict: 'merge', winner: 'someone-else' } }), deps(sb))).code, 400);
  r = await call(decideDuplicateRoute, reqOf({ method: 'POST', body: { brand_a: ID.run, brand_b: 'b-runinc', verdict: 'merge', winner: ID.run } }), deps(sb));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.archived, r.body.moved], ['b-runinc', { hk_contacts: 1, hk_touches: 1, hk_replies: 0, hk_sponsor_periods: 0 }]);
  const winner = sb.db.hk_brands.find(b => b.id === ID.run), loser = sb.db.hk_brands.find(b => b.id === 'b-runinc');
  assert.deepEqual(winner.aliases, ['Bluefin Runners', 'Bluefin Run Club Inc', 'BRC']);
  assert.ok(loser.archived_at);
  assert.equal(sb.db.hk_contacts.find(c => c.id === 'c-run').brand_id, ID.run);
  assert.deepEqual(sb.db.hk_duplicate_decisions.map(d => d.verdict), ['not_duplicate', 'merged']);
  assert.equal(sb.db.hk_events.at(-1).action, 'brand.merged');
  assert.deepEqual((await call(duplicatesRoute, reqOf(), deps(sb))).body.pairs, []);
  assert.equal((await call(decideDuplicateRoute, reqOf({ method: 'POST', body: { brand_a: ID.run, brand_b: 'b-runinc', verdict: 'merge', winner: ID.run } }), deps(sb))).code, 409);
  assert.deepEqual(duplicatePairs([{ id: 'x', name: 'Enterprise' }, { id: 'y', name: 'Hewlett Packard Enterprise' }]), [], 'generic words do not pair (FIX dupe-generic-words)');
});

test('review warnings: future last touch, far next due, missing domain past candidate, owner conflict', async () => {
  const sb = seed();
  Object.assign(sb.db.hk_brands.find(b => b.id === ID.run), { last_touch_at: '2027-01-01T00:00:00Z', status: 'claimed', owner_user_id: JACK, owner_unclear: true, domain: null, next_due_at: '2028-06-01T00:00:00Z' });
  const w = (await call(warningsRoute, reqOf(), deps(sb))).body.warnings;
  assert.deepEqual(w.filter(x => x.brand_id === ID.run).map(x => x.kind), ['future_last_touch', 'far_next_due', 'missing_domain', 'owner_conflict']);
  assert.deepEqual(w.filter(x => x.brand_id === ID.cafe).map(x => x.kind), [], 'a candidate without a domain is not a warning');
});

test('activity: newest first, filters by action prefix / brand / actor / dates, brand names attached, nothing with "@"', async () => {
  const sb = seed();
  sb.db.hk_events.push(
    { id: 'e1', business_id: HK, actor_user_id: JACK, actor_kind: 'user', entity_type: 'brand', entity_id: ID.run, action: 'brand.created', detail: {}, created_at: '2026-10-20T00:00:00Z' },
    { id: 'e2', business_id: HK, actor_user_id: PETE, actor_kind: 'user', entity_type: 'brand', entity_id: ID.yoga, action: 'brand.claimed', detail: {}, created_at: '2026-10-21T00:00:00Z' },
    { id: 'e3', business_id: HK, actor_user_id: null, actor_kind: 'system', entity_type: 'settings', entity_id: null, action: 'settings.updated', detail: { changed: ['timezone'] }, created_at: '2026-10-22T00:00:00Z' },
  );
  const ev = async q => (await call(activityRoute, reqOf({ query: q }), deps(sb))).body.events;
  assert.deepEqual((await ev({})).map(e => [e.action, e.brand_name]), [['settings.updated', null], ['brand.claimed', 'Harbor Yoga'], ['brand.created', 'Bluefin Run Club']]);
  assert.deepEqual((await ev({ action: 'brand.' })).map(e => e.id), ['e2', 'e1']);
  assert.deepEqual((await ev({ brand: ID.yoga })).map(e => e.id), ['e2']);
  assert.deepEqual((await ev({ actor: 'system' })).map(e => e.id), ['e3']);
  assert.deepEqual((await ev({ actor: PETE })).map(e => e.id), ['e2']);
  assert.deepEqual((await ev({ from: '2026-10-21', to: '2026-10-21T23:59:59Z' })).map(e => e.id), ['e2']);
  assert.ok(!hasAt(await ev({})));
});

test('settings: defaults before a row exists, owner-only PATCH, read-only cap, banned phrases normalized, modules PII-guarded, confirm-stats stamps', async () => {
  const sb = seed();
  let r = (await call(getSettingsRoute, reqOf(), deps(sb))).body;
  assert.deepEqual([r.seeded, r.settings.max_email_touches, r.settings.banned_phrases, r.settings.business_id], [false, 3, [], HK]);
  assert.equal((await call(patchSettingsRoute, reqOf({ method: 'PATCH', body: { members_stat: 1500 } }), deps(sb))).code, 403);
  assert.equal((await call(patchSettingsRoute, reqOf({ method: 'PATCH', body: { max_email_touches: 5 }, role: 'owner' }), deps(sb))).code, 400);
  assert.equal((await call(patchSettingsRoute, reqOf({ method: 'PATCH', body: { bump_after_days: 0 }, role: 'owner' }), deps(sb))).code, 400);
  assert.equal((await call(patchSettingsRoute, reqOf({ method: 'PATCH', body: { modules: { note: 'mail sam@x.example' } }, role: 'owner' }), deps(sb))).code, 400);
  r = await call(patchSettingsRoute, reqOf({ method: 'PATCH', body: { members_stat: 1500, completions_stat: 6000, banned_phrases: [' Synergies', 'synergies', 'circle back'], subject_format: 'HumanKind x [Brand] - [descriptor]', modules: { creators: true } }, role: 'owner' }), deps(sb));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.settings.members_stat, r.body.settings.banned_phrases, r.body.settings.modules, r.body.settings.stats_confirmed_at], [1500, ['synergies', 'circle back'], { creators: true }, null]);
  assert.deepEqual(sb.db.hk_events.at(-1).detail.changed, ['members_stat', 'completions_stat', 'subject_format', 'banned_phrases', 'modules']);
  r = await call(confirmStatsRoute, reqOf({ method: 'POST', body: { members_stat: 1550 } }), deps(sb));
  assert.deepEqual([r.code, r.body.settings.members_stat, r.body.settings.completions_stat, r.body.settings.stats_confirmed_at], [200, 1550, 6000, NOW.toISOString()]);
  assert.equal((await call(confirmStatsRoute, reqOf({ method: 'POST', body: { members_stat: -1 } }), deps(sb))).code, 400);
  assert.equal((await call(getSettingsRoute, reqOf(), deps(sb))).body.seeded, true);
});

test('prefs: defaults, upsert, validation, slot conflict -> 409', async () => {
  const sb = seed();
  assert.deepEqual((await call(getPrefsRoute, reqOf(), deps(sb))).body.prefs, { business_id: HK, user_id: JACK, avatar_slot: null, owner_filter: 'me' });
  let r = await call(patchPrefsRoute, reqOf({ method: 'PATCH', body: { avatar_slot: 2, owner_filter: 'all' } }), deps(sb));
  assert.deepEqual([r.code, r.body.prefs.avatar_slot, r.body.prefs.owner_filter], [200, 2, 'all']);
  assert.deepEqual((await call(getPrefsRoute, reqOf(), deps(sb))).body.prefs.avatar_slot, 2);
  assert.equal((await call(patchPrefsRoute, reqOf({ method: 'PATCH', body: { avatar_slot: 7 } }), deps(sb))).code, 400);
  assert.equal((await call(patchPrefsRoute, reqOf({ method: 'PATCH', body: { owner_filter: 'bogus' } }), deps(sb))).code, 400);
  assert.equal((await call(patchPrefsRoute, reqOf({ method: 'PATCH', body: {} }), deps(sb))).code, 400);
  const taken = { from: t => (t === 'hk_member_prefs' ? { upsert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'dup' } }) }) }) } : sb.from(t)) };
  r = await call(patchPrefsRoute, reqOf({ method: 'PATCH', body: { avatar_slot: 1 } }), { supabase: taken, now: () => NOW });
  assert.deepEqual([r.code, r.body.error], [409, 'that color slot is taken']);
});

test('shell: stored slots win over list order; the caller\'s first visit seeds the lowest free slot once; members without a profile are not seeded', async () => {
  const sb = seed({ hk_member_prefs: [{ business_id: HK, user_id: JACK, avatar_slot: 1, owner_filter: 'me' }] });
  const members = [
    { user_id: PETE, name: 'Pete Example', role: 'member', created_at: '2026-08-13T00:00:00Z', profile: { display_name: 'Pete Example' } },
    { user_id: JACK, name: 'Jack Example', role: 'owner', created_at: '2026-10-02T00:00:00Z', profile: { display_name: 'Jack Example' } },
    { user_id: null, name: 'Invited', role: 'viewer', created_at: '2026-10-03T00:00:00Z', profile: null },
  ];
  const prefs = await memberPrefs(sb, HK, members, PETE);
  assert.deepEqual(prefs.map(p => [p.user_id, p.avatar_slot]), [[JACK, 1], [PETE, 2]]);
  assert.equal((await memberPrefs(sb, HK, members, PETE)).length, 2, 'no duplicate on the second visit');
  assert.equal((await memberPrefs(sb, HK, members, 'u-stranger')).length, 2, 'a non-member is never seeded');
  const auth = { user: { id: PETE, name: 'Pete Example' }, isPlatformOwner: false, roles: new Map([[HK, 'member']]) };
  const p = shellPayload(members, auth, HK, prefs);
  assert.deepEqual(p.members.map(m => [m.first_name, m.palette_index]), [['Jack', 1], ['Pete', 2], ['Invited', 3]]);
  const swapped = shellPayload(members, auth, HK, [{ user_id: JACK, avatar_slot: 3 }, { user_id: PETE, avatar_slot: 1 }]);
  assert.deepEqual(swapped.members.map(m => [m.first_name, m.palette_index]), [['Jack', 3], ['Pete', 1], ['Invited', 2]]);
  assert.ok(!hasAt(p));
});

test('event guard: ids and timestamps never read as phone numbers; a real address or phone still does', async () => {
  const { detailHasPii } = await import('./hkShared.js');
  for (let i = 0; i < 200; i++) assert.equal(detailHasPii({ contact_id: crypto.randomUUID(), prev: { last_touch_at: '2027-01-01T00:00:00.000Z', next_due_at: NOW.toISOString() } }), false);
  assert.equal(detailHasPii({ note: 'ring 312-555-0142' }), true);
  assert.equal(detailHasPii({ note: 'mail sam@x.example' }), true);
});
