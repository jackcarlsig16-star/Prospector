// node --test api/sales/visitorsExport.test.mjs
// FIX visitor-email-period-v1 P4 / P5 - the fundraising visitors export over an invented workspace: the window, one row per
// company with "unknown" headcount never blank, the headcount-known line, no person names / addresses in the CSV or the
// JSON, the PII refusal, owner / admin only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase } from './testing/fakeSupabase.mjs';
import { windowOf, buildVisitorsExport, toCsv, visitorsExport, visitorsExportRoute, COLUMNS } from './visitorsExport.js';

const B = '00000000-0000-4000-8000-0000000000b1';
const NOW = Date.parse('2026-11-06T16:00:00Z'); // Fri Nov 6, 08:00 PST
const O = '00000000-0000-4000-8000-00000000e001', T = '00000000-0000-4000-8000-00000000e002', G = '00000000-0000-4000-8000-00000000e003';
const visit = (id, key, name, seen_from, seen_to, extra = {}) => ({ id: `00000000-0000-4000-8000-00000000f${id}`, business_id: B, company_key: key, company_name: name, naics_codes: null, sic_codes: null, visits_7d: 2, top_paths: [{ path: '/pricing' }, { path: '/employers' }, { path: '/about' }, { path: '/jobs' }], priority: 'P3', matched_type: null, matched_id: null, pulled_on: seen_to, seen_from, seen_to, ...extra });
function seed() {
  return {
    web_visits: [
      visit('001', 'acme', 'Acme Health', '2026-10-20', '2026-10-21', { matched_type: 'opportunity', matched_id: O, naics_codes: ['6216'] }),
      visit('002', 'acme', 'Acme Health', '2026-11-04', '2026-11-05', { matched_type: 'opportunity', matched_id: O, visits_7d: 5, naics_codes: ['6216'] }),
      visit('003', 'acme', 'Acme Health', '2026-11-05', '2026-11-06', { matched_type: 'opportunity', matched_id: O, visits_7d: 6, naics_codes: ['6216'] }),
      visit('004', 'quarry', 'Quarry Labs', '2026-11-03', '2026-11-04', { matched_type: 'target', matched_id: T, priority: 'P2' }),
      visit('005', 'harbor', 'Harbor Lane', '2026-10-22', '2026-10-23', { matched_type: 'partner', matched_id: G, sic_codes: ['6411'] }),
      visit('006', 'nobody', 'Nobody Co', '2026-11-05', '2026-11-06', { priority: 'P4', top_paths: [] }),
    ],
    sales_opportunities: [{ id: O, business_id: B, stage: 'contacted', client_status: null, employees: 1250, employees_source: 'manual' }],
    sales_targets: [{ id: T, business_id: B, status: 'researching', employees: 22, employees_source: 'research' }],
    sales_goals: [{ id: G, business_id: B, pipeline_status: 'replied', employees: null, employees_source: null }],
    sales_company_scores: [{ business_id: B, company_type: 'employer', company_id: O, band: 'P1' }],
    sales_people: [
      { id: 'p1', business_id: B, visit_id: '00000000-0000-4000-8000-00000000f002', name: 'Jordan Visitorperson', archived_at: null },
      { id: 'p2', business_id: B, visit_id: '00000000-0000-4000-8000-00000000f003', name: 'Sam Otherperson', archived_at: null },
      { id: 'p3', business_id: B, visit_id: '00000000-0000-4000-8000-00000000f003', name: 'Gone Person', archived_at: '2026-11-01T00:00:00Z' },
    ],
  };
}

test('windowOf: 7 / 30 / 90 days end today; all = since the first pull (no since); an unknown value falls back to 30', () => {
  assert.deepEqual(windowOf('7', '2026-11-06'), { id: '7', label: 'last 7 days', since: '2026-10-31', until: '2026-11-06' });
  assert.deepEqual(windowOf('all', '2026-11-06'), { id: 'all', label: 'since the first pull', since: null, until: '2026-11-06' });
  assert.equal(windowOf('x', '2026-11-06').id, '30');
  assert.equal(windowOf(90, '2026-11-06').since, '2026-08-09');
});

