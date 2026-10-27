// node --test api/hk/importRoutes.test.mjs
// hkos-sheet-import-v1 Stage 2 - preview / commit / undo / list on the in-memory Supabase with the INVENTED workbook
// (testing.mjs inventedWorkbook; the real tracker is never opened). Proves: a preview writes only the run row; a commit
// creates exactly the plan and records every id; undo removes exactly those and refuses after a later edit; no response
// carries an address (the plan on the run row and hk_contacts.email are the only places one lives); warnings populated.
// 0 network, 0 DB, 0 Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, reqOf, call, hasAt, inventedWorkbook, HK, JACK, PETE, NOW } from './testing.mjs';
import { previewImportRoute, commitImportRoute, undoImportRoute, listImportsRoute, assignOwnerHint, hintOf, IMPORT_MAX_BYTES } from './importRoutes.js';
import { patchBrandRoute, getBrandRoute } from './brandsRoutes.js';

const members = [{ user_id: JACK, business_id: HK, name: 'Jack Carlson', role: 'owner', created_at: '2026-09-01T00:00:00Z' }, { user_id: null, business_id: HK, name: 'Pete Invited', role: 'member', created_at: '2026-09-02T00:00:00Z' }];
const fresh = () => seed({ business_members: members, hk_import_runs: [], hk_settings: [{ business_id: HK, bump_after_days: 5, final_after_days: 14 }] });
const XLSX = await (await inventedWorkbook()).xlsx.writeBuffer();
const file = { name: 'Zz Tracker.xlsx', data: Buffer.from(XLSX).toString('base64') };
const TABLES = ['hk_brands', 'hk_contacts', 'hk_touches', 'hk_sponsor_periods', 'hk_events', 'hk_import_runs', 'hk_duplicate_decisions', 'hk_settings', 'hk_member_prefs'];
const counts = sb => Object.fromEntries(TABLES.map(t => [t, (sb.db[t] || []).length]));
let clock = NOW.getTime();
const now = () => new Date(clock);
const owner = o => reqOf({ role: 'owner', ...o }), member = o => reqOf({ ...o });
const preview = (sb, f = file, req = member) => call(previewImportRoute, req({ method: 'POST', body: f }), { supabase: sb, now });
const commit = (sb, id, req = owner) => call(commitImportRoute, req({ method: 'POST', params: { id } }), { supabase: sb, now });
const undo = (sb, id, req = owner) => call(undoImportRoute, req({ method: 'POST', params: { id } }), { supabase: sb, now });
const list = sb => call(listImportsRoute, member(), { supabase: sb, now });

test('preview: 201, writes ONLY the run row (status preview, plan server-side), the response shows contact presence and never an address, warnings populated', async () => {
  const sb = fresh(), before = counts(sb);
  const res = await preview(sb);
  assert.equal(res.code, 201, JSON.stringify(res.body));
  const after = counts(sb);
  assert.deepEqual(after, { ...before, hk_import_runs: before.hk_import_runs + 1 }, 'only hk_import_runs grew');
  const run = sb.db.hk_import_runs[0];
  assert.equal(run.status, 'preview'); assert.equal(run.started_by, JACK); assert.equal(run.source, 'Zz Tracker.xlsx');
  assert.ok(JSON.stringify(run.plan).includes('@'), 'the plan on the run row holds the addresses (server-only)');
  assert.ok(!hasAt(res.body), 'the response never carries an address');
  assert.ok(!('plan' in res.body.run) && !('undo_set' in res.body.run));
  const p = res.body.preview;
  assert.deepEqual(Object.keys(p).sort(), ['brands', 'duplicates', 'tabs', 'totals', 'warnings']);
  assert.equal(p.totals.rows_read, run.rows_read);
  assert.equal(p.brands.length, p.totals.brands);
  const juice = p.brands.find(b => b.name === 'Zz Northwind Juice');
  assert.deepEqual([juice.contact_count, juice.has_email, juice.status, juice.owner_hint, juice.result], [2, true, 'bumped', 'pete', 'possible_duplicate'], 'Zz Northwind is also planned');
  assert.ok(!('contacts' in juice), 'previewRow strips contacts');
  const codes = new Set([...p.brands.flatMap(b => b.warnings.map(w => w.code)), ...p.warnings.map(w => w.code)]);
  for (const c of ['draft_not_linked', 'unmapped_status', 'future_date', 'owner_missing', 'two_founders']) assert.ok(codes.has(c), `warning ${c}`);
  assert.ok(p.brands.some(b => b.result === 'new') && p.brands.some(b => b.result === 'possible_duplicate'));
  assert.equal(res.body.run.can_undo, false);
});

