// visitor-to-record-v1 V2a follow-up live check (Oct 27 ruling) - as Jack (ownerSession) on the REAL HomeLover workspace
// through the real wiring on localhost. API only, no browser, 0 Claude, 0 Apollo (nothing here calls Apollo).
//   1. A SECOND CSV preview of inbox/apollo-visited-people.csv (never printed, never leaves inbox/): proves the shared filer
//      is idempotent - expect 0 new people, 0 new / parked companies (every company matched, every person already on file).
//   2. ONLY if proven: the real upload once, so "# Employees" fills the 56 companies' employees (employees_source 'apollo',
//      never over manual). Writes by design: employees on the targets the Oct 27 pull created (+ any matched record with an
//      empty headcount); expect 0 new rows anywhere. If step 1 is not 0 / 0 the script STOPS before any write.
//   3. GET goals/attention -> visitors.people_pull (parked count) and the counts before / after.
// Also counts the CSV's Company Country coverage (counts only). Runtime ~20 s, hard cap 240 s.
// Report: .screenshots/visitor-to-record-v1/v2a-followup-report.json. Usage: node scripts/verify/visitor-to-record-v1-v2a-followup.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const { parseCsv } = await import('../../api/sales/peopleFind.js');
const OUT = path.join(ROOT, '.screenshots', 'visitor-to-record-v1');
const CSV_PATH = path.join(ROOT, 'inbox', 'apollo-visited-people.csv');
const PORT = 3999, BASE = `http://localhost:${PORT}`;
const HL_TABLES = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'partner_contacts', 'sales_signals', 'web_visits', 'sales_settings', 'apollo_credit_spend', 'sales_source_events', 'visit_pull_runs', 'business_anthropic_usage'];
const ADDRESS = /[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+\.[a-z]{2,}/i;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const count = async (t, biz) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const biz = (await svc.from('businesses').select('id, name').ilike('name', '%homelover%')).data;
if (biz?.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
const snapshot = async () => { const o = {}; for (const t of HL_TABLES) o[t] = await count(t, HL); return o; };
const headcounts = async () => { const o = {}; for (const [t, col] of [['sales_targets', 'employees_source'], ['sales_opportunities', 'employees_source'], ['sales_goals', 'employees_source']]) { const r = await svc.from(t).select(col).eq('business_id', HL).eq(col, 'apollo'); if (r.error) throw new Error(r.error.message); o[t] = r.data.length; } return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
if (!fs.existsSync(CSV_PATH)) { console.log('ABORT: inbox/apollo-visited-people.csv is missing'); process.exit(1); }
let srv, owner;
const results = { checks: [], errors: [], wrote: false };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 400)}` : ''); };
async function teardown() { if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot(), hcBefore = await headcounts();
log('before', JSON.stringify(before), 'apollo headcounts', JSON.stringify(hcBefore));

try {
  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csv), hdr = rows[0].map(h => h.trim().toLowerCase());
  const col = n => hdr.indexOf(n);
  const body = rows.slice(1);
  const countries = body.map(r => String(r[col('company country')] || '').trim()).filter(Boolean);
  const us = countries.filter(c => /^(us|usa|united states)/i.test(c)).length;
  const withEmp = body.filter(r => Number(String(r[col('# employees')] || '').replace(/\D/g, '')) > 0).length;
  ok(`CSV coverage (counts only): ${body.length} rows, Company Country on ${countries.length} (${us} US), # Employees on ${withEmp}`, body.length > 0);

  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const api = async (p, b = null) => { const r = await fetch(`${BASE}/api/sales/${HL}/goals${p}`, { method: b ? 'POST' : 'GET', headers: { cookie, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; } return { code: r.status, body: json }; };

  // 1. the second preview - idempotence
  const pv = await api('/visits/people-csv', { text: csv, preview: true });
  const c = pv.body?.counts || {};
  const after1 = await snapshot();
  const idem = pv.code === 200 && c.people_added === 0 && c.people_parked === 0 && c.created === 0 && c.parked === 0 && c.matched === c.companies;
  ok(`second CSV preview -> ${pv.code}: people ${pv.body?.people} (${c.people_added} new · ${c.people_parked} would park · ${c.already_in} already on file); companies ${c.companies} (${c.matched} matched · ${c.created} would create · ${c.parked} would park · ${c.skipped_companies} skipped); nothing written`,
    idem && JSON.stringify(after1) === JSON.stringify(before) && !ADDRESS.test(JSON.stringify(pv.body)), idem ? 'idempotent' : `NOT idempotent or failed (${pv.body?.error || 'no error text'}) - stopping before any write`);
  if (!idem) throw new Error('the filer is not idempotent on this file - no upload run');

  // 2. the real upload once - headcounts
  results.wrote = true;
  const up = await api('/visits/people-csv', { text: csv });
  const u = up.body?.counts || {};
  const after2 = await snapshot(), hcAfter = await headcounts();
  const grew = Object.keys(after2).filter(t => after2[t] !== before[t]).map(t => `${t} ${before[t]} -> ${after2[t]}`);
  const filled = Object.keys(hcAfter).map(t => [t, hcAfter[t] - hcBefore[t]]).filter(([, n]) => n).map(([t, n]) => `${t} +${n}`);
  ok(`real upload -> ${up.code}: ${u.employees_filled} empty headcounts filled from "# Employees" (employees_source apollo: ${filled.join(', ') || 'none'}), skipped = companies without a count or already set: ${u.companies - u.employees_filled}; people ${u.people_added} new · ${u.already_in} already; companies ${u.matched} matched · ${u.created} created · ${u.parked} parked; rows that grew: ${grew.join(', ') || 'none'}; no "@"`,
    up.code === 200 && u.people_added === 0 && u.created === 0 && u.parked === 0 && u.employees_filled > 0 && !grew.length && !ADDRESS.test(JSON.stringify(up.body)));
  const manual = (await svc.from('sales_targets').select('id').eq('business_id', HL).eq('employees_source', 'manual')).data?.length ?? '?';
  const again = await api('/visits/people-csv', { text: csv, preview: true });
  ok(`after the upload: ${manual} manual headcounts untouched; a third preview still 0 new / 0 filled-to-do (employees_filled only counts real writes, preview ${again.body?.counts?.employees_filled})`, again.code === 200 && again.body.counts.people_added === 0 && again.body.counts.created === 0);

  // 3. attention
  const att = await api('/attention?fresh=1');
  const pp = att.body?.sources?.find(s => s.id === 'visitors')?.people_pull;
  ok(`GET goals/attention -> ${att.code}: visitors.people_pull last_on ${pp?.last_on} · status ${pp?.status} · parked ${pp?.parked} · error ${pp?.error ?? 'none'}; the visitors line status ${att.body?.sources?.find(s => s.id === 'visitors')?.status}`, att.code === 200 && pp && typeof pp.parked === 'number');
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let line;
  try {
    const after = await snapshot(), hcAfter = await headcounts();
    const grew = Object.keys(after).filter(t => after[t] !== before[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
    const filled = Object.keys(hcAfter).map(t => [t, hcAfter[t] - hcBefore[t]]).filter(([, n]) => n).map(([t, n]) => `${t} apollo headcounts ${hcBefore[t]} -> ${hcAfter[t]}`);
    line = !results.wrote ? 'yes (nothing written)' : grew.length ? `NO - rows grew unexpectedly: ${grew.join(', ')}` : `row counts identical; by design the upload filled headcounts: ${filled.join(', ') || 'none'}`;
    results.restored = { grew, filled, before, after };
  } catch (e) { line = `NO (check failed: ${e.message})`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'v2a-followup-report.json'), JSON.stringify({ ...results, when: new Date().toISOString() }, null, 2));
  console.log(`\nvisitor-to-record-v1 V2a follow-up live check: ${passed}/${results.checks.length} passed · Apollo 0 · Claude 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
