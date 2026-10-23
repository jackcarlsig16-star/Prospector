// company-panel-v2 REV2 Stage 3 bar 4 - the company window per L1-L9 and the per-type matrix, live in a temp workspace.
// SCOPE (declared): TEMP data only - 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local
// server only) + 2 temp users (owner, viewer) + 1 partner (a real public company name so Research has something to
// read), 1 employer, 1 target, 1 visitor, 3 prospects with made-up names (no email, no phone), 3 email messages, 4
// activity rows, 2 web visits, 1 to-do, 1 confirmed domain. HomeLover never written (counts compared). 0 Apollo (sync /
// apollo / visit-pull routes aborted in the browser; the Huddle Add to pipeline route is Supabase-only). EXACTLY ONE
// real Claude call: the Intel "Run research" click on the partner (MODELS.STANDARD, <= 3 web searches, ~$0.08) - its
// cost is read back from research_runs and printed. Runtime ~3-4 min, hard cap 420 s (tempGuard), teardown deletes
// everything. Shots -> .screenshots/company-panel-v2/cp3-*.png (never build/).
// Usage: node scripts/verify/company-panel-v2-stage3.mjs [--skip-research]   (run npm run build first)
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
const { measureScript, summarize, formatWorst } = require(ROOT + '/scripts/verify/lib/contrastMeasure.cjs');
const SKIP_RESEARCH = process.argv.includes('--skip-research');
const OUT = path.join(ROOT, '.screenshots', 'company-panel-v2');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3982;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const NAME = 'ZZ Panel Stage3';
const PARTNER = 'Patagonia';
const HL = ['research_runs', 'sales_targets', 'sales_goals', 'web_visits', 'sales_opportunities', 'sales_week_goals', 'sales_prospect_state', 'sales_suggestions', 'sales_partner_events'];
const TEMP_TABLES = ['research_runs', 'web_visits', 'visit_priority_override', 'sales_suggestions', 'sales_email_activity', 'sales_email_messages', 'sales_prospect_events', 'sales_prospect_state', 'partner_domains', 'partner_contacts', 'sales_partner_events', 'sales_opportunity_events', 'sales_week_goals', 'sales_targets', 'sales_opportunities', 'sales_goals', 'auth_events', 'business_members'];
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const hlCounts = async () => { const o = {}; for (const t of HL) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER)).count; return o; };
let srv, browser, B, users = [], pass = 0, total = 0, claudeCalls = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${String(d).slice(0, 400)}` : ''}`); };
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  if (B) {
    for (const t of TEMP_TABLES) { const r = await svc.from(t).delete().eq('business_id', B); if (r.error) console.log(`cleanup ${t}: ${r.error.message}`); }
    await svc.from('businesses').delete().eq('id', B);
  }
  for (const u of users) { await svc.from('auth_events').delete().eq('user_id', u.id); await svc.from('auth_events').delete().eq('actor_id', u.id); await svc.auth.admin.deleteUser(u.id); }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 420000 });
