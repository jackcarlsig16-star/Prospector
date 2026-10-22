// node --test api/sales/visitReport.test.mjs  (react-scripts' Jest only runs src/)
// signals-v1 Stage 5 - the Website visitors report, Brad's .xlsx and the skip
// list, against the in-memory Supabase with invented companies. No emails,
// phone numbers or people in the fixtures. 0 network, 0 Apollo, 0 Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { visitReport, visitExport, nameScrubber, addSkip, removeSkip, listSkip, EXPORT_COLUMNS } from './visitReport.js';
import { hasPii } from './scrubText.js';
import { normName } from './intakeMatch.js';
import { salesGate } from '../lib/requireAuth.js';

const NOW = Date.parse('2026-10-20T17:00:00Z'); // Tue Oct 20, 10:00 LA
const B = randomUUID(), OTHER = randomUUID(), U = randomUUID();
const P = { harbor: randomUUID() }, O = { brightmill: randomUUID() }, T = { quarry: randomUUID() };
const visit = (name, day, extra = {}) => ({
  id: randomUUID(), business_id: B, company_key: normName(name), company_name: name, domain: `${name.toLowerCase().replace(/[^a-z]/g, '')}.example`,
  us_500: false, first_visit: day, last_visit: day, visits_7d: 1, unique_visitors_7d: 1, top_paths: [{ path: '/', visits: 1 }],
  priority: 'P3', priority_rule: 'Size unknown - watch', noise_reason: null, maybe_user: false, matched_type: null, matched_id: null, pulled_on: day, ...extra,
});
const seed = (extra = {}) => ({
  web_visits: [
    visit('Harbor Lane', '2026-10-19', { first_visit: '2026-10-14', priority: 'P1', priority_rule: 'Matched partner visited', matched_type: 'partner', matched_id: P.harbor, visits_7d: 2 }),
    visit('Harbor Lane', '2026-10-20', { first_visit: '2026-10-16', last_visit: '2026-10-20', priority: 'P1', priority_rule: 'Matched partner visited', matched_type: 'partner', matched_id: P.harbor, visits_7d: 3, unique_visitors_7d: 2 }),
    visit('Brightmill Foods', '2026-10-20', { priority: 'P1', priority_rule: 'Matched employer visited', matched_type: 'opportunity', matched_id: O.brightmill }),
    visit('Quarry Labs', '2026-10-20', { priority: 'P1', priority_rule: 'Upside-owned target visited', matched_type: 'target', matched_id: T.quarry }),
    visit('Nimbus Freight', '2026-10-20', { us_500: true, priority: 'P2', priority_rule: 'US 500+ with 2+ visits in 7 days or 2+ unique visitors (Apollo)', visits_7d: 2, top_paths: [{ path: '/for-employees', visits: 2 }] }),
    visit('Sizeless Co', '2026-10-20', { visits_7d: 6 }),
    visit('Portal User Inc', '2026-10-20', { priority: 'P4', priority_rule: 'Only /auth, /help, /privacy or /terms - may already be a user', noise_reason: 'Only /auth, /help, /privacy or /terms - may already be a user', maybe_user: true, top_paths: [{ path: '/auth', visits: 1 }] }),
    visit('Vendor Co', '2026-10-20', { priority: 'P3' }),
    visit('Old Visit Co', '2026-10-12'),
    { ...visit('Harbor Lane', '2026-10-20'), business_id: OTHER, id: randomUUID() },
  ],
  sales_visit_skip: [{ id: randomUUID(), business_id: B, company_key: normName('Vendor Co'), reason: 'Vendor' }],
  sales_goals: [{ id: P.harbor, business_id: B, category: '3. Benefits brokers', owner_team: 'upside', record_id: 'HLU-0007' }],
  sales_opportunities: [{ id: O.brightmill, business_id: B, owner_team: 'homelover', record_id: 'HLU-0012' }],
  sales_targets: [{ id: T.quarry, business_id: B, kind: 'employer', owner_team: 'both', record_id: null }],
  sales_signals: [
    { id: randomUUID(), business_id: B, source: 'web_visit', signal_week: '2026-10-19', company_key: normName('Harbor Lane'), status: 'accepted', created_at: '2026-10-19T17:00:00Z' },
    { id: randomUUID(), business_id: B, source: 'web_visit', signal_week: '2026-10-19', company_key: normName('Nimbus Freight'), status: 'new', created_at: '2026-10-20T17:00:00Z' },
  ],
  sales_prospect_state: [{ business_id: B, contact_id: 'c1', company: 'Nimbus Freight' }],
  sales_email_messages: [{ business_id: B, apollo_message_id: 'm1', contact_id: 'c1', sequence_id: 's1' }],
  sales_sequenced_accounts: [{ business_id: B, account_id: 'a1', name: 'Brightmill Foods', sequence_id: 's2' }],
  sales_raw_snapshots: [{ business_id: B, entity: 'sequences', captured_at: '2026-10-20T00:00:00Z', payload: [{ id: 's1', name: 'Wren - HR leaders Q4' }, { id: 's2', name: 'Employers wave 2' }] }],
  business_members: [{ business_id: B, user_id: U, name: 'Wren Example', profile: { display_name: 'Wren Example' } }],
  ...extra,
});
const byName = (r, name) => r.rows.find(x => x.company_name === name);

