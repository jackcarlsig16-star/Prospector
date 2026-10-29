// node --test api/hk/listQueries.test.mjs
// FIX hkos-brands-list-500 - no Grow list route sends an unbounded id list in ONE PostgREST in() filter, and none
// swallows a failed read. A strict in-memory Supabase plays PostgREST: an in() over 100 values answers 400 "Bad Request"
// (the URL-length failure that took Grow › Brands down at 952 brands) and an unranged read returns at most 1,000 rows
// (max-rows). Invented brands on .invalid; 0 network, 0 DB, 0 Claude, 0 Gmail.
import test from 'node:test';
import assert from 'node:assert/strict';
const { seed, reqOf, resOf, HK, JACK } = await import('./testing.mjs');
const { selectIn, chunks, IN_CHUNK } = await import('./hkShared.js');
const { listBrandsRoute } = await import('./brandsRoutes.js');
const { sponsorsRoute } = await import('./opsRoutes.js');
const { listDraftsRoute, listRepliesRoute } = await import('./gmailRoutes.js');

// Wraps the shared fake: records every in() (table, column, size), refuses any over the cap (or every in() on failTable),
// and caps unranged selects at 1,000 rows.
function strict(sb, { failTable = null } = {}) {
  const ins = [];
  const from = sb.from;
  sb.from = table => {
    const b = from(table);
    let bad = false, ranged = false;
    const oin = b.in, orange = b.range, othen = b.then;
    b.in = (k, v) => { ins.push({ table, column: k, size: v.length }); if (v.length > IN_CHUNK || table === failTable) bad = true; return oin(k, v); };
    b.range = (a, z) => { ranged = true; return orange(a, z); };
    b.then = (res, rej) => (bad
      ? Promise.resolve({ data: null, error: { message: 'Bad Request' } }).then(res, rej)
      : othen(r => res(Array.isArray(r?.data) && !ranged ? { ...r, data: r.data.slice(0, 1000) } : r), rej));
    return b;
  };
  return ins;
}
const brand = (i, over = {}) => ({ id: `b-${String(i).padStart(5, '0')}`, business_id: HK, name: `Zz Brand ${i}`, normalized_name: `zz brand ${i}`, aliases: [], segment: 'sponsor_brand', is_local: false, status: 'candidate', relationship: 'prospect', source: 'import', created_at: `2026-10-27T00:${String(i % 60).padStart(2, '0')}:00Z`, ...over });
const call = async (route, req, deps) => { const res = resOf(); await route(req, res, deps); return res; };
const quiet = async fn => { const orig = console.error; const logged = []; console.error = (...a) => logged.push(a.join(' ')); try { return { out: await fn(), logged }; } finally { console.error = orig; } };

test('F1: /brands with 1,500 brands and 1,800 contacts answers 200 with every primary contact right, and sends no in() at all', async () => {
  const brands = Array.from({ length: 1500 }, (_, i) => brand(i));
  const contacts = [
    ...brands.map((b, i) => ({ id: `c-${String(i).padStart(5, '0')}`, business_id: HK, brand_id: b.id, name: `Primary ${i}`, is_primary: true })),
    ...brands.slice(0, 300).map((b, i) => ({ id: `d-${String(i).padStart(5, '0')}`, business_id: HK, brand_id: b.id, name: `Other ${i}`, is_primary: false })),
  ];
  const sb = seed({ hk_brands: brands, hk_contacts: contacts });
  const ins = strict(sb);
  const r = await call(listBrandsRoute, reqOf({ query: { view: 'all' } }), { supabase: sb });
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 200));
  assert.equal(r.body.brands.length, 1500);
  assert.ok(r.body.brands.every(b => b.primary_contact_name === `Primary ${Number(b.id.slice(2))}`), 'each brand its own primary, none from the non-primary rows');
  assert.deepEqual(ins, [], 'primaryNames reads the workspace in pages - no id list in the URL');
  assert.ok(!JSON.stringify(r.body).includes('@'));
  const mine = await call(listBrandsRoute, reqOf({ query: { owner: 'me' } }), { supabase: sb });
  assert.equal(mine.code, 200); assert.equal(mine.body.brands.length, 0);
});

test('F2: selectIn splits 250 ids into 100 + 100 + 50, de-duplicates, keeps the chunk order, pages past 1,000 rows', async () => {
  assert.equal(IN_CHUNK, 100);
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  const rows = Array.from({ length: 250 }, (_, i) => ({ id: `t-${String(i).padStart(4, '0')}`, business_id: HK, n: i }));
  const many = Array.from({ length: 2500 }, (_, i) => ({ id: `m-${String(i).padStart(5, '0')}`, business_id: HK, t_id: rows[i % 3].id }));
  const sb = seed({ hk_touches: rows, hk_marks: many });
  const ins = strict(sb);
  const ids = [...rows.map(r => r.id), rows[0].id, rows[1].id];
  const got = await selectIn(() => sb.from('hk_touches').select('id, n').order('id'), 'id', ids);
  assert.deepEqual(ins.map(i => i.size), [100, 100, 50]);
  assert.deepEqual(got.map(g => g.n), rows.map(r => r.n), 'every row once, in chunk order');
  const big = await selectIn(() => sb.from('hk_marks').select('id').order('id'), 't_id', rows.slice(0, 3).map(r => r.id));
  assert.equal(big.length, 2500, 'a chunk with more than 1,000 rows is paged, not truncated');
  assert.deepEqual(await selectIn(() => sb.from('hk_touches').select('id').order('id'), 'id', []), [], 'no ids, no query');
});

