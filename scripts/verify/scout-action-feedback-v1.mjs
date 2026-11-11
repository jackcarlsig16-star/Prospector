// FIX scout-action-feedback-v1 - live, localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace. DECLARED before it runs:
//   F3      first: prod's main.js hash (asset-manifest.json on Render) must equal this build's, and HEAD must equal
//           origin/main - otherwise the run stops before the browser opens.
//   Claude  cap 1: ONE Write email open from a person row at 1440 (POST goals/compose, the panel's own call). Its
//           reply is cached in .screenshots/scout-action-feedback-v1/ledger.json with a spent counter: 390 and any
//           re-run replay it (0 Claude) and a second real compose call is REFUSED (aborted in the browser - the
//           company row's Draft email shows its line and the panel, the panel's draft request is cut).
//           The two answers on screen are replayed from Stage 3's cache (.screenshots/scout-v3/stage3/ledger.json):
//           0 asks.
//   Apollo  0 (the key is removed from the server's environment).
//   Writes  none. Every card is cancelled, never confirmed; /api/scout/act and /undo are not allowed through; the
//           quick capture is closed unsaved; nothing is sent. 1 usage row for the one compose call (kept). The owner
//           session is released; sign-in rows are kept by rule.
//   Scope   19 menu picks (person 8, company 7, task 4) at 1440 and again at 390 = 38 picks, ~38 POST /plan (no
//           write), 4 pack / bundle reads. ~150 s; cap 235 s.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { hasPii } = await import('../../api/sales/scrubText.js');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const OUT = path.join(ROOT, '.screenshots', 'scout-action-feedback-v1');
const PROD = 'https://prospector-chtj.onrender.com';
const PORT = 3993, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0], SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const CLAUDE_CAP = 1;
fs.mkdirSync(OUT, { recursive: true });
const LEDGER = path.join(OUT, 'ledger.json');
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { spent: 0, compose: {} };
const saveLedger = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
const asks = JSON.parse(fs.readFileSync(path.join(ROOT, '.screenshots', 'scout-v3', 'stage3', 'ledger.json'), 'utf8')).asks;
const ASK_ROWS = 'pull me 5 most important prospects who are visiting and hot and show 5 most important tasks', ASK_CO = 'pull the intel on our recent call with Northrop Grumman';
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const results = { checks: [], picks: [], blocked: [], claude_this_run: 0 };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 700)}` : ''); };
const finish = () => {
  results.ledger = { spent: ledger.spent, cap: CLAUDE_CAP };
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const failed = results.checks.filter(c => !c.pass);
  console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks · Claude this run ${results.claude_this_run} · spent in all ${ledger.spent} of ${CLAUDE_CAP} · Apollo 0 · writes 0 · restored: ${results.restored || 'n/a (stopped before the browser)'}`);
  process.exit(failed.length ? 1 : 0);
};

// ---- F3: Render is Live on this hash
const mainOf = m => m?.files?.['main.js'] || null;
const local = mainOf(JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'asset-manifest.json'), 'utf8')));
const prod = mainOf(await (await fetch(`${PROD}/asset-manifest.json`, { cache: 'no-store' })).json().catch(() => null));
const head = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(), remote = execSync('git ls-remote origin main', { cwd: ROOT }).toString().split(/\s/)[0];
results.deploy = { head: head.slice(0, 7), remote: remote.slice(0, 7), local_bundle: local, prod_bundle: prod };
ok(`F3: Render is Live on HEAD ${head.slice(0, 7)} (= origin/main) - prod serves ${prod}, this build is ${local}`, head === remote && !!local && local === prod, JSON.stringify(results.deploy));
if (!(head === remote && local && local === prod)) finish();

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const startIso = new Date().toISOString();
const count = async (table, f = q => q) => (await f(svc.from(table).select('*', { count: 'exact', head: true }).eq('business_id', HL))).count;
const counts = async () => ({ todos: await count('sales_week_goals'), flow: await count('sales_flow_events'), prospects_changed: await count('sales_prospect_state', q => q.gte('updated_at', startIso)), goals_changed: await count('sales_goals', q => q.gte('updated_at', startIso)), compose_usage: await count('business_anthropic_usage', q => q.eq('call_type', 'intent_compose')) });
const before = await counts();
log('before', JSON.stringify(before), `· Claude spent so far ${ledger.spent}/${CLAUDE_CAP}`);

