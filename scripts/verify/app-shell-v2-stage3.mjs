// app-shell-v2 Stage 3 - the live run on localhost as the platform owner, the sales workspace, after the Stage 2
// rulings (W1 the Scout window, W2 the Scout page, W3 a to-do's text once, W4 no floating Tasks tab / Scout star).
// Claude: AT MOST 2 asks ("who owns metlife" -> stays in the panel; "my overdue to-dos" -> opens the window); a
// third ask is aborted in the browser. --no-ask sends none: the same two lines are answered in the browser from an
// invented reply, and the PNGs go to stage3/replay/. Apollo 0. No write from the browser: every non-GET but those two asks is aborted (the ask route
// logs its own usage row per ask - that is the daily counter; the sign-in row is kept by rule, last_seen_at restored).
// Member and Viewer are browser-side stand-ins (the /api/me answer is rewritten; no user or role is changed): they
// prove what the shell DRAWS for that role, not what the server allows.
// DECLARED: 9 page loads at 1440 + 3 at 390 + 3 mockup files, 2 asks (about $0.02 each); est. 240 s; cap 560 s.
// PNGs: .screenshots/app-shell-v2/stage3/. Usage: node scripts/verify/app-shell-v2-stage3.mjs [--no-ask]
import fs from 'fs';
import path from 'path';
import { readOnlyBrowser } from './lib/readOnlyBrowser.mjs';