test('report: one row per company over 7 LA days, latest priority, merged visit dates, skip list wins', async () => {
  const r = await visitReport(fakeSupabase(seed()), B, NOW);
  assert.equal(r.since, '2026-10-14');
  assert.deepEqual(r.rows.map(x => x.company_name).sort(), ['Brightmill Foods', 'Harbor Lane', 'Nimbus Freight', 'Portal User Inc', 'Quarry Labs', 'Sizeless Co', 'Vendor Co']);
  const harbor = byName(r, 'Harbor Lane');
  assert.deepEqual([harbor.first_visit, harbor.last_visit, harbor.visits_7d, harbor.unique_visitors_apollo], ['2026-10-14', '2026-10-20', 3, 2]);
  assert.equal(harbor.type, 'Partner · Benefits brokers');
  assert.deepEqual([harbor.match.label, harbor.match.record_id, harbor.match.upside], ['Partner', 'HLU-0007', true]);
  assert.equal(harbor.next_action, 'To-do created from Signals');
  assert.equal(byName(r, 'Brightmill Foods').type, 'Employer');
  assert.equal(byName(r, 'Quarry Labs').type, 'Target (employer)');
  assert.equal(byName(r, 'Quarry Labs').match.upside, true, 'joint counts as on Brad\'s list');
  assert.equal(byName(r, 'Nimbus Freight').size, 'US 500+');
  assert.equal(byName(r, 'Nimbus Freight').next_action, 'Review in Signals (this week)');
  assert.equal(byName(r, 'Sizeless Co').size, 'size unknown');
  assert.equal(byName(r, 'Sizeless Co').priority, 'P3', 'unmatched size-unknown with 6 visits stays P3');
  const vendor = byName(r, 'Vendor Co');
  assert.deepEqual([vendor.priority, vendor.skipped, vendor.next_action], ['P4', true, 'None - On the skip list']);
  assert.equal(byName(r, 'Portal User Inc').maybe_user, true);
  assert.deepEqual(r.counts, { companies: 7, P1: 3, P2: 1, P3: 1, P4: 2, on_brads_list: 2 });
  assert.deepEqual(r.rows.slice(0, 3).map(x => x.company_name), ['Harbor Lane', 'Quarry Labs', 'Brightmill Foods'], 'P1 first, Upside-owned/joint first within it');
});

test('Source = sequences the company is in, from synced data, with member names scrubbed', async () => {
  const r = await visitReport(fakeSupabase(seed()), B, NOW);
  assert.deepEqual(byName(r, 'Nimbus Freight').sources, ['HR leaders Q4']);
  assert.deepEqual(byName(r, 'Brightmill Foods').sources, ['Employers wave 2']);
  assert.deepEqual(byName(r, 'Sizeless Co').sources, []);
  const scrub = nameScrubber(['Wren Example']);
  assert.equal(scrub('Employers (Wren)'), 'Employers');
  assert.equal(scrub('Wrenfield launch'), 'Wrenfield launch', 'whole words only');
});

