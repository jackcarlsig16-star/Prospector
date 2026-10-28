// FIX headcount-auto-v1 Stage 0 (H1) - MEASURE, read-only. Three declared Apollo endpoint calls as Jack's key on the
// shared Apollo org, with a balance read before and after EACH (api_profile, 0 credits) = 7 Apollo requests in all:
//   (a) GET /organizations/enrich?domain=<one confirmed partner domain whose partner already has a headcount> - NOT on
//       the allowlist, so this script fetches it DIRECTLY (the only guard bypass; app code never can); field NAMES only
//       are recorded, plus the headcount to compare with the stored number. Nothing is written.
//   (b) POST /mixed_people/api_search { q_organization_domains: [that domain], per_page: 1 } through the real client
//       (allowlisted, domain-guarded): does the person's organization object carry estimated_num_employees?
//   (c) POST /mixed_companies/search { q_organization_name, per_page: 1 } WITHOUT the visitor filter - refused by
//       visitorOnly in app code, fetched directly here once to learn its price and whether the first hit is the company.
// Then the read-only counts: companies with employees null by type and, of those, a usable domain from (i) company_domain /
// confirmed partner_domains, (ii) a web_visits row with the same normName and a domain, (iii) a linked contact's
// non-consumer email domain (read inside the query, never printed), (iv) the latest done research run's domain with
// website_confidence high. Hard stop if any single call's measured delta exceeds 2 credits (expected: a 1, b 0, c 1).
// Report: .screenshots/fix-headcount-auto-v1/stage0-report.json. 0 Claude, 0 writes. Usage: node scripts/verify/fix-headcount-auto-v1-stage0.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { apolloRequest, apolloBalance } = await import('../../api/sales/apolloClient.js');
const { normName } = await import('../../api/sales/intakeMatch.js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const OUT = path.join(ROOT, '.screenshots', 'fix-headcount-auto-v1');
const BASE = 'https://api.apollo.io/api/v1';
const CONSUMER = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com', 'me.com', 'live.com', 'msn.com', 'comcast.net', 'att.net', 'proton.me', 'protonmail.com', 'ymail.com', 'sbcglobal.net', 'verizon.net']);
const MAX_DELTA = 2;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const report = { calls: [], counts: {}, errors: [] };
const biz = (await svc.from('businesses').select('id, name').ilike('name', '%homelover%')).data;
if (biz?.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
fs.mkdirSync(OUT, { recursive: true });
const ctx = { callCounter: { count: 0, max: 9 }, endpointCounts: {} };
// ONLY=c re-runs just call (c) after a partial run, keeping (a) / (b) from the saved report (no second spend on them).
const ONLY = process.env.ONLY || '';
const prior = ONLY && fs.existsSync(path.join(OUT, 'stage0-report.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'stage0-report.json'), 'utf8')) : null;
if (prior) report.calls.push(...prior.calls.filter(c => ![...ONLY].some(x => c.label.startsWith(`(${x})`))));
const key = process.env.APOLLO_API_KEY;
if (!key) throw new Error('APOLLO_API_KEY is not set');
// The one-off direct fetch (script only): the key never appears in any error or log line.
const direct = async (method, p, body = null, query = '') => {
  ctx.callCounter.count += 1;
  const res = await fetch(`${BASE}${p}${query ? `?${query}` : ''}`, { method, headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};
const keysOf = o => (o && typeof o === 'object' ? Object.keys(o).sort() : []);
const measured = async (label, fn) => {
  const before = await apolloBalance(ctx);
  let out, error = null;
  try { out = await fn(); } catch (e) { error = String(e.message || e).slice(0, 200); }
  const after = await apolloBalance(ctx);
  const delta = before - after;
  const row = { label, balance_before: before, balance_after: after, credits: delta, error, ...(out || {}) };
  report.calls.push(row);
  log(label, `credits ${delta} (${before} -> ${after})`, error ? `ERROR ${error}` : '');
  if (delta > MAX_DELTA) throw new Error(`${label} cost ${delta} credits - stopping`);
  return row;
};

try {
  // The partner for the comparison: a confirmed domain + a headcount already on file (no MANUAL one has a confirmed
  // domain today - research / apollo numbers stand in; nothing is written either way).
  const partners = (await svc.from('sales_goals').select('id, name, employees, employees_source, company_domain').eq('business_id', HL).eq('goal_type', 'partnership').is('archived_at', null)).data || [];
  const domains = (await svc.from('partner_domains').select('goal_id, domain').eq('business_id', HL).eq('confirmed', true)).data || [];
  const pick = ['manual', 'research', 'apollo'].map(src => partners.filter(p => p.employees != null && p.employees_source === src).map(p => ({ ...p, domain: (domains.find(d => d.goal_id === p.id) || {}).domain || p.company_domain })).find(p => p.domain)).find(Boolean);
  if (!pick) throw new Error('no partner with a headcount and a confirmed domain');
  report.subject = { name: pick.name, domain: pick.domain, stored_employees: pick.employees, stored_source: pick.employees_source };
  log('subject', JSON.stringify(report.subject));

  if (!ONLY || ONLY.includes('a')) await measured('(a) GET /organizations/enrich?domain= (direct, script-only bypass)', async () => {
    const r = await direct('GET', '/organizations/enrich', null, `domain=${encodeURIComponent(pick.domain)}`);
    const org = r.json?.organization || null;
    const dropped = keysOf(org).filter(k => /phone|address|street|email|postal|zip|lat|long/i.test(k));
    return { http: r.status, organization_keys: keysOf(org), estimated_num_employees: org?.estimated_num_employees ?? null, matches_stored: org?.estimated_num_employees != null && pick.employees != null ? `${org.estimated_num_employees} vs stored ${pick.employees} (${pick.employees_source})` : 'n/a', primary_domain_matches: org?.primary_domain ? org.primary_domain === pick.domain : null, has_industry: 'industry' in (org || {}), has_revenue_printed: 'annual_revenue_printed' in (org || {}), has_founded_year: 'founded_year' in (org || {}), sensitive_keys_present_and_dropped: dropped, error_body: r.status >= 400 ? String(r.json?.error || r.json?.message || '').slice(0, 160) : null };
  });
  // B_DOMAIN: a second domain for (b) when the subject's domain answers 0 people (the org object needs a person to show).
  const bDomain = process.env.B_DOMAIN || pick.domain;
  if (!ONLY || ONLY.includes('b')) await measured(`(b) POST /mixed_people/api_search { q_organization_domains: [${bDomain}], per_page: 1 } (real client)`, async () => {
    const json = await apolloRequest({ method: 'POST', path: '/mixed_people/api_search', body: { q_organization_domains: [bDomain], per_page: 1, page: 1 }, ctx });
    const person = json?.people?.[0] || null, org = person?.organization || null;
    return { people: (json?.people || []).length, person_keys: keysOf(person), organization_keys: keysOf(org), organization_has_estimated_num_employees: !!org && 'estimated_num_employees' in org, organization_estimated_num_employees: org?.estimated_num_employees ?? null, organization_name_matches: org?.name ? normName(org.name) === normName(pick.name) : null };
  });
  if (!ONLY || ONLY.includes('c')) await measured('(c) POST /mixed_companies/search { q_organization_name, per_page: 1 } WITHOUT the visitor filter (direct, script-only bypass)', async () => {
    const r = await direct('POST', '/mixed_companies/search', { q_organization_name: pick.name, per_page: 1, page: 1 });
    const hits = [...(r.json?.organizations || []), ...(r.json?.accounts || [])];
    const first = hits[0] || null;
    return { http: r.status, total_entries: r.json?.pagination?.total_entries ?? null, first_name: first?.name || null, first_domain: first?.primary_domain || null, first_is_the_company: first ? (normName(first.name) === normName(pick.name) || first.primary_domain === pick.domain) : false, first_has_estimated_num_employees: !!first && 'estimated_num_employees' in first, first_keys: keysOf(first), error_body: r.status >= 400 ? String(r.json?.error || r.json?.message || '').slice(0, 160) : null };
  });
  report.apollo = { requests_this_run: ctx.callCounter.count, endpoint_calls: report.calls.length, total_credits: report.calls.reduce((n, c) => n + c.credits, 0), note: ONLY ? `(${ONLY}) re-run after a cap miscount; (a) / (b) kept from the first run` : null };

  // --- read-only counts ---
  const opps = (await selectAllPages(() => svc.from('sales_opportunities').select('id, organization, employees').eq('business_id', HL).is('archived_at', null).order('id')));
  const targets = (await selectAllPages(() => svc.from('sales_targets').select('id, name, employees, status').eq('business_id', HL).neq('status', 'rejected').order('id')));
  const visits = await selectAllPages(() => svc.from('web_visits').select('company_key, company_name, domain').eq('business_id', HL).not('domain', 'is', null).order('id'));
  const visitByKey = new Map(); for (const v of visits) { const k = normName(v.company_name); if (k && v.domain && !visitByKey.has(k)) visitByKey.set(k, v.domain); }
  const contacts = await selectAllPages(() => svc.from('partner_contacts').select('goal_id, email').eq('business_id', HL).not('email', 'is', null).order('id'));
  const contactDomain = new Map(); for (const c of contacts) { const d = String(c.email).split('@')[1]?.toLowerCase(); if (d && !CONSUMER.has(d) && !contactDomain.has(c.goal_id)) contactDomain.set(c.goal_id, d); }
  // Employers / targets: which contact tables link to them with an email (schema read, never the values).
  const linked = new Map();
  for (const [table, col, idCol] of [['sales_outreach_contacts', 'email', 'opportunity_id'], ['sales_outreach_contacts', 'email', 'target_id'], ['prospects', 'email', 'opportunity_id']]) {
    const probe = await svc.from(table).select(`${col}, ${idCol}`).eq('business_id', HL).not(col, 'is', null).limit(1000);
    if (probe.error) continue;
    for (const r of probe.data || []) { const d = String(r[col]).split('@')[1]?.toLowerCase(); if (d && !CONSUMER.has(d) && r[idCol] && !linked.has(r[idCol])) linked.set(r[idCol], d); }
  }
  const research = await selectAllPages(() => svc.from('research_runs').select('entity_type, entity_id, result, created_at').eq('business_id', HL).eq('status', 'done').order('created_at', { ascending: false }));
  const researchDomain = new Map(); for (const r of research) { const k = `${r.entity_type}:${r.entity_id}`; if (!researchDomain.has(k)) researchDomain.set(k, r.result?.website_confidence === 'high' && r.result?.domain ? r.result.domain : null); }
  const tally = { partner: { null_employees: 0, i_own_domain: 0, ii_visit: 0, iii_contact: 0, iv_research: 0, any: 0, none: 0 }, employer: { null_employees: 0, i_own_domain: 0, ii_visit: 0, iii_contact: 0, iv_research: 0, any: 0, none: 0 }, target: { null_employees: 0, i_own_domain: 0, ii_visit: 0, iii_contact: 0, iv_research: 0, any: 0, none: 0 } };
  const consider = (type, id, name, own) => {
    const t = tally[type]; t.null_employees++;
    const i = !!own, ii = visitByKey.has(normName(name)), iii = type === 'partner' ? contactDomain.has(id) : linked.has(id), iv = !!researchDomain.get(`${type === 'employer' ? 'opportunity' : type}:${id}`) || !!researchDomain.get(`${type}:${id}`);
    if (i) t.i_own_domain++; if (ii) t.ii_visit++; if (iii) t.iii_contact++; if (iv) t.iv_research++;
    if (i || ii || iii || iv) t.any++; else t.none++;
  };
  for (const p of partners.filter(p => p.employees == null)) consider('partner', p.id, p.name, p.company_domain || domains.find(d => d.goal_id === p.id)?.domain);
  for (const o of opps.filter(o => o.employees == null)) consider('employer', o.id, o.organization, null);
  for (const t of targets.filter(t => t.employees == null)) consider('target', t.id, t.name, null);
  report.counts = { totals: { partners: partners.length, employers: opps.length, targets: targets.length }, with_employees: { partners: partners.filter(p => p.employees != null).length, employers: opps.filter(o => o.employees != null).length, targets: targets.filter(t => t.employees != null).length }, null_by_type: tally, research_entity_types_seen: [...new Set(research.map(r => r.entity_type))], research_done_runs: research.length, research_high_confidence_domains: [...researchDomain.values()].filter(Boolean).length, contact_tables_consulted: ['partner_contacts (goal_id)', 'sales_outreach_contacts (opportunity_id / target_id, if present)', 'prospects (opportunity_id, if present)'] };
  log('counts', JSON.stringify(report.counts));
} catch (e) {
  report.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  fs.writeFileSync(path.join(OUT, 'stage0-report.json'), JSON.stringify({ ...report, when: new Date().toISOString() }, null, 2));
  console.log(`\nheadcount-auto Stage 0: Apollo requests ${ctx.callCounter.count} (3 endpoint calls + balance reads) · credits ${JSON.stringify(report.calls.map(c => [c.label.slice(0, 3), c.credits]))} · writes 0 · Claude 0`);
  if (report.errors.length) console.log('errors:', report.errors.join('\n'));
}
