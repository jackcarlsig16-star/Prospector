// scout-v3.1 Stage 2 check - the REAL Scout components in the standalone harness (scripts/verify/scout-v3/harness.jsx,
// built by scripts/verify/scout-v3/build.cjs), every request answered in the browser from fixtures. Declared scope: no
// server, no database, no sign-in, 0 Claude, 0 Apollo, 0 writes; ~16 states at 1440 and 390; under 2 minutes; cap 200 s.
//   --before  the draft and the brief as they are before this stage (4 PNGs: *-before-1440 / 390).
//   default   every new state (PNG + axe 0 + N2 0 px each), then the side-by-side of the task card panel against
//             specs/design/scout-v3/Scout3Actions.dc.html and before | after pairs for the draft and the brief.
// Output: .screenshots/scout-v3.1/.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const BEFORE = process.argv.includes('--before');
const OUT = path.join(ROOT, '.screenshots', 'scout-v3.1');
const HARNESS = path.join(ROOT, '.screenshots', 'scout-v3', 'harness');
const MOCK = path.join(ROOT, 'specs', 'design', 'scout-v3');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(HARNESS, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Scout harness</title></head><body><div id="root"></div><script src="harness.js"></script></body></html>');
const T0 = Date.now();
const kill = setTimeout(() => { console.log('CAP 200 s - aborted'); process.exit(1); }, 200000); kill.unref();
const results = { checks: [] };
const ok = (name, pass, detail = '') => { results.checks.push({ name, pass: !!pass }); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${String(detail).slice(0, 400)}` : ''}`); };

const DRAFT_BODY = 'Hi Meagan,\n\nSaw the People team at Cloudflare on our relocation pages this week.\n\nHomeLover helps employees buy a first home with no cost to the employer.\n\nWorth 15 minutes? [Tue 10am] [Thu 2pm]\n\nJack';
const COMPOSE = { draft: { subject: 'A housing benefit for the Cloudflare People team', body: DRAFT_BODY, why: 'visits' }, claims: [], lint: { ok: true, issues: [], words: 38 }, cost_usd: 0.0182, cap: { used: 4, max: 30 }, sign_off: 'Jack' };
const OLD_DRAFT = { verb: 'draft', label: 'Draft email', open: { panel: 'compose', type: 'employer', id: 'e1', name: 'Cloudflare', to: 'Meagan Earley' }, line: 'Opened Write email for Cloudflare · address it to Meagan Earley' };
const NEW_DRAFT = { verb: 'draft', label: 'Draft email', draft: { to: { person_key: 'prospect:p2', name: 'Meagan Earley', title: 'Principal People Team' }, company: { type: 'employer', id: 'e1', name: 'Cloudflare' }, cost: { usd: 0.0182 }, cap: { used: 4, max: 30 }, subject: COMPOSE.draft.subject, body: DRAFT_BODY, lint: { ok: true, issues: 0 } }, open: { panel: 'compose', type: 'employer', id: 'e1', name: 'Cloudflare', to: 'Meagan Earley', prefill: { subject: COMPOSE.draft.subject, body: DRAFT_BODY } }, line: 'Drafted to Meagan Earley — nothing sent' };
const WITHHELD = { ...NEW_DRAFT, draft: { to: NEW_DRAFT.draft.to, company: NEW_DRAFT.draft.company, cost: { usd: 0.0171 }, cap: { used: 5, max: 30 }, withheld: true, reason: 'Draft withheld: it held an address or phone shape. Regenerate, or open Write email.' }, open: { ...OLD_DRAFT.open }, line: 'Draft withheld — nothing sent' };
const row = (key, title, kind, from, to, note = null, skipped = null) => ({ key, kind, title, from, to, skipped, note });
const TASK_CARD = { plan_id: 't1', verb: 'add_task', label: 'Add task', to: null, when: { date: '2026-11-12', past: false, phrase: 'Thursday' }, rows: [row('todos:new', 'Call MetLife', 'task', null, 'open to-do · due 2026-11-12', 'linked to MetLife · "Thursday" read as the next one')], summary: { will: 1, skipped: 0 }, note: null,
  fields: { task: 'Call MetLife', linked_to: 'MetLife', link: { type: 'partner', id: 'c2', name: 'MetLife' }, linked_detail: 'Partner · First email sent', person_key: null, owner: 'Jack', due: '2026-11-12', due_note: '"Thursday" read as the next one' } };
