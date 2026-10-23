// FIX actions-row-detail-v1 - Actions row detail, live: open a long-text row at 1440 and 390 -> the full sentence,
// where it came from and the company line show under it; the rows above don't move (0 px); one panel at a time; Esc
// closes; Open company opens the window; ui-clarity contrast on the open panel: 0 failures; no "@" in any panel.
// SCOPE (declared): TEMP data only - 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only) + 1 temp owner; ~9 rows (1 partner, 1 employer + its 1 stage event, 1 call note, 1 to-do from it,
// 1 signal, 1 suggestion, 1 waiting, 1 flag). Made-up names; no emails or phones. HomeLover never written (counts
// compared before/after). 0 Apollo and 0 Claude: the sync / apollo / visit-pull / tidy / research / anthropic routes
// are aborted in the browser and research_runs + visit_pull_runs are counted before teardown. Runtime ~1 min, hard
// cap 180 s (tempGuard). Outputs fixard-*.png + fixard-report.txt into .screenshots/fix-actions-row-detail-v1.
// Usage: node scripts/verify/fix-actions-row-detail-v1.mjs [outdir]   (run npm run build first)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const { measureScript, summarize, formatWorst } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, '.screenshots', 'fix-actions-row-detail-v1');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3985;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Row Detail FIX';
const HL = ['sales_week_goals', 'sales_signals', 'sales_suggestions', 'sales_goals', 'sales_opportunities', 'sales_call_notes', 'research_runs', 'visit_pull_runs'];
const TEMP_TABLES = ['sales_week_goal_steps', 'sales_week_goals', 'sales_call_notes', 'sales_signals', 'sales_suggestions', 'sales_tidy_runs', 'web_visits', 'visit_pull_runs', 'research_runs', 'sales_partner_events', 'sales_opportunity_events', 'sales_targets', 'sales_opportunities', 'sales_goals', 'auth_events', 'business_members'];
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
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 180000 });
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
const results = { checks: [], errors: [], contrast: {} };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
const LONG_TODO = 'ZZ Send the revised pricing sheet with the relocation-benefit tiers and the three customer references Morgan asked for on the call';
const PANEL = measureScript({ scope: '[data-actions] [data-detail]' });
const SCREEN = measureScript({ scope: '[data-actions]' });

