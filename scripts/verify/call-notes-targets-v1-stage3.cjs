// call-notes-targets-v1 REV4 Stage 3 live check. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 2 temp users (owner "Jack Zz", viewer). Seed: 5 partners (one stale Sent, one Replied, a Lockton / Lockton Inc pair, one no-double-touch Upside partner touched yesterday), 2 targets (one researching 10 d with no notes), 3 to-dos (one undated 10 d old, one 6 d old flag, one dated). API: viewer gates, run (7 suggestions, one per rule), guard, force (unique index), dismiss + snooze, accept -> one to-do only, accept pair -> open both, 409s. UI (Playwright, serves build/ - run npm run build first): page-load hook fires once, Today chip, Suggested list + Tidy now, Huddle strip, Viewer read-only, 1440 + 390 shots, report PDF prints. 0 Claude, 0 Apollo / 0 syncs. HomeLover is only COUNTED (head requests) - Tidy NEVER runs there. Teardown deletes everything. ~60-120s, cap 4 min.
// Usage: node scripts/verify/call-notes-targets-v1-stage3.cjs <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3989, tag = 'cnt3-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL_TABLES = ['business_members', 'sales_goals', 'sales_partner_events', 'sales_week_goals', 'sales_week_goal_steps', 'sales_targets', 'sales_opportunities', 'partner_domains', 'sales_suggestions', 'sales_tidy_runs'];
const OUT = process.argv[2] || '/tmp';
const made = { biz: null, users: [] };
let srv, browser, log = '', pass = 0, total = 0, blocked = 0, tidyPosts = { member: 0, viewer: 0 };
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const DAY = 864e5;
const ago = d => new Date(Date.now() - d * DAY).toISOString();
const cleanup = require('./lib/tempGuard.cjs')(removeTemp, { capMs: 235000 });