const SNOOZE_ONE = { plan_id: 't2', verb: 'snooze', label: 'Snooze', to: '2026-11-16', when: { date: '2026-11-16', past: false, phrase: 'next week' }, rows: [row('todos:t1', "Send 24HF joint note to Upside with Brad cc'd", 'task', 'not snoozed', 'until 2026-11-16', 'hidden from the open list until then')], summary: { will: 1, skipped: 0 }, note: null };
const SNOOZE_BATCH = { ...SNOOZE_ONE, plan_id: 't3', rows: [1, 2, 3].map(i => row(`todos:t${i}`, ["Send 24HF joint note to Upside with Brad cc'd", 'Intro Upside to Justworks, Access Development and OneDigital', 'Create user reporting draft for Seif'][i - 1], 'task', 'not snoozed', 'until 2026-11-16')), summary: { will: 3, skipped: 0 } };
const DONE = (card, line) => ({ plan_id: card.plan_id, verb: card.verb, rows: card.rows.map(r => ({ ...r, ok: true, error: null })), done: card.rows.length, failed: 0, skipped: 0, line, can_undo: true });
const WHICH = { answer_md: 'Which one? Say it like "the second one" or use a name.', summary: 'Which one? Say it like "the second one" or use a name.', sections: [], items: [], usage: null, withheld: false, cant: { reason: 'Which one? Say it like "the second one" or use a name.', candidates: [1, 2, 3, 4, 5].map(i => ({ key: `people:prospect:p${i}`, entity: 'people', id: `prospect:p${i}`, title: ['Danilea Mayer', 'Meagan Earley', 'Paola Ball', 'James Curcio', 'Person Five'][i - 1] })) }, scope: 'b1', cap: { used: 3, max: 40 } };

