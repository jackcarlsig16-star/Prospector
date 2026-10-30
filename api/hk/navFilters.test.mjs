// node --test api/hk/navFilters.test.mjs
// grow-nav-filters-v1 Stage 2 - S1 paged /brands (filters, faceted counts, views, sort, paging), S2 /search, S3 saved
// views + rail, S4 owner-aware badges, S5 replies snoozed / drafts filters. Invented brands on .invalid in the shared
// fake Supabase; 0 network, 0 Claude, 0 Gmail, 0 Apollo.
import test from 'node:test';
import assert from 'node:assert/strict';
const { fakeSupabase } = await import('../sales/testing/fakeSupabase.mjs');
const { reqOf, call, HK } = await import('./testing.mjs');
const { listBrandsRoute } = await import('./brandsRoutes.js');
const { VIEWS, applyFilters, parseFilters } = await import('./brandFilters.js');
const { searchRoute } = await import('./searchRoutes.js');
const { getPrefsRoute, patchPrefsRoute, SAVED_VIEWS_MAX } = await import('./opsRoutes.js');
const { listRepliesRoute, listDraftsRoute, gmailStatusRoute } = await import('./gmailRoutes.js');
const { STATUS_ORDER, IN_CHUNK } = await import('./hkShared.js');
const { makeHkGate } = await import('../lib/requireAuth.js');

const NOW = new Date('2026-10-29T15:00:00Z');
const day = n => new Date(NOW.getTime() + n * 864e5).toISOString();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const B = n => id(100 + n);
const JACK = id(1001), PETE = id(1002); // member ids are uuids, as on prod (the owner filter checks the shape)
const brand = (n, name, over = {}) => ({ id: B(n), business_id: HK, name, normalized_name: name.toLowerCase(), aliases: [], segment: 'sponsor_brand', category: null, is_local: false, city: null, status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_hint: null, owner_unclear: false, source: 'import', heat: 0, heat_band: 'cold', targeted_at: null, next_due_at: null, last_touch_at: null, domain: null, domain_suggested: null, created_at: `2026-10-27T00:00:${String(n).padStart(2, '0')}Z`, updated_at: '2026-10-27T00:00:00Z', archived_at: null, ...over });
const BRANDS = () => [
  brand(1, 'Alder Oats', { status: 'sent', owner_hint: 'pete', category: 'National CPG', domain: 'alder.invalid', next_due_at: day(-2), last_touch_at: day(-9) }),
  brand(2, 'Birch Bars', { status: 'sent', category: 'National CPG', next_due_at: day(3) }),
  brand(3, 'Cedar Cola', { status: 'claimed', owner_user_id: JACK, owner_hint: 'jack', next_due_at: day(-1), heat: 30, heat_band: 'hot' }),
  brand(4, 'Dune Pods', { segment: 'podcast', owner_hint: 'pete', next_due_at: day(20) }),
  brand(5, 'Elm Press', { segment: 'press', status: 'drafted', owner_user_id: PETE, heat: 12, heat_band: 'warm', targeted_at: day(-1) }),
  brand(6, 'Fern Foods', { status: 'sponsor', relationship: 'sponsor', next_due_at: day(-5) }),
  brand(7, 'Gale Gym', { relationship: 'do_not_contact', owner_unclear: true, is_local: true, city: 'Chicago' }),
  brand(8, 'Hazel Health', { status: 'passed', owner_user_id: JACK, next_due_at: day(-3) }),
  brand(9, 'Iris Ice', { status: 'meeting', owner_user_id: JACK, relationship: 'founding_partner', category: 'Wellness', domain_suggested: 'iris.invalid' }),
  brand(10, 'Juniper Juice', { archived_at: '2026-10-01T00:00:00Z' }),
];
const fixture = (extra = {}) => fakeSupabase({
  hk_brands: BRANDS(),
  hk_contacts: [
    { id: id(1), business_id: HK, brand_id: B(1), name: 'Ana Alder', email: 'ana@alder.invalid', is_primary: true },
    { id: id(2), business_id: HK, brand_id: B(2), name: 'Bo Birch', email: null, is_primary: true },
    { id: id(3), business_id: HK, brand_id: B(3), name: 'cy@cedar.invalid', email: 'cy@cedar.invalid', is_primary: false },
    { id: id(4), business_id: HK, brand_id: B(4), name: 'Dee Dune', email: 'dee.partner@dune.invalid', is_primary: true },
  ],
  hk_touches: [
    { id: id(11), business_id: HK, brand_id: B(1), sender_user_id: JACK, channel: 'email', kind: 'cold', state: 'sent', sent_at: day(-9), created_at: day(-9) },
    { id: id(12), business_id: HK, brand_id: B(2), sender_user_id: JACK, channel: 'email', kind: 'cold', state: 'sent', sent_at: day(-2), created_at: day(-2) },
    { id: id(13), business_id: HK, brand_id: B(3), sender_user_id: JACK, channel: 'email', kind: 'bump', state: 'drafted', drafted_at: day(-5), created_at: day(-5), lint_passed: true },
    { id: id(14), business_id: HK, brand_id: B(5), sender_user_id: PETE, channel: 'ig_dm', kind: 'dm_text', state: 'drafted', drafted_at: day(-1), created_at: day(-1), lint_passed: false },
    { id: id(15), business_id: HK, brand_id: B(2), sender_user_id: JACK, channel: 'email', kind: 'bump', state: 'drafted', drafted_at: day(-4), created_at: day(-4), lint_passed: true },
  ],
  hk_replies: [
    { id: id(21), business_id: HK, brand_id: B(2), received_at: day(-1), label: 'pricing', handled: false, snoozed_until: null },
    { id: id(22), business_id: HK, brand_id: B(3), received_at: day(-2), label: 'interested', handled: false, snoozed_until: day(2) },
    { id: id(23), business_id: HK, brand_id: B(5), received_at: day(-3), label: 'other', handled: true, snoozed_until: null },
  ],
  hk_domain_intel: [{ id: id(31), business_id: HK, domain: 'iris.invalid', intel: {} }],
  hk_sponsor_periods: [{ id: id(41), business_id: HK, brand_id: B(6), period: '2026-10' }, { id: id(42), business_id: HK, brand_id: B(6), period: '2026-11' }],
  hk_member_prefs: [], hk_events: [], hk_signals: [], hk_sync_runs: [], hk_gmail_sync_state: [],
  ...extra,
}, { now: () => NOW.getTime() });
const req = (o = {}) => reqOf({ user: JACK, ...o });
const deps = sb => ({ supabase: sb, now: () => NOW, mailbox: async () => null });
const page = async (query, { sb = fixture(), user = JACK } = {}) => call(listBrandsRoute, req({ query: { page: '1', limit: '200', ...query }, user }), deps(sb));
const names = r => r.body.rows.map(b => b.name);
const facet = (r, k) => Object.fromEntries(r.body.facets[k]);