let srv, browser, owner;
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 235000 });
const COMPOSE = /^\/api\/sales\/[^/]+\/goals\/compose\/((?:partner|employer|target)\/[0-9a-f-]+)$/;
const ALLOWED = ['/api/scout/plan', '/api/scout/pack'];

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();

  async function open(width, height) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && req.method() === 'POST' && u.pathname === '/api/scout/ask') {
        const q = JSON.parse(req.postData() || '{}').q;
        if (asks[q]) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(asks[q].body) });
        results.blocked.push('POST /api/scout/ask (not in the cache - no ask is declared)'); return route.abort();
      }
      const cm = isLocal && req.method() === 'POST' ? COMPOSE.exec(u.pathname) : null;
      if (cm) {
        if (ledger.compose[cm[1]]) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ledger.compose[cm[1]]) });
        if (ledger.spent >= CLAUDE_CAP) { results.blocked.push('POST goals/compose (would pass the cap of 1)'); return route.abort(); }
        ledger.spent += 1; results.claude_this_run += 1; saveLedger();
        const r = await route.fetch({ timeout: 90000 });
        const j = await r.json().catch(() => null);
        if (r.ok() && j?.draft) { ledger.compose[cm[1]] = j; saveLedger(); }
        return route.fulfill({ response: r, json: j });
      }
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname) && !ALLOWED.includes(u.pathname);
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { results.blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?business=${HL}`);
    return { ctx, page, errors };
  }
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 8000 }).catch(() => { (results.shots_skipped ||= []).push(name); });
  const n2 = page => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));

  // One pick: ⋯ on the row, the item (and the first choice of a submenu), then the settled line: its text, its kind,
  // how long it took to appear, and whether it sits inside the visible part of the panel.
  async function pick(page, w, kind, rowSel, id, input) {
    if (!(await page.locator('[data-scout-answer]').isVisible().catch(() => false))) { await input.click(); await page.locator('[data-scout-answer]').waitFor(); }
    const row = page.locator(rowSel).first();
    await row.scrollIntoViewIfNeeded();
    await row.locator('.scout-more-btn').click();
    await page.locator('.scout-menu').waitFor();
    const sub = { assign: 'members', snooze: 'dates' }[id];
    await page.locator(`.scout-menu [data-scout-pick="${id}"]`).click();
    if (sub) { await page.locator(`[data-scout-menu="${sub}"] [role="menuitem"]`).first().waitFor(); await page.locator(`[data-scout-menu="${sub}"] [role="menuitem"]`).first().click(); }
    const t = Date.now();
    await page.locator('[data-scout-actblock]').waitFor();
    const first_ms = Date.now() - t;
    const sweep = await page.locator('[data-scout-note="planning"] .scout-sweep').count();
    await page.waitForFunction(() => { const b = document.querySelector('[data-scout-actblock]'); return b && !b.querySelector('[data-scout-note="planning"]') && b.textContent.trim().length > 8; });
    await page.waitForTimeout(250);
    const line = await page.evaluate(() => {
      const b = document.querySelector('[data-scout-actblock]'), r = b.getBoundingClientRect();
      const pop = b.closest('[data-scout-pop]')?.getBoundingClientRect() || { top: 0, bottom: window.innerHeight };
      const what = b.querySelector('[data-scout-card]') ? 'card' : b.querySelector('[data-scout-cant]') ? 'cant' : b.querySelector('[data-scout-note]')?.getAttribute('data-scout-note') || 'other';
      const text = what === 'card' ? `${b.querySelector('.scout-confirm__title').textContent} · ${b.querySelector('[data-scout-card-foot]').textContent}` : what === 'cant' ? b.querySelector('.scout-edge-line').textContent : b.textContent.trim();
      return { what, text, in_view: r.height > 0 && r.top >= Math.max(0, pop.top) - 1 && r.bottom <= Math.min(window.innerHeight, pop.bottom) + 1 };
    });
    const rec = { w, row: kind, item: id, ...line, first_ms, sweep: sweep > 0, pii: hasPii(line.text) || line.text.includes('@') };
    if (line.what === 'card') await page.locator('.scout-confirm button', { hasText: 'Cancel' }).click();
    if (id === 'add_task') {
      rec.capture = await page.locator('input[aria-label="New task"]').inputValue({ timeout: 8000 }).catch(() => null);
      await page.locator('button[aria-label="Close quick capture"]').click({ timeout: 2000 }).catch(() => page.keyboard.press('Escape'));
    }
    if (id === 'bundle' || id === 'copy') { const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => ''); rec.clipboard = clip.length; rec.clip_pii = hasPii(clip) || clip.includes('@'); rec.clip_prompt = /Draft one first email to /.test(clip); }
    if (id === 'draft') {
      const panel = page.locator('aside[aria-label^="Write email"]');
      rec.panel = await panel.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
      if (rec.panel) {
        rec.panel_title = await panel.locator('h2').textContent();
        rec.panel_to = await panel.locator('[data-compose-to]').textContent().catch(() => null);
        await page.waitForFunction(() => !/Writing…/.test(document.querySelector('aside[aria-label^="Write email"]')?.textContent || ''), null, { timeout: 90000 }).catch(() => {});
        rec.panel_draft = await panel.locator('textarea').count() > 0;
        rec.panel_note = (await panel.locator('p').first().textContent()).replace(/\s+/g, ' ');
        await shot(page, `${kind}-draft-panel-${w}`);
        await panel.locator('button[aria-label="Close"]').click();
        await panel.waitFor({ state: 'detached' });
      }
    }
    results.picks.push(rec);
    log(`${w} ${kind} · ${id} -> [${rec.what}] ${rec.text}${rec.in_view ? '' : ' (NOT IN VIEW)'} · ${first_ms} ms${rec.clipboard != null ? ` · clipboard ${rec.clipboard} chars` : ''}${rec.panel != null ? ` · panel ${rec.panel ? `"${rec.panel_title}"${rec.panel_to ? ' + the person line' : ''}${rec.panel_draft ? ' + a draft' : ' (no draft: the call was not made)'}` : 'MISSING'}` : ''}`);
    return rec;
  }
  const ITEMS = { person: ['assign', 'add_task', 'contacted', 'not_fit', 'draft', 'bundle', 'snooze', 'copy'], company: ['assign', 'add_task', 'contacted', 'not_fit', 'draft', 'snooze', 'copy'], task: ['task:done', 'task:reassign', 'task:snooze', 'open'] };
  const good = r => r.text.length > 8 && r.in_view && !r.pii && r.first_ms <= 300
    && ({ assign: r.what === 'card' || r.what === 'cant', contacted: r.what === 'card' || r.what === 'cant', not_fit: r.what === 'card' || r.what === 'cant', snooze: r.what === 'card' || r.what === 'cant',
      add_task: r.what === 'opened' && r.text === 'Opened quick capture — save it there' && !!r.capture,
      draft: r.what === 'opened' && /^Opened Write email for .+( · address it to .+| — nothing sent)$/.test(r.text) && r.panel,
      bundle: r.what === 'copied' && /^✓ Copied the draft bundle for .+ · [\d,]+ chars — paste it into Claude$/.test(r.text) && Number(r.text.match(/· ([\d,]+) chars/)[1].replace(/,/g, '')) === r.clipboard && r.clip_prompt && !r.clip_pii,
      copy: r.what === 'copied' && /^✓ Copied · \d+ records? · [\d,]+ chars$/.test(r.text) && r.clipboard > 0 && !r.clip_pii,
      'task:done': r.what === 'opened' && /mark it done there$/.test(r.text), 'task:reassign': r.what === 'opened' && /reassign it there$/.test(r.text), 'task:snooze': r.what === 'opened' && /snooze it there$/.test(r.text), open: r.what === 'opened' && r.text === 'Opened the task in Actions' })[r.item];

  async function pass(w, h) {
    const phone = w < 900;
    const { ctx, page, errors } = await open(w, h);
    let input;
    if (phone) { await page.locator('button[aria-label="Search or ask Scout"]').first().click(); input = page.locator('[data-scout-sheet] input').first(); }
    else input = page.locator('.scout-bar input').first();
    await input.waitFor(); await page.waitForTimeout(phone ? 600 : 2500);
    const ask = async q => { await input.click(); await input.fill(q); await page.waitForTimeout(500); await page.keyboard.press('Enter'); await page.locator('[data-scout-answer]').waitFor(); await page.waitForTimeout(600); };
    const sel = { person: phone ? '[data-scout-section="1"] .scout-card' : '[data-scout-table="person"] tbody tr', task: phone ? '[data-scout-section="2"] .scout-card' : '[data-scout-table="task"] tbody tr', company: phone ? '[data-scout-cards] .scout-card' : '[data-scout-table="company"] tbody tr' };
    await ask(ASK_ROWS);
    const recs = [];
    for (const kind of ['person', 'task']) for (const id of ITEMS[kind]) recs.push(await pick(page, w, kind, sel[kind], id, input));
    await shot(page, `rows-last-line-${w}`);
    await page.addScriptTag({ content: AXE });
    const axe = await page.evaluate(async () => (await window.axe.run(document.querySelector('[data-scout-sheet]') || document.querySelector('.scout'), { resultTypes: ['violations'] })).violations.map(v => `${v.id} x${v.nodes.length}`));
    await ask(ASK_CO);
    for (const id of ITEMS.company) recs.push(await pick(page, w, 'company', sel.company, id, input));
    await shot(page, `company-last-line-${w}`);
    const bad = recs.filter(r => !good(r));
    for (const kind of ['person', 'company', 'task']) { const mine = recs.filter(r => r.row === kind); ok(`${w}: a ${kind} row - every one of its ${ITEMS[kind].length} menu items ends in its line, in view, first paint within 300 ms, no address or phone shape`, mine.length === ITEMS[kind].length && mine.every(good), JSON.stringify(mine.filter(r => !good(r)))); }
    const d = recs.find(r => r.row === 'person' && r.item === 'draft');
    ok(`${w}: Draft email on a person opens the Write email panel for their company with the person named in the panel, and the line says who to address`, d?.panel && / · address it to /.test(d.text) && !!d.panel_to && d.panel_draft, JSON.stringify(d));
    ok(`${w}: axe 0 on Scout with a result line showing · N2 0 px · no page error`, axe.length === 0 && (await n2(page)) === 0 && errors.length === 0, [...axe, ...errors].join(' | '));
    await ctx.close();
    return bad.length;
  }
  await pass(1440, 1000);
  await pass(390, 844);

  const after = await counts();
  results.counts = { before, after };
  ok(`counts: to-dos ${after.todos - before.todos} · flow events ${after.flow - before.flow} · prospect rows changed ${after.prospects_changed} · partner rows changed ${after.goals_changed} · compose usage rows +${after.compose_usage - before.compose_usage} (= real Write email calls this run ${results.claude_this_run}, cap ${CLAUDE_CAP})`, after.todos === before.todos && after.flow === before.flow && after.prospects_changed === 0 && after.compose_usage - before.compose_usage === results.claude_this_run && ledger.spent <= CLAUDE_CAP, JSON.stringify({ before, after }));
  results.restored = after.todos === before.todos && after.flow === before.flow && after.prospects_changed === 0 ? 'yes (nothing was written: no card was confirmed)' : 'CHECK';
  log(`blocked non-GET calls: ${results.blocked.length}${results.blocked.length ? ` (${[...new Set(results.blocked)].slice(0, 8).join(', ')})` : ''}`);
} catch (e) { ok('run completed', false, e.message.slice(0, 500)); }
finally { await cleanup(); }
finish();
