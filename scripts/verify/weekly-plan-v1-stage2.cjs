// SUPERSEDED (sales-ia-v2 Stage 5): the v1 Today page (Your day / Focus 5 strip / glance / viewer cards) was replaced by the Actions list - do not run.
// weekly-plan-v1 Stage 2 - UI shots + click-through. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 2 temp users (member-owner M "Plan Tester", viewer V). Seed: 3 partners, 2 open to-dos for M this week. 0 Claude calls (propose is answered in the browser by a fixture whose ids are the seeded rows), 0 Apollo (any /sync request is refused in the browser and counted). ONE real Save into the temp workspace (5 commitments + linked to-do), one Focus check + uncheck. HomeLover is only COUNTED (15 tables, head requests). Teardown deletes everything. ~90s, cap 4 min.
// Usage: node scripts/verify/weekly-plan-v1-stage2.cjs <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3984, tag = 'wp2-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL_TABLES = ['business_members', 'accounts', 'projects', 'sales_goals', 'sales_partner_events', 'sales_week_goals', 'sales_week_goal_steps', 'sales_week_plans', 'sales_email_messages', 'sales_email_activity', 'sales_prospect_state', 'partner_contacts', 'microsoft_messages', 'microsoft_events'];
const OUT = process.argv[2] || '/tmp';
const made = { biz: null, users: [] };
let srv, browser, pass = 0, total = 0, syncBlocked = 0, proposeCalls = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const cleanup = require('./lib/tempGuard.cjs')(removeTemp, { capMs: 240000 });

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
const WEEK = new Date(Date.parse(`${today}T12:00:00Z`) - ((dow + 6) % 7) * 864e5).toISOString().slice(0, 10);
const planDay = [1, 2].includes(dow);

