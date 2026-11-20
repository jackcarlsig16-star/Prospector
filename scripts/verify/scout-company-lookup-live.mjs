// FIX scout-company-lookup live check - localhost, the real routes, as Jack (ownerSession) on the REAL HomeLover workspace.
// DECLARED before it runs:
//   Claude  cap 3, cached in .screenshots/scout-company-lookup/live-ledger.json (a re-run answers from the cache, 0 Claude):
//           the exact Nov 19 ask ("tell me about greyorange and who owns") + one found company ("what's up with
//           metlife") + one "who owns" ("who owns metlife").
//   Apollo  0 (the server runs with the Apollo key empty).
//   Writes  none. POST /api/scout/plan (the assign card) writes nothing and is never confirmed; no /act, no Add as
//           target. The model calls leave their usage rows (kept: they are the cost record). ownerSession's sign-in
//           row is kept by rule and last_seen_at is restored.
//   Reads   7 route calls (3 paid, 3 no-record asks, 1 plan) + ~14 small reads to compare with the DB. ~60 s, cap 200 s.
// Prints company names and member first names only.
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
const { normName } = await import('../../api/sales/normName.js');
const OUT = path.join(ROOT, '.screenshots', 'scout-company-lookup');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const TABLES = ['sales_targets', 'sales_opportunities', 'sales_goals', 'sales_flow_events', 'sales_partner_events', 'sales_week_goals', 'sales_people'];
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); return r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; };
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const CLAUDE_CAP = 3;
const LEDGER = path.join(OUT, 'live-ledger.json');
fs.mkdirSync(OUT, { recursive: true });
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { spent: 0, calls: {} };
const saveLedger = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
let srv, owner, claudeThisRun = 0;
const results = { checks: [], errors: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 600)}` : ''); };
async function teardown() { if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 200000 });
const ADDRESS = /[^\s"<>]+@[^\s"<>]+\.[a-z]{2,}/i;
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

const members = must(await svc.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', HL).not('user_id', 'is', null));
const first = id => (id ? (members.find(m => m.user_id === id)?.profile?.display_name || members.find(m => m.user_id === id)?.name || 'a former member').trim().split(/\s+/)[0] : null);
// what the DB says about a name: the record (exact normName) and its owner
async function dbRecord(name) {
  const like = `%${name}%`;
  const [p, o, t] = await Promise.all([
    svc.from('sales_goals').select('id, name, owner_user_id, updated_at').eq('business_id', HL).eq('goal_type', 'partnership').is('archived_at', null).ilike('name', like).then(must),
    svc.from('sales_opportunities').select('id, organization, owner_user_id, updated_at').eq('business_id', HL).is('archived_at', null).ilike('organization', like).then(must),
    svc.from('sales_targets').select('id, name, owner_user_id, updated_at').eq('business_id', HL).ilike('name', like).then(must),
  ]);
  const all = [...p.map(r => ({ type: 'partner', entity: 'partners', table: 'sales_goals', ...r })), ...o.map(r => ({ type: 'employer', entity: 'employers', table: 'sales_opportunities', ...r, name: r.organization })), ...t.map(r => ({ type: 'target', entity: 'targets', table: 'sales_targets', ...r }))];
  return all.find(r => normName(r.name) === normName(name)) || null;
}
const before = await snapshot();
const grey = await dbRecord('greyorange'), met = await dbRecord('metlife');
log('before', JSON.stringify(before), `· Claude spent so far ${ledger.spent}/${CLAUDE_CAP}`);
log(`DB: GreyOrange = ${grey ? `${grey.type}, owner ${first(grey.owner_user_id) || 'nobody'}` : 'no record'} · MetLife = ${met ? `${met.type} "${met.name}", owner ${first(met.owner_user_id) || 'nobody'}` : 'no record'}`);

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const post = async (p, body) => { const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const paid = async (key, q) => {
    if (ledger.calls[key]) return { ...ledger.calls[key], cached: true };
    if (ledger.spent >= CLAUDE_CAP) throw new Error(`the Claude cap (${CLAUDE_CAP}) is spent and "${key}" is not cached`);
    ledger.spent += 1; claudeThisRun += 1; saveLedger();
    const t = Date.now(), r = await post('/api/scout/ask', { q, scope: HL });
    ledger.calls[key] = { status: r.status, body: r.body, elapsed: Math.round((Date.now() - t) / 100) / 10, at: new Date().toISOString() }; saveLedger();
    return ledger.calls[key];
  };
  const startIso = new Date(T0 - 5000).toISOString();
  const usageRows = async () => must(await svc.from('business_anthropic_usage').select('cost_usd, created_at').eq('call_type', 'scout_ask').eq('user_id', owner.userId).gte('created_at', startIso));
  const gridOf = b => Object.fromEntries((b.sections?.[0]?.brief?.grid || []).map(g => [g.label, g.value]));
  const said = (rec, b) => { const who = first(rec.owner_user_id); return who ? b.summary.startsWith(`${rec.name} is owned by ${who}`) : b.summary.startsWith(`${rec.name} has no owner — assign it?`); };
  const describe = (r, b) => `HTTP ${r.status}${r.cached ? ' (cached, 0 Claude)' : ''} · intent ${b.context_stats?.intent} · reads ${(b.context_stats?.reads || []).join(' | ')} · cost $${b.usage?.cost_usd} · ${r.elapsed} s · opens: "${String(b.summary).slice(0, 150)}"`;

  // ---- 1. the exact Nov 19 ask (Claude 1 of 3)
  const a = await paid('greyorange', 'tell me about greyorange and who owns'), A = a.body;
  if (grey) {
    ok(`the Nov 19 ask: ${describe(a, A)}`, a.status === 200 && /brief/.test(A.context_stats?.intent || '') && A.sections?.[0]?.brief?.id === grey.id && !(A.context_stats?.reads || []).some(x => /my open to-dos|companies touched/.test(x)));
    ok(`the Nov 19 ask leads with the owner the DB holds (${first(grey.owner_user_id) || 'nobody'}) and the grid's Owner row says "${gridOf(A).Owner}"`, said(grey, A) && gridOf(A).Owner === (first(grey.owner_user_id) || 'Unassigned'));
    ok('the record rides as a row', (A.items || []).some(i => i.entity === grey.entity && i.id === grey.id));
  } else ok(`the Nov 19 ask: GreyOrange is no record, so the no-record state: "${A.cant?.reason}"`, !!A.cant && !A.usage);
  ok('the Nov 19 ask: no address in the reply', !ADDRESS.test(JSON.stringify(A)));

  // ---- 2. a found company in lower case (Claude 2 of 3) and "who owns" (3 of 3)
  if (met) {
    const b = await paid('metlife', "what's up with metlife"), B = b.body;
    ok(`a lower-case company: ${describe(b, B)}`, b.status === 200 && /brief/.test(B.context_stats?.intent || '') && B.sections?.[0]?.brief?.id === met.id && 'Owner' in gridOf(B));
    const c = await paid('who-owns', 'who owns metlife'), C = c.body;
    ok(`who owns: ${describe(c, C)}`, c.status === 200 && said(met, C) && gridOf(C).Owner === (first(met.owner_user_id) || 'Unassigned'));
    ok('no address in either reply', !ADDRESS.test(JSON.stringify([B, C])));
  } else log('SKIP: MetLife is not a record on HomeLover - the two paid asks about it were not made');

  // ---- 3. no record (0 Claude, no ask counted)
  const usedBefore = (await usageRows()).length;
  const n = await post('/api/scout/ask', { q: 'tell me about nothingco', scope: HL });
  ok(`no record: "${n.body?.cant?.reason}" · usage ${n.body?.usage} · sections ${n.body?.sections?.length}`, n.status === 200 && n.body?.cant?.reason === 'No record named nothingco in Prospector' && n.body.usage === null);
  const typo = await post('/api/scout/ask', { q: 'who owns greyorang', scope: HL });
  ok(`a near name: "${typo.body?.cant?.reason}" · did you mean ${(typo.body?.cant?.candidates || []).map(c => c.title).join(', ') || '—'}`, typo.status === 200 && !!typo.body?.cant && typo.body.usage === null && (!grey || (typo.body.cant.candidates || []).some(c => c.id === grey.id)));
  const visitRows = must(await svc.from('web_visits').select('company_name, pulled_on, matched_id').eq('business_id', HL).is('matched_id', null).order('pulled_on', { ascending: false }).limit(40));
  let visitorTried = 0, visitorOk = null;
  for (const v of visitRows) {
    if (visitorTried >= 3 || visitorOk) break;
    const key = normName(v.company_name);
    if (!key || key.split(' ').length > 3 || await dbRecord(v.company_name)) continue;
    visitorTried += 1;
    const r = await post('/api/scout/ask', { q: `tell me about ${v.company_name.toLowerCase()}`, scope: HL });
    if (r.body?.cant?.add) visitorOk = { name: v.company_name, reason: r.body.cant.reason, add: r.body.cant.add.label, usage: r.body.usage };
  }
  ok(`a visitor-only company (${visitorTried} tried): ${visitorOk ? `"${visitorOk.reason}" · offers ${visitorOk.add}` : 'none of the latest unmatched visit names came back as visitor-only'}`, !!visitorOk && visitorOk.usage === null && /seen on the site on \d+ days? in the last 90, last \d{4}-\d{2}-\d{2}/.test(visitorOk.reason));
  ok(`no model call for the no-record asks: scout_ask usage rows ${usedBefore} -> ${(await usageRows()).length}`, (await usageRows()).length === usedBefore);

  // ---- 4. the assign card is shown, never confirmed
  if (grey) {
    const other = members.find(m => m.user_id !== grey.owner_user_id);
    const card = await post('/api/scout/plan', { scope: HL, verb: 'assign', keys: [`${grey.entity}:${grey.id}`], args: { owner_user_id: other.user_id }, rows: [{ entity: grey.entity, id: grey.id, title: grey.name }] });
    const row = card.body?.rows?.[0];
    ok(`the assign card: HTTP ${card.status} · "${row?.title}" from ${row?.from} to ${row?.to} · ${card.body?.summary?.will} will change · not confirmed`, card.status === 200 && !!card.body?.plan_id && row?.from === (first(grey.owner_user_id) || 'Unassigned') && row?.to === first(other.user_id));
    const after = await dbRecord('greyorange');
    ok('the record is untouched (owner and updated_at as before)', after.owner_user_id === grey.owner_user_id && after.updated_at === grey.updated_at);
  }
  const spent = await usageRows();
  ok(`Claude: ${claudeThisRun} this run, ${ledger.spent} of cap ${CLAUDE_CAP} in all · scout_ask usage rows this run ${spent.length} · $${spent.reduce((s, r) => s + Number(r.cost_usd || 0), 0).toFixed(4)}`, ledger.spent <= CLAUDE_CAP && spent.length === claudeThisRun);
} catch (e) { results.errors.push(e.message); log('ERROR', e.message); }
finally {
  await cleanup();
  const after = await snapshot();
  const moved = TABLES.filter(t => before[t] !== after[t]);
  log('after', JSON.stringify(after));
  const pass = results.checks.filter(c => c.pass).length;
  console.log(`\nchecks: ${pass}/${results.checks.length} passed${results.errors.length ? ` · errors: ${results.errors.join(' | ')}` : ''}`);
  console.log(`Claude: ${claudeThisRun} this run, ${ledger.spent} of cap ${CLAUDE_CAP} in all · Apollo: 0`);
  console.log(`restored: ${moved.length ? `CHECK - counts moved on ${moved.map(t => `${t} ${before[t]} -> ${after[t]}`).join(', ')} (this run writes none of them: see who wrote)` : 'yes (no table count moved; the run writes nothing but its usage rows and the kept sign-in row)'}`);
  process.exit(results.errors.length || pass !== results.checks.length ? 1 : 0);
}
