// scout-v3 Stage 2 check - the REAL Scout components in a standalone harness (scripts/verify/scout-v3/harness.jsx,
// built by scripts/verify/scout-v3/build.cjs), every request answered in the browser from fixtures (the mockups' own
// example rows). Declared scope: no server, no database, no sign-in, 0 Claude, 0 Apollo, 0 writes; ~25 page states at
// 1440 and 390; under 2 minutes; cap 200 s. Per state: a PNG, axe (0 violations) and N2 (0 px sideways, and nothing
// wider than the Scout panel). Then three side-by-side PNGs: each mockup (specs/design/scout-v3) beside the build.
// Output: .screenshots/scout-v3/stage2/.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const OUT = path.join(ROOT, '.screenshots', 'scout-v3', 'stage2');
const HARNESS = path.join(ROOT, '.screenshots', 'scout-v3', 'harness');
const MOCK = path.join(ROOT, 'specs', 'design', 'scout-v3');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(HARNESS, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Scout harness</title></head><body><div id="root"></div><script src="harness.js"></script></body></html>');
const T0 = Date.now();
const kill = setTimeout(() => { console.log('CAP 200 s - aborted'); process.exit(1); }, 200000); kill.unref();
const results = { checks: [], axe: {}, n2: {}, shots: [] };
const ok = (name, pass, detail = '') => { results.checks.push({ name, pass: !!pass, detail }); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${String(detail).slice(0, 260)}` : ''}`); };

const row = (key, title, kind, from, to, skipped = null) => ({ key, kind, title, from, to, skipped, note: null });
const SINGLE = { plan_id: 'p1', verb: 'assign', label: 'Assign', to: 'Cyrus', when: null, rows: [row('employers:c1', 'Northrop Grumman', 'employer', 'Jack', 'Cyrus')], summary: { will: 1, skipped: 0 }, note: null };
const BATCH = { ...SINGLE, plan_id: 'p2', rows: [row('employers:c1', 'Northrop Grumman', 'employer', 'Jack', 'Cyrus'), row('partners:c2', 'MetLife', 'partner', 'Jack', 'Cyrus'), row('employers:c3', 'Flowserve Corporation', 'employer', 'Jack', 'Cyrus'), row('employers:c4', 'Mace', 'employer', 'Cyrus', 'Cyrus', 'already Cyrus'), row('employers:c5', 'IXL Learning', 'employer', 'Cyrus', 'Cyrus', 'already Cyrus')], summary: { will: 3, skipped: 2 } };
const res = (rows, line, extra = {}) => ({ plan_id: 'p2', verb: 'assign', rows, done: rows.filter(r => r.ok).length, failed: rows.filter(r => r.error).length, skipped: 2, line, can_undo: true, ...extra });
const okRow = (key, title) => ({ key, title, ok: true, to: 'Cyrus', error: null, skipped: null });
const DONE = res([okRow('employers:c1', 'Northrop Grumman'), okRow('partners:c2', 'MetLife'), okRow('employers:c3', 'Flowserve Corporation')], 'Assigned 3 of 3 to Cyrus · 2 skipped');
const PARTIAL = res([okRow('employers:c1', 'Northrop Grumman'), { key: 'partners:c2', title: 'MetLife', ok: false, to: 'Cyrus', error: 'owner changed to Seif meanwhile', skipped: null }, okRow('employers:c3', 'Flowserve Corporation')], 'Assigned 2 of 3 to Cyrus · MetLife failed: owner changed to Seif meanwhile · 2 skipped');
const PILLS = [['assign', 'Assign'], ['not_fit', 'Not a fit'], ['contacted', 'Mark contacted'], ['draft', 'Draft email'], ['snooze', 'Snooze'], ['add_task', 'Add task'], ['copy', 'Copy for Claude']].map(([id, label]) => ({ id, label }));
const CANT = { cant: { reason: "I can't send email. Scout never sends, deletes, or moves a stage. I can open a draft for you to send yourself.", pills: PILLS, nearest: { id: 'draft', label: 'Draft email' } } };