const browser = await chromium.launch();
const shots = {};
try {
  for (const [w, h, phone] of [[1440, 900, false], [390, 844, true]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied = t; } }, configurable: true }); });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const tag = phone ? '390' : '1440';
    const load = async () => { await page.goto(`file://${HARNESS}/index.html${phone ? '?phone=1' : ''}`); await page.addScriptTag({ content: AXE }); if (phone) await page.click('button[aria-label="Search or ask Scout"]'); };
    const set = (k, v) => page.evaluate(([key, val]) => { window.__replies[key] = val; }, [k, v]);
    const fixture = (name, patch) => page.evaluate(([n, p]) => { const f = JSON.parse(JSON.stringify(window.__fixtures[n])); window.__replies.ask = p ? new Function('f', `${p}; return f;`)(f) : f; }, [name, patch || null]);
    const say = async text => { await page.fill('input[role="combobox"]', text); await page.press('input[role="combobox"]', 'Enter'); };
    const state = async (name, wait, { check = true } = {}) => {
      if (wait) await page.waitForSelector(wait, { timeout: 8000 });
      await page.waitForTimeout(200);
      const file = `${name}-${tag}.png`;
      await page.screenshot({ path: path.join(OUT, file), fullPage: true });
      shots[`${name}-${tag}`] = file;
      if (!check) { ok(`${name} @ ${tag}: ${file}`, true); return; }
      const v = await page.evaluate(async () => { const r = await window.axe.run(document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 2).map(n => n.target.join(' ')) })); });
      const n2 = await page.evaluate(() => { const pop = document.querySelector('[data-scout-pop], [data-scout-sheet]'); const wide = pop ? [...pop.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > pop.getBoundingClientRect().right + 0.5 && !el.closest('.scout-menu') && !el.closest('.scout-sr')).length : 0; return { page: Math.max(0, document.documentElement.scrollWidth - window.innerWidth), over: wide }; });
      ok(`${name} @ ${tag}: axe 0 · N2 0 px`, v.length === 0 && n2.page === 0 && n2.over === 0, v.length || n2.page || n2.over ? JSON.stringify({ axe: v, n2 }) : '');
    };
    const posts = () => page.evaluate(() => window.__calls.filter(c => c.method !== 'GET').map(c => c.url.split('/').pop()));
    const ASK = 'pull me 5 most important prospects who are visiting and hot and show 5 most important tasks';

    if (BEFORE) {
      await load(); await fixture('BRIEF'); await say('pull the intel on our recent call with Northrop');
      await state('brief-before', '[data-scout-brief]', { check: false });
      await load(); await say(ASK); await page.waitForSelector('[data-scout-section="2"]');
      await set('plan', OLD_DRAFT); await set('e1', COMPOSE);
      await say('write an email to the second one');
      await state('draft-before', '[data-scout-note="opened"]', { check: false });
      await ctx.close();
      continue;
    }
    const FILL = "f.sections[0].fill = { asked: 5, strict: 1, counts: [{ band: 'hot', n: 1 }, { band: 'warm', n: 4 }], text: '5 people · 1 hot · 4 warm to make 5' }; f.sections[0].count = 5; f.sections[0].total = 5; f.sections[0].read = 'people whose company visited (7 d) · 5 · by heat · filled: 5 people · 1 hot · 4 warm to make 5'; f.sections[0].rows.slice(1).forEach(r => { r.row.heat_band = 'warm'; r.row.heat = 30; });";
    const GRID = "f.sections[0].read = 'goals/brief/employer'; f.context_stats.reads = ['goals/brief/employer']; f.sections[0].brief.grid = [{ label: 'Record', value: 'employer · stage contacted · owner Jack' }, { label: 'Visits', value: 'Visited 5 times in 7 d · 8 unique visitors · pages /for-wealth-managers, /tools/credit-calculator' }, { label: 'Last touch', value: 'Last touch: 2 days ago (Jack, call)' }, { label: 'Notes', value: 'Benefits team asked for the one-pager · 2 more' }, { label: 'People', value: 'Person Five — Benefits Lead · Rae North — VP People' }];";
    // 1 - the answer with the fill pill
    await load(); await fixture('ANSWER', FILL); await say(ASK);
    await state('fill', '[data-scout-fill]');
    ok(`fill pill @ ${tag}: "${await page.textContent('[data-scout-section="1"] [data-scout-count]')}"`, (await page.textContent('[data-scout-section="1"] [data-scout-count]')) === '5 people · 1 hot · 4 warm to make 5');
    // 2 - the inline draft, then Copy
    await set('plan', NEW_DRAFT);
    await say('write an email to the second one');
    await state('draft', '[data-scout-draft="ready"]');
    await page.click('[data-scout-draft-copy]'); await page.waitForTimeout(150);
    ok(`draft @ ${tag}: to "${await page.textContent('[data-scout-draft-to]')}" · cost "${await page.textContent('[data-scout-draft-cost]')}" · Copy put ${(await page.evaluate(() => (window.__copied || '').length))} chars on the clipboard · posts ${(await posts()).join(',')}`, (await page.textContent('[data-scout-draft-copy]')) === '✓ Copied' && !(await posts()).includes('act'));
    // 3 - withheld
    await set('plan', WITHHELD);
    await page.click('[data-scout-draft-again]');
    await state('draft-withheld', '[data-scout-draft="withheld"]');
    // 4 - the task card -> Confirm -> the done line with Undo
    await set('plan', TASK_CARD); await set('act', DONE(TASK_CARD, 'Added 1'));
    await say('add a task to call MetLife Thursday');
    await state('taskcard', '[data-scout-taskcard]');
    await page.click('[data-scout-confirm]');
    await state('taskdone', '[data-scout-undo]');
    // 5 - a task row's menu and its Snooze ▸ list with the date picker
    await set('plan', SNOOZE_ONE);
    await page.click(`button[aria-label="Actions for Send 24HF joint note to Upside with Brad cc'd"]`);
    await state('taskmenu', '[data-scout-menu="root"]');
    ok(`task menu @ ${tag}: ${(await page.$$eval('[data-scout-menu] [role=menuitem]', els => els.map(e => e.textContent.replace('▸', '')))).join(' · ')}`, (await page.$$eval('[data-scout-menu] [role=menuitem]', els => els.map(e => e.textContent.replace('▸', '')).join('|'))) === 'Done|Reassign|Snooze|Due|Drop|Open');
    await page.click('[data-scout-pick="snooze"]');
    await state('taskmenu-snooze', '[data-scout-pick-date]');
    await page.click('[data-scout-pick="taskdates:nextweek"]');
    await state('taskcard-snooze', '[data-scout-card="snooze"]');
    await page.keyboard.press('Escape');
    // 6 - a batch: one card
    await set('plan', SNOOZE_BATCH); await set('act', DONE(SNOOZE_BATCH, 'Snoozed 3 of 3 until 2026-11-16'));
    await say('snooze the first three tasks until next week');
    await state('batch', '[data-scout-card="snooze"]');
    await page.click('[data-scout-confirm]');
    await state('batch-done', '[data-scout-undo]');
    ok(`batch @ ${tag}: one card of ${(await page.$$('[data-scout-result="updated"]')).length} rows, ${(await page.$$('[data-scout-undo]')).length} Undo`, (await page.$$('[data-scout-undo]')).length === 1);
    // 7 - "Which one?"
    await set('ask', WHICH);
    await say('what do we know about her');
    await state('which', '[data-scout-which]');
    // 8 - a follow-up: the focus chip over a person brief
    await fixture('BRIEF', "f.resolved = { phrase: 'the second one', line: 'the second one → Meagan Earley, Cloudflare', rows: [{ entity: 'people', id: 'prospect:p2', title: 'Meagan Earley' }] }; const p = JSON.parse(JSON.stringify(window.__fixtures.ANSWER.sections[0].rows[1])); f.sections[0].rows = [p]; f.items = [p]; f.sections[0].read = 'goals/people/activity/person'; f.context_stats.reads = ['goals/people/activity/person']; f.sections[0].brief = { entity: 'people', id: 'prospect:p2', grid: [{ label: 'Record', value: 'Person · Principal People Team' }, { label: 'Company', value: 'Cloudflare · target' }, { label: 'Visits', value: 'last visit 2026-11-08' }, { label: 'Last email', value: '2026-10-29 · sent' }, { label: 'Notes', value: '—' }] }; f.summary = f.answer_md = 'the second one → Meagan Earley, Cloudflare. She has been sent two emails and her company visited on Nov 8.';");
    await say('what do we know about the second one');
    await state('focus', '[data-scout-focus]');
    // 9 - the company brief with its grid
    await load(); await fixture('BRIEF', GRID); await say('pull the intel on our recent call with Northrop');
    await state('brief', '[data-scout-brief-grid]');
    ok(`brief @ ${tag}: grid ${(await page.$$eval('[data-scout-brief-grid] dt', els => els.map(e => e.textContent))).join(' · ')}; footer "${(await page.textContent('[data-scout-footer]')).slice(0, 60)}" holds no id`, !/[0-9a-f]{8}-[0-9a-f]{4}-|prospect:|\/c1\b/.test(await page.textContent('[data-scout-footer]')));
    ok(`page errors @ ${tag}: ${errors.length}`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  if (!BEFORE) {
    // side by side: the mockup's task card panel | the build; and before | after for the draft and the brief
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1500 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`file://${path.join(MOCK, 'Scout3Actions.dc.html')}`); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, 'mock-Scout3Actions.png'), fullPage: true });
    const pair = async (name, left, right, labels, w) => {
      const html = `<body style="margin:0;background:#000;color:#fff;font:14px system-ui"><div style="display:flex;gap:20px;padding:20px;align-items:flex-start">${[[left, labels[0]], [right, labels[1]]].map(([f, l]) => `<figure style="margin:0"><figcaption style="height:22px">${l}</figcaption><img width="${w}" src="file://${path.join(OUT, f)}"></figure>`).join('')}</div></body>`;
      fs.writeFileSync(path.join(OUT, `pair-${name}.html`), html);
      await page.setViewportSize({ width: w * 2 + 60, height: 900 });
      await page.goto(`file://${path.join(OUT, `pair-${name}.html`)}`); await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `sidebyside-${name}.png`), fullPage: true });
      ok(`side by side: sidebyside-${name}.png`, true);
    };
    await pair('Scout3Actions-taskcard', 'mock-Scout3Actions.png', shots['taskcard-1440'], ['mockup: Scout3Actions.dc.html (panel 4 = the task command)', 'build: the task card'], 1440);
    for (const [w, tag] of [[1440, '1440'], [390, '390']]) {
      await pair(`draft-${tag}`, `draft-before-${tag}.png`, shots[`draft-${tag}`], ['before: the panel opens, addressed to the company', 'after: the draft inline, addressed to the person'], w);
      await pair(`brief-${tag}`, `brief-before-${tag}.png`, shots[`brief-${tag}`], ['before', 'after: the grid, then the prose'], w);
    }
    await ctx.close();
  }
} finally { await browser.close(); }
const passed = results.checks.filter(c => c.pass).length;
console.log(`\nscout-v3.1 Stage 2 ${BEFORE ? 'before' : 'harness'}: ${passed}/${results.checks.length} passed · Claude 0 · Apollo 0 · writes 0 · ${Math.round((Date.now() - T0) / 1000)} s`);
process.exit(passed === results.checks.length ? 0 : 1);
