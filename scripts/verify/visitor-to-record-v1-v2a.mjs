// visitor-to-record-v1 V2a live check (Oct 27 ruling) - as Jack (ownerSession) on the REAL HomeLover workspace through the
// real wiring on localhost (server.js with the real .env, so the people pull's Apollo calls are REAL). API only, no
// browser, no Claude. Two requests:
//   1. POST goals/visits/people-csv { text: inbox/apollo-visited-people.csv, preview: true } -> counts only, NO write
//      (the file never leaves inbox/ and is never printed; three people as "F. Lastname · Company").
//   2. POST goals/visits/people-pull { force: true } -> the Apollo list "Prospector · Website visitors (export)":
//      declared Apollo <= 4 calls (balance, GET /labels, 1 contacts page for <= 100 contacts, balance), 0 credits,
//      balance before / after from the apollo_credit_spend row. THIS WRITES real rows by design (people filed to their
//      records, a new employer target when none matches, Apollo headcounts into empty employees, the settings state,
//      one spend row) - the report lists every count that grew; nothing is deleted.
// Then GET goals/attention (visitors.people_pull) + DB reads for the new rows. Runtime ~30 s, hard cap 240 s.
// Report: .screenshots/visitor-to-record-v1/v2a-report.json. Usage: node scripts/verify/visitor-to-record-v1-v2a.mjs
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
const OUT = path.join(ROOT, '.screenshots', 'visitor-to-record-v1');
const CSV_PATH = path.join(ROOT, 'inbox', 'apollo-visited-people.csv');
const PORT = 3998, BASE = `http://localhost:${PORT}`;
const HL_TABLES = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_people', 'partner_contacts', 'sales_signals', 'web_visits', 'sales_settings', 'apollo_credit_spend', 'sales_source_events', 'business_anthropic_usage'];
const ADDRESS = /[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+\.[a-z]{2,}/i;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const count = async (t, biz) => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message || `no count (HTTP ${r.status})`}`); return r.count; };
const biz = (await svc.from('businesses').select('id, name').ilike('name', '%homelover%')).data;
if (biz?.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
const snapshot = async () => { const o = {}; for (const t of HL_TABLES) o[t] = await count(t, HL); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
if (!fs.existsSync(CSV_PATH)) { console.log('ABORT: inbox/apollo-visited-people.csv is missing'); process.exit(1); }
let srv, owner;
const results = { checks: [], errors: [], apollo: null };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 400)}` : ''); };
const initials = (name, company) => { const parts = String(name || '').trim().split(/\s+/); return `${parts[0]?.[0] || '?'}. ${parts.slice(1).join(' ') || '—'} · ${company}`; };
async function teardown() { if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));
const startedAt = new Date().toISOString();

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const api = async (p, body = null) => { const r = await fetch(`${BASE}/api/sales/${HL}/goals${p}`, { method: body ? 'POST' : 'GET', headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; } return { code: r.status, body: json }; };

  // 1. the CSV preview (counts only, no write)
  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  const pv = await api('/visits/people-csv', { text: csv, preview: true });
  const c = pv.body?.counts || {};
  const after1 = await snapshot();
  ok(`CSV preview through the real wiring -> ${pv.code}; header row ${pv.body?.header_row}, ${pv.body?.columns_dropped} columns dropped at parse; people ${pv.body?.people} (${c.people_added} new · ${c.already_in} already on file), skipped ${pv.body?.skipped}; companies ${c.companies} (${c.matched} matched · ${c.created} would be created); three: ${(pv.body?.sample || []).map(x => initials(x.name, x.company)).join(' | ')}; no "@"; NOTHING written`,
    pv.code === 200 && pv.body.preview === true && pv.body.people > 0 && !ADDRESS.test(JSON.stringify(pv.body)) && JSON.stringify(after1) === JSON.stringify(before), JSON.stringify(after1) === JSON.stringify(before) ? 'counts identical after the preview' : `counts moved: ${JSON.stringify(after1)}`);

  // 2. the list pull (real Apollo, declared <= 4 calls)
  const pull = await api('/visits/people-pull', { force: true });
  const b = pull.body || {}, k = b.counts || {};
  const spend = (await svc.from('apollo_credit_spend').select('endpoint, ref, credits, balance_before, balance_after, at').eq('business_id', HL).gte('at', startedAt).order('at', { ascending: false }).limit(1)).data?.[0] || null;
  results.apollo = { calls: b.calls ?? null, credits: b.credits ?? null, balance_before: spend?.balance_before ?? null, balance_after: spend?.balance_after ?? null };
  if (pull.code !== 200) ok(`list pull -> ${pull.code}: ${b.error} (calls ${b.calls ?? '?'}; balance ${spend?.balance_before ?? '?'} -> ${spend?.balance_after ?? '?'})`, false);
  else ok(`list pull through the real wiring -> 200: list "${b.list?.name}" (${b.list?.count ?? '?'} on the list per Apollo, id ${b.list?.cached ? 'cached' : 'resolved by ONE GET /labels'}), Apollo calls ${b.calls} (declared <= 4), credits ${b.credits}, balance ${spend?.balance_before} -> ${spend?.balance_after}; contacts ${k.contacts} on ${k.pages} page${k.pages === 1 ? '' : 's'}${k.capped ? ' (CAPPED)' : ''}, with an email ${k.with_email} (count only), skipped ${k.skipped}; people ${k.people_added} new · ${k.already_in} already on file; companies ${k.companies} (${k.matched} matched · ${k.created} created · ${k.employees_filled} headcounts filled); three: ${(b.sample || []).map(x => initials(x.name, x.company)).join(' | ')}; no "@"`,
    b.ran === true && b.calls <= 4 && b.credits === 0 && spend && spend.ref.startsWith('people_pull:') && !ADDRESS.test(JSON.stringify(b)));

  // 3. the state + the rows, read back
  const att = await api('/attention?fresh=1');
  const pp = att.body?.sources?.find(s => s.id === 'visitors')?.people_pull;
  const settings = (await svc.from('sales_settings').select('visitor_filters').eq('business_id', HL).maybeSingle()).data?.visitor_filters?.visitor_people || null;
  ok(`GET goals/attention -> ${att.code}: visitors.people_pull last_on ${pp?.last_on} · list "${pp?.list}" · ${pp?.counts?.contacts ?? '?'} contacts · error ${pp?.error ?? 'none'}; sales_settings.visitor_filters.visitor_people carries list_id (${settings?.list_id ? 'yes' : 'NO'}), list_name, last_pull_on ${settings?.last_pull_on}`,
    att.code === 200 && pp && pp.last_on && (pull.code !== 200 || (settings?.list_id && pp.error == null)));
  const people = (await svc.from('sales_people').select('id, name, title, company_type, opportunity_id, target_id, source_kind, source_note, note, apollo_person_id, created_at').eq('business_id', HL).gte('created_at', startedAt).order('created_at')).data || [];
  const targetsNew = (await svc.from('sales_targets').select('id, name, source, employees, employees_source, created_at').eq('business_id', HL).gte('created_at', startedAt)).data || [];
  const contactsNew = (await svc.from('partner_contacts').select('id, name, goal_id, created_at').eq('business_id', HL).gte('created_at', startedAt)).data || [];
  const filled = [...((await svc.from('sales_targets').select('name, employees').eq('business_id', HL).eq('employees_source', 'apollo').gte('employees_at', startedAt)).data || []), ...((await svc.from('sales_opportunities').select('organization, employees').eq('business_id', HL).eq('employees_source', 'apollo').gte('employees_at', startedAt)).data || []), ...((await svc.from('sales_goals').select('name, employees').eq('business_id', HL).eq('employees_source', 'apollo').gte('employees_at', startedAt)).data || [])];
  const nameOf = async p => (p.target_id ? (await svc.from('sales_targets').select('name').eq('id', p.target_id).maybeSingle()).data?.name : (await svc.from('sales_opportunities').select('organization').eq('id', p.opportunity_id).maybeSingle()).data?.organization) || '?';
  const three = [];
  for (const p of people.slice(0, 3)) three.push(initials(p.name, await nameOf(p)));
  const human = JSON.stringify(people.map(p => [p.name, p.title, p.note, p.source_note]));
  ok(`DB after the pull: ${people.length} sales_people rows added (source_kind web_visit ${people.filter(p => p.source_kind === 'web_visit').length}, source_note "Apollo list …" ${people.filter(p => String(p.source_note || '').startsWith('Apollo list')).length}, apollo_person_id set ${people.filter(p => p.apollo_person_id).length}), ${contactsNew.length} partner_contacts added, ${targetsNew.length} employer target${targetsNew.length === 1 ? '' : 's'} created (${targetsNew.map(t => `${t.name}${t.employees ? ` · ${t.employees} employees (apollo)` : ''}`).join(', ') || 'none'}), ${filled.length} empty headcount${filled.length === 1 ? '' : 's'} filled from Apollo (${filled.map(f => `${f.name || f.organization} ${f.employees}`).join(', ') || 'none'}); three on file: ${three.join(' | ') || '(no new rows)'}; no address or phone in any human field`,
    !ADDRESS.test(human) && !/\+?\d[\d\s().-]{7,}\d/.test(human.replace(/\d{4}-\d{2}-\d{2}/g, '')) && people.every(p => p.source_kind === 'web_visit'));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let line;
  try {
    const after = await snapshot();
    const grew = Object.keys(after).filter(t => after[t] !== before[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
    line = grew.length ? `no, by design - the list pull filed real rows (nothing deleted, nothing else changed): ${grew.join(', ')}` : 'yes (HomeLover counts identical - the pull added nothing new)';
    results.restored = { grew, before, after };
  } catch (e) { line = `NO (check failed: ${e.message})`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'v2a-report.json'), JSON.stringify({ ...results, when: new Date().toISOString() }, null, 2));
  console.log(`\nvisitor-to-record-v1 V2a live check: ${passed}/${results.checks.length} passed · Apollo ${JSON.stringify(results.apollo)} · Claude 0\nrestored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
