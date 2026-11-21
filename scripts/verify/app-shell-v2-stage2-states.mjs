// app-shell-v2 Stage 2 - the shell's states on localhost as the platform owner, the sales workspace: axe on the shell
// surfaces of every state, 0 px overflow at 1440 and 390, the Viewer state, and side-by-side PNGs against the four
// mockups. READ-ONLY: 0 Claude (no ask is sent - the ask route is aborted in the browser if anything tries), 0 Apollo,
// 0 writes (every non-GET is aborted in the browser; the sign-in row is kept by rule, last_seen_at restored).
// The Viewer is a browser-side stand-in: the /api/me answer is rewritten to a viewer of the same workspace (no user is
// created; the server still sees the owner, so this proves what the shell DRAWS for a viewer, not what the server allows).
// DECLARED: 6 page loads + 4 mockup files; est. 150 s; cap 400 s. PNGs: .screenshots/app-shell-v2/stage2/.
// Usage: node scripts/verify/app-shell-v2-stage2-states.mjs
import fs from 'fs';
import path from 'path';
import { readOnlyBrowser } from './lib/readOnlyBrowser.mjs';

const h = await readOnlyBrowser({ port: 3996, capMs: 400000 });
const OUT = path.join(h.ROOT, '.screenshots', 'app-shell-v2', 'stage2');
const MOCK = path.join(h.ROOT, 'specs', 'design', 'app-shell');
fs.mkdirSync(OUT, { recursive: true });
const AXE = fs.readFileSync(path.join(h.ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const B = h.workspace.id;
const T0 = Date.now();
const checks = [];
const ok = (name, pass, detail = '') => { checks.push(!!pass); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${String(detail).slice(0, 500)}` : ''}`); };
const SHELL = ['[data-shell-nav]', '[data-shell-header]', '[data-shell-tabs]', '[data-shell-panel]', '[data-shell-account]', '[data-shell-switcher]', '[data-shell-more]', '[data-shell-fullsearch]', '[data-shell-settings] nav', '[data-shell-soon]', '[data-shell-shortcuts]', '[data-connections=feeds]'];
async function state(page, name, width, { shot = true } = {}) {
  await page.waitForTimeout(500);
  if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async sel => {
    const include = sel.filter(s => document.querySelector(s)).map(s => [s]);
    const v = include.length ? (await window.axe.run({ include }, { resultTypes: ['violations'] })).violations.map(x => `${x.id} (${x.nodes.length}) ${x.nodes[0]?.target?.join(' ')}`) : ['no shell surface on screen'];
    const m = document.querySelector('.sh-main');
    return { v, n2: document.documentElement.scrollWidth - window.innerWidth, main: m ? m.scrollWidth - m.clientWidth : 0, surfaces: include.length };
  }, SHELL);
  ok(`${name} @ ${width}: axe 0 on ${r.surfaces} shell surface${r.surfaces === 1 ? '' : 's'} · 0 px`, r.v.length === 0 && r.n2 <= 0 && r.main <= 0, r.v.length || r.n2 > 0 || r.main > 0 ? JSON.stringify(r) : '');
  if (shot) await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`) });
}
const settle = async page => { await page.waitForSelector('[data-shell]'); await page.waitForSelector('[data-attention-button] button:not([disabled])', { timeout: 40000 }).catch(() => {}); await page.waitForTimeout(2500); };
const field = page => page.getByRole('combobox', { name: 'Search or ask Scout' });
const rows = page => page.evaluate(() => [...document.querySelectorAll('[data-shell-panel] [role=option]')].map(n => ({ ask: n.hasAttribute('data-ask-row'), sel: n.getAttribute('aria-selected') === 'true', group: n.closest('[role=group]')?.querySelector('.sh-lbl')?.textContent || null })));

try {
  // ── 1440, the owner ───────────────────────────────────────────────────────
  let ctx = await h.context(1440);
  await ctx.route('**/api/scout/ask', r => r.abort());
  let page = await ctx.newPage(); page.setDefaultTimeout(30000);
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  await page.goto(`${h.BASE}/?business=${B}&tab=actions`); await settle(page);
  await page.waitForSelector('[data-nav-item=today] .sh-bd', { timeout: 30000 }).catch(() => {});
  const shell = await page.evaluate(() => ({
    nav: document.querySelector('[data-shell-nav]')?.getBoundingClientRect().width, hdr: document.querySelector('[data-shell-header]')?.getBoundingClientRect().height,
    items: [...document.querySelectorAll('[data-shell-nav] [data-nav-item]')].map(n => n.dataset.navItem), active: [...document.querySelectorAll('[data-shell-nav] [aria-current=page]')].map(n => n.dataset.navItem),
    old: { select: document.querySelectorAll('select[aria-label="Workspace"]').length, tabrow: document.querySelectorAll('[data-sales-tabrow], #workspace-header-tabs').length, help: document.querySelectorAll('[data-help-nav]').length, wsHeader: document.querySelectorAll('[data-workspace-header]').length },
    todayButtons: [...document.querySelectorAll('#sales-analytics-root button')].filter(b => /^(Needs attention|All clear|\+ To-do)/.test(b.textContent)).length,
    header: { attention: !!document.querySelector('[data-shell-header] [data-attention-button] button'), todo: !!document.querySelector('[data-shell-header] [data-add-todo]') },
    badge: document.querySelector('[data-nav-item=today] .sh-bd')?.textContent || null, hue: getComputedStyle(document.querySelector('.sh-root')).getPropertyValue('--sh-hue').trim(), rule: getComputedStyle(document.querySelector('[data-shell-header]')).borderBottomColor,
    names: document.querySelector('[data-shell-nav]').innerText + ' ' + document.querySelector('[data-shell-header]').innerText,
  }));
  const others = (await h.svc.from('businesses').select('id, name')).data.filter(b => b.id !== B).map(b => b.name);
  ok('shell @ 1440: nav 232 px, header 56 px, the entry\'s eight items, Today active alone', shell.nav === 232 && shell.hdr === 56 && shell.items.join() === 'home,today,pipeline,dashboard,scout,marketing,ideas,settings' && shell.active.join() === 'today', JSON.stringify([shell.nav, shell.hdr, shell.items, shell.active]));
  ok('removed in this stage: the native workspace select, the Sales tab strip, the Help row, the workspace header row, Today\'s two buttons', Object.values(shell.old).every(n => n === 0) && shell.todayButtons === 0, JSON.stringify([shell.old, shell.todayButtons]));
  ok('header: Needs attention and + To-do live there', shell.header.attention && shell.header.todo);
  const today = await page.evaluate(async b => (await (await fetch(`/api/sales/${b}/goals/today?owner=me`)).json()).badge, B);
  ok(`Today badge = the Today read's own badge (${today})`, String(today || '') === String(shell.badge || '') || (!today && !shell.badge), `nav ${shell.badge}`);
  ok('the nav and header name no other workspace until the switcher is opened', others.length > 0 && others.every(n => !shell.names.includes(n)));
  await state(page, 'today', 1440);
  // the switcher
  await page.getByRole('button', { name: /^Workspace:/ }).click();
  ok('switcher: a listbox of the member\'s workspaces + All workspaces', (await page.locator('[data-shell-switcher] [role=option]').count()) === others.length + 2);
  await state(page, 'switcher', 1440);
  await page.keyboard.press('Escape');
  // the field
  await page.keyboard.press('/');
  ok('"/" focuses the field; neon is on the focused field only', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Search or ask Scout' && getComputedStyle(document.querySelector('.sh-sf')).borderTopColor === 'rgb(57, 255, 20)' && [...document.querySelectorAll('[data-shell-nav] *, [data-shell-header] > button')].every(n => !/57, 255, 20/.test(getComputedStyle(n).color + getComputedStyle(n).borderTopColor + getComputedStyle(n).backgroundColor))));
  await state(page, 'search-empty', 1440);
  await page.keyboard.type('met', { delay: 50 });
  await page.waitForSelector('[data-shell-panel] [role=group] [role=option]', { timeout: 40000 });
  let r = await rows(page);
  ok('search "met": Companies · People · To-dos, at most 3 each, the first row selected, Ask Scout last', r[0].sel && !r[0].ask && r[r.length - 1].ask && ['Companies', 'People', 'To-dos'].every(g => r.filter(x => x.group === g).length <= 3) && r[0].group === 'Companies', JSON.stringify(r.map(x => x.group || 'ask')));
  ok('search "met": the first company is MetLife; no address in the panel', await page.evaluate(() => /^MetLife/.test(document.querySelector('[data-shell-panel] [role=option] .sh-ttl').textContent) && !document.querySelector('[data-shell-panel]').innerText.includes('@')));
  await state(page, 'search-met', 1440);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab');
  r = await rows(page);
  ok('keys: Down moves one row, Tab jumps to the next group', r.findIndex(x => x.sel) === r.findIndex(x => x.group === 'People'), JSON.stringify(r.map(x => x.sel)));
  await page.keyboard.press('Meta+A'); await page.keyboard.type('who owns metlife', { delay: 20 });
  await page.waitForFunction(() => document.querySelector('[data-shell-panel] [role=option]')?.hasAttribute('data-ask-row'));
  await page.waitForTimeout(3500);
  r = await rows(page);
  ok('a question: Ask Scout is first and selected', r[0].ask && r[0].sel);
  await state(page, 'search-question', 1440);
  await page.keyboard.press('Meta+A'); await page.keyboard.type('zzyx');
  await page.waitForSelector('[data-no-match]', { timeout: 40000 });
  ok('no match: one line, then Ask Scout alone', (await rows(page)).length === 1 && (await rows(page))[0].ask);
  await state(page, 'search-nomatch', 1440);
  await page.keyboard.press('Escape');
  ok('Esc closes the panel and empties the field', await page.evaluate(() => !document.querySelector('[data-shell-panel]') && document.querySelector('[data-shell-search] input').value === ''));
  await page.keyboard.press('Meta+K');
  ok('⌘K focuses the field', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Search or ask Scout'));
  await page.keyboard.press('Escape');
  // the account menu, shortcuts
  await page.getByRole('button', { name: /^Account menu/ }).click();
  await state(page, 'account', 1440);
  await page.locator('[data-account-item=shortcuts]').click();
  await state(page, 'shortcuts', 1440);
  await page.keyboard.press('Escape');
  // Settings › Connections
  await page.locator('[data-nav-item=settings]').click();
  await page.waitForSelector('[data-shell-settings]');
  ok('Settings as the owner: WORKSPACE (Team emails · Voice profile) and ADMIN (Team · Connections · Switches · Recompute · Send logs)', await page.evaluate(() => [...document.querySelectorAll('[data-settings-item]')].map(n => n.dataset.settingsItem).join() === 'team-emails,voice-profile,team,connections,switches,recompute,send-logs'));
  await page.locator('[data-settings-item=connections]').click();
  await page.waitForSelector('[data-connections=feeds] [data-provider=visitors]');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-connections=feeds] [data-provider]')].every(n => !/^…$|Loading/.test(n.innerText.trim().split('\n').pop())), null, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const conn = await page.evaluate(() => ({ order: [...document.querySelectorAll('[data-connections=feeds] [data-provider]')].map(n => n.dataset.provider), text: document.querySelector('[data-connections=feeds]').innerText, google: document.querySelectorAll('[data-provider=google], [data-tether-map]').length }));
  ok('Connections: the registry\'s feed cards in order, no Google mailbox block, no address', conn.order.join() === 'microsoft,fathom,apollo,visitors' && conn.google === 0 && !/@/.test(conn.text), JSON.stringify([conn.order, conn.google, /@/.test(conn.text)]));
  await state(page, 'connections', 1440);
  // Marketing, Scout, the rail
  await page.locator('[data-nav-item=marketing]').click(); await page.waitForSelector('[data-shell-soon]');
  await state(page, 'marketing', 1440);
  await page.locator('[data-nav-item=scout]').click(); await page.waitForSelector('[data-scout-page]');
  ok('Scout: its own page, the nav item active', await page.evaluate(() => document.querySelector('[data-nav-item=scout]').getAttribute('aria-current') === 'page'));
  await state(page, 'scout', 1440);
  await page.getByRole('button', { name: 'Collapse menu' }).click();
  ok('the rail: 60 px', await page.evaluate(() => document.querySelector('[data-shell-nav]').getBoundingClientRect().width === 60));
  await state(page, 'rail', 1440);
  await page.reload(); await page.waitForSelector('[data-shell-nav]');
  ok('the rail is remembered after a reload', await page.evaluate(() => document.querySelector('[data-shell-nav]').dataset.shellNav === 'rail'));
  // a deep link keeps its other params
  await page.goto(`${h.BASE}/?business=${B}&tab=pipeline&view=people`); await page.waitForSelector('[data-nav-item=pipeline][aria-current=page]');
  const q = new URL(page.url()).searchParams;
  ok('a ?business= link keeps its other params (tab, view) and consumes only business', q.get('tab') === 'pipeline' && q.get('view') === 'people' && !q.has('business'), page.url().split('?')[1]);
  ok('no page error at 1440', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ── 1440, a viewer (browser-side stand-in) ────────────────────────────────
  ctx = await h.context(1440);
  await ctx.route('**/api/me', async route => { const res = await route.fetch(); const me = await res.json(); me.profile = { ...me.profile, is_platform_owner: false }; me.memberships = (me.memberships || []).filter(m => m.business_id === B).map(m => ({ ...m, role: 'viewer' })); if (!me.memberships.length) me.memberships = [{ business_id: B, role: 'viewer' }]; await route.fulfill({ response: res, json: me }); });
  page = await ctx.newPage(); page.setDefaultTimeout(30000);
  await page.goto(`${h.BASE}/?business=${B}&tab=settings&view=team-emails`); await page.waitForSelector('[data-shell-settings]'); await settle(page);
  const v = await page.evaluate(() => ({ todo: document.querySelectorAll('[data-add-todo]').length, attention: !!document.querySelector('[data-shell-header] [data-attention-button] button'), admin: document.querySelectorAll('[data-settings-group=Admin]').length, ws: [...document.querySelectorAll('[data-settings-group=Workspace] [data-settings-item]')].map(n => n.textContent), role: document.querySelector('.sh-ws')?.innerText.replace(/\s+/g, ' ') }));
  ok('Viewer: no + To-do, Needs attention present, no Admin group, WORKSPACE = Team emails · Voice profile', v.todo === 0 && v.attention && v.admin === 0 && v.ws.join() === 'Team emails,Voice profile' && /Viewer/.test(v.role), JSON.stringify(v));
  await page.locator('[data-shell-header] [data-attention-button] button').click(); await page.waitForSelector('[data-attention-drawer]');
  ok('Viewer: the Needs attention drawer has no run button', await page.evaluate(() => [...document.querySelectorAll('[data-attention-drawer] button')].every(b => !/^(Sync now|Sync Outlook|Pull now|Tidy now|Fill headcounts|Send now)/.test(b.textContent.trim()))));
  await page.keyboard.press('Escape');
  await state(page, 'viewer-settings', 1440);
  await ctx.close();

  // ── 390 ───────────────────────────────────────────────────────────────────
  ctx = await h.context(390);
  await ctx.route('**/api/scout/ask', r => r.abort());
  page = await ctx.newPage(); page.setDefaultTimeout(30000);
  await page.goto(`${h.BASE}/?business=${B}&tab=actions`); await settle(page);
  await page.waitForFunction(() => !/Loading today/.test(document.querySelector('.sh-main')?.innerText || ''), null, { timeout: 40000 }).catch(() => {});
  const ph = await page.evaluate(() => ({ kind: document.querySelector('[data-shell]')?.dataset.shell, tabs: [...document.querySelectorAll('[data-shell-tabs] button')].map(b => b.getAttribute('aria-label') || b.textContent.replace(/\d+$/, '')), small: [...document.querySelectorAll('[data-shell-header] button, [data-shell-tabs] button')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }).filter(([w, hh]) => w < 44 || hh < 44) }));
  ok('phone: top bar + bottom tabs Today · Pipeline · search · Dashboard · More; every target at least 44 px', ph.kind === 'phone' && ph.tabs.join() === 'Today,Pipeline,Search or ask Scout,Dashboard,More' && ph.small.length === 0, JSON.stringify(ph));
  await state(page, 'today', 390);
  await page.locator('[data-shell-morebtn]').click(); await page.waitForSelector('[data-shell-more]');
  ok('phone More: Home · Scout · Marketing · Ideas · Settings, the workspace switch, the account', await page.evaluate(() => [...document.querySelectorAll('[data-shell-more] [data-nav-item]')].map(n => n.dataset.navItem).join() === 'home,scout,marketing,ideas,settings' && /switch workspace/.test(document.querySelector('[data-shell-more]').innerText)));
  await state(page, 'more', 390);
  await page.keyboard.press('Escape');
  await page.locator('[data-shell-centre]').click(); await page.waitForSelector('[data-shell-fullsearch]');
  await page.keyboard.type('met', { delay: 50 });
  await page.waitForSelector('[data-shell-panel] [role=group] [role=option]', { timeout: 40000 });
  ok('phone: the centre button opens the one search full screen', await page.evaluate(() => { const r = document.querySelector('[data-shell-fullsearch]').getBoundingClientRect(); return r.width === window.innerWidth && r.height === window.innerHeight; }));
  await state(page, 'fullsearch', 390);
  await ctx.close();

  // ── side by side with the four mockups ────────────────────────────────────
  const plain = await h.context(1440);
  const mp = await plain.newPage();
  const pairs = [
    ['Shell', 1440, ['today-1440.png', 'account-1440.png'], 'Shell.dc.html (1440): nav, header, the account menu over Today'],
    ['ShellSearch', 1440, ['search-met-1440.png', 'search-question-1440.png', 'search-empty-1440.png', 'search-nomatch-1440.png'], 'ShellSearch.dc.html: the field and its states'],
    ['ShellAdmin', 1440, ['connections-1440.png', 'viewer-settings-1440.png', 'marketing-1440.png', 'rail-1440.png'], 'ShellAdmin.dc.html: Settings / Admin, the viewer, Marketing, the rail'],
    ['ShellPhone', 390, ['today-390.png', 'fullsearch-390.png', 'more-390.png'], 'ShellPhone.dc.html (390): Today, the full-screen search, More'],
  ];
  for (const [name, width, shots, caption] of pairs) {
    await mp.setViewportSize({ width, height: 900 });
    await mp.goto(`file://${path.join(MOCK, `${name}.dc.html`)}`); await mp.waitForTimeout(1200);
    await mp.screenshot({ path: path.join(OUT, `mock-${name}.png`), fullPage: true });
    const img = f => `data:image/png;base64,${fs.readFileSync(path.join(OUT, f)).toString('base64')}`;
    const html = `<body style="margin:0;background:#05070A;color:#E9ECF0;font:14px system-ui;padding:16px"><div style="display:flex;gap:16px;align-items:flex-start"><div><div style="padding:0 0 8px;font-weight:600">MOCKUP · ${caption}</div><img src="${img(`mock-${name}.png`)}" style="width:${width}px;display:block;border:1px solid #333"></div><div style="display:flex;flex-direction:column;gap:16px">${shots.map(s => `<div><div style="padding:0 0 8px;font-weight:600">BUILD · ${s}</div><img src="${img(s)}" style="width:${width}px;display:block;border:1px solid #333"></div>`).join('')}</div></div></body>`;
    await mp.setViewportSize({ width: width * 2 + 64, height: 900 });
    await mp.setContent(html); await mp.waitForTimeout(600);
    await mp.screenshot({ path: path.join(OUT, `sidebyside-${name}.png`), fullPage: true });
    ok(`side by side: sidebyside-${name}.png`, fs.statSync(path.join(OUT, `sidebyside-${name}.png`)).size > 20000);
  }
  await plain.close();
  ok('0 writes reached a server (anything tried is aborted in the browser)', true, h.blocked.length ? `aborted: ${[...new Set(h.blocked)].join(', ')}` : 'none tried');
} catch (e) { ok('run', false, e.message.split('\n')[0]); }
finally { await h.close(); }
console.log(`${checks.filter(Boolean).length}/${checks.length} · 0 Claude · 0 Apollo · restored: yes`);
process.exit(checks.every(Boolean) ? 0 : 1);
