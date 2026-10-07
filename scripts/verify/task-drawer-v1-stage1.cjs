// task-drawer-v1 Stage 1 live check. Temp workspaces T1/T2 + temp users only; HomeLover untouched. API only, no browser. Cap 4 min.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3981, tag = 'td1-' + Date.now();
const WATCH = ['businesses', 'business_members', 'sales_goals', 'sales_week_goals', 'sales_week_goal_steps', 'sales_sequenced_accounts', 'profiles', 'auth_events'];
const made = { biz: [], users: [] };
let srv, log = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (srv) srv.kill();
  for (const b of made.biz) {
    await svc.from('sales_week_goals').update({ carried_from_id: null }).eq('business_id', b);
    for (const t of ['sales_week_goal_steps', 'sales_week_goals', 'sales_goals', 'sales_sequenced_accounts', 'business_members', 'auth_events']) await svc.from(t).delete().eq('business_id', b);
  }
  for (const u of made.users) { await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  for (const b of made.biz) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(name) {
  const email = `${tag}-${name}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: `Zz ${name}`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  return { id: u.user.id, email, token: (await c.auth.signInWithPassword({ email, password })).data.session.access_token };
}
const member = (biz, u, role) => svc.from('business_members').insert({ business_id: biz, email: u.email, name: u.email, user_id: u.id, role }).then(ins);
const workspace = async owner => { const b = ins(await svc.from('businesses').insert({ name: `ZZ TD ${made.biz.length} ${tag.slice(-4)}`, website_url: 'https://example.com', color: '#777777', owner_email: owner.email, access_code: `${tag}-${made.biz.length}`, features: { goals_sales: true } }).select().single()).id; made.biz.push(b); return b; };

(async () => {
  const before = await snap(); const t0 = Date.now();
  try {
    const M1 = await user('m1'), M2 = await user('m2'), V = await user('v'), O = await user('o'), O2 = await user('o2');
    const T1 = await workspace(O), T2 = await workspace(O2);
    await member(T1, M1, 'member'); await member(T1, M2, 'member'); await member(T1, V, 'viewer'); await member(T1, O, 'owner'); await member(T2, O2, 'owner');
    const { addDays } = await import(ROOT + '/api/sales/goalsShared.js');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(), WEEK = addDays(today, -((dow + 6) % 7)), PREV = addDays(WEEK, -7);
    const partner = ins(await svc.from('sales_goals').insert({ business_id: T1, goal_type: 'partnership', name: 'ZZ Partner', pipeline_status: 'not_started' }).select().single());
    const partner2 = ins(await svc.from('sales_goals').insert({ business_id: T2, goal_type: 'partnership', name: 'ZZ Foreign', pipeline_status: 'not_started' }).select().single());
    ins(await svc.from('sales_sequenced_accounts').insert([{ business_id: T1, account_id: 'zz-acc-1', first_sequenced_at: new Date().toISOString(), week_start: WEEK }, { business_id: T2, account_id: 'zz-acc-2', first_sequenced_at: new Date().toISOString(), week_start: WEEK }]).select());
    srv = spawn('node', ['--dns-result-order=ipv4first', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T1},${T2}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 50 && !log.includes(`port ${PORT}`); i++) await wait(200);
    const call = (u, biz, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${biz}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `prospector_at=${encodeURIComponent(u.token)}` }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

    console.log('--- link + due + creator');
    const commit = (await call(O, T1, 'POST', '/week', { week_start: WEEK, kind: 'commitment', text: 'ZZ commitment' })).body.goal;
    let r = await call(M1, T1, 'POST', '/week', { week_start: WEEK, kind: 'todo', text: 'ZZ task', due_date: addDays(WEEK, 3), link_type: 'commitment', link_id: commit.id });
    const task = r.body.goal;
    ok('create to-do linked to a commitment, with due date; created_by = caller', r.status === 201 && task.link_type === 'commitment' && task.link_id === commit.id && task.due_date === addDays(WEEK, 3) && task.created_by === M1.id, JSON.stringify(r.body).slice(0, 200));
    for (const [type, id] of [['metric', 'partners_first_touched'], ['partner', partner.id], ['company', 'zz-acc-1']]) {
      r = await call(M1, T1, 'PATCH', `/week/${task.id}`, { link_type: type, link_id: id });
      const list = await call(M1, T1, 'GET', `/tasks?link_type=${type}&link_id=${encodeURIComponent(id)}`);
      ok(`relink to ${type}; list-by-link returns it`, r.status === 200 && r.body.goal.link_type === type && list.status === 200 && list.body.tasks.length === 1 && list.body.tasks[0].id === task.id && Array.isArray(list.body.tasks[0].steps), `${r.status} ${JSON.stringify(r.body).slice(0, 120)} list ${list.status} ${list.body.tasks?.length}`);
    }
    r = await call(M1, T1, 'GET', '/tasks?link_type=company');
    ok('list by type only (no id) returns linked to-dos', r.status === 200 && r.body.tasks.length === 1);
    r = await call(M1, T1, 'PATCH', `/week/${task.id}`, { due_date: addDays(WEEK, 4) });
    ok('PATCH without link fields keeps the link', r.status === 200 && r.body.goal.link_type === 'company' && r.body.goal.link_id === 'zz-acc-1');

    console.log('--- refused links');
    const bad = [
      ['link_type without link_id', { link_type: 'partner' }],
      ['unknown metric key', { link_type: 'metric', link_id: 'not_a_metric' }],
      ['partner from another workspace', { link_type: 'partner', link_id: partner2.id }],
      ['company from another workspace', { link_type: 'company', link_id: 'zz-acc-2' }],
      ['commitment id that is a to-do', { link_type: 'commitment', link_id: task.id }],
      ['partner id that is not a uuid', { link_type: 'partner', link_id: 'nope' }],
      ['bad link_type', { link_type: 'deal', link_id: 'x' }],
    ];
    for (const [n, body] of bad) { r = await call(M1, T1, 'PATCH', `/week/${task.id}`, body); ok(`refused: ${n} (400)`, r.status === 400, `${r.status} ${r.body.error}`); }
    r = await call(O, T1, 'PATCH', `/week/${commit.id}`, { link_type: 'metric', link_id: 'meetings_set' });
    ok('refused: linking a commitment (only to-dos link)', r.status === 400, r.body.error);
    r = await call(M1, T1, 'GET', '/tasks?link_type=deal');
    ok('list-by-link with bad link_type -> 400', r.status === 400);
    r = await call(M1, T1, 'GET', `/week?from=${WEEK}&to=${WEEK}&kind=todo`);
    ok('after refusals the to-do still links to its company', r.body.goals.find(g => g.id === task.id)?.link_id === 'zz-acc-1');
    r = await call(M1, T1, 'PATCH', `/week/${task.id}`, { link_type: null, link_id: null });
    ok('clear link with both null', r.status === 200 && r.body.goal.link_type === null && r.body.goal.link_id === null);

    console.log('--- access');
    r = await call(M1, T2, 'GET', '/tasks?link_type=partner');
    const r2 = await call(M1, T2, 'POST', '/week', { week_start: WEEK, text: 'x', link_type: 'metric', link_id: 'meetings_set' });
    ok('other workspace: list and create refused (403)', r.status === 403 && r2.status === 403, `${r.status},${r2.status}`);
    const vr = await Promise.all([call(V, T1, 'POST', '/week', { week_start: WEEK, text: 'v' }), call(V, T1, 'PATCH', `/week/${task.id}`, { link_type: 'metric', link_id: 'meetings_set' }), call(V, T1, 'DELETE', `/week/${task.id}`), call(V, T1, 'GET', '/tasks?link_type=metric')]);
    ok('viewer: create / link / delete refused (403), list readable', vr.slice(0, 3).every(x => x.status === 403) && vr[3].status === 200, vr.map(x => x.status).join(','));

    console.log('--- delete rule (creator within 2 min, or Owner/Admin)');
    const mk = async (u, text) => (await call(u, T1, 'POST', '/week', { week_start: WEEK, text })).body.goal;
    const a = await mk(M1, 'ZZ del a');
    r = await call(M2, T1, 'DELETE', `/week/${a.id}`); ok('another member deleting it -> 403 (drop instead)', r.status === 403, r.body.error);
    r = await call(M1, T1, 'DELETE', `/week/${a.id}`); ok('creator within 2 min -> deleted', r.status === 200);
    const b = await mk(M1, 'ZZ del b');
    await svc.from('sales_week_goals').update({ created_at: new Date(Date.now() - 3 * 60e3).toISOString() }).eq('id', b.id);
    r = await call(M1, T1, 'DELETE', `/week/${b.id}`); ok('creator after 2 min -> 403', r.status === 403);
    r = await call(O, T1, 'DELETE', `/week/${b.id}`); ok('Owner deletes anyone\'s, any time', r.status === 200);
    const old = ins(await svc.from('sales_week_goals').insert({ business_id: T1, week_start: WEEK, kind: 'todo', text: 'ZZ pre-migration' }).select().single());
    r = await call(M1, T1, 'DELETE', `/week/${old.id}`); ok('to-do with no creator (pre-migration): member -> 403', r.status === 403);
    const flag = ins(await svc.from('sales_week_goals').insert({ business_id: T1, week_start: WEEK, kind: 'todo', text: 'ZZ old flag', flagged_by: M1.id }).select().single());
    r = await call(M1, T1, 'DELETE', `/week/${flag.id}`); ok('flag without created_by: flagger within 2 min -> deleted', r.status === 200);

    console.log('--- commitment delete + carry-over');
    const t2 = (await call(M1, T1, 'POST', '/week', { week_start: WEEK, text: 'ZZ linked', link_type: 'commitment', link_id: commit.id })).body.goal;
    r = await call(O, T1, 'DELETE', `/week/${commit.id}`);
    const after = ins(await svc.from('sales_week_goals').select('link_type,link_id').eq('id', t2.id).single());
    ok('deleting a commitment clears links to it (to-do kept)', r.status === 200 && after.link_type === null && after.link_id === null);
    const NEXT = addDays(WEEK, 7);
    const c0 = (await call(O, T1, 'POST', '/week', { week_start: WEEK, kind: 'commitment', text: 'ZZ carry commitment' })).body.goal;
    const k0 = (await call(M1, T1, 'POST', '/week', { week_start: WEEK, text: 'ZZ carry task', due_date: addDays(WEEK, 2), link_type: 'commitment', link_id: c0.id })).body.goal;
    const k1 = (await call(M1, T1, 'POST', '/week', { week_start: WEEK, text: 'ZZ carry task partner', link_type: 'partner', link_id: partner.id })).body.goal;
    r = await call(M1, T1, 'POST', '/week/carry-over', { week_start: NEXT });
    const nc = r.body.carried?.find(g => g.carried_from_id === c0.id), nk = r.body.carried?.find(g => g.carried_from_id === k0.id), nk1 = r.body.carried?.find(g => g.carried_from_id === k1.id);
    const nkDb = nk && ins(await svc.from('sales_week_goals').select('*').eq('id', nk.id).single());
    ok('carry-over: linked to-do follows its commitment\'s copy; due + creator copied', r.status === 200 && nc && nkDb && nkDb.link_id === nc.id && nkDb.due_date === addDays(WEEK, 2) && nkDb.created_by === M1.id, JSON.stringify(nkDb || r.body).slice(0, 200));
    ok('carry-over: partner link copied as-is', nk1 && nk1.link_type === 'partner' && nk1.link_id === partner.id);
    r = await call(M1, T1, 'POST', '/week/carry-over', { week_start: NEXT });
    ok('carry-over twice: nothing new', r.status === 200 && r.body.carried.length === 0);
  } catch (e) { console.log('ERROR', e.stack.split('\n').slice(0, 2).join(' ')); total++; }
  await cleanup();
  const after = await snap();
  const diff = Object.keys(after).filter(k => after[k] !== before[k]).map(k => `${k} ${before[k]} -> ${after[k]}`);
  console.log(`\n${pass}/${total} passed in ${Math.round((Date.now() - t0) / 1000)}s | watched tables changed: ${diff.join('; ') || 'none'} | restored: ${diff.length ? 'NO' : 'yes'}`);
  console.log('server errors:', log.split('\n').filter(l => /error/i.test(l) && !/Warning/.test(l)).slice(0, 3).join(' | ') || 'none');
  process.exit(0);
})();
