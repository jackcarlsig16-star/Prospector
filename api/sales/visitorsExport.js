import { getSupabase, addDays } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { hasRole } from '../lib/requireAuth.js';
import { hasPii } from './scrubText.js';

// FIX visitor-email-period-v1 P4 / P5 - "Export visitors" for fundraising validation (Pipeline › Web visitors, owner /
// admin): one row per company Apollo saw on the site inside the window, company data only - no person names, no
// addresses, no phones (the built rows are re-read and refused if anything looks like one). Headcount = the matched
// record's employees with its source word, "unknown" otherwise - never blank. Industry = the NAICS / SIC code Apollo
// stored (no industry name is stored anywhere). The CSV is built here; the PDF is the same table printed from the
// page's print area (no new dependency). No Apollo call, no Claude call, no write.
export const WINDOWS = { 7: 'last 7 days', 30: 'last 30 days', 90: 'last 90 days', all: 'since the first pull' };
export const COLUMNS = ['Company', 'Industry', 'Headcount', 'First seen', 'Last seen', 'Days visited', 'Visits (Apollo, rolling 7 d at last seen)', 'Pages (top 3, last pull)', 'People identified', 'Band', 'In Prospector'];
const BAND_WORD = { P1: 'Hot', P2: 'Warm', P3: 'Cool', P4: 'Cold' };
const KIND = { partner: 'Partner', opportunity: 'Employer', target: 'Target' };
const SCORE_TYPE = { employer: 'opportunity', target: 'target', partner: 'partner' };
const SOURCE_WORD = { research: 'research', manual: 'typed', apollo: 'Apollo' };
const titleCase = s => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export function windowOf(id, today) {
  const key = String(id) in WINDOWS ? String(id) : '30';
  return { id: key, label: WINDOWS[key], since: key === 'all' ? null : addDays(today, -(Number(key) - 1)), until: today };
}

// Pure. visits = every web_visits row of the workspace; records = Map('<matched_type>:<id>' -> { stage, client_status,
// employees, employees_source }); bands = Map('<matched_type>:<id>' -> band); peopleByVisit = Map(visit_id -> count).
export function buildVisitorsExport({ visits, records, bands, peopleByVisit, window: w, today, firstPull = null }) {
  const byKey = new Map();
  for (const v of visits) { if (!byKey.has(v.company_key)) byKey.set(v.company_key, []); byKey.get(v.company_key).push(v); }
  const rows = [];
  for (const all of byKey.values()) {
    const inWindow = w.since ? all.filter(v => v.seen_to >= w.since) : all;
    if (!inWindow.length) continue;
    const latest = [...all].sort((a, b) => `${a.pulled_on}${a.seen_to}`.localeCompare(`${b.pulled_on}${b.seen_to}`)).pop();
    const key = latest.matched_type && latest.matched_id ? `${latest.matched_type}:${latest.matched_id}` : null;
    const rec = key ? records.get(key) || null : null;
    const band = (key && bands.get(key)) || latest.priority || null;
    rows.push({
      company: latest.company_name,
      industry: latest.naics_codes?.[0] ? `NAICS ${latest.naics_codes[0]}` : latest.sic_codes?.[0] ? `SIC ${latest.sic_codes[0]}` : '—',
      headcount: rec?.employees != null ? `${Number(rec.employees).toLocaleString('en-US')} (${SOURCE_WORD[rec.employees_source] || 'typed'})` : 'unknown',
      headcount_known: rec?.employees != null,
      first_seen: all.map(v => v.seen_from).filter(Boolean).sort()[0] || null,
      last_seen: all.map(v => v.seen_to).filter(Boolean).sort().pop() || null,
      days_visited: new Set(inWindow.map(v => v.seen_to)).size,
      visits_7d: latest.visits_7d ?? 0,
      pages: (Array.isArray(latest.top_paths) ? latest.top_paths : []).slice(0, 3).map(p => String(p?.path || p)),
      people: all.reduce((n, v) => n + (peopleByVisit.get(v.id) || 0), 0),
      band: band ? `${band} · ${BAND_WORD[band] || ''}`.trim() : '—',
      in_prospector: rec ? `${KIND[latest.matched_type]}${rec.client_status ? ' · Client' : rec.stage ? ` · ${titleCase(rec.stage)}` : ''}` : '—',
    });
  }
  rows.sort((a, b) => String(b.last_seen || '').localeCompare(String(a.last_seen || '')) || b.visits_7d - a.visits_7d || a.company.localeCompare(b.company));
  const known = rows.filter(r => r.headcount_known).length;
  const window = { ...w, since: w.since || firstPull };
  return { window, generated: today, companies: rows.length, headcount_known: known, summary: `headcount known for ${known} of ${rows.length} companies`, title: `HomeLover website visitors · ${w.label}${window.since ? ` (${window.since} – ${w.until})` : ''} · generated ${today}`, rows };
}

