// scout-v2 REV3 Stage 3 - REAL asks, live as Jack (ownerSession) on HomeLover, localhost against the build.
// Declared scope + cap (Jack, Nov 6): Claude 6 calls (the five spec asks + "who visited yesterday" on All workspaces),
// hard-refused in the browser past 6; Apollo 0 (the server runs without an Apollo key); writes: exactly one + Task row
// (POST goals/week), deleted by id at the end; every other non-GET API call is aborted. Reads: the asks' context reads,
// a few free searches, the usage rows for the cost check. ~120 s, cap 240 s.
// Per ask: reads, rows_by_entity, input / output tokens, cost_usd from the usage row (= the reply), withheld, elapsed.
// Open on one item of each kind lands on the record; the All-workspaces answer carries workspace tags; the core Scout
// files never name the other workspace (grep). Records are reported by title only; hasPii on everything shown.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { hasPii } = await import('../../api/sales/scrubText.js');
const OUT = path.join(ROOT, '.screenshots', 'scout-v2-stage3');
const PORT = 3993, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const CLAUDE_CAP = 6;
const ASKS = ['show me my open tasks', 'what do my notes say about Hilton', 'which partners did I touch this week', 'who visited yesterday and are they in Prospector', 'hot targets Brad referred, sorted by score'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const counts = async () => ({
  todos: (await svc.from('sales_week_goals').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count,
  scout_usage: (await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).eq('call_type', 'scout_ask')).count,
});
let srv, browser, owner, createdTodo = null;
const blocked = [], realCalls = [], asks = [], weekPosts = [];
const results = { checks: [], errors: [], asks: [], opens: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 400)}` : ''); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (createdTodo) { const r = await svc.from('sales_week_goals').delete().eq('id', createdTodo).eq('business_id', HL); log(`+ Task row ${createdTodo.slice(0, 8)} deleted by id: ${r.error ? r.error.message : 'ok'}`); createdTodo = null; }
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 230000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await counts();
const startIso = new Date().toISOString();
log('before', JSON.stringify(before));

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([k, v, bz, dd]) => {
    if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
    for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
    localStorage.setItem('prospector_auto_assay_disabled', '1');
  }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
  await ctx.route('**/*', async route => {
    const req = route.request(); const u = new URL(req.url());
    if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
    const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
    if (isLocal && req.method() === 'POST' && u.pathname === '/api/scout/ask') {
      if (asks.length >= CLAUDE_CAP) { blocked.push('POST /api/scout/ask (over the cap)'); return route.abort(); }
      asks.push(JSON.parse(req.postData() || '{}').q);
      return route.continue();
    }
    if (isLocal && req.method() === 'POST' && u.pathname === `/api/sales/${HL}/goals/week` && weekPosts.length === 0) { weekPosts.push(req.postData()); return route.continue(); }
    const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
    const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
    if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
  await page.goto(`${BASE}/?business=${HL}`);
  const bar = page.locator('.scout-bar input').first();
  await bar.waitFor(); await page.waitForTimeout(2500);

  const runAsk = async (q, label) => {
    await bar.click(); await bar.fill(q); await page.waitForTimeout(400);
    const t = Date.now();
    const respP = page.waitForResponse(r => r.url().endsWith('/api/scout/ask') && r.request().method() === 'POST', { timeout: 90000 });
    await page.keyboard.press('Enter');
    const resp = await respP;
    const body = await resp.json().catch(() => ({}));
    await page.locator('[data-scout-answer], [data-scout-edge]').first().waitFor({ timeout: 15000 });
    const wall = Math.round((Date.now() - t) / 100) / 10;
    await page.waitForTimeout(400);
    const ui = await page.evaluate(() => ({ footer: document.querySelector('[data-scout-footer]')?.textContent || '', edge: document.querySelector('[data-scout-edge]')?.dataset.scoutEdge || null, shown: document.querySelector('.scout')?.textContent || '', tags: [...new Set([...document.querySelectorAll('[data-scout-answer] .scout-ws')].map(e => e.textContent))] }));
    const usageRow = (await svc.from('business_anthropic_usage').select('id, business_id, input_tokens, output_tokens, cost_usd, call_type').eq('call_type', 'scout_ask').eq('user_id', owner.userId).gte('created_at', startIso).order('created_at', { ascending: false }).limit(1)).data?.[0] || null;
    const items = body.items || [];
    const rec = {
      label, q, status: resp.status(), wall_s: wall,
      reads: body.context_stats?.reads || [], rows_by_entity: body.context_stats?.rows_by_entity || {}, dropped_pii: body.context_stats?.dropped_pii ?? null, truncated: body.context_stats?.truncated ?? null, chars: body.context_stats?.chars ?? null,
      input_tokens: body.usage?.input_tokens, output_tokens: body.usage?.output_tokens, cost_usd: body.usage?.cost_usd, withheld: !!body.withheld, items: items.length,
      by_entity: items.reduce((m, i) => ({ ...m, [i.entity]: (m[i.entity] || 0) + 1 }), {}), sort: body.ask?.sort || null,
      usage_row: usageRow ? { input_tokens: usageRow.input_tokens, output_tokens: usageRow.output_tokens, cost_usd: Number(usageRow.cost_usd), business: usageRow.business_id === HL ? 'HomeLover' : usageRow.business_id === null ? 'null (all)' : 'other' } : null,
      workspaces: [...new Set(items.map(i => i.workspace_name))], tags: ui.tags, edge: ui.edge,
      titles: items.slice(0, 6).map(i => `${i.entity}: ${i.title}`), answer: body.answer_md || '',
      pii_shown: hasPii(body.answer_md || '') || items.some(i => hasPii(`${i.title} ${i.subtitle || ''} ${i.why || ''}`)) || hasPii(ui.shown),
      _items: items,
    };
    results.asks.push(rec);
    await page.screenshot({ path: path.join(OUT, `${label}.png`), clip: await page.evaluate(() => { const r = document.querySelector('[data-scout-pop]')?.getBoundingClientRect() || document.body.getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: 0, width: Math.min(window.innerWidth, r.right + 8) - Math.max(0, r.left - 8), height: r.bottom + 8 }; }) });
    const costMatch = rec.usage_row && rec.cost_usd != null && Math.abs(rec.usage_row.cost_usd - rec.cost_usd) < 1e-6 && rec.usage_row.input_tokens === rec.input_tokens && rec.usage_row.output_tokens === rec.output_tokens;
    ok(`${label} "${q}": ${rec.status}, ${rec.items} records ${JSON.stringify(rec.by_entity)}, reads [${rec.reads.join(' ; ')}], rows ${JSON.stringify(rec.rows_by_entity)}, tokens ${rec.input_tokens}/${rec.output_tokens}, $${rec.cost_usd} (usage row ${rec.usage_row ? `$${rec.usage_row.cost_usd} · ${rec.usage_row.business}` : 'missing'}), withheld ${rec.withheld}, dropped_pii ${rec.dropped_pii}, ${rec.wall_s} s, sort ${rec.sort}`,
      rec.status === 200 && costMatch && !rec.pii_shown);
    return rec;
  };

  for (const [i, q] of ASKS.entries()) await runAsk(q, `ask${i + 1}`);

  // Open on one item of each kind: reopen its turn from the thread (no new ask), press Open, check the landing.
  const kinds = new Map();
  for (const a of results.asks) for (const it of a._items) if (!kinds.has(it.entity) && it.open) kinds.set(it.entity, { it, q: a.q });
  const landing = async it => page.evaluate(({ e, id, title }) => {
    const qs = s => document.querySelector(s);
    const url = new URL(location.href);
    if (e === 'todos') return { ok: !!qs(`[data-detail="todo-${id}"]`), where: `Actions (${url.searchParams.get('tab')})` };
    if (['partners', 'employers', 'targets', 'clients'].includes(e)) { const w = qs('[data-center-window]'); return { ok: !!w && !!w.querySelector('[data-company-panel]') && w.textContent.includes(title), where: 'company window' }; }
    if (e === 'people') { const d = [...document.querySelectorAll('[data-person-detail]')].find(x => x.dataset.personDetail === id || x.textContent.includes(title)); return { ok: !!d, where: 'People card' }; }
    if (e === 'accounts') return { ok: !!qs(`#acct-${id}`), where: 'Accounts' };
    const inline = [...document.querySelectorAll('.scout-records li.is-inline')].some(li => li.textContent.includes(title));
    return { ok: inline, where: `inline in Scout + list ${url.searchParams.get('tab')}${url.searchParams.get('view') ? `/${url.searchParams.get('view')}` : ''}${url.searchParams.get('channel') ? ` (${url.searchParams.get('channel')})` : ''}` };
  }, { e: it.entity, id: it.id, title: it.title });
  for (const [entity, { it, q }] of kinds) {
    await bar.click(); await page.waitForTimeout(300);
    const cur = await page.locator('[data-scout-answer] .scout-head').textContent().catch(() => '');
    if (!cur.includes(q)) { await page.locator('.scout-turn').filter({ hasText: q }).getByRole('button', { name: 'reopen' }).click(); await page.waitForTimeout(300); }
    await page.getByRole('button', { name: `Open ${it.title}`, exact: true }).first().click();
    await page.waitForTimeout(3000);
    const l = await landing(it);
    results.opens.push({ entity, title: it.title, ...l });
    ok(`Open ${entity} "${it.title}" -> ${l.where}`, l.ok);
    await page.keyboard.press('Escape');
    await page.locator('[data-center-window] button[aria-label^="Close"]').first().click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  // + Task once, on a company-shaped record if one came back (linked), then deleted by id in teardown.
  {
    const all = results.asks.flatMap(a => a._items.map(it => ({ it, q: a.q })));
    const pick = all.find(x => ['partners', 'employers', 'targets', 'clients'].includes(x.it.entity)) || all[0];
    if (pick) {
      await bar.click(); await page.waitForTimeout(300);
      const cur = await page.locator('[data-scout-answer] .scout-head').textContent().catch(() => '');
      if (!cur.includes(pick.q)) { await page.locator('.scout-turn').filter({ hasText: pick.q }).getByRole('button', { name: 'reopen' }).click(); await page.waitForTimeout(300); }
      const respP = page.waitForResponse(r => r.url().endsWith(`/api/sales/${HL}/goals/week`) && r.request().method() === 'POST');
      await page.getByRole('button', { name: `Add a task for ${pick.it.title}`, exact: true }).first().click();
      const resp = await respP; const j = await resp.json().catch(() => ({}));
      createdTodo = j.goal?.id || null;
      const row = createdTodo ? (await svc.from('sales_week_goals').select('kind, status, text, owner_user_id, link_type, link_id').eq('id', createdTodo).maybeSingle()).data : null;
      await page.waitForTimeout(400);
      ok(`+ Task on ${pick.it.entity} "${pick.it.title}": ${resp.status()}, row ${row ? `${row.kind}/${row.status} "${row.text}" owner=Jack ${row.owner_user_id === owner.userId} link ${row.link_type || 'none'}` : 'missing'}; note "${await page.locator('.scout-note[role=status]').textContent().catch(() => '')}"`, resp.status() < 300 && row && row.owner_user_id === owner.userId);
    }
  }

  // All workspaces + "who visited yesterday" (the 6th and last Claude call).
  await bar.click(); await page.waitForTimeout(300);
  await page.locator('[data-scout-scope]').first().click();
  await page.locator('.scout-scope-list').getByRole('option', { name: 'All workspaces', exact: true }).click();
  await page.waitForTimeout(300);
  const all = await runAsk('who visited yesterday', 'ask6-all');
  ok(`All workspaces: answer's workspaces ${all.workspaces.join(' · ')}, Workspace tags on its rows ${all.tags.join(' · ') || 'none'}, usage row business ${all.usage_row?.business}`, all.status === 200 && (all.items === 0 || all.tags.length > 0));
  // The other module's rows through a free search on All workspaces (each row's tag comes from its workspace).
  await bar.fill('a'); await bar.fill('co'); await page.locator('[data-scout-row]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  const searchTags = await page.evaluate(() => [...document.querySelectorAll('[data-scout-group]')].map(g => `${g.dataset.scoutGroup}: ${[...new Set([...g.querySelectorAll('.scout-ws')].map(t => t.textContent))].join('/')}`));
  await page.screenshot({ path: path.join(OUT, 'search-all-co.png'), clip: await page.evaluate(() => { const r = document.querySelector('[data-scout-pop]')?.getBoundingClientRect() || document.body.getBoundingClientRect(); return { x: Math.max(0, r.left - 8), y: 0, width: Math.min(window.innerWidth, r.right + 8) - Math.max(0, r.left - 8), height: r.bottom + 8 }; }) });
  ok(`All workspaces search "co": ${searchTags.join(' | ')}`, searchTags.length > 0);
  // Core Scout never names a workspace: the bar, its model / parts and the server core.
  const core = [...fs.readdirSync(path.join(ROOT, 'api/scout')).filter(f => f.endsWith('.js')).map(f => `api/scout/${f}`), ...fs.readdirSync(path.join(ROOT, 'src/components/scout')).filter(f => f.endsWith('.js') && !f.includes('.test.')).map(f => `src/components/scout/${f}`), 'src/components/ScoutCommandBar.js', 'src/components/PersistentScout.js'];
  const hits = core.filter(f => /humankind|hk_sales|\bhk_|#hk\/|homelover/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  ok(`grep: ${core.length} core Scout files name no workspace (${hits.join(', ') || 'none'})`, hits.length === 0);
  ok(`no page errors (${errors.length})`, !errors.length, errors.join(' | '));
  ok(`Claude calls ${asks.length} (cap ${CLAUDE_CAP}); browser reached Claude / Apollo hosts ${realCalls.length}; blocked ${[...new Set(blocked)].join(', ') || 'none'}`, asks.length <= CLAUDE_CAP && !realCalls.length);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  const after = await counts();
  log('after', JSON.stringify(after));
  ok(`writes: sales_week_goals ${before.todos} -> ${after.todos} (the + Task row deleted by id); scout_ask usage rows ${before.scout_usage} -> ${after.scout_usage} (= ${asks.length} asks)`, after.todos === before.todos && after.scout_usage - before.scout_usage === asks.length);
  const total = results.asks.reduce((n, a) => n + (a.cost_usd || 0), 0);
  for (const a of results.asks) delete a._items;
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ ...results, before, after, total_cost_usd: total }, null, 2));
  const pass = results.checks.filter(c => c.pass).length;
  console.log(`\n${pass}/${results.checks.length} checks · ${Math.round((Date.now() - T0) / 1000)} s · ${asks.length} Claude calls · $${total.toFixed(4)} · errors ${results.errors.length}`);
  console.log(`restored: ${after.todos === before.todos ? 'yes (the one + Task row deleted by id; usage rows are the asks\' own cost log, kept)' : 'CHECK - sales_week_goals moved'}`);
  process.exit(results.errors.length || pass !== results.checks.length ? 1 : 0);
}
