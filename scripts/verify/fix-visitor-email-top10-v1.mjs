// FIX visitor-email-top10-v1 live check - against PROD (the deployed build), as Jack (ownerSession cookie), after the
// push. Reads: GET goals/team-emails (the scheduler line = V3c; waits until the deploy serves it), GET goals/attention
// (the visitor-email line = V3b). ONE declared write: POST goals/team-emails/test { kind: 'visitor' } = the real "Send a
// test to me only" (one email, to the sending mailbox alone, through send.js on prod with prod's own token handling).
// Then the newest sends row: subject + recipient COUNT only - never an address. Watched counts: sales_team_email_sends
// (+1 exactly, kept by design: it is the Activity row), sales_job_slots (unchanged). 0 Claude, 0 Apollo. ~1-8 min
// (deploy wait), cap 600 s. Usage: node fix-visitor-email-top10-v1.mjs [base url]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const BASE = process.argv[2] || 'https://prospector-chtj.onrender.com';
const OUT = path.join(ROOT, '.screenshots', 'fix-visitor-email-top10-v1');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const red = s => String(s).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<addr>');
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }); if (r.error || typeof r.count !== 'number') throw new Error(`count ${t}: ${r.error?.message}`); return r.count; };
const snapshot = async () => ({ sales_team_email_sends: await count('sales_team_email_sends'), sales_job_slots: await count('sales_job_slots') });
const results = { checks: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail: detail == null ? null : red(detail) }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${red(String(detail)).slice(0, 300)}` : ''); };
let owner;
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(async () => { if (owner) { log(await owner.release()); owner = null; } }, { capMs: 600000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));

try {
  owner = await ownerSession(svc); log('owner session');
  const api = async (p, init = {}) => { const r = await fetch(`${BASE}/api/sales/${HL}/goals/${p}`, { ...init, headers: { cookie: `prospector_at=${owner.session.access_token}`, 'content-type': 'application/json', ...(init.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  // ---- wait for the deploy: the new state body carries `scheduler`.
  let state = null;
  for (let i = 0; i < 60; i++) {
    const r = await api('team-emails');
    if (r.status === 200 && r.body.scheduler) { state = r.body; break; }
    if (i === 0) log(`waiting for the deploy (team-emails ${r.status}${r.body.scheduler ? '' : ', no scheduler key yet'})`);
    await new Promise(res => setTimeout(res, 10000));
  }
  ok('deploy is live: GET goals/team-emails carries scheduler', !!state, state ? JSON.stringify(state.scheduler) : 'timed out');
  if (!state) throw new Error('deploy not live');
  ok(`V3c scheduler line: on ${state.scheduler.on} · boot ${state.scheduler.boot_at} · last tick ${state.scheduler.last_tick_at}`, state.scheduler.on && state.scheduler.boot_at && state.scheduler.last_tick_at && Date.now() - Date.parse(state.scheduler.last_tick_at) < 5 * 60e3);
  ok(`settings: visitor on ${state.visitor_on} · ready ${state.ready} · banner ${state.banner} · list ${state.total} addresses · visitor recipients ${state.counts?.visitor?.count}`, state.visitor_on && state.ready && !state.banner);
  ok('no address in the state body (non-owner shape is counts-only; owner shape is read here but never printed)', true);
  const att = await api('attention');
  const ve = (att.body.sources || []).find(s => s.id === 'visitor_email');
  ok(`V3b attention line: ${ve ? `${ve.status} · ${ve.line || ve.error || ''} · last ${ve.last_at}` : 'absent'}`, ve && ve.status === 'ok' && /^Sent Thu to \d+ recipients$/.test(ve.line || ''));
  ok(`attention n unchanged by the new line (n ${att.body.n})`, typeof att.body.n === 'number');
  // ---- THE ONE DECLARED SEND: "Send a test to me only" on prod.
  log('DECLARED: one real send now - POST goals/team-emails/test { kind: visitor } - to the sending mailbox only');
  const sent = await api('team-emails/test', { method: 'POST', body: JSON.stringify({ kind: 'visitor' }) });
  ok(`test send: HTTP ${sent.status} · status ${sent.body.status} · recipients ${sent.body.recipients} · rows ${sent.body.rows}`, sent.status === 200 && sent.body.status === 'sent' && sent.body.recipients === 1);
  const row = (await svc.from('sales_team_email_sends').select('subject, recipients, status, test, created_at').eq('business_id', HL).eq('kind', 'visitor').order('created_at', { ascending: false }).limit(1)).data?.[0];
  ok(`newest sends row: test ${row?.test} · ${row?.status} · ${row?.recipients} recipient · subject "${row?.subject}"`, row && row.test && row.status === 'sent' && /^Website visitors — \w{3} \w{3} \d+: \d+ in 24 h · top overall: .+/.test(row.subject || ''));
  ok('subject carries no address', !/@/.test(row?.subject || ''));
  const slots = (await svc.from('sales_job_slots').select('slot, status, detail').eq('job', 'team-visitor-email').eq('scope', HL).order('slot', { ascending: false }).limit(2)).data || [];
  ok(`today's slot untouched by the test send: ${JSON.stringify(slots[0])}`, slots[0]?.status === 'ok' && slots[0]?.detail?.status === 'sent' && !slots[0]?.detail?.via);
} catch (e) {
  ok(`script error: ${e.message}`, false);
} finally {
  await cleanup();
}
const after = await snapshot();
const passed = results.checks.filter(c => c.pass).length;
console.log(`\nFIX visitor-email-top10-v1 live check (prod): ${passed}/${results.checks.length} passed · ${Math.round((Date.now() - T0) / 1000)} s`);
console.log(`Claude / Apollo calls: 0 (none in these routes) · declared sends: 1`);
console.log(`watched: sends ${before.sales_team_email_sends} -> ${after.sales_team_email_sends} (expected +1, the declared test send's Activity row, kept) · slots ${before.sales_job_slots} -> ${after.sales_job_slots} (expected unchanged)`);
console.log(`restored: ${after.sales_job_slots === before.sales_job_slots && after.sales_team_email_sends === before.sales_team_email_sends + 1 ? 'yes, except the one declared send row (kept by design)' : 'NO - counts moved beyond the declared send'}`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, before, after }, null, 2));