const ASK = !process.argv.includes('--no-ask');
const ASK_CAP = 2;
const h = await readOnlyBrowser({ port: 3996, capMs: 560000, allowPost: ASK ? ['/api/scout/ask'] : [] });
const OUT = path.join(h.ROOT, '.screenshots', 'app-shell-v2', 'stage3', ...(ASK ? [] : ['replay']));
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(path.join(h.ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const B = h.workspace.id;
const T0 = Date.now();
const checks = [];
let asks = 0;
const notes = [];
const ok = (name, pass, detail = '') => { checks.push(!!pass); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${String(detail).slice(0, 600)}` : ''}`); };
const SURFACES = ['[data-shell-header]', '[data-shell-tabs]', '[data-shell-panel]', '[data-scout-window]:not([hidden])', '[data-scout-page]'];
async function state(page, name, width, { shot = true } = {}) {
  await page.waitForTimeout(500);
  if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async sel => {
    const include = sel.filter(s => document.querySelector(s)).map(s => [s]);
    const v = (await window.axe.run({ include }, { resultTypes: ['violations'] })).violations.map(x => `${x.id} (${x.nodes.length}) ${x.nodes[0]?.target?.join(' ')}`);
    const m = document.querySelector('.sh-main');
    return { v, n2: document.documentElement.scrollWidth - window.innerWidth, main: m ? m.scrollWidth - m.clientWidth : 0, surfaces: include.length };
  }, SURFACES);
  ok(`${name} @ ${width}: axe 0 on ${r.surfaces} surface${r.surfaces === 1 ? '' : 's'} · 0 px`, r.v.length === 0 && r.n2 <= 0 && r.main <= 0, r.v.length || r.n2 > 0 || r.main > 0 ? JSON.stringify(r) : '');
  if (shot) await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`) });
}
const settle = async page => { await page.waitForSelector('[data-shell]'); await page.waitForSelector('[data-attention-button] button:not([disabled])', { timeout: 40000 }).catch(() => {}); await page.waitForTimeout(2500); };
const field = page => page.getByRole('combobox', { name: 'Search or ask Scout' });
const focused = page => page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName);
const win = page => page.evaluate(() => { const w = document.querySelector('[data-scout-window]'); if (!w || w.hidden) return null; const r = w.getBoundingClientRect(); return { kind: w.dataset.scoutWindow, w: Math.round(r.width), h: Math.round(r.height), right: Math.round(window.innerWidth - r.right), top: Math.round(r.top), modal: w.getAttribute('aria-modal'), rows: w.querySelectorAll('[data-scout-row]').length, input: !!w.querySelector('.scout-bar input'), scope: w.querySelectorAll('.scout-scope:not([data-static])').length }; });
// W4: anything fixed to the right edge that is a small tab or button (a drawer that is open is not one).
const floating = page => page.evaluate(() => [...document.querySelectorAll('body *')].filter(n => { const s = getComputedStyle(n); if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden') return false; const r = n.getBoundingClientRect(); return r.width > 0 && r.width < 140 && r.height < 240 && window.innerWidth - r.right <= 24 && !n.closest('[data-shell-tabs], [data-shell-header]'); }).map(n => `${n.tagName.toLowerCase()}${n.getAttribute('aria-label') ? `[${n.getAttribute('aria-label')}]` : ''} "${n.textContent.trim().slice(0, 30)}"`));
const asRole = role => async route => { const res = await route.fetch(); const me = await res.json(); me.profile = { ...me.profile, is_platform_owner: false }; me.memberships = (me.memberships || []).filter(m => m.business_id === B).map(m => ({ ...m, role })); if (!me.memberships.length) me.memberships = [{ business_id: B, role }]; await route.fulfill({ response: res, json: me }); };
// --no-ask: the two asks are answered in the browser from an invented reply (nothing reaches the server), so the same
// steps run either way.
const capAsks = ctx => ctx.route('**/api/scout/ask', route => {
  if (!ASK) { const q = route.request().postDataJSON()?.q || ''; return route.fulfill({ json: /overdue/.test(q) ? CANNED_LIST : CANNED_SHORT }); }
  if (asks >= ASK_CAP) return route.abort();
  asks += 1; return route.fallback();
});

// An invented thread for --no-ask (and for the phone, which gets the real one copied from the 1440 run when asked).
const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const todo = (i, text, due) => ({ entity: 'todos', id: `fixture-${i}`, title: text, date: due, workspace_id: B, open: { page: 'sales', params: { tab: 'actions', open: `todo:fixture-${i}` } }, why: text, row: { kind: 'task', id: `fixture-${i}`, text, due, overdue: true, owner: 'mine', owner_user_id: h.owner.userId, link: null, verb: 'next_steps' } });
const FIX_ROWS = [todo(1, 'Send the joint note to the two partner leads', '2026-11-08'), todo(2, 'Intro the two relocation partners', '2026-11-10'), todo(3, 'Create the reporting draft for the pilot', '2026-11-11'), todo(4, 'Reply to the intro thread', '2026-11-12')];
const FIXTURE = JSON.stringify({ user: h.owner.userId, day, turns: [{ at: Date.now() - 60000, q: 'my overdue to-dos', scope: B, elapsed: 4, answer_md: 'You have 4 overdue to-dos, oldest first.', summary: 'You have 4 overdue to-dos, oldest first.', sections: [{ title: 'Tasks', count: 4, total: 4, rule: 'Open to-dos ranked overdue first, then due soonest, then undated; yours first on a tie.', read: 'openTodos (4 open, mine)', rows: FIX_ROWS, line: null, brief: null }], items: FIX_ROWS, usage: { input_tokens: 2100, output_tokens: 120, cost_usd: 0.0081 }, ask: { mine: true, entity: 'todos' }, cap: { used: 1, max: 40 }, context_stats: { reads: ['openTodos (4 open, mine)'], rows_by_entity: { todos: 4 } } }] });
const CANNED = { usage: { input_tokens: 2100, output_tokens: 120, cost_usd: 0.0081 }, withheld: false, scope: B, cap: { used: 1, max: 40 } };
const CANNED_LIST = { ...CANNED, answer_md: 'You have 4 overdue to-dos, oldest first.', summary: 'You have 4 overdue to-dos, oldest first.', sections: [{ title: 'Tasks', count: 4, total: 4, rule: 'Open to-dos ranked overdue first.', read: 'openTodos (4 open, mine)', rows: FIX_ROWS, line: null, brief: null }], items: FIX_ROWS, ask: { mine: true, entity: 'todos' }, context_stats: { reads: ['openTodos (4 open, mine)'], rows_by_entity: { todos: 4 } } };
const CANNED_SHORT = { ...CANNED, answer_md: 'An invented short answer.', summary: 'An invented short answer.', sections: [], items: [], ask: {}, context_stats: { reads: ['goals/brief/partner'], rows_by_entity: { partners: 1 } } };
let liveThread = null;

try {
  // ── 1440, the owner ───────────────────────────────────────────────────────
  let ctx = await h.context(1440, { storage: ASK ? {} : { prospector_scout_thread: FIXTURE } });
  await capAsks(ctx);
  let page = await ctx.newPage(); page.setDefaultTimeout(30000);
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  await page.goto(`${h.BASE}/?business=${B}&tab=actions`); await settle(page);
  await page.waitForSelector('[data-nav-item=today] .sh-bd', { timeout: 30000 }).catch(() => {});

  // W4 on the four daily pages
  const float = {};
  float.today = await floating(page);
  for (const [name, q] of [['pipeline', 'tab=pipeline&view=companies'], ['dashboard', 'tab=dashboard&view=analytics']]) { await page.goto(`${h.BASE}/?business=${B}&${q}`); await settle(page); float[name] = await floating(page); }
  await page.goto(`${h.BASE}/?business=${B}&tab=actions`); await settle(page);
  const gone = await page.evaluate(() => ({ tasks: document.querySelectorAll('button[aria-label^="Open tasks"], button[aria-label^="Tasks"]').length, star: document.querySelectorAll('.scout-star-btn').length }));
  ok('W4: no floating Tasks tab and no floating Scout star on Today, Pipeline or Dashboard (nothing small is fixed to the right edge)', Object.values(float).every(f => f.length === 0) && gone.tasks === 0 && gone.star === 0, JSON.stringify({ float, gone }));

  // the badge against the Today read
  const today = await page.evaluate(async b => { const d = await (await fetch(`/api/sales/${b}/goals/today?owner=me`)).json(); return { badge: d.badge, groups: (d.groups || []).map(g => [g.id, g.n]) }; }, B);
  const navBadge = await page.evaluate(() => document.querySelector('[data-nav-item=today] .sh-bd')?.textContent || '');
  const g12 = today.groups.filter(([id]) => id === 'due' || id === 'top').reduce((n, [, c]) => n + c, 0);
  ok(`Today badge ${navBadge || 0} = the Today read's groups 1 + 2 (${today.groups.filter(([id]) => id === 'due' || id === 'top').map(([id, n]) => `${id} ${n}`).join(' + ')} = ${g12})`, String(navBadge || 0) === String(g12) && g12 === Number(today.badge || 0), JSON.stringify(today));

  // the keys, the search, Enter on MetLife
  await page.keyboard.press('/');
  ok('"/" focuses the field', await focused(page) === 'Search or ask Scout');
  await page.keyboard.press('Escape');
  await page.locator('[data-nav-item=today]').focus();
  await page.keyboard.press('Meta+K');
  ok('⌘K focuses the field', await focused(page) === 'Search or ask Scout');
  await page.keyboard.type('met', { delay: 50 });
  await page.waitForSelector('[data-shell-panel] [role=group] [role=option]', { timeout: 40000 });
  const met = await page.evaluate(() => ({ first: document.querySelector('[data-shell-panel] [role=option] .sh-ttl').textContent, count: document.querySelector('[data-shell-count]').textContent, live: document.querySelector('[data-shell-count]').getAttribute('aria-live'), at: document.querySelector('[data-shell-panel]').innerText.includes('@') }));
  ok(`search "met": MetLife first, the count announced politely ("${met.count}"), no address`, /^MetLife/.test(met.first) && /^\d+ results?$/.test(met.count) && met.live === 'polite' && !met.at, JSON.stringify(met));
  await state(page, 'search-met', 1440);
  await page.keyboard.press('Escape');
  const esc1 = await page.evaluate(() => ({ value: document.querySelector('[data-shell-search] input').value, panel: !!document.querySelector('[data-shell-panel]'), label: document.activeElement?.getAttribute('aria-label') }));
  await page.keyboard.press('Escape');
  const esc2 = await page.evaluate(() => ({ panel: !!document.querySelector('[data-shell-panel]'), back: document.activeElement?.closest('[data-nav-item]')?.dataset.navItem || document.activeElement?.tagName }));
  ok('Esc clears what was typed, then closes and returns focus to where it was (the Today nav item)', esc1.value === '' && esc1.panel && esc1.label === 'Search or ask Scout' && !esc2.panel && esc2.back === 'today', JSON.stringify([esc1, esc2]));
  await page.keyboard.press('/'); await page.keyboard.type('met', { delay: 50 });
  await page.waitForSelector('[data-shell-panel] [role=group] [role=option]', { timeout: 40000 });
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-center-window]', { timeout: 40000 });
  const opened = await page.evaluate(() => ({ label: document.querySelector('[data-center-window]').getAttribute('aria-label'), nav: document.querySelector('[data-shell-nav] [aria-current=page]')?.dataset.navItem, open: new URL(location.href).searchParams.get('open') }));
  ok('search "met" ↵ opens MetLife (its company window, on Pipeline)', /MetLife/.test(opened.label || '') && opened.nav === 'pipeline', JSON.stringify(opened));
  await page.waitForTimeout(600); await page.keyboard.press('Escape'); await page.waitForSelector('[data-center-window]', { state: 'detached' });

  // Needs attention and + To-do from the header
  await page.locator('[data-shell-header] [data-attention-button] button').click(); await page.waitForSelector('[data-attention-drawer]');
  ok('Needs attention opens its drawer from the header', true);
  await page.getByRole('button', { name: 'Close needs attention' }).click(); await page.waitForSelector('[data-attention-drawer]', { state: 'detached' });
  await page.locator('[data-shell-header] [data-add-todo]').click(); await page.waitForSelector('[data-capture-panel]');
  ok('+ To-do opens the form from the header (closed unsaved)', true);
  await page.getByRole('button', { name: 'Close quick capture' }).click(); await page.waitForSelector('[data-capture-panel]', { state: 'detached' }).catch(() => {});

  // Settings as the owner, Connections, Marketing
  await page.locator('[data-nav-item=settings]').click(); await page.waitForSelector('[data-shell-settings]');
  ok('Settings as the owner: the ADMIN group is there (Team · Connections · Switches · Recompute · Send logs)', await page.evaluate(() => [...document.querySelectorAll('[data-settings-group=Admin] [data-settings-item]')].map(n => n.dataset.settingsItem).join() === 'team,connections,switches,recompute,send-logs'));
  await page.locator('[data-settings-item=connections]').click(); await page.waitForSelector('[data-connections=feeds] [data-provider=visitors]');
  const conn = await page.evaluate(() => ({ order: [...document.querySelectorAll('[data-connections=feeds] [data-provider]')].map(n => n.dataset.provider), google: document.querySelectorAll('[data-provider=google], [data-tether-map]').length, at: /@/.test(document.querySelector('[data-connections=feeds]').innerText) }));
  ok('Connections: the feed cards (Microsoft · Fathom · Apollo · Site visitors), no Google mailbox block, no address', conn.order.join() === 'microsoft,fathom,apollo,visitors' && conn.google === 0 && !conn.at, JSON.stringify(conn));
  await page.locator('[data-nav-item=marketing]').click(); await page.waitForSelector('[data-shell-soon]');
  ok('Marketing: its own route, the nav item active', await page.evaluate(() => document.querySelector('[data-nav-item=marketing]').getAttribute('aria-current') === 'page' && /Coming soon/.test(document.querySelector('[data-shell-soon]').innerText)));

  // W1 - the window from the field's star, on Today
  await page.locator('[data-nav-item=today]').click(); await page.waitForSelector('[data-nav-item=today][aria-current=page]'); await page.waitForTimeout(1500);
  await page.locator('[data-shell-star]').click(); await page.waitForSelector('[data-scout-window]:not([hidden])');
  let w = await win(page);
  ok('W1: the star in the field opens the Scout window - a 640 px drawer on the right, full height, over Today (no navigation), a follow-up input, no scope pill', w && w.kind === 'drawer' && w.w === 640 && w.right === 0 && w.top === 0 && w.h === 900 && w.input && w.scope === 0 && await page.evaluate(() => document.querySelector('[data-nav-item=today]').getAttribute('aria-current') === 'page'), JSON.stringify(w));
  ok('W1: focus is in the window\'s follow-up input', await focused(page) === 'Ask a follow-up or give a command');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  ok('W1: Esc closes the window and returns focus to the field - its ring on, the panel and its dimmer shut, so the page takes the next click', await win(page) === null && await focused(page) === 'Search or ask Scout' && await page.evaluate(() => !document.querySelector('[data-shell-panel]') && !document.querySelector('.sh-scrim') && document.querySelector('.sh-sf').classList.contains('is-focus')));
  await page.keyboard.press('Escape');
  await page.locator('[data-shell-star]').click(); await page.waitForSelector('[data-scout-window]:not([hidden])');
  await page.getByRole('button', { name: 'Close Scout' }).click(); await page.waitForTimeout(300);
  ok('W1: the close button does the same', await win(page) === null && await focused(page) === 'Search or ask Scout');
  await page.keyboard.press('Escape');

  {
    // ask 1 - stays in the panel
    await page.keyboard.press('/'); await page.keyboard.type('who owns metlife', { delay: 15 });
    await page.waitForFunction(() => document.querySelector('[data-shell-panel] [role=option]')?.hasAttribute('data-ask-row'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => { const a = document.querySelector('[data-shell-answer]'); return a && !/Reading for/.test(a.innerText); }, null, { timeout: 90000 });
    const a1 = await page.evaluate(() => ({ text: document.querySelector('[data-shell-answer]').innerText.replace(/\s+/g, ' '), foot: document.querySelector('[data-shell-panel] .sh-foot')?.innerText.replace(/\s+/g, ' ') || '', nav: document.querySelector('[data-shell-nav] [aria-current=page]')?.dataset.navItem, win: !!document.querySelector('[data-scout-window]:not([hidden])') }));
    notes.push(`ask 1 "who owns metlife" -> ${a1.text} | ${a1.foot}`);
    ok('ask 1 "who owns metlife": the answer stays in the panel (no window, no navigation), no address', !a1.win && a1.nav === 'today' && /Keep asking in Scout/.test(a1.text) && !a1.text.includes('@'), JSON.stringify(a1));
    await state(page, 'panel-answer', 1440);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    // ask 2 - opens the window
    await page.keyboard.press('/'); await page.keyboard.type('my overdue to-dos', { delay: 15 });
    await page.waitForFunction(() => document.querySelector('[data-shell-panel] [role=option]')?.hasAttribute('data-ask-row'));
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-scout-window]:not([hidden]) [data-scout-answer]', { timeout: 90000 });
    w = await win(page);
    const a2 = await page.evaluate(() => {
      const el = document.querySelector('[data-scout-window] [data-scout-answer]');
      const prose = el.querySelector('[data-scout-prose]')?.innerText || '';
      const rows = [...el.querySelectorAll('[data-scout-row]')].map(n => n.querySelector('span span')?.textContent || '');
      const twice = rows.filter(t => t && prose.split(t.slice(0, 60)).length - 1 > 1);
      return { prose, rows: rows.length, twice, lines: prose.split('\n').filter(Boolean).length, nav: document.querySelector('[data-shell-nav] [aria-current=page]')?.dataset.navItem, panel: !!document.querySelector('[data-shell-panel]'), footer: el.querySelector('[data-scout-footer]')?.innerText.replace(/\s+/g, ' ') };
    });
    notes.push(`ask 2 "my overdue to-dos" -> ${a2.rows} rows | ${a2.footer}\n----- prose -----\n${a2.prose}\n-----------------`);
    ok(`ask 2 "my overdue to-dos": opens the WINDOW over Today (not the Scout page) with ${a2.rows} rows; no to-do's text is printed twice in the answer`, w && w.kind === 'drawer' && a2.nav === 'today' && !a2.panel && a2.rows > 0 && a2.twice.length === 0, JSON.stringify({ w, twice: a2.twice, nav: a2.nav }));
    await state(page, 'window', 1440);
    liveThread = await page.evaluate(() => localStorage.getItem('prospector_scout_thread'));
    ok('the thread holds both asks', JSON.parse(liveThread).turns.map(t => t.q).slice(-2).join(' | ') === 'who owns metlife | my overdue to-dos', JSON.parse(liveThread).turns.map(t => t.q).join(' | '));
    if (!ASK) liveThread = null;
    await page.getByRole('button', { name: 'Close Scout' }).click(); await page.keyboard.press('Escape');
  }

  // W2 - the Scout page
  await page.locator('[data-nav-item=scout]').click(); await page.waitForSelector('[data-scout-page] [data-scout-answer]');
  const sp = await page.evaluate(() => { const p = document.querySelector('[data-scout-page]'), pop = p.querySelector('[data-scout-pop]').getBoundingClientRect(); return { width: Math.round(p.getBoundingClientRect().width), pop: Math.round(pop.width), inputs: p.querySelectorAll('input, textarea').length, fields: document.querySelectorAll('[data-shell-header] input').length, thread: [...p.querySelectorAll('[data-scout-thread] .scout-turn')].length, win: !!document.querySelector('[data-scout-window]:not([hidden])'), float: 0 }; });
  ok(`W2: the Scout page is the thread at content width (${sp.pop} px, max 960), no field of its own - the header's is the only one; past asks listed (${sp.thread})`, sp.width <= 960 && sp.pop > 700 && sp.pop <= 960 && sp.inputs === 0 && sp.fields === 1 && sp.thread >= 1 && !sp.win, JSON.stringify(sp));
  ok('W4: nothing floats on the Scout page either', (await floating(page)).length === 0, JSON.stringify(await floating(page)));
  await state(page, 'scoutpage', 1440);
  ok('no page error at 1440', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ── 1440, a member and a viewer (browser-side stand-ins) ───────────────────
  for (const role of ['member', 'viewer']) {
    ctx = await h.context(1440, { storage: { prospector_scout_thread: liveThread || FIXTURE } });
    await capAsks(ctx);
    await ctx.route('**/api/me', asRole(role));
    page = await ctx.newPage(); page.setDefaultTimeout(30000);
    await page.goto(`${h.BASE}/?business=${B}&tab=settings&view=team-emails`); await page.waitForSelector('[data-shell-settings]'); await settle(page);
    const v = await page.evaluate(() => ({ todo: document.querySelectorAll('[data-add-todo]').length, attention: !!document.querySelector('[data-shell-header] [data-attention-button] button'), admin: document.querySelectorAll('[data-settings-group=Admin]').length, ws: [...document.querySelectorAll('[data-settings-group=Workspace] [data-settings-item]')].map(n => n.textContent).join(), role: document.querySelector('.sh-ws')?.innerText.replace(/\s+/g, ' ') }));
    if (role === 'member') ok('as a Member (stand-in): no ADMIN group in Settings; + To-do and Needs attention are there', v.admin === 0 && v.todo === 1 && v.attention && /Member/.test(v.role), JSON.stringify(v));
    else {
      ok('Viewer (stand-in): no + To-do, no ADMIN group, Needs attention present, WORKSPACE = Team emails · Voice profile', v.todo === 0 && v.admin === 0 && v.attention && v.ws === 'Team emails,Voice profile' && /Viewer/.test(v.role), JSON.stringify(v));
      await page.keyboard.press('/'); await page.keyboard.type('met', { delay: 50 });
      await page.waitForSelector('[data-shell-panel] [role=group] [role=option]', { timeout: 40000 });
      ok('Viewer: search works', await page.evaluate(() => /^MetLife/.test(document.querySelector('[data-shell-panel] [role=option] .sh-ttl').textContent)));
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      await page.locator('[data-shell-star]').click(); await page.waitForSelector('[data-scout-window]:not([hidden]) [data-scout-answer]');
      ok('Viewer: the Scout window opens read-only (its note says so; no row menu)', await page.evaluate(() => !!document.querySelector('[data-scout-window] [data-scout-viewer]') && document.querySelectorAll('[data-scout-window] .scout-more-btn').length === 0));
      await state(page, 'viewer-window', 1440);
    }
    await ctx.close();
  }

  // ── 390 ───────────────────────────────────────────────────────────────────
  ctx = await h.context(390, { storage: { prospector_scout_thread: liveThread || FIXTURE } });
  await capAsks(ctx);
  page = await ctx.newPage(); page.setDefaultTimeout(30000);
  await page.goto(`${h.BASE}/?business=${B}&tab=actions`); await settle(page);
  await page.waitForFunction(() => !/Loading today/.test(document.querySelector('.sh-main')?.innerText || ''), null, { timeout: 40000 }).catch(() => {});
  const ph = await page.evaluate(() => ({ kind: document.querySelector('[data-shell]')?.dataset.shell, tabs: [...document.querySelectorAll('[data-shell-tabs] button')].map(b => b.getAttribute('aria-label') || b.textContent.replace(/\d+$/, '')).join(), tasks: document.querySelectorAll('button[aria-label^="Tasks"]').length }));
  ok('390: bottom tabs Today · Pipeline · the Scout button · Dashboard · More; no Tasks button', ph.kind === 'phone' && ph.tabs === 'Today,Pipeline,Search or ask Scout,Dashboard,More' && ph.tasks === 0 && (await floating(page)).length === 0, JSON.stringify(ph));
  await page.locator('[data-shell-centre]').click(); await page.waitForSelector('[data-shell-fullsearch]');
  await page.keyboard.type('met', { delay: 50 });
  await page.waitForSelector('[data-shell-panel] [role=group] [role=option]', { timeout: 40000 });
  ok('390: the centre button opens the one search full screen', await page.evaluate(() => { const r = document.querySelector('[data-shell-fullsearch]').getBoundingClientRect(); return r.width === window.innerWidth && r.height === window.innerHeight; }));
  await page.locator('[data-shell-star]').click(); await page.waitForSelector('[data-scout-window]:not([hidden]) [data-scout-answer]');
  w = await win(page);
  ok('390: the Scout window is a full-screen sheet (modal), the search closed under it', w && w.kind === 'sheet' && w.w === 390 && w.h === 844 && w.modal === 'true' && await page.evaluate(() => !document.querySelector('[data-shell-fullsearch]')), JSON.stringify(w));
  ok('390: the sheet\'s close and input are 44 px', await page.evaluate(() => [document.querySelector('[data-scout-window] [aria-label="Close Scout"]'), document.querySelector('[data-scout-window] .scout-bar')].every(n => { const r = n.getBoundingClientRect(); return r.height >= 44; })));
  await state(page, 'window', 390);
  await page.getByRole('button', { name: 'Close Scout' }).click(); await page.waitForTimeout(300);
  ok('390: closing returns focus to the Scout button', await win(page) === null && await focused(page) === 'Search or ask Scout' && await page.evaluate(() => document.activeElement?.hasAttribute('data-shell-centre')));
  await page.locator('[data-shell-morebtn]').click(); await page.waitForSelector('[data-shell-more]');
  await page.locator('[data-shell-more] [data-nav-item=scout]').click(); await page.waitForSelector('[data-scout-page] [data-scout-answer]');
  ok('390: More › Scout is the thread, no field on the page', await page.evaluate(() => document.querySelector('[data-scout-page]').querySelectorAll('input').length === 0));
  await state(page, 'scoutpage', 390);
  await ctx.close();

  // ── side by side ──────────────────────────────────────────────────────────
  const plain = await h.context(1440);
  const mp = await plain.newPage();
  const pairs = [
    ['ShellSearch', path.join('app-shell', 'ShellSearch.dc.html'), 1440, ['search-met-1440.png', 'panel-answer-1440.png'], 'ShellSearch.dc.html: the panel - search and the short answer'],
    ['ScoutWindow', path.join('scout-v3', 'Scout3Answer.dc.html'), 1440, ['window-1440.png', 'scoutpage-1440.png'], 'Scout3Answer.dc.html (the Scout v3 answer panel) beside the window and the page'],
    ['ScoutWindowPhone', path.join('scout-v3', 'Scout3Phone.dc.html'), 390, ['window-390.png', 'scoutpage-390.png'], 'Scout3Phone.dc.html (390) beside the sheet and the page'],
  ];
  for (const [name, mock, width, shots, caption] of pairs) {
    await mp.setViewportSize({ width, height: 900 });
    await mp.goto(`file://${path.join(h.ROOT, 'specs', 'design', mock)}`); await mp.waitForTimeout(1200);
    await mp.screenshot({ path: path.join(OUT, `mock-${name}.png`), fullPage: true });
    const img = f => `data:image/png;base64,${fs.readFileSync(path.join(OUT, f)).toString('base64')}`;
    const html = `<body style="margin:0;background:#05070A;color:#E9ECF0;font:14px system-ui;padding:16px"><div style="display:flex;gap:16px;align-items:flex-start"><div><div style="padding:0 0 8px;font-weight:600">MOCKUP · ${caption}</div><img src="${img(`mock-${name}.png`)}" style="width:${width}px;display:block;border:1px solid #333"></div><div style="display:flex;flex-direction:column;gap:16px">${shots.map(s => `<div><div style="padding:0 0 8px;font-weight:600">BUILD · ${s}</div><img src="${img(s)}" style="width:${width}px;display:block;border:1px solid #333"></div>`).join('')}</div></div></body>`;
    await mp.setViewportSize({ width: width * 2 + 64, height: 900 });
    await mp.setContent(html); await mp.waitForTimeout(600);
    await mp.screenshot({ path: path.join(OUT, `sidebyside-${name}.png`), fullPage: true });
    ok(`side by side: sidebyside-${name}.png`, fs.statSync(path.join(OUT, `sidebyside-${name}.png`)).size > 20000);
  }
  await plain.close();
  const stray = [...new Set(h.blocked)];
  ok(`asks sent: ${asks} of ${ASK ? ASK_CAP : 0} allowed; no other write reached a server`, asks <= ASK_CAP && (ASK ? asks === ASK_CAP : asks === 0), stray.length ? `aborted in the browser: ${stray.join(', ')}` : 'nothing else tried');
} catch (e) { ok('run', false, e.message.split('\n').slice(0, 12).join(' / ')); }
finally { await h.close(); }
for (const n of notes) console.log(n);
console.log(`${checks.filter(Boolean).length}/${checks.length} · Claude ${asks} (cap ${ASK ? ASK_CAP : 0}) · 0 Apollo · restored: yes`);
process.exit(checks.every(Boolean) ? 0 : 1);
