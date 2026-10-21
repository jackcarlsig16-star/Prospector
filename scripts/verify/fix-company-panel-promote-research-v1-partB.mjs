// FIX company-panel-promote-research-v1 Part B bar 4 - the company panel opens as a centered window (full-screen
// sheet at 390), Esc / X / backdrop close it, focus returns to the row, the row stays tinted, N2: nothing above the
// table moves (0 px) at 1440 and 390; OpportunityPanel (Open full card on an employer) + Website visitors keep SidePanel.
// SCOPE (declared): TEMP data only - 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only) + 1 temp owner + 12 partners, 1 employer, 1 visitor, 1 fake research_runs row (0 Claude). HomeLover is
// never written (counts compared). 0 Apollo (sync / apollo / visit-pull routes aborted in the browser). Runtime ~60 s,
// hard cap 200 s (tempGuard), teardown deletes everything. Shots -> <outdir> (default build/verify-shots), made-up names only.
// Usage: node scripts/verify/fix-company-panel-promote-research-v1-partB.mjs [outdir]   (run npm run build first)
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
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, 'build', 'verify-shots');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3976;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Window FixB';
const HL = ['research_runs', 'sales_targets', 'sales_goals', 'web_visits', 'sales_opportunities', 'sales_week_goals'];
const TEMP_TABLES = ['research_runs', 'web_visits', 'visit_priority_override', 'sales_partner_events', 'sales_opportunity_events', 'sales_week_goals', 'sales_targets', 'sales_opportunities', 'sales_goals', 'auth_events', 'business_members'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER)).count; return o; };
let srv, browser, B, users = [], pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (B) {
    for (const t of TEMP_TABLES) { const r = await svc.from(t).delete().eq('business_id', B); if (r.error) console.log(`cleanup ${t}: ${r.error.message}`); }
    await svc.from('businesses').delete().eq('id', B);
  }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 200000 });
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
console.log('HomeLover before', JSON.stringify(hlBefore));
const results = { n2: {}, window: {} };
try {
  const tag = 'fixb-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://fixb.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const email = `${tag}-owner@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(error.message);
  await svc.from('profiles').update({ display_name: 'Owner Test', welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: B, email, name: 'Owner Test', user_id: u.user.id, role: 'owner' }).select());
  const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(sErr.message);
  const owner = { id: u.user.id, session: s.session }; users.push(owner);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const STAGES = ['not_started', 'researching', 'first_email_sent', 'in_sequence', 'replied', 'meeting_set'];
  const partners = ins(await svc.from('sales_goals').insert(Array.from({ length: 12 }, (_, i) => ({
    business_id: B, goal_type: 'partnership', name: i ? `ZZ Window P${String(i + 1).padStart(2, '0')}` : 'ZZ Window Partner', pipeline_status: STAGES[i % STAGES.length],
    owner_user_id: i % 2 ? owner.id : null, tier: String((i % 3) + 1), channel: 'import', last_touch_at: new Date(Date.now() - (i + 1) * 864e5).toISOString(),
  }))).select('id, name'));
  const partner = partners[0];
  ins(await svc.from('research_runs').insert({ business_id: B, entity_type: 'partner', entity_id: partner.id, trigger: 'manual', status: 'done', model: 'fake', cost_usd: 0.001, created_by: owner.id, result: { summary: 'Fake research for the window check', size: '2,000 employees', hq_city: 'Chicago', first_angle: 'Housing perk for relocating staff', website: 'https://fixb.example.com', domain: 'fixb.example.com', website_confidence: 'low', source_urls: [] } }).select('id'));
  ins(await svc.from('sales_opportunities').insert({ business_id: B, organization: 'ZZ Window Employer', org_type: 'employer', stage: 'contacted', source: 'manual', channel: 'manual', covered_lives: 1200, notes: '(10/20) Named on a call' }).select('id'));
  ins(await svc.from('web_visits').insert({ business_id: B, pulled_on: today, company_key: 'zz window visitor', company_name: 'ZZ Window Visitor', priority: 'P1', priority_rule: 'US 500+ with 5+ visits', visits_7d: 6, last_visit: today, us_500: true, top_paths: ['/pricing', '/employers'] }).select('id'));

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }

  browser = await chromium.launch();
  async function newPage({ width = 1440, height = 900 } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    page.on('dialog', d => d.accept());
    await page.addInitScript(([k, v, b, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      localStorage.setItem(`prospector_visits_ran_${b}`, d); localStorage.setItem(`prospector_tidy_ran_${b}`, d);
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), B, today]);
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull/, route => route.abort());
    await page.goto(`http://localhost:${PORT}/?tab=pipeline&view=companies`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('[data-row]').first().waitFor();
    return { page, errs };
  }
  const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
  const boxes = page => page.evaluate(() => Object.fromEntries(['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-channel-row', 'data-filter-row'].map(a => {
    const el = document.querySelector(`[${a}]`); if (!el) return [a, null];
    const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, h: Math.round(r.height * 10) / 10 }];
  }).concat([['table', (() => { const b = document.querySelector('.ui-table-box, ul.ui-list'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, h: Math.round(r.height * 10) / 10 }; })()], ['scroll', { x: window.scrollX, y: window.scrollY, h: 0 }]])));
  const maxMove = (a, b) => Math.max(0, ...Object.keys(a).filter(k => a[k] && b[k]).flatMap(k => [Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), Math.abs(a[k].h - b[k].h)]));
  const win = page => page.evaluate(() => {
    const a = document.querySelector('aside[data-center-window]'); if (!a) return null;
    const r = a.getBoundingClientRect(); const head = a.querySelector('[data-window-head]').getBoundingClientRect(); const body = a.querySelector('[data-window-body]');
    return { kind: a.dataset.centerWindow, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), headTop: Math.round(head.top), headH: Math.round(head.height), bodyScrollH: body.scrollHeight, bodyClientH: body.clientHeight, bodyTop: Math.round(body.getBoundingClientRect().top), vw: window.innerWidth, vh: window.innerHeight, focusInside: a.contains(document.activeElement), docW: document.documentElement.scrollWidth };
  });
  const rowState = (page, name) => page.evaluate(n => {
    const btn = [...document.querySelectorAll('[data-row] [data-row-name]')].find(b => b.textContent === n); const row = btn?.closest('[data-row]');
    return { focused: document.activeElement === btn, tint: row?.style.getPropertyValue('--ui-row-tint') || '' };
  }, name);
  const tinted = s => s.tint.includes('color-mix');

  // ── 1440 ──
  { const { page, errs } = await newPage();
    const b0 = await boxes(page);
    await page.getByRole('button', { name: 'ZZ Window Partner', exact: true }).click();
    const w = page.locator('aside[data-center-window]'); await w.waitFor(); await w.locator('[data-research-card]').waitFor(); await page.waitForTimeout(400);
    const m1 = await win(page); results.window.partner1440 = m1;
    const centered = Math.abs(m1.x - (m1.vw - m1.w) / 2) <= 1 && Math.abs(m1.y - (m1.vh - m1.h) / 2) <= 1;
    ok(`1440 partner: a centered window ${m1.w}×${m1.h} at x ${m1.x} (min(1040, 92vw) = 1040 wide, ≤ 88vh = 792 tall), no sideways page scroll`, m1.kind === 'window' && m1.w === 1040 && m1.h <= 792 && centered && m1.docW <= m1.vw, JSON.stringify(m1));
    ok('1440 partner: the window took focus; the row stays tinted while it is open', m1.focusInside && tinted(await rowState(page, 'ZZ Window Partner')), JSON.stringify(await rowState(page, 'ZZ Window Partner')));
    const card = await w.locator('[data-research-card]').textContent();
    ok('1440 partner: the research card shows the run (Part A\'s moved runs render here)', card.includes('Fake research for the window check') && card.includes('Chicago'), card.slice(0, 120));
    const headBefore = m1.headTop;
    await w.locator('[data-window-body]').evaluate(el => { el.scrollTop = 99999; }); await page.waitForTimeout(200);
    const m1s = await win(page);
    ok(`1440 partner: the head (title + action bar) stays pinned when the body scrolls (head top ${headBefore} -> ${m1s.headTop}; body ${m1.bodyScrollH} px in ${m1.bodyClientH})`, m1s.headTop === headBefore && (await w.getByRole('region', { name: 'Actions' }).count()) === 1);
    await w.locator('[data-window-body]').evaluate(el => { el.scrollTop = 0; });
    const b1 = await boxes(page);
    await shot(page, 'fixb-window-partner-1440');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const b2 = await boxes(page);
    const rs = await rowState(page, 'ZZ Window Partner');
    ok('1440 partner: Esc closes it, focus is back on the row\'s name button and the row is still tinted', (await page.locator('aside[data-center-window]').count()) === 0 && rs.focused && tinted(rs), JSON.stringify(rs));
    const mv = Math.max(maxMove(b0, b1), maxMove(b0, b2));
    results.n2['1440'] = { before: b0, open: b1, closed: b2, maxMove: mv };
    ok(`N2 1440: opening and closing the window moves nothing on the page (max ${mv} px)`, mv === 0, JSON.stringify({ b0, b1, b2 }));

    await page.getByRole('button', { name: 'ZZ Window Employer', exact: true }).click();
    const e = page.locator('aside[data-center-window]'); await e.waitFor(); await e.locator('[data-section="todos"]').waitFor(); await page.waitForTimeout(300);
    ok('1440 employer: the same window, employer header + action bar', (await e.locator('[data-company-panel="employer"]').count()) === 1 && (await e.getByRole('region', { name: 'Actions' }).count()) === 1);
    await shot(page, 'fixb-window-employer-1440');
    await e.getByRole('button', { name: 'Close panel' }).click(); await page.waitForTimeout(300);
    ok('1440 employer: the X closes it and focus returns to its row', (await page.locator('aside[data-center-window]').count()) === 0 && (await rowState(page, 'ZZ Window Employer')).focused);
    // B2: Open full card on the employer -> OpportunityPanel still a right-hand drawer.
    await page.getByRole('button', { name: 'ZZ Window Employer', exact: true }).click(); await page.locator('aside[data-center-window]').waitFor();
    await page.getByRole('button', { name: 'Open full card →' }).click();
    const drawer = page.getByRole('complementary', { name: 'Edit opportunity' }); await drawer.waitFor(); await page.waitForTimeout(300);
    const dr = await drawer.evaluate(el => { const r = el.getBoundingClientRect(); return { right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), center: !!el.dataset.centerWindow }; });
    ok(`B2 1440: Open full card on the employer opens OpportunityPanel as the right drawer (right edge ${dr.right}, ${dr.w}×${dr.h}, not the window)`, dr.right === 1440 && dr.w === 420 && dr.h === 900 && !dr.center, JSON.stringify(dr));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);

    await page.getByRole('group', { name: 'Channel' }).getByRole('button', { name: /^Website visitors/ }).click(); await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'ZZ Window Visitor', exact: true }).click();
    const v = page.locator('aside[data-center-window]'); await v.waitFor(); await v.locator('[data-section="visits"]').waitFor(); await page.waitForTimeout(300);
    ok('1440 visitor: the window with the visitor body (visits section, no research block)', (await v.locator('[data-company-panel="visitor"]').count()) === 1 && (await v.locator('[data-research-card]').count()) === 0);
    await shot(page, 'fixb-window-visitor-1440');
    await page.locator('[data-testid="side-panel-backdrop"]').click({ position: { x: 8, y: 8 } }); await page.waitForTimeout(300);
    ok('1440 visitor: a backdrop click closes it and focus returns to its row', (await page.locator('aside[data-center-window]').count()) === 0 && (await rowState(page, 'ZZ Window Visitor')).focused);
    // B2: Website visitors report keeps its 1040 drawer.
    await page.getByRole('button', { name: 'ZZ Window Visitor', exact: true }).click(); await page.locator('aside[data-center-window]').waitFor();
    await page.getByRole('button', { name: 'Open visitor report →' }).click();
    const rep = page.getByRole('complementary', { name: 'Website visitors' }); await rep.waitFor(); await page.waitForTimeout(300);
    const rr = await rep.evaluate(el => { const r = el.getBoundingClientRect(); return { right: Math.round(r.right), w: Math.round(r.width) }; });
    ok(`B2 1440: the Website visitors report is still the 1040 right drawer (right edge ${rr.right})`, rr.right === 1440 && rr.w === 1040, JSON.stringify(rr));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    ok('1440: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }

  // ── 390 ──
  { const { page, errs } = await newPage({ width: 390, height: 844 });
    // The row sits below the fold at 390: scroll it into view first, or the click's own scroll would count as movement.
    await page.getByRole('button', { name: 'ZZ Window Partner', exact: true }).scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
    const b0 = await boxes(page);
    await page.getByRole('button', { name: 'ZZ Window Partner', exact: true }).click();
    const w = page.locator('aside[data-center-window]'); await w.waitFor(); await w.locator('[data-research-card]').waitFor(); await page.waitForTimeout(400);
    const m = await win(page); results.window.partner390 = m;
    const closeBox = await w.getByRole('button', { name: 'Close panel' }).boundingBox();
    ok(`390 partner: a full-screen sheet ${m.w}×${m.h} at 0,0 with the Close at the top (y ${Math.round(closeBox?.y)}), no sideways scroll`, m.kind === 'sheet' && m.x === 0 && m.y === 0 && m.w === 390 && m.h === 844 && closeBox && closeBox.y < 80 && m.docW <= m.vw, JSON.stringify(m));
    const b1 = await boxes(page);
    await shot(page, 'fixb-sheet-partner-390');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const b2 = await boxes(page);
    const rs = await rowState(page, 'ZZ Window Partner');
    ok('390 partner: Esc closes the sheet, focus back on the row, row tinted', (await page.locator('aside[data-center-window]').count()) === 0 && rs.focused && tinted(rs), JSON.stringify(rs));
    const mv = Math.max(maxMove(b0, b1), maxMove(b0, b2));
    results.n2['390'] = { before: b0, open: b1, closed: b2, maxMove: mv };
    ok(`N2 390: opening and closing the sheet moves nothing on the page (max ${mv} px)`, mv === 0, JSON.stringify({ b0, b1, b2 }));
    await page.getByRole('button', { name: 'ZZ Window Employer', exact: true }).click(); await page.locator('aside[data-center-window]').waitFor(); await page.waitForTimeout(400);
    await shot(page, 'fixb-sheet-employer-390');
    await page.getByRole('button', { name: 'Close panel' }).click(); await page.waitForTimeout(300);
    ok('390: X closes the sheet; 0 page errors', (await page.locator('aside[data-center-window]').count()) === 0 && !errs.length, errs.join(' | '));
    await page.context().close();
  }
  const bundle = fs.readdirSync(ROOT + '/build/static/js').filter(f => f.endsWith('.js')).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('');
  ok('bundle: the window shell is in the build, SidePanel still is (drawer callers)', bundle.includes('data-center-window') && bundle.includes('side-panel-backdrop'));
} catch (e) {
  ok('script ran without throwing', false, e.stack?.split('\n').slice(0, 3).join(' | ') || e.message);
} finally {
  await cleanup();
  const left = B ? (await svc.from('businesses').select('id', { count: 'exact', head: true }).eq('id', B)).count : 0;
  const hlAfter = await hlCounts();
  const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
  ok(`HomeLover counts identical (${HL.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
  fs.writeFileSync(`${OUT}/fixb-numbers.json`, JSON.stringify(results, null, 2));
  console.log(`\n${pass}/${total} passed · restored: ${left === 0 && !diff.length ? 'yes' : 'NO'}`);
  process.exit(0);
}