test('no page param = today\'s response: { view, brands } only, same rows and fields as the old route', async () => {
  const sb = fixture();
  const r = await call(listBrandsRoute, req({ query: { view: 'all' } }), deps(sb));
  assert.deepEqual(Object.keys(r.body), ['view', 'brands']);
  assert.equal(r.body.brands.length, 9);
  assert.ok(r.body.brands.every(b => !('total' in b)));
  const unclaimed = await call(listBrandsRoute, req({ query: { view: 'unclaimed' } }), deps(sb));
  assert.deepEqual(unclaimed.body.brands.map(b => b.name).sort(), ['Dune Pods']);
});

test('S1 filters: each alone, OR within a bucket, AND across buckets; owner me / member / sheet / unclaimed / unclear; q', async () => {
  assert.deepEqual(names(await page({ stage: 'sent' })), ['Alder Oats', 'Birch Bars']);
  assert.deepEqual(names(await page({ stage: 'sent,claimed' })), ['Alder Oats', 'Birch Bars', 'Cedar Cola']);
  assert.deepEqual(names(await page({ stage: 'sent', category: 'National CPG', owner: 'sheet:pete' })), ['Alder Oats']);
  assert.deepEqual(names(await page({ owner: 'me' })), ['Cedar Cola', 'Hazel Health', 'Iris Ice']);
  assert.deepEqual(names(await page({ owner: PETE })), ['Elm Press']);
  assert.deepEqual(names(await page({ owner: 'unclaimed' })), ['Birch Bars', 'Fern Foods', 'Gale Gym']);
  assert.deepEqual(names(await page({ owner: 'unclear' })), ['Gale Gym']);
  assert.deepEqual(names(await page({ owner: 'all' })).length, 9, 'owner=all is no filter');
  assert.deepEqual(names(await page({ segment: 'podcast,press' })), ['Dune Pods', 'Elm Press']);
  assert.deepEqual(names(await page({ category: 'none', relationship: 'prospect' })), ['Cedar Cola', 'Dune Pods', 'Elm Press', 'Hazel Health']);
  assert.deepEqual(names(await page({ heat: 'hot,warm' })), ['Cedar Cola', 'Elm Press']);
  assert.deepEqual(names(await page({ email: 'has_contact' })), ['Alder Oats', 'Cedar Cola', 'Dune Pods']);
  assert.deepEqual(names(await page({ email: 'emailed' })), ['Alder Oats', 'Birch Bars']);
  assert.deepEqual(names(await page({ email: 'replied' })), ['Birch Bars', 'Cedar Cola', 'Elm Press']);
  assert.deepEqual(names(await page({ email: 'waiting' })), ['Alder Oats'], 'sent 9 days ago, no reply since');
  assert.deepEqual(names(await page({ research: 'yes' })), ['Iris Ice'], 'intel on the suggested domain counts');
  assert.deepEqual(names(await page({ sponsor_months: 'yes' })), ['Fern Foods']);
  assert.deepEqual(names(await page({ place: 'local' })), ['Gale Gym']);
  assert.deepEqual(names(await page({ place: 'Chicago' })), ['Gale Gym']);
  assert.deepEqual(names(await page({ q: 'bar' })), ['Birch Bars']);
});

