// FIX scout-ask-routing-v1 - 3 REAL asks, live as Jack (ownerSession) on HomeLover, through the real wiring (the spawned
// server.js, the session cookie, POST /api/scout/ask). Declared scope: Claude 3 calls (hard cap: the script sends
// exactly three POSTs), Apollo 0 (the server runs without an Apollo key), writes 0 of the script's own (the asks' usage
// rows are their own cost log, kept); reads: the asks' context reads + the three usage rows. ~40 s, cap 230 s.
// Per ask: intent, reads, rows_by_entity, tokens, cost from the usage row (= the reply), withheld, elapsed. The first
// answer must name people with their company and heat. Names and companies only; hasPii on everything shown.
// Usage: node scripts/verify/scout-ask-routing-v1.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { hasPii } = await import('../../api/sales/scrubText.js');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'scout-ask-routing-v1');
const PORT = 3992, BASE = `http://localhost:${PORT}`;
// ONLY=1,2 re-runs a subset (fewer Claude calls) after a fix; the cap is the number of asks sent.
const ALL_ASKS = [["who's our hottest person visiting the website", 'people_visiting'], ['hottest people on the site this week', 'people_visiting'], ['whos replied', 'people']];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const ASKS = ALL_ASKS.filter((a, i) => !ONLY || ONLY.includes(i + 1));
const CLAUDE_CAP = ASKS.length;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const usageCount = async () => (await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).eq('call_type', 'scout_ask')).count;
let srv, owner, sent = 0;
const results = { checks: [], errors: [], asks: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 500)}` : ''); };
async function teardown() { if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 230000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await usageCount();
const startIso = new Date().toISOString();
// A screen reference in an answer: a named view / the Huddle / "look at" / "go to" / "check the ... view|tab|screen".
const SCREEN = /\b(Visitors view|People view|People table|Huddle|Pipeline › People|look at the|go to the|check the \w+ (view|tab|screen)|open the \w+ (view|tab|screen))\b/i;

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const serverLog = []; srv.stdout.on('data', d => serverLog.push(...String(d).split('\n').filter(l => l.includes('[scout/ask]'))));
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  for (const [q, expectIntent] of ASKS) {
    if (sent >= CLAUDE_CAP) throw new Error('over the Claude cap');
    sent += 1;
    const t = Date.now();
    const r = await fetch(`${BASE}/api/scout/ask`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ q, scope: HL }) });
    const body = await r.json().catch(() => ({}));
    const elapsed = Math.round((Date.now() - t) / 100) / 10;
    const usageRow = (await svc.from('business_anthropic_usage').select('input_tokens, output_tokens, cost_usd, business_id').eq('call_type', 'scout_ask').eq('user_id', owner.userId).gte('created_at', startIso).order('created_at', { ascending: false }).limit(1)).data?.[0] || null;
    const items = body.items || [];
    const people = items.filter(i => i.entity === 'people');
    const rec = { q, status: r.status, elapsed_s: elapsed, intent: body.context_stats?.intent, reads: body.context_stats?.reads, rows_by_entity: body.context_stats?.rows_by_entity, lines: body.context_stats?.lines, tokens: [body.usage?.input_tokens, body.usage?.output_tokens], cost_usd: body.usage?.cost_usd, usage_row: usageRow ? { tokens: [usageRow.input_tokens, usageRow.output_tokens], cost_usd: Number(usageRow.cost_usd), business: usageRow.business_id === HL ? 'HomeLover' : 'other' } : null, withheld: !!body.withheld, items: items.length, people: people.slice(0, 10).map(p => `${p.title}${p.subtitle ? ` (${p.subtitle.split(' · ').pop()})` : ''}${p.score != null ? ` heat ${p.score}` : ''}`), ask: body.ask, answer: body.answer_md || '' };
    results.asks.push(rec);
    const costMatch = usageRow && rec.cost_usd != null && Math.abs(usageRow.cost_usd - rec.cost_usd) < 1e-6 && usageRow.input_tokens === rec.tokens[0] && usageRow.output_tokens === rec.tokens[1];
    const pii = hasPii(rec.answer) || items.some(i => hasPii(`${i.title} ${i.subtitle || ''} ${i.why || ''}`));
    ok(`"${q}" -> ${r.status} in ${elapsed} s · intent ${rec.intent} (expected ${expectIntent}) · reads [${(rec.reads || []).join(' ; ')}] · rows ${JSON.stringify(rec.rows_by_entity)} · tokens ${rec.tokens.join('/')} · $${rec.cost_usd} (usage row ${rec.usage_row ? `$${rec.usage_row.cost_usd} ${rec.usage_row.tokens.join('/')} ${rec.usage_row.business}` : 'missing'}) · withheld ${rec.withheld} · ${items.length} records (${people.length} people): ${rec.people.join(' · ')}`,
      r.status === 200 && rec.intent === expectIntent && costMatch && !rec.withheld && !pii && items.length > 0);
    if (q === ASKS[0][0]) {
      const named = people.filter(p => rec.answer.includes(p.title));
      const withCo = named.filter(p => p.subtitle && rec.answer.includes(p.subtitle.split(' · ').pop()));
      ok(`the first answer names people with company + heat: ${named.length} of ${people.length} people named, ${withCo.length} with their company, heat words ${/\b(hot|warm|cold|heat)\b/i.test(rec.answer)}, no screen named (${!SCREEN.test(rec.answer)}); answer: ${rec.answer.replace(/\s+/g, ' ').slice(0, 600)}`, named.length >= 1 && withCo.length >= 1 && /\b(hot|warm|cold|heat)\b/i.test(rec.answer) && !SCREEN.test(rec.answer));
    } else ok(`answer: ${rec.answer.replace(/\s+/g, ' ').slice(0, 300)}`, !SCREEN.test(rec.answer));
  }
  await new Promise(r => setTimeout(r, 300));
  ok(`A6: the server logged the intent beside each usage row: ${serverLog.map(l => l.replace(/user=\w+/, 'user=…').trim()).join(' | ')}`, serverLog.length === ASKS.length && serverLog.every(l => /intent=(people_visiting|people)/.test(l)));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  const after = await usageCount();
  ok(`Claude calls ${sent} (cap ${CLAUDE_CAP}); scout_ask usage rows ${before} -> ${after} (= the asks); Apollo 0 (no key on the server)`, sent <= CLAUDE_CAP && after - before === sent);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ ...results, before, after, when: new Date().toISOString() }, null, 2));
  const pass = results.checks.filter(c => c.pass).length;
  const total = results.asks.reduce((n, a) => n + (a.cost_usd || 0), 0);
  console.log(`\nscout-ask-routing-v1 live: ${pass}/${results.checks.length} checks · ${sent} Claude calls · $${total.toFixed(4)} · Apollo 0 · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log('restored: yes (0 writes of the script\'s own; the usage rows are the asks\' own cost log, kept; owner session released, last_seen_at restored, sign-in rows kept by rule)');
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  process.exit(results.errors.length || pass !== results.checks.length ? 1 : 0);
}
