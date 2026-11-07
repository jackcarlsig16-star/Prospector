// scout-v2 REV3 Stage 2 check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover workspace.
// Scope (declared): one local server; GET /api/scout/search through the real wiring ~8 times (each = the registered
// entity reads, ILIKE, ≤ 8 rows a group); POST /api/scout/ask is answered in the BROWSER from a fixture built from real
// open to-do titles (0 Claude: the server also runs with no Anthropic key; the real asks are Stage 3); 0 Apollo; 0
// writes - every non-GET API call except the intercepted ask is aborted, + Task is never pressed. Reads by the service
// key: open to-dos (titles, due dates) for the fixture + the before / after counts. Cap: 4 min.
// Shots: the mockup states (specs/design/scout-v2) beside the build at 1440 (idle · focused · typing · scope all · plain;
// working · answer · no hits · withheld · daily cap · viewer) and 390 (sheet · results · answer) -> side-by-side PNGs in
// .screenshots/scout-v2-stage2/; axe 0 on the bar, the results, the answer and the sheet; N2 = 0 px sideways at both.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(import.meta.url);
require('dotenv').config({ path: path.join(ROOT, '.env') });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const OUT = path.join(ROOT, '.screenshots', 'scout-v2-stage2');
const MOCK = path.join(ROOT, 'specs', 'design', 'scout-v2');
const PORT = 3994, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
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
let srv, browser, owner;
const blocked = [], realCalls = [], searches = [], asksIntercepted = [];
const results = { checks: [], errors: [], axe: {}, n2: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 230000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await counts();
log('before', JSON.stringify(before));

// The answer fixture: real open to-do titles + due dates (no address can be in a title the server already scrubs; the
// hasPii check below re-proves it), real openers, fixture prose / usage (labelled as such in the report).
const todoRows = (await svc.from('sales_week_goals').select('id, text, due_date').eq('business_id', HL).eq('kind', 'todo').eq('status', 'open').not('due_date', 'is', null).order('due_date').limit(4)).data || [];
const { hasPii } = await import('../../api/sales/scrubText.js');
const ANSWER = q => ({
  answer_md: `You have **${todoRows.length} open tasks** with a due date. Sorted by due date.`,
  items: todoRows.map(r => ({ entity: 'todos', id: r.id, title: r.text.slice(0, 140), date: r.due_date, workspace_id: HL, workspace_name: 'HomeLover', open: { page: 'sales', params: { tab: 'actions', open: `todo:${r.id}` } }, why: `open to-do · due ${r.due_date}` })),
  usage: { input_tokens: 4100, output_tokens: 210, cost_usd: 0.0155 }, withheld: false, ask: { sort: null, mine: true, entity: 'todos' },
  context_stats: { reads: [`openTodos (${todoRows.length} open, mine)`, 'standing: notes 14 d', 'standing: companies touched 14 d'], rows_by_entity: { todos: todoRows.length, call_notes: 2, partners: 25 } },
  cap: { used: 1, max: 40 }, scope: HL, q,
});

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  // One request through the real wiring before the browser: the search route answers for HomeLover, no address in it.
  const direct = await fetch(`${BASE}/api/scout/search?q=Clou&scope=${HL}`, { headers: { cookie } });
  const dj = await direct.json();
  ok(`GET /api/scout/search?q=Clou (real wiring) ${direct.status}: ${dj.groups?.map(g => `${g.entity} ${g.items.length}`).join(' · ')}`, direct.status === 200 && dj.groups?.length > 0);
  // What a person reads (titles, subtitles, the fixture's prose and why lines) - ids are uuids whose digit runs aren't contact details.
  const shown = [...dj.groups.flatMap(g => g.items.map(i => `${i.title} ${i.subtitle || ''}`)), ANSWER('x').answer_md, ...ANSWER('x').items.map(i => `${i.title} ${i.why}`)];
  ok(`no address / phone in what Scout shows (${shown.length} lines)`, shown.every(t => !hasPii(t)));
  browser = await chromium.launch();

  async function open(width, { viewer = false, ask = 'answer' } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    const state = { ask, hold: null };
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && u.pathname === '/api/scout/search') searches.push(u.search);
      if (isLocal && u.pathname === '/api/scout/ask') {
        const body = JSON.parse(req.postData() || '{}');
        asksIntercepted.push(body.q);
        if (state.ask === 'hold') { await new Promise(r => { state.hold = r; }); }
        if (state.ask === 'withheld') return route.fulfill({ json: { ...ANSWER(body.q), withheld: true, answer_md: 'Answer withheld: it contained an address or phone number.', items: [] } });
        if (state.ask === 'cap') return route.fulfill({ status: 429, json: { error: 'Scout has answered 40 questions for you today.', cap: 40, used: 40 } });
        return route.fulfill({ json: ANSWER(body.q) });
      }
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      if (viewer && isLocal && u.pathname === '/api/me') {
        const r = await route.fetch(); const j = await r.json();
        j.profile = { ...j.profile, is_platform_owner: false };
        j.memberships = (j.memberships || []).map(m => (m.business_id === HL ? { ...m, role: 'viewer' } : m));
        return route.fulfill({ response: r, json: j });
      }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?business=${HL}`);
    await page.locator(width < 900 ? 'button.scout-star-btn' : '.scout-bar input').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500);
    return { ctx, page, errors, state };
  }
  const axeOn = async (page, key, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => { const r = await window.axe.run(document.querySelector(s) || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); }, sel);
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const n2 = async (page, key) => {
    const px = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
    results.n2[key] = px;
    ok(`N2 ${key}: ${px} px sideways`, px === 0);
  };
  // A shot of the header plus whatever Scout shows under it.
  const shot = async (page, file, extra = '[data-scout-pop]') => {
    const box = await page.evaluate(sel => {
      const els = [document.querySelector('[data-workspace-header]') || document.querySelector('.scout'), ...document.querySelectorAll(sel)].filter(Boolean);
      const rs = els.map(e => e.getBoundingClientRect());
      const x = Math.min(...rs.map(r => r.left)), y = Math.min(...rs.map(r => r.top)), r2 = Math.max(...rs.map(r => r.right)), b = Math.max(...rs.map(r => r.bottom));
      return { x: Math.max(0, x - 8), y: Math.max(0, y - 8), width: Math.min(window.innerWidth, r2 + 8) - Math.max(0, x - 8), height: b - y + 16 };
    }, extra);
    await page.screenshot({ path: path.join(OUT, file), clip: box, animations: 'disabled' });
  };
  const bar = page => page.locator('.scout-bar input').first();
  const waitRows = page => page.locator('[data-scout-row]').first().waitFor({ timeout: 20000 });

  // ---- 1440
  {
    const { ctx, page, errors, state } = await open(1440);
    const w0 = await page.evaluate(() => Math.round(document.querySelector('.scout-bar').getBoundingClientRect().width));
    await shot(page, 'build-idle.png', '.scout-bar');
    ok(`B1 idle: compact bar ${w0} px with the ⌘K chip`, w0 === 300 && await page.locator('.scout-bar kbd').count() === 1);
    await bar(page).click(); await page.waitForTimeout(400);
    const f = await page.evaluate(() => ({ w: Math.round(document.querySelector('.scout-bar').getBoundingClientRect().width), ring: getComputedStyle(document.querySelector('.scout-bar')).borderTopColor, pill: document.querySelector('[data-scout-scope]')?.textContent, selects: document.querySelectorAll('.scout select').length }));
    await shot(page, 'build-focused.png', '.scout-bar');
    ok(`B2 focused: ${f.w} px, neon edge ${f.ring}, scope pill "${f.pill}", <select> in Scout ${f.selects}`, f.w === 560 && f.ring === 'rgb(57, 255, 20)' && /HomeLover/.test(f.pill) && f.selects === 0);
    await bar(page).fill('Clou'); await waitRows(page); await page.waitForTimeout(300);
    const r = await page.evaluate(() => ({ groups: [...document.querySelectorAll('[data-scout-group]')].map(g => g.dataset.scoutGroup), marks: [...document.querySelectorAll('.scout-row mark')].map(m => [m.textContent, getComputedStyle(m).color]), active: document.querySelector('.scout-row.is-active')?.textContent, popW: Math.round(document.querySelector('[data-scout-pop]').getBoundingClientRect().width) }));
    await shot(page, 'build-typing.png');
    ok(`B3 typing "Clou": groups ${r.groups.join(' · ')}, ${r.marks.length} neon marks (${r.marks[0]?.[1]}), first row active "${r.active?.slice(0, 40)}", popover ${r.popW} px`, r.groups.length > 0 && r.marks.length > 0 && r.marks.every(m => m[1] === 'rgb(57, 255, 20)') && !!r.active && r.popW === 560);
    await axeOn(page, 'results@1440', '.scout');
    await n2(page, 'results@1440');
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150);
    const moved = await page.evaluate(() => [...document.querySelectorAll('[data-scout-row]')].findIndex(e => e.classList.contains('is-active')));
    ok(`keyboard: ↓ moves the active row to ${moved}`, moved === 1);
    await page.locator('[data-scout-scope]').click(); await page.locator('.scout-scope-list').getByRole('option', { name: 'All workspaces', exact: true }).click(); await page.waitForTimeout(600);
    await bar(page).fill('Clo'); await bar(page).fill('Clou'); await waitRows(page); await page.waitForTimeout(600);
    const tags = await page.evaluate(() => [...new Set([...document.querySelectorAll('.scout-ws')].map(t => t.textContent))]);
    await shot(page, 'build-scope-all.png');
    ok(`B3 scope = All workspaces: workspace tags ${tags.join(' · ')}; remembered ${await page.evaluate(() => localStorage.getItem('prospector_scout_scope'))}`, tags.length >= 1);
    await page.locator('[data-scout-scope]').click(); await page.locator('.scout-scope-list').getByRole('option', { name: 'HomeLover', exact: true }).click(); await page.waitForTimeout(300);
    // Ask: working (held), then the answer.
    state.ask = 'hold';
    await bar(page).fill('show me my open tasks'); await page.waitForTimeout(350); await page.keyboard.press('Enter');
    await page.locator('[data-scout-working]').waitFor(); await page.waitForTimeout(1300);
    await shot(page, 'build-working.png');
    const el = await page.locator('[data-scout-elapsed]').textContent();
    ok(`D13 working: bar sweep ${await page.locator('.scout-think').count()}, panel sweep ${await page.locator('.scout-sweep').count()}, elapsed "${el}"`, /\d+ s/.test(el));
    state.ask = 'answer'; state.hold();
    await page.locator('[data-scout-answer]').waitFor(); await page.waitForTimeout(500);
    const a = await page.evaluate(() => ({ w: Math.round(document.querySelector('[data-scout-pop]').getBoundingClientRect().width), sort: document.querySelector('.scout-sortmark')?.textContent, sortColor: getComputedStyle(document.querySelector('.scout-sortmark') || document.body).color, rows: document.querySelectorAll('[data-scout-answer] tbody tr[data-row]').length, open: document.querySelectorAll('[data-scout-answer] button[aria-label^="Open "]').length, task: document.querySelectorAll('[data-scout-answer] button[aria-label^="Add a task"]').length, foot: document.querySelector('[data-scout-footer]')?.textContent, thread: document.querySelector('.scout-turn.is-now')?.textContent }));
    await shot(page, 'build-answer.png');
    ok(`B4 answer: panel ${a.w} px, table ${a.rows} rows sorted "${a.sort}" in ${a.sortColor}, Open ${a.open} · Task ${a.task}, footer "${a.foot}", thread now "${a.thread}"`, a.w === 880 && a.rows === todoRows.length && a.sortColor === 'rgb(57, 255, 20)' && a.open === todoRows.length && a.task === todoRows.length && /records read/.test(a.foot));
    await axeOn(page, 'answer@1440', '.scout');
    await n2(page, 'answer@1440');
    // Open lands on the record: the to-do's detail row in Actions.
    await page.locator('[data-scout-answer] button[aria-label^="Open "]').first().click(); await page.waitForTimeout(2500);
    const landed = await page.evaluate(id => ({ url: location.search, detail: !!document.querySelector(`[data-detail="todo-${id}"]`) }), todoRows[0]?.id);
    ok(`B7 Open -> Actions with the to-do's detail open (${landed.detail}), ?open cleared (${landed.url})`, landed.detail && !/open=/.test(landed.url));
    // No hits.
    await bar(page).click(); await bar(page).fill('Zqxjvw Clouflare'); await page.locator('[data-scout-edge="nohits"]').waitFor(); await page.waitForTimeout(200);
    await shot(page, 'build-nohits.png');
    ok('B5 no hits panel', true);
    state.ask = 'withheld'; await page.getByRole('button', { name: /anyway/ }).click(); await page.locator('[data-scout-edge="withheld"]').waitFor();
    await shot(page, 'build-withheld.png');
    ok('B5 withheld panel (the answer text never shown)', !(await page.locator('.scout').textContent()).includes('Answer withheld: it contained'));
    state.ask = 'cap'; await bar(page).fill('who visited yesterday'); await page.waitForTimeout(350); await page.keyboard.press('Enter'); await page.locator('[data-scout-edge="cap"]').waitFor();
    await shot(page, 'build-cap.png');
    ok('B5 daily cap panel', true);
    ok(`no page errors at 1440 (${errors.length})`, !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 1440 as a Viewer (the /api/me reply downgraded): Open, no + Task, the read-only line.
  {
    const { ctx, page } = await open(1440, { viewer: true });
    await bar(page).click(); await bar(page).fill('show me my open tasks'); await page.waitForTimeout(350); await page.keyboard.press('Enter');
    await page.locator('[data-scout-answer]').waitFor(); await page.waitForTimeout(400);
    const v = await page.evaluate(() => ({ open: document.querySelectorAll('[data-scout-answer] button[aria-label^="Open "]').length, task: document.querySelectorAll('[data-scout-answer] button[aria-label^="Add a task"]').length, note: !!document.querySelector('[data-scout-viewer]') }));
    await shot(page, 'build-viewer.png');
    ok(`B5 Viewer: Open ${v.open}, + Task ${v.task}, read-only line ${v.note}`, v.open > 0 && v.task === 0 && v.note);
    await ctx.close();
  }
  // ---- 1440 plain mount (Workspaces home).
  {
    const { ctx, page } = await open(1440);
    await page.getByLabel('Workspace').selectOption({ value: '' }); await page.waitForTimeout(1500);
    await page.locator('.scout--plain input').click(); await page.waitForTimeout(300);
    const w = await page.evaluate(() => Math.round(document.querySelector('.scout--plain .scout-bar').getBoundingClientRect().width));
    await page.locator('.scout--plain').screenshot({ path: path.join(OUT, 'build-plain.png') });
    ok(`B1 plain mount: bar ${w} px (content width)`, w > 900);
    await n2(page, 'plain@1440');
    await ctx.close();
  }
  // ---- 390: the star, the sheet, results, the answer as cards.
  {
    const { ctx, page, errors } = await open(390);
    await page.screenshot({ path: path.join(OUT, 'build-390-header.png'), clip: { x: 0, y: 0, width: 390, height: 160 } });
    await page.locator('button.scout-star-btn').first().click(); await page.locator('[data-scout-sheet]').waitFor();
    await bar(page).fill('Clou'); await waitRows(page); await page.waitForTimeout(400);
    await page.locator('[data-scout-sheet]').screenshot({ path: path.join(OUT, 'build-390-results.png') });
    await axeOn(page, 'sheet-results@390', '[data-scout-sheet]');
    await n2(page, 'sheet@390');
    await bar(page).fill('show me my open tasks'); await page.waitForTimeout(350); await page.keyboard.press('Enter');
    await page.locator('[data-scout-answer]').waitFor(); await page.waitForTimeout(400);
    const c = await page.evaluate(() => ({ cards: document.querySelectorAll('[data-scout-sheet] .scout-card').length, table: document.querySelectorAll('[data-scout-sheet] table').length, sheetW: Math.round(document.querySelector('[data-scout-sheet]').getBoundingClientRect().width), barW: Math.round(document.querySelector('[data-scout-sheet] .scout-bar').getBoundingClientRect().width), inner: document.querySelector('[data-scout-sheet]').scrollWidth - document.querySelector('[data-scout-sheet]').clientWidth }));
    await page.locator('[data-scout-sheet]').screenshot({ path: path.join(OUT, 'build-390-answer.png') });
    ok(`B6 390 answer: ${c.cards} cards, ${c.table} tables, sheet ${c.sheetW} px, bar ${c.barW} px, inner sideways ${c.inner} px`, c.cards === todoRows.length && c.table === 0 && c.barW === 358 && c.inner === 0);
    await axeOn(page, 'sheet-answer@390', '[data-scout-sheet]');
    await n2(page, 'answer@390');
    ok(`no page errors at 390 (${errors.length})`, !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- The mockups' states, cropped, then side by side with the build.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const crop = async (file, label, out, { pick = 'next', width } = {}) => {
      await page.goto(`file://${path.join(MOCK, file)}`); await page.waitForTimeout(900);
      const box = await page.evaluate(([lbl, how]) => {
        const label = [...document.querySelectorAll('span, div')].find(e => e.textContent.trim() === lbl);
        const host = how === 'self' ? label : label.parentElement.nextElementSibling || label.nextElementSibling;
        const r = host.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      }, [label, pick]);
      await page.screenshot({ path: path.join(OUT, out), clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: width || box.width + 8, height: box.height + 8 }, fullPage: true });
    };
    await crop('ScoutBar.dc.html', '1 · Header, idle', 'mock-idle.png');
    await crop('ScoutBar.dc.html', '2 · Focused', 'mock-focused.png');
    await crop('ScoutBar.dc.html', '3 · Typing ≥ 2 chars', 'mock-typing.png');
    await crop('ScoutBar.dc.html', '4 · Scope = All my workspaces', 'mock-scope-all.png');
    await crop('ScoutBar.dc.html', '5 · Plain page mount', 'mock-plain.png');
    await crop('ScoutAsk.dc.html', '6 · Working', 'mock-working.png');
    await crop('ScoutAsk.dc.html', '7 · Answer', 'mock-answer.png');
    for (const [lbl, out] of [['No hits', 'mock-nohits.png'], ['Answer withheld', 'mock-withheld.png'], ['Daily cap', 'mock-cap.png'], ['Viewer', 'mock-viewer.png']]) {
      await page.goto(`file://${path.join(MOCK, 'ScoutAsk.dc.html')}`); await page.waitForTimeout(600);
      const b = await page.evaluate(l => { const e = [...document.querySelectorAll('.edge')].find(x => x.querySelector('.lbl')?.textContent === l); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }, lbl);
      await page.screenshot({ path: path.join(OUT, out), clip: b, fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`file://${path.join(MOCK, 'ScoutPhone.dc.html')}`); await page.waitForTimeout(900);
    const phoneBoxes = await page.evaluate(() => {
      const top = document.querySelector('x-dc > div > div');
      const kids = [...top.children];
      const r = e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; };
      return { header: r(kids[0]), sheet: r(kids[2]), answer: r(kids[4]) };
    });
    await page.screenshot({ path: path.join(OUT, 'mock-390-header.png'), clip: { x: 0, y: 0, width: 390, height: phoneBoxes.header.height + 8 }, fullPage: true });
    await page.screenshot({ path: path.join(OUT, 'mock-390-results.png'), clip: phoneBoxes.sheet, fullPage: true });
    await page.screenshot({ path: path.join(OUT, 'mock-390-answer.png'), clip: phoneBoxes.answer, fullPage: true });
    const b64 = f => fs.readFileSync(path.join(OUT, f)).toString('base64');
    const pairs = [['idle', 'ScoutBar 1 · idle'], ['focused', 'ScoutBar 2 · focused'], ['typing', 'ScoutBar 3 · typing'], ['scope-all', 'ScoutBar 4 · scope all'], ['plain', 'ScoutBar 5 · plain'], ['working', 'ScoutAsk 6 · working'], ['answer', 'ScoutAsk 7 · answer'], ['nohits', 'ScoutAsk 8 · no hits'], ['withheld', 'ScoutAsk 8 · withheld'], ['cap', 'ScoutAsk 8 · daily cap'], ['viewer', 'ScoutAsk 8 · viewer'], ['390-header', 'ScoutPhone · header'], ['390-results', 'ScoutPhone · sheet + results'], ['390-answer', 'ScoutPhone · answer']];
    const compose = await ctx.newPage();
    for (const [k, title] of pairs) {
      const narrow = k.startsWith('390');
      await compose.setViewportSize({ width: narrow ? 390 * 2 + 48 : 1440 * 2 + 48, height: 200 });
      await compose.setContent(`<body style="margin:0;background:#000;color:#fff;font:12px monospace"><div style="display:flex;gap:16px;align-items:flex-start;padding:16px"><figure style="margin:0"><figcaption style="padding:4px 0">mockup · ${title}</figcaption><img style="display:block;max-width:${narrow ? 390 : 1440}px" src="data:image/png;base64,${b64(`mock-${k}.png`)}"></figure><figure style="margin:0"><figcaption style="padding:4px 0">build · HomeLover as Jack · Stage 2</figcaption><img style="display:block;max-width:${narrow ? 390 : 1440}px" src="data:image/png;base64,${b64(`build-${k}.png`)}"></figure></div></body>`);
      await compose.waitForTimeout(300);
      await compose.screenshot({ path: path.join(OUT, `side-by-side-${k}.png`), fullPage: true });
    }
    ok(`${pairs.length} side-by-side PNGs written to .screenshots/scout-v2-stage2/`, true);
    await ctx.close();
  }
  ok(`0 Claude / Apollo hosts from the browser (${realCalls.length}); asks answered in the browser from the fixture (${asksIntercepted.length}); searches through the real wiring (${searches.length}); every other non-GET aborted (${[...new Set(blocked)].join(', ') || 'none attempted'})`, !realCalls.length);
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  const after = await counts();
  log('after', JSON.stringify(after));
  const same = after.todos === before.todos && after.scout_usage === before.scout_usage;
  ok(`writes: sales_week_goals ${before.todos} -> ${after.todos}, scout_ask usage rows ${before.scout_usage} -> ${after.scout_usage}`, same);
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ ...results, before, after, searches: searches.length, asks: asksIntercepted.length }, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks · ${Math.round((Date.now() - T0) / 1000)} s · errors ${results.errors.length}`);
  console.log(`restored: ${same ? 'yes (no writes)' : 'CHECK - a count moved'}`);
  process.exit(results.errors.length || pass !== results.checks.length ? 1 : 0);
}