test('S1 due: Overdue excludes closed statuses (ruling 4), Due in 7 days, Due later (ruling 3), No due date (closed past dates too)', async () => {
  assert.deepEqual(names(await page({ due: 'overdue' })), ['Alder Oats', 'Cedar Cola']);
  assert.deepEqual(names(await page({ due: 'week' })), ['Birch Bars']);
  assert.deepEqual(names(await page({ due: 'later' })), ['Dune Pods']);
  assert.deepEqual(names(await page({ due: 'none' })), ['Elm Press', 'Fern Foods', 'Gale Gym', 'Hazel Health', 'Iris Ice']);
});

test('S1 views equal the old views\' rows; Pipeline = the old Pipeline set; every built-in view is listed in facets even at 0', async () => {
  const sb = fixture();
  for (const v of ['my_open', 'unclaimed', 'overdue']) {
    const old = await call(listBrandsRoute, req({ query: { view: v } }), deps(sb));
    const now = await page({ view: v }, { sb });
    assert.deepEqual(names(now), old.body.brands.map(b => b.name).sort(), v);
  }
  const all = await call(listBrandsRoute, req({ query: { view: 'all' } }), deps(sb));
  const oldPipeline = all.body.brands.filter(b => !['candidate', 'passed', 'skipped', 'sponsor'].includes(b.status)).map(b => b.name).sort();
  assert.deepEqual(names(await page({ view: 'pipeline' }, { sb })), oldPipeline);
  assert.deepEqual(names(await page({ view: 'sponsors' }, { sb })), ['Fern Foods', 'Iris Ice']);
  assert.deepEqual(names(await page({ view: 'dnc' }, { sb })), ['Gale Gym']);
  const f = await page({ facets: '1', stage: 'meeting' }, { sb });
  assert.deepEqual(f.body.facets.view.map(([v]) => v), VIEWS);
  assert.deepEqual(facet(f, 'view'), { all: 1, pipeline: 1, my_open: 1, unclaimed: 0, overdue: 0, sponsors: 1, dnc: 0, hot: 0, targets: 0 });
});

