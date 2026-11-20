// actions-v2 Stage 2 - the fixture harness run: the REAL Today components (.screenshots/actions-v2/harness, built by
// scripts/verify/actions-v2/build.cjs), every request answered in the browser from fixtures (the mockups' own rows).
// No server, no database, no sign-in, 0 Claude, 0 Apollo - nothing can be written. Declared: 14 states at 1440 and
// 390; est. 60 s; cap 200 s. Per state: a PNG, axe (0 violations) and N2 (0 px sideways). Then the side-by-side PNGs:
// each list mockup (specs/design/actions-v2) beside the build. Output: .screenshots/actions-v2/stage2/.
// Usage: node scripts/verify/actions-v2/build.cjs && node scripts/verify/actions-v2-stage2.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
const { chromium } = require('playwright');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const OUT = path.join(ROOT, '.screenshots', 'actions-v2', 'stage2');
const HARNESS = path.join(ROOT, '.screenshots', 'actions-v2', 'harness');
const MOCK = path.join(ROOT, 'specs', 'design', 'actions-v2');
fs.mkdirSync(OUT, { recursive: true });
setTimeout(() => { console.log('CAP: 200 s'); process.exit(1); }, 200000).unref();
const T0 = Date.now();
const results = { checks: [], axe: {}, n2: {}, shots: [] };
const ok = (name, pass, detail = '') => { results.checks.push({ name, pass: !!pass, detail }); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${String(detail).slice(0, 300)}` : ''}`); };
const row = (key, title, from, to, skipped = null) => ({ key, kind: 'task', title, from, to, skipped, note: null });
const card = (verb, rows, to = null) => ({ plan_id: 'p1', verb, label: verb, to, when: null, rows, summary: { will: rows.filter(r => !r.skipped).length, skipped: rows.filter(r => r.skipped).length }, note: null });
const acted = (titles, line) => ({ plan_id: 'p1', rows: titles.map((t, i) => ({ key: `todos:t${i}`, title: t, ok: true, error: null, skipped: null })), done: titles.length, failed: 0, skipped: 0, line, can_undo: true });
const DATE_CARD = card('task_due', [row('todos:t8', 'Find the benefits lead', 'no date', 'due 2026-11-20'), row('todos:t10', 'Follow up after the pricing visit', 'no date', 'due 2026-11-20'), row('todos:t13', 'Draft the partner recap', 'no date', 'due 2026-11-20'), row('todos:t14', 'Read the S-1', 'no date', 'due 2026-11-20')], '2026-11-20');

