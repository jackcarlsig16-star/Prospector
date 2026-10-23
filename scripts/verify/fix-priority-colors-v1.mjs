// FIX priority-colors-v1 - shots + a colour check: Actions rows P1-P4 + an overdue one, the Pipeline Priority column,
// the Dashboard "Visitors by priority" stack with its legend, and /kit Priority - at 1440 + 390. Reads the computed
// colour of every priority dot / stack fill and checks they are the four KIT_PRIORITY hues (plus the danger red for
// Overdue), i.e. five different colours on Actions.
// SCOPE (declared): TEMP data only - 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only) + 1 temp owner; ~16 rows (2 partners, 1 employer, 1 signal, 1 suggestion, 2 to-dos, 1 waiting, 7 web
// visits, 1 flag). Made-up names; no emails or phones. HomeLover never written (counts compared before/after). 0 Apollo
// and 0 Claude: the sync / apollo / visit-pull / tidy / research / anthropic routes are aborted in the browser and
// research_runs + visit_pull_runs are counted before teardown. Runtime ~1.5 min, hard cap 200 s (tempGuard).
// Outputs fixpc-*.png + fixpc-report.txt into .screenshots/fix-priority-colors-v1 (never build/).
// Usage: node scripts/verify/fix-priority-colors-v1.mjs [outdir]   (run npm run build first)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, '.screenshots', 'fix-priority-colors-v1');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3984;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Priority Colors FIX';
const HL = ['sales_week_goals', 'sales_signals', 'sales_suggestions', 'sales_goals', 'sales_opportunities', 'web_visits', 'research_runs', 'visit_pull_runs'];
const TEMP_TABLES = ['sales_week_goal_steps', 'sales_week_goals', 'sales_signals', 'sales_suggestions', 'sales_tidy_runs', 'web_visits', 'visit_pull_runs', 'research_runs', 'sales_partner_events', 'sales_opportunity_events', 'sales_targets', 'sales_opportunities', 'sales_goals', 'auth_events', 'business_members'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const count = async (t, col, v) => (await svc.from(t).select('*', { count: 'exact', head: true }).eq(col, v)).count;
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = await count(t, 'business_id', HOMELOVER); return o; };
let srv, browser, B, users = [];
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (B) { for (const t of TEMP_TABLES) { const r = await svc.from(t).delete().eq('business_id', B); if (r.error) console.log(`cleanup ${t}: ${r.error.message}`); } await svc.from('businesses').delete().eq('id', B); }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 200000 });
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
const results = { checks: [], errors: [], colors: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
// The expected hues, read from the token file itself so the check follows a REVISABLE change.
const tokensSrc = fs.readFileSync(ROOT + '/src/ui/tokens.js', 'utf8');
const KIT_PRIORITY = Object.fromEntries([...tokensSrc.matchAll(/(P[1-4]): \['(#[0-9A-Fa-f]{6})', '(#[0-9A-Fa-f]{6})'\]/g)].map(m => [m[1], [m[2], m[3]]]));
const BAD = /bad: '(#[0-9A-Fa-f]{6})'/.exec(tokensSrc)[1];
const toHex = rgb => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb); return m ? '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('').toUpperCase() : rgb; };

