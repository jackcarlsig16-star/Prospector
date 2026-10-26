// node --test api/hk/brandsRoutes.test.mjs
// hkos-data-foundation-v1 Stage 2 - brands + contacts routes on the in-memory Supabase (api/hk/testing.mjs fixtures).
import test from 'node:test';
import assert from 'node:assert/strict';
import { listBrandsRoute, checkBrandsRoute, createBrandRoute, getBrandRoute, patchBrandRoute, listContactsRoute, createContactRoute, patchContactRoute } from './brandsRoutes.js';
import { seed, reqOf, call, hasAt, HK, OTHER, JACK, PETE, ID, NOW } from './testing.mjs';

const deps = sb => ({ supabase: sb, now: () => NOW });
const check = async (sb, items, user = JACK) => (await call(checkBrandsRoute, reqOf({ method: 'POST', body: items, user }), deps(sb))).body.results;

test('check: sponsor, do-not-contact, owned-by-other, exact duplicate (name / alias / domain), partial, legacy, niche warning, clear', async () => {
  const sb = seed();
  const [juice, cafe, yogaAsJack, runAlias, partial, legacyAcc, legacyPro, clear, niche, byDomain] = await check(sb, [
    { name: 'northwind juice' }, { name: 'Copperleaf Cafe' }, { name: 'Harbor Yoga' }, { name: 'Bluefin Runners' }, { name: 'Bluefin' },
    { name: 'Dunmore Mills' }, { name: 'Eastgate Hospital Partners' }, { name: 'Lakeview Bakery' }, { name: 'Lakeview Bakery', niche: 'Cold-Pressed Juice' }, { name: 'Something Else', domain: 'https://www.NorthwindJuice.example/about' },
  ]);
  assert.equal(juice.verdict, 'sponsor'); assert.equal(juice.match.id, ID.juice);
  assert.equal(cafe.verdict, 'do_not_contact');
  assert.deepEqual([yogaAsJack.verdict, yogaAsJack.owner_user_id], ['owned_by', PETE]);
  assert.deepEqual([runAlias.verdict, runAlias.exact, runAlias.match.id], ['possible_duplicate', true, ID.run]);
  assert.deepEqual([partial.verdict, partial.exact, partial.matches.map(m => m.id)], ['possible_duplicate', false, [ID.run]]);
  assert.deepEqual([legacyAcc.verdict, legacyAcc.legacy], ['possible_duplicate', [{ id: 'acc-1', name: 'Dunmore Mills', kind: 'business', table: 'accounts' }]]);
  assert.deepEqual(legacyPro.legacy.map(l => l.kind), ['prospect']);
  assert.deepEqual([clear.verdict, clear.warnings], ['clear', []]);
  assert.deepEqual([niche.verdict, niche.warnings], ['niche_warning', [{ code: 'niche_overlap', sponsor: 'Northwind Juice' }]]);
  assert.deepEqual([byDomain.verdict, byDomain.domain], ['sponsor', 'northwindjuice.example']);
  const [yogaAsPete] = await check(sb, [{ name: 'Harbor Yoga' }], PETE);
  assert.deepEqual([yogaAsPete.verdict, yogaAsPete.exact], ['possible_duplicate', true]);
  assert.equal((await call(checkBrandsRoute, reqOf({ method: 'POST', body: [] }), deps(sb))).code, 400);
  assert.equal((await call(checkBrandsRoute, reqOf({ method: 'POST', body: [{ name: 'x', domain: 'not a domain' }] }), deps(sb))).code, 400);
});

test('create: clear -> 201 + event; claim sets owner + status; sponsor / dnc refused; duplicates need force_duplicate; exact-name force still hits the unique index', async () => {
  const sb = seed();
  const r = await call(createBrandRoute, reqOf({ method: 'POST', body: { name: ' Lakeview  Bakery ', domain: 'LakeviewBakery.example/', is_local: true, neighborhood: 'Logan Square', notes: 'bread subscription idea' } }), deps(sb));
  assert.equal(r.code, 201, JSON.stringify(r.body));
  assert.deepEqual([r.body.brand.name, r.body.brand.normalized_name, r.body.brand.domain, r.body.brand.status, r.body.brand.owner_user_id, r.body.brand.segment, r.body.brand.source, r.body.verdict.verdict], ['Lakeview Bakery', 'lakeview bakery', 'lakeviewbakery.example', 'candidate', null, 'sponsor_brand', 'user_supplied', 'clear']);
  assert.deepEqual(sb.db.hk_events.map(e => e.action), ['brand.created']);
  const c = await call(createBrandRoute, reqOf({ method: 'POST', body: { name: 'Wicker Park Climbing', claim: true } }), deps(sb));
  assert.deepEqual([c.code, c.body.brand.owner_user_id, c.body.brand.status], [201, JACK, 'claimed']);
  assert.deepEqual(sb.db.hk_events.slice(1).map(e => e.action), ['brand.created', 'brand.claimed']);
  const s = await call(createBrandRoute, reqOf({ method: 'POST', body: { name: 'Northwind Juice', force_duplicate: true } }), deps(sb));
  assert.deepEqual([s.code, s.body.verdict.verdict], [409, 'sponsor']);
  assert.equal((await call(createBrandRoute, reqOf({ method: 'POST', body: { name: 'Copperleaf Cafe' } }), deps(sb))).code, 409);
  const d = await call(createBrandRoute, reqOf({ method: 'POST', body: { name: 'Bluefin' } }), deps(sb));
  assert.deepEqual([d.code, d.body.verdict.verdict, d.body.verdict.matches.length], [409, 'possible_duplicate', 1]);
  assert.equal((await call(createBrandRoute, reqOf({ method: 'POST', body: { name: 'Bluefin', force_duplicate: true } }), deps(sb))).code, 201);
  assert.equal((await call(createBrandRoute, reqOf({ method: 'POST', body: { name: 'bluefin run club', force_duplicate: true } }), deps(sb))).code, 409, 'exact normalized name is a real duplicate - the partial unique index refuses it');
  assert.equal((await call(createBrandRoute, reqOf({ method: 'POST', body: { name: 'Harbor Yoga' } }), deps(sb))).code, 409);
  assert.equal((await call(createBrandRoute, reqOf({ method: 'POST', body: { name: 'Fine Name', notes: 'call 312-555-0142' } }), deps(sb))).code, 400);
  assert.equal((await call(createBrandRoute, reqOf({ method: 'POST', body: { domain: 'x.example' } }), deps(sb))).code, 400);
  assert.equal((await call(createBrandRoute, reqOf({ method: 'POST', body: { name: 'Fine Name', segment: 'robots' } }), deps(sb))).code, 400);
});

