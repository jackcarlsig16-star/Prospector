// actions-v2 Stage 3 - the fixture harness run: the REAL Today components (.screenshots/actions-v2/harness, built by
// scripts/verify/actions-v2/build.cjs) - the frame row, the Needs attention drawer, the list and Scout's work panel -
// every request answered in the browser from fixtures (the mockups' own rows). No server, no database, no sign-in,
// 0 Claude, 0 Apollo - nothing can be written. Declared: 33 states at 1440 and 390; est. 120 s; cap 300 s. Per state:
// a PNG, axe (0 violations) and N2 (0 px sideways). Then the side-by-side PNGs: each of the five mockups
// (specs/design/actions-v2) beside the build. Output: .screenshots/actions-v2/stage3/.
// Usage: node scripts/verify/actions-v2/build.cjs && node scripts/verify/actions-v2-stage3.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
const { chromium } = require('playwright');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const OUT = path.join(ROOT, '.screenshots', 'actions-v2', 'stage3');
const HARNESS = path.join(ROOT, '.screenshots', 'actions-v2', 'harness');
const MOCK = path.join(ROOT, 'specs', 'design', 'actions-v2');
fs.mkdirSync(OUT, { recursive: true });
setTimeout(() => { console.log('CAP: 300 s'); process.exit(1); }, 300000).unref();
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
      await page.waitForSelector('[data-today]', { timeout: 8000 });
      await page.waitForSelector('[data-attention-button] button:not([disabled])', { timeout: 8000 });
    };
    const set = (k, v) => page.evaluate(([key, val]) => { window.__replies[key] = val; }, [k, v]);
    const state = async (name, wait) => {
      if (wait) await page.waitForSelector(wait, { timeout: 8000 });
      await page.waitForTimeout(200);
      const file = `${name}-${tag}.png`;
      // a sheet or a drawer is fixed to the window: shoot the window, not the page under it
      await page.screenshot({ path: path.join(OUT, file), fullPage: !(phone && await page.locator('[data-work-sheet], [data-attention-drawer]').count()) });
      results.shots.push(file);
      const v = await page.evaluate(async () => { const r = await window.axe.run(document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 2).map(n => n.target.join(' ')) })); });
      const n2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      results.axe[`${name}-${tag}`] = v; results.n2[`${name}-${tag}`] = n2;
      ok(`${name} @ ${tag}: axe 0 · N2 0 px`, v.length === 0 && n2 <= 0, v.length || n2 > 0 ? JSON.stringify({ axe: v, n2 }) : '');
    };
    const more = text => page.getByRole('button', { name: `More for ${text}` });
    const verb = text => page.locator(`[data-today-row]:has-text("${text}") [data-today-verb]`).first();
    const work = async (which, extra = {}) => { await page.evaluate(([w, x]) => { window.__replies.work = { ...window.__fixtures.WORKS[w], ...x }; }, [which, extra]); };
    const ready = () => page.waitForSelector('[data-work="ready"]', { timeout: 8000 });

    await load(); await state('list');
    // P1: the header carries "Needs attention n" and "+ To-do"
    ok(`P1 header @ ${tag}: Needs attention 4 + To-do`, /Needs attention\s*4/.test(await page.locator('[data-attention-button]').innerText()) && await page.getByRole('button', { name: '+ To-do' }).count() === 1);
    // P3: the rows shown read 1…n; with the fold open the folded rows take the next numbers of group 1
    const nums = () => page.$$eval('[data-today-row] .td-rk', els => els.map(e => Number(e.textContent)));
    const shut = await nums();
    ok(`P3 numbering @ ${tag}: shown rows read 1…n`, shut.length > 0 && shut.every((n, i) => n === i + 1), shut.join(','));
    await page.locator('[data-today-fold]').first().click(); await page.getByRole('button', { name: /Everything else/ }).click(); await state('list-all-open');
    const opened = await nums();
    ok(`P3 numbering @ ${tag}: fold open - still 1…n, the folded rows numbered after the shown rows of group 1`, opened.every((n, i) => n === i + 1) && /^4/.test(await page.locator('[data-today-row]:has-text("Older overdue to-do 1") .td-rk').innerText()), opened.join(','));
    ok(`R1 bulk drop line @ ${tag}`, /2 here have not been touched in 30 days or more/.test(await page.locator('[data-today-stale]').innerText()));
    if (phone) {
      // P5: the chip row scrolls inside its own box; the last chip is reachable; the page does not move sideways
      const bar = page.locator('.td-bar');
      const before = await bar.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, style: getComputedStyle(el).overflowX }));
      await bar.evaluate(el => { el.scrollLeft = el.scrollWidth; });
      const after = await bar.evaluate(el => { const last = el.lastElementChild.getBoundingClientRect(), box = el.getBoundingClientRect(); return { left: el.scrollLeft, lastRight: Math.round(last.right), boxRight: Math.round(box.right), page: document.documentElement.scrollWidth - window.innerWidth, boxLeft: Math.round(box.left) }; });
      ok('P5 phone chip row scrolls inside its box, last chip reachable, page 0 px sideways', before.style === 'auto' && before.sw > before.cw && after.left > 0 && after.lastRight <= after.boxRight && after.boxRight <= 390 && after.boxLeft >= 0 && after.page <= 0, JSON.stringify({ before, after }));
      await page.evaluate(() => window.scrollTo(0, 0));
      await state('chips-scrolled-to-end');
    }
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
    // P1 / P2: Needs attention is a drawer OVER the list (440 px; a full-height sheet at 390), Esc closes it
    await load();
    await page.locator('[data-attention-button] button').click(); await state('drawer', '[data-attention-drawer] [data-today-fix]');
    const box = await page.locator('[data-attention-drawer]').boundingBox();
    ok(`P1 drawer @ ${tag}: ${phone ? 'a full-height sheet' : '440 px on the right'}, the list still mounted behind it`, (phone ? box.width === 390 && box.height === 844 : box.width === 440 && Math.round(box.x + box.width) === 1440) && await page.locator('[data-today-row]').count() > 0, JSON.stringify(box));
    const feeds = await page.$$eval('[data-attention-feeds] [data-source]', els => els.map(e => e.getAttribute('data-source')));
    ok(`P2 Data feeds @ ${tag}: Apollo sync · Site visitors · Call-note intake under the fixes, each with its last run`, ['apollo', 'visitors', 'call_notes'].every(f => feeds.includes(f)) && /Last note 2026-11-18/.test(await page.locator('[data-attention-feeds]').innerText()), feeds.join(','));
    await set('plan', card('reply_todos', [{ key: 'people:prospect:p2', kind: 'person', title: 'Crystal Pringle', from: null, to: 'open to-do · due 2026-11-19', skipped: null, note: 'linked to Solidcore' }]));
    await page.getByRole('button', { name: 'Add 4 to-dos' }).click(); await state('drawer-card', '[data-attention-drawer] [data-scout-confirm]');
    await page.locator('[data-attention-drawer] [data-scout-confirm]').focus();
    await page.keyboard.press('Escape'); await page.waitForSelector('[data-attention-drawer]', { state: 'detached', timeout: 4000 }).then(() => ok(`P1 Esc closes the drawer @ ${tag}`, true), () => ok(`P1 Esc closes the drawer @ ${tag}`, false));
    await load('&feed=down');
    ok(`P2 a failed feed counts @ ${tag}: Needs attention 5`, /Needs attention\s*5/.test(await page.locator('[data-attention-button]').innerText()));
    await page.locator('[data-attention-button] button').click(); await state('drawer-feed-failed', '[data-attention-drawer] [data-today-fix="feed:visitors"]');
    const red = await page.evaluate(() => { const fix = document.querySelector('[data-today-fix]'); const first = document.querySelector('[data-attention-feeds] [data-source]'); return { topFix: fix.getAttribute('data-today-fix'), fixRed: fix.querySelector('b').className, firstFeed: first.getAttribute('data-source'), tag: first.textContent.includes('Failed') }; });
    ok(`P2 a failed feed @ ${tag}: on top of the fixes in red, first in Data feeds`, red.topFix === 'feed:visitors' && red.fixRed === 'td-bad' && red.firstFeed === 'visitors' && red.tag, JSON.stringify(red));
    await page.keyboard.press('Escape');

    // --- the work panel ---
    await load(); await page.evaluate(() => { window.__replies.delay.work = 1500; });
    ok(`D43 nothing generated before the click @ ${tag}`, await page.evaluate(() => !window.__calls.some(x => x.url.endsWith('/work'))));
    await verb('Email the People team').click(); await state('work-working', '[data-work="working"]');
    ok(`D38 working @ ${tag}: "Reading Cloudflare…" + skeleton bars, the verb filled`, /reading cloudflare/i.test(await page.locator('[data-work]').innerText()) && await page.locator('[data-work] .td-sk').count() >= (phone ? 3 : 6) && await verb('Email the People team').getAttribute('aria-expanded') === 'true');
    await ready(); await page.evaluate(() => { window.__replies.delay.work = 0; }); await state('work-draft');
    const paneText = await page.locator('[data-work]').innerText();
    ok(`D33 three panes @ ${tag}: steps with their grounds, the draft To without an address, the prompt with its real length`, phone ? /Draft/.test(paneText) : /LinkedIn touch/.test(paneText) && /opened twice, no click/.test(paneText) && /Danilea Mayer · Principal People Team, Cloudflare/.test(paneText) && /take it to claude/i.test(paneText) && !paneText.includes('@'), '');
    ok(`Q8 buttons @ ${tag}: Copy · Open in Write email · Shorter · Warmer · Try again, no mail-draft button`, await page.$$eval('[data-work-pane="middle"] button', b => b.map(x => x.textContent).sort().join('|')) === ['Copy', 'Open in Write email', 'Shorter', 'Try again', 'Warmer'].sort().join('|'));
    const chars = await page.evaluate(() => window.__fixtures.WORKS.draft.prompt_pack.asks[0].text.length);
    if (phone) {
      await page.getByRole('tab', { name: /Next steps/ }).click(); await state('sheet-steps', '[data-work-step]');
      await page.getByRole('tab', { name: 'Claude' }).click(); await state('sheet-claude', '[data-work-prompt]');
    }
    ok(`the prompt's count is its real length @ ${tag}`, Number((await page.locator('[data-work-chars]').innerText()).replace(/,/g, '')) === chars, String(chars));
    await page.locator('[data-work-copy-prompt]').click();
    ok(`Copy prompt @ ${tag}: the clipboard got the prompt, whole`, await page.evaluate(n => window.__copied.at(-1).length === n, chars));
    if (phone) await page.getByRole('tab', { name: 'Draft' }).click();
    await page.locator('[data-work-copy]').click(); await state('work-copied', '[data-today-toast="copied"]');
    ok(`D37 after Copy @ ${tag}: "Draft copied. Mark it done when it's sent." + Done; nothing written`, /Draft copied\. Mark it done when it’s sent\./.test(await page.locator('[data-today-toast]').innerText()) && await page.locator('[data-today-copied-done]').count() === 1 && await page.evaluate(() => !window.__calls.some(x => /\/(plan|act)$/.test(x.url))));
    await set('plan', card('task_finish', [row('todos:t9', 'Email the People team', 'open', 'done · Danilea Mayer contacted')]));
    await set('act', { ...acted(['Email the People team'], 'Finished 1'), rows: [{ key: 'todos:t9', title: 'Email the People team', ok: true, error: null, skipped: null, to: 'done · Danilea Mayer contacted' }] });
    await page.locator('[data-work-finish]').click(); await state('work-finished', '[data-today-toast="done"]');
    ok(`R4 finishing @ ${tag}: one plan + one act (task_finish), the done line with one Undo`, /Done: Email the People team\. Danilea Mayer marked contacted\./.test(await page.locator('[data-today-toast]').innerText()) && await page.locator('[data-today-undo]').count() === 1 && await page.evaluate(() => { const c = window.__calls.filter(x => /\/(plan|act)$/.test(x.url)); return c.length === 2 && JSON.parse(c[0].body).verb === 'task_finish'; }));
    for (const [which, name, row9, sel] of [['failed', 'work-failed', 'Email the People team', '[data-work-failed]'], ['withheld', 'work-withheld', 'Email the People team', '[data-work-withheld]'], ['prep', 'work-prep-call', 'Email the People team', '[data-work-brief]'], ['people', 'work-find-people', 'Find the benefits lead', '[data-work-person]'], ['next', 'work-next-steps', 'Confirm the December demo time', '[data-work-verb="next_steps"][data-work="ready"]']]) {
      await load(); await work(which, which === 'failed' ? { failed: { status: 502, error: 'The draft failed: the model did not answer in time' } } : {});
      if (which === 'failed') await page.evaluate(() => { window.__replies.status.work = 502; });
      await verb(row9).click(); await state(name, sel);
      if (which === 'failed') ok(`D38 failure @ ${tag}: the pane says what failed + Try again; the Claude pane still works`, /did not answer in time/.test(await page.locator('[data-work-failed]').innerText()) && await page.locator('[data-work-failed] button').count() === 1 && (phone || await page.locator('[data-work-prompt]').count() === 1));
      if (which === 'next') ok(`D40 Next steps @ ${tag}: no middle pane`, await page.locator('[data-work-pane="middle"]').count() === 0);
      if (which === 'people') ok(`D40 Find people @ ${tag}: stored people with Add and Draft, no call cost`, await page.locator('[data-work-person]').count() === 2 && await page.locator('[data-work-cost]').count() === 0);
    }
    if (!phone) { await page.keyboard.press('Escape'); ok('D32 Esc closes the panel and the focus returns to the verb', await page.locator('[data-work]').count() === 0 && await page.evaluate(() => document.activeElement?.getAttribute('data-today-verb') === 'next_steps')); }
    await load('', 'WITH_FIVE'); await more('Email the People team').click(); await state('menu-five', '[data-today-menu="root"]');
    ok(`R2 after the migration @ ${tag}: the menu offers "Add to this week's five" and a slot can be removed`, await page.getByRole('menuitem', { name: 'Add to this week’s five' }).count() === 1 && await page.locator('[data-today-slot-remove]').count() === 1);
    await page.keyboard.press('Escape');
    await load(); await more('Email the People team').click();
    ok(`R2 before the migration @ ${tag}: no five item in the menu`, await page.getByRole('menuitem', { name: 'Add to this week’s five' }).count() === 0);
    await page.keyboard.press('Escape');
    ok(`no page error @ ${tag}`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // side-by-side: each list mockup beside the build's states
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pairs = {
    ActionsToday: ['list-1440.png', 'list-all-open-1440.png', 'menu-1440.png', 'done-line-1440.png'],
    ActionsTodayStates: ['drawer-1440.png', 'drawer-feed-failed-1440.png', 'drawer-card-1440.png', 'bulk-date-card-1440.png', 'menu-snooze-1440.png', 'menu-reassign-1440.png', 'empty-ranked-1440.png', 'empty-none-1440.png', 'viewer-1440.png', 'strip-1440.png'],
    ActionsTodayPhone: ['list-390.png', 'chips-scrolled-to-end-390.png', 'drawer-390.png', 'menu-390.png', 'list-all-open-390.png'],
    ActionsTodayDo: ['work-draft-1440.png', 'work-working-1440.png', 'work-copied-1440.png', 'work-finished-1440.png', 'work-failed-1440.png', 'work-withheld-1440.png', 'work-prep-call-1440.png', 'work-find-people-1440.png', 'work-next-steps-1440.png'],
    ActionsTodayDoPhone: ['work-draft-390.png', 'sheet-steps-390.png', 'sheet-claude-390.png', 'work-working-390.png', 'work-failed-390.png', 'work-find-people-390.png'],
  };
  for (const [mock, shots] of Object.entries(pairs)) {
    const phone = mock.endsWith('Phone');
    for (const f of shots) if (!fs.existsSync(path.join(OUT, f))) ok(`shot exists: ${f}`, false);
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