async function hl() {
  const o = {};
  for (const t of HL_TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER); o[t] = r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
  return o;
}
async function removeTemp() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  const b = made.biz;
  if (b) {
    for (const t of ['sales_suggestions', 'sales_tidy_runs', 'sales_partner_events', 'partner_domains', 'sales_week_goal_steps', 'sales_week_goals', 'sales_targets', 'sales_opportunities', 'sales_goals', 'business_members', 'auth_events']) {
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
  const { data: s } = await c.auth.signInWithPassword({ email, password });
  return { id: u.user.id, token: s.session.access_token, session: s.session };
}
let WS_NAME;
async function newPage(u, who, width, height) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage(); page.setDefaultTimeout(12000);
  page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR_FAILED|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, r => { blocked++; r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"blocked by verify script"}' }); });
  await page.route(/\/goals\/tidy\/run$/, r => { tidyPosts[who]++; r.continue(); });
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/?tab=today`); await page.waitForTimeout(3000);
  return { page, errs };
}
async function navSales(page, compact) {
  const menu = async () => { if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); } };
  await menu(); await page.getByLabel('Workspace').selectOption({ label: WS_NAME }); await page.waitForTimeout(2500);
  await menu(); await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(4000);
}
const drawerSel = 'aside[aria-labelledby="task-drawer-title"]';
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: 'disabled', caret: 'hide' });
const tab = (page, name) => page.locator('#workspace-header-tabs').getByRole('button', { name }).first().click();

(async () => {
  const hlBefore = await hl(); const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  try {
    WS_NAME = `ZZ Tidy ${tag.slice(-4)}`;
    const T = made.biz = ins(await svc.from('businesses').insert({ name: WS_NAME, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-jack@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const M = await user('Jack Zz', 'owner'), V = await user('Viewer Zz', 'viewer');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const mondayOf = d => new Date(Date.parse(`${d}T12:00:00Z`) - ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
    const monday = mondayOf(today), oldMonday = mondayOf(ago(10).slice(0, 10));
    const partner = (name, extra) => ({ business_id: T, goal_type: 'partnership', name, owner_user_id: M.id, pipeline_status: 'not_started', last_touch_at: null, owner_team: null, co_owner_name: null, no_double_touch: false, ...extra });
    const goals = ins(await svc.from('sales_goals').insert([
      partner('Gallagher', { pipeline_status: 'first_email_sent', last_touch_at: ago(10), category: '4. Mid-Market Benefits Brokers' }),
      partner('Aon', { pipeline_status: 'replied', last_touch_at: ago(2) }),
      partner('Lockton', {}), partner('Lockton Inc', {}),
      partner('Mercer', { pipeline_status: 'in_sequence', last_touch_at: ago(1), no_double_touch: true, owner_team: 'upside', co_owner_name: 'Brad' }),
    ]).select());
    const gid = n => goals.find(g => g.name === n).id;
    ins(await svc.from('sales_partner_events').insert({ business_id: T, goal_id: gid('Mercer'), event: 'touch', touch_type: 'email', contact_names: [], source: 'manual', by_user: M.id, at: ago(1), meta: { direction: 'sent' } }).select());
    const targets = ins(await svc.from('sales_targets').insert([
      { business_id: T, name: 'Fundrise', kind: 'partner', status: 'researching', created_by: M.id, created_at: ago(10), research_notes: null, evidence: 'renter platforms' },
      { business_id: T, name: 'Deloitte', kind: 'employer', status: 'researching', created_by: M.id, created_at: ago(10), research_notes: 'Person: Ana Example' },
    ]).select());
    const tid = n => targets.find(t => t.name === n).id;
    // Bulk inserts need one column set per row (a missing key becomes NULL).
    const todo = (text, extra) => ({ business_id: T, kind: 'todo', text, status: 'open', week_start: oldMonday, owner_user_id: M.id, created_by: M.id, flagged_by: null, created_at: ago(10), category: null, prospect_contact_id: null, contacts: [], due_date: null, ...extra });
    const todos = ins(await svc.from('sales_week_goals').insert([
      todo('Call Pat about the pilot', {}),
      todo('Follow up: Pat Example · Gallagher', { flagged_by: M.id, created_at: ago(6), category: 'Huddle follow-ups', prospect_contact_id: 'zz-c1', contacts: ['Pat Example', 'Gallagher'] }),
      todo('Dated to-do', { week_start: monday, created_at: new Date().toISOString(), due_date: today }),
    ]).select());
    console.log(`seed: workspace ${T}, ${goals.length} partners, 1 touch event, ${targets.length} targets, ${todos.length} to-dos (1 flag)`);

    srv = spawn('node', ['--dns-result-order=ipv4first', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`port ${PORT}`); i++) await wait(250);
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${T}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `prospector_at=${encodeURIComponent(u.token)}` }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const count = async (t, extra = q => q) => (await extra(svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', T))).count;
    const rows = async t => ins(await svc.from(t).select('*').eq('business_id', T));

    console.log('--- gates + first run');
    ok('viewer cannot run Tidy (403)', (await call(V, 'POST', '/tidy/run', { trigger: 'test' })).status === 403);
    const v0 = await call(V, 'GET', '/suggestions');
    ok('viewer GET suggestions 200, empty, no run yet', v0.status === 200 && v0.body.suggestions?.length === 0 && v0.body.last_run === null, JSON.stringify(v0.body).slice(0, 120));
    ok('bad trigger -> 400', (await call(M, 'POST', '/tidy/run', { trigger: 'cron' })).status === 400);
    const r1 = await call(M, 'POST', '/tidy/run', { trigger: 'test' });
    ok('first run: ran, 7 created (one per rule)', r1.status === 200 && r1.body.ran === true && r1.body.created === 7 && Object.values(r1.body.run?.counts?.by_kind || {}).every(n => n === 1) && Object.keys(r1.body.run.counts.by_kind).length === 7, JSON.stringify(r1.body).slice(0, 240));
    let sugg = await rows('sales_suggestions');
    const by = kind => sugg.find(s => s.kind === kind);
    ok('suggestions name the seeded records', by('follow_up')?.text === 'Follow up Gallagher' && by('reply_task')?.text === 'Reply/prep task for Aon' && by('duplicate')?.text === 'Possible duplicate: Lockton / Lockton Inc' && by('check_co_owner')?.text === 'Check with Brad about Mercer' && by('research_or_drop')?.text === 'Research Fundrise or drop' && by('set_a_date')?.text === 'Set a date or drop: Call Pat about the pilot' && by('flag_cold')?.text === 'Flag Pat Example is going cold', sugg.map(s => s.text).join(' | '));
    ok('pair row carries both Lockton ids, id-ordered', by('duplicate')?.ref_type === 'pair' && [by('duplicate').ref_id, by('duplicate').ref_id2].sort().join() === [gid('Lockton'), gid('Lockton Inc')].sort().join() && by('duplicate').ref_id < by('duplicate').ref_id2);
    const l1 = await call(M, 'GET', '/suggestions');
    ok('GET suggestions: 7 proposed, last_run ok/test with counts', l1.body.suggestions?.length === 7 && l1.body.last_run?.status === 'ok' && l1.body.last_run.trigger === 'test' && l1.body.last_run.counts.proposed === 7);

    console.log('--- guard + force + the index');
    const r2 = await call(M, 'POST', '/tidy/run', { trigger: 'test' });
    ok('second run today refused by the guard (ran: false, last_run)', r2.status === 200 && r2.body.ran === false && /already ran/.test(r2.body.reason) && r2.body.last_run?.id === r1.body.run.id && (await count('sales_tidy_runs')) === 1, JSON.stringify(r2.body).slice(0, 160));
    const r3 = await call(M, 'POST', '/tidy/run', { trigger: 'test', force: true });
    ok('forced run adds nothing (7 skipped), writes a second run row', r3.body.ran === true && r3.body.created === 0 && r3.body.skipped === 7 && (await count('sales_suggestions')) === 7 && (await count('sales_tidy_runs')) === 2, JSON.stringify(r3.body).slice(0, 160));
    const dup = by('follow_up');
    const dupIns = await svc.from('sales_suggestions').insert({ business_id: T, kind: dup.kind, ref_type: dup.ref_type, ref_id: dup.ref_id, ref_id2: null, text: dup.text, status: 'proposed' });
    ok('partial unique index refuses a second proposed row for the same key (23505)', dupIns.error?.code === '23505', JSON.stringify(dupIns.error));
    const accIns = ins(await svc.from('sales_suggestions').insert({ business_id: T, kind: dup.kind, ref_type: dup.ref_type, ref_id: dup.ref_id, ref_id2: null, text: dup.text, status: 'accepted', decided_at: ago(30) }).select());
    ok('…but an accepted row with the same key is allowed (the index is partial on proposed)', accIns.length === 1);
    await svc.from('sales_suggestions').delete().eq('id', accIns[0].id);

    console.log('--- dismiss / snooze / accept');
    const d1 = await call(M, 'POST', `/suggestions/${by('follow_up').id}/dismiss`, {});
    const until = Date.parse(d1.body.suggestion?.dismissed_until || 0) - Date.now();
    ok('dismiss -> dismissed, dismissed_until ≈ +7 d, decided_by', d1.status === 200 && d1.body.suggestion.status === 'dismissed' && until > 6.9 * DAY && until < 7.1 * DAY && d1.body.suggestion.decided_by === M.id, JSON.stringify(d1.body).slice(0, 160));
    const s1 = await call(M, 'POST', `/suggestions/${by('reply_task').id}/snooze`, {});
    ok('snooze -> same parking (dismissed, +7 d)', s1.status === 200 && s1.body.suggestion.status === 'dismissed' && !!s1.body.suggestion.dismissed_until);
    ok('viewer cannot dismiss (403)', (await call(V, 'POST', `/suggestions/${by('set_a_date').id}/dismiss`, {})).status === 403);
    const r4 = await call(M, 'POST', '/tidy/run', { trigger: 'test', force: true });
    ok('forced run after parking re-creates neither (still 7 rows, 7 skipped)', r4.body.created === 0 && r4.body.skipped === 7 && (await count('sales_suggestions')) === 7, JSON.stringify(r4.body).slice(0, 120));
    const before = { goals: await rows('sales_goals'), targets: await rows('sales_targets'), events: await count('sales_partner_events'), todos: await count('sales_week_goals'), opps: await count('sales_opportunities') };
    const a1 = await call(M, 'POST', `/suggestions/${by('research_or_drop').id}/accept`, {});
    const td = a1.body.todo;
    ok('accept research -> 200 with ONE open to-do linked to the target, due +3 d, this week, category Tidy, owned by the clicker', a1.status === 200 && td && td.status === 'open' && td.kind === 'todo' && td.link_type === 'target' && td.link_id === tid('Fundrise') && td.week_start === monday && td.category === 'Tidy' && td.owner_user_id === M.id && td.text === 'Research Fundrise or drop' && (Date.parse(td.due_date) - Date.parse(today)) === 3 * DAY, JSON.stringify(a1.body).slice(0, 200));
    const after = { goals: await rows('sales_goals'), targets: await rows('sales_targets'), events: await count('sales_partner_events'), todos: await count('sales_week_goals'), opps: await count('sales_opportunities') };
    ok('accept wrote nothing else: partners + targets byte-identical, events/opps unchanged, exactly +1 to-do', JSON.stringify(before.goals) === JSON.stringify(after.goals) && JSON.stringify(before.targets) === JSON.stringify(after.targets) && before.events === after.events && before.opps === after.opps && after.todos === before.todos + 1);
    ok('suggestion now accepted with decided_at/by', a1.body.suggestion.status === 'accepted' && !!a1.body.suggestion.decided_at && a1.body.suggestion.decided_by === M.id);
    ok('accept again -> 409', (await call(M, 'POST', `/suggestions/${by('research_or_drop').id}/accept`, {})).status === 409);
    const a2 = await call(M, 'POST', `/suggestions/${by('duplicate').id}/accept`, {});
    ok('accept pair -> no to-do, open = both Lockton ids', a2.status === 200 && a2.body.todo === null && [...a2.body.open].sort().join() === [gid('Lockton'), gid('Lockton Inc')].sort().join() && (await count('sales_week_goals')) === before.todos + 1, JSON.stringify(a2.body).slice(0, 160));
    ok('unknown id -> 404', (await call(M, 'POST', `/suggestions/${HOMELOVER}/accept`, {})).status === 404);
    const l2 = await call(V, 'GET', '/suggestions');
    ok('list shows the 3 still-proposed rows (set a date · ownership · flag)', l2.body.suggestions?.length === 3 && l2.body.suggestions.map(s => s.kind).sort().join() === 'check_co_owner,flag_cold,set_a_date');

    console.log('--- UI');
    const build = fs.readdirSync(`${ROOT}/build/static/js`).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('\n');
    ok('bundle marker: prospector_tidy_ran_ + "Tidy now" + "from Tidy" + "Nothing suggested" are in build/', build.includes('prospector_tidy_ran_') && build.includes('Tidy now') && build.includes('from Tidy') && build.includes('Nothing suggested'));
    browser = await chromium.launch();
    const runsBeforeUi = await count('sales_tidy_runs');
    for (const [width, height, compact] of [[1440, 900, false], [390, 844, true]]) {
      const postsBefore = tidyPosts.member;
      const { page, errs } = await newPage(M, 'member', width, height);
      await navSales(page, compact);
      const stored = await page.waitForFunction(k => localStorage.getItem(k), `prospector_tidy_ran_${T}`, { timeout: 8000 }).then(h => h.jsonValue()).catch(() => null);
      ok(`${width}: page-load hook posted tidy/run exactly once and stored today's LA date`, tidyPosts.member - postsBefore === 1 && stored === today, `posts ${tidyPosts.member - postsBefore} stored ${stored}`);
      const chip = page.locator('[data-today-chips] button', { hasText: 'Suggested' });
      await chip.waitFor();
      ok(`${width}: Today chip "✦ Suggested (3)"`, /Suggested \(3\)/.test((await chip.innerText()).trim()), await chip.innerText());
      await chip.click();
      const drawer = page.locator(drawerSel);
      await drawer.waitFor(); await drawer.getByRole('region', { name: 'Suggested' }).waitFor(); await page.waitForTimeout(600);
      ok(`${width}: chip opens the drawer on Suggested - 3 rows, pill pressed, last run shown`, (await drawer.locator('li[data-suggestion-id]').count()) === 3 && (await drawer.getByRole('button', { name: /^✦ Suggested/ }).getAttribute('aria-pressed')) === 'true' && (await drawer.getByText(/^Tidy ran /).count()) === 1);
      ok(`${width}: Member sees Accept + Dismiss on each row and Tidy now`, (await drawer.getByRole('button', { name: 'Accept → to-do' }).count()) === 3 && (await drawer.getByRole('button', { name: 'Dismiss · 7 d' }).count()) === 3 && (await drawer.getByRole('button', { name: 'Tidy now' }).count()) === 1);
      await shot(page, `cnt3-${width}-suggested-list`);
      if (!compact) {
        await drawer.getByRole('button', { name: 'Tidy now' }).click();
        await drawer.getByText('Tidy: nothing new').waitFor();
        ok('1440: Tidy now forces a run (nothing new; one more run row)', (await count('sales_tidy_runs')) === runsBeforeUi + 1);
        await drawer.getByRole('button', { name: 'Close tasks' }).click(); await page.waitForTimeout(300);
      } else {
        await drawer.getByRole('button', { name: 'Close tasks' }).click(); await page.waitForTimeout(300);
      }
      await tab(page, /^Huddle/); await page.waitForTimeout(2500);
      const strip = page.locator('[data-suggested-strip]');
      ok(`${width}: Huddle strip "✦ 3 suggestions from Tidy"`, (await strip.count()) === 1 && /3 suggestions from Tidy/.test(await strip.innerText()), await strip.innerText().catch(() => 'missing'));
      await shot(page, `cnt3-${width}-huddle-strip`);
      await strip.getByRole('button', { name: 'Open →' }).click();
      await page.locator(drawerSel).getByRole('region', { name: 'Suggested' }).waitFor();
      ok(`${width}: strip Open opens the drawer on Suggested`, true);
      ok(`${width}: no sideways scroll`, await noSideScroll(page));
      ok(`${width}: 0 console errors`, !errs.length, errs.join(' | '));
      await page.context().close();
    }
    const { page: rp, errs: rerrs } = await newPage(M, 'member', 1440, 900);
    await navSales(rp, false);
    await tab(rp, /^Reports/); await rp.waitForTimeout(2500);
    await rp.pdf({ path: `${OUT}/cnt3-report.pdf`, landscape: true });
    ok('Weekly report PDF still prints', fs.statSync(`${OUT}/cnt3-report.pdf`).size > 1000);
    ok('reports page: 0 console errors', !rerrs.length, rerrs.join(' | '));
    await rp.context().close();

    const { page: vp, errs: verrs } = await newPage(V, 'viewer', 1440, 900);
    await navSales(vp, false);
    await tab(vp, /^Huddle/); await vp.waitForTimeout(2500);
    const vstrip = vp.locator('[data-suggested-strip]');
    ok('viewer: sees the strip count', (await vstrip.count()) === 1 && /3 suggestions/.test(await vstrip.innerText()));
    await vstrip.getByRole('button', { name: 'Open →' }).click();
    const vd = vp.locator(drawerSel); await vd.getByRole('region', { name: 'Suggested' }).waitFor(); await vp.waitForTimeout(400);
    ok('viewer: list rows, no Accept / Dismiss / Tidy now, read-only note', (await vd.locator('li[data-suggestion-id]').count()) === 3 && (await vd.getByRole('button', { name: /Accept|Dismiss|Tidy now/ }).count()) === 0 && (await vd.getByText('You have view access, so suggestions are read-only.').count()) === 1);
    await shot(vp, 'cnt3-1440-viewer-suggested');
    ok('viewer: page-load hook never fired', tidyPosts.viewer === 0, String(tidyPosts.viewer));
    ok('viewer: 0 console errors', !verrs.length, verrs.join(' | '));
    await vp.context().close();
    ok('0 sync/Apollo requests reached the server', !/apollo\.io|\[sync\]/i.test(log), `blocked ${blocked}`);
  } catch (e) {
    ok('script ran without throwing', false, e.stack?.split('\n').slice(0, 3).join(' | ') || e.message);
  } finally {
    await cleanup();
    const left = await svc.from('businesses').select('id', { count: 'exact', head: true }).eq('id', made.biz);
    const profiles = await svc.from('profiles').select('id', { count: 'exact', head: true }).in('id', made.users.length ? made.users : ['00000000-0000-0000-0000-000000000000']);
    console.log(`teardown: workspace left ${left.count}, temp profiles left ${profiles.count}`);
    const hlAfter = await hl();
    const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
    ok(`HomeLover counts identical (${HL_TABLES.length} tables, incl. sales_tidy_runs = ${hlAfter.sales_tidy_runs})`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
    console.log(`${pass}/${total} passed · ${Math.round((Date.now() - t0) / 1000)}s · Claude 0 · Apollo 0`);
    process.exit(pass === total ? 0 : 1);
  }
})();