test('export: P4 left out by default, Upside first, labeled Apollo uniques, no "@" or phone shapes', async () => {
  const r = await visitExport(fakeSupabase(seed()), B, { now: NOW });
  assert.equal(r.status, 200);
  assert.equal(r.filename, 'website-visitors-2026-10-20.xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.buf);
  const ws = wb.getWorksheet('Website visitors');
  const header = ws.getRow(1).values.slice(1);
  assert.deepEqual(header, EXPORT_COLUMNS.map(c => c.header));
  assert.ok(header.includes('Unique visitors (Apollo)'));
  const companies = [];
  ws.eachRow((row, n) => { if (n > 1 && /^P\d$/.test(row.getCell(1).value)) companies.push(row.getCell(2).value); });
  assert.deepEqual(companies.slice(0, 2), ['Harbor Lane', 'Quarry Labs'], 'Upside-owned and joint first');
  assert.ok(!companies.includes('Vendor Co') && !companies.includes('Portal User Inc'), 'P4 excluded');
  assert.equal(companies.length, 5);
  const cells = [];
  ws.eachRow(row => row.eachCell(c => cells.push(String(c.value))));
  assert.equal(cells.filter(hasPii).length, 0);
  assert.ok(!cells.some(c => /Wren/.test(c)), 'no member names');
  const all = await visitExport(fakeSupabase(seed()), B, { all: true, now: NOW });
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(all.buf);
  let n = 0;
  wb2.getWorksheet('Website visitors').eachRow((row, i) => { if (i > 1 && /^P\d$/.test(row.getCell(1).value)) n++; });
  assert.equal(n, 7, 'all=true keeps P4');
});

test('export refused whole when any cell looks like an email or phone', async () => {
  const s = seed();
  s.web_visits[5].company_name = 'Sizeless Co at x@y.example';
  assert.deepEqual(await visitExport(fakeSupabase(s), B, { now: NOW }), { status: 422, error: 'Export refused: a cell looks like an email address or phone number' });
  const s2 = seed();
  s2.web_visits[5].top_paths = [{ path: '/call-555-201-3344', visits: 1 }];
  assert.equal((await visitExport(fakeSupabase(s2), B, { now: NOW })).status, 422);
});

test('Viewer can view and export (GET); skip-list writes need Member', () => {
  process.env.SALES_ANALYTICS_BUSINESS_IDS = B;
  const run = method => {
    const out = { code: 200, next: false };
    const res = { status(c) { out.code = c; return { json() {} }; } };
    salesGate({ method, params: { businessId: B }, auth: { isPlatformOwner: false, roles: new Map([[B, 'viewer']]) } }, res, () => { out.next = true; });
    return out;
  };
  assert.deepEqual(run('GET'), { code: 200, next: true });
  assert.deepEqual(run('POST'), { code: 403, next: false });
  assert.deepEqual(run('DELETE'), { code: 403, next: false });
});

test('skip list: add by name or key ("Not a fit"), duplicate 409, PII refused, remove, other workspace untouched', async () => {
  const sb = fakeSupabase(seed(), { unique: { sales_visit_skip: r => `${r.business_id}|${r.company_key}` } });
  const a = await addSkip(sb, { businessId: B, userId: U, body: { name: 'Sizeless Co.', reason: 'Vendor' } });
  assert.equal(a.status, 201);
  assert.equal(a.body.company_key, normName('Sizeless Co'));
  assert.equal((await addSkip(sb, { businessId: B, userId: U, body: { company_key: normName('Sizeless Co'), reason: 'Not a fit' } })).status, 409);
  const fit = await addSkip(sb, { businessId: B, userId: U, body: { company_key: normName('Nimbus Freight'), reason: 'Not a fit' } });
  assert.equal(fit.status, 201);
  assert.equal(byName(await visitReport(sb, B, NOW), 'Nimbus Freight').priority, 'P4', 'shows as P4 at once');
  assert.equal((await addSkip(sb, { businessId: B, userId: U, body: { name: 'x@y.example' } })).status, 400);
  assert.equal((await addSkip(sb, { businessId: B, userId: U, body: { name: 'Acme', reason: 'call 555 201 3344' } })).status, 400);
  assert.equal((await addSkip(sb, { businessId: B, userId: U, body: {} })).status, 400);
  assert.equal((await removeSkip(sb, OTHER, fit.body.id)).status, 404, 'another workspace cannot remove it');
  assert.equal((await removeSkip(sb, B, 'not-a-uuid')).status, 404);
  assert.equal((await removeSkip(sb, B, fit.body.id)).status, 200);
  assert.equal(byName(await visitReport(sb, B, NOW), 'Nimbus Freight').priority, 'P2', 'back to its stored priority');
  assert.deepEqual((await listSkip(sb, B)).map(s => s.company_key), [normName('Sizeless Co'), normName('Vendor Co')].sort());
});