test('S1 facets: faceted (other buckets + this value), zero values left out unless active, stage in schema order', async () => {
  const r = await page({ facets: '1', stage: 'sent', owner: 'sheet:pete' });
  assert.equal(r.body.total, 1);
  assert.deepEqual(r.body.facets.stage, [['candidate', 1], ['sent', 1]], 'stage counted with owner=sheet:pete only: Dune (candidate) + Alder (sent)');
  assert.deepEqual(facet(r, 'owner'), { unclaimed: 1, 'sheet:pete': 1 }, 'owner counted with stage=sent only');
  const none = await page({ facets: '1', stage: 'signed' });
  assert.equal(none.body.total, 0);
  assert.deepEqual(none.body.facets.stage.find(([v]) => v === 'signed'), ['signed', 0], 'an active value stays at 0');
  assert.ok(!none.body.facets.stage.some(([v, n]) => v !== 'signed' && n === 0), 'other zero values hidden');
  const all = await page({ facets: '1' });
  assert.deepEqual(all.body.facets.stage.map(([v]) => v), STATUS_ORDER.filter(s => all.body.facets.stage.some(([v]) => v === s)));
  assert.deepEqual(facet(all, 'owner'), { [JACK]: 3, 'sheet:pete': 2, unclaimed: 3, [PETE]: 1, unclear: 1 });
  assert.deepEqual(facet(all, 'due'), { overdue: 2, week: 1, later: 1, none: 5 });
  assert.deepEqual(facet(all, 'category'), { none: 6, 'National CPG': 2, Wellness: 1 });
  assert.equal(facet(all, 'place').Chicago, 1);
  assert.ok(!JSON.stringify(all.body).includes('@'), 'no address in rows or facets');
});

test('S1 sort + paging: stable across pages, no duplicates, status in schema order, blanks last both ways, limit <= 200', async () => {
  const sb = fixture();
  for (const [sort, dir] of [['name', 'asc'], ['status', 'asc'], ['next_due', 'asc'], ['next_due', 'desc'], ['heat', 'desc'], ['created', 'desc'], ['last_touch', 'desc']]) {
    const full = names(await page({ sort, dir }, { sb }));
    const seen = [];
    for (let p = 1; p; ) { const r = await call(listBrandsRoute, req({ query: { page: String(p), limit: '2', sort, dir } }), deps(sb)); seen.push(...names(r)); assert.equal(r.body.total, 9); p = r.body.next_page; }
    assert.deepEqual(seen, full, `${sort} ${dir}`);
  }
  const st = (await page({ sort: 'status' }, { sb })).body.rows.map(b => STATUS_ORDER.indexOf(b.status));
  assert.deepEqual(st, [...st].sort((a, b) => a - b));
  for (const dir of ['asc', 'desc']) { const due = (await page({ sort: 'next_due', dir }, { sb })).body.rows.map(b => b.next_due_at); assert.ok(due.indexOf(null) > 0 && due.slice(due.indexOf(null)).every(x => x === null), dir); }
  assert.equal((await page({ limit: '201' }, { sb })).code, 400);
  assert.equal((await page({ page: '0' }, { sb })).code, 400);
});

test('S1 refuses unknown views, buckets values and sorts (never silently ignores); no address in a filter value', async () => {
  for (const q of [{ view: 'nope' }, { stage: 'done' }, { owner: 'pete' }, { email: 'bounced' }, { sort: 'size' }, { dir: 'up' }, { category: 'a@b.invalid' }]) {
    const r = await page(q); assert.equal(r.code, 400, JSON.stringify(q));
  }
  assert.throws(() => parseFilters({ due: 'soon' }), /unknown due value/);
});

test('S1 at scale: 450 brands, page of 200 - primary contacts come through selectIn (in() <= 100 ids), every table paged', async () => {
  const many = Array.from({ length: 450 }, (_, i) => brand(200 + i, `Zz ${String(i).padStart(3, '0')}`, { id: id(5000 + i) }));
  const sb = fixture({ hk_brands: many, hk_contacts: many.map((b, i) => ({ id: id(9000 + i), business_id: HK, brand_id: b.id, name: `P ${i}`, email: null, is_primary: true })) });
  const ins = []; const from = sb.from;
  sb.from = t => { const q = from(t); const oin = q.in; q.in = (k, v) => { ins.push(v.length); return oin(k, v); }; return q; };
  const r = await call(listBrandsRoute, req({ query: { page: '2', limit: '200', facets: '1' } }), deps(sb));
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 200));
  assert.deepEqual([r.body.total, r.body.rows.length, r.body.next_page], [450, 200, 3]);
  assert.ok(r.body.rows.every(b => b.primary_contact_name === `P ${Number(b.name.slice(3))}`));
  assert.ok(ins.length > 0 && ins.every(n => n <= IN_CHUNK), `in() sizes ${ins}`);
});