fs.mkdirSync(OUT, { recursive: true });
const hlBefore = await hlCounts();
console.log('HomeLover before', JSON.stringify(hlBefore));
const results = { n2: {}, contrast: {}, research: null, pipeline: null };
const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
try {
  const tag = 'cp3-' + Date.now();
  B = ins(await svc.from('businesses').insert({ name: NAME, website_url: 'https://cp3.example.com', color: '#6F8CF0', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
  const mk = async (name, role) => {
    const email = `${tag}-${role}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    await svc.from('profiles').update({ display_name: name, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
    ins(await svc.from('business_members').insert({ business_id: B, email, name, user_id: u.user.id, role }).select());
    const anon = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(sErr.message);
    const user = { id: u.user.id, session: s.session, name }; users.push(user); return user;
  };
  const owner = await mk('Owner Test', 'owner'), viewer = await mk('Viewer Test', 'viewer');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const partner = ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name: PARTNER, pipeline_status: 'replied', owner_user_id: owner.id, owner_team: 'homelover', tier: '1', channel: 'import', next_step: 'Send the one-pager', last_touch_at: ago(72) }).select('id').single());
  ins(await svc.from('sales_partner_events').insert({ business_id: B, goal_id: partner.id, event: 'touch', touch_type: 'email', contact_names: [], at: ago(72), meta: {} }).select('id'));
  ins(await svc.from('partner_domains').insert({ business_id: B, goal_id: partner.id, domain: 'patagonia.com', confirmed: true, is_primary: true, source: 'manual' }).select('id'));
  const employer = ins(await svc.from('sales_opportunities').insert({ business_id: B, organization: 'ZZ Panel Employer', org_type: 'employer', stage: 'contacted', source: 'manual', channel: 'manual', covered_lives: 1200, decision_makers: 'ZZ Decision Maker · VP People', notes: '(10/20) Named on a call' }).select('id').single());
  ins(await svc.from('sales_targets').insert({ business_id: B, name: 'ZZ Panel Target', kind: 'employer', status: 'researching', channel: 'scout', research_notes: 'People: ZZ Target Person · Head of HR', evidence: 'Opened an office' }).select('id'));
  ins(await svc.from('web_visits').insert([
    { business_id: B, pulled_on: today, company_key: 'patagonia', company_name: PARTNER, priority: 'P1', priority_rule: 'US 500+', visits_7d: 3, last_visit: today, us_500: true, top_paths: ['/pricing', '/partners'], matched_type: 'partner', matched_id: partner.id },
    { business_id: B, pulled_on: today, company_key: 'zz panel visitor', company_name: 'ZZ Panel Visitor', priority: 'P1', priority_rule: 'US 500+', visits_7d: 6, last_visit: today, us_500: true, top_paths: ['/pricing', '/employers'] },
  ]).select('id'));
  ins(await svc.from('sales_prospect_state').insert([
    { business_id: B, contact_id: 'zz-pat', name: 'ZZ Pat Lee', title: 'VP Partnerships', company: PARTNER, owner: 'jack', status: 'new', goal_id: partner.id, goal_link_via: 'name' },
    { business_id: B, contact_id: 'zz-robin', name: 'ZZ Robin Quiet', title: 'Analyst', company: PARTNER, owner: 'cyrus', status: 'new', goal_id: partner.id, goal_link_via: 'name' },
    { business_id: B, contact_id: 'zz-dana', name: 'ZZ Dana Q', title: 'CHRO', company: 'ZZ Panel Employer', owner: 'jack', status: 'contacted', opportunity_id: employer.id, opportunity_link_via: 'name' },
    { business_id: B, contact_id: 'zz-free', name: 'ZZ Free Agent', title: 'Benefits Lead', company: 'ZZ Unlisted Co', owner: 'jack', status: 'new' },
  ]).select('contact_id'));
  ins(await svc.from('sales_email_messages').insert([
    { business_id: B, apollo_message_id: 'zm-pat', contact_id: 'zz-pat', sequence_id: 'zs-1', step: 1, delivered_at: ago(100), replied: false },
    { business_id: B, apollo_message_id: 'zm-dana', contact_id: 'zz-dana', sequence_id: 'zs-1', step: 2, delivered_at: ago(120), replied: true, replied_at: ago(40), reply_class: 'willing_to_meet' },
    { business_id: B, apollo_message_id: 'zm-free', contact_id: 'zz-free', sequence_id: 'zs-1', step: 1, delivered_at: ago(100), replied: false },
  ]).select('apollo_message_id'));
  ins(await svc.from('sales_email_activity').insert([
    { business_id: B, apollo_message_id: 'zm-pat', contact_id: 'zz-pat', step: 1, event: 'open', occurred_at: ago(30) },
    { business_id: B, apollo_message_id: 'zm-pat', contact_id: 'zz-pat', step: 1, event: 'click', occurred_at: ago(20) },
    { business_id: B, apollo_message_id: 'zm-dana', contact_id: 'zz-dana', step: 2, event: 'reply', occurred_at: ago(40) },
    { business_id: B, apollo_message_id: 'zm-free', contact_id: 'zz-free', step: 1, event: 'open', occurred_at: ago(10) },
  ]).select('id'));
  const monday = (() => { const x = new Date(`${today}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); })();
  ins(await svc.from('sales_week_goals').insert({ business_id: B, week_start: monday, kind: 'todo', status: 'open', text: 'ZZ Send the deck', owner_user_id: owner.id, due_date: today, link_type: 'partner', link_id: partner.id, created_by: owner.id, contacts: [], sort_order: 0 }).select('id'));

  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }

  browser = await chromium.launch();
  async function newPage(user, { width = 1440, height = 900 } = {}) {
    const errs = [];
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
    page.on('dialog', d => d.accept());
    await page.addInitScript(([k, v, b, d]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      // actions-v2 REV2: Actions opens on the signed-in person with Housekeeping folded; these checks read the whole team, unfolded.
      localStorage.setItem('prospector_goals_owner', 'team'); localStorage.setItem('prospector_actions_folded', '[]');
      localStorage.setItem(`prospector_visits_ran_${b}`, d); localStorage.setItem(`prospector_tidy_ran_${b}`, d);
    }, [`sb-${REF}-auth-token`, JSON.stringify(user.session), B, today]);
    await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)|\/goals\/visits\/pull|\/apollo-check/, route => route.abort());
    await page.goto(`http://localhost:${PORT}/?tab=pipeline&view=companies`);
    await page.locator('#main-content').getByText(NAME).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').selectOption({ label: NAME }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    // Sales & Marketing opens on Actions since actions-home-attention-v1; this check is about Pipeline > Companies.
    await page.locator('#workspace-header-tabs, [data-sales-tabrow]').getByRole('button', { name: /^Pipeline/ }).first().dispatchEvent('click'); await page.waitForTimeout(1200);
    await page.locator('[data-sales-subviews]').getByRole('button', { name: 'Companies', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
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
    const r = a.getBoundingClientRect(); const body = a.querySelector('[data-panel-body]');
    const cols = body ? getComputedStyle(body).gridTemplateColumns.split(' ').length : 0;
    const facts = [...a.querySelectorAll('[data-facts-row] .ui-group-label')].map(e => e.textContent);
    const band = a.querySelector('[data-interest-band]');
    return { kind: a.dataset.centerWindow, w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, docW: document.documentElement.scrollWidth, asideScrollW: a.scrollWidth, cols, facts,
      band: band ? { text: band.textContent, buttons: [...band.querySelectorAll('button')].map(b => b.textContent) } : null,
      actions: [...a.querySelectorAll('[data-actions-row] button')].map(b => b.textContent), edit: [...a.querySelectorAll('[data-edit-row] label')].map(l => l.textContent),
      cards: [...a.querySelectorAll('[data-window-body] section[aria-label]')].map(s => s.getAttribute('aria-label')), people: [...a.querySelectorAll('[data-person]')].map(p => p.textContent) };
  });
  const measure = async (page, key) => {
    const m = await page.evaluate(measureScript({ scope: 'aside[data-center-window]' }));
    if (m.error) { ok(`contrast ${key}`, false, m.error); return; }
    const s = summarize(m); results.contrast[key] = s;
    ok(`contrast ${key}: 0 text < 4.5:1 and 0 controls < 3:1 inside the window (text ${s.textFails}/${s.texts}, controls ${s.controlFails}/${s.controls})`, s.textFails === 0 && s.controlFails === 0, s.worst.slice(0, 6).map(w => `${w.ratio} ${w.kind === 'text' ? `T ${w.fg} on ${w.bg}` : `C via ${w.via}`} ${w.sel} "${w.text}"`).join(' | '));
  };

  // ── 1440, owner ──
  { const { page, errs } = await newPage(owner);
    const b0 = await boxes(page);
    await page.getByRole('button', { name: PARTNER, exact: true }).click();
    const w = page.locator('aside[data-center-window]'); await w.waitFor(); await w.locator('[data-panel-body]').waitFor(); await page.waitForTimeout(600);
    const m = await win(page);
    ok(`1440 partner: two body columns (${m.cols}), window ${m.w} wide, no sideways scroll`, m.kind === 'window' && m.cols === 2 && m.docW <= m.vw && m.asideScrollW <= m.w + 1, JSON.stringify({ cols: m.cols, w: m.w, docW: m.docW }));
    ok('L2: seven labelled facts in order', JSON.stringify(m.facts) === JSON.stringify(['Stage', 'Priority', 'Owner', 'Team', 'Source', 'Last touch', 'Next step']), JSON.stringify(m.facts));
    // lead-source-v1 Stage 3: the Source fact is the lead source (not set here) with the channel small beside it.
    ok('L2: Last touch reads "<date> · Email sent", Source "Not set · via Import"', /Email sent/.test(await w.locator('[title="Last touch"]').textContent()) && /^Not set$/.test(await w.locator('[title="Source"]').textContent()) && /via Import/.test(await w.locator('[data-fact="Source"]').textContent()), await w.locator('[data-facts-row]').textContent());
    ok('L3: the band names the clicker first (click beats the 3 visits), then the visits; four buttons', !!m.band && /^ZZ Pat Lee clicked Step 1/.test(m.band.text.replace(/^Interest/, '')) && /3 site visits this week/.test(m.band.text) && JSON.stringify(m.band.buttons) === JSON.stringify(['Follow up: draft reply', 'Book meeting', 'Mark contacted', 'Not now']), JSON.stringify(m.band));
    ok('L4: labelled Actions row with the six actions and Next (secondary while the band shows) + "✦ generated"', m.actions.slice(0, 6).join('|') === 'Add note|Add to-do|Add contact|Draft email in Claude|Research|Check Apollo' && m.actions.some(a => a.startsWith('Next:')) && (await w.locator('[data-actions-row]').textContent()).includes('✦ generated'), JSON.stringify(m.actions));
    ok('L5: Edit row = Stage · Owner · Team · Priority', JSON.stringify(m.edit) === JSON.stringify(['Stage', 'Owner', 'Team', 'Priority']), JSON.stringify(m.edit));
    const stageOpts = await w.getByLabel('Stage').locator('option').allTextContents();
    ok(`L5: the Stage select lists forward moves only (${stageOpts.join(' / ')})`, stageOpts[0] === 'Replied' && !stageOpts.includes('1st email sent') && !stageOpts.includes('Not started') && stageOpts.includes('Meeting set'));
    ok('L6: cards in order - Signals & visits · Open to-dos · Waiting on them · Notes & touches · Intel · People (+ lead-source: Referred by <partner> · Source history)', m.cards.join('|') === `Signals & visits|Open to-dos|Waiting on them|Notes & touches|Intel|People|Referred by ${PARTNER}|Source history`, m.cards.join('|'));
    ok('L6 People: the clicker first with the pill, the quiet one after; no email anywhere in the window', m.people.length === 2 && m.people[0].includes('ZZ Pat Lee') && m.people[0].includes('clicked Step 1') && m.people[1].includes('ZZ Robin Quiet') && !(await w.textContent()).includes('@'), JSON.stringify(m.people));
    ok('L1: the confirmed site link + ✓ confirmed in Intel', (await w.getByRole('link', { name: 'patagonia.com ↗' }).count()) >= 1 && (await w.getByText('✓ confirmed').count()) === 1);
    await measure(page, '1440 partner');
    await shot(page, 'cp3-partner-1440');
    const b1 = await boxes(page);

    // Mark contacted (band): partner touch without a stage move; the person goes to contacted; Undo exists.
    await w.getByRole('region', { name: 'Interest' }).getByRole('button', { name: 'Mark contacted' }).click();
    await page.getByText('ZZ Pat Lee marked contacted').waitFor(); await page.waitForTimeout(800);
    const g1 = ins(await svc.from('sales_goals').select('pipeline_status, last_touch_at').eq('id', partner.id).single());
    const ev = ins(await svc.from('sales_partner_events').select('event, touch_type, to_status, contact_names').eq('goal_id', partner.id).eq('event', 'touch').order('at', { ascending: false }).limit(1));
    const pat = ins(await svc.from('sales_prospect_state').select('status').eq('business_id', B).eq('contact_id', 'zz-pat').single());
    ok('Mark contacted: an email touch naming ZZ Pat Lee, stage still Replied, last touch now, the person contacted', g1.pipeline_status === 'replied' && Date.now() - Date.parse(g1.last_touch_at) < 60e3 && ev[0]?.to_status === null && ev[0]?.touch_type === 'email' && ev[0]?.contact_names?.[0] === 'ZZ Pat Lee' && pat.status === 'contacted', JSON.stringify({ g1, ev: ev[0], pat }));
    ok('Mark contacted: the toast offers Undo', (await page.getByRole('status').filter({ hasText: 'marked contacted' }).getByRole('button', { name: 'Undo' }).count()) === 1);

    // Book meeting: next_step text, next_meeting_at untouched, one open to-do due today.
    await w.getByRole('region', { name: 'Interest' }).getByRole('button', { name: 'Book meeting' }).click();
    await page.getByText(/Next step: Book meeting with ZZ Pat Lee/).waitFor(); await page.waitForTimeout(600);
    const g2 = ins(await svc.from('sales_goals').select('next_step, next_meeting_at').eq('id', partner.id).single());
    const todos = ins(await svc.from('sales_week_goals').select('text, status, due_date, link_type, link_id').eq('business_id', B).eq('link_id', partner.id));
    ok('Book meeting: next_step set, next_meeting_at still null, one open to-do due today on the partner', g2.next_step === 'Book meeting with ZZ Pat Lee' && g2.next_meeting_at === null && todos.some(t => t.text === 'Book meeting with ZZ Pat Lee' && t.status === 'open' && t.due_date === today), JSON.stringify({ g2, todos }));
    await w.locator('[title="Next step"]').filter({ hasText: 'Book meeting with ZZ Pat Lee' }).waitFor({ timeout: 8000 }).catch(() => {});
    ok('L2: the Next step fact updated after the reload', (await w.locator('[title="Next step"]').textContent()).startsWith('Book meeting with ZZ Pat Lee'));

    // Research (the one real Claude call): Intel shows sells_to + recent.
    if (!SKIP_RESEARCH) {
      claudeCalls++;
      await w.getByRole('region', { name: 'Intel' }).getByRole('button', { name: 'Run research' }).click();
      await page.getByText(/Researching Patagonia/).waitFor();
      let run = null;
      for (let i = 0; i < 60 && !(run && run.status !== 'running'); i++) { await page.waitForTimeout(3000); run = ins(await svc.from('research_runs').select('status, cost_usd, error, result').eq('business_id', B).order('created_at', { ascending: false }).limit(1))[0] || null; }
      results.research = run && { status: run.status, cost_usd: run.cost_usd, web_searches: run.result?.web_searches ?? null, sells_to: run.result?.sells_to || null, recent: run.result?.recent || null, error: run.error || null };
      ok(`Research: one real call finished (${run?.status}, $${run?.cost_usd}, ${run?.result?.web_searches} searches); result carries sells_to and recent`, run?.status === 'done' && typeof run.result?.sells_to === 'string' && Array.isArray(run.result?.recent), JSON.stringify(results.research));
      await page.waitForTimeout(3500);
      const intel = await w.getByRole('region', { name: 'Intel' }).textContent();
      ok('L6 Intel: Sells to and Recent render after the run', /Sells to/.test(intel) && /Recent/.test(intel) && /Researched/.test(intel), intel.slice(0, 300));
      await shot(page, 'cp3-partner-intel-1440');
    } else ok('Research skipped (--skip-research)', true);

    // Open in People -> People filtered to this company (chip + only linked rows).
    await w.getByRole('region', { name: 'Signals & visits' }).getByRole('button', { name: 'Open in People →' }).click();
    await page.locator('[data-pipeline-people]').waitFor();
    await page.locator('[data-pipeline-people] [data-row], [data-pipeline-people] .ui-table__empty').first().waitFor({ timeout: 15000 }); await page.waitForTimeout(600);
    const url = new URL(page.url());
    const chip = page.getByRole('button', { name: `Remove filter Company: ${PARTNER}` });
    const names = await page.locator('[data-pipeline-people] [data-row] td:first-child').allTextContents();
    // People lists only people with email activity: of the two linked, ZZ Pat Lee (masked "ZZ L." until saved on a record) - ZZ Robin Quiet has none.
    ok(`Open in People: URL carries company=partner:<id>, the chip shows "Company: ${PARTNER}", only the linked person with activity lists (${names.join(', ')})`, url.searchParams.get('company') === `partner:${partner.id}` && (await chip.count()) === 1 && names.length === 1 && /^ZZ L\.$|ZZ Pat Lee/.test(names[0]), JSON.stringify({ company: url.searchParams.get('company'), names }));
    await shot(page, 'cp3-people-company-filter-1440');
    await chip.click(); await page.waitForTimeout(600);
    ok('Clearing the chip drops the URL param and shows everyone with activity', !new URL(page.url()).searchParams.get('company') && (await page.locator('[data-pipeline-people] [data-row]').count()) >= 3);

    // Huddle's Add to pipeline, once, from the page session: the link is marked 'pipeline'.
    const added = await page.evaluate(async ([b, c]) => { const r = await fetch(`/api/sales/${b}/prospects/${c}/pipeline`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_type: 'employer' }) }); return { status: r.status, body: await r.json().catch(() => ({})) }; }, [B, 'zz-free']);
    const free = ins(await svc.from('sales_prospect_state').select('opportunity_id, opportunity_link_via').eq('business_id', B).eq('contact_id', 'zz-free').single());
    results.pipeline = { status: added.status, link_via: free.opportunity_link_via };
    ok(`Huddle Add to pipeline (once, POST prospects/:id/pipeline): ${added.status}; opportunity_link_via = 'pipeline'`, added.status === 201 && !!free.opportunity_id && free.opportunity_link_via === 'pipeline', JSON.stringify({ added: added.body?.opportunity?.organization, free }));

    // Back to Companies for N2: nothing on the page moved after open / close.
    await page.locator('[data-sales-subviews]').getByRole('button', { name: 'Companies', exact: true }).click();
    await page.locator('[data-pipeline-companies] [data-row]').first().waitFor(); await page.waitForTimeout(1200);
    const c0 = await boxes(page);
    await page.getByRole('button', { name: 'ZZ Panel Employer', exact: true }).click();
    const e = page.locator('aside[data-center-window]'); await e.waitFor(); await e.locator('[data-panel-body]').waitFor(); await page.waitForTimeout(500);
    const me = await win(page);
    ok('employer: band names the replier, People = the linked prospect, Decision makers card', !!me.band && /ZZ Dana Q replied Step 2/.test(me.band.text) && me.people.some(p => p.includes('ZZ Dana Q') && p.includes('replied')) && me.cards.includes('Decision makers'), JSON.stringify({ band: me.band?.text, cards: me.cards }));
    await measure(page, '1440 employer');
    await shot(page, 'cp3-employer-1440');
    const c1 = await boxes(page);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const c2 = await boxes(page);
    const mv = Math.max(maxMove(c0, c1), maxMove(c0, c2)); results.n2['1440'] = mv;
    ok(`N2 1440: opening and closing the window moves nothing (max ${mv} px)`, mv <= 1);
    // Target + visitor windows.
    await page.getByRole('group', { name: 'Channel' }).getByRole('button', { name: /^Targets/ }).click(); await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'ZZ Panel Target', exact: true }).click(); await page.locator('aside[data-center-window] [data-panel-body]').waitFor(); await page.waitForTimeout(400);
    const mt = await win(page);
    ok('target: facts Stage · Team · Source · Last touch; Edit = Stage + Team; Promote ▾ + Not a fit; People = the research_notes line', mt.facts.join('|') === 'Stage|Team|Source|Last touch' && mt.edit.join('|') === 'Stage|Team' && mt.actions.includes('Promote ▾') && mt.actions.includes('Not a fit') && mt.people.length === 0 && (await page.locator('aside[data-center-window]').getByText('ZZ Target Person · Head of HR', { exact: true }).count()) === 1, JSON.stringify({ facts: mt.facts, edit: mt.edit, actions: mt.actions }));
    await measure(page, '1440 target');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.getByRole('group', { name: 'Channel' }).getByRole('button', { name: /^Website visitors/ }).click(); await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'ZZ Panel Visitor', exact: true }).click(); await page.locator('aside[data-center-window] [data-panel-body]').waitFor(); await page.waitForTimeout(400);
    const mvis = await win(page);
    ok('visitor: facts Priority · Source · Last visit; band = the visits + Add to pipeline ▾ only (FIX loop-quickfixes Q3); Edit = Priority only; Add to pipeline ▾', mvis.facts.join('|') === 'Priority|Source|Last visit' && !!mvis.band && /6 site visits this week/.test(mvis.band.text) && JSON.stringify(mvis.band.buttons) === JSON.stringify(['Add to pipeline ▾']) && mvis.edit.join('|') === 'Priority' && mvis.actions.includes('Add to pipeline ▾'), JSON.stringify({ facts: mvis.facts, band: mvis.band, edit: mvis.edit }));
    await measure(page, '1440 visitor');
    await shot(page, 'cp3-visitor-1440');
    await page.keyboard.press('Escape');
    ok('1440: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }

  // ── 1000: one column ──
  { const { page, errs } = await newPage(owner, { width: 1000, height: 800 });
    await page.getByRole('button', { name: PARTNER, exact: true }).click();
    await page.locator('aside[data-center-window] [data-panel-body]').waitFor(); await page.waitForTimeout(500);
    const m = await win(page);
    ok(`1000: the window (${m.w} wide) stacks to one column, no sideways scroll`, m.kind === 'window' && m.cols === 1 && m.docW <= m.vw && m.asideScrollW <= m.w + 1, JSON.stringify({ cols: m.cols, w: m.w, docW: m.docW, asideScrollW: m.asideScrollW }));
    await measure(page, '1000 partner');
    await shot(page, 'cp3-partner-1000');
    ok('1000: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }

  // ── 390: sheet ──
  { const { page, errs } = await newPage(owner, { width: 390, height: 844 });
    await page.getByRole('button', { name: PARTNER, exact: true }).scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
    const b0 = await boxes(page);
    await page.getByRole('button', { name: PARTNER, exact: true }).click();
    await page.locator('aside[data-center-window] [data-panel-body]').waitFor(); await page.waitForTimeout(500);
    const m = await win(page);
    ok(`390: full-screen sheet ${m.w}×${m.h}, one column, Actions wrap, no sideways scroll (doc ${m.docW}, aside ${m.asideScrollW})`, m.kind === 'sheet' && m.w === 390 && m.cols === 1 && m.docW <= 390 && m.asideScrollW <= 390, JSON.stringify(m));
    await measure(page, '390 partner');
    await shot(page, 'cp3-partner-390');
    const b1 = await boxes(page);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const b2 = await boxes(page);
    const mv = Math.max(maxMove(b0, b1), maxMove(b0, b2)); results.n2['390'] = mv;
    ok(`N2 390: nothing moves (max ${mv} px); 0 page errors`, mv <= 1 && !errs.length, errs.join(' | '));
    await page.context().close();
  }

  // ── Viewer ──
  { const { page, errs } = await newPage(viewer);
    await page.getByRole('button', { name: PARTNER, exact: true }).click();
    const w = page.locator('aside[data-center-window]'); await w.locator('[data-panel-body]').waitFor(); await page.waitForTimeout(500);
    const m = await win(page);
    const buttons = await w.locator('button').allTextContents();
    ok('Viewer: facts + body only - band text with no buttons, no Actions / Edit rows, no ★, no + links, no Open in People, no Not this company; just ✕, Close + Open full card', !!m.band && m.band.buttons.length === 0 && m.actions.length === 0 && m.edit.length === 0 && buttons.filter(b => !['✕', 'Close', 'Open full card →'].includes(b)).length === 0, JSON.stringify(buttons));
    await measure(page, '1440 viewer');
    await shot(page, 'cp3-partner-viewer-1440');
    ok('Viewer: 0 page errors', !errs.length, errs.join(' | '));
    await page.context().close();
  }
} catch (e) {
  ok('script ran without throwing', false, e.stack?.split('\n').slice(0, 3).join(' | ') || e.message);
} finally {
  await cleanup();
  const left = B ? (await svc.from('businesses').select('id', { count: 'exact', head: true }).eq('id', B)).count : 0;
  const hlAfter = await hlCounts();
  const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
  ok(`HomeLover counts identical (${HL.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
  fs.writeFileSync(`${OUT}/cp3-stage3-numbers.json`, JSON.stringify(results, null, 2));
  for (const [k, s] of Object.entries(results.contrast)) if (s.worst.length) console.log(formatWorst(k, s));
  console.log(`\n${pass}/${total} passed · Claude calls ${claudeCalls} (${results.research ? `$${results.research.cost_usd}` : 'none'}) · Apollo 0 · restored: ${left === 0 && !diff.length ? 'yes' : 'NO'}`);
  process.exit(0);
}
