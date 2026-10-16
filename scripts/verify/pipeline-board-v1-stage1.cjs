// pipeline-board-v1 Stage 1 live check. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 2 temp users (member + viewer), 3 partners, 3 opportunities, 2 targets, 3 sequenced accounts. Calls GET goals/pipeline-board on a local server.js 6 times, compares to the DB. HomeLover: 3 head-only counts for the apollo_account_id fill rate + the before/after table counts. 0 writes there, 0 Apollo / 0 Claude / 0 syncs. ~20 s, cap 2 min.
// Usage: node scripts/verify/pipeline-board-v1-stage1.cjs
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3991, tag = 'pb-' + Date.now();
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const TABLES = ['sales_goals', 'sales_opportunities', 'sales_targets', 'sales_sequenced_accounts'];
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
  if (b) for (const t of ['sales_sequenced_accounts', 'sales_targets', 'sales_opportunity_events', 'sales_opportunities', 'sales_goals', 'business_members', 'auth_events']) {
    const r = await svc.from(t).delete().eq('business_id', b); if (r.error) console.log(`cleanup ${t}: ${r.error.message}`);
  }
  for (const u of made.users) { await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  if (b) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(T, role) {
  const email = `${tag}-${role}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  ins(await svc.from('business_members').insert({ business_id: T, email, name: `${role} Zz`, user_id: u.user.id, role }).select());
  const s = (await createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password })).data.session;
  return { id: u.user.id, token: s.access_token };
}

(async () => {
  const hlBefore = await counts(HOMELOVER);
  const hc = q => q.then(r => { if (r.error) throw new Error(r.error.message); return r.count; });
  const opp = () => svc.from('sales_opportunities').select('id', { count: 'exact', head: true }).eq('business_id', HOMELOVER).is('archived_at', null);
  const fill = {
    opps: await hc(opp()),
    withApollo: await hc(opp().not('apollo_account_id', 'is', null)),
    sequenced: hlBefore.sales_sequenced_accounts,
  };
  console.log(`HomeLover apollo_account_id fill: ${fill.withApollo}/${fill.opps} live opportunities (${fill.opps ? Math.round(100 * fill.withApollo / fill.opps) : 0}%); ${fill.sequenced} sequenced accounts`);
  try {
    const T = made.biz = ins(await svc.from('businesses').insert({ name: `ZZ Board ${tag.slice(-4)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const member = await user(T, 'member'), viewer = await user(T, 'viewer');
    ins(await svc.from('sales_goals').insert([
      { business_id: T, goal_type: 'partnership', name: 'Gallagher Zz', pipeline_status: 'meeting_set', category: '3. Brokers', tier: '1', hot: true, owner_user_id: member.id, owner_team: 'homelover', known_contacts: 'ann@gallagher.example 312-555-0100' },
      { business_id: T, goal_type: 'partnership', name: 'OneDigital Zz', pipeline_status: 'replied', category: '3. Brokers', tier: '2', hot: false, owner_team: 'upside' },
      { business_id: T, goal_type: 'partnership', name: 'Current Zz', pipeline_status: 'in_sequence', category: '1. Current Partners (active)', tier: 'active', hot: false },
    ]).select());
    ins(await svc.from('sales_opportunities').insert([
      { business_id: T, organization: 'Solidcore Zz', org_type: 'employer', stage: 'meeting', owner: 'Jack', is_top: true, apollo_account_id: `${tag}-A1`, next_action_date: '2026-10-20', source: 'manual' },
      { business_id: T, organization: 'Union Zz', org_type: 'membership', stage: 'nurture', is_top: false, source: 'manual' },
      { business_id: T, organization: 'Channel Zz', org_type: 'channel_partner', stage: 'responded', is_top: false, source: 'manual' },
    ]).select());
    ins(await svc.from('sales_targets').insert([
      { business_id: T, name: 'Target Zz', kind: 'partner', status: 'proposed', owner_team: 'upside' },
      { business_id: T, name: 'Rejected Zz', kind: 'employer', status: 'rejected' },
    ]).select());
    ins(await svc.from('sales_sequenced_accounts').insert([
      { business_id: T, account_id: `${tag}-A1`, name: 'Solidcore Zz', first_sequenced_at: '2026-10-05T15:00:00Z', week_start: '2026-10-05', mailbox_email: `${tag}-mb@example.com` },
      { business_id: T, account_id: `${tag}-A2`, name: 'Channel Zz, Inc.', first_sequenced_at: '2026-10-05T15:00:00Z', week_start: '2026-10-05' },
      { business_id: T, account_id: `${tag}-A3`, name: 'Fresh Zz', first_sequenced_at: '2026-10-05T15:00:00Z', week_start: '2026-10-05', mailbox_email: `${tag}-mb@example.com` },
    ]).select());

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(250); } }
    const get = (who, qs = '') => fetch(`http://localhost:${PORT}/api/sales/${T}/goals/pipeline-board${qs}`, { headers: { Cookie: `prospector_at=${encodeURIComponent(who.token)}` } }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})), text: '' }));

    const all = await get(member);
    const names = (all.body.rows || []).map(r => `${r.name}:${r.color}`);
    ok('member GET 200: 3 partners + employer/membership opps + open target, color-sorted',
      all.status === 200 && JSON.stringify(names) === JSON.stringify(['Current Zz:green', 'Gallagher Zz:yellow', 'Solidcore Zz:yellow', 'OneDigital Zz:blue', 'Target Zz:light', 'Union Zz:faded']), JSON.stringify({ s: all.status, names, e: all.body.error }));
    const dbPartners = ins(await svc.from('sales_goals').select('id, hot, pipeline_status').eq('business_id', T));
    const g = all.body.rows?.find(r => r.name === 'Gallagher Zz');
    const dbG = dbPartners.find(p => p.id === g?.id);
    const dbName = ins(await svc.from('profiles').select('display_name').eq('id', member.id).single()).display_name || 'member Zz';
    ok('Gallagher row matches the DB (stage, top = hot, owner = profile name, team)', g && dbG && g.stage === dbG.pipeline_status && g.top === dbG.hot && g.owner === dbName && g.owner_team === 'homelover', JSON.stringify(g));
    const raw = JSON.stringify(all.body);
    ok('payload carries no email, phone or Apollo id', !raw.includes('@') && !/555-0100/.test(raw) && !raw.includes(`${tag}-A1`));

    const v = await get(viewer);
    ok('viewer GET 200, same rows', v.status === 200 && v.body.rows?.length === all.body.rows?.length);

    const ap = await get(member, '?include_apollo=true&type=apollo');
    ok('Apollo-only: only Fresh Zz (Solidcore linked by Apollo id, Channel linked by name)', ap.status === 200 && JSON.stringify(ap.body.rows.map(r => r.name)) === '["Fresh Zz"]' && !JSON.stringify(ap.body).includes('@'), JSON.stringify(ap.body.rows?.map(r => r.name)));

    const up = await get(member, '?owner_team=upside');
    ok('filter owner_team=upside: OneDigital + Target', up.status === 200 && JSON.stringify(up.body.rows.map(r => r.name)) === '["OneDigital Zz","Target Zz"]', JSON.stringify(up.body.rows?.map(r => r.name)));

    const bad = await get(member, '?color=pink');
    ok('bad enum -> 400', bad.status === 400);
  } catch (err) {
    ok('script ran without throwing', false, err.stack?.split('\n').slice(0, 3).join(' '));
  } finally {
    await cleanup();
    const left = made.biz ? (await svc.from('businesses').select('id').eq('id', made.biz)).data.length : 0;
    const users = (await Promise.all(made.users.map(u => svc.auth.admin.getUserById(u)))).filter(r => r.data?.user).length;
    const hlAfter = await counts(HOMELOVER);
    const diff = TABLES.filter(t => hlBefore[t] !== hlAfter[t]);
    ok('teardown complete (workspace + temp users gone)', left === 0 && users === 0);
    ok(`HomeLover counts identical (${TABLES.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
    console.log(`${pass}/${total} passed · ${!diff.length && left === 0 && users === 0 ? 'restored: yes' : 'restored: NO - see above'}`);
    process.exit(pass === total ? 0 : 1);
  }
})();
