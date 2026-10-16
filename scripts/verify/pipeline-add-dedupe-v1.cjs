// FIX pipeline-add-dedupe-v1 live check. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 1 temp member, 2 opportunities (Solidcore at contacted, Acme Co at meeting), 3 prospect rows. Calls the real routes on a local server.js: Huddle add-to-pipeline x2 + POST /opportunities x2. 0 Apollo / 0 Claude / 0 syncs; HomeLover is only COUNTED. ~20 s, cap 2 min.
// Usage: node scripts/verify/pipeline-add-dedupe-v1.cjs
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3989, tag = 'pad-' + Date.now();
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const TABLES = ['sales_opportunities', 'sales_opportunity_events', 'sales_prospect_state'];
const made = { biz: null, users: [] };
let srv, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const cleanup = require('./lib/tempGuard.cjs')(removeTemp, { capMs: 120000 });

async function counts(biz) {
  const o = {};
  for (const t of TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', biz); o[t] = r.error ? 'err' : r.count; }
  return o;
}
async function removeTemp() {
  if (srv) srv.kill();
  const b = made.biz;
  if (b) for (const t of ['sales_prospect_state', 'sales_opportunity_events', 'sales_opportunities', 'business_members', 'auth_events']) {
    const r = await svc.from(t).delete().eq('business_id', b); if (r.error) console.log(`cleanup ${t}: ${r.error.message}`);
  }
  for (const u of made.users) { await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  if (b) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}

(async () => {
  const hlBefore = await counts(HOMELOVER);
  try {
    const T = made.biz = ins(await svc.from('businesses').insert({ name: `ZZ Dedupe ${tag.slice(-4)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const email = `${tag}-m@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
    const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
    ins(await svc.from('business_members').insert({ business_id: T, email, name: 'Member Zz', user_id: u.user.id, role: 'member' }).select());
    const session = (await createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password })).data.session;
    const opps = ins(await svc.from('sales_opportunities').insert([
      { business_id: T, organization: 'Solidcore', org_type: 'employer', stage: 'contacted', source: 'csv' },
      { business_id: T, organization: 'Acme Co', org_type: 'employer', stage: 'meeting', source: 'manual' },
    ]).select());
    const solid = opps.find(o => o.organization === 'Solidcore'), acme = opps.find(o => o.organization === 'Acme Co');
    ins(await svc.from('sales_prospect_state').insert([
      { business_id: T, contact_id: `${tag}-c1`, name: 'Pat Zz', company: '[solidcore]', owner: 'jack', status: 'new' },
      { business_id: T, contact_id: `${tag}-c2`, name: 'Sam Zz', company: 'ACME, Inc.', owner: 'jack', status: 'new' },
      { business_id: T, contact_id: `${tag}-c3`, name: 'Lee Zz', company: 'Brand New Co', owner: 'jack', status: 'new' },
    ]).select());

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(250); } }
    const call = (method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${T}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `prospector_at=${encodeURIComponent(session.access_token)}` }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const oppCount = async () => (await svc.from('sales_opportunities').select('id', { count: 'exact', head: true }).eq('business_id', T).is('archived_at', null)).count;
    const stageOf = async id => ins(await svc.from('sales_opportunities').select('stage').eq('id', id).single()).stage;
    const linkOf = async c => ins(await svc.from('sales_prospect_state').select('opportunity_id').eq('business_id', T).eq('contact_id', `${tag}-${c}`).single()).opportunity_id;

    const a = await call('POST', `/prospects/${tag}-c1/pipeline`, { org_type: 'employer', cohort: 'Fitness' });
    ok('Huddle add "[solidcore]": 200 reused, links the existing Solidcore, no new row, contacted -> responded',
      a.status === 200 && a.body.reused === true && a.body.opportunity?.id === solid.id && await oppCount() === 2 && await linkOf('c1') === solid.id && await stageOf(solid.id) === 'responded', JSON.stringify({ s: a.status, r: a.body.reused, e: a.body.error }));
    const ev = ins(await svc.from('sales_opportunity_events').select('from_stage, to_stage').eq('opportunity_id', solid.id).eq('event_type', 'stage_change'));
    ok('the forward move is logged by the trigger (contacted -> responded)', ev.length === 1 && ev[0].from_stage === 'contacted' && ev[0].to_stage === 'responded', JSON.stringify(ev));

    const b = await call('POST', `/prospects/${tag}-c2/pipeline`, { org_type: 'employer' });
    ok('Huddle add "ACME, Inc.": reused Acme Co, stays meeting (never backwards), linked', b.status === 200 && b.body.reused === true && await stageOf(acme.id) === 'meeting' && await linkOf('c2') === acme.id && await oppCount() === 2);

    const c = await call('POST', `/prospects/${tag}-c3/pipeline`, { org_type: 'employer' });
    ok('Huddle add a new company still creates one row (201, not reused)', c.status === 201 && !c.body.reused && await oppCount() === 3 && await linkOf('c3') === c.body.opportunity?.id);

    const d = await call('POST', '/opportunities', { organization: 'solidcore', org_type: 'employer', stage: 'target' });
    ok('POST /opportunities "solidcore": 200 reused, stays responded, no new row', d.status === 200 && d.body.reused === true && d.body.opportunity?.id === solid.id && await stageOf(solid.id) === 'responded' && await oppCount() === 3);
    const e = await call('POST', '/opportunities', { organization: 'Zeta Labs', org_type: 'employer' });
    ok('POST /opportunities a new name still creates (201)', e.status === 201 && !e.body.reused && await oppCount() === 4);
  } catch (err) {
    ok('script ran without throwing', false, err.stack?.split('\n').slice(0, 3).join(' '));
  } finally {
    await cleanup();
    const left = made.biz ? (await svc.from('businesses').select('id').eq('id', made.biz)).data.length : 0;
    const hlAfter = await counts(HOMELOVER);
    const diff = TABLES.filter(t => hlBefore[t] !== hlAfter[t]);
    ok('teardown complete (workspace gone)', left === 0);
    ok(`HomeLover counts identical (${TABLES.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
    console.log(`${pass}/${total} passed · ${!diff.length && left === 0 ? 'restored: yes' : 'restored: NO - see above'}`);
    process.exit(pass === total ? 0 : 1);
  }
})();
