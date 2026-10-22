// FIX actions-done-button-v1 REV2 - the live pass: Done on an unmatched signal, a partner-matched signal, an
// employer-linked Tidy suggestion and a partner "follow up" suggestion from the Actions screen; the DB afterwards;
// the next Tidy run; Undo on the partner suggestion; shots at 1440 + 390; N2.
// SCOPE (declared): TEMP data only - 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only) + 1 temp owner; ~12 rows (1 partner, 1 employer, 2 signals, 2 suggestions, 1 member + the rows Done
// makes). Made-up names; no emails or phones. HomeLover never written (counts compared before/after). 0 Apollo and
// 0 Claude: the sync / apollo / visit-pull / tidy / research / anthropic routes are aborted in the browser (the one Tidy
// run is a node-side call to the local server - Tidy is pure SQL), and research_runs + visit_pull_runs for the temp
// workspace are counted before teardown (must be 0 + 0). Runtime ~2 min, hard cap 240 s (tempGuard), teardown deletes
// everything. Outputs fixad-*.png + fixad-report.txt into .screenshots/fix-actions-done-button-v1 (never build/).
// Usage: node scripts/verify/fix-actions-done-button-v1.mjs [outdir]   (run npm run build first)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, '.screenshots', 'fix-actions-done-button-v1');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3983;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Actions Done FIX';
const HL = ['sales_week_goals', 'sales_signals', 'sales_suggestions', 'sales_targets', 'sales_goals', 'sales_opportunities', 'sales_partner_events', 'sales_tidy_runs', 'research_runs', 'visit_pull_runs'];
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
  if (B) {
    for (const t of TEMP_TABLES) { const r = await svc.from(t).delete().eq('business_id', B); if (r.error) console.log(`cleanup ${t}: ${r.error.message}`); }
    await svc.from('businesses').delete().eq('id', B);
  }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 240000 });
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
const results = { checks: [], errors: [], n2: {}, calls: null };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
const PARTNER = 'ZZ Lakeshore Mutual', EMPLOYER = 'ZZ Old Mill Union', NEW_CO = 'ZZ Nimbus Freight';

