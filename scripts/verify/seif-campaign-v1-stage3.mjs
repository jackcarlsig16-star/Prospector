// seif-campaign-v1 Stage 3 - Pipeline > Campaigns + the Actions campaign rows, end to end in a temp workspace:
// New campaign -> a template written in the UI (live preview) -> import a sheet of 12 fake contacts across the 4 tracks
// (plus one Brad / Upside row, one without an email, one repeat - all left out) -> Activate -> as the sender on Actions:
// Copy email, Sent + Undo, Sent, Stop, They replied -> Promote (partner, handed to the owner); in the contacts table:
// Meeting booked -> Promote (employer), They replied -> Promote (target); the visitor window's Add to pipeline once (the
// shared insertCompanyRecord); a Viewer pass; 1440 + 390 contrast (ui-clarity measure) and N2.
// SCOPE (declared): TEMP data only - 1 goals_sales workspace (added to SALES_ANALYTICS_BUSINESS_IDS for the local server
// only), 3 temp users (owner, member = the sender, viewer); 2 seed partners, 1 website-visit signal + 2 web_visits; the
// run then writes 1 campaign, 4 tracks, 12 steps, 12 contacts, <= 20 events, 1 partner + 1 employer + 1 target (Promote)
// and 1 employer (Add to pipeline). Made-up names; every address is a reserved .example one and none may reach a page.
// HomeLover never written (counts compared). 0 Claude / 0 Apollo / 0 Graph: sync, apollo, visit pull, tidy, research,
// anthropic and /api/microsoft routes are aborted in the browser (count reported) and run tables counted. Runtime ~3
// min, hard cap 300 s (tempGuard). Shots + report: .screenshots/seif-campaign-v1/. Run npm run build first.
// Usage: node scripts/verify/seif-campaign-v1-stage3.mjs [outdir]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const { measureScript, summarize, formatWorst } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(ROOT, '.screenshots', 'seif-campaign-v1');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3979;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Seif Campaign Stage3';
const HL = ['sales_outreach_campaigns', 'sales_outreach_contacts', 'sales_outreach_events', 'sales_goals', 'sales_opportunities', 'sales_targets', 'partner_contacts', 'sales_partner_events', 'sales_week_goals'];
const RUNS = ['research_runs', 'visit_pull_runs', 'sales_sync_runs', 'sales_tidy_runs'];
const TEMP_TABLES = ['sales_outreach_events', 'sales_outreach_contacts', 'sales_outreach_campaigns', 'partner_contacts', 'sales_partner_events', 'sales_week_goal_steps', 'sales_week_goals', 'sales_signals', 'sales_suggestions', 'web_visits', ...RUNS, 'sales_opportunity_events', 'sales_targets', 'sales_opportunities', 'sales_goals', 'auth_events', 'business_members'];
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
  for (const u of users) {
    await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id);
    await svc.from('microsoft_sync_runs').delete().eq('user_id', u.id);
    await svc.auth.admin.deleteUser(u.id);
  }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 300000 });
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monday = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
log('HomeLover before', JSON.stringify(hlBefore));
const results = { screens: {}, checks: [], errors: [], leaks: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${detail}` : ''); };
const SCREEN = measureScript({ scope: '#sales-analytics-root' });
const BOXES = `(() => Object.fromEntries(['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-sales-frame', 'data-filter-row'].map(a => {
  const el = document.querySelector('[' + a + ']'); if (!el) return [a, null];
  const r = el.getBoundingClientRect(); return [a, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }];
})))()`;
const maxMove = (a, b, keys) => Math.max(...keys.map(k => (a[k] && b[k] ? Math.max(Math.abs(a[k].x - b[k].x), Math.abs(a[k].y - b[k].y), Math.abs(a[k].h - b[k].h)) : 0)));

// 12 contacts, 3 per track, then the three that must be left out.
const SHEET = [
  ['Ana Alder', 'Principal', 'ZZ Alder Consulting', 'ana@alder.example', 'Consultant', 'Yes'],
  ['Ben Birch', 'Partner', 'ZZ Kestrel Advisors', 'ben@kestrel.example', 'Broker', 'yes'],
  ['Cara Cove', 'Advisor', 'ZZ Cove Advisory', 'cara@cove.example', 'Consultant', 'yes'],
  ['Dan Dale', 'Principal', 'ZZ Dale Partners', 'dan@dale.example', 'Broker', 'no'],
  ['Eve East', 'Consultant', 'ZZ East Benefits', 'eve@east.example', 'Consultant', 'no'],
  ['Finn Ford', 'Broker', 'ZZ Ford Group', 'finn@ford.example', 'Broker', 'no'],
  ['Gia Glen', 'CHRO', 'ZZ Glen Foods', 'gia@glen.example', 'Corporate', 'yes'],
  ['Hal Hart', 'VP People', 'ZZ Hart Logistics', 'hal@hart.example', 'Corporate', 'yes'],
  ['Ivy Isle', 'Benefits Lead', 'ZZ Isle Health', 'ivy@isle.example', 'Corporate', 'yes'],
  ['Jon Jade', 'CFO', 'ZZ Brightmill Foods', 'jon@brightmill.example', 'Corporate', 'no'],
  ['Kai Knoll', 'COO', 'ZZ Knoll Labs', 'kai@knoll.example', 'Corporate', 'no'],
  ['Lea Lake', 'HR Director', 'ZZ Lake Schools', 'lea@lake.example', 'Corporate', 'no'],
  ['Moe Marsh', 'CEO', 'ZZ Harbor Benefits', 'moe@harbor.example', 'Broker', 'yes'],
  ['Nia Noon', 'Owner', 'ZZ Noon Co', '', 'Corporate', 'yes'],
  ['Ana Again', 'Principal', 'ZZ Alder Consulting', 'ANA@alder.example', 'Consultant', 'yes'],
];
async function sheetFile() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Contacts');
  ws.getRow(1).values = ['Full Name', 'Title', 'Company', 'Email', 'Segment', 'Knows Seif'];
  SHEET.forEach((r, i) => { ws.getRow(2 + i).values = r; });
  const file = path.join(OUT, 'zz-contacts.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

try {
  const tag = 'seif3-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://seif3.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const mk = async (name, role) => {
    const email = `${tag}-${name.toLowerCase().replace(/\s+/g, '-')}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from('profiles').update({ display_name: name, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert({ business_id: B, email, name, user_id: u.user.id, role }).select());
    const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(sErr.message);
    const u2 = { id: u.user.id, session: s.session, name }; users.push(u2); return u2;
  };
  const owner = await mk('Jack Test', 'owner'), seif = await mk('Seif Temp', 'member'), viewer = await mk('Vic Viewer', 'viewer');
  const today = laToday(), week = monday(today);
  ins(await svc.from('sales_goals').insert([
    { business_id: B, goal_type: 'partnership', name: 'ZZ Kestrel Advisors', pipeline_status: 'not_started', owner_team: 'homelover', channel: 'manual' },
    { business_id: B, goal_type: 'partnership', name: 'ZZ Harbor Benefits', pipeline_status: 'replied', owner_team: 'upside', co_owner_name: 'Brad', channel: 'manual' },
  ]).select('id'));
  ins(await svc.from('sales_signals').insert({ business_id: B, source: 'web_visit', signal_week: week, company_name: 'ZZ Acme Visitors', company_key: 'zz acme visitors', kind: 'employer', kind_guessed: true, signal: '6 visits in 7 days', why_now: 'P2 Follow up: 6 visits', status: 'new', created_by: owner.id }).select('id'));
  const visit = d => ({ business_id: B, pulled_on: d, company_key: 'zz acme visitors', company_name: 'ZZ Acme Visitors', priority: 'P2', priority_rule: 'test', visits_7d: 6, last_visit: d, us_500: true, top_paths: ['/pricing'] });
  ins(await svc.from('web_visits').insert([visit(today), visit(addDays(today, -1))]).select('id'));
  const runsBefore = {}; for (const t of RUNS) runsBefore[t] = await count(t, 'business_id', B);
  const sheet = await sheetFile();
  log('fixture in');

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const blocked = [];
  async function newPage(u, { width = 1440, height = 900 } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errs.push(`PAGE ${u.name}@${width}: ${e.message.slice(0, 160)}`));
    page.on('requestfailed', r => { if (!blocked.includes(r.url())) results.errors.push(`request failed ${u.name}@${width}: ${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} ${r.failure()?.errorText}`); });
    // Nothing a page receives about campaigns or Actions may carry an address.
    page.on('response', async r => {
      if (!/\/goals\/(campaign|actions)/.test(r.url())) return;
      const t = await r.text().catch(() => '');
      if (t.includes('@')) results.leaks.push(r.url().replace(/^.*\/goals/, ''));
    });
    await page.addInitScript(([k, v, b, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      // actions-v2 REV2: Actions opens on the signed-in person with Housekeeping folded; these checks read the whole team, unfolded.
      localStorage.setItem('prospector_goals_owner', 'team'); localStorage.setItem('prospector_actions_folded', '[]');
      localStorage.setItem(`prospector_visits_ran_${b}`, dd); localStorage.setItem(`prospector_tidy_ran_${b}`, dd);
    }, [`sb-${REF}-auth-token`, JSON.stringify(u.session), B, today]);
    // Real-call guard: anything that could spend Claude, Apollo or Graph never leaves the browser.
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull|\/goals\/tidy\/run|\/research\/run|\/research$|\/proxy\/anthropic|\/api\/microsoft\//, route => { blocked.push(route.request().url()); route.abort(); });
    await page.goto(`http://localhost:${PORT}/`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    const api = (p, opts) => page.evaluate(async ([bb, pp, o]) => { const r = await fetch(`/api/sales/${bb}/goals${pp}`, o ? { method: o.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o.body || {}) } : undefined); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [B, p, opts || null]);
    return { page, errs, api };
  }
  const tab = async (page, label) => { await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: new RegExp(`^${label}`) }).first().dispatchEvent('click'); await page.waitForTimeout(1200); };
  const sub = async (page, label) => { await page.locator('[data-sales-subviews]').getByRole('tab', { name: label, exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500); };
  // Fresh data without a reload (a reload leaves the workspace): out to the list and back in, or to another tab and back.
  const reopenCampaign = async page => { await page.getByRole('button', { name: '← All campaigns' }).click(); await page.getByRole('button', { name: 'ZZ Fall campaign' }).first().click(); await page.locator('[data-campaign]').waitFor({ timeout: 15000 }); await page.waitForTimeout(800); };
  const reloadActions = async page => { await tab(page, 'Pipeline'); await tab(page, 'Actions'); await page.waitForTimeout(1500); };
  const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png`, animations: 'disabled', caret: 'hide', fullPage: true });
  const measure = async (page, key) => {
    const m = await page.evaluate(SCREEN);
    if (m.error) { results.errors.push(`${key}: ${m.error}`); return null; }
    const s = summarize(m); results.screens[key] = { ...s, scrollW: m.scrollW, vw: m.vw };
    log(key, `text ${s.textFails}/${s.texts}`, `controls ${s.controlFails}/${s.controls}`, `scroll ${m.scrollW}/${m.vw}`);
    if (s.textFails || s.controlFails) log(formatWorst(key, s));
    return s;
  };
  const contactsOf = async () => ins(await svc.from('sales_outreach_contacts').select('id, name, status, current_step, next_due_date, last_sent_at, replied_at, goal_id, opportunity_id, target_id, owner_user_id, track_id').eq('business_id', B));

  // ---- Owner (Jack Test), 1440: create, template, import, activate.
  const J = await newPage(owner);
  await tab(J.page, 'Pipeline'); await sub(J.page, 'Campaigns');
  const boxCompaniesRef = await (async () => { await sub(J.page, 'Companies'); await J.page.waitForTimeout(800); const b = await J.page.evaluate(BOXES); await sub(J.page, 'Campaigns'); return b; })();
  await J.page.getByRole('button', { name: 'New campaign' }).click();
  await J.page.getByLabel('Name', { exact: true }).fill('ZZ Fall campaign');
  await J.page.getByLabel('Sends from').selectOption({ label: "Seif's mailbox" });
  await J.page.getByRole('button', { name: 'Create', exact: true }).click();
  await J.page.getByRole('heading', { name: 'ZZ Fall campaign' }).waitFor({ timeout: 15000 });
  const camp = ins(await svc.from('sales_outreach_campaigns').select('id, status, sender_user_id').eq('business_id', B).single());
  const tracks = ins(await svc.from('sales_outreach_tracks').select('id, name, segment, warmth').eq('campaign_id', camp.id));
  const steps = ins(await svc.from('sales_outreach_steps').select('id, track_id, step_no, day_offset').in('track_id', tracks.map(t => t.id)));
  ok('New campaign: draft, sends from Seif, 4 tracks x 3 steps at 0 / 4 / 10', camp.status === 'draft' && camp.sender_user_id === seif.id && tracks.length === 4 && steps.length === 12 && steps.every(s => s.day_offset === [0, 4, 10][s.step_no - 1]), JSON.stringify(tracks.map(t => t.name)));

  // Templates: step 1 of the first track typed in the UI (live preview), the rest written through the page session.
  await J.page.getByRole('button', { name: 'Templates', exact: true }).click(); await J.page.waitForTimeout(600);
  const first = J.page.locator('[data-track]').first();
  const step1 = first.locator('[data-step="1"]');
  await step1.getByLabel('Subject').fill('Idea for {company}');
  await step1.getByLabel('Body').fill('Hi {first_name}, as {title} at {company} you might like this.');
  const prev = await step1.locator('[data-step-preview]').textContent();
  ok('Templates: the live preview fills the merge fields on the sample', /Idea for Sample Co/.test(prev) && /Hi Alex, as Benefits Lead at Sample Co/.test(prev), prev);
  await step1.getByRole('button', { name: 'Save step 1' }).click(); await J.page.waitForTimeout(1200);
  for (const st of steps) {
    const r = await J.api(`/campaigns/${camp.id}/steps/${st.id}`, { method: 'PATCH', body: { subject: `Step ${st.step_no} for {company}`, body: `Hi {first_name}, step ${st.step_no} for {company}.` } });
    if (r.status !== 200) results.errors.push(`step ${st.id}: ${r.status} ${r.body.error}`);
  }
  await reopenCampaign(J.page);
  await J.page.getByRole('button', { name: 'Templates', exact: true }).click(); await J.page.waitForTimeout(800);
  await measure(J.page, 'templates@1440'); await shot(J.page, 'seif3-templates-1440');
  await J.page.getByRole('button', { name: 'Contacts', exact: true }).click(); await J.page.waitForTimeout(500);

  // Import: preview (flags, no address), then add.
  await J.page.getByRole('button', { name: 'Import contacts' }).click();
  await J.page.getByLabel('Contact sheet').setInputFiles(sheet);
  await J.page.locator('[data-import-rows]').waitFor({ timeout: 15000 });
  const rowText = n => J.page.locator(`[data-import-row="${n}"]`).textContent();
  const [r14, r15, r16] = [await rowText(14), await rowText(15), await rowText(16)];
  ok("Import preview: Brad's / Upside's row left out by default, the no-email and repeat rows left out, Kestrel linked",
    /Left out/.test(r14) && /Brad's \/ Upside's company/.test(r14) && /missing email/.test(r15) && /duplicate in the sheet/.test(r16) && /Partner: ZZ Kestrel Advisors/.test(await rowText(3)), JSON.stringify({ r14, r15, r16 }));
  ok('Import preview: no address on the screen', !(await J.page.locator('[data-campaign-import]').textContent()).includes('@'));
  await measure(J.page, 'import@1440'); await shot(J.page, 'seif3-import-1440');
  await J.page.getByRole('button', { name: 'Add 12 contacts' }).click();
  await J.page.getByRole('status').filter({ hasText: 'Added 12 contacts' }).waitFor({ timeout: 20000 });
  let contacts = await contactsOf();
  ok('Import: 12 contacts, 3 per track, owned by the sender, all not scheduled', contacts.length === 12 && tracks.every(t => contacts.filter(c => c.track_id === t.id).length === 3) && contacts.every(c => c.status === 'queued' && c.owner_user_id === seif.id), String(contacts.length));

  await J.page.getByRole('button', { name: 'Activate' }).click();
  await J.page.getByRole('status').filter({ hasText: /^Scheduled/ }).waitFor({ timeout: 20000 });
  contacts = await contactsOf();
  ok('Activate: all 12 scheduled from the first send day (cap 40)', contacts.every(c => c.status === 'active' && c.next_due_date && c.current_step === 1), JSON.stringify([...new Set(contacts.map(c => c.next_due_date))]));
  // Actions shows sends due today or late; on a Fri-Sun run the schedule starts Monday, so pull three to today.
  const sendDay = [1, 2, 3, 4].includes(new Date(`${today}T12:00:00Z`).getUTCDay());
  if (!sendDay) for (const c of contacts.slice(0, 3)) ins(await svc.from('sales_outreach_contacts').update({ next_due_date: today }).eq('id', c.id).select('id'));
  await measure(J.page, 'campaign-contacts@1440'); await shot(J.page, 'seif3-campaign-1440');
  const boxCampaign = await J.page.evaluate(BOXES);
  const mv = maxMove(boxCompaniesRef, boxCampaign, ['data-workspace-header', 'data-sales-tabrow', 'data-sales-subviews', 'data-sales-frame']);
  ok(`N2 1440: header, tab row, sub-view switch and frame row don't move from Companies to a campaign (max ${mv} px); filter row 36 px`, mv <= 1 && boxCampaign['data-filter-row']?.h === 36, JSON.stringify({ ref: boxCompaniesRef['data-sales-frame'], camp: boxCampaign['data-sales-frame'], filter: boxCampaign['data-filter-row'] }));

  // ---- The sender (Seif Temp) on Actions: Copy email, Sent + Undo, Sent, Stop, They replied -> Promote (partner).
  const S = await newPage(seif);
  await tab(S.page, 'Actions');
  await S.page.locator('[data-actions] [data-row]').first().waitFor({ timeout: 20000 });
  const sendRows = S.page.locator('[data-actions] [data-row]').filter({ hasText: /^.*Send step 1 to/ });
  const nSend = await sendRows.count();
  ok('Actions (sender): the day\'s sends are there, kind Campaign', nSend >= 3, String(nSend));
  await measure(S.page, 'actions-sender@1440'); await shot(S.page, 'seif3-actions-1440');
  const textOf = async loc => (await loc.locator('td').nth(1).textContent()).trim();
  const rowA = sendRows.nth(0), nameA = (await textOf(rowA)).replace(/^Send step 1 to (.+?) \(.*$/, '$1');
  await rowA.getByRole('button', { name: 'Copy email' }).click(); await S.page.waitForTimeout(1200);
  const clip = await S.page.evaluate(() => navigator.clipboard.readText());
  ok('Copy email: subject + merged body on the clipboard, no address', /^Subject: Step 1 for ZZ /.test(clip) && /Hi \w+, step 1 for ZZ /.test(clip) && !clip.includes('@'), clip.slice(0, 80));
  await rowA.getByRole('button', { name: 'Sent', exact: true }).click(); await S.page.waitForTimeout(1500);
  const cA = (await contactsOf()).find(c => c.name === nameA);
  ok('Sent: step 2 booked, last sent now', cA.current_step === 2 && !!cA.last_sent_at && cA.next_due_date > today, JSON.stringify({ step: cA.current_step, due: cA.next_due_date }));
  await S.page.getByRole('status').getByRole('button', { name: 'Undo' }).click(); await S.page.waitForTimeout(2000);
  const cA2 = (await contactsOf()).find(c => c.name === nameA);
  const evA = await count('sales_outreach_events', 'contact_id', cA2.id);
  ok('Undo: back on step 1, due as before, the event gone', cA2.current_step === 1 && !cA2.last_sent_at && evA === 0, JSON.stringify({ step: cA2.current_step, events: evA }));
  const rowA2 = S.page.locator('[data-actions] [data-row]').filter({ hasText: `Send step 1 to ${nameA}` });
  await rowA2.getByRole('button', { name: 'Sent', exact: true }).click(); await S.page.waitForTimeout(1500);
  const rowB = S.page.locator('[data-actions] [data-row]').filter({ hasText: /Send step 1 to/ }).nth(0), nameB = (await textOf(rowB)).replace(/^Send step 1 to (.+?) \(.*$/, '$1');
  // actions-v2 REV2 A3: Stop sits in the row's More ▾ (Copy email · Sent · More).
  await rowB.getByLabel(/^More for /).selectOption({ label: 'Stop (no more steps)' }); await S.page.waitForTimeout(1500);
  ok('Stop: that person is finished, nothing due', (await contactsOf()).find(c => c.name === nameB)?.status === 'done');
  // They replied on a consultant / broker, then Promote -> partner, handed to the owner.
  const all = await contactsOf();
  const ana = all.find(c => c.name === 'Ana Alder');
  if (ana.status !== 'active') results.errors.push(`Ana is ${ana.status}, not active`);
  if (ana.next_due_date !== today) ins(await svc.from('sales_outreach_contacts').update({ next_due_date: today }).eq('id', ana.id).select('id'));
  await reloadActions(S.page);
  const anaRow = S.page.locator('[data-actions] [data-row]').filter({ hasText: 'Send step' }).filter({ hasText: 'Ana Alder' }).first();
  await anaRow.waitFor({ timeout: 15000 });
  await anaRow.getByLabel(/^More for Send step/).selectOption({ label: 'They replied' }); await S.page.waitForTimeout(1500);
  await reloadActions(S.page);
  const replyRow = S.page.locator('[data-actions] [data-row]').filter({ hasText: 'Reply from Ana Alder' }).first();
  await replyRow.waitFor({ timeout: 15000 });
  ok('They replied: a P1 "Reply from …" row for the sender', /P1/.test(await replyRow.textContent()));
  ok('A reply row: Respond is the primary; Promote… is in More ▾', (await replyRow.getByRole('button', { name: 'Respond', exact: true }).count()) === 1, JSON.stringify({ buttons: await replyRow.getByRole('button').allTextContents(), selects: await replyRow.locator('select').evaluateAll(ss => ss.map(x => x.getAttribute('aria-label'))) }));
  await replyRow.getByLabel(/^More for Reply from/).selectOption({ label: 'Promote…' });
  const dlg = S.page.getByRole('dialog', { name: 'Promote ZZ Alder Consulting' });
  await dlg.waitFor();
  await measure(S.page, 'promote-dialog@1440'); await shot(S.page, 'seif3-promote-1440');
  await dlg.getByLabel('Hand to').selectOption({ label: 'Jack' });
  await dlg.getByRole('button', { name: 'Promote', exact: true }).click(); await S.page.waitForTimeout(2500);
  const pGoal = ins(await svc.from('sales_goals').select('id, name, channel, pipeline_status, owner_user_id').eq('business_id', B).eq('name', 'ZZ Alder Consulting').maybeSingle());
  const pNote = pGoal && ins(await svc.from('sales_partner_events').select('event, note').eq('goal_id', pGoal.id));
  const pPerson = pGoal && ins(await svc.from('partner_contacts').select('name, email').eq('goal_id', pGoal.id));
  ok('Promote (Actions) -> new partner: partner_referral, not started, owner Jack via Assign, source line, the person without an address',
    pGoal?.channel === 'partner_referral' && pGoal.pipeline_status === 'not_started' && pGoal.owner_user_id === owner.id && pNote.some(e => e.event === 'assign') && pNote.some(e => /^From campaign "ZZ Fall campaign": Ana Alder, Principal$/.test(e.note || '')) && pPerson.length === 1 && pPerson[0].email == null,
    JSON.stringify({ pGoal, notes: pNote?.map(e => e.event), person: pPerson }));
  ok('After Promote the reply row is gone', !(await S.page.locator('[data-actions] [data-row]').filter({ hasText: 'Reply from Ana Alder' }).count()));

  // ---- Owner, contacts table: Meeting booked -> Promote (employer); They replied -> Promote (target).
  await tab(J.page, 'Pipeline'); await sub(J.page, 'Campaigns'); await J.page.locator('[data-campaign]').waitFor({ timeout: 15000 }); await reopenCampaign(J.page);
  const tableAct = async (name, label) => { await J.page.getByLabel(`More for ${name}`).selectOption({ label }); await J.page.waitForTimeout(1800); };
  await tableAct('Jon Jade', 'Meeting booked');
  await J.page.getByRole('group', { name: 'Actions for Jon Jade' }).getByRole('button', { name: 'Promote…' }).click();
  const d2 = J.page.getByRole('dialog', { name: 'Promote ZZ Brightmill Foods' });
  await d2.waitFor();
  ok('Promote dialog defaults a corporate contact to Employer', await d2.getByRole('button', { name: 'Employer', pressed: true }).isVisible());
  await d2.getByRole('button', { name: 'Promote', exact: true }).click(); await J.page.waitForTimeout(2500);
  const opp = ins(await svc.from('sales_opportunities').select('id, organization, channel, stage, notes').eq('business_id', B).eq('organization', 'ZZ Brightmill Foods').maybeSingle());
  ok('Promote (table) -> new employer: partner_referral, stage target, source line in the notes', opp?.channel === 'partner_referral' && opp.stage === 'target' && /From campaign "ZZ Fall campaign": Jon Jade, CFO/.test(opp.notes || ''), JSON.stringify(opp && { channel: opp.channel, stage: opp.stage }));
  await tableAct('Kai Knoll', 'They replied');
  await J.page.getByRole('group', { name: 'Actions for Kai Knoll' }).getByRole('button', { name: 'Promote…' }).click();
  const d3 = J.page.getByRole('dialog', { name: 'Promote ZZ Knoll Labs' });
  await d3.waitFor();
  await d3.getByRole('button', { name: 'Target', exact: true }).click();
  await d3.getByRole('button', { name: 'Promote', exact: true }).click(); await J.page.waitForTimeout(2500);
  const tgt = ins(await svc.from('sales_targets').select('id, name, kind, channel, evidence').eq('business_id', B).eq('name', 'ZZ Knoll Labs').maybeSingle());
  ok('Promote (table) -> new target: kind employer, partner_referral, source line', tgt?.kind === 'employer' && tgt.channel === 'partner_referral' && /^From campaign "ZZ Fall campaign"/.test(tgt.evidence || ''), JSON.stringify(tgt && { kind: tgt.kind, channel: tgt.channel }));
  contacts = await contactsOf();
  const kc = (n, col) => contacts.find(c => c.name === n)?.[col];
  ok('Promoted contacts link to their records', kc('Ana Alder', 'goal_id') === pGoal?.id && kc('Jon Jade', 'opportunity_id') === opp?.id && kc('Kai Knoll', 'target_id') === tgt?.id);
  const k = (await J.api(`/campaigns/${camp.id}`)).body.counts;
  ok('Header counts: 12 contacts, sent to 1, 2 replies, reply rate 0% (both replies came from people never sent a step), 1 meeting, 3 promoted', k.contacts === 12 && k.sent_contacts === 1 && k.replies === 2 && k.reply_rate === 0 && k.meetings === 1 && k.promoted === 3, JSON.stringify({ c: k.contacts, s: k.sent_contacts, r: k.replies, rate: k.reply_rate, m: k.meetings, p: k.promoted }));
  await measure(J.page, 'campaign-after@1440'); await shot(J.page, 'seif3-campaign-after-1440');

  // ---- The visitor window's Add to pipeline once (shared insertCompanyRecord).
  await tab(J.page, 'Actions');
  const visRow = J.page.locator('[data-actions] [data-row]').filter({ hasText: 'ZZ Acme Visitors' }).first();
  await visRow.waitFor({ timeout: 15000 });
  await visRow.getByRole('button', { name: 'ZZ Acme Visitors', exact: true }).click(); await J.page.waitForTimeout(3000);
  await J.page.locator('[data-interest-band]').getByRole('button', { name: 'Add to pipeline ▾' }).click(); await J.page.waitForTimeout(400);
  await J.page.getByRole('group', { name: 'Add to pipeline as' }).getByRole('button', { name: 'Employer', exact: true }).click(); await J.page.waitForTimeout(2500);
  const added = ins(await svc.from('sales_opportunities').select('id, channel, stage, notes').eq('business_id', B).eq('organization', 'ZZ Acme Visitors').maybeSingle());
  const vis = ins(await svc.from('web_visits').select('matched_type, matched_id').eq('business_id', B).eq('company_key', 'zz acme visitors'));
  ok('Add to pipeline (visitor window, once): employer, website_visit, the visits matched to it', added?.channel === 'website_visit' && added.stage === 'target' && vis.every(v => v.matched_type === 'opportunity' && v.matched_id === added.id), JSON.stringify({ added: added && { channel: added.channel, stage: added.stage }, vis }));
  await J.page.keyboard.press('Escape'); await J.page.waitForTimeout(500);

  // ---- 390: the same screens as phone lists.
  const P = await newPage(owner, { width: 390, height: 844 });
  await tab(P.page, 'Pipeline'); await sub(P.page, 'Campaigns');
  await P.page.getByRole('button', { name: 'ZZ Fall campaign' }).first().click(); await P.page.waitForTimeout(2500);
  await measure(P.page, 'campaign-contacts@390'); await shot(P.page, 'seif3-campaign-390');
  await P.page.getByRole('button', { name: 'Templates', exact: true }).click(); await P.page.waitForTimeout(800);
  await measure(P.page, 'templates@390'); await shot(P.page, 'seif3-templates-390');
  // On a Fri-Sun run only three sends were pulled to today and the steps above used them; bring the rest due today.
  for (const c of (await contactsOf()).filter(c => c.status === 'active' && c.next_due_date > today)) ins(await svc.from('sales_outreach_contacts').update({ next_due_date: today }).eq('id', c.id).select('id'));
  const SP = await newPage(seif, { width: 390, height: 844 });
  await tab(SP.page, 'Actions'); await SP.page.waitForTimeout(2000);
  ok('390 (sender): campaign rows as phone items with their buttons', (await SP.page.locator('[data-actions]').getByRole('button', { name: 'Copy email' }).count()) > 0, JSON.stringify((await SP.page.locator('[data-actions] [data-row]').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 90)).slice(0, 6)));
  await measure(SP.page, 'actions-sender@390'); await shot(SP.page, 'seif3-actions-390');
  const narrow = Object.entries(results.screens).filter(([key]) => key.endsWith('@390')).every(([, s]) => s.scrollW <= s.vw + 1);
  ok('390: no sideways page scroll on the campaign, templates and Actions', narrow, JSON.stringify(Object.fromEntries(Object.entries(results.screens).filter(([key]) => key.endsWith('@390')).map(([key, s]) => [key, `${s.scrollW}/${s.vw}`]))));

  // ---- Viewer: reads, never acts; no campaign rows on Actions.
  const V = await newPage(viewer);
  await tab(V.page, 'Pipeline'); await sub(V.page, 'Campaigns');
  ok('Viewer list: no New campaign', !(await V.page.getByRole('button', { name: 'New campaign' }).count()));
  await V.page.getByRole('button', { name: 'ZZ Fall campaign' }).first().click(); await V.page.waitForTimeout(2500);
  const vButtons = await V.page.locator('[data-campaign]').getByRole('button').allTextContents();
  ok('Viewer campaign: no Import / Activate / Pause / row buttons', !vButtons.some(t => /Import contacts|Activate|Pause|Resume|Sent|Stop|Promote|Copy email|Schedule/.test(t)) && !(await V.page.locator('[data-campaign] select[aria-label^="More for"]').count()), JSON.stringify(vButtons.filter(t => t.trim()).slice(0, 12)));
  await V.page.getByRole('button', { name: 'Templates', exact: true }).click(); await V.page.waitForTimeout(600);
  ok('Viewer templates: read-only (no inputs)', !(await V.page.locator('[data-campaign-templates] input, [data-campaign-templates] textarea').count()));
  await measure(V.page, 'viewer-templates@1440');
  await tab(V.page, 'Actions'); await V.page.waitForTimeout(2000);
  ok('Viewer Actions: no campaign rows', !(await V.page.locator('[data-actions] [data-row]').filter({ hasText: /Send step|Reply from/ }).count()));

  const fails = Object.entries(results.screens).filter(([, s]) => s.textFails || s.controlFails);
  ok(`ui-clarity measure: 0 failures on ${Object.keys(results.screens).length} screens`, !fails.length, JSON.stringify(fails.map(([key, s]) => [key, s.textFails, s.controlFails])));
  ok('No campaign / Actions response carried an "@"', !results.leaks.length, JSON.stringify([...new Set(results.leaks)]));
  const errs = [...J.errs, ...S.errs, ...P.errs, ...SP.errs, ...V.errs];
  ok('No page errors', !errs.length, JSON.stringify(errs.slice(0, 5)));
  const runsAfter = {}; for (const t of RUNS) runsAfter[t] = await count(t, 'business_id', B);
  const graphRuns = (await Promise.all(users.map(u => count('microsoft_sync_runs', 'user_id', u.id)))).reduce((a, b) => a + b, 0);
  ok('Real-call guard: 0 research / visit pull / sync / tidy runs, 0 Graph runs', JSON.stringify(runsBefore) === JSON.stringify(runsAfter) && graphRuns === 0, `blocked ${blocked.length} browser calls · ${JSON.stringify(runsAfter)}`);
  results.calls = { claude: 0, apollo: 0, graph: graphRuns, blocked: blocked.length, blockedUrls: [...new Set(blocked.map(x => x.replace(/^https?:\/\/[^/]+/, '').replace(/[0-9a-f-]{36}/g, ':id')))] };
  log('blocked', JSON.stringify(results.calls.blockedUrls));
} catch (e) {
  results.errors.push(e.stack || e.message);
  log('ERROR', e.message);
} finally {
  await cleanup();
  const hlAfter = await hlCounts();
  const restored = JSON.stringify(hlBefore) === JSON.stringify(hlAfter) && !(await count('businesses', 'id', B)) && !(await count('sales_outreach_campaigns', 'business_id', B));
  results.restored = restored;
  const pass = results.checks.filter(c => c.pass).length;
  fs.writeFileSync(path.join(OUT, 'seif-campaign-v1-stage3.json'), JSON.stringify(results, null, 2));
  console.log(`\n${pass}/${results.checks.length} checks passed${results.errors.length ? ` · ${results.errors.length} errors` : ''}`);
  for (const e of results.errors) console.log('ERROR:', e.split('\n').slice(0, 3).join(' | '));
  console.log(`restored: ${restored ? 'yes' : `NO - HomeLover ${JSON.stringify(hlBefore)} -> ${JSON.stringify(hlAfter)}`}`);
  process.exit(0);
}
