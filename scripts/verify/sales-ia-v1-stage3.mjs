// SUPERSEDED (sales-ia-v2 Stage 5): the v1 Today page (Your day / Focus 5 strip / glance / viewer cards) was replaced by the Actions list - do not run.
// sales-ia-v1 Stage 3 bar 4 - the quick capture "+" (Task / Note / Idea), keys, phone sheet. TEMP data only: 1 workspace, 2 temp users
// (owner, viewer), 1 to-do from Task mode, 1 call note + 1 to-do from Note mode, 1 idea in the browser's localStorage; all torn down via
// tempGuard. HomeLover: never opened, counts read before/after to prove it. 0 Apollo (sync/apollo requests aborted). 0 Claude: the extract
// route and the Ideas categorize proxy are answered by fixtures in the page (the Accept write and the Task write are real routes).
// Serves build/ (run npm run build first).
// Usage: node scripts/verify/sales-ia-v1-stage3.mjs <outdir>   ~2 min, cap 230 s.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const OUT = process.argv[2] || path.join(ROOT, 'build', 'verify-shots');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3973;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Sales IA Capture';
const WATCH = ['businesses', 'business_members', 'profiles', 'auth_events', 'sales_week_goals', 'sales_week_goal_steps', 'sales_call_notes', 'sales_goals', 'sales_targets', 'sales_opportunities'];
const HL = ['sales_week_goals', 'sales_week_goal_steps', 'sales_call_notes', 'sales_goals', 'sales_opportunities', 'sales_partner_events', 'business_members'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const counts = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER)).count; return o; };
let srv, browser, B, users = [], pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (B) {
    const { data: goals } = await svc.from('sales_week_goals').select('id').eq('business_id', B);
    if (goals?.length) await svc.from('sales_week_goal_steps').delete().in('goal_id', goals.map(g => g.id));
    for (const t of ['sales_week_goals', 'sales_call_notes', 'sales_targets', 'sales_partner_events', 'sales_opportunities', 'sales_goals', 'sales_week_report', 'auth_events', 'business_members']) await svc.from(t).delete().eq('business_id', B);
    await svc.from('businesses').delete().eq('id', B); B = null;
  }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
  users = [];
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 230000 });