test('list: live brands only, no email anywhere, primary contact name, views / owner / status / q filters', async () => {
  const sb = seed();
  const all = (await call(listBrandsRoute, reqOf(), deps(sb))).body;
  assert.deepEqual(all.brands.map(b => b.name).sort(), ['Bluefin Run Club', 'Copperleaf Cafe', 'Harbor Yoga', 'Northwind Juice']);
  assert.ok(!hasAt(all)); assert.ok(all.brands.every(b => !('email' in b) && !('notes' in b)));
  assert.equal(all.brands.find(b => b.id === ID.yoga).primary_contact_name, 'Ana Example');
  const names = async (q, user = JACK) => (await call(listBrandsRoute, reqOf({ query: q, user }), deps(sb))).body.brands.map(b => b.name);
  assert.deepEqual(await names({ view: 'my_open' }, PETE), ['Harbor Yoga']);
  assert.deepEqual(await names({ view: 'my_open' }), []);
  assert.deepEqual(await names({ view: 'unclaimed' }), ['Bluefin Run Club']);
  assert.deepEqual(await names({ view: 'local' }), ['Harbor Yoga']);
  assert.deepEqual(await names({ q: 'runners' }), ['Bluefin Run Club']);
  assert.deepEqual(await names({ q: 'harboryoga' }), ['Harbor Yoga']);
  assert.deepEqual(await names({ owner: 'me' }, PETE), ['Harbor Yoga']);
  assert.deepEqual((await names({ status: 'candidate' })).sort(), ['Bluefin Run Club', 'Copperleaf Cafe']);
  assert.equal((await call(listBrandsRoute, reqOf({ query: { view: 'nope' } }), deps(sb))).code, 400);
});

test('detail: contacts carry the email, replies never carry from_email, touches never carry bodies, verdict is for the caller; 404 across workspaces', async () => {
  const sb = seed();
  const r = (await call(getBrandRoute, reqOf({ params: { id: ID.yoga } }), deps(sb))).body;
  assert.equal(r.contacts[0].email, 'ana@harboryoga.example');
  assert.deepEqual(Object.keys(r.replies[0]).filter(k => /email|body/.test(k)), []);
  assert.equal(r.replies[0].from_domain, 'harboryoga.example');
  assert.ok(!JSON.stringify(r.touches).includes('secret'));
  assert.deepEqual([r.verdict.reason, r.email_touches_sent], ['owned_by', 2]);
  const p = (await call(getBrandRoute, reqOf({ params: { id: ID.yoga }, user: PETE }), deps(sb))).body;
  assert.equal(p.verdict.ok, true);
  sb.db.hk_touches.push({ id: 't3', business_id: HK, brand_id: ID.yoga, sender_user_id: PETE, channel: 'email', kind: 'final', state: 'sent', created_by: 'claude', created_at: '2026-10-20T00:00:00Z' });
  assert.equal((await call(getBrandRoute, reqOf({ params: { id: ID.yoga }, user: PETE }), deps(sb))).body.verdict.reason, 'max_touches');
  const without = JSON.parse(JSON.stringify(r)); delete without.contacts;
  assert.ok(!hasAt(without), 'the only address in the detail is on the contact');
  assert.equal((await call(getBrandRoute, reqOf({ params: { id: ID.yoga }, businessId: OTHER }), deps(sb))).code, 404);
  assert.equal((await call(getBrandRoute, reqOf({ params: { id: 'nope' } }), deps(sb))).code, 404);
});