const browser = await chromium.launch();
try {
  for (const [w, h, phone] of [[1440, 1080, false], [390, 844, true]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const tag = phone ? '390' : '1440';
    const load = async (extra = '', fixture = null) => {
      await page.goto(`file://${HARNESS}/index.html?x=1${phone ? '&phone=1' : ''}${extra}${fixture ? `&fixture=${fixture}` : ''}`);
      await page.addScriptTag({ content: AXE });
      await page.waitForSelector('[data-today], [data-today-fixes]', { timeout: 8000 });
    };
    const set = (k, v) => page.evaluate(([key, val]) => { window.__replies[key] = val; }, [k, v]);
    const state = async (name, wait) => {
      if (wait) await page.waitForSelector(wait, { timeout: 8000 });
      await page.waitForTimeout(200);
      const file = `${name}-${tag}.png`;
      await page.screenshot({ path: path.join(OUT, file), fullPage: true });
      results.shots.push(file);
      const v = await page.evaluate(async () => { const r = await window.axe.run(document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 2).map(n => n.target.join(' ')) })); });
      const n2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      results.axe[`${name}-${tag}`] = v; results.n2[`${name}-${tag}`] = n2;
      ok(`${name} @ ${tag}: axe 0 · N2 0 px`, v.length === 0 && n2 <= 0, v.length || n2 > 0 ? JSON.stringify({ axe: v, n2 }) : '');
    };
    const more = text => page.getByRole('button', { name: `More for ${text}` });

    await load(); await state('list');
    await page.locator('[data-today-fold]').first().click(); await page.getByRole('button', { name: /Everything else/ }).click(); await state('list-all-open');
    await load();
    await more('Email the People team').click(); await state('menu', '[data-today-menu="root"]');
    await page.getByRole('menuitem', { name: /Snooze/ }).click(); await state('menu-snooze', '[data-today-menu="snooze"]');
    await page.keyboard.press('Escape');
    await more('Email the People team').click(); await page.getByRole('menuitem', { name: /Reassign/ }).click(); await state('menu-reassign', '[data-today-menu="assign"]');
    await page.keyboard.press('Escape');
    await set('plan', card('task_done', [row('todos:t7', 'Confirm the December demo time', 'open', 'done')])); await set('act', acted(['Confirm the December demo time'], 'Marked done 1'));
    await page.getByRole('button', { name: 'Done: Confirm the December demo time' }).click(); await state('done-line', '[data-today-toast="done"]');
    ok(`done line @ ${tag} says the list's words and offers Undo`, /Done: Confirm the December demo time\./.test(await page.locator('[data-today-toast]').innerText()) && await page.locator('[data-today-undo]').count() === 1);
    ok(`the write went through Scout's plan then act @ ${tag}`, await page.evaluate(() => { const c = window.__calls.filter(x => x.method === 'POST').map(x => x.url.split('/').pop()); return c.join(',') === 'plan,act'; }));
    await page.locator('[data-today-undo]').click(); await state('undone', '[data-today-toast="done"]');
    await load(); await set('plan', DATE_CARD); await set('act', acted(['a', 'b', 'c', 'd'], 'Moved 4 of 4'));
    await page.getByRole('button', { name: /Undated/ }).click(); await state('bulk-date', '[data-today-datecard]');
    await page.locator('[data-today-datecard]').getByRole('button', { name: 'Fri Nov 20' }).click(); await state('bulk-date-card', '[data-today-card] [data-scout-confirm]');
    ok(`bulk date @ ${tag}: nothing acted before Confirm`, await page.evaluate(() => !window.__calls.some(x => x.url.endsWith('/act'))));
    await page.locator('[data-scout-confirm]').click(); await state('bulk-date-done', '[data-today-toast="done"]');
    await load('', 'WITH_STRIP'); await state('strip', '[data-today-strip]');
    await load('', 'EMPTY_RANKED'); await state('empty-ranked', '[data-today-empty="ranked"]');
    await load('', 'EMPTY_NONE'); await page.getByRole('button', { name: /Overdue/ }).click(); await state('empty-none', '[data-today-empty="none"]');
    await load('&viewer=1'); await state('viewer');
    ok(`viewer @ ${tag}: no Done, no ⋯, no verb`, await page.locator('[data-today-done], [data-today-more], [data-today-verb]').count() === 0);
    await load('&fixes=1'); await state('fixes', '[data-today-fix]');
    await set('plan', card('reply_todos', [{ key: 'people:prospect:p2', kind: 'person', title: 'Crystal Pringle', from: null, to: 'open to-do · due 2026-11-19', skipped: null, note: 'linked to Solidcore' }]));
    await page.getByRole('button', { name: 'Add 4 to-dos' }).click(); await state('fixes-card', '[data-scout-confirm]');
    ok(`no page error @ ${tag}`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // side-by-side: each list mockup beside the build's states
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pairs = { ActionsToday: ['list-1440.png', 'menu-1440.png', 'done-line-1440.png'], ActionsTodayStates: ['fixes-1440.png', 'bulk-date-card-1440.png', 'menu-snooze-1440.png', 'menu-reassign-1440.png', 'empty-ranked-1440.png', 'empty-none-1440.png', 'viewer-1440.png', 'strip-1440.png'], ActionsTodayPhone: ['list-390.png', 'menu-390.png', 'list-all-open-390.png'] };
  for (const [mock, shots] of Object.entries(pairs)) {
    const phone = mock.endsWith('Phone');
    await page.goto(`file://${path.join(MOCK, `${mock}.dc.html`)}`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `mock-${mock}.png`), fullPage: true });
    const wide = phone ? 390 : 1100;
    const html = `<!doctype html><body style="margin:0;background:#0B0E12;color:#A8B2C0;font:13px system-ui;padding:16px"><div style="display:flex;gap:24px;align-items:flex-start"><div><div style="padding:6px 0">MOCKUP · specs/design/actions-v2/${mock}.dc.html</div><img src="mock-${mock}.png" style="width:${wide}px;border:1px solid #2E3540"></div><div><div style="padding:6px 0">BUILD · the real components on fixtures</div>${shots.map(s => `<div style="padding:10px 0 4px">${s}</div><img src="${s}" style="width:${wide}px;border:1px solid #2E3540">`).join('')}</div></div></body>`;
    fs.writeFileSync(path.join(OUT, `pair-${mock}.html`), html);
    await page.goto(`file://${path.join(OUT, `pair-${mock}.html`)}`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `sidebyside-${mock}.png`), fullPage: true });
    ok(`side-by-side ${mock}`, fs.existsSync(path.join(OUT, `sidebyside-${mock}.png`)));
  }
} catch (e) { ok('run', false, e.message); }
await browser.close();
const failed = results.checks.filter(c => !c.pass);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks · ${results.shots.length} shots · axe violations ${Object.values(results.axe).flat().length} · N2 max ${Math.max(0, ...Object.values(results.n2))} px · writes: 0 · Claude 0 · Apollo 0 · restored: yes (fixtures only)`);
process.exit(failed.length ? 1 : 0);