async function hl() {
  const o = { businesses: (await svc.from('businesses').select('*', { count: 'exact', head: true }).eq('id', HOMELOVER)).count };
  for (const t of HL_TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER); o[t] = r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
  return o;
}
async function removeTemp() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  const b = made.biz;
  if (b) {
    await svc.from('sales_week_goals').update({ carried_from_id: null, plan_id: null }).eq('business_id', b);
    for (const t of ['sales_week_goal_steps', 'sales_week_goals', 'sales_week_plans', 'sales_goals', 'business_members', 'auth_events']) {
      const r = await svc.from(t).delete().eq('business_id', b);
      if (r.error) console.log(`cleanup ${t}: ${r.error.message}`);
    }
  }
  for (const u of made.users) { await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  if (b) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(name, role) {
  const email = `${tag}-${name.split(' ')[0].toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: name, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: made.biz, email, name, user_id: u.user.id, role }).select());
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  return { id: u.user.id, session: (await c.auth.signInWithPassword({ email, password })).data.session };
}
async function newPage(u, width, height, fixture) {
  const errs = [];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(10000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, r => { syncBlocked++; r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"blocked by verify script"}' }); });
  await page.route(/\/goals\/week\/plan\/propose$/, r => { proposeCalls++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }); });
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(3000);
  return { page, errs };
}
let WS_NAME;
async function navSales(page, compact) {
  const menu = async () => { if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); } };
  await menu(); await page.getByLabel('Workspace').selectOption({ label: WS_NAME }); await page.waitForTimeout(3000);
  // dispatchEvent: see shell-facelift-v1-stage2.cjs nav() - an invisible fixed overlay can swallow sidebar clicks.
  await menu(); await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(4500);
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/wp2-${name}.png`, fullPage: false });
const drawer = page => page.locator('aside[aria-labelledby="plan-week-title"]');
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  const hlBefore = await hl(); const t0 = Date.now();
  try {
    made.biz = ins(await svc.from('businesses').insert({ name: `ZZ Plan UI ${tag.slice(-4)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-plan@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const B = made.biz; WS_NAME = `ZZ Plan UI ${tag.slice(-4)}`;
    const M = await user('Plan Tester', 'owner'), V = await user('View Tester', 'viewer');
    const [UP, SC, MA] = ins(await svc.from('sales_goals').insert([
      { business_id: B, goal_type: 'partnership', name: 'ZZ Upside', pipeline_status: 'meeting_set', owner_user_id: M.id, tier: '1' },
      { business_id: B, goal_type: 'partnership', name: 'ZZ Solidcore', pipeline_status: 'replied', owner_user_id: M.id, tier: '2' },
      { business_id: B, goal_type: 'partnership', name: 'ZZ Marriott', pipeline_status: 'first_email_sent', owner_user_id: M.id, tier: '3' },
    ]).select());
    const [deck] = ins(await svc.from('sales_week_goals').insert([
      { business_id: B, week_start: WEEK, kind: 'todo', status: 'open', text: 'ZZ Finish the Norton deck', owner_user_id: M.id, created_by: M.id },
      { business_id: B, week_start: WEEK, kind: 'todo', status: 'open', text: 'ZZ Update the pricing sheet', owner_user_id: M.id, created_by: M.id },
    ]).select());
    const p = (rank, text, reason, extra) => ({ rank, text, reason, kind: 'commitment', source: 'prompt', link_type: null, link_id: null, existing_todo_id: null, due_date: null, effort_min: null, link_name: null, existing_text: null, ...extra });
    const fixture = {
      week_start: WEEK, owner_user_id: M.id, prompt: 'fixture',
      inputs: { week_start: WEEK, owner_user_id: M.id, sections: {}, counts: {}, trimmed: {}, chars: 0 },
      inputs_summary: { this_week_commitments: 0, todos: 2, replies_waiting: 1, partners: 3, flags: 0, last_week_done: 3, last_week_total: 5, trimmed: {} },
      proposals: [
        p(1, 'Book the Solidcore December call', 'Solidcore replied Oct 9 and is at Replied - the warmest open thread.', { source: 'partner', link_type: 'partner', link_id: SC.id, link_name: 'ZZ Solidcore' }),
        p(2, 'Send Upside the intro list', 'Upside is at Meeting set; next step "Send intro list" is still open.', { source: 'partner', link_type: 'partner', link_id: UP.id, link_name: 'ZZ Upside' }),
        p(3, 'Finish the Norton deck', 'Open to-do since this week; needed before the Norton meeting.', { source: 'todo', existing_todo_id: deck.id, existing_text: deck.text }),
        p(4, '100 cold emails to gym owners', 'Last week 3 of 5 commitments done; sending is the gap.', { source: 'last_week' }),
        p(5, 'Pause the Marriott sequence', 'Marriott untouched 70 days at First email sent.', { source: 'partner', link_type: 'partner', link_id: MA.id, link_name: 'ZZ Marriott' }),
        p(6, 'Draft pilot one-pager for Upside', 'Supports the Upside meeting.', { kind: 'todo', link_type: 'partner', link_id: UP.id, link_name: 'ZZ Upside', due_date: WEEK }),
      ],
    };
    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
    browser = await chromium.launch();

    // 1440 - nudge, empty drawer, proposals, real save, ✦ rows, Focus strip
    const D = await newPage(M, 1440, 1000, fixture);
    await navSales(D.page, false);
    const nudge = D.page.getByText(/No plan for .* week yet/);
    ok(`nudge ${planDay ? 'shows (Mon/Tue, no plan)' : 'hidden (not Mon/Tue)'}`, (await nudge.count() > 0) === planDay);
    if (planDay) await shot(D.page, '1440-goals-nudge');
    await D.page.getByRole('button', { name: 'Plan this week' }).first().click();
    await drawer(D.page).waitFor();
    ok('drawer says who and which week', /Planning for Plan · week of/.test(await drawer(D.page).innerText()));
    await shot(D.page, '1440-drawer-empty');
    await D.page.getByLabel('What needs to happen this week?').fill('Upside intros, Solidcore December call, 100 cold, pause Marriott');
    await drawer(D.page).getByRole('button', { name: 'Propose' }).click();
    await drawer(D.page).getByRole('list', { name: 'Proposals' }).waitFor();
    const boxes = await drawer(D.page).getByRole('checkbox').evaluateAll(els => els.map(e => e.checked));
    ok('ranks 1-5 pre-ticked, 6 not', boxes.slice(0, 5).every(Boolean) && boxes[5] === false, JSON.stringify(boxes));
    const dText = await drawer(D.page).innerText();
    ok('count chips + link chip + already-on-list', ['2 to-dos', '1 replies waiting', 'last week 3/5', '→ ZZ Solidcore', 'already on your list', '5 of 5'].every(t => dText.includes(t)));
    await shot(D.page, '1440-drawer-proposals');
    await drawer(D.page).getByRole('checkbox', { name: 'Keep Draft pilot one-pager for Upside' }).check();
    await drawer(D.page).getByRole('button', { name: 'Save' }).click();
    await D.page.getByText('Focus 5 saved').waitFor();
    ok('toast "Focus 5 saved" and drawer closed', await drawer(D.page).count() === 0);
    const rows = ins(await svc.from('sales_week_goals').select('id,kind,text,plan_id,plan_rank,plan_reason,link_type,link_id,status').eq('business_id', B));
    const planned = rows.filter(r => r.kind === 'commitment' && r.plan_id);
    const deckRow = rows.find(r => r.id === deck.id);
    ok('DB: 5 planned commitments with rank + reason', planned.length === 5 && planned.every(r => r.plan_rank && r.plan_reason), JSON.stringify(planned.map(r => r.plan_rank)));
    ok('DB: existing to-do linked to its commitment, not copied', rows.filter(r => r.text === deck.text).length === 1 && deckRow.link_type === 'commitment' && planned.some(r => r.id === deckRow.link_id));
    ok('DB: supporting to-do saved with its partner link', rows.some(r => r.kind === 'todo' && r.text === 'Draft pilot one-pager for Upside' && r.link_type === 'partner' && r.link_id === UP.id && r.plan_id));
    await D.page.getByLabel('Planned').nth(4).waitFor();
    const stars = await D.page.getByLabel('Planned').count();
    ok('Goals: ✦ on the 5 planned commitments', stars === 5, String(stars));
    ok('Goals: hover shows the reason', await D.page.getByTitle(/Solidcore replied Oct 9/).count() === 1);
    await D.page.locator('#goals-sec-s15').scrollIntoViewIfNeeded(); await D.page.waitForTimeout(300);
    await shot(D.page, '1440-goals-stars');
    ok('nudge gone after a plan exists', await nudge.waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false));

    await D.page.getByRole('button', { name: 'Pipeline', exact: true }).first().click(); await D.page.waitForTimeout(800); await D.page.getByRole('button', { name: 'People', exact: true }).first().click(); await D.page.waitForTimeout(3500);
    const focus = D.page.getByRole('region', { name: 'Focus' });
    ok('Huddle: Focus strip with 5 rows', await focus.getByRole('checkbox').count() === 5);
    ok('Huddle: link chips come from the plan proposals', /→ ZZ Solidcore[\s\S]*→ ZZ Upside[\s\S]*→ ZZ Marriott/.test(await focus.innerText()));
    await shot(D.page, '1440-huddle-focus');
    const first = planned.find(r => r.plan_rank === 1);
    await focus.getByRole('checkbox').first().click(); await D.page.waitForTimeout(1500);
    ok('Huddle: checking marks the commitment done in the DB', ins(await svc.from('sales_week_goals').select('status').eq('id', first.id).single()).status === 'done');
    await focus.getByRole('checkbox').first().click(); await D.page.waitForTimeout(1500);
    ok('Huddle: unchecking puts it back open', ins(await svc.from('sales_week_goals').select('status').eq('id', first.id).single()).status === 'open');
    ok('1440: 0 console errors', D.errs.length === 0, D.errs.join(' | '));

    // 390
    const P = await newPage(M, 390, 844, fixture);
    await navSales(P.page, true);
    ok('390 Goals: ✦ rows', await P.page.getByLabel('Planned').nth(4).waitFor().then(async () => await P.page.getByLabel('Planned').count() === 5, () => false));
    await P.page.locator('#goals-sec-s15').scrollIntoViewIfNeeded(); await P.page.waitForTimeout(300);
    await shot(P.page, '390-goals-stars');
    await P.page.getByRole('button', { name: 'Plan this week' }).first().click(); await drawer(P.page).waitFor();
    await shot(P.page, '390-drawer-empty');
    await P.page.getByLabel('What needs to happen this week?').fill('Replan check');
    await drawer(P.page).getByRole('button', { name: 'Propose' }).click();
    await drawer(P.page).getByRole('list', { name: 'Proposals' }).waitFor();
    ok('390 drawer: replace toggle shows (planned exist), off', !(await P.page.getByLabel("Replace this week's planned commitments").isChecked()));
    ok('390 drawer: no sideways scroll', await noSideScroll(P.page));
    await shot(P.page, '390-drawer-proposals');
    await drawer(P.page).getByRole('button', { name: 'Close plan' }).click();
    await P.page.getByRole('button', { name: 'Pipeline', exact: true }).first().click(); await P.page.waitForTimeout(800); await P.page.getByRole('button', { name: 'People', exact: true }).first().click(); await P.page.waitForTimeout(3500);
    ok('390 Huddle: Focus strip', await P.page.getByRole('region', { name: 'Focus' }).getByRole('checkbox').count() === 5);
    ok('390 Huddle: no sideways scroll', await noSideScroll(P.page));
    await shot(P.page, '390-huddle-focus');
    ok('390: 0 console errors', P.errs.length === 0, P.errs.join(' | '));

    // viewer
    const W = await newPage(V, 1440, 1000, fixture);
    await navSales(W.page, false);
    ok('viewer Goals: ✦ visible, no Plan button', await W.page.getByLabel('Planned').nth(4).waitFor().then(() => true, () => false) && await W.page.getByLabel('Planned').count() === 5 && await W.page.getByRole('button', { name: 'Plan this week' }).count() === 0);
    await W.page.getByRole('button', { name: 'Pipeline', exact: true }).first().click(); await W.page.waitForTimeout(800); await W.page.getByRole('button', { name: 'People', exact: true }).first().click(); await W.page.waitForTimeout(3500);
    ok('viewer Huddle: Focus (Team -> own, none) shows nothing to act on', await W.page.getByRole('button', { name: 'Plan this week' }).count() === 0);
    ok('viewer: 0 console errors', W.errs.length === 0, W.errs.join(' | '));
    ok('0 propose calls reached the server (fixture), 0 sync calls attempted', proposeCalls === 2 && syncBlocked === 0, `propose ${proposeCalls}, sync ${syncBlocked}`);
  } catch (e) {
    ok('run', false, e.stack.split('\n').slice(0, 3).join(' '));
  } finally {
    await cleanup();
  }
  const left = { biz: (await svc.from('businesses').select('id', { count: 'exact', head: true }).eq('id', made.biz)).count, users: (await svc.from('profiles').select('id', { count: 'exact', head: true }).in('id', made.users)).count };
  const hlAfter = await hl();
  const same = JSON.stringify(hlBefore) === JSON.stringify(hlAfter);
  console.log(`teardown: temp workspace ${left.biz}, temp profiles ${left.users}`);
  console.log(`HomeLover counts ${same ? 'identical' : 'CHANGED'} (${Object.keys(hlBefore).length} tables)${same ? '' : `\n before ${JSON.stringify(hlBefore)}\n after  ${JSON.stringify(hlAfter)}`}`);
  console.log(`${pass}/${total} in ${Math.round((Date.now() - t0) / 1000)}s · shots in ${OUT}`);
  console.log(`restored: ${same && !left.biz && !left.users ? 'yes' : 'NO - see above'}`);
  process.exit(pass === total ? 0 : 1);
})();