test('patch: fields log prev; manual statuses only; claim / release rules; relationship rules; name change renormalizes; no-op is empty', async () => {
  const sb = seed();
  const patch = (id, body, over = {}) => call(patchBrandRoute, reqOf({ method: 'PATCH', params: { id }, body, ...over }), deps(sb));
  let r = await patch(ID.run, { notes: 'hands out bibs on Saturdays', challenge_idea: 'a 5k check-in' });
  assert.deepEqual([r.code, r.body.changed], [200, ['notes', 'challenge_idea']]);
  assert.deepEqual(sb.db.hk_events.at(-1).detail, { changed: ['notes', 'challenge_idea'], prev: { notes: null, challenge_idea: null } });
  assert.equal((await patch(ID.run, { status: 'meeting' })).body.brand.status, 'meeting');
  assert.equal((await patch(ID.run, { status: 'sent' })).code, 400);
  r = await patch(ID.run, { claim: true });
  assert.deepEqual([r.body.brand.owner_user_id, sb.db.hk_events.at(-1).action], [JACK, 'brand.claimed']);
  assert.equal((await patch(ID.yoga, { claim: false })).code, 403, 'a member cannot release another founder\'s claim');
  r = await patch(ID.yoga, { claim: false }, { role: 'owner' });
  assert.deepEqual([r.code, r.body.brand.owner_user_id, r.body.brand.status], [200, null, 'candidate']);
  assert.equal((await patch(ID.run, { relationship: 'do_not_contact' })).code, 400, 'reason required');
  r = await patch(ID.run, { relationship: 'do_not_contact', dnc_reason: 'asked us not to email' });
  assert.deepEqual([r.body.brand.relationship, r.body.brand.dnc_reason, sb.db.hk_events.at(-1).action], ['do_not_contact', 'asked us not to email', 'brand.relationship']);
  assert.equal((await patch(ID.yoga, { relationship: 'sponsor' })).code, 403);
  r = await patch(ID.yoga, { relationship: 'sponsor' }, { role: 'owner' });
  assert.deepEqual([r.body.brand.relationship, r.body.brand.status], ['sponsor', 'sponsor']);
  r = await patch(ID.yoga, { name: 'Harbor Yoga Studio, LLC' }, { role: 'owner' });
  assert.deepEqual([r.body.brand.name, r.body.brand.normalized_name], ['Harbor Yoga Studio, LLC', 'harbor yoga studio']);
  assert.deepEqual((await patch(ID.yoga, { name: 'Harbor Yoga Studio, LLC' }, { role: 'owner' })).body.changed, []);
  assert.equal((await patch(ID.old, { notes: 'x' })).code, 409);
  assert.equal((await patch(ID.run, { notes: 'mail me at lee@bluefinrun.example' })).code, 400);
});

test('contacts: create lowercases + validates the email, one primary per brand, hasPii on name / title, patch, 404s; the list carries emails', async () => {
  const sb = seed();
  const add = (id, body) => call(createContactRoute, reqOf({ method: 'POST', params: { id }, body }), deps(sb));
  let r = await add(ID.run, { name: 'Lee Example', title: 'Marketing', email: 'LEE@BluefinRun.example ', is_primary: true });
  assert.equal(r.code, 201, JSON.stringify(r.body));
  assert.deepEqual([r.body.contact.email, r.body.contact.email_source, r.body.contact.is_primary], ['lee@bluefinrun.example', 'user_supplied', true]);
  const ev = sb.db.hk_events.at(-1); assert.deepEqual([ev.action, ev.detail.has_email, hasAt(ev)], ['contact.added', true, false]);
  const second = await add(ID.run, { name: 'Sam Example', is_primary: true });
  assert.equal(second.code, 201);
  const list = (await call(listContactsRoute, reqOf({ params: { id: ID.run } }), deps(sb))).body.contacts;
  assert.deepEqual(list.map(c => [c.name, c.is_primary, c.email]), [['Lee Example', false, 'lee@bluefinrun.example'], ['Sam Example', true, null]]);
  assert.equal((await add(ID.run, { name: 'Bad Title', title: 'call 312-555-0142' })).code, 400);
  assert.equal((await add(ID.run, { name: 'Bad Email', email: 'not-an-address' })).code, 400);
  assert.equal((await add(ID.run, { name: 'ana@typed.example' })).code, 400, 'an address typed into the name is refused');
  assert.equal((await add('nope', { name: 'X' })).code, 404);
  r = await call(patchContactRoute, reqOf({ method: 'PATCH', params: { id: ID.run, cid: second.body.contact.id }, body: { left_company: true, title: 'Former owner' } }), deps(sb));
  assert.deepEqual([r.code, r.body.contact.left_company, r.body.changed], [200, true, ['title', 'left_company']]);
  assert.equal((await call(patchContactRoute, reqOf({ method: 'PATCH', params: { id: ID.run, cid: 'nope' }, body: { title: 'x' } }), deps(sb))).code, 404);
  assert.equal((await call(patchContactRoute, reqOf({ method: 'PATCH', params: { id: ID.yoga, cid: second.body.contact.id }, body: { title: 'x' } }), deps(sb))).code, 404, 'a contact is reachable only under its own brand');
});
