// call-notes-targets-v1 REV4 Stage 2 live check. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 2 temp users (owner "Jack Zz", viewer). Seed: 2 partners (Gallagher has a contact WITH an email and a phone in its angle), 1 opportunity ([solidcore]), 1 Apollo account, 1 call note, 8 targets (2 rejected), 3 research to-dos. API: promote -> partner, promote on an existing partner name (already), promote -> employer, promote on an existing opportunity (already), reject + undo + reject, Copy bundles for a partner / employer / target (printed, asserted clean), Viewer gates. UI (Playwright, serves build/ - run npm run build first): Today chip, Targets list, confirm panel at 1440 + 390, Viewer list with no buttons, one real clipboard copy. 0 Claude, 0 Apollo / 0 syncs. HomeLover is only COUNTED (head requests). Teardown deletes everything. ~60-120s, cap 4 min.
// Usage: node scripts/verify/call-notes-targets-v1-stage2.cjs <outdir>
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3988, tag = 'cnt2-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL_TABLES = ['business_members', 'sales_goals', 'sales_partner_events', 'sales_week_goals', 'sales_week_goal_steps', 'sales_call_notes', 'sales_targets', 'sales_opportunities', 'sales_opportunity_events', 'sales_sequenced_accounts', 'partner_contacts'];
const OUT = process.argv[2] || '/tmp';
const made = { biz: null, users: [] };
let srv, browser, log = '', pass = 0, total = 0, blocked = 0, browserWrites = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const wait = ms => new Promise(r => setTimeout(r, ms));
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
    for (const t of ['sales_partner_events', 'partner_contacts', 'sales_week_goal_steps', 'sales_week_goals', 'sales_targets', 'sales_opportunity_events', 'sales_opportunities', 'sales_call_notes', 'sales_sequenced_accounts', 'sales_goals', 'business_members', 'auth_events']) {
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
async function newPage(u, width, height) {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width, height }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage(); page.setDefaultTimeout(12000);
  page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR_FAILED|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, r => { blocked++; r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"blocked by verify script"}' }); });
  await page.route(/\/goals\/prospect-targets\/[^/]+\/(promote|reject)$/, r => { browserWrites++; r.continue(); });
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}/?tab=today`); await page.waitForTimeout(3000);
  return { page, errs };
}
async function navSales(page, compact) {
  const menu = async () => { if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); } };
  await menu(); await page.getByLabel('Workspace').selectOption({ label: WS_NAME }); await page.waitForTimeout(2500);
  await menu(); await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).dispatchEvent('click'); await page.waitForTimeout(4000);
}
const drawerSel = 'aside[aria-labelledby="task-drawer-title"]';
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: 'disabled', caret: 'hide' });

(async () => {
  const hlBefore = await hl(); const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  try {
    WS_NAME = `ZZ Targets ${tag.slice(-4)}`;
    const T = made.biz = ins(await svc.from('businesses').insert({ name: WS_NAME, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-jack@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const M = await user('Jack Zz', 'owner'), V = await user('Viewer Zz', 'viewer');
    const week = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const monday = new Date(Date.parse(`${week}T12:00:00Z`) - ((new Date(`${week}T12:00:00Z`).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
    const [gallagher, aon] = ins(await svc.from('sales_goals').insert([
      { business_id: T, goal_type: 'partnership', name: 'Gallagher', pipeline_status: 'replied', owner_user_id: M.id, category: '4. Mid-Market Benefits Brokers', tier: '2', hot: true, owner_team: 'upside', co_owner_name: 'Brad', champion: 'Pat Example', angle: 'Pat said call 415-555-0100 or mail pat@gallagher.example before the pilot', next_step: 'Send the one-pager' },
      { business_id: T, goal_type: 'partnership', name: 'Aon', pipeline_status: 'not_started', owner_user_id: M.id, category: '6. Enterprise Benefits Consultants', tier: null, hot: false, owner_team: null, co_owner_name: null, champion: null, angle: null, next_step: null },
    ]).select());
    ins(await svc.from('partner_contacts').insert({ business_id: T, goal_id: gallagher.id, name: 'Pat Example', title: 'VP Benefits', role_in_notes: 'champion', email: 'pat@gallagher.example', source: 'manual', created_by: M.id }).select());
    ins(await svc.from('sales_partner_events').insert({ business_id: T, goal_id: gallagher.id, event: 'touch', touch_type: 'email', contact_names: ['Pat Example'], source: 'outlook', by_user: M.id, at: '2026-10-12T19:00:00Z', meta: { direction: 'sent' } }).select());
    const [solidcore] = ins(await svc.from('sales_opportunities').insert({ business_id: T, organization: '[solidcore]', org_type: 'employer', stage: 'contacted', source: 'manual', notes: 'Crystal Pringle replied - crystal@solidcore.example' }).select());
    ins(await svc.from('sales_sequenced_accounts').insert({ business_id: T, account_id: 'zz-acc-marriott', name: 'Marriott International', first_sequenced_at: new Date(Date.now() - 20 * 864e5).toISOString(), week_start: monday }).select());
    const [note] = ins(await svc.from('sales_call_notes').insert({ business_id: T, title: 'Seif call', call_date: '2026-10-12', text: 'ZZ seed note text', hash: `zz-${tag}`, source_type: 'call', source_label: 'Seif weekly', created_by: M.id }).select());
    const tg = (name, kind, extra = {}) => ({ business_id: T, name, kind, status: 'researching', source_note_id: note.id, research_prompt: 'x', created_by: M.id, suggested_category: null, owner_team: null, co_owner_name: null, no_double_touch: false, evidence: null, research_notes: null, decided_at: null, ...extra });
    const targets = ins(await svc.from('sales_targets').insert([
      tg('Fundrise', 'partner', { suggested_category: '3. Renter Platforms', owner_team: 'upside', co_owner_name: 'Brad', no_double_touch: true, evidence: 'renter-investing platforms are worth approaching', research_notes: 'Person: Ana Example — CEO (champion)\n(10/12) angle: reaches 400k renters' }),
      tg('Gallagher Inc', 'partner', { evidence: 'moving forward on the broker pilot' }),
      tg('Solidcore', 'employer', { evidence: 'Crystal replied Oct 13' }),
      tg('Deloitte', 'employer', { evidence: 'runs a large benefits program', owner_team: 'homelover' }),
      tg('Lockton', 'partner', { suggested_category: '4. Mid-Market Benefits Brokers', evidence: 'new broker target for Upside' }),
      tg('Marsh McLennan Agency', 'partner', { suggested_category: '4. Mid-Market Benefits Brokers', evidence: 'new broker target for Upside to open', owner_team: 'upside' }),
      tg('Mercer', 'employer', { status: 'proposed', evidence: 'large benefits program' }),
      tg('Plaid', 'employer', { status: 'rejected', decided_at: new Date().toISOString(), evidence: 'income checks tool' }),
    ]).select());
    const tid = n => targets.find(t => t.name === n).id;
    const todos = ins(await svc.from('sales_week_goals').insert(['Fundrise', 'Deloitte', 'Lockton'].map((n, i) => ({ business_id: T, kind: 'todo', text: `Research ${n}`, status: 'open', week_start: monday, owner_user_id: M.id, link_type: 'target', link_id: tid(n), source_note_id: note.id, created_by: M.id, sort_order: i, due_date: week }))).select());
    console.log(`seed: workspace ${T}, 2 partners (1 contact with email), 1 opportunity, 1 Apollo account, 1 note, ${targets.length} targets, ${todos.length} research to-dos`);

    srv = spawn('node', ['--dns-result-order=ipv4first', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`port ${PORT}`); i++) await wait(250);
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${T}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `prospector_at=${encodeURIComponent(u.token)}` }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

    console.log('--- list + gates');
    const vl = await call(V, 'GET', '/prospect-targets');
    const fund = (vl.body.targets || []).find(t => t.name === 'Fundrise');
    ok('viewer GET list 200 with evidence, research notes and the source note label + date', vl.status === 200 && fund?.evidence && fund.research_notes && fund.source?.label === 'Seif weekly' && fund.source.date === '2026-10-12', JSON.stringify(fund?.source));
    ok('viewer cannot promote (403)', (await call(V, 'POST', `/prospect-targets/${tid('Fundrise')}/promote`, { to: 'partner' })).status === 403);
    ok('viewer cannot reject (403)', (await call(V, 'POST', `/prospect-targets/${tid('Fundrise')}/reject`, {})).status === 403);
    const vb = await call(V, 'GET', `/copy-bundle?type=partner&id=${gallagher.id}`);
    ok('viewer may copy (200)', vb.status === 200 && /^# Gallagher — partner/.test(vb.body.markdown || ''), `${vb.status}`);
    ok('bad promote body -> 400', (await call(M, 'POST', `/prospect-targets/${tid('Fundrise')}/promote`, { to: 'sponsor' })).status === 400);

    console.log('--- promote -> partner');
    const p1 = await call(M, 'POST', `/prospect-targets/${tid('Fundrise')}/promote`, { to: 'partner' });
    ok('Fundrise -> partner 201', p1.status === 201 && p1.body.created?.type === 'partner', JSON.stringify(p1.body).slice(0, 160));
    const goal = ins(await svc.from('sales_goals').select('*').eq('business_id', T).eq('name', 'Fundrise').maybeSingle());
    ok('new partner: not_started, category pre-set, ownership carried, no person owner', goal && goal.pipeline_status === 'not_started' && goal.category === '3. Renter Platforms' && goal.owner_team === 'upside' && goal.co_owner_name === 'Brad' && goal.no_double_touch === true && goal.owner_user_id === null, JSON.stringify(goal && { s: goal.pipeline_status, c: goal.category, t: goal.owner_team }));
    const ev = ins(await svc.from('sales_partner_events').select('event, note, meta').eq('goal_id', goal?.id || '00000000-0000-0000-0000-000000000000'));
    ok('one note event "From intake (Seif weekly, 2026-10-12): …" + research notes, no "@"', ev.length === 1 && ev[0].event === 'note' && /^From intake \(Seif weekly, 2026-10-12\): renter-investing/.test(ev[0].note) && /Ana Example/.test(ev[0].note) && !ev[0].note.includes('@') && ev[0].meta?.from_target_id === tid('Fundrise'), JSON.stringify(ev));
    const relinked = ins(await svc.from('sales_week_goals').select('text, link_type, link_id').eq('business_id', T).eq('text', 'Research Fundrise').maybeSingle());
    ok('its research to-do now links to the partner', relinked?.link_type === 'partner' && relinked.link_id === goal?.id && p1.body.relinked === 1);
    const tFund = ins(await svc.from('sales_targets').select('status, promoted_goal_id, decided_at').eq('id', tid('Fundrise')).single());
    ok('target accepted with promoted_goal_id + decided_at', tFund.status === 'accepted' && tFund.promoted_goal_id === goal?.id && !!tFund.decided_at);
    const p2 = await call(M, 'POST', `/prospect-targets/${tid('Gallagher Inc')}/promote`, { to: 'partner' });
    const goalsN = ins(await svc.from('sales_goals').select('id').eq('business_id', T)).length;
    ok('"Gallagher Inc" -> already: Gallagher (partner), nothing created', p2.status === 200 && p2.body.already?.type === 'partner' && p2.body.already.id === gallagher.id && goalsN === 3, JSON.stringify(p2.body));

    console.log('--- promote -> employer');
    const p3 = await call(M, 'POST', `/prospect-targets/${tid('Deloitte')}/promote`, { to: 'employer', co_owner_name: 'Brad' });
    ok('Deloitte -> employer 201', p3.status === 201 && p3.body.created?.type === 'opportunity', JSON.stringify(p3.body).slice(0, 160));
    const opp = ins(await svc.from('sales_opportunities').select('*').eq('business_id', T).eq('organization', 'Deloitte').maybeSingle());
    ok('opportunity at target, manual, ownership carried + panel co-owner, evidence in notes with the target id', opp && opp.stage === 'target' && opp.source === 'manual' && opp.owner_team === 'homelover' && opp.co_owner_name === 'Brad' && new RegExp(`from target ${tid('Deloitte')}: runs a large benefits program`).test(opp.notes || ''), JSON.stringify(opp && { s: opp.stage, n: opp.notes }));
    const oppEv = ins(await svc.from('sales_opportunity_events').select('event_type, to_stage').eq('business_id', T).eq('opportunity_id', opp?.id || '00000000-0000-0000-0000-000000000000'));
    ok("DB trigger wrote exactly one 'created' event at target; no stage change", oppEv.length === 1 && oppEv[0].event_type === 'created' && oppEv[0].to_stage === 'target', JSON.stringify(oppEv));
    const tDel = ins(await svc.from('sales_targets').select('status, promoted_goal_id').eq('id', tid('Deloitte')).single());
    const delTodo = ins(await svc.from('sales_week_goals').select('link_type, link_id').eq('business_id', T).eq('text', 'Research Deloitte').maybeSingle());
    ok('target accepted, promoted_goal_id null, its to-do stays linked to the target (T3 option a)', tDel.status === 'accepted' && tDel.promoted_goal_id === null && delTodo?.link_type === 'target' && delTodo.link_id === tid('Deloitte'));
    const p4 = await call(M, 'POST', `/prospect-targets/${tid('Solidcore')}/promote`, { to: 'employer' });
    const oppsN = ins(await svc.from('sales_opportunities').select('id').eq('business_id', T)).length;
    ok('"Solidcore" -> already: [solidcore] (opportunity), nothing created', p4.status === 200 && p4.body.already?.type === 'opportunity' && p4.body.already.id === solidcore.id && oppsN === 2, JSON.stringify(p4.body));

    console.log('--- not a fit + undo');
    const r1 = await call(M, 'POST', `/prospect-targets/${tid('Lockton')}/reject`, {});
    const lockTodo = async () => ins(await svc.from('sales_week_goals').select('id, status').eq('business_id', T).eq('text', 'Research Lockton').single());
    let lt = await lockTodo();
    ok('reject 200: target rejected, research to-do dropped (not deleted, not done)', r1.status === 200 && r1.body.target?.status === 'rejected' && r1.body.dropped?.length === 1 && lt.status === 'dropped', JSON.stringify(r1.body).slice(0, 160));
    const r2 = await call(M, 'POST', `/prospect-targets/${tid('Lockton')}/reject`, { undo: true, reopen: r1.body.dropped });
    lt = await lockTodo();
    ok('undo 200: back to researching, to-do reopened', r2.status === 200 && r2.body.target?.status === 'researching' && r2.body.target.decided_at === null && lt.status === 'open', JSON.stringify(r2.body).slice(0, 160));
    const r3 = await call(M, 'POST', `/prospect-targets/${tid('Lockton')}/reject`, {});
    ok('rejected again for the UI toggle; a promoted target cannot be rejected (409)', r3.status === 200 && (await call(M, 'POST', `/prospect-targets/${tid('Fundrise')}/reject`, {})).status === 409);

    console.log('--- Copy for Claude bundles (printed; no "@", no phone)');
    const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g, ISO = /^\s*\d{4}-\d{2}-\d{2}\s*$/;
    const clean = s => !s.includes('@') && !(s.match(PHONE) || []).some(m => !ISO.test(m));
    const bundles = [['partner', gallagher.id], ['employer', solidcore.id], ['target', tid('Marsh McLennan Agency')]];
    for (const [type, id] of bundles) {
      const b = await call(M, 'GET', `/copy-bundle?type=${type}&id=${id}`);
      const md = b.body.markdown || '';
      ok(`${type} bundle 200, clean, ends with "What I need:"`, b.status === 200 && clean(md) && md.endsWith('## What I need:\n\n'), `${b.status} ${b.body.error || ''}`);
      console.log(`----- ${type} bundle -----\n${md.trim()}\n-----`);
    }
    const pb = (await call(M, 'GET', `/copy-bundle?type=partner&id=${gallagher.id}`)).body.markdown || '';
    ok('partner bundle: contact with an email in the DB appears by name + title only; phone + email in the angle scrubbed', /- Pat Example · VP Benefits · champion/.test(pb) && /\[number removed\]/.test(pb) && /\[email removed\]/.test(pb) && !pb.includes('555') && !pb.includes('gallagher.example'));
    ok('partner bundle: ownership, stage, intel, last touch, open to-dos present', /Owner team: Upside · Co-owner: Brad/.test(pb) && /Stage: Replied/.test(pb) && /Oct 12, 2026 · email · out · Pat Example · by Jack/.test(pb) && /## Open to-dos/.test(pb));
    ok('bundle of a record in another workspace -> 404', (await call(M, 'GET', `/copy-bundle?type=partner&id=${HOMELOVER}`)).status === 404);

    console.log('--- UI');
    browser = await chromium.launch();
    for (const [width, height, compact] of [[1440, 900, false], [390, 844, true]]) {
      const { page, errs } = await newPage(M, width, height);
      await navSales(page, compact);
      const chip = page.locator('[data-today-chips] button');
      await chip.first().waitFor();
      const chipText = (await chip.first().innerText()).trim();
      ok(`${width}: Today chip "${chipText}" (4 open: Gallagher Inc, Solidcore, Marsh McLennan Agency, Mercer)`, /Targets \(4\)/.test(chipText));
      await shot(page, `cnt2-${width}-today-chip`);
      await chip.first().click();
      const drawer = page.locator(drawerSel);
      await drawer.waitFor(); await drawer.getByRole('region', { name: 'Targets' }).waitFor(); await page.waitForTimeout(600);
      const rows = await drawer.locator('li[data-target-id]').count();
      ok(`${width}: chip opens the drawer on the Targets list - 6 rows (2 not-a-fit hidden)`, rows === 6, String(rows));
      ok(`${width}: Targets pill pressed, "Show not-a-fit (2)" toggle present`, (await drawer.getByRole('button', { name: /^◎ Targets/ }).getAttribute('aria-pressed')) === 'true' && (await drawer.getByRole('button', { name: 'Show not-a-fit (2)' }).count()) === 1);
      await shot(page, `cnt2-${width}-targets-list`);
      const marsh = drawer.locator('li[data-target-id]', { hasText: 'Marsh McLennan Agency' });
      await marsh.getByRole('button', { name: 'Promote → partner' }).click();
      const form = drawer.getByRole('form', { name: 'Promote Marsh McLennan Agency to partner' });
      await form.waitFor();
      ok(`${width}: confirm panel pre-sets category + owner team from the target`, (await form.getByLabel('Category').inputValue()) === '4. Mid-Market Benefits Brokers' && (await form.getByLabel('Owner team').inputValue()) === 'upside');
      await form.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
      await shot(page, `cnt2-${width}-promote-panel`);
      await form.getByRole('button', { name: 'Cancel' }).click();
      if (!compact) {
        await marsh.getByRole('button', { name: 'Copy for Claude' }).click();
        await drawer.getByText('Copied for Claude ✓').waitFor();
        const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
        ok('1440: Copy for Claude writes the target bundle to the clipboard', clip === null ? true : /^# Marsh McLennan Agency — target \(partner\)/.test(clip) && /## What I need:/.test(clip) && !clip.includes('@'), clip === null ? '' : clip.slice(0, 80));
        if (clip === null) console.log('  (clipboard read unavailable headless - only the Copied state was checked)');
      }
      ok(`${width}: no sideways scroll`, await noSideScroll(page));
      ok(`${width}: 0 console errors`, !errs.length, errs.join(' | '));
      await page.context().close();
    }
    const { page: pp, errs: perrs } = await newPage(M, 1440, 900);
    await navSales(pp, false);
    await pp.locator('#workspace-header-tabs').getByRole('button', { name: /^Pipeline/ }).first().click(); await pp.waitForTimeout(1800);
    await pp.locator('.ui-seg').getByRole('button', { name: 'Partner workflow', exact: true }).first().click().catch(() => {}); await pp.waitForTimeout(1800);
    const gRow = pp.locator('[data-partner-id]', { hasText: 'Gallagher' }).first();
    await gRow.getByRole('button', { name: /Gallagher/ }).first().click(); await pp.waitForTimeout(1500);
    const rowCopies = await gRow.getByRole('button', { name: 'Copy for Claude' }).count();
    ok('Pipeline › Partner workflow: an expanded partner row has Copy for Claude', rowCopies === 1, String(rowCopies));
    await pp.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'Board' }).click().catch(() => {}); await pp.waitForTimeout(1200);
    const cardCopies = await pp.locator('#main-content').getByRole('button', { name: 'Copy for Claude' }).count();
    ok('Pipeline › Partners cards layout: every partner card has Copy for Claude (3 partners)', cardCopies === 3, String(cardCopies));
    ok('partners page: 0 console errors', !perrs.length, perrs.join(' | '));
    await pp.context().close();

    const { page: vp, errs: verrs } = await newPage(V, 1440, 900);
    await navSales(vp, false);
    await vp.getByRole('button', { name: /^(Open tasks|Tasks)/ }).click();
    const vd = vp.locator(drawerSel); await vd.waitFor();
    await vd.getByRole('button', { name: /^◎ Targets/ }).click(); await vd.getByRole('region', { name: 'Targets' }).waitFor(); await vp.waitForTimeout(500);
    const vRows = await vd.locator('li[data-target-id]').count();
    ok('viewer: sees the list (6 rows), no Promote / Not a fit buttons, Copy present', vRows === 6 && (await vd.getByRole('button', { name: /Promote|Not a fit/ }).count()) === 0 && (await vd.getByRole('button', { name: 'Copy for Claude' }).count()) === 6, `rows ${vRows}`);
    ok('viewer: read-only note shown', (await vd.getByText('You have view access, so targets are read-only.').count()) === 1);
    await shot(vp, 'cnt2-1440-viewer-targets');
    ok('viewer: 0 console errors', !verrs.length, verrs.join(' | '));
    await vp.context().close();
    ok('browser made 0 promote/reject writes; 0 sync/Apollo requests reached the server', browserWrites === 0 && !/apollo\.io|\[sync\]/i.test(log), `writes ${browserWrites} blocked ${blocked}`);
  } catch (e) {
    ok('script ran without throwing', false, e.stack?.split('\n').slice(0, 3).join(' | ') || e.message);
  } finally {
    await cleanup();
    const left = await svc.from('businesses').select('id', { count: 'exact', head: true }).eq('id', made.biz);
    const profiles = await svc.from('profiles').select('id', { count: 'exact', head: true }).in('id', made.users.length ? made.users : ['00000000-0000-0000-0000-000000000000']);
    console.log(`teardown: workspace left ${left.count}, temp profiles left ${profiles.count}`);
    const hlAfter = await hl();
    const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
    ok(`HomeLover counts identical (${HL_TABLES.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
    console.log(`${pass}/${total} passed · ${Math.round((Date.now() - t0) / 1000)}s · Claude 0 · Apollo 0`);
    process.exit(pass === total ? 0 : 1);
  }
})();
