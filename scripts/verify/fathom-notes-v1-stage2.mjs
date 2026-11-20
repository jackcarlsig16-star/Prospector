// fathom-notes-v1 Stage 2 - the fixture harness run: the REAL Settings card, Today list and Intake review
// (.screenshots/fathom-notes-v1/harness, built by scripts/verify/fathom-notes-v1/build.cjs), every request answered in
// the browser from fixtures. No server, no database, no sign-in, 0 Claude, 0 Apollo, 0 Fathom - nothing can be written.
// Declared: 7 states at 1440 and 390 (the card: not connected / connected / error / disconnected; the Today row; the
// review open; the Extract row's review); est. 30 s; cap 120 s. Per state: a PNG, axe (0 violations), N2 (0 px sideways).
// Output: .screenshots/fathom-notes-v1/stage2/.
// Usage: node scripts/verify/fathom-notes-v1/build.cjs && node scripts/verify/fathom-notes-v1-stage2.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
const { chromium } = require('playwright');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const OUT = path.join(ROOT, '.screenshots', 'fathom-notes-v1', 'stage2');
const HARNESS = path.join(ROOT, '.screenshots', 'fathom-notes-v1', 'harness');
fs.mkdirSync(OUT, { recursive: true });
setTimeout(() => { console.log('CAP: 120 s'); process.exit(1); }, 120000).unref();
const T0 = Date.now();
const results = { checks: [], shots: [] };
const ok = (name, pass, detail = '') => { results.checks.push({ name, pass: !!pass }); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${String(detail).slice(0, 400)}` : ''}`); };

const browser = await chromium.launch();
try {
  for (const [w, h, phone] of [[1440, 1080, false], [390, 844, true]]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const tag = phone ? '390' : '1440';
    const load = async (query, wait) => {
      await page.goto(`file://${HARNESS}/index.html?${query}${phone ? '&phone=1' : ''}`);
      await page.addScriptTag({ content: AXE });
      await page.waitForSelector(wait, { timeout: 8000 });
    };
    const state = async (name, wait, { window: win = false } = {}) => {
      if (wait) await page.waitForSelector(wait, { timeout: 8000 });
      await page.waitForTimeout(200);
      const file = `${name}-${tag}.png`;
      await page.screenshot({ path: path.join(OUT, file), fullPage: !win });
      results.shots.push(file);
      const v = await page.evaluate(async () => { const r = await window.axe.run(document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 2).map(n => n.target.join(' ')) })); });
      const n2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(`${name} @ ${tag}: axe 0 · N2 0 px`, v.length === 0 && n2 <= 0, v.length || n2 > 0 ? JSON.stringify({ axe: v, n2 }) : '');
    };
    const text = sel => page.locator(sel).first().innerText();

    await load('view=card&state=new', '[data-fathom-card]'); await state('card-not-connected');
    ok(`card not connected @ ${tag}: a password field, Connect off until a key is pasted`, await page.locator('input[type=password]').count() === 1 && await page.getByRole('button', { name: 'Connect' }).isDisabled());
    await load('view=card&state=connected', '[data-fathom-card]'); await state('card-connected');
    ok(`card connected @ ${tag}: one row per member, the status line, the four buttons`, await page.locator('[data-fathom-row="connected"]').count() === 2 && /^Connected · last recording Nov 19 · last event /.test(await text('[data-fathom-status]'))
      && await page.locator('[data-fathom-row]').first().getByRole('button').count() === 3 && await page.locator('[data-fathom-row]').nth(1).getByRole('button', { name: 'Register webhook' }).count() === 1, await text('[data-fathom-row]'));
    ok(`card help @ ${tag}: the key travels with the database`, /It travels with the database/.test(await text('[data-fathom-help]')) && /only an Owner connects it for another member/.test(await text('[data-fathom-help]')));
    await load('view=card&state=error', '[data-fathom-card]');
    await page.evaluate(() => { window.__replies.status.test = 502; window.__replies.test = { error: 'Fathom refused the API key' }; });
    await page.getByRole('button', { name: 'Test' }).click(); await state('card-error', '[data-fathom-row="error"] [data-fathom-error]');
    ok(`card error @ ${tag}: the row says why, in words`, /Test failed: Fathom refused the API key/.test(await text('[data-fathom-error]')));
    await load('view=card&state=disconnected', '[data-fathom-card]'); await state('card-disconnected');
    ok(`card disconnected @ ${tag}: reconnect = paste again`, /Disconnected · to reconnect, paste the key again/.test(await text('[data-fathom-status]')));
    ok(`the card made no Fathom call on load @ ${tag}`, await page.evaluate(() => window.__calls.every(c => c.method === 'GET')));

    await load('view=today', '[data-today]'); await state('today-row', '[data-today-row="review:n1"]');
    const first = await page.locator('[data-today-row]').first().getAttribute('data-today-row');
    ok(`Today @ ${tag}: the review row leads group 1 with verb Review; the unread call says Extract`, first === 'review:n1' && await text('[data-today-row="review:n1"] [data-today-verb]') === 'Review' && await text('[data-today-row="review:n2"] [data-today-verb]') === 'Extract'
      && /Review call notes · Northwind weekly · 3 tasks · 2 companies · 4 facts · Nov 20/.test(await text('[data-today-row="review:n1"]')));
    ok(`Today @ ${tag}: the review row has no Done and no ⋯`, await page.locator('[data-today-row="review:n1"] [data-today-done], [data-today-row="review:n1"] [data-today-more]').count() === 0);
    await page.locator('[data-today-row="review:n1"] [data-today-verb]').click();
    await state('review-open', '[data-note-review="n1"] section[aria-label="Tasks"]', { window: true });
    ok(`Review @ ${tag}: opens AT the review step - the summary, 3 tasks, the idea; no paste box`, await page.locator('[data-note-review] textarea[aria-label="Call notes"]').count() === 0 && await page.locator('[data-note-review] section[aria-label="Tasks"] li').count() >= 3
      && /A pilot dashboard the employer can open/.test(await text('[data-note-review]')) && await page.getByRole('button', { name: 'Accept 3' }).count() === 1);
    ok(`Review @ ${tag}: opening it asked for the stored review, no model route`, await page.evaluate(() => window.__calls.some(c => c.url.endsWith('/call-notes/n1/review')) && !window.__calls.some(c => /extract/.test(c.url))));
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__replies.review = { note: { ...window.__fixtures.REVIEW.note, id: 'n2', title: 'Partner sync', call_date: '2026-11-18' }, needs_extract: true }; window.__replies.status.extract = 429; window.__replies.extract = { error: 'Today’s extractions for this workspace are used - an Owner can raise the daily cap' }; });
    await page.locator('[data-today-row="review:n2"] [data-today-verb]').click();
    await state('extract-capped', '[data-note-review="n2"] [data-stored-note]', { window: true });
    ok(`Extract @ ${tag}: the click asked for ONE extraction; past the cap the reason shows and Extract stays`, await page.evaluate(() => window.__calls.filter(c => c.url.endsWith('/fathom/notes/n2/extract')).length === 1) && /an Owner can raise the daily cap/.test(await text('[data-note-review]')) && await page.getByRole('button', { name: 'Extract', exact: true }).count() === 1);
    ok(`no page error @ ${tag}`, errors.length === 0, errors.join(' | '));
  }
} finally { await browser.close(); }
const failed = results.checks.filter(c => !c.pass);
console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks passed · ${results.shots.length} PNGs in .screenshots/fathom-notes-v1/stage2/`);
process.exit(failed.length ? 1 : 0);
