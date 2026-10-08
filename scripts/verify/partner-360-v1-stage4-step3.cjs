// partner-360-v1 Stage 4 step 3 (daily step + Apollo moves panel) check. SCOPE: TEMP workspace only for writes (2 temp users member + viewer, 5 temp partners, 6 temp partner_contacts, 1 temp replied message, 1 seeded earlier run row); HomeLover read-only (1 report line). Part A = the daily step called directly: applies proposed only (Replied + Sent), never held, by nobody, 0 calls, result shape; movesRanToday guard false -> true after a run row carries the block; a second direct call is refused by the guard inside the sync path (simulated by the guard check). Part B = one REAL local sync run (runSync, trigger 'test') on the temp workspace with the guard already satisfied -> the run row shows apollo_moves null (guard held) and the step added 0 calls; then with the guard cleared (older run) a run whose apollo_moves block has calls 0. Apollo calls in Part B come from the sync's other steps on an EMPTY temp workspace (accounts/sequences search, ~5), not from this step. Part C = API: GET apollo-touches returns last_run with undoable flags; viewer 403 on apply/dismiss; member OK of a held key with include_held -> applied + held_ok; dismiss -> note event with meta.dismissed, key never held again; undo of an automatic move hours later still allowed (no 2-min window for source apollo); undo of a manual move after the window still refused. Part D = browser 1440/390: "Apollo moves" header button (members only), panel shows last run + held rows, OK from the panel moves the partner, Undo from the panel, viewer sees no button, 0 console errors. ~3 min, cap 4 min. Serves build/ via server.js - run npm run build first. Fake emails (example.com) only; nothing here prints an email.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const OUT = process.argv[2] || '/tmp/partner-360-stage4-step3'; fs.mkdirSync(OUT, { recursive: true });
// --skip-sync: Part B's two real sync runs cost 92 + 42 Apollo calls on 2026-10-08 (a sync pulls the shared Apollo org's sequences + activity whatever the workspace) - run them only when the sync wiring itself changed.
const SKIP_SYNC = process.argv.includes('--skip-sync');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95', PORT = 3964, tag = 'p360f-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['businesses', 'business_members', 'sales_goals', 'sales_partner_events', 'partner_contacts', 'sales_email_messages', 'sales_sync_runs', 'sales_raw_snapshots', 'profiles', 'auth_events'];
const made = { users: [], biz: [] };
let srv, browser, log = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const hlSnap = async () => JSON.stringify({
  ev: (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count,
  runs: (await svc.from('sales_sync_runs').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count,
  goals: (await svc.from('sales_goals').select('id,pipeline_status,updated_at').eq('business_id', HL).eq('goal_type', 'partnership').order('id')).data,
});
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  for (const b of made.biz) {
    for (const t of ['sales_partner_events', 'partner_contacts', 'sales_email_messages', 'sales_raw_snapshots', 'sales_sync_runs', 'sales_goals', 'business_members', 'auth_events']) await svc.from(t).delete().eq('business_id', b);
  }
  for (const u of made.users) { await svc.from('business_members').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  for (const b of made.biz) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
const biz = async name => { const id = ins(await svc.from('businesses').insert({ name: `ZZ ${name} ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-${name}@example.com`, access_code: `${tag}-${name}`, features: { goals_sales: true } }).select().single()).id; made.biz.push(id); return id; };
async function user(b, name, role) {
  const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: b, email, name: `${name} Test`, user_id: u.user.id, role }).select());
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s } = await c.auth.signInWithPassword({ email, password });
  return { id: u.user.id, session: s.session, cookie: `prospector_at=${encodeURIComponent(s.session.access_token)}` };
}
let bizLabel = '';
async function newPage(u, width, height) {
  const errs = [];
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage(); page.setDefaultTimeout(8000);
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/`); await page.waitForTimeout(3000);
  return { page, errs };
}
async function navPartners(page, compact) {
  if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.getByLabel('Workspace').selectOption({ label: bizLabel }); await page.waitForTimeout(1500);
  if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
  await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).click(); await page.waitForTimeout(3000);
  const views = page.getByRole('button', { name: /^Partners/ }).first();
  if (await views.count()) { await views.click(); await page.waitForTimeout(2500); }
  await page.locator('section[aria-labelledby="h-part"]').waitFor();
}
const goalRow = async id => (await svc.from('sales_goals').select('name,pipeline_status,first_email_at,last_touch_at').eq('id', id).single()).data;
const evCount = async B => (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;

(async () => {
  const before = await snap(), hlBefore = await hlSnap();
  const T = await import(ROOT + '/api/sales/partnerApolloTouches.js');
  const SY = await import(ROOT + '/api/sales/sync.js');
  try {
    const hl = await T.dryRun(svc, HL);
    console.log(`HomeLover (read-only): proposed ${hl.proposed.length}, held ${hl.held.map(h => h.partner).join(' + ') || 'none'}, skipped ${hl.skipped.length}; last run with an apollo_moves block: ${(await T.lastRun(svc, HL))?.at || 'none yet'}`);

    const B = await biz('p360f');
    bizLabel = (await svc.from('businesses').select('name').eq('id', B).single()).data.name;
    const jack = await user(B, 'Jack', 'member'), vera = await user(B, 'Vera', 'viewer');
    const partner = async (name, pipeline_status) => ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name, pipeline_status, category: '3. PEOs', tier: '1', owner_user_id: jack.id }).select().single());
    const P1 = await partner('Reply Test', 'first_email_drafted');
    const P2 = await partner('Sequence Test', 'researching');
    const P3 = await partner('Held Bilt Test', 'not_started');
    const P4 = await partner('Held Stake Test', 'not_started');
    const P5 = await partner('Manual Test', 'researching');
    const contact = (g, id, name, sequence_added_at = null, sequence_status = sequence_added_at ? 'active' : null) => svc.from('partner_contacts').insert({ business_id: B, goal_id: g.id, apollo_contact_id: id, name, source: 'apollo', sequence_added_at, sequence_status }).select();
    ins(await contact(P1, `${tag}-c1`, 'Dana Test', '2026-09-20T12:00:00Z'));
    ins(await contact(P2, `${tag}-c2`, 'Pat Test', '2026-09-30T19:00:00Z'));
    ins(await contact(P3, `${tag}-c3`, 'Ava Test', '2026-09-30T00:28:50Z', 'paused'));
    ins(await contact(P3, `${tag}-c4`, 'Bo Test', '2026-09-29T00:28:50Z', 'paused'));
    ins(await contact(P4, `${tag}-c5`, 'Cy Test', '2026-09-30T00:47:13Z', 'paused'));
    ins(await contact(P5, `${tag}-c6`, 'Em Test'));
    ins(await svc.from('sales_email_messages').insert({ business_id: B, apollo_message_id: `${tag}-m1`, contact_id: `${tag}-c1`, replied: true, replied_seen_at: '2026-10-03T15:00:00Z', delivered_at: '2026-09-21T10:00:00Z' }).select());

    // A - the daily step, directly
    ok('A1 guard: movesRanToday false with no run row', (await T.movesRanToday(svc, B)) === false);
    const ev0 = await evCount(B);
    const daily = await T.runDailyApolloMoves(svc, B);
    ok('A2 daily step applied the 2 proposed (Replied + Sent), refused 0, held 2 (never applied), calls 0', daily.proposed === 2 && daily.applied.length === 2 && daily.refused.length === 0 && daily.held.length === 2 && daily.calls === 0 && daily.held.every(h => [P3.id, P4.id].includes(h.goal_id)), JSON.stringify({ ...daily, applied: daily.applied.map(a => [a.partner, a.to]) }));
    const g1 = await goalRow(P1.id), g2 = await goalRow(P2.id), g3 = await goalRow(P3.id);
    ok('A3 P1 replied, P2 first_email_sent, held P3 still not_started; exactly 2 event rows, by nobody (automatic)', g1.pipeline_status === 'replied' && g2.pipeline_status === 'first_email_sent' && g3.pipeline_status === 'not_started' && (await evCount(B)) - ev0 === 2
      && (await svc.from('sales_partner_events').select('by_user,source').eq('business_id', B)).data.every(e => e.by_user === null && e.source === 'apollo'));
    // A seeded run row carrying the block = "ran today"
    const seeded = ins(await svc.from('sales_sync_runs').insert({ business_id: B, trigger: 'test', status: 'success', started_at: new Date().toISOString(), finished_at: new Date().toISOString(), counts: { apollo_moves: daily } }).select().single());
    ok('A4 guard: movesRanToday true once a non-error run today carries apollo_moves', (await T.movesRanToday(svc, B)) === true);
    const last = await T.lastRun(svc, B);
    ok('A5 lastRun reads the seeded run: 2 applied, both undoable (latest on their partner), not undone, held 2, calls 0', last && last.applied.length === 2 && last.applied.every(a => a.undoable && !a.undone) && last.held.length === 2 && last.calls === 0, JSON.stringify(last && { at: last.at, applied: last.applied.map(a => [a.partner, a.undoable, a.undone]) }));

    // B - a real sync run on the temp workspace: guard holds (block null), then step inside the run
    if (!SKIP_SYNC) {
      const r1 = await SY.runSync({ businessId: B, trigger: 'manual', maxCalls: 10 });
      const c1 = r1.run?.counts || {};
      ok('B1 real sync run with the guard satisfied: apollo_moves null on the run row, no adapter error for apollo_moves', !r1.refused && c1.apollo_moves === null && !c1.adapter_errors?.apollo_moves, JSON.stringify({ refused: r1.refused, reason: r1.reason, apollo_moves: c1.apollo_moves, calls: c1.apollo_calls, err: c1.adapter_errors }));
      await svc.from('sales_sync_runs').update({ started_at: new Date(Date.now() - 26 * 3600e3).toISOString() }).eq('business_id', B);
      const r2 = await SY.runSync({ businessId: B, trigger: 'manual', maxCalls: 10 });
      const c2 = r2.run?.counts || {};
      ok('B2 guard cleared: the run row carries apollo_moves { proposed 0 (already applied), applied 0, held 2, calls 0 } and per_endpoint has no apollo-moves entry (the step makes no Apollo request)', !r2.refused && c2.apollo_moves && c2.apollo_moves.proposed === 0 && c2.apollo_moves.applied.length === 0 && c2.apollo_moves.held.length === 2 && c2.apollo_moves.calls === 0 && !Object.keys(c2.per_endpoint || {}).some(k => /apollo_moves|touches/.test(k)), JSON.stringify({ refused: r2.refused, reason: r2.reason, apollo_moves: c2.apollo_moves && { ...c2.apollo_moves, held: c2.apollo_moves.held.length }, sync_calls: c2.apollo_calls }));
      ok('B3 no duplicate event rows from the sync run', (await evCount(B)) - ev0 === 2);
    } else {
      console.log('   Part B skipped (--skip-sync): the sync-wired run was proven on 2026-10-08 - block { proposed 0, applied 0, held 2, calls 0 } on the run row, guard null when already ran. Seeding an older run row so C1 has a last_run.');
      await svc.from('sales_sync_runs').update({ started_at: new Date(Date.now() - 26 * 3600e3).toISOString() }).eq('business_id', B);
      ins(await svc.from('sales_sync_runs').insert({ business_id: B, trigger: 'test', status: 'success', started_at: new Date().toISOString(), finished_at: new Date().toISOString(), counts: { apollo_moves: { proposed: 0, applied: [], refused: [], held: daily.held, calls: 0 } } }).select().single());
    }

    // C - API
    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`${PORT}`); i++) await wait(250);
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${B}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: u.cookie }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    let r = await call(jack, 'GET', '/partners/apollo-touches');
    const heldKey = id => r.body.held.find(h => h.goal_id === id)?.key;
    const k3 = heldKey(P3.id), k4 = heldKey(P4.id);
    ok('C1 GET as member: last_run from the latest run with a block (the sync run: 0 applied) + held 2 with reasons', r.status === 200 && r.body.last_run && r.body.last_run.applied.length === 0 && r.body.held.length === 2 && /enrolled, paused — needs Jack \(2 paused\)/.test(r.body.held.find(h => h.goal_id === P3.id).reason), JSON.stringify({ last: r.body.last_run && [r.body.last_run.at, r.body.last_run.applied.length], held: r.body.held.map(h => [h.partner, h.reason]) }));
    r = await call(vera, 'POST', '/partners/apollo-touches/dismiss', { key: k4 });
    ok('C2 viewer POST dismiss -> 403', r.status === 403, String(r.status));
    r = await call(jack, 'POST', '/partners/apollo-touches/apply', { keys: [k3] });
    ok('C3 member apply of a held key WITHOUT include_held -> refused (held)', r.status === 200 && r.body.applied.length === 0 && /enrolled, paused/.test(r.body.refused[0]?.reason), JSON.stringify(r.body.refused));
    r = await call(jack, 'POST', '/partners/apollo-touches/apply', { keys: [k3], include_held: true });
    const g3b = await goalRow(P3.id);
    ok('C4 member OK (include_held) -> applied with held_ok, P3 now Sent dated Sep 28 LA (earliest paused contact, Sep 29 00:28Z), by the member', r.body.applied.length === 1 && r.body.applied[0].held_ok === true && g3b.pipeline_status === 'first_email_sent' && g3b.first_email_at === '2026-09-28', JSON.stringify([r.body.applied, g3b]));
    r = await call(jack, 'POST', '/partners/apollo-touches/dismiss', { key: k4 });
    const dismissEv = (await svc.from('sales_partner_events').select('*').eq('business_id', B).eq('goal_id', P4.id).order('recorded_at', { ascending: false }).limit(1).single()).data;
    const g4 = await goalRow(P4.id);
    ok('C5 dismiss -> note event (source apollo, meta.apollo_key + dismissed), partner NOT moved, note text names the move', r.status === 200 && dismissEv.event === 'note' && dismissEv.source === 'apollo' && dismissEv.meta.apollo_key === k4 && dismissEv.meta.dismissed === true && g4.pipeline_status === 'not_started' && /^Dismissed Apollo move to Sent: Cy Test in sequence since 2026-09-29 \(enrolled, paused — needs Jack \(1 paused\)\)$/.test(dismissEv.note), JSON.stringify([r.status, dismissEv.note]));
    r = await call(jack, 'GET', '/partners/apollo-touches');
    ok('C6 after OK + dismiss: held empty; P4 key skipped "already dismissed"; dismiss again -> 409', r.body.held.length === 0 && r.body.skipped.some(s => s.key === k4 && /already dismissed/.test(s.reason)) && (await call(jack, 'POST', '/partners/apollo-touches/dismiss', { key: k4 })).status === 409, JSON.stringify(r.body.skipped.map(s => [s.partner, s.reason])));
    // Undo rule: the daily (automatic) move on P1 was recorded minutes ago; backdate it 5 hours - still undoable because source apollo + latest.
    const p1Ev = (await svc.from('sales_partner_events').select('id').eq('business_id', B).eq('goal_id', P1.id).single()).data;
    await svc.from('sales_partner_events').update({ recorded_at: new Date(Date.now() - 5 * 3600e3).toISOString() }).eq('id', p1Ev.id);
    r = await call(jack, 'POST', `/partners/${P1.id}/undo`, { event_id: p1Ev.id });
    ok('C7 undo of an automatic move 5 hours later -> allowed (no 2-min window for source apollo), P1 back to first_email_drafted', r.status === 200 && (await goalRow(P1.id)).pipeline_status === 'first_email_drafted', JSON.stringify(r.body.error || r.status));
    // A manual change after the window is still refused.
    const manual = await call(jack, 'POST', `/partners/${P5.id}/signal`, { type: 'note', note: 'manual note' });
    await svc.from('sales_partner_events').update({ recorded_at: new Date(Date.now() - 5 * 60e3).toISOString() }).eq('id', manual.body.event.id);
    r = await call(jack, 'POST', `/partners/${P5.id}/undo`, { event_id: manual.body.event.id });
    ok('C8 undo of a MANUAL change 5 minutes later -> still "too late to undo"', r.status === 409 && /too late/.test(r.body.error), JSON.stringify(r.body));
    r = await call(jack, 'GET', '/partners/apollo-touches');
    ok('C9 GET last_run still reads the sync run; P1 key now skipped "already applied" (dedupe survives the undo)', r.status === 200 && r.body.skipped.some(s => s.goal_id === P1.id && /already applied/.test(s.reason)));
    ok('C10 no email address in any response or the server log', !/@/.test(log) && !JSON.stringify(r.body).includes('@'));

    // D - browser. Seed a fresh run row so the panel's last run shows the P2 move (undoable) + a second held partner to OK from the UI.
    const P6 = await partner('Held UI Test', 'not_started');
    ins(await contact(P6, `${tag}-c7`, 'Fi Test', '2026-09-30T00:47:13Z', 'paused'));
    const p2Ev = (await svc.from('sales_partner_events').select('id').eq('business_id', B).eq('goal_id', P2.id).single()).data;
    ins(await svc.from('sales_sync_runs').insert({ business_id: B, trigger: 'test', status: 'success', started_at: new Date().toISOString(), finished_at: new Date().toISOString(), counts: { apollo_moves: { proposed: 1, applied: [{ key: `sent:${tag}-c2:2026-09-30T19:00:00+00:00`, goal_id: P2.id, partner: 'Sequence Test', from: 'researching', to: 'first_email_sent', date: '2026-09-30', contact_name: 'Pat Test', reason: 'Pat Test in sequence since 2026-09-30', event_id: p2Ev.id, held_ok: false }], refused: [], held: [], calls: 0 } } }).select().single());
    browser = await chromium.launch();
    const D = await newPage(jack, 1440, 900); await navPartners(D.page, false);
    await D.page.getByRole('button', { name: 'Apollo moves' }).click(); await D.page.waitForTimeout(1500);
    const panel = D.page.getByRole('region', { name: 'Apollo moves' });
    const appliedRows = await panel.getByRole('list', { name: 'Applied moves' }).getByRole('listitem').allInnerTexts();
    const heldRows = await panel.getByRole('list', { name: 'Held moves' }).getByRole('listitem').allInnerTexts();
    await D.page.screenshot({ path: `${OUT}/1440-apollo-moves.png`, fullPage: false });
    ok('D1 1440: panel shows last run "1 applied · 0 Apollo calls", the Sequence Test row with Undo, and Held UI Test with its reason + OK / Dismiss', /1 applied/.test(await panel.innerText()) && /0 Apollo calls/.test(await panel.innerText()) && appliedRows.length === 1 && /Sequence Test/.test(appliedRows[0]) && /from apollo/i.test(appliedRows[0]) && heldRows.length === 1 && /Held UI Test/.test(heldRows[0]) && /enrolled, paused — needs Jack \(1 paused\)/.test(heldRows[0]), JSON.stringify({ appliedRows, heldRows }));
    await panel.getByRole('button', { name: 'OK Held UI Test' }).click(); await D.page.waitForTimeout(2500);
    const g6 = await goalRow(P6.id);
    ok('D2 1440: OK from the panel -> Held UI Test at Sent in the DB, status line "Held UI Test → Sent · from Apollo", held list empty', g6.pipeline_status === 'first_email_sent' && /Held UI Test → Sent · from Apollo/.test(await panel.innerText()) && (await panel.getByRole('list', { name: 'Held moves' }).count()) === 0, g6.pipeline_status);
    await panel.getByRole('button', { name: 'Undo Sequence Test' }).click(); await D.page.waitForTimeout(2500);
    const g2c = await goalRow(P2.id);
    ok('D3 1440: Undo from the panel -> Sequence Test back to researching, row reads "undone", 0 console errors', g2c.pipeline_status === 'researching' && /undone/.test((await panel.getByRole('list', { name: 'Applied moves' }).getByRole('listitem').allInnerTexts())[0]) && D.errs.length === 0, D.errs.join(' ; '));
    const V = await newPage(vera, 1440, 900); await navPartners(V.page, false);
    ok('D4 viewer: no "Apollo moves" button, 0 console errors', (await V.page.getByRole('button', { name: 'Apollo moves' }).count()) === 0 && V.errs.length === 0, V.errs.join(' ; '));
    const M = await newPage(jack, 390, 844); await navPartners(M.page, true);
    await M.page.getByRole('button', { name: 'Apollo moves' }).click(); await M.page.waitForTimeout(1500);
    await M.page.screenshot({ path: `${OUT}/390-apollo-moves.png`, fullPage: false });
    const noSideways = await M.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    ok('D5 390: panel opens, no sideways scroll, 0 console errors', (await M.page.getByRole('region', { name: 'Apollo moves' }).count()) === 1 && noSideways && M.errs.length === 0, M.errs.join(' ; '));
  } catch (e) {
    console.log('ERROR', e.stack || e.message);
  } finally {
    await cleanup();
    const after = await snap(), hlAfter = await hlSnap();
    const same = JSON.stringify(after) === JSON.stringify(before);
    console.log(`\n${pass}/${total} passed · screenshots in ${OUT}`);
    if (!same) console.log('counts before', before, 'after', after);
    console.log(`HomeLover untouched: ${hlAfter === hlBefore ? 'yes' : 'NO'}`);
    console.log(`restored: ${same && hlAfter === hlBefore ? 'yes' : 'NO'}`);
    process.exit(pass === total && same && hlAfter === hlBefore ? 0 : 1);
  }
})();