test('S2 search: brands / people / replies, top 5; a person by name or (server-side only) by address part; never an address or phone', async () => {
  const sb = fixture();
  const s = q => call(searchRoute, req({ query: { q } }), deps(sb));
  const a = await s('alder');
  assert.deepEqual(a.body.brands.map(b => b.name), ['Alder Oats']);
  assert.deepEqual(a.body.people, [{ contact_id: id(1), name: 'Ana Alder', brand_id: B(1), brand_name: 'Alder Oats' }]);
  const part = await s('partner');
  assert.deepEqual(part.body.people.map(p => p.name), ['Dee Dune'], 'matched on the address, returned by name');
  const cedar = await s('cedar');
  assert.deepEqual(cedar.body.people, [], 'a contact whose name is an address is never returned');
  assert.deepEqual(cedar.body.replies.map(r => [r.brand_name, r.label]), [['Cedar Cola', 'interested']]);
  assert.deepEqual((await s('pricing')).body.replies.map(r => r.brand_name), ['Birch Bars']);
  for (const q of ['alder', 'partner', 'cedar', 'pricing', 'dune', 'oats']) assert.ok(!JSON.stringify((await s(q)).body).includes('@'), q);
  assert.equal((await s('a')).code, 400);
  assert.equal((await s('ana@alder.invalid')).code, 400, 'an address is never sent as a query');
  const gate = makeHkGate(async () => ({ hk_sales: true }));
  const out = { next: false }; await gate(req({ query: { q: 'alder' }, role: 'viewer' }), { status() { return this; }, json() { return this; } }, () => { out.next = true; });
  assert.equal(out.next, true, 'viewers may search (GET)');
});

const VIEW = (over = {}) => ({ id: 'sent-unclaimed', name: 'Sent, unclaimed', space: 'brands', view: 'all', filters: { stage: ['sent'], owner: ['unclaimed', 'sheet:pete'] }, sort: { by: 'next_due', dir: 'asc' }, layout: 'stage', ...over });

test('S3 saved views + rail: validated, stored per member, GET returns them; PUT = PATCH; deleting is a preference change', async () => {
  const sb = fixture();
  const put = body => call(patchPrefsRoute, req({ method: 'PUT', body }), deps(sb));
  const ok = await put({ saved_views: [VIEW(), { id: 'needs', name: 'Needs you', space: 'inbox', filters: { lane: ['needs_you'] } }], rail: { narrow: true, collapsed: { brands: ['category', 'place'] } } });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  const got = await call(getPrefsRoute, req(), deps(sb));
  assert.deepEqual(got.body.prefs.saved_views[0], VIEW());
  assert.deepEqual(got.body.prefs.rail, { narrow: true, collapsed: { brands: ['category', 'place'] } });
  assert.equal((await call(getPrefsRoute, req({ user: PETE }), deps(sb))).body.prefs.saved_views.length, 0, 'each member their own');
  assert.equal((await put({ saved_views: [] })).code, 200);
  assert.deepEqual((await call(getPrefsRoute, req(), deps(sb))).body.prefs.saved_views, []);
  const bad = [
    { saved_views: Array.from({ length: SAVED_VIEWS_MAX + 1 }, (_, i) => VIEW({ id: `v${i}` })) },
    { saved_views: [VIEW({ name: 'x'.repeat(41) })] }, { saved_views: [VIEW({ name: 'me@x.invalid' })] },
    { saved_views: [VIEW({ filters: { color: ['red'] } })] }, { saved_views: [VIEW({ filters: { stage: ['done'] } })] },
    { saved_views: [VIEW(), VIEW()] }, { saved_views: [VIEW({ space: 'reports' })] }, { saved_views: [VIEW({ extra: 1 })] },
    { saved_views: [{ id: 'i', name: 'I', space: 'inbox', filters: { lane: ['spam'] } }] },
    { saved_views: [{ id: 't', name: 'T', space: 'today', filters: { lane: ['needs_you'] } }] },
    { rail: { collapsed: { brands: ['nope'] } } }, { rail: { wide: true } }, { saved_views: 'all' },
  ];
  for (const body of bad) assert.equal((await put(body)).code, 400, JSON.stringify(body).slice(0, 80));
  const gate = makeHkGate(async () => ({ hk_sales: true }));
  const out = { code: 0, next: false };
  await gate(req({ method: 'PUT', role: 'viewer' }), { status(c) { out.code = c; return this; }, json() { return this; } }, () => { out.next = true; });
  assert.deepEqual([out.code, out.next], [403, false], 'a viewer\'s PUT is refused at the gate');
});