try {
  const tag = 'fixad-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://fixad.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
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
  const partner = ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name: PARTNER, category: '3. Brokers', pipeline_status: 'replied', owner_user_id: owner.id, channel: 'manual', tier: '1', last_touch_at: ago(72) }).select('id').single());
  const emp = ins(await svc.from('sales_opportunities').insert({ business_id: B, organization: EMPLOYER, org_type: 'employer', stage: 'contacted', source: 'manual', channel: 'call_note', owner: 'Jack Test', covered_lives: 1200 }).select('id').single());
  const sig = (company_name, extra) => ({ business_id: B, source: 'scout', signal_week: week, company_name, company_key: company_name.toLowerCase(), kind: 'partner', kind_guessed: false, signal: 'Opened an office', why_now: 'Hiring', score: 55, status: 'new', created_by: owner.id, ...extra });
  const [sNew, sPartner] = ins(await svc.from('sales_signals').insert([sig(NEW_CO, { kind: 'employer' }), sig(PARTNER, { score: 70 })]).select('id, company_name'));
  const [gFollow, gVisit] = ins(await svc.from('sales_suggestions').insert([
    { business_id: B, kind: 'follow_up', ref_type: 'partner', ref_id: partner.id, text: `Follow up ${PARTNER}`, reason: 'Replied · last touch 3 d ago · no open to-do', status: 'proposed' },
    { business_id: B, kind: 'visited_no_touch', ref_type: 'opportunity', ref_id: emp.id, text: `Reach out to ${EMPLOYER}`, reason: 'Visited · no touch in 14 d', status: 'proposed' },
  ]).select('id, kind'));
  log('fixture in');

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const api = async (method, p, body) => {
    const res = await fetch(`http://localhost:${PORT}/api/sales/${B}${p}`, { method, headers: { Cookie: `prospector_at=${encodeURIComponent(owner.session.access_token)}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
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
      localStorage.setItem(`prospector_visits_ran_${b}`, dd); localStorage.setItem(`prospector_tidy_ran_${b}`, dd);
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), B, today]);
    // Real-call guard (ui-clarity-v1 Stage 2): nothing that could spend Apollo or Claude leaves the browser.
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull|\/goals\/tidy\/run|\/research\/run|\/research$|\/proxy\/anthropic/, route => { blocked.push(route.request().url()); route.abort(); });
    await page.goto(`http://localhost:${PORT}/?tab=actions`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1200);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Actions/ }).first().dispatchEvent('click'); await page.waitForTimeout(1500);
    await page.locator('[data-actions] [data-row]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    return { page, errs, compact };
  }
  const shot = (page, n, full) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: full });
  const above = page => page.evaluate(() => Object.fromEntries([['tabrow', document.querySelector('[data-sales-tabrow]')], ['frame', document.querySelector('[data-sales-frame]')], ['filters', document.querySelector('[data-filter-row]')], ['table', document.querySelector('.ui-table-box, .ui-list')]].map(([k, el]) => [k, el ? Math.round(el.getBoundingClientRect().y) : null])));
  const acts = (page, text) => page.getByRole('group', { name: `Actions for ${text}` });
  const goal = async () => ins(await svc.from('sales_goals').select('pipeline_status, last_touch_at, first_email_at').eq('id', partner.id).single());
  const events = async () => ins(await svc.from('sales_partner_events').select('id, event, touch_type, to_status, note, meta, recorded_at').eq('goal_id', partner.id).order('recorded_at', { ascending: true }));
  const todos = async () => ins(await svc.from('sales_week_goals').select('id, text, status, completed_at, link_type, link_id, category').eq('business_id', B).eq('kind', 'todo'));

  // ── 1440: the four Done clicks, DB after each, Undo on the partner suggestion ──
  const { page, errs } = await newPage();
  const texts = [`Reach out: ${NEW_CO}`, `Reach out: ${PARTNER}`, `Follow up ${PARTNER}`, `Reach out to ${EMPLOYER}`];
  const btns = await Promise.all(texts.map(t => acts(page, t).getByRole('button').allTextContents()));
  ok('1440: every signal and to-do-making Tidy row carries Accept · Done · …', btns.every(b => b[0] === 'Accept' && b[1] === 'Done'), JSON.stringify(btns));
  await shot(page, 'fixad-actions-1440', false);
  const b0 = await above(page);
  // Done on the unmatched signal: a target + a done to-do.
  await acts(page, texts[0]).getByRole('button', { name: 'Done' }).click(); await page.waitForTimeout(1500);
  const t1 = await todos();
  const target = ins(await svc.from('sales_targets').select('id, name, status, signal_id').eq('business_id', B));
  ok('Done on an unmatched signal: one target (researching) + the to-do born done, linked to it, under "done"', target.length === 1 && target[0].name === NEW_CO && t1.length === 1 && t1[0].status === 'done' && !!t1[0].completed_at && t1[0].link_type === 'target' && t1[0].link_id === target[0].id && (await page.locator('[data-actions] [data-row]').allInnerTexts()).every(x => !x.includes(texts[0])), JSON.stringify({ target, t1 }));
  const b1 = await above(page);
  ok(`N2 1440: a Done moves nothing above the table (max ${Math.max(...Object.keys(b0).map(k => Math.abs((b0[k] ?? 0) - (b1[k] ?? 0))))} px)`, Object.keys(b0).every(k => Math.abs((b0[k] ?? 0) - (b1[k] ?? 0)) <= 1), JSON.stringify({ b0, b1 }));
  // Done on the partner-matched signal: ONE email touch, stage still Replied, last touch now, no note event.
  const g0 = await goal();
  await acts(page, texts[1]).getByRole('button', { name: 'Done' }).click(); await page.waitForTimeout(1500);
  const g1 = await goal(), ev1 = await events();
  ok('Done on a partner-matched signal: one touch (email, no stage move) carrying the signal note, last touch = now, first_email_at set; no note event', ev1.length === 1 && ev1[0].event === 'touch' && ev1[0].touch_type === 'email' && ev1[0].to_status === null && /^Signal Scout/.test(ev1[0].note) && g1.pipeline_status === 'replied' && Date.now() - Date.parse(g1.last_touch_at) < 60e3 && g1.first_email_at === today, JSON.stringify({ g0, g1, ev1 }));
  const sigRows = ins(await svc.from('sales_signals').select('company_name, status, todo_id').eq('business_id', B));
  ok('both signals accepted with their to-do ids; the partner to-do is done and linked to the partner', sigRows.every(r => r.status === 'accepted' && r.todo_id) && (await todos()).filter(t => t.link_type === 'partner' && t.status === 'done').length === 1, JSON.stringify(sigRows));
  // Done on the employer-linked suggestion: a done to-do on the employer = its Last touch.
  await acts(page, texts[3]).getByRole('button', { name: 'Done' }).click(); await page.waitForTimeout(1500);
  const det = await api('GET', `/goals/company?type=employer&id=${emp.id}`);
  const empTodo = (await todos()).find(t => t.link_type === 'opportunity');
  ok('Done on an employer-linked suggestion: a done Tidy to-do on the employer, and the company window\'s Last touch reads it (todo_done, today)', empTodo?.status === 'done' && empTodo.category === 'Tidy' && det.status === 200 && det.body.record?.last_touch?.touch_type === 'done' && (det.body.record.last_touch.at || '').slice(0, 10) === new Date().toISOString().slice(0, 10) && (await events()).length === 1, JSON.stringify({ empTodo, last_touch: det.body?.record?.last_touch }));
  // Done on the partner follow-up: a second touch; the next Tidy run proposes no new follow-up; Undo takes it back.
  await acts(page, texts[2]).getByRole('button', { name: 'Done' }).click(); await page.waitForTimeout(1500);
  const ev2 = await events(), g2 = await goal();
  const sug = ins(await svc.from('sales_suggestions').select('id, kind, status').eq('business_id', B));
  ok('Done on the partner follow-up suggestion: a second email touch with the to-do text, stage still Replied, suggestion accepted', ev2.length === 2 && ev2[1].event === 'touch' && ev2[1].note === texts[2] && ev2[1].meta?.from_suggestion_id === gFollow.id && g2.pipeline_status === 'replied' && sug.every(x => x.status === 'accepted'), JSON.stringify({ ev2: ev2.map(e => [e.event, e.note]), sug }));
  const tidy = await api('POST', '/goals/tidy/run', { force: true, trigger: 'manual' });
  const after = ins(await svc.from('sales_suggestions').select('kind, ref_id, status').eq('business_id', B));
  // The reach-out rules (follow_up / visited_no_touch) stay quiet: the key was accepted and the touch is fresh. A
  // replied partner with no open to-do still gets its reply_task - a different rule, untouched by this FIX.
  const reach = after.filter(x => x.status === 'proposed' && x.ref_id === partner.id && ['follow_up', 'visited_no_touch'].includes(x.kind));
  ok('the next Tidy run (node-side, 0 AI) proposes no new follow-up / reach-out for the partner', tidy.status === 200 && tidy.body.ran === true && reach.length === 0, JSON.stringify({ counts: tidy.body.run?.counts, after }));
  await page.waitForTimeout(500);
  const toast = page.getByRole('status').last();
  ok('the Done toast says "Done: <to-do text>" with Undo', /^Done: Follow up ZZ Lakeshore Mutual/.test(((await toast.innerText().catch(() => '')) || '').trim()), await toast.innerText().catch(() => 'no toast'));
  await toast.getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(1800);
  const ev3 = await events(), g3 = await goal();
  const sugAfter = ins(await svc.from('sales_suggestions').select('id, status').eq('id', gFollow.id).single());
  ok('Undo on the partner Done: an undo event, last touch back to the signal\'s touch, the done to-do gone, the suggestion proposed again', ev3.length === 3 && ev3[2].event === 'undo' && ev3[2].meta?.undid === ev2[1].id && g3.last_touch_at === g1.last_touch_at && !(await todos()).some(t => t.text === texts[2]) && sugAfter.status === 'proposed', JSON.stringify({ ev3: ev3.map(e => e.event), g3, sugAfter }));
  await shot(page, 'fixad-actions-after-1440', false);
  if (errs.length) results.errors.push(...errs.map(e => `1440: ${e}`));
  await page.context().close();

  // ── 390: the Done button on the card list, Done on the re-proposed follow-up ──
  {
    const { page: p2, errs: e2 } = await newPage({ width: 390, height: 844 });
    const row = acts(p2, texts[2]);
    ok('390: the Tidy card carries Accept · Done · Dismiss · Snooze', JSON.stringify(await row.getByRole('button').allTextContents()) === JSON.stringify(['Accept', 'Done', 'Dismiss', 'Snooze']), JSON.stringify(await row.getByRole('button').allTextContents()));
    await shot(p2, 'fixad-actions-390', false);
    const c0 = await above(p2);
    await row.getByRole('button', { name: 'Done' }).click(); await p2.waitForTimeout(1500);
    const c1 = await above(p2);
    ok('390: Done works from the card list and moves nothing above the list', (await events()).length === 4 && Object.keys(c0).every(k => Math.abs((c0[k] ?? 0) - (c1[k] ?? 0)) <= 1), JSON.stringify({ c0, c1 }));
    await shot(p2, 'fixad-actions-after-390', false);
    if (e2.length) results.errors.push(...e2.map(e => `390: ${e}`));
    await p2.context().close();
  }
  results.calls = { research_runs: await count('research_runs', 'business_id', B), visit_pull_runs: await count('visit_pull_runs', 'business_id', B), blockedRequests: blocked.length };
  ok('0 Claude / 0 Apollo: research_runs 0, visit_pull_runs 0 for the temp workspace', results.calls.research_runs === 0 && results.calls.visit_pull_runs === 0, JSON.stringify(results.calls));
} catch (e) {
  results.errors.push('THROW ' + (e.stack?.split('\n').slice(0, 3).join(' | ') || e.message));
  log('THROW', e.message);
} finally {
  await cleanup();
  const left = B ? await count('businesses', 'id', B) : 0;
  const hlAfter = await hlCounts();
  const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
  results.restored = { workspaceLeft: left, homeloverDiff: diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`), usersDeleted: users.length };
  const lines = [`FIX actions-done-button-v1 REV2 - live pass (${new Date().toISOString().slice(0, 10)}, temp workspace, 0 Apollo, 0 Claude)`, ''];
  for (const c of results.checks) lines.push(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ` - ${c.detail}` : ''}`);
  if (results.errors.length) lines.push('', 'errors:', ...results.errors.map(e => '  ' + e));
  fs.writeFileSync(`${OUT}/fixad-report.txt`, lines.join('\n'));
  console.log(lines.join('\n'));
  const pass = results.checks.filter(c => c.pass).length;
  console.log(`\nchecks ${pass}/${results.checks.length} · workspace left ${left} · HomeLover diff ${diff.length ? diff.join(', ') : 'none'} · errors ${results.errors.length} · restored: ${left === 0 && !diff.length ? 'yes' : 'NO'}`);
  process.exit(0);
}