try {
  const tag = 'fixard-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://fixard.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
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
  const today = laToday(), week = monday(today);
  const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
  const [p1] = ins(await svc.from('sales_goals').insert([
    { business_id: B, goal_type: 'partnership', name: 'ZZ Lakeshore Mutual Holdings', category: '3. Brokers', pipeline_status: 'replied', priority: 1, owner_user_id: owner.id, channel: 'manual', tier: '1', last_touch_at: ago(300) },
  ]).select('id, name'));
  const [o1] = ins(await svc.from('sales_opportunities').insert({ business_id: B, organization: 'ZZ Old Mill Union', org_type: 'employer', stage: 'target', source: 'manual', channel: 'call_note', owner: 'Jack Test', priority: 2 }).select('id'));
  ins(await svc.from('sales_opportunities').update({ stage: 'contacted' }).eq('id', o1.id).select('id')); // the trigger writes the stage event = the employer's last touch
  const [note] = ins(await svc.from('sales_call_notes').insert({ business_id: B, title: 'ZZ intro call', call_date: addDays(today, -2), text: 'ZZ fake notes for the row detail check', hash: tag, created_by: owner.id }).select('id'));
  ins(await svc.from('sales_signals').insert({ business_id: B, source: 'scout', signal_week: week, company_name: 'ZZ Scout Co', company_key: 'zz scout co', kind: 'partner', kind_guessed: false, who: 'Head of People · Morgan E.', signal: 'Opened a second office and is hiring 40 people in operations this quarter', why_now: 'Hiring fast in two cities, relocation budget mentioned in the job posts, and a new benefits lead started last month', score: 84, status: 'new', created_by: owner.id }).select('id'));
  ins(await svc.from('sales_suggestions').insert({ business_id: B, kind: 'visited_no_touch', ref_type: 'partner', ref_id: p1.id, text: 'Reach out to ZZ Lakeshore Mutual Holdings', reason: `Visited the site ${addDays(today, -1)} (4 visits in 7 days) · last touch 12 days ago`, status: 'proposed' }).select('id'));
  ins(await svc.from('sales_week_goals').insert([
    { business_id: B, week_start: week, kind: 'todo', status: 'open', text: LONG_TODO, owner_user_id: owner.id, due_date: addDays(today, 2), link_type: 'opportunity', link_id: o1.id, source_note_id: note.id, created_by: owner.id, contacts: [], sort_order: 0 },
    { business_id: B, week_start: addDays(week, -7), kind: 'waiting', status: 'open', text: 'the signed pilot agreement and the eligibility file', waiting_on: 'Pat', due_date: addDays(today, -5), link_type: 'partner', link_id: p1.id, created_by: owner.id, contacts: [], sort_order: 0 },
    { business_id: B, week_start: week, kind: 'todo', text: 'Follow up with Gale', status: 'open', owner_user_id: owner.id, prospect_contact_id: 'zz-g', flagged_by: owner.id, flag_note: 'opened the deck 3 times', created_by: owner.id, contacts: [], sort_order: 0 },
  ]).select('id'));
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
  const shot = (page, n, full) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: full });
  const rowBoxes = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-actions] [data-row]')].map(r => { const b = r.getBoundingClientRect(); return [r.dataset.key, { x: b.x, y: b.y, h: b.height }]; })));
  const panelText = page => page.locator('[data-actions] [data-detail]').evaluateAll(els => els.map(e => e.innerText));

  for (const width of [1440, 390]) {
    const { page, errs } = await newPage({ width, height: width === 390 ? 844 : 900 });
    await tab(page, 'Actions');
    await page.locator('[data-actions] [data-row]').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Team', exact: true }).click().catch(() => {}); await page.waitForTimeout(500);
    const keys = await page.locator('[data-actions] [data-row]').evaluateAll(rs => rs.map(r => r.dataset.key));
    const todoKey = keys.find(k => k.startsWith('todo-'));
    const todoRow = page.locator(`[data-actions] [data-row][data-key="${todoKey}"]`);
    const above = keys.slice(0, keys.indexOf(todoKey));
    const before = await rowBoxes(page);
    const clipped = width === 1440 ? await todoRow.locator('td.ui-table__detail-cell').evaluate(td => { const s = td.querySelector('.ui-table__detail-wrap > :last-child'); return s.scrollWidth > s.clientWidth; }) : true;
    // Open by the text: the cell at 1440, the item at 390.
    await (width === 1440 ? todoRow.locator('td.ui-table__detail-cell').getByText(LONG_TODO) : todoRow.getByText(LONG_TODO)).click(); await page.waitForTimeout(500);
    const after = await rowBoxes(page);
    const moved = Math.max(0, ...above.map(k => Math.max(Math.abs(after[k].x - before[k].x), Math.abs(after[k].y - before[k].y), Math.abs(after[k].h - before[k].h))));
    const [text] = await panelText(page);
    await shot(page, `fixard-todo-open-${width}`, false);
    ok(`${width}: the text was cut off in the row, the panel shows the whole sentence`, clipped && text?.includes(LONG_TODO), clipped ? '' : 'row text not clipped at this width');
    ok(`${width}: where it came from + the company line + dates`, /From call notes [A-Z][a-z]{2} \d{1,2}/.test(text) && /ZZ Old Mill Union · Contacted · P2 · Jack · last touch [A-Z][a-z]{2} \d{1,2}/.test(text) && /due [A-Z][a-z]{2} \d{1,2} · owner Jack/.test(text), text?.replace(/\n/g, ' | '));
    ok(`${width}: the rows above don't move (0 px)`, moved === 0, `${above.length} rows above, max move ${moved}px`);
    const m = await page.evaluate(PANEL);
    if (m.error) results.errors.push(`${width}: ${m.error}`);
    else { const c = summarize(m); results.contrast[width] = c; ok(`${width}: ui-clarity measure on the open panel: 0 failures`, c.textFails === 0 && c.controlFails === 0, `text ${c.textFails}/${c.texts} · controls ${c.controlFails}/${c.controls}`); if (c.textFails || c.controlFails) results.errors.push(formatWorst(`panel@${width}`, c)); }
    const sm = await page.evaluate(SCREEN);
    if (sm.error) results.errors.push(`${width}: ${sm.error}`);
    else { const c = summarize(sm); ok(`${width}: ui-clarity measure on the whole Actions screen (disclosures included): 0 failures`, c.textFails === 0 && c.controlFails === 0, `text ${c.textFails}/${c.texts} · controls ${c.controlFails}/${c.controls}`); if (c.textFails || c.controlFails) results.errors.push(formatWorst(`actions@${width}`, c)); }
    const disclose = page.getByRole('button', { name: `Hide details for ${LONG_TODO}` });
    const focused = await disclose.evaluate(el => el === document.activeElement).catch(() => false);
    // One at a time: the signal's disclosure swaps the panel.
    const sigKey = keys.find(k => k.startsWith('signal-'));
    await page.locator(`[data-actions] [data-row][data-key="${sigKey}"] .ui-table__disclose`).click(); await page.waitForTimeout(400);
    const swap = await panelText(page);
    await shot(page, `fixard-signal-open-${width}`, false);
    ok(`${width}: one panel at a time; the signal says Signal Scout · score 84 · who`, focused && swap.length === 1 && /Signal Scout · score 84 · Head of People · Morgan E\./.test(swap[0]) && /ZZ Scout Co/.test(swap[0]), `focus on disclosure after a text click: ${focused}`);
    const tidyKey = keys.find(k => k.startsWith('tidy-'));
    await page.locator(`[data-actions] [data-row][data-key="${tidyKey}"] .ui-table__disclose`).click(); await page.waitForTimeout(400);
    const tidy = (await panelText(page))[0] || '';
    ok(`${width}: the Tidy row names its rule and the company line`, /Tidy rule: No touch in 14 days after a site visit/.test(tidy) && /ZZ Lakeshore Mutual Holdings · Replied · P1 · Jack · last touch/.test(tidy), tidy.replace(/\n/g, ' | '));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    ok(`${width}: Esc closes`, (await panelText(page)).length === 0);
    const all = [];
    for (const k of keys) { await page.locator(`[data-actions] [data-row][data-key="${k}"] .ui-table__disclose`).click(); await page.waitForTimeout(250); all.push(...(await panelText(page))); }
    ok(`${width}: every kind on the list opens a panel; no "@" in any`, all.length === keys.length && all.every(t => !t.includes('@')), `${all.length}/${keys.length} panels`);
    const waiting = all.find(t => t.includes('Pat owes it')) || '';
    const flag = all.find(t => t.includes('Flagged by')) || '';
    ok(`${width}: waiting-on says who owes it + days late; the flag says who + the note`, /Pat owes it · due [A-Z][a-z]{2} \d{1,2} · 5 days late/.test(waiting) && /Flagged by Jack · “opened the deck 3 times”/.test(flag), `${waiting.split('\n').find(l => l.includes('owes')) || '-'} / ${flag.split('\n').find(l => l.includes('Flagged')) || '-'}`);
    if (width === 1440) {
      await page.keyboard.press('Escape'); await page.waitForTimeout(200); // the loop above leaves the last row's panel open
      await page.locator(`[data-actions] [data-row][data-key="${todoKey}"] .ui-table__disclose`).click(); await page.waitForTimeout(300);
      await page.locator('[data-actions] [data-detail]').getByRole('button', { name: 'Open company →' }).click(); await page.waitForTimeout(2500);
      const win = page.locator('aside[data-center-window]');
      const opened = await win.isVisible().catch(() => false) && (await win.textContent()).includes('ZZ Old Mill Union');
      await shot(page, 'fixard-open-company-1440', false);
      ok('1440: Open company → opens the company window for that company', opened);
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
  const lines = [`FIX actions-row-detail-v1 - live row detail (${new Date().toISOString().slice(0, 10)}, temp workspace, 0 Apollo, 0 Claude)`, ''];
  for (const c of results.checks) lines.push(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` - ${c.detail}` : ''}`);
  if (results.errors.length) lines.push('', 'errors:', ...results.errors.map(e => '  ' + e));
  fs.writeFileSync(`${OUT}/fixard-report.txt`, lines.join('\n'));
  console.log(lines.join('\n'));
  const pass = results.checks.filter(c => c.pass).length;
  console.log(`\nchecks ${pass}/${results.checks.length} · workspace left ${left} · HomeLover diff ${diff.length ? diff.join(', ') : 'none'} · errors ${results.errors.length} · restored: ${left === 0 && !diff.length ? 'yes' : 'NO'}`);
  process.exit(0);
}