const { laDateString } = await import(ROOT + '/api/sales/laDate.js');
const today = laDateString();
const TASK = 'Temp: capture task', NOTE_TASK = 'Temp: send the partner one-pager', IDEA = 'Temp idea: a joint webinar for broker partners';
const NOTES = 'Call with Brad (Upside). Alliant wants the partner one-pager before Tuesday. Roots booked a meeting for next week.';
let extractCalls = 0, categorizeCalls = 0;
const before = await counts(); const hlBefore = await hlCounts();
console.log('counts before', JSON.stringify(before)); console.log('HomeLover before', JSON.stringify(hlBefore));
fs.mkdirSync(OUT, { recursive: true });
const errsAll = [];
try {
  const tag = 'sia3-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://capture.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const mk = async (name, role) => {
    const email = `${tag}-${name}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert({ business_id: B, email, name: `${name} Test`, user_id: u.user.id, role }).select());
    const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(sErr.message);
    const u2 = { id: u.user.id, session: s.session }; users.push(u2); return u2;
  };
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const owner = await mk('Owner', 'owner'), viewer = await mk('Viewer', 'viewer');
  browser = await chromium.launch();

  const extractFixture = () => ({
    call_date: today, hash: 'fixture', summary: ['Alliant wants the partner one-pager before Tuesday'],
    tasks: [{ text: NOTE_TASK, owner_user_id: owner.id, due_date: null, link_type: null, link_id: null, company_name: null, steps: [], evidence: 'wants the partner one-pager', similar_to: null }],
    companies: [], people: [], touches: [], ownership: [], facts: [], categories: [], rejected: [],
  });
  async function newPage(u, { width = 1440, height = 900 } = {}) {
    const errs = [];
    const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR_FAILED|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
    await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
    await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, route => route.abort());
    await page.route(/\/goals\/call-notes\/extract$/, route => { extractCalls++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(extractFixture()) }); });
    await page.route(/\/proxy\/anthropic\/messages$/, route => { categorizeCalls++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: '{"category":"UX","priority":"Low","summary":"A joint webinar for broker partners"}' }] }) }); });
    await page.goto(`http://localhost:${PORT}/?tab=today`);
    try { await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 30000 }); }
    catch (e) { await page.screenshot({ path: `${OUT}/debug-fail.png` }); console.log('DEBUG body:', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400), '| errs:', errs.join(' | ')); throw e; }
    await page.waitForTimeout(1200);
    page.compact = width < 900;
    if (page.compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1500);
    if (page.compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    return { page, errs };
  }
  const tab = async (page, label) => { await page.locator('#workspace-header-tabs').getByRole('button', { name: new RegExp(`^${label}`) }).first().click(); await page.waitForTimeout(1800); };
  const sub = async (page, label) => { await page.locator('.ui-seg').getByRole('button', { name: label, exact: true }).first().click(); await page.waitForTimeout(1800); };
  const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false, animations: 'disabled', caret: 'hide' });
  const plus = page => page.locator('[data-capture-button]');
  const dialog = page => page.getByRole('dialog', { name: 'Quick capture' });
  const key = async (page, k) => { await page.keyboard.press(k); await page.waitForTimeout(400); };
  const modeOn = (page, label) => dialog(page).getByRole('button', { name: new RegExp(`^${label}`) }).getAttribute('aria-pressed');
  // Opening focuses the mode's text field, so a mode key needs focus elsewhere first (the header padding is nothing focusable).
  const blur = async page => { await dialog(page).locator('header').click({ position: { x: 4, y: 4 } }); await page.waitForTimeout(150); };

  // ── 1440 owner ──
  { const { page, errs } = await newPage(owner);
    await page.getByText('Your day').waitFor({ timeout: 15000 }); await plus(page).waitFor({ timeout: 15000 }); await page.waitForTimeout(500);
    const scoutBox = await page.getByLabel('Scout', { exact: true }).first().boundingBox(), plusBox = await plus(page).boundingBox();
    ok('header: one "+" right after Scout, in the sticky header row', (await plus(page).count()) === 1 && plusBox && scoutBox && plusBox.x > scoutBox.x + scoutBox.width - 1 && Math.abs(plusBox.y + plusBox.height / 2 - (scoutBox.y + scoutBox.height / 2)) < 12 && (await plus(page).evaluate(b => !!b.closest('[data-workspace-header]'))), `plus ${JSON.stringify(plusBox)} scout ${JSON.stringify(scoutBox)}`);
    // Task mode: click "+", type, Enter (2 interactions to save).
    await plus(page).click(); await page.waitForTimeout(500);
    const box = await dialog(page).boundingBox();
    ok('Task: "+" opens a centered 560px panel in Task mode with focus in the task field', (await dialog(page).count()) === 1 && Math.round(box.width) === 560 && Math.abs(box.x + box.width / 2 - 720) < 2 && (await modeOn(page, 'Task')) === 'true' && (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'New task', `w=${box?.width} cx=${box ? box.x + box.width / 2 : '?'}`);
    await shot(page, 'capture-task-1440');
    await page.getByLabel('New task', { exact: true }).fill(TASK); await page.waitForTimeout(300);
    await page.getByLabel('Due date of the new task', { exact: true }).fill(today);
    await page.getByLabel('New task', { exact: true }).press('Enter'); await page.waitForTimeout(1500);
    const { data: made } = await svc.from('sales_week_goals').select('id, text, kind, owner_user_id, due_date, status').eq('business_id', B).eq('text', TASK);
    ok('Task: Enter → "Added: …" and one this-week to-do in the DB (owner = me, due today)', (await dialog(page).getByText(`Added: ${TASK}`).count()) === 1 && made?.length === 1 && made[0].kind === 'todo' && made[0].owner_user_id === owner.id && made[0].due_date === today && made[0].status === 'open', JSON.stringify(made));
    await key(page, 'Escape');
    ok('Esc closes the panel', (await dialog(page).count()) === 0);
    await tab(page, 'Pipeline'); await tab(page, 'Today'); await page.getByText('Your day').waitFor({ timeout: 15000 }); await page.waitForTimeout(800);
    ok('Task shows on Today under Due today', (await page.locator('[aria-label="Due today"]').getByText(TASK).count()) === 1);
    await page.getByRole('button', { name: /^Open tasks/i }).first().click(); await page.waitForTimeout(1500);
    ok('Task shows in the Tasks drawer', (await page.getByRole('dialog', { name: 'Tasks' }).getByText(TASK).count()) === 1 || (await page.locator('aside').getByText(TASK).count()) === 1);
    await key(page, 'Escape'); await page.waitForTimeout(300);
    // Keys: C is inert while typing (Scout's field), opens from the page; N switches mode.
    await page.getByLabel('Scout', { exact: true }).first().click(); await page.keyboard.type('c'); await page.waitForTimeout(400);
    ok('C while focus is in Scout: types a "c", no panel', (await dialog(page).count()) === 0 && (await page.getByLabel('Scout', { exact: true }).first().inputValue()) === 'c');
    await page.getByLabel('Scout', { exact: true }).first().fill(''); await key(page, 'Escape'); await page.mouse.click(720, 600); await page.waitForTimeout(300);
    await key(page, 'c');
    ok('C from the page opens the panel', (await dialog(page).count()) === 1);
    await blur(page); await key(page, 'n');
    ok('N (focus not in a field) → Note mode = Intake, paste box focused', (await modeOn(page, 'Note')) === 'true' && (await dialog(page).getByText('Intake · paste any notes').count()) === 1 && (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Call notes');
    await shot(page, 'capture-note-1440');
    await page.getByLabel('Call notes', { exact: true }).fill(NOTES); await page.waitForTimeout(200);
    await page.keyboard.press('n'); await page.waitForTimeout(200);
    ok('typing "n" inside the notes box stays in Note mode (mode keys inert in fields)', (await modeOn(page, 'Note')) === 'true' && (await page.getByLabel('Call notes', { exact: true }).inputValue()) === NOTES + 'n');
    await page.getByLabel('Call notes', { exact: true }).fill(NOTES);
    await key(page, 'Escape');
    ok('Esc with pasted notes keeps the panel (Cancel throws them away, not a stray Esc)', (await dialog(page).count()) === 1);
    await dialog(page).getByRole('button', { name: 'Read notes' }).click(); await page.waitForTimeout(1200);
    ok('Read notes → review (extract answered by the fixture, 0 Claude), one proposal ticked', (await dialog(page).getByText(/Review · nothing is saved until Accept/).count()) === 1 && (await dialog(page).getByRole('button', { name: `Create: ${NOTE_TASK}` }).getAttribute('aria-pressed')) === 'true' && extractCalls === 1);
    await shot(page, 'capture-note-review-1440');
    await dialog(page).getByRole('button', { name: 'Accept 1' }).click(); await page.waitForTimeout(2500);
    const { data: notes } = await svc.from('sales_call_notes').select('id, title, call_date, source_type').eq('business_id', B);
    const { data: fromNote } = await svc.from('sales_week_goals').select('id, text, source_note_id, owner_user_id').eq('business_id', B).eq('text', NOTE_TASK);
    ok('Accept → the real call-notes write: 1 note + 1 to-do linked to it; panel closes; Tasks drawer opens showing it', notes?.length === 1 && fromNote?.length === 1 && fromNote[0].source_note_id === notes[0].id && fromNote[0].owner_user_id === owner.id && (await dialog(page).count()) === 0 && (await page.locator('aside').getByText(NOTE_TASK).count()) === 1, `notes=${notes?.length} goals=${fromNote?.length} drawer=${await page.locator('aside').getByText(NOTE_TASK).count()}`);
    await shot(page, 'capture-note-saved-drawer-1440');
    await key(page, 'Escape'); await page.waitForTimeout(300);
    // Idea mode → the browser-only Ideas store → the Ideas page.
    await key(page, 'c'); await blur(page); await key(page, 'i');
    ok('I → Idea mode says "Saves to Ideas on this browser"', (await modeOn(page, 'Idea')) === 'true' && (await dialog(page).getByText('Saves to Ideas on this browser').count()) === 1);
    await shot(page, 'capture-idea-1440');
    await page.getByLabel('Idea', { exact: true }).fill(IDEA);
    await dialog(page).getByRole('button', { name: 'Save idea ⌘↵' }).click(); await page.waitForTimeout(800);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('prospector_golden_nuggets') || '[]'));
    ok('Save idea → exactly one item in prospector_golden_nuggets, in the Ideas shape (categorize answered by the fixture, 0 Claude)', (await dialog(page).getByText('Saved to Ideas on this browser').count()) === 1 && stored.length === 1 && stored[0].text === IDEA && stored[0].category === 'UX' && stored[0].status === 'pending' && Array.isArray(stored[0].upvotes) && categorizeCalls === 1, `${stored.length} stored; categorize=${categorizeCalls}`);
    await key(page, 'Escape');
    await page.locator('#root').getByRole('button', { name: /^Ideas/ }).first().click(); await page.waitForTimeout(1200);
    ok('Ideas page (same browser) lists the idea', (await page.locator('#main-content').getByText(IDEA).count()) >= 1);
    await shot(page, 'ideas-page-1440');
    ok('Ideas page (app-level view): no "+" in a header', (await plus(page).count()) === 0);
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2000);
    // Landmine: the Weekly report PDF still prints.
    await tab(page, 'Reports'); await sub(page, 'Scorecard');
    await page.getByRole('button', { name: 'Export', exact: true }).click(); await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: 'Weekly report PDF' }).click(); await page.waitForTimeout(1200);
    ok('Export › Weekly report PDF still prints once with one print area', (await page.evaluate(() => window.__prints)) === 1 && (await page.locator('#sales-analytics-print-area').count()) === 1, `prints=${await page.evaluate(() => window.__prints)}`);
    ok('1440: no sideways page scroll', await noScroll(page));
    errsAll.push(...errs.map(e => `owner 1440: ${e}`)); await page.context().close(); }

  // ── Viewer ──
  { const { page, errs } = await newPage(viewer);
    await page.getByLabel('Latest report').waitFor({ timeout: 15000 }); await page.waitForTimeout(1500);
    await page.mouse.click(720, 600); await key(page, 'c');
    ok('viewer: no "+" in the header, C does nothing', (await plus(page).count()) === 0 && (await dialog(page).count()) === 0);
    errsAll.push(...errs.map(e => `viewer: ${e}`)); await page.context().close(); }

  // ── 390 owner: bottom sheet ──
  { const { page, errs } = await newPage(owner, { width: 390, height: 844 });
    await page.getByText('Your day').waitFor({ timeout: 15000 }); await plus(page).waitFor({ timeout: 15000 }); await page.waitForTimeout(500);
    ok('390: "+" in the header, no sideways scroll', (await plus(page).count()) === 1 && (await noScroll(page)));
    await plus(page).click(); await page.waitForTimeout(600);
    const sheet = await dialog(page).boundingBox();
    ok('390: the panel is a bottom sheet (full width, flush with the bottom edge)', sheet && Math.round(sheet.x) === 0 && Math.round(sheet.width) === 390 && Math.abs(sheet.y + sheet.height - 844) < 2 && sheet.height <= 844 * 0.88 + 2, JSON.stringify(sheet));
    await shot(page, 'capture-task-390');
    await dialog(page).getByRole('button', { name: /^Note/ }).click(); await page.waitForTimeout(500);
    ok('390 Note: no sideways scroll', (await modeOn(page, 'Note')) === 'true' && (await noScroll(page)));
    await shot(page, 'capture-note-390');
    await dialog(page).getByRole('button', { name: /^Idea/ }).click(); await page.waitForTimeout(500);
    ok('390 Idea: no sideways scroll', (await modeOn(page, 'Idea')) === 'true' && (await noScroll(page)));
    await shot(page, 'capture-idea-390');
    await dialog(page).getByRole('button', { name: 'Close quick capture' }).click(); await page.waitForTimeout(300);
    ok('390: ✕ closes', (await dialog(page).count()) === 0);
    errsAll.push(...errs.map(e => `390: ${e}`)); await page.context().close(); }

  const bundle = fs.readdirSync(ROOT + '/build/static/js').filter(f => /^main\..*\.js$/.test(f)).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('');
  ok('bundle marker: data-capture-panel + "Saves to Ideas on this browser" in build/', bundle.includes('data-capture-panel') && bundle.includes('Saves to Ideas on this browser'));
  ok('0 page errors', errsAll.length === 0, errsAll.slice(0, 5).join(' | '));
  console.log(`Claude: 0 real calls (extract fixture ×${extractCalls}, categorize fixture ×${categorizeCalls}); Apollo: 0`);
} catch (e) { console.error('ERROR', e.stack || e.message); }
finally {
  await cleanup();
  const after = await counts(), hlAfter = await hlCounts();
  const moved = WATCH.filter(t => after[t] !== before[t]), hlMoved = HL.filter(t => hlAfter[t] !== hlBefore[t]);
  console.log(`HomeLover ${hlMoved.length ? 'MOVED: ' + hlMoved.join(',') : 'identical'} ${JSON.stringify(hlAfter)}`);
  console.log(`checks: ${pass}/${total}  shots: ${fs.readdirSync(OUT).filter(f => f.endsWith('.png')).length} png -> ${OUT}`);
  console.log(`restored: ${moved.length ? 'NO - moved: ' + moved.join(', ') : 'yes'}`);
  process.exit(pass === total && !moved.length && !hlMoved.length ? 0 : 1);
}