export const rowCells = r => [r.company, r.industry, r.headcount, r.first_seen || '', r.last_seen || '', r.days_visited, r.visits_7d, r.pages.join(', '), r.people, r.band, r.in_prospector];
const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = report => [COLUMNS, ...report.rows.map(rowCells)].map(r => r.map(csvCell).join(',')).concat(['', csvCell(`${report.title} · ${report.summary}`)]).join('\n');

export async function visitorsExport(supabase, businessId, { window: id = '30', now = Date.now() } = {}) {
  const today = laDateString(new Date(now));
  const w = windowOf(id, today);
  const visits = await selectAllPages(() => supabase.from('web_visits').select('id, company_key, company_name, naics_codes, sic_codes, visits_7d, top_paths, priority, matched_type, matched_id, pulled_on, seen_from, seen_to').eq('business_id', businessId).order('id'));
  const ids = t => [...new Set(visits.filter(v => v.matched_type === t && v.matched_id).map(v => v.matched_id))];
  const byIds = (table, cols, list) => (list.length ? selectAllPages(() => supabase.from(table).select(cols).eq('business_id', businessId).in('id', list).order('id')) : []);
  const [opps, targets, partners, scores, people] = await Promise.all([
    byIds('sales_opportunities', 'id, stage, client_status, employees, employees_source', ids('opportunity')),
    byIds('sales_targets', 'id, status, employees, employees_source', ids('target')),
    byIds('sales_goals', 'id, pipeline_status, employees, employees_source', ids('partner')),
    selectAllPages(() => supabase.from('sales_company_scores').select('company_type, company_id, band').eq('business_id', businessId).order('company_id')),
    visits.length ? selectAllPages(() => supabase.from('sales_people').select('id, visit_id').eq('business_id', businessId).not('visit_id', 'is', null).is('archived_at', null).order('id')) : [],
  ]);
  const records = new Map([
    ...opps.map(o => [`opportunity:${o.id}`, { stage: o.stage, client_status: o.client_status, employees: o.employees, employees_source: o.employees_source }]),
    ...targets.map(t => [`target:${t.id}`, { stage: t.status, client_status: null, employees: t.employees, employees_source: t.employees_source }]),
    ...partners.map(p => [`partner:${p.id}`, { stage: p.pipeline_status, client_status: null, employees: p.employees, employees_source: p.employees_source }]),
  ]);
  const bands = new Map(scores.filter(s => SCORE_TYPE[s.company_type]).map(s => [`${SCORE_TYPE[s.company_type]}:${s.company_id}`, s.band]));
  const peopleByVisit = new Map();
  for (const p of people) if (p.visit_id) peopleByVisit.set(p.visit_id, (peopleByVisit.get(p.visit_id) || 0) + 1);
  const report = buildVisitorsExport({ visits, records, bands, peopleByVisit, window: w, today, firstPull: visits.map(v => v.pulled_on).filter(Boolean).sort()[0] || null });
  if (hasPii(JSON.stringify(report.rows))) return { status: 422, error: 'Export refused: a cell looks like an email address or phone number' };
  return { status: 200, report };
}

// GET /goals/visits/export-visitors?window=7|30|90|all&format=csv|json - owner / admin only.
export async function visitorsExportRoute(req, res) {
  if (!hasRole(req, req.params.businessId, 'admin')) return res.status(403).json({ error: 'Only an owner or admin can export visitors' });
  try {
    const r = await visitorsExport(getSupabase(), req.params.businessId, { window: req.query.window });
    if (r.error) return res.status(r.status).json({ error: r.error });
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="website-visitors-${r.report.window.id}-${r.report.generated}.csv"`);
      return res.send(toCsv(r.report));
    }
    return res.json(r.report);
  } catch (e) { return res.status(500).json({ error: e.message }); }
}