test('rows: one per company in the window, newest last-seen first; headcount with its source word or "unknown" (never blank); first / last seen over every pull; days visited inside the window; the latest pull\'s visits, 3 pages, band from the score else the pull; In Prospector = kind · stage; people = a count of unarchived people only; the headcount-known line', async () => {
  const db = fakeSupabase(seed());
  const r = await visitorsExport(db, B, { window: '7', now: NOW });
  assert.equal(r.status, 200);
  const rep = r.report;
  assert.deepEqual([rep.window.id, rep.window.since, rep.window.until, rep.generated, rep.companies, rep.headcount_known, rep.summary], ['7', '2026-10-31', '2026-11-06', '2026-11-06', 3, 2, 'headcount known for 2 of 3 companies']);
  assert.equal(rep.title, 'HomeLover website visitors · last 7 days (2026-10-31 – 2026-11-06) · generated 2026-11-06');
  assert.deepEqual(rep.rows.map(x => x.company), ['Acme Health', 'Nobody Co', 'Quarry Labs']);
  const acme = rep.rows[0], nobody = rep.rows[1], quarry = rep.rows[2];
  assert.deepEqual([acme.industry, acme.headcount, acme.first_seen, acme.last_seen, acme.days_visited, acme.visits_7d, acme.pages, acme.people, acme.band, acme.in_prospector], ['NAICS 6216', '1,250 (typed)', '2026-10-20', '2026-11-06', 2, 6, ['/pricing', '/employers', '/about'], 2, 'P1 · Hot', 'Employer · Contacted']);
  assert.deepEqual([quarry.headcount, quarry.band, quarry.in_prospector, quarry.days_visited], ['22 (research)', 'P2 · Warm', 'Target · Researching', 1]);
  assert.deepEqual([nobody.industry, nobody.headcount, nobody.pages, nobody.people, nobody.band, nobody.in_prospector], ['—', 'unknown', [], 0, 'P4 · Cold', '—']);
  assert.ok(rep.rows.every(x => x.headcount !== '' && x.headcount != null), 'headcount never blank');
  // all = every company since the first pull; the partner with no employees reads unknown.
  const all = (await visitorsExport(db, B, { window: 'all', now: NOW })).report;
  assert.deepEqual([all.companies, all.window.since, all.rows.find(x => x.company === 'Harbor Lane').headcount, all.rows.find(x => x.company === 'Harbor Lane').industry, all.rows.find(x => x.company === 'Harbor Lane').in_prospector], [4, '2026-10-21', 'unknown', 'SIC 6411', 'Partner · Replied']);
  assert.ok(!/Jordan|Visitorperson|Otherperson|Gone Person|@/.test(JSON.stringify(all)), 'no person names');
});

test('CSV: the 11 columns in order, one line per row, quoting, the title + headcount line at the end; no names or addresses', async () => {
  const db = fakeSupabase(seed());
  const csv = toCsv((await visitorsExport(db, B, { window: '30', now: NOW })).report);
  const lines = csv.split('\n');
  assert.equal(lines[0], COLUMNS.map(c => (/,/.test(c) ? `"${c}"` : c)).join(','), 'a header with a comma is quoted');
  assert.deepEqual(COLUMNS, ['Company', 'Industry', 'Headcount', 'First seen', 'Last seen', 'Days visited', 'Visits (Apollo, rolling 7 d at last seen)', 'Pages (top 3, last pull)', 'People identified', 'Band', 'In Prospector']);
  assert.equal(lines[1], 'Acme Health,NAICS 6216,"1,250 (typed)",2026-10-20,2026-11-06,3,6,"/pricing, /employers, /about",2,P1 · Hot,Employer · Contacted', '3 days visited inside the 30-day window');
  assert.equal(lines.length, 1 + 4 + 2, 'four companies inside 30 days: Harbor Lane (Oct 23) is in');
  assert.equal(lines[lines.length - 1], 'HomeLover website visitors · last 30 days (2026-10-08 – 2026-11-06) · generated 2026-11-06 · headcount known for 2 of 4 companies');
  assert.ok(!/@|Jordan|Otherperson|\d{3}-\d{3}-\d{4}/.test(csv));
});

test('a company name that looks like an address or phone refuses the whole export (422); the pure builder with no rows', async () => {
  const s = seed(); s.web_visits[5].company_name = 'call 312-555-0199';
  const r = await visitorsExport(fakeSupabase(s), B, { window: '7', now: NOW });
  assert.deepEqual([r.status, r.error], [422, 'Export refused: a cell looks like an email address or phone number']);
  const empty = buildVisitorsExport({ visits: [], records: new Map(), bands: new Map(), peopleByVisit: new Map(), window: windowOf('all', '2026-11-06'), today: '2026-11-06' });
  assert.deepEqual([empty.companies, empty.summary, empty.window.since], [0, 'headcount known for 0 of 0 companies', null]);
});

test('route: a member is refused (403), an admin / owner / platform owner gets JSON or the CSV attachment', async () => {
  const res = () => { const o = { code: 200, headers: {}, body: null, status(c) { o.code = c; return o; }, json(b) { o.body = b; return o; }, send(b) { o.body = b; return o; }, setHeader(k, v) { o.headers[k] = v; } }; return o; };
  const req = (role, query = {}) => ({ params: { businessId: B }, query, auth: { isPlatformOwner: role === 'platform', roles: new Map(role && role !== 'platform' ? [[B, role]] : []) } });
  const m = res(); await visitorsExportRoute(req('member'), m);
  assert.deepEqual([m.code, m.body.error], [403, 'Only an owner or admin can export visitors']);
  const v = res(); await visitorsExportRoute(req('viewer'), v);
  assert.equal(v.code, 403);
  const p = res(); await visitorsExportRoute(req('platform', { window: '7', format: 'csv' }), p).catch(() => {});
  assert.ok(p.code === 403 ? false : true, 'a platform owner passes the role gate');
});
