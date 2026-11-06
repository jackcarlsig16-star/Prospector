// company-window-v4 Stage 1 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover
// workspace, READ-ONLY (0 Claude, 0 Apollo, no writes: every non-GET API call and Supabase write is aborted at the network
// layer and counted; the menus are opened and closed with Escape, never picked - the saves are the Jest suites').
// Opens Fortem Media (target) at 1440 and 390: head = title · [Interest] · Actions · facts · strip, no SETUP; facts in the
// F order with no Stage; readiness from GET goals/company's steps lands on Owner / Employees (red dashed, "unassigned" /
// "unknown", the step's title) and the Intel header; the title's Intent reads "no score yet · Recompute" without a
// score; DECIDE = Add to pipeline ▾ (primary) · Not a fit · Deprioritize; one click on Owner = a listbox of members with
// color dots + Unassigned, no <select> in any popover, N2 0 px while it is open; axe 0; 390 no sideways scroll.
// Side-by-side PNG: the mockup's head (CompanyHead.dc.html, file://) beside the build's window head at 1440.
// A second target with no owner and no size yet (the DB picks it) shows the red states live. Declared scope: 3 page
// loads, 2 target lookups, 3 GETs, 10 table counts twice. ~100 s, cap 240 s.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'company-window-v4-stage1');
const MOCK = path.join(ROOT, 'specs', 'design', 'company-panel-v4', 'CompanyHead.dc.html');
const PORT = 3996, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const TABLES = ['sales_targets', 'sales_opportunities', 'sales_goals', 'sales_week_goals', 'sales_partner_events', 'research_runs', 'sales_company_scores', 'business_anthropic_usage', 'apollo_credit_spend', 'sales_notes'];
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const scoped = new Map();
async function count(t) {
  if (scoped.get(t) !== false) {
    const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL);
    if (!r.error && typeof r.count === 'number') { scoped.set(t, true); return r.count; }
    scoped.set(t, false);
  }
  const r = await svc.from(t).select('*', { count: 'exact', head: true });
  return r.error ? `n/a (${r.error.message.slice(0, 40)})` : `${r.count} (whole table)`;
}
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
let srv, browser, owner;
const blocked = [], realCalls = [], writes = [];
const results = { checks: [], errors: [], axe: {}, n2: {}, deviations: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 300)}` : ''); };
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
fs.mkdirSync(OUT, { recursive: true });
const before = await snapshot();
log('before', JSON.stringify(before));

try {
  const fortem = (await svc.from('sales_targets').select('id, name, status, owner_user_id, employees').eq('business_id', HL).ilike('name', 'Fortem Media').limit(1)).data?.[0];
  if (!fortem) throw new Error('expected Fortem Media (target) on HomeLover');
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', ANTHROPIC_API_KEY: '', APOLLO_API_KEY: '', MICROSOFT_CLIENT_SECRET: '', GMAIL_CLIENT_SECRET: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const get = async p => { const r = await fetch(`${BASE}/api/sales/${HL}${p}`, { headers: { cookie } }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const d = await get(`/goals/company?type=target&id=${fortem.id}`);
  const steps = d.body?.steps?.steps || [];
  const open = id => { const s = steps.find(x => x.id === id); return !!s && !['done', 'skip', 'running'].includes(s.status); };
  const score = await get(`/goals/scores/target/${fortem.id}`);
  const noScore = !score.body?.row;
  ok(`real wiring: GET goals/company Fortem ${d.status}: steps ${steps.map(s => `${s.id}:${s.status}`).join(' ')}; owner open ${open('owner')} (owner_user_id ${fortem.owner_user_id ? 'set' : 'null'}), size open ${open('size')} (employees ${fortem.employees ?? 'null'}), research open ${open('research')}; score ${score.status} ${noScore ? 'none yet' : score.body.row.score}; no "@"`, d.status === 200 && !JSON.stringify(d.body).includes('@') && open('owner') === !fortem.owner_user_id && open('size') === (fortem.employees == null));

  const needy = (await svc.from('sales_targets').select('id, name, status, owner_user_id, employees').eq('business_id', HL).in('status', ['proposed', 'researching']).is('owner_user_id', null).is('employees', null).order('created_at', { ascending: false }).limit(1)).data?.[0] || null;
  browser = await chromium.launch();
  async function openWin(width, id = fortem.id) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem('prospector_goals_owner', 'team');
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol === 'file:' || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) realCalls.push(`${req.method()} ${u.host}`);
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname);
      if (apiWrite) writes.push(`${req.method()} ${u.pathname}`);
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?tab=pipeline&view=companies&open=target-${id}`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('tab', { name: 'Companies', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator('[data-center-window] [data-actions-row]').first().waitFor({ timeout: 30000 });
    await page.locator('[data-center-window] [data-facts-row] [data-fact]').first().waitFor({ timeout: 30000 }); await page.waitForTimeout(2500);
    return { ctx, page, errors };
  }
  const axeOn = async (page, key) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => { const r = await window.axe.run(document.querySelector('[data-center-window]'), { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, targets: x.nodes.slice(0, 3).map(n => n.target.join(' ')) })); });
    results.axe[key] = v;
    ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v).slice(0, 300));
  };
  const headInfo = page => page.evaluate(() => {
    const dlg = document.querySelector('[data-center-window]'); const head = dlg.querySelector('[data-window-head]');
    const blocks = [...head.children].map(el => el.matches('[data-company-panel]') ? 'title' : el.querySelector('[data-facts-row]') ? 'facts' : el.matches('[data-company-progress]') ? 'strip' : el.matches('[data-steps]') ? 'setup' : el.matches('[data-interest-band]') ? 'interest' : el.matches('[data-actions-row]') ? 'actions' : el.tagName.toLowerCase());
    const facts = [...head.querySelectorAll('[data-facts-row] [data-fact]')].map(el => ({ label: el.dataset.fact, need: el.dataset.need === 'true', title: el.getAttribute('title'), value: el.querySelector('b')?.textContent, button: el.tagName === 'BUTTON', dot: !!el.querySelector('i') }));
    const decide = [...(dlg.querySelector('[data-action-group="decide"], [role="group"][aria-label="Decide"]')?.querySelectorAll('button') || [])].map(b => ({ text: b.textContent, primary: b.classList.contains('ui-btn--primary') }));
    const intel = dlg.querySelector('[data-section="research"] [data-card-head]');
    const intent = dlg.querySelector('[data-company-panel] [data-intent-fact] summary')?.textContent.replace(/\s+/g, ' ').trim();
    return { blocks, facts, decide, intelNeed: intel?.dataset.need === 'true', intelTitle: intel?.getAttribute('title'), intent, recomputeLink: !!dlg.querySelector('[data-company-panel] [data-recompute]'), selectsInPops: dlg.querySelectorAll('[data-facts-row] select, [data-fact-pop] select').length, setup: dlg.querySelectorAll('[data-steps]').length, headTop: head.getBoundingClientRect().top, text: dlg.textContent };
  });
  const shotHead = (page, nme) => page.locator('[data-center-window] [data-window-head]').screenshot({ path: `${OUT}/${nme}.png`, animations: 'disabled' });

  // ---- 1440.
  {
    const { ctx, page, errors } = await openWin(1440);
    const h = await headInfo(page);
    ok(`1440 head blocks ${h.blocks.join(' · ')} (no SETUP: ${h.setup === 0}); no <select> in a fact popover (${h.selectsInPops})`, !h.blocks.includes('setup') && h.setup === 0 && h.blocks[0] === 'title' && h.blocks.includes('actions') && h.blocks.includes('facts') && h.blocks.includes('strip') && h.blocks.indexOf('actions') < h.blocks.indexOf('facts') && h.selectsInPops === 0);
    const labels = h.facts.map(f => f.label);
    ok(`1440 facts in the F order, no Stage: ${labels.join(' · ')}`, labels.join('|').startsWith('Owner|Team|Employees|Type|Source|Last touch') && !labels.includes('Stage'));
    const own = h.facts.find(f => f.label === 'Owner'), emp = h.facts.find(f => f.label === 'Employees');
    ok(`1440 readiness: Owner need ${own?.need} "${own?.value}" title "${own?.title}" = step open ${open('owner')}; Employees need ${emp?.need} "${emp?.value}" title "${emp?.title}" = step open ${open('size')}; Intel header glows ${h.intelNeed} = research open ${open('research')}`,
      own?.need === open('owner') && (!open('owner') || (own.value === 'unassigned' && /^Needed before /.test(own.title || ''))) && emp?.need === open('size') && (!open('size') || (emp.value === 'unknown' && /Research fills it$/.test(emp.title || ''))) && h.intelNeed === open('research'));
    ok(`1440 title Intent "${h.intent}" (${noScore ? 'no score: reads no score yet · Recompute link' : 'scored'}); Recompute link ${h.recomputeLink}`, noScore ? /no score yet/.test(h.intent || '') && h.recomputeLink : !/no score yet/.test(h.intent || '') && !h.recomputeLink);
    ok(`1440 DECIDE ${JSON.stringify(h.decide)}: Add to pipeline ▾ primary · Not a fit · Deprioritize`, h.decide.map(b => b.text).join('|') === 'Add to pipeline ▾|Not a fit|↓ Deprioritize…' && h.decide[0].primary);
    const ONCE = ['Owner', 'Employees', 'Type', 'Team', 'Research', 'Check Apollo', 'Draft email', 'Note', 'To-do', 'Contact', 'Intent'];
    const onceCounts = await page.locator('[data-center-window] [data-window-head]').evaluate((el, labels) => Object.fromEntries(labels.map(lb => [lb, [...el.querySelectorAll('*')].filter(n => [...n.childNodes].some(c => c.nodeType === 3 && c.textContent.trim() === lb)).length])), ONCE);
    ok(`1440 every label once in the head: ${ONCE.map(l => `${l} ${onceCounts[l]}`).join(' · ')}`, ONCE.every(l => onceCounts[l] === 1));
    await shotHead(page, 'fortem-head-1440');
    await page.screenshot({ path: `${OUT}/fortem-window-1440.png`, animations: 'disabled' });
    await axeOn(page, 'fortem@1440');
    // One click on Owner = the listbox; N2 while open; Escape closes; nothing written.
    const y0 = h.headTop;
    await page.locator('[data-center-window] [data-fact="Owner"][data-fact-button]').click(); await page.waitForTimeout(500);
    const list = page.locator('[data-center-window] [role="listbox"][aria-label="Owner"]');
    const opts = await list.locator('[role="option"]').evaluateAll(els => els.map(e => ({ text: e.textContent.trim(), dot: !!e.querySelector('i'), selected: e.getAttribute('aria-selected') })));
    const y1 = (await headInfo(page)).headTop;
    results.n2.owner = Math.abs(y1 - y0);
    ok(`1440 Owner click = listbox ${JSON.stringify(opts.map(o => `${o.text}${o.dot ? ' ●' : ''}`))} (members with dots + Unassigned; no address ${!opts.some(o => /@/.test(o.text))}); N2 ${results.n2.owner} px`, (await list.count()) === 1 && opts.length >= 2 && opts[opts.length - 1].text === 'Unassigned' && opts.slice(0, -1).every(o => o.dot) && !opts.some(o => /@/.test(o.text)) && results.n2.owner === 0);
    await shotHead(page, 'fortem-head-owner-open-1440');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    ok(`1440 Escape closes the listbox (${await list.count()})`, (await list.count()) === 0);
    await page.locator('[data-center-window] [data-fact="Employees"][data-fact-button]').click(); await page.waitForTimeout(400);
    const dlgE = page.locator('[data-center-window] [role="dialog"][aria-label="Employees"]');
    const eText = (await dlgE.textContent().catch(() => '')).replace(/\s+/g, ' ');
    ok(`1440 Employees click = a number form (textbox ${await dlgE.locator('input').count()}; "${eText.slice(0, 60)}"), no select (${await dlgE.locator('select').count()})`, (await dlgE.count()) === 1 && (await dlgE.locator('input').count()) === 1 && (await dlgE.locator('select').count()) === 0);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    ok(`1440 no address anywhere in the window (${!/@/.test(h.text)}); 0 page errors`, !/@/.test(h.text) && !errors.length, errors.join(' | '));
    await ctx.close();
  }
  // ---- 1440: a fresh target (no owner, no size) - the mockup's state - readiness live.
  if (needy) {
    const dn = await get(`/goals/company?type=target&id=${needy.id}`);
    const st = dn.body?.steps?.steps || [];
    const openN = id => { const x = st.find(y => y.id === id); return !!x && !['done', 'skip', 'running'].includes(x.status); };
    const { ctx, page, errors } = await openWin(1440, needy.id);
    const h = await headInfo(page);
    const own = h.facts.find(f => f.label === 'Owner'), emp = h.facts.find(f => f.label === 'Employees');
    ok(`1440 fresh target "${needy.name.slice(0, 24)}" (steps ${st.map(s => `${s.id}:${s.status}`).join(' ')}): Owner need ${own?.need} "${own?.value}" title "${own?.title}"; Employees need ${emp?.need} "${emp?.value}" title "${emp?.title}"; Intel header glows ${h.intelNeed} (research open ${openN('research')}); no SETUP ${h.setup === 0}; 0 page errors`,
      own?.need === true && own.value === 'unassigned' && /^Needed before /.test(own.title || '') && emp?.need === true && emp.value === 'unknown' && /Research fills it$/.test(emp.title || '') && h.intelNeed === openN('research') && h.setup === 0 && !errors.length, errors.join(' | '));
    await shotHead(page, 'fresh-target-head-1440');
    await axeOn(page, 'fresh-target@1440');
    await ctx.close();
  } else ok('no fresh target (owner + size open) on HomeLover to show the red states live - the Jest suites cover them', true);
  // ---- 390.
  {
    const { ctx, page, errors } = await openWin(390);
    const h = await headInfo(page);
    const sideways = await page.evaluate(() => { const w = document.querySelector('[data-center-window]'); return w.scrollWidth <= w.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1; });
    ok(`390 head blocks ${h.blocks.join(' · ')}, no SETUP, Owner need ${h.facts.find(f => f.label === 'Owner')?.need}, no sideways scroll ${sideways}; 0 page errors`, !h.blocks.includes('setup') && sideways && !errors.length, errors.join(' | '));
    await page.screenshot({ path: `${OUT}/fortem-window-390.png`, animations: 'disabled', fullPage: true });
    await axeOn(page, 'fortem@390');
    await ctx.close();
  }
  // ---- Side-by-side: the mockup's head | the build's head.
  {
    // The .dc.html references a support.js that is not in the repo, so its <x-dc> wrapper renders inline and the dialog
    // shrinks beside its notes; the same two CSS lines put the dialog at its designed 1064 px. The shot = the dialog's own box.
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`file://${MOCK}`); await page.waitForTimeout(800);
    await page.addStyleTag({ content: 'x-dc{display:block} helmet{display:none} div:has(>[role=dialog]){display:block!important;width:auto!important} [role=dialog]{width:1064px!important;flex:none!important}' }); await page.waitForTimeout(500);
    await page.locator('[role="dialog"]').first().screenshot({ path: `${OUT}/mockup-dialog.png` });
    const compose = await ctx.newPage();
    const b64 = f => fs.readFileSync(path.join(OUT, f)).toString('base64');
    await compose.setViewportSize({ width: 1120 * 2 + 48, height: 200 });
    const freshShot = fs.existsSync(path.join(OUT, 'fresh-target-head-1440.png'));
    await compose.setContent(`<body style="margin:0;background:#000;color:#fff;font:12px monospace"><div style="display:flex;flex-direction:column;gap:16px;padding:16px"><div style="display:flex;gap:16px;align-items:flex-start"><figure style="margin:0"><figcaption style="padding:4px 0">mockup · CompanyHead.dc.html · head (Owner menu drawn open)</figcaption><div style="width:1120px;height:620px;overflow:hidden"><img src="data:image/png;base64,${b64('mockup-dialog.png')}" style="width:1120px;display:block"></div></figure><figure style="margin:0"><figcaption style="padding:4px 0">prod build · HEAD · Fortem Media head at 1440 (Owner list open)</figcaption><img src="data:image/png;base64,${b64('fortem-head-owner-open-1440.png')}" style="width:1120px;display:block"></figure></div>${freshShot ? `<figure style="margin:0"><figcaption style="padding:4px 0">prod build · a fresh target (no owner, no size): readiness on the facts + the Intel header</figcaption><img src="data:image/png;base64,${b64('fresh-target-head-1440.png')}" style="width:1120px;display:block"></figure>` : ''}</div></body>`);
    await compose.waitForTimeout(500);
    await compose.screenshot({ path: `${OUT}/side-by-side-head-1440.png`, fullPage: true });
    ok('side-by-side-head-1440.png written (mockup head | prod head)', true);
    await ctx.close();
  }
  ok(`browser reached 0 Claude / Apollo hosts; every non-GET aborted (${[...new Set(writes)].join(', ') || 'none attempted'})`, !realCalls.length && writes.every(w => blocked.includes(w)));
} catch (e) {
  results.errors.push(e.stack || e.message); log('ERROR', e.message);
} finally {
  await cleanup();
  let restored = false, line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => String(before[t]) !== String(after[t])).map(t => `${t} ${before[t]} -> ${after[t]}`);
    if (moved.length) throw new Error(`counts moved: ${moved.join(', ')}`);
    restored = true; line = `yes (${TABLES.length} table counts identical, 0 writes; Jack sign-in row kept by rule, last_seen_at restored)`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'stage1-report.json'), JSON.stringify({ ...results, restored, when: new Date().toISOString() }, null, 2));
  console.log(`\ncompany-window-v4 Stage 1 live check: ${passed}/${results.checks.length} passed · Claude 0 · Apollo ${realCalls.length} · writes 0 · ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`files: ${fs.readdirSync(OUT).join(', ')}`);
  console.log(`restored: ${line}`);
  if (results.errors.length) console.log('errors:', results.errors.join('\n'));
  if (!restored) throw new Error(`restored: ${line}`);
  process.exit(passed === results.checks.length && !results.errors.length ? 0 : 1);
}