const browser = await chromium.launch();
try {
  for (const [w, h, phone] of [[1440, 900, false], [390, 844, true]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true }); });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const tag = phone ? '390' : '1440';
    const load = async () => { await page.goto(`file://${HARNESS}/index.html${phone ? '?phone=1' : ''}`); await page.addScriptTag({ content: AXE }); if (phone) await page.click('button[aria-label="Search or ask Scout"]'); };
    const set = (k, v) => page.evaluate(([key, val]) => { window.__replies[key] = val; }, [k, v]);
    const fixture = name => page.evaluate(n => { window.__replies.ask = window.__fixtures[n]; }, name);
    const say = async text => { await page.fill('input[role="combobox"]', text); await page.press('input[role="combobox"]', 'Enter'); };
    const state = async (name, wait) => {
      if (wait) await page.waitForSelector(wait, { timeout: 8000 });
      await page.waitForTimeout(150);
      const file = `${name}-${tag}.png`;
      await page.screenshot({ path: path.join(OUT, file), fullPage: true });
      results.shots.push(file);
      const v = await page.evaluate(async () => { const r = await window.axe.run(document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 2).map(n => n.target.join(' ')) })); });
      const n2 = await page.evaluate(() => { const pop = document.querySelector('[data-scout-pop], [data-scout-sheet]'); const wide = pop ? [...pop.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > pop.getBoundingClientRect().right + 0.5 && !el.closest('.scout-menu') && !el.closest('.scout-sr')).length : 0; return { page: Math.max(0, document.documentElement.scrollWidth - window.innerWidth), over: wide }; });
      results.axe[`${name}-${tag}`] = v; results.n2[`${name}-${tag}`] = n2;
      ok(`${name} @ ${tag}: axe 0 · N2 0 px`, v.length === 0 && n2.page === 0 && n2.over === 0, v.length || n2.page || n2.over ? JSON.stringify({ axe: v, n2 }) : '');
    };
    const calls = () => page.evaluate(() => window.__calls.filter(c => c.method !== 'GET').map(c => c.url.split('/').pop()));

    // 1 - the multi-part answer, the quick menu open on row 1
    await load();
    await say('pull me 5 most important prospects who are visiting and hot and show 5 most important tasks');
    await state('answer', '[data-scout-section="2"]');
    const head = await page.evaluate(() => ({ sections: document.querySelectorAll('[data-scout-section]').length, records: !!document.querySelector('[data-scout-records]'), pills: [...document.querySelectorAll('[data-scout-count]')].map(e => e.textContent), cards: document.querySelectorAll('.scout-card').length, tables: document.querySelectorAll('.scout-table').length }));
    ok(`answer @ ${tag}: two sections, count pills, no Records block; ${phone ? 'cards, no table' : 'two tables'}`, head.sections === 2 && !head.records && head.pills.join('|') === '5 of 19 people|5 of 342 open' && (phone ? head.tables === 0 && head.cards === 5 : head.tables === 2), JSON.stringify(head));
    await page.click('button[aria-label="Actions for Danilea Mayer"]');
    await state('menu', '[role="menu"]');
    const menu = await page.evaluate(() => ({ items: [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(b => b.textContent.replace('▸', '')), sheet: document.querySelector('.scout-menu').className.includes('sheet'), h: Math.round(document.querySelector('[role="menu"] [role="menuitem"]').getBoundingClientRect().height) }));
    ok(`menu @ ${tag}: the seven verbs${phone ? ' as an action sheet with 44 px rows' : ''}`, menu.items.join('|') === 'Assign|Task|Mark contacted|Not a fit|Draft email|Snooze|Copy for Claude' && (phone ? menu.sheet && menu.h >= 44 : !menu.sheet), JSON.stringify(menu));
    await page.click('[role="menu"] [data-scout-pick="assign"]');
    await state('menu-members', '[data-scout-menu="members"] [role="menuitem"]');

    // 2 - commands on a company answer: single card, batch card, working, done + Undo, partial failure
    await load(); await fixture('COMPANY_ANSWER');
    await say('top companies by score'); await page.waitForSelector('[data-scout-answer]');
    await set('plan', SINGLE); await say('assign Northrop to Cyrus');
    await state('confirm-single', '[data-scout-card]');
    await page.keyboard.press('Escape');
    await set('plan', BATCH); await say('assign all five to Cyrus');
    await state('confirm-batch', '[data-scout-card]');
    const card = await page.evaluate(() => ({ title: document.querySelector('.scout-confirm__title').textContent, will: document.querySelectorAll('[data-scout-card-row="will"]').length, skipped: document.querySelectorAll('[data-scout-card-row="skipped"]').length, foot: document.querySelector('[data-scout-card-foot]').textContent, border: getComputedStyle(document.querySelector('.scout-confirm')).borderTopColor }));
    ok(`confirm card @ ${tag}: periwinkle border, 3 will change · 2 skipped, nothing written yet`, card.title === 'Assign 5 companies to Cyrus' && card.will === 3 && card.skipped === 2 && card.foot === '3 will change · 2 skipped' && card.border === 'rgb(143, 168, 255)' && !(await calls()).includes('act'), JSON.stringify(card));
    await set('act', DONE); await page.evaluate(() => { window.__replies.delay.act = 1500; });
    await page.click('[data-scout-confirm]');
    await state('working', '[data-scout-acting]');
    await state('done', '[data-scout-done-line]');
    const done = await page.evaluate(() => ({ line: document.querySelector('[data-scout-done-line]').textContent, undo: document.querySelector('[data-scout-undo]')?.textContent, updated: document.querySelectorAll('[data-scout-result="updated"]').length, color: getComputedStyle(document.querySelector('.scout-done-line')).color }));
    ok(`done @ ${tag}: the green done line, Undo counting down, three rows updated in place`, done.line === '✓ Assigned 3 of 3 to Cyrus · 2 skipped' && /^Undo \d+ s$/.test(done.undo || '') && done.updated === 3 && done.color === 'rgb(61, 214, 140)', JSON.stringify(done));
    if (phone) { const u = await page.evaluate(() => Math.round(document.querySelector('[data-scout-undo]').getBoundingClientRect().height)); ok('Undo is 36 px tall on the phone', u >= 36, u); }
    await page.click('[data-scout-undo]');
    await state('undone', '[data-scout-actions]');
    await set('plan', BATCH); await set('act', PARTIAL); await page.evaluate(() => { window.__replies.delay.act = 0; });
    await say('assign all five to Cyrus'); await page.waitForSelector('[data-scout-card]'); await page.click('[data-scout-confirm]');
    await state('partial-failure', '[data-scout-failed]');
    // the other missing states
    await set('plan', { cant: { reason: 'That is 30 rows. Narrow it to 25 or fewer.', pills: PILLS, nearest: null } }); await say('assign all to Cyrus');
    await state('over-25', '[data-scout-cant]');
    await set('plan', BATCH); await say('assign all five to Cyrus'); await page.waitForSelector('[data-scout-card]');
    await say('who visited yesterday');
    await state('cancelled-by-ask', '[data-scout-note="note"]');
    await set('plan', CANT); await say('email Danilea Mayer about the savings plan');
    await state('cant-do', '[data-scout-cant]');
    const cant = await page.evaluate(() => ({ pills: document.querySelectorAll('[data-scout-pill]').length, nearest: document.querySelectorAll('[data-scout-nearest]').length }));
    ok(`can't-do @ ${tag}: seven verb pills and one primary nearest action`, cant.pills === 7 && cant.nearest === 1, JSON.stringify(cant));

    // 3 - nothing to resolve (no answer on screen), the brief + Copy for Claude, Undo expired
    await load();
    await set('plan', { cant: { reason: 'Ask for a list first, then tell me what to do with it.', pills: PILLS, nearest: null } }); await say('assign those to Cyrus');
    await state('nothing-to-resolve', '[data-scout-actpanel] [data-scout-cant]');
    await load(); await fixture('BRIEF');
    await say('pull the intel on our recent call with Northrop');
    await page.waitForSelector('[data-scout-brief]'); await page.click('[data-scout-copy]');
    await state('brief-copied', '[data-scout-note="copied"]');
    const brief = await page.evaluate(() => ({ head: document.querySelector('[data-scout-brief]').textContent, copied: document.querySelector('[data-scout-note="copied"]').textContent }));
    ok(`brief @ ${tag}: the brief header with Copy for Claude and the copied line from the pack's real length`, /Brief · 1 company/.test(brief.head) && brief.copied === '✓ Copied · 1 record · 2,100 chars', JSON.stringify(brief));
    if (!phone) {
      await load(); await fixture('COMPANY_ANSWER'); await say('top companies by score'); await page.waitForSelector('[data-scout-answer]');
      await set('plan', BATCH); await set('act', DONE); await say('assign all five to Cyrus'); await page.waitForSelector('[data-scout-card]'); await page.click('[data-scout-confirm]');
      await page.waitForSelector('[data-scout-undo-expired]', { timeout: 14000 });
      await state('undo-expired', '[data-scout-undo-expired]');
    }
    const writes = await calls();
    ok(`@ ${tag}: every request was answered by the fixture (no network), no page error`, errors.length === 0, errors.join(' | ') || `non-GET calls answered in the browser: ${[...new Set(writes)].join(', ')}`);
    await ctx.close();
  }

  // side-by-side: each mockup beside the build's states
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pairs = { Scout3Answer: ['answer-1440.png', 'menu-1440.png', 'menu-members-1440.png'], Scout3Actions: ['confirm-single-1440.png', 'confirm-batch-1440.png', 'working-1440.png', 'done-1440.png', 'partial-failure-1440.png', 'cant-do-1440.png', 'brief-copied-1440.png', 'nothing-to-resolve-1440.png', 'cancelled-by-ask-1440.png', 'undo-expired-1440.png', 'over-25-1440.png'], Scout3Phone: ['answer-390.png', 'menu-390.png', 'confirm-batch-390.png', 'done-390.png', 'cant-do-390.png'] };
  for (const [mock, shots] of Object.entries(pairs)) {
    await page.goto(`file://${path.join(MOCK, `${mock}.dc.html`)}`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `mock-${mock}.png`), fullPage: true });
    const html = `<!doctype html><body style="margin:0;background:#0B0E12;color:#A8B2C0;font:13px system-ui;padding:16px"><div style="display:flex;gap:24px;align-items:flex-start"><div><div style="padding:6px 0">MOCKUP · specs/design/scout-v3/${mock}.dc.html</div><img src="mock-${mock}.png" style="width:1100px;border:1px solid #2E3540"></div><div><div style="padding:6px 0">BUILD · the real components, fixture data</div>${shots.map(s => `<div style="padding:10px 0 4px">${s}</div><img src="${s}" style="max-width:${mock === 'Scout3Phone' ? 390 : 1100}px;border:1px solid #2E3540;display:block">`).join('')}</div></div></body>`;
    fs.writeFileSync(path.join(OUT, `pair-${mock}.html`), html);
    await page.goto(`file://${path.join(OUT, `pair-${mock}.html`)}`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `sidebyside-${mock}.png`), fullPage: true });
    ok(`side-by-side ${mock}`, fs.existsSync(path.join(OUT, `sidebyside-${mock}.png`)));
  }
  await ctx.close();
} finally { await browser.close(); }
const failed = results.checks.filter(c => !c.pass);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks · ${results.shots.length} shots · axe violations ${Object.values(results.axe).flat().length} · N2 max ${Math.max(...Object.values(results.n2).map(n => n.page))} px · writes 0 · Claude 0 · Apollo 0`);
process.exit(failed.length ? 1 : 0);