try {
  const tag = 'fixpc-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://fixpc.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const email = `${tag}-jack-test@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(error.message);
  users.push({ id: u.user.id });
  await svc.from('profiles').update({ display_name: 'Jack Test', welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: B, email, name: 'Jack Test', user_id: u.user.id, role: 'owner' }).select());
  const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(sErr.message);
  const owner = { id: u.user.id, session: s.session };
  const today = laToday(), week = monday(today), yesterday = addDays(today, -1);
  const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
  // Actions rows: P1 = a flag; P2 = a scout signal (default); P3 = a Tidy follow-up (default); P4 = a to-do on a priority-4 partner; Overdue = an overdue to-do.
  const [p1, p4] = ins(await svc.from('sales_goals').insert([
    { business_id: B, goal_type: 'partnership', name: 'ZZ Lakeshore Mutual', category: '3. Brokers', pipeline_status: 'replied', priority: 1, owner_user_id: owner.id, channel: 'manual', tier: '1', last_touch_at: ago(300) },
    { business_id: B, goal_type: 'partnership', name: 'ZZ Quiet Gyms', category: '2. Gyms', pipeline_status: 'first_email_sent', priority: 4, owner_user_id: owner.id, channel: 'manual', last_touch_at: ago(20) },
  ]).select('id, name'));
  const [, p3] = ins(await svc.from('sales_goals').insert([{ business_id: B, goal_type: 'partnership', name: 'ZZ Northwind Benefits', category: '3. Brokers', pipeline_status: 'not_started', priority: 2, channel: 'import' }, { business_id: B, goal_type: 'partnership', name: 'ZZ Current Co', category: '1. Current partners', pipeline_status: 'live', priority: 3, channel: 'partner_referral' }]).select('id'));
  ins(await svc.from('sales_opportunities').insert({ business_id: B, organization: 'ZZ Old Mill Union', org_type: 'employer', stage: 'contacted', source: 'manual', channel: 'call_note', owner: 'Jack Test', covered_lives: 1200, priority: 2 }).select('id'));
  ins(await svc.from('sales_signals').insert({ business_id: B, source: 'scout', signal_week: week, company_name: 'ZZ Scout Co', company_key: 'zz scout co', kind: 'partner', kind_guessed: false, signal: 'Opened an office', why_now: 'Hiring', score: 55, status: 'new', created_by: owner.id }).select('id'));
  // The Tidy row takes its partner's own priority (3 here), the signal the Scout default (2), the flag P1, the to-do on the priority-4 partner P4.
  ins(await svc.from('sales_suggestions').insert({ business_id: B, kind: 'follow_up', ref_type: 'partner', ref_id: p3.id, text: 'Follow up ZZ Current Co', reason: 'Live · last touch 12 d ago · no open to-do', status: 'proposed' }).select('id'));
  ins(await svc.from('sales_week_goals').insert([
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: 'ZZ Send the deck', owner_user_id: owner.id, due_date: addDays(today, -3), created_by: owner.id, contacts: [], sort_order: 0 },
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: 'ZZ Draft the one-pager', owner_user_id: owner.id, due_date: addDays(today, 2), link_type: 'partner', link_id: p4.id, created_by: owner.id, contacts: [], sort_order: 0 },
    { business_id: B, week_start: week, kind: 'todo', text: 'Follow up with Gale', status: 'open', owner_user_id: owner.id, prospect_contact_id: 'zz-g', flagged_by: owner.id, created_by: owner.id, contacts: [], sort_order: 0 },
  ]).select('id'));
  const visit = (pulled_on, company_key, priority) => ({ business_id: B, pulled_on, company_key, company_name: company_key.toUpperCase(), priority, priority_rule: 'test', visits_7d: 3, last_visit: pulled_on, us_500: true, top_paths: ['/pricing'] });
  ins(await svc.from('web_visits').insert([visit(yesterday, 'zz acme', 'P1'), visit(yesterday, 'zz bolt', 'P3'), visit(today, 'zz acme', 'P1'), visit(today, 'zz cove', 'P2'), visit(today, 'zz dune', 'P2'), visit(today, 'zz echo', 'P4'), visit(yesterday, 'zz echo', 'P4')]).select('id'));
  log('fixture in');

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const blocked = [];
  async function newPage({ width = 1440, height = 900 } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    page.on('dialog', d => d.accept());
    await page.addInitScript(([k, v, b, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      // actions-v2 REV2: Actions opens on the signed-in person with Housekeeping folded; these checks read the whole team, unfolded.
      localStorage.setItem('prospector_goals_owner', 'team'); localStorage.setItem('prospector_actions_folded', '[]');
      localStorage.setItem(`prospector_visits_ran_${b}`, dd); localStorage.setItem(`prospector_tidy_ran_${b}`, dd);
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), B, today]);
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull|\/goals\/tidy\/run|\/research\/run|\/research$|\/proxy\/anthropic/, route => { blocked.push(route.request().url()); route.abort(); });
    await page.goto(`http://localhost:${PORT}/?tab=actions`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1200);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    return { page, errs, compact };
  }
  const tab = async (page, label) => { await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: new RegExp(`^${label}`) }).first().dispatchEvent('click'); await page.waitForTimeout(1200); };
  const sub = async (page, label) => { await page.locator('[data-sales-subviews]').getByRole('button', { name: label, exact: true }).dispatchEvent('click'); await page.waitForTimeout(1200); };
  const shot = (page, n, full) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: full });
  // The Actions Priority column: chip label -> its dot colour.
  // The Actions Priority chip is the first tag in each row (a table cell at 1440, the card list at 390).
  const actionsColors = page => page.evaluate(() => [...document.querySelectorAll('[data-actions] [data-row]')].map(r => r.querySelector('.ui-tag')).filter(Boolean).map(t => [t.textContent.trim().replace(/\s+/g, ' '), getComputedStyle(t.querySelector('.ui-tag__dot')).backgroundColor]));

  for (const width of [1440, 390]) {
    const { page, errs } = await newPage({ width, height: width === 390 ? 844 : 900 });
    await tab(page, 'Actions'); await page.locator('[data-actions] [data-row]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
    await shot(page, `fixpc-actions-${width}`, false);
    const cols = await actionsColors(page);
    const byLevel = {};
    for (const [label, color] of cols) { const lv = /^Overdue/.test(label) ? 'Overdue' : label.slice(0, 2); byLevel[lv] ||= new Set(); byLevel[lv].add(toHex(color)); }
    const levels = Object.fromEntries(Object.entries(byLevel).map(([k, v]) => [k, [...v]]));
    results.colors[`actions@${width}`] = levels;
    const expect = { P1: KIT_PRIORITY.P1[0].toUpperCase(), P2: KIT_PRIORITY.P2[0].toUpperCase(), P3: KIT_PRIORITY.P3[0].toUpperCase(), P4: KIT_PRIORITY.P4[0].toUpperCase(), Overdue: BAD.toUpperCase() };
    const seen = ['P1', 'P2', 'P3', 'P4', 'Overdue'].filter(k => levels[k]);
    ok(`Actions ${width}: ${seen.join(' · ')} on the list, each one its own token colour, five different colours`, seen.length === 5 && seen.every(k => levels[k].length === 1 && levels[k][0] === expect[k]) && new Set(seen.map(k => levels[k][0])).size === 5, JSON.stringify(levels));
    if (width === 1440) {
      await tab(page, 'Pipeline'); await sub(page, 'Companies'); await page.locator('[data-pipeline-companies] [data-row]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
      await shot(page, 'fixpc-pipeline-1440', false);
      const dots = await page.evaluate(() => [...document.querySelectorAll('[data-pipeline-companies] [data-priority-dot]')].map(d => [d.getAttribute('data-priority-dot'), getComputedStyle(d).backgroundColor]));
      const dotLevels = Object.fromEntries(dots.map(([k, c]) => [k, toHex(c)]));
      results.colors.pipeline = dotLevels;
      ok('Pipeline Priority column: a dot beside each P1-P4 dropdown in the same four colours', ['P1', 'P2', 'P3', 'P4'].every(k => dotLevels[k] === expect[k]), JSON.stringify(dotLevels));
      await tab(page, 'Dashboard'); await sub(page, 'Overview'); await page.locator('[data-chart="chart-visitors-priority"] svg').waitFor({ timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1200);
      await page.locator('[data-chart="chart-visitors-priority"]').scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
      await shot(page, 'fixpc-dashboard-1440', true);
      const stack = await page.evaluate(() => {
        const card = document.querySelector('[data-chart="chart-visitors-priority"]'); if (!card) return null;
        const fills = {};
        for (const r of card.querySelectorAll('rect, path')) { const f = getComputedStyle(r).fill; const t = r.querySelector('title')?.textContent || r.getAttribute('aria-label') || ''; const m = /\b(P[1-4])\b/.exec(t); if (m && f && f !== 'none' && !/rgba\(0, 0, 0, 0\)/.test(f) && !fills[m[1]]) fills[m[1]] = f; }
        const legend = [...card.querySelectorAll('li')].filter(li => /^P[1-4]$/.test(li.textContent.trim()) && li.querySelector('.ui-legend__swatch')).map(li => [li.textContent.trim(), getComputedStyle(li.querySelector('.ui-legend__swatch')).backgroundColor]);
        return { fills, legend };
      });
      const stackLevels = stack ? Object.fromEntries(Object.entries(stack.fills).map(([k, v]) => [k, toHex(v)])) : {};
      const legendLevels = stack ? Object.fromEntries(stack.legend.map(([k, v]) => [k, toHex(v)])) : {};
      results.colors.dashboard = { stack: stackLevels, legend: legendLevels };
      ok('Dashboard "Visitors by priority" stack + legend use the same four colours', ['P1', 'P2', 'P3', 'P4'].every(k => stackLevels[k] === expect[k] && legendLevels[k] === expect[k]), JSON.stringify({ stackLevels, legendLevels }));
      await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(400);
      const print = await page.evaluate(() => { const cs = getComputedStyle(document.getElementById('sales-analytics-root')); return { ground: cs.getPropertyValue('--sa-ground').trim(), p1: cs.getPropertyValue('--sa-prio-p1').trim(), p4: cs.getPropertyValue('--sa-prio-p4').trim() }; });
      await page.emulateMedia({ media: 'screen' });
      ok('Print: the light pair takes over (ground #FFFFFF, --sa-prio-p1 / p4 = the print values)', print.ground.toUpperCase() === '#FFFFFF' && print.p1.toUpperCase() === KIT_PRIORITY.P1[1].toUpperCase() && print.p4.toUpperCase() === KIT_PRIORITY.P4[1].toUpperCase(), JSON.stringify(print));
      await page.getByRole('button', { name: /^My profile/ }).first().click(); await page.waitForTimeout(300);
      await page.getByRole('button', { name: 'UI kit' }).first().click();
      await page.locator('[data-ui-gallery]').waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
      const kitRole = page.locator('[data-role="R5"]');
      await kitRole.scrollIntoViewIfNeeded().catch(() => {});
      await shot(page, 'fixpc-kit-1440', true);
      const kit = await page.evaluate(() => [...document.querySelectorAll('[data-after] .ui-tag')].filter(t => /^P[1-4]$/.test(t.textContent.trim())).map(t => [t.textContent.trim(), getComputedStyle(t.querySelector('.ui-tag__dot')).backgroundColor]));
      const kitLevels = Object.fromEntries(kit.map(([k, v]) => [k, toHex(v)]));
      results.colors.kit = kitLevels;
      ok('/kit Priority tags show the same four colours', ['P1', 'P2', 'P3', 'P4'].every(k => kitLevels[k] === expect[k]), JSON.stringify(kitLevels));
    }
    if (errs.length) results.errors.push(...errs.map(e => `${width}: ${e}`));
    await page.context().close();
  }
  const calls = { research_runs: await count('research_runs', 'business_id', B), visit_pull_runs: await count('visit_pull_runs', 'business_id', B), blockedRequests: blocked.length };
  ok('0 Claude / 0 Apollo: research_runs 0, visit_pull_runs 0', calls.research_runs === 0 && calls.visit_pull_runs === 0, JSON.stringify(calls));
} catch (e) {
  results.errors.push('THROW ' + (e.stack?.split('\n').slice(0, 3).join(' | ') || e.message));
  log('THROW', e.message);
} finally {
  await cleanup();
  const left = B ? await count('businesses', 'id', B) : 0;
  const hlAfter = await hlCounts();
  const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
  const lines = [`FIX priority-colors-v1 - shots + colour check (${new Date().toISOString().slice(0, 10)}, temp workspace, 0 Apollo, 0 Claude)`, '', `tokens: ${JSON.stringify(KIT_PRIORITY)} · bad ${BAD}`, ''];
  for (const c of results.checks) lines.push(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` - ${c.detail}` : ''}`);
  if (results.errors.length) lines.push('', 'errors:', ...results.errors.map(e => '  ' + e));
  fs.writeFileSync(`${OUT}/fixpc-report.txt`, lines.join('\n'));
  console.log(lines.join('\n'));
  const pass = results.checks.filter(c => c.pass).length;
  console.log(`\nchecks ${pass}/${results.checks.length} · workspace left ${left} · HomeLover diff ${diff.length ? diff.join(', ') : 'none'} · errors ${results.errors.length} · restored: ${left === 0 && !diff.length ? 'yes' : 'NO'}`);
  process.exit(0);
}