test('S4 /gmail/status: owner=me counts MY queued drafts (sender - ruling 1) and OPEN replies on my brands; no owner = workspace-wide', async () => {
  const sb = fixture();
  const st = query => call(gmailStatusRoute, req({ query }), deps(sb));
  assert.deepEqual((await st({})).body.badges, { drafts: 3, replies: 2, tracked: 0 });
  assert.deepEqual((await st({ owner: 'me' })).body.badges, { drafts: 2, replies: 0, tracked: 0, owner: 'me' }, 'Cedar\'s draft + my draft on unclaimed Birch; Cedar\'s reply is snoozed');
  assert.deepEqual((await st({ owner: PETE })).body.badges, { drafts: 1, replies: 0, tracked: 0, owner: PETE });
  assert.deepEqual((await st({ owner: 'all' })).body.badges, { drafts: 3, replies: 1, tracked: 0, owner: 'all' });
  assert.equal((await st({ owner: 'pete' })).code, 400);
});

test('S5 /replies snoozed=hide|only; /drafts owner + kind + lint + older_than; no params = as before', async () => {
  const sb = fixture();
  const rep = query => call(listRepliesRoute, req({ query: { owner: 'all', handled: 'false', ...query } }), deps(sb));
  assert.deepEqual((await rep({})).body.replies.map(r => r.brand_name), ['Birch Bars', 'Cedar Cola']);
  assert.deepEqual((await rep({ snoozed: 'hide' })).body.replies.map(r => r.brand_name), ['Birch Bars']);
  assert.deepEqual((await rep({ snoozed: 'only' })).body.replies.map(r => r.brand_name), ['Cedar Cola']);
  assert.equal((await rep({ snoozed: 'later' })).code, 400);
  const dr = query => call(listDraftsRoute, req({ query }), deps(sb));
  assert.deepEqual((await dr({})).body.drafts.map(d => d.brand_name), ['Elm Press', 'Birch Bars', 'Cedar Cola']);
  assert.deepEqual((await dr({ owner: 'me' })).body.drafts.map(d => d.brand_name), ['Birch Bars', 'Cedar Cola'], 'a draft by Jack on an UNCLAIMED brand is Jack\'s (ruling 1), not All-only');
  assert.deepEqual((await dr({ owner: PETE })).body.drafts.map(d => d.brand_name), ['Elm Press']);
  assert.deepEqual((await dr({ kind: 'ig_dm' })).body.drafts.map(d => d.brand_name), ['Elm Press']);
  assert.deepEqual((await dr({ lint: 'failed' })).body.drafts.map(d => d.brand_name), ['Elm Press']);
  assert.deepEqual((await dr({ older_than: '3' })).body.drafts.map(d => d.brand_name), ['Birch Bars', 'Cedar Cola']);
  assert.equal((await dr({ older_than: 'x' })).code, 400);
  assert.equal((await dr({ kind: 'sms' })).code, 400);
});

test('applyFilters is pure: the same data and args give the same page twice', () => {
  const data = { brands: BRANDS().slice(0, 9), hasEmail: new Set(), touches: {}, replies: {}, intel: new Set(), months: new Set() };
  const args = { filters: { stage: ['sent', 'candidate'] }, sort: 'name', page: 1, limit: 3, facets: true, meId: JACK, now: NOW };
  assert.deepEqual(applyFilters(data, args), applyFilters(data, args));
});