test('preview refuses a wrong extension, an empty body, an oversized file, and a workbook with no tracker tab', async () => {
  const sb = fresh();
  assert.equal((await preview(sb, { name: 'notes.txt', data: file.data })).code, 400);
  assert.equal((await preview(sb, { name: 'x.xlsx' })).code, 400);
  assert.equal((await preview(sb, { name: 'big.xlsx', data: Buffer.alloc(IMPORT_MAX_BYTES + 10).toString('base64') })).code, 413);
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('Random').addRow(['a']);
  const r = await preview(sb, { name: 'r.xlsx', data: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64') });
  assert.equal(r.code, 400); assert.match(r.body.error, /no tab/);
  assert.equal(sb.db.hk_import_runs.length, 0, 'a refused preview writes nothing');
});

test('a .csv is one tab named after the file: "Sheet8.csv" reads with the Sheet8 rules', async () => {
  const sb = fresh();
  const csv = 'Business Name,Website\nZz Pine Supply,pinesupply.invalid\nHarbor Yoga,harbor.invalid\n';
  const res = await preview(sb, { name: 'Sheet8.csv', data: Buffer.from(csv).toString('base64') });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.deepEqual(res.body.preview.tabs.map(t => [t.name, t.kind, t.rows]), [['Sheet8', 'sheet8', 2]]);
  assert.deepEqual(res.body.preview.brands.map(b => [b.name, b.result]), [['Zz Pine Supply', 'new'], ['Harbor Yoga', 'matches']]);
});

test('commit: member 403; owner writes exactly the plan (brands, contacts with the addresses, touches with a sender, periods, one brand.created each + import.committed), records every id, wipes the plan; Pete\'s touches are deferred', async () => {
  const sb = fresh();
  const { body: { run, preview: p } } = await preview(sb);
  assert.equal((await commit(sb, run.id, member)).code, 403);
  const before = counts(sb);
  const res = await commit(sb, run.id);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.ok(!hasAt(res.body));
  const c = res.body.counts, after = counts(sb);
  assert.equal(c.brands, p.totals.create); assert.equal(c.matched, p.totals.match);
  assert.equal(after.hk_brands - before.hk_brands, c.brands);
  assert.equal(after.hk_contacts - before.hk_contacts, c.contacts); assert.equal(c.contacts, p.totals.contacts - p.brands.filter(b => b.result === 'matches').reduce((n, b) => n + b.contact_count, 0));
  assert.equal(after.hk_touches - before.hk_touches, c.touches);
  assert.equal(after.hk_sponsor_periods - before.hk_sponsor_periods, c.periods);
  assert.equal(after.hk_events - before.hk_events, c.brands + 1, 'one brand.created per brand + import.committed');
  const row = sb.db.hk_import_runs[0];
  assert.equal(row.status, 'committed'); assert.equal(row.plan, null); assert.ok(row.finished_at);
  assert.deepEqual(Object.fromEntries(Object.entries(row.undo_set).map(([k, v]) => [k, v.length])), { brands: c.brands, contacts: c.contacts, touches: c.touches, periods: c.periods, events: c.brands });
  const made = sb.db.hk_brands.filter(b => b.source === 'import');
  assert.equal(made.length, c.brands);
  assert.ok(made.every(b => row.undo_set.brands.includes(b.id) && b.created_by === JACK && b.import_ref));
  const juice = made.find(b => b.name === 'Zz Northwind Juice');
  assert.deepEqual([juice.status, juice.owner_hint, juice.owner_user_id, juice.last_touch_at, juice.relationship], ['bumped', 'pete', null, '2026-09-08T17:00:00.000Z', 'prospect']);
  assert.ok(juice.notes && !juice.notes.includes('@'), 'notes were scrubbed');
  const juiceContacts = sb.db.hk_contacts.filter(x => x.brand_id === juice.id);
  assert.deepEqual(juiceContacts.map(x => [x.email, x.is_primary, x.email_source]).sort(), [['ana@northwind.invalid', true, 'import'], ['sam@northwind.invalid', false, 'import']]);
  const mills = made.find(b => b.name === 'Zz Dunmore Mills');
  assert.equal(mills.owner_user_id, JACK, "Jack's tab resolves to his id at plan time");
  assert.deepEqual(sb.db.hk_touches.filter(t => t.brand_id === mills.id).map(t => [t.kind, t.state, t.sender_user_id, t.sent_at, t.created_by]), [['cold', 'sent', JACK, '2026-10-10T17:00:00.000Z', 'system']]);
  assert.equal(sb.db.hk_touches.filter(t => t.brand_id === juice.id).length, 0, "Pete's touches wait for his profile");
  assert.equal(c.touches_deferred, row.summary.deferred_touches.length); assert.ok(c.touches_deferred >= 2); assert.equal(c.touches_unowned, 2, 'press + podcast sends have no owner column: counted, not written');
  assert.ok(!JSON.stringify(row.summary).includes('@'));
  const bakery = made.find(b => b.name === 'Zz Oak Street Bakery');
  assert.deepEqual(sb.db.hk_sponsor_periods.filter(x => x.brand_id === bakery.id).map(x => x.period).sort(), ['2026-06', '2026-09', '2027-01']);
  assert.deepEqual([bakery.relationship, bakery.status], ['sponsor', 'sponsor']);
  const events = sb.db.hk_events.filter(e => e.action === 'brand.created');
  assert.equal(events.length, c.brands); assert.ok(!hasAt(events));
  assert.equal(sb.db.hk_events.filter(e => e.action === 'import.committed').length, 1);
  assert.equal((await commit(sb, run.id)).code, 409, 'a second commit is refused');
  // The brand detail route is where the addresses show (HK members only) - unchanged by the import.
  const detail = await call(getBrandRoute, member({ params: { id: juice.id } }), { supabase: sb });
  assert.ok(hasAt(detail.body.contacts));
});

test('undo: member 403; refused after a later edit to an imported brand; then removes exactly the created rows and the counts return', async () => {
  const sb = fresh(), base = counts(sb);
  const { body: { run } } = await preview(sb);
  await commit(sb, run.id);
  const made = sb.db.hk_brands.filter(b => b.source === 'import');
  assert.equal((await undo(sb, run.id, member)).code, 403);
  clock += 60_000;
  const edited = await call(patchBrandRoute, owner({ method: 'PATCH', params: { id: made[0].id }, body: { notes: 'edited after the import' } }), { supabase: sb, now });
  assert.equal(edited.code, 200);
  const refused = await undo(sb, run.id);
  assert.equal(refused.code, 409); assert.match(refused.body.error, /changed since the import/);
  assert.equal(sb.db.hk_brands.filter(b => b.source === 'import').length, made.length, 'nothing was deleted');
  // Put the edit back (as a restore would) and undo.
  sb.db.hk_brands.find(b => b.id === made[0].id).updated_at = sb.db.hk_import_runs[0].finished_at;
  const res = await undo(sb, run.id);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.ok(!hasAt(res.body));
  const after = counts(sb);
  assert.deepEqual(after, { ...base, hk_import_runs: 1, hk_events: base.hk_events + 3 }, 'everything back; the run row and its committed / undone / edit events remain');
  assert.equal(sb.db.hk_import_runs[0].status, 'undone'); assert.ok(sb.db.hk_import_runs[0].undone_at);
  assert.deepEqual(sb.db.hk_events.map(e => e.action).sort(), ['brand.updated', 'import.committed', 'import.undone']);
  assert.equal((await undo(sb, run.id)).code, 409, 'already undone');
});

test('undo refuses when an imported brand gained a contact since, or was removed', async () => {
  const sb = fresh();
  const { body: { run } } = await preview(sb);
  await commit(sb, run.id);
  const made = sb.db.hk_brands.filter(b => b.source === 'import');
  sb.db.hk_contacts.push({ id: 'c-later', business_id: HK, brand_id: made[1].id, name: 'Later Person', created_at: '2026-10-27T00:00:00Z' });
  const r1 = await undo(sb, run.id); assert.equal(r1.code, 409); assert.match(r1.body.error, /contacts were added/);
  sb.db.hk_contacts = sb.db.hk_contacts.filter(c => c.id !== 'c-later');
  sb.db.hk_brands = sb.db.hk_brands.filter(b => b.id !== made[2].id);
  const r2 = await undo(sb, run.id); assert.equal(r2.code, 409); assert.match(r2.body.error, /removed since/);
});

test('Pete\'s first shell load: hinted brands take his id, the deferred touches are written with him as sender and join the undo set; undo then removes them too', async () => {
  const sb = fresh(), base = counts(sb);
  const { body: { run } } = await preview(sb);
  const { body: { counts: c } } = await commit(sb, run.id);
  assert.equal(hintOf('Pete Example'), 'pete'); assert.equal(hintOf('Peter'), 'pete'); assert.equal(hintOf('Jack Carlson'), 'jack'); assert.equal(hintOf('Ana'), null);
  const touchesBefore = sb.db.hk_touches.length;
  const r = await assignOwnerHint(sb, HK, PETE, 'Pete Example');
  assert.deepEqual(r, { hint: 'pete', brands: sb.db.hk_brands.filter(b => b.owner_hint === 'pete').length, touches: c.touches_deferred });
  assert.ok(r.brands >= 3);
  assert.ok(sb.db.hk_brands.filter(b => b.owner_hint === 'pete').every(b => b.owner_user_id === PETE));
  assert.equal(sb.db.hk_touches.length - touchesBefore, c.touches_deferred);
  assert.ok(sb.db.hk_touches.slice(touchesBefore).every(t => t.sender_user_id === PETE && t.created_by === 'system'));
  const row = sb.db.hk_import_runs[0];
  assert.equal(row.undo_set.touches.length, c.touches + c.touches_deferred); assert.deepEqual(row.summary.deferred_touches, []);
  assert.deepEqual(await assignOwnerHint(sb, HK, PETE, 'Pete Example'), { hint: 'pete', brands: 0, touches: 0 }, 'a second load is a no-op');
  assert.deepEqual(await assignOwnerHint(sb, HK, 'u-ana', 'Ana'), { hint: null, brands: 0, touches: 0 });
  const res = await undo(sb, run.id);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.deepEqual(counts(sb), { ...base, hk_import_runs: 1, hk_events: base.hk_events + 3 });
});

test('list: newest first, never the plan; a preview older than 24 h expires (status failed, plan wiped)', async () => {
  const sb = fresh();
  await preview(sb);
  sb.db.hk_import_runs[0].created_at = new Date(clock - 25 * 3600e3).toISOString();
  await preview(sb);
  const res = await list(sb);
  assert.equal(res.code, 200);
  assert.ok(!hasAt(res.body));
  assert.deepEqual(res.body.runs.map(r => r.status), ['preview', 'failed']);
  assert.ok(res.body.runs.every(r => !('plan' in r) && !('undo_set' in r)));
  assert.equal(res.body.runs[1].summary.reason, 'preview expired');
  assert.equal(sb.db.hk_import_runs.find(r => r.status === 'failed').plan, null);
  const stale = await commit(sb, res.body.runs[1].id);
  assert.equal(stale.code, 409); assert.match(stale.body.error, /expired/);
});
