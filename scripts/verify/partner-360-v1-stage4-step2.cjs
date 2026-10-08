// partner-360-v1 Stage 4 step 2 (apply) check. SCOPE: 0 Apollo calls. Part A = TEMP workspace (2 temp users member + viewer, 6 temp partners, 7 temp partner_contacts, 2 temp replied messages, 1 pre-applied apollo event): dry run shows proposed / held (all-paused rule) / skipped; viewer POST apply 403; member POST apply with 5 keys -> 2 applied (Replied dated replied_seen_at, Sent dated sequence_added_at, both source apollo + meta.apollo_key), 3 refused with reasons (already applied, held, unknown); stale `expect` -> refused; undo through the existing undo route restores the stage; re-run dry run -> both keys "already applied" (dedupe survives undo); re-POST -> 0 applied, event count unchanged; browser 1440/390: Activity row reads "Emailed <name> → Replied · from Apollo", 0 console errors. Part B (only with --apply-homelover) = the ONE key Jack approved (Domuso) applied on HomeLover through applyApolloTouches as Jack's member id, then verified in the DB and through the events route's data + the timeline util (the exact strings the UI renders). Nothing else on HomeLover changes (snapshot diff must be exactly that partner + 1 event). ~2 min, cap 4 min. Serves build/ via server.js - run npm run build first. Fake emails (example.com) only; nothing here prints an email.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const OUT = process.argv[2] || '/tmp/partner-360-stage4-step2'; fs.mkdirSync(OUT, { recursive: true });
const APPLY_HL = process.argv.includes('--apply-homelover');
const HL_KEY = 'sent:6a90d6074d10c70014346a3c:2026-08-28T00:28:26.819+00:00', HL_JACK = '68e2a844-90c2-4051-b2f9-1604c81fc8b3';
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95', PORT = 3963, tag = 'p360e-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const WATCH = ['businesses', 'business_members', 'sales_goals', 'sales_partner_events', 'partner_contacts', 'sales_email_messages', 'profiles', 'auth_events'];
const made = { users: [], biz: [] };
let srv, browser, log = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const hlSnap = async () => ({
  ev: (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count,
  pc: (await svc.from('partner_contacts').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count,
  goals: (await svc.from('sales_goals').select('id,name,pipeline_status,first_email_at,last_touch_at').eq('business_id', HL).eq('goal_type', 'partnership').order('id')).data,
});
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  for (const b of made.biz) {
    for (const t of ['sales_partner_events', 'partner_contacts', 'sales_email_messages', 'sales_goals', 'business_members', 'auth_events']) await svc.from(t).delete().eq('business_id', b);
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
const row = (page, id) => page.locator(`[data-partner-id="${id}"]`).first();
const openRow = async (page, id) => { await row(page, id).locator('button[aria-expanded]').first().click(); await page.waitForTimeout(1500); };
const goalRow = async (B, id) => (await svc.from('sales_goals').select('pipeline_status,first_email_at,last_touch_at').eq('business_id', B).eq('id', id).single()).data;

(async () => {
  const before = await snap(), hlBefore = await hlSnap();
  const T = await import(ROOT + '/api/sales/partnerApolloTouches.js');
  try {
    const B = await biz('p360e');
    bizLabel = (await svc.from('businesses').select('name').eq('id', B).single()).data.name;
    const jack = await user(B, 'Jack', 'member'), vera = await user(B, 'Vera', 'viewer');
    const partner = async (name, pipeline_status) => ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name, pipeline_status, category: '3. PEOs', tier: '1', owner_user_id: jack.id }).select().single());
    const P1 = await partner('Behind Replied Test', 'first_email_drafted');
    const P2 = await partner('Behind Sent Test', 'researching');
    const P3 = await partner('Already Applied Test', 'not_started');
    const P4 = await partner('Past It Test', 'meeting_set');
    const P5 = await partner('All Paused Test', 'not_started');
    const P6 = await partner('Mixed Paused Test', 'not_started');
    const contact = (g, id, name, sequence_added_at = null, sequence_status = sequence_added_at ? 'active' : null) => svc.from('partner_contacts').insert({ business_id: B, goal_id: g.id, apollo_contact_id: id, name, source: 'apollo', sequence_added_at, sequence_status }).select();
    ins(await contact(P1, `${tag}-c1`, 'Dana Test', '2026-09-20T12:00:00Z'));
    ins(await contact(P2, `${tag}-c2`, 'Pat Test', '2026-09-30T19:00:00Z'));
    ins(await contact(P3, `${tag}-c3`, 'Lee Test'));
    ins(await contact(P4, `${tag}-c4`, 'Sam Test', '2026-10-01T12:00:00Z'));
    ins(await contact(P5, `${tag}-c5`, 'Ava Test', '2026-09-30T00:28:50Z', 'paused'));
    ins(await contact(P5, `${tag}-c6`, 'Bo Test', '2026-09-29T00:28:50Z', 'paused'));
    ins(await contact(P6, `${tag}-c7`, 'Cy Test', '2026-09-25T12:00:00Z', 'paused'));
    ins(await contact(P6, `${tag}-c8`, 'Di Test', '2026-09-26T12:00:00Z', 'active'));
    ins(await svc.from('sales_email_messages').insert([
      { business_id: B, apollo_message_id: `${tag}-m1`, contact_id: `${tag}-c1`, replied: true, replied_seen_at: '2026-10-03T15:00:00Z', delivered_at: '2026-09-21T10:00:00Z' },
      { business_id: B, apollo_message_id: `${tag}-m3`, contact_id: `${tag}-c3`, replied: true, replied_seen_at: '2026-10-02T15:00:00Z', delivered_at: '2026-09-21T10:00:00Z' },
    ]).select());
    ins(await svc.from('sales_partner_events').insert({ business_id: B, goal_id: P3.id, event: 'touch', touch_type: 'email', from_status: 'not_started', to_status: 'replied', source: 'apollo', meta: { apollo_key: `reply:${tag}-m3`, prev: { pipeline_status: 'not_started' } }, by_user: jack.id }).select());

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`${PORT}`); i++) await wait(250);
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${B}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: u.cookie }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

    let r = await call(jack, 'GET', '/partners/apollo-touches');
    const key = id => (r.body.proposed.find(m => m.goal_id === id) || r.body.held.find(m => m.goal_id === id) || {}).key;
    const k1 = key(P1.id), k2 = key(P2.id), k5 = key(P5.id), k6 = key(P6.id);
    ok('A1 dry run: P1 Replied + P2 Sent + P6 Sent (from the active contact) proposed; P5 held "enrolled, paused — needs Jack (2 paused)"; P3 + P4 skipped',
      r.body.proposed.map(m => m.partner).sort().join(',') === 'Behind Replied Test,Behind Sent Test,Mixed Paused Test' && r.body.proposed.find(m => m.goal_id === P6.id)?.contact_name === 'Di Test'
      && r.body.held.length === 1 && r.body.held[0].goal_id === P5.id && r.body.held[0].reason === `${T.HELD_REASON} (2 paused)` && r.body.skipped.length === 2 && r.body.counts.held === 1, JSON.stringify({ proposed: r.body.proposed.map(m => [m.partner, m.contact_name]), held: r.body.held.map(h => [h.partner, h.reason]) }));

    r = await call(vera, 'POST', '/partners/apollo-touches/apply', { keys: [k1] });
    ok('A2 viewer POST apply -> 403', r.status === 403, String(r.status));
    r = await call(jack, 'POST', '/partners/apollo-touches/apply', { keys: [] });
    ok('A3 empty keys -> 400', r.status === 400, String(r.status));
    const evBefore = (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
    r = await call(jack, 'POST', '/partners/apollo-touches/apply', { keys: [k1, k2, `reply:${tag}-m3`, k5, 'bogus:key'] });
    const refusedBy = Object.fromEntries((r.body.refused || []).map(x => [x.key, x.reason]));
    ok('A4 member POST apply -> 2 applied (P1, P2), 3 refused: already applied / held / unknown', r.status === 200 && r.body.applied.length === 2 && r.body.applied.map(a => a.goal_id).sort().join() === [P1.id, P2.id].sort().join()
      && /already applied/.test(refusedBy[`reply:${tag}-m3`]) && refusedBy[k5] === `${T.HELD_REASON} (2 paused)` && /not proposed/.test(refusedBy['bogus:key']), JSON.stringify(r.body));
    const g1 = await goalRow(B, P1.id), g2 = await goalRow(B, P2.id);
    ok('A5 P1 now replied, last_touch_at = Oct 3 midday LA (19:00Z), first_email_at 2026-10-03', g1.pipeline_status === 'replied' && g1.last_touch_at === '2026-10-03T19:00:00+00:00' && g1.first_email_at === '2026-10-03', JSON.stringify(g1));
    ok('A6 P2 now first_email_sent, last_touch_at = Sep 30 midday LA, first_email_at 2026-09-30', g2.pipeline_status === 'first_email_sent' && g2.last_touch_at === '2026-09-30T19:00:00+00:00' && g2.first_email_at === '2026-09-30', JSON.stringify(g2));
    const evs = (await svc.from('sales_partner_events').select('*').eq('business_id', B).in('goal_id', [P1.id, P2.id]).order('recorded_at')).data;
    ok('A7 the 2 event rows: touch/email, source apollo, meta.apollo_key + date_label + prev, by the member, contact name, dated on the source day', evs.length === 2 && evs.every(e => e.event === 'touch' && e.touch_type === 'email' && e.source === 'apollo' && [k1, k2].includes(e.meta.apollo_key) && e.meta.date_label && e.meta.prev && e.by_user === jack.id && e.contact_names.length === 1)
      && evs.find(e => e.goal_id === P1.id).at === '2026-10-03T19:00:00+00:00' && evs.find(e => e.goal_id === P1.id).meta.date_label === 'seen at sync', JSON.stringify(evs.map(e => [e.goal_id === P1.id ? 'P1' : 'P2', e.at, e.meta.apollo_key, e.meta.date_label])));
    const evAfter = (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
    ok('A8 exactly 2 new event rows', evAfter - evBefore === 2, `${evAfter - evBefore}`);

    // Stale expect: P6 moves by hand first, then its key is applied -> refused, nothing written.
    await svc.from('sales_goals').update({ pipeline_status: 'first_email_sent' }).eq('id', P6.id);
    r = await call(jack, 'POST', '/partners/apollo-touches/apply', { keys: [k6] });
    ok('A9 key whose partner moved since the dry run -> refused (already at or past), 0 applied', r.body.applied.length === 0 && /already at or past/.test(refusedBy[k6] || r.body.refused[0]?.reason), JSON.stringify(r.body.refused));

    // Undo P2's Apollo move through the existing undo route (latest event on P2, inside the window).
    const p2Event = evs.find(e => e.goal_id === P2.id);
    r = await call(jack, 'POST', `/partners/${P2.id}/undo`, { event_id: p2Event.id });
    const g2b = await goalRow(B, P2.id);
    ok('A10 undo via the existing route -> P2 back to researching, first_email_at + last_touch_at restored to null', r.status === 200 && g2b.pipeline_status === 'researching' && g2b.first_email_at === null && g2b.last_touch_at === null, JSON.stringify({ status: r.status, g2b }));
    r = await call(jack, 'GET', '/partners/apollo-touches');
    ok('A11 re-run dry run: P2 (undone) reads "already applied" - dedupe survives the undo - and P1 (still Replied) reads "already at or past"; neither re-proposed', r.body.proposed.every(m => ![P1.id, P2.id].includes(m.goal_id)) && /already applied/.test(r.body.skipped.find(s => s.goal_id === P2.id)?.reason) && /already at or past replied/.test(r.body.skipped.find(s => s.goal_id === P1.id)?.reason), JSON.stringify(r.body.skipped.map(s => [s.partner, s.reason])));
    const evBefore2 = (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
    r = await call(jack, 'POST', '/partners/apollo-touches/apply', { keys: [k1, k2] });
    const evAfter2 = (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
    ok('A12 re-POST the same keys -> 0 applied, 2 refused, no new event rows (0 duplicates)', r.body.applied.length === 0 && r.body.refused.length === 2 && evAfter2 === evBefore2);
    ok('A13 no email address in any response or the server log', !/@/.test(log) && !JSON.stringify(r.body).includes('@'));

    browser = await chromium.launch();
    const D = await newPage(jack, 1440, 900); await navPartners(D.page, false);
    await openRow(D.page, P1.id);
    const dd = D.page.locator(`[data-partner-id="${P1.id}"]`).first();
    const act = await dd.getByRole('list', { name: 'Activity timeline' }).getByRole('listitem').first().innerText();
    await D.page.screenshot({ path: `${OUT}/1440-activity-from-apollo.png`, fullPage: false });
    ok('A14 1440: P1 Activity top row reads "Emailed Dana Test → Replied · from Apollo"', /Emailed Dana Test → Replied/.test(act) && /from Apollo/.test(act), act.replace(/\n/g, ' | '));
    ok('A15 1440: row stage shows Replied, 0 console errors', /Replied/.test(await row(D.page, P1.id).innerText()) && D.errs.length === 0, D.errs.join(' ; '));
    const M = await newPage(jack, 390, 844); await navPartners(M.page, true);
    await openRow(M.page, P1.id);
    const mact = await M.page.locator(`[data-partner-id="${P1.id}"]`).first().getByRole('list', { name: 'Activity timeline' }).getByRole('listitem').first().innerText();
    await M.page.screenshot({ path: `${OUT}/390-activity-from-apollo.png`, fullPage: false });
    const noSideways = await M.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    ok('A16 390: same row with "from Apollo", no sideways scroll, 0 console errors', /from Apollo/.test(mact) && noSideways && M.errs.length === 0, M.errs.join(' ; '));

    if (APPLY_HL) {
      const dry = await T.dryRun(svc, HL);
      const target = dry.proposed.find(m => m.key === HL_KEY);
      ok('B1 HomeLover dry run still proposes the approved Domuso key from not_started (Jack has not moved it)', !!target && target.partner === 'Domuso' && target.from === 'not_started' && target.to === 'first_email_sent' && target.date === '2026-08-27', JSON.stringify(target));
      ok('B2 HomeLover held list = Bilt + Stake (all paused), proposed = Domuso only', dry.held.map(h => h.partner).sort().join() === 'Bilt,Stake' && dry.proposed.length === 1, JSON.stringify({ held: dry.held.map(h => [h.partner, h.reason]), proposed: dry.proposed.map(m => m.partner) }));
      if (target) {
        const res = await T.applyApolloTouches(svc, { businessId: HL, keys: [HL_KEY], byUser: HL_JACK });
        console.log('   HomeLover apply result:', JSON.stringify(res));
        const dom = await goalRow(HL, target.goal_id);
        ok('B3 Domuso applied: first_email_sent, first_email_at 2026-08-27, last_touch_at Aug 27 midday LA', res.applied.length === 1 && res.refused.length === 0 && dom.pipeline_status === 'first_email_sent' && dom.first_email_at === '2026-08-27' && dom.last_touch_at === '2026-08-27T19:00:00+00:00', JSON.stringify(dom));
        const ev = (await svc.from('sales_partner_events').select('*').eq('business_id', HL).eq('goal_id', target.goal_id).order('recorded_at', { ascending: false }).limit(1).single()).data;
        ok('B4 Domuso event row: touch/email, source apollo, meta.apollo_key = approved key, by Jack, contact Becki Lord-Pauley, dated 2026-08-27', ev.event === 'touch' && ev.touch_type === 'email' && ev.source === 'apollo' && ev.meta.apollo_key === HL_KEY && ev.by_user === HL_JACK && ev.contact_names[0] === 'Becki Lord-Pauley' && ev.at === '2026-08-27T19:00:00+00:00', JSON.stringify([ev.event, ev.source, ev.meta.apollo_key, ev.at]));
        ok('B5 the fields the Activity row renders from (same path as A14): touch/email + contact Becki Lord-Pauley + to Sent + source apollo -> "Emailed Becki Lord-Pauley → Sent · from Apollo"', ev.event === 'touch' && ev.touch_type === 'email' && ev.contact_names.join() === 'Becki Lord-Pauley' && ev.to_status === 'first_email_sent' && ev.source === 'apollo');
        const dry2 = await T.dryRun(svc, HL);
        ok('B6 HomeLover re-run: 0 proposed, Domuso reads "already at or past first_email_sent", Bilt + Stake still held', dry2.proposed.length === 0 && /already at or past first_email_sent/.test(dry2.skipped.find(s => s.key === HL_KEY)?.reason) && dry2.held.length === 2, JSON.stringify(dry2.skipped.map(s => [s.partner, s.reason])));
      }
    }
  } catch (e) {
    console.log('ERROR', e.stack || e.message);
  } finally {
    await cleanup();
    const after = await snap(), hlAfter = await hlSnap();
    const expected = { ...before, sales_partner_events: before.sales_partner_events + (APPLY_HL ? 1 : 0) };
    const same = JSON.stringify(after) === JSON.stringify(expected);
    console.log(`\n${pass}/${total} passed · screenshots in ${OUT}`);
    if (!same) console.log('counts before', before, 'after', after);
    const changed = hlAfter.goals.filter(g => JSON.stringify(g) !== JSON.stringify(hlBefore.goals.find(x => x.id === g.id)));
    console.log(`HomeLover: events ${hlBefore.ev} -> ${hlAfter.ev}, contacts ${hlBefore.pc} -> ${hlAfter.pc}, partners changed: ${changed.map(g => g.name).join(', ') || 'none'}`);
    const hlOk = APPLY_HL ? (hlAfter.ev - hlBefore.ev === 1 && hlAfter.pc === hlBefore.pc && changed.length === 1 && changed[0].name === 'Domuso') : JSON.stringify(hlAfter) === JSON.stringify(hlBefore);
    console.log(`restored: ${same && hlOk ? (APPLY_HL ? 'yes (temp workspace); HomeLover changed by exactly the approved Domuso move' : 'yes') : 'NO'}`);
    process.exit(pass === total && same && hlOk ? 0 : 1);
  }
})();
