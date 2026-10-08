// partner-360-v1 Stage 4 step 1 (dry run only) check. SCOPE: 0 Apollo calls, 0 writes outside a TEMP workspace. Part A = HomeLover read-only (4 selects: partners, Apollo partner_contacts, apollo-sourced events, replied messages for those contacts) run through loadApolloTouchInputs + proposeMoves - prints EVERY proposed move with reason, date, key (no emails ever read). Part B = TEMP workspace (2 temp users member + viewer, 4 temp partners, 4 temp partner_contacts, 2 temp replied messages, 1 pre-applied apollo event): the GET route end to end - member 200 with the expected proposals / skips, viewer 403, nothing written by the route. ~40 s, cap 4 min. No browser (step 1 has no UI). Needs the server (node server.js on PORT) - no build required for API routes.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const OUT = process.argv[2] || '/tmp/partner-360-stage4-step1'; fs.mkdirSync(OUT, { recursive: true });
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95', PORT = 3962, tag = 'p360d-' + Date.now();
const WATCH = ['businesses', 'business_members', 'sales_goals', 'sales_partner_events', 'partner_contacts', 'sales_email_messages', 'profiles', 'auth_events'];
const made = { users: [], biz: [] };
let srv, log = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const hlSnap = async () => JSON.stringify({
  ev: (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count,
  pc: (await svc.from('partner_contacts').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count,
  goals: (await svc.from('sales_goals').select('id,pipeline_status,updated_at').eq('business_id', HL).eq('goal_type', 'partnership').order('id')).data,
});
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
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
  return { id: u.user.id, cookie: `prospector_at=${encodeURIComponent(s.session.access_token)}` };
}
const line = m => `${m.partner.padEnd(28)} ${m.from.padEnd(20)} -> ${m.to.padEnd(16)} ${m.date} (${m.date_label})  ${m.reason}  key=${m.key}`;

(async () => {
  const before = await snap(), hlBefore = await hlSnap();
  const T = await import(ROOT + '/api/sales/partnerApolloTouches.js');
  try {
    const inputs = await T.loadApolloTouchInputs(svc, HL);
    const { proposed, skipped } = T.proposeMoves(inputs);
    console.log(`A  HomeLover (read-only): ${inputs.partners.length} partners, ${inputs.contacts.length} Apollo contacts (${inputs.contacts.filter(c => c.sequence_added_at).length} with sequence_added_at), ${inputs.messages.length} stored replies by those contacts, ${inputs.events.length} apollo-sourced events already`);
    console.log(`\n   PROPOSED MOVES (${proposed.length}):`);
    for (const m of proposed) console.log('   ' + line(m));
    if (!proposed.length) console.log('   (none)');
    console.log(`\n   SKIPPED (${skipped.length}):`);
    for (const m of skipped) console.log(`   ${m.partner.padEnd(28)} ${m.from.padEnd(20)} x  ${(m.to || '').padEnd(16)} ${m.reason}`);
    if (!skipped.length) console.log('   (none)');
    fs.writeFileSync(`${OUT}/homelover-dry-run.json`, JSON.stringify({ computed_at: new Date().toISOString(), proposed, skipped }, null, 2));
    ok('A1 no proposal moves backwards or touches a paused partner', proposed.every(m => T.isBehind(m.from, m.to) && m.from !== 'paused'));
    ok('A2 every proposal has a key, a date <= today, a date label and a named contact; none carries an email', proposed.every(m => m.key && m.date <= new Date().toISOString().slice(0, 10) && m.date_label && m.contact_name && !JSON.stringify(m).includes('@')));
    ok('A3 every Replied proposal is dated replied_seen_at ("seen at sync"), every Sent one "in sequence since"', proposed.every(m => m.date_label === (m.to === 'replied' ? 'seen at sync' : 'in sequence since')));
    ok('A4 at most one proposal per partner', new Set(proposed.map(m => m.goal_id)).size === proposed.length);

    const B = await biz('p360d');
    const jack = await user(B, 'Jack', 'member'), vera = await user(B, 'Vera', 'viewer');
    const partner = async (name, pipeline_status) => ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name, pipeline_status, category: '3. PEOs', tier: '1', owner_user_id: jack.id }).select().single());
    const P1 = await partner('Behind Replied Test', 'first_email_drafted');
    const P2 = await partner('Behind Sent Test', 'researching');
    const P3 = await partner('Already Applied Test', 'not_started');
    const P4 = await partner('Past It Test', 'meeting_set');
    const contact = (g, id, name, sequence_added_at = null) => svc.from('partner_contacts').insert({ business_id: B, goal_id: g.id, apollo_contact_id: id, name, source: 'apollo', sequence_added_at, sequence_status: sequence_added_at ? 'active' : null }).select();
    ins(await contact(P1, `${tag}-c1`, 'Dana Test', '2026-09-20T12:00:00Z'));
    ins(await contact(P2, `${tag}-c2`, 'Pat Test', '2026-09-30T19:00:00Z'));
    ins(await contact(P3, `${tag}-c3`, 'Lee Test'));
    ins(await contact(P4, `${tag}-c4`, 'Sam Test', '2026-10-01T12:00:00Z'));
    ins(await svc.from('sales_email_messages').insert([
      { business_id: B, apollo_message_id: `${tag}-m1`, contact_id: `${tag}-c1`, replied: true, replied_seen_at: '2026-10-03T15:00:00Z', delivered_at: '2026-09-21T10:00:00Z' },
      { business_id: B, apollo_message_id: `${tag}-m3`, contact_id: `${tag}-c3`, replied: true, replied_seen_at: '2026-10-02T15:00:00Z', delivered_at: '2026-09-21T10:00:00Z' },
    ]).select());
    ins(await svc.from('sales_partner_events').insert({ business_id: B, goal_id: P3.id, event: 'touch', touch_type: 'email', from_status: 'not_started', to_status: 'replied', source: 'apollo', meta: { apollo_key: `reply:${tag}-m3`, prev: { pipeline_status: 'not_started' } }, by_user: jack.id }).select());

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`${PORT}`); i++) await wait(250);
    const call = u => fetch(`http://localhost:${PORT}/api/sales/${B}/goals/partners/apollo-touches`, { headers: { Cookie: u.cookie } }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const evBefore = (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
    const goalsBefore = JSON.stringify((await svc.from('sales_goals').select('id,pipeline_status,last_touch_at,first_email_at').eq('business_id', B).order('id')).data);

    let r = await call(vera);
    ok('B1 viewer GET apollo-touches -> 403 (a GET, but members only)', r.status === 403, String(r.status));
    r = await call(jack);
    ok('B2 member GET -> 200, dry_run true, counts present', r.status === 200 && r.body.dry_run === true && r.body.counts?.partners === 4 && r.body.counts?.apollo_contacts === 4 && r.body.counts?.replies === 2 && r.body.counts?.applied_before === 1, JSON.stringify(r.body.counts));
    const byGoal = Object.fromEntries((r.body.proposed || []).map(m => [m.goal_id, m]));
    const p1 = byGoal[P1.id], p2 = byGoal[P2.id];
    ok('B3 P1 (drafted, in sequence AND replied) -> Replied dated replied_seen_at 2026-10-03 "seen at sync", not delivered_at', p1?.to === 'replied' && p1.date === '2026-10-03' && p1.date_label === 'seen at sync' && p1.key === `reply:${tag}-m1` && p1.contact_name === 'Dana Test', JSON.stringify(p1));
    ok('B4 P2 (researching, in sequence since Sep 30 19:00Z = Sep 30 LA) -> Sent "in sequence since" 2026-09-30', p2?.to === 'first_email_sent' && p2.date === '2026-09-30' && p2.date_label === 'in sequence since' && p2.key.startsWith(`sent:${tag}-c2:2026-09-30T19:00:00`) && p2.contact_name === 'Pat Test', JSON.stringify(p2));
    ok('B5 exactly 2 proposals; P3 skipped as already applied; P4 skipped as past it', (r.body.proposed || []).length === 2 && r.body.skipped.some(s => s.goal_id === P3.id && /already applied/.test(s.reason)) && r.body.skipped.some(s => s.goal_id === P4.id && /already at or past/.test(s.reason)), JSON.stringify(r.body.skipped.map(s => [s.partner, s.reason])));
    ok('B6 no email address in the response', !JSON.stringify(r.body).includes('@'));
    const evAfter = (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
    const goalsAfter = JSON.stringify((await svc.from('sales_goals').select('id,pipeline_status,last_touch_at,first_email_at').eq('business_id', B).order('id')).data);
    ok('B7 the dry run wrote nothing: events and partner rows unchanged', evAfter === evBefore && goalsAfter === goalsBefore);
    r = await call(jack);
    ok('B8 second call returns the same proposals (idempotent)', r.status === 200 && r.body.proposed.length === 2);
    ok('B9 server log holds no email address', !/@/.test(log));
  } catch (e) {
    console.log('ERROR', e.stack || e.message);
  } finally {
    await cleanup();
    const after = await snap(), hlAfter = await hlSnap();
    const same = JSON.stringify(after) === JSON.stringify(before);
    console.log(`\n${pass}/${total} passed · dry-run JSON in ${OUT}`);
    if (!same) console.log('counts before', before, 'after', after);
    console.log(`HomeLover untouched: ${hlAfter === hlBefore ? 'yes' : 'NO'}`);
    console.log(`restored: ${same && hlAfter === hlBefore ? 'yes' : 'NO'}`);
    process.exit(pass === total && same ? 0 : 1);
  }
})();