test('F2: /sponsors with 150 sponsor brands reads periods and DNC marks in chunks; periods stay sorted by period; a failed chunk is a 500, never an empty list', async () => {
  const sponsors = Array.from({ length: 150 }, (_, i) => brand(i, { relationship: 'sponsor', status: 'sponsor' }));
  const dnc = Array.from({ length: 120 }, (_, i) => brand(1000 + i, { relationship: 'do_not_contact' }));
  const periods = sponsors.flatMap((b, i) => [{ id: `p-${i}-b`, business_id: HK, brand_id: b.id, period: `2026-${String((i % 9) + 3).padStart(2, '0')}`, kind: 'challenge' }, { id: `p-${i}-a`, business_id: HK, brand_id: b.id, period: `2026-${String((i % 9) + 1).padStart(2, '0')}`, kind: 'challenge' }]);
  const events = dnc.map((b, i) => ({ id: `e-${i}`, business_id: HK, entity_id: b.id, action: 'brand.relationship', actor_user_id: JACK, created_at: `2026-10-2${i % 9}T00:00:00Z` }));
  const sb = seed({ hk_brands: [...sponsors, ...dnc], hk_sponsor_periods: periods, hk_events: events });
  const ins = strict(sb);
  const r = await call(sponsorsRoute, reqOf(), { supabase: sb });
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 200));
  assert.equal(r.body.sponsors.length, 150); assert.equal(r.body.dnc.length, 120);
  assert.ok(r.body.sponsors.every(s => s.periods.length === 2 && s.periods[0].period < s.periods[1].period), 'each brand\'s periods in period order');
  assert.ok(r.body.dnc.every(d => d.marked_by === JACK));
  assert.deepEqual(ins.filter(i => i.table === 'hk_sponsor_periods').map(i => i.size), [100, 50]);
  assert.deepEqual(ins.filter(i => i.table === 'hk_events').map(i => i.size), [100, 20]);
  for (const failTable of ['hk_sponsor_periods', 'hk_events']) {
    const sb2 = seed({ hk_brands: [...sponsors, ...dnc], hk_sponsor_periods: periods, hk_events: events });
    strict(sb2, { failTable });
    const { out, logged } = await quiet(() => call(sponsorsRoute, reqOf(), { supabase: sb2 }));
    assert.equal(out.code, 500, `${failTable} failure surfaces`); assert.ok(logged.some(l => /Bad Request/.test(l)), 'and is logged');
  }
});

test('F2: /drafts contacts and /replies touches go in chunks, and a failed chunk is a 500 with the error logged', async () => {
  const brands = Array.from({ length: 5 }, (_, i) => brand(i));
  const contacts = Array.from({ length: 130 }, (_, i) => ({ id: `c-${String(i).padStart(4, '0')}`, business_id: HK, brand_id: brands[i % 5].id, name: `Contact ${i}`, is_primary: false }));
  const drafted = contacts.map((c, i) => ({ id: `t-${String(i).padStart(4, '0')}`, business_id: HK, brand_id: c.brand_id, contact_id: c.id, sender_user_id: JACK, channel: 'email', kind: 'cold', state: 'drafted', drafted_at: '2026-10-26T00:00:00Z', created_by: 'system' }));
  const sent = Array.from({ length: 130 }, (_, i) => ({ id: `s-${String(i).padStart(4, '0')}`, business_id: HK, brand_id: brands[i % 5].id, sender_user_id: JACK, channel: 'email', kind: 'cold', state: 'sent', subject: `Hi ${i}`, created_by: 'system' }));
  const replies = sent.map((t, i) => ({ id: `r-${String(i).padStart(4, '0')}`, business_id: HK, brand_id: t.brand_id, touch_id: t.id, label: 'interested', handled: false, received_at: `2026-10-26T00:${String(i % 60).padStart(2, '0')}:00Z` }));
  const fresh = (failTable = null) => { const sb = seed({ hk_brands: brands, hk_contacts: contacts, hk_touches: [...drafted, ...sent], hk_replies: replies }); return { sb, ins: strict(sb, { failTable }) }; };
  const deps = sb => ({ supabase: sb, mailbox: async () => null, now: () => new Date('2026-10-28T00:00:00Z') });
  let { sb, ins } = fresh();
  const d = await call(listDraftsRoute, reqOf(), deps(sb));
  assert.equal(d.code, 200, JSON.stringify(d.body).slice(0, 200));
  assert.equal(d.body.drafts.length, 130); assert.ok(d.body.drafts.every(x => /^Contact \d+$/.test(x.contact_name)));
  assert.deepEqual(ins.filter(i => i.table === 'hk_contacts').map(i => i.size), [100, 30]);
  ({ sb, ins } = fresh());
  const r = await call(listRepliesRoute, reqOf({ query: { handled: 'false' } }), deps(sb));
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 200));
  assert.equal(r.body.replies.length, 130); assert.ok(r.body.replies.every(x => x.touch_kind === 'cold'));
  assert.deepEqual(ins.filter(i => i.table === 'hk_touches' && i.column === 'id').map(i => i.size), [100, 30]);
  for (const [route, table] of [[listDraftsRoute, 'hk_contacts'], [listRepliesRoute, 'hk_touches']]) {
    ({ sb } = fresh(table));
    const { out, logged } = await quiet(() => call(route, reqOf(), deps(sb)));
    assert.equal(out.code, 500, `${table} failure surfaces`); assert.ok(logged.some(l => /Bad Request/.test(l)));
  }
});
