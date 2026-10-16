// weekly-plan-v1 Stage 1 live check. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 3 temp users (owner-member M, member C, viewer V). Seed: 6 to-dos + 1 Huddle flag, 3 partners, 1 replied prospect, last week's 2 commitments, 1 typed + 2 planned commitments this week, 1 metric target. ONE real Claude call (MODELS.STANDARD, ~$0.02-0.06), 0 Apollo. HomeLover is only COUNTED (15 tables, head requests). Teardown deletes everything; the usage row stays (business_id goes null with the workspace) - it is the cost record. ~60-100s, cap 4 min.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3982, tag = 'wp1-' + Date.now();
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL_TABLES = ['business_members', 'accounts', 'projects', 'sales_goals', 'sales_partner_events', 'sales_week_goals', 'sales_week_goal_steps', 'sales_email_messages', 'sales_email_activity', 'sales_prospect_state', 'partner_contacts', 'microsoft_messages', 'microsoft_events', 'microsoft_sync_runs'];
const made = { biz: null, users: [] };
let srv, log = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const cleanup = require('./lib/tempGuard.cjs')(removeTemp, { capMs: 240000 });

async function hl() {
  const o = { businesses: (await svc.from('businesses').select('*', { count: 'exact', head: true }).eq('id', HOMELOVER)).count };
  for (const t of HL_TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER); o[t] = r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
  return o;
}
async function removeTemp() {
  if (srv) srv.kill();
  const b = made.biz;
  if (b) {
    await svc.from('sales_week_goals').update({ carried_from_id: null, plan_id: null }).eq('business_id', b);
    for (const t of ['sales_week_goal_steps', 'sales_week_goals', 'sales_week_plans', 'sales_metric_targets', 'sales_email_messages', 'sales_prospect_state', 'sales_mailbox_owners', 'sales_sequenced_accounts', 'sales_goals', 'business_members', 'auth_events']) {
      const r = await svc.from(t).delete().eq('business_id', b);
      if (r.error) console.log(`cleanup ${t}: ${r.error.message}`);
    }
  }
  for (const u of made.users) { await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  if (b) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(name) {
  const email = `${tag}-${name}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: `Zz ${name}`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  return { id: u.user.id, email, token: (await c.auth.signInWithPassword({ email, password })).data.session.access_token };
}

(async () => {
  const hlBefore = await hl(); const t0 = Date.now();
  let cost = null;
  try {
    const M = await user('m'), C = await user('c'), V = await user('v');
    const T = ins(await svc.from('businesses').insert({ name: `ZZ Plan ${tag.slice(-4)}`, website_url: 'https://example.com', color: '#777777', owner_email: M.email, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    made.biz = T;
    for (const [u, role] of [[M, 'owner'], [C, 'member'], [V, 'viewer']]) ins(await svc.from('business_members').insert({ business_id: T, email: u.email, name: u.email, user_id: u.id, role }).select());
    const { addDays } = await import(ROOT + '/api/sales/goalsShared.js');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(), WEEK = addDays(today, -((dow + 6) % 7)), LAST = addDays(WEEK, -7);
    const ago = d => new Date(Date.now() - d * 864e5).toISOString();

    const partners = ins(await svc.from('sales_goals').insert([
      { business_id: T, goal_type: 'partnership', name: 'ZZ Upside', pipeline_status: 'meeting_set', owner_user_id: M.id, tier: '1', last_touch_at: ago(2), next_step: 'Send intro list' },
      { business_id: T, goal_type: 'partnership', name: 'ZZ Solidcore', pipeline_status: 'replied', owner_user_id: M.id, tier: '2', last_touch_at: ago(10) },
      { business_id: T, goal_type: 'partnership', name: 'ZZ Marriott', pipeline_status: 'first_email_sent', owner_user_id: M.id, tier: '3', last_touch_at: ago(70) },
    ]).select());
    const [UP, SC, MA] = partners;
    ins(await svc.from('sales_sequenced_accounts').insert({ business_id: T, account_id: 'zz-acc-norton', name: 'ZZ Norton', first_sequenced_at: ago(20), week_start: LAST }).select());
    ins(await svc.from('sales_mailbox_owners').insert({ business_id: T, mailbox_email: `${tag}-m@example.com`, user_id: M.id }).select());
    ins(await svc.from('sales_prospect_state').insert([
      { business_id: T, contact_id: 'zz-c1', name: 'Ana Zz', title: 'VP People', company: 'ZZ Norton', status: 'new' },
      { business_id: T, contact_id: 'zz-c2', name: 'Flag Zz', title: 'Director', company: 'ZZ Acme', status: 'claimed' },
    ]).select());
    ins(await svc.from('sales_email_messages').insert({ business_id: T, apollo_message_id: `${tag}-m1`, contact_id: 'zz-c1', sender: `${tag}-m@example.com`, delivered_at: ago(6), replied: true, reply_class: 'willing_to_meet', replied_at: ago(3) }).select());

    const seedPlans = ins(await svc.from('sales_week_plans').insert([
      { business_id: T, week_start: WEEK, owner_user_id: M.id, prompt: 'seed', inputs: {}, proposals: [], chosen_count: 1, created_by: M.id },
      { business_id: T, week_start: WEEK, owner_user_id: C.id, prompt: 'seed', inputs: {}, proposals: [], chosen_count: 1, created_by: C.id },
    ]).select());
    const goal = g => ({ business_id: T, status: 'open', created_by: M.id, owner_user_id: M.id, ...g });
    const seeded = ins(await svc.from('sales_week_goals').insert([
      goal({ week_start: WEEK, kind: 'todo', text: 'ZZ Send Solidcore the December pricing deck', due_date: addDays(WEEK, 2), link_type: 'partner', link_id: SC.id }),
      goal({ week_start: WEEK, kind: 'todo', text: 'ZZ Follow up with Upside on the intro list', due_date: addDays(WEEK, -3) }),
      goal({ week_start: WEEK, kind: 'todo', text: 'ZZ Build 100-account healthcare cold list' }),
      goal({ week_start: WEEK, kind: 'todo', text: 'ZZ Prep Marriott pilot one-pager', due_date: addDays(WEEK, 4), link_type: 'partner', link_id: MA.id }),
      goal({ week_start: WEEK, kind: 'todo', text: 'ZZ Clean up CRM notes' }),
      goal({ week_start: WEEK, kind: 'todo', text: 'ZZ Book Q4 review with Cyrus', due_date: addDays(WEEK, 1) }),
      goal({ week_start: WEEK, kind: 'todo', text: 'Call Flag Zz back', prospect_contact_id: 'zz-c2', flag_note: 'asked for pricing', category: 'Huddle follow-ups', flagged_by: M.id }),
      goal({ week_start: LAST, kind: 'commitment', text: 'ZZ Close Upside intro call', status: 'done', completed_at: ago(8) }),
      goal({ week_start: LAST, kind: 'commitment', text: 'ZZ Send 100 cold emails', why_not_done: 'list not ready' }),
      goal({ week_start: WEEK, kind: 'commitment', text: 'ZZ Typed commitment' }),
      goal({ week_start: WEEK, kind: 'commitment', text: 'ZZ Old planned commitment', plan_id: seedPlans[0].id, plan_rank: 1, plan_reason: 'seed' }),
      goal({ week_start: WEEK, kind: 'commitment', text: 'ZZ Cyrus planned commitment', owner_user_id: C.id, plan_id: seedPlans[1].id, plan_rank: 1, plan_reason: 'seed' }),
    ]).select());
    const byText = t => seeded.find(g => g.text === t);
    ins(await svc.from('sales_metric_targets').insert({ business_id: T, period: 'week', period_start: WEEK, metric_key: 'meetings_set', goal: 3 }).select());
    const seedIds = {
      partner: new Set(partners.map(p => p.id)), company: new Set(['zz-acc-norton']),
      commitment: new Set([byText('ZZ Typed commitment').id, byText('ZZ Old planned commitment').id]),
      todo: new Set(seeded.filter(g => g.kind === 'todo').map(g => g.id)),
    };
    console.log(`seed: workspace ${T}, week ${WEEK}, 3 partners, 6 to-dos + 1 flag, 1 reply, 5 commitments (2 last week), 2 seed plans`);

    srv = spawn('node', ['--dns-result-order=ipv4first', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 50 && !log.includes(`port ${PORT}`); i++) await wait(200);
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${T}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `prospector_at=${encodeURIComponent(u.token)}` }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

    console.log('--- gates (no Claude call)');
    let r = await call(V, 'POST', '/week/plan/propose', { week_start: WEEK, prompt: 'x' });
    ok('viewer cannot propose (403)', r.status === 403, `${r.status}`);
    r = await call(M, 'POST', '/week/plan/propose', { week_start: addDays(WEEK, 1), prompt: 'x' });
    ok('non-Monday week refused (400)', r.status === 400, `${r.status}`);

    console.log('--- ONE real propose');
    const prompt = 'Upside intros, Solidcore December call, book Ana at Norton, 100 cold to healthcare';
    const tc = Date.now();
    r = await call(M, 'POST', '/week/plan/propose', { week_start: WEEK, prompt });
    console.log(`propose: ${r.status} in ${((Date.now() - tc) / 1000).toFixed(1)}s`);
    ok('propose 200', r.status === 200, JSON.stringify(r.body).slice(0, 300));
    const prop = r.body;
    const P = prop.proposals || [];
    cost = prop.usage?.cost_usd ?? null;
    for (const p of P) console.log(`  ${p.rank}. [${p.kind}/${p.source}] ${p.text}${p.link_type ? ` -> ${p.link_type}` : ''}${p.existing_todo_id ? ' (existing to-do)' : ''}\n       ${p.reason}`);
    console.log(`inputs_summary: ${JSON.stringify(prop.inputs_summary)}`);
    console.log(`usage: ${JSON.stringify(prop.usage)}`);
    ok('1-10 proposals, ranks 1..n', P.length >= 1 && P.length <= 10 && P.every((p, i) => p.rank === i + 1));
    ok('every link_id is in the seed', P.every(p => !p.link_type || (p.link_type === 'metric' ? true : seedIds[p.link_type]?.has(p.link_id))), JSON.stringify(P.map(p => [p.link_type, p.link_id])));
    ok('every existing_todo_id is a seeded to-do or flag', P.every(p => !p.existing_todo_id || seedIds.todo.has(p.existing_todo_id)));
    ok('inputs counts: 6 to-dos, 1 flag, 1 reply waiting, 3 partners, last week 1/2', JSON.stringify([prop.inputs_summary.todos, prop.inputs_summary.flags, prop.inputs_summary.replies_waiting, prop.inputs_summary.partners, prop.inputs_summary.last_week_done, prop.inputs_summary.last_week_total]) === '[6,1,1,3,1,2]', JSON.stringify(prop.inputs_summary));
    const sent = JSON.stringify(prop.inputs);
    ok('no email address in the context sent', !/@/.test(sent));
    const usage = ins(await svc.from('business_anthropic_usage').select('call_type, user_id, cost_usd, model').eq('business_id', T));
    ok('exactly 1 usage row: week_plan, this user, cost_usd > 0', usage.length === 1 && usage[0].call_type === 'week_plan' && usage[0].user_id === M.id && Number(usage[0].cost_usd) > 0, JSON.stringify(usage));

    console.log('--- save: 5 commitments + 2 to-dos (1 new, 1 existing), replace off');
    const fill = i => P[i] || { text: `ZZ fallback commitment ${i + 1}`, reason: 'fallback' };
    const existingTodo = byText('ZZ Clean up CRM notes');
    const chosen = [
      ...[0, 1, 2, 3, 4].map(i => ({ rank: i + 1, text: fill(i).text, reason: fill(i).reason, as: 'commitment' })),
      { rank: 6, text: 'ZZ Draft the Upside intro email', reason: 'supports rank 1', as: 'todo', link_to_rank: 1, due_date: addDays(WEEK, 2) },
      { rank: 7, text: existingTodo.text, reason: 'already on the list', as: 'todo', existing_todo_id: existingTodo.id, link_to_rank: 2 },
    ];
    r = await call(M, 'POST', '/week/plan/save', { week_start: WEEK, owner_user_id: M.id, prompt, inputs: prop.inputs, proposals: P, chosen, replace_open_planned: false });
    ok('save 201', r.status === 201, JSON.stringify(r.body).slice(0, 300));
    const plan1 = r.body.plan;
    const rows1 = ins(await svc.from('sales_week_goals').select('*').eq('business_id', T).eq('plan_id', plan1.id));
    const c1 = rows1.filter(g => g.kind === 'commitment');
    ok('5 commitments with plan_id / plan_rank 1-5 / plan_reason, owner M, no link', c1.length === 5 && c1.every(g => g.owner_user_id === M.id && g.plan_reason && !g.link_type) && c1.map(g => g.plan_rank).sort().join() === '1,2,3,4,5');
    const rank = n => c1.find(g => g.plan_rank === n);
    const newTodo = rows1.find(g => g.kind === 'todo' && g.text === 'ZZ Draft the Upside intro email');
    ok('new to-do linked to commitment rank 1, planned rank 6', newTodo && newTodo.link_type === 'commitment' && newTodo.link_id === rank(1).id && newTodo.plan_rank === 6);
    const ex = ins(await svc.from('sales_week_goals').select('*').eq('id', existingTodo.id).single());
    ok('existing to-do linked to rank 2 + planned, not duplicated', ex.link_type === 'commitment' && ex.link_id === rank(2).id && ex.plan_id === plan1.id
      && ins(await svc.from('sales_week_goals').select('id').eq('business_id', T).eq('text', existingTodo.text)).length === 1);
    ok('plan row chosen_count 7, model set, inputs saved without emails', (r2 => r2.chosen_count === 7 && !!r2.model && !/@/.test(JSON.stringify(r2.inputs)))(ins(await svc.from('sales_week_plans').select('*').eq('id', plan1.id).single())));
    const openStill = ins(await svc.from('sales_week_goals').select('id, status').in('id', [byText('ZZ Old planned commitment').id, byText('ZZ Typed commitment').id]));
    ok('replace off: earlier planned + typed commitments untouched', openStill.every(g => g.status === 'open'));

    r = await call(M, 'POST', '/week/plan/save', { week_start: WEEK, owner_user_id: M.id, prompt, inputs: prop.inputs, proposals: P, chosen: [1, 2, 3, 4, 5, 6].map(n => ({ rank: n, text: `ZZ six ${n}`, as: 'commitment' })), replace_open_planned: false });
    ok('6 commitments refused (400), nothing written', r.status === 400 && ins(await svc.from('sales_week_goals').select('id').eq('business_id', T).like('text', 'ZZ six%')).length === 0, `${r.status}`);

    console.log('--- save again with replace_open_planned');
    r = await call(M, 'POST', '/week/plan/save', { week_start: WEEK, owner_user_id: M.id, prompt: 'replan', inputs: prop.inputs, proposals: P, chosen: [{ rank: 1, text: 'ZZ Replanned focus', reason: 'replan', as: 'commitment' }], replace_open_planned: true });
    ok('replan save 201', r.status === 201, JSON.stringify(r.body).slice(0, 200));
    const after = ins(await svc.from('sales_week_goals').select('id, text, status, why_not_done, owner_user_id, plan_id').eq('business_id', T).eq('week_start', WEEK).eq('kind', 'commitment'));
    const st = t => after.find(g => g.text === t);
    const droppedNow = after.filter(g => g.status === 'dropped');
    ok('dropped = the 5 from save 1 + the seeded planned one, all "replanned <date>"', droppedNow.length === 6 && droppedNow.every(g => g.owner_user_id === M.id && g.plan_id && /^replanned \d{4}-\d{2}-\d{2}$/.test(g.why_not_done)), JSON.stringify(droppedNow.map(g => g.text)));
    ok('typed commitment + Cyrus\'s planned one stay open; new one open', st('ZZ Typed commitment').status === 'open' && st('ZZ Cyrus planned commitment').status === 'open' && st('ZZ Replanned focus').status === 'open');
    ok('linked to-dos kept (link to a dropped commitment unchanged)', ins(await svc.from('sales_week_goals').select('link_id').eq('id', existingTodo.id).single()).link_id === rank(2).id);

    r = await call(V, 'GET', `/week/plan?week_start=${WEEK}&owner_user_id=${M.id}`);
    ok('GET plan (viewer): latest = replan, planned ids = [Replanned focus], no inputs', r.status === 200 && r.body.plan?.id === r.body.plan?.id && r.body.plan?.prompt === 'replan' && !('inputs' in r.body.plan) && JSON.stringify(r.body.planned_commitment_ids) === JSON.stringify([st('ZZ Replanned focus').id]), JSON.stringify(r.body).slice(0, 200));
    r = await call(M, 'GET', `/week/plans?owner_user_id=${M.id}&limit=12`);
    ok('GET plans: 3 for M, newest first', r.status === 200 && r.body.plans.length === 3 && r.body.plans[0].prompt === 'replan', JSON.stringify(r.body).slice(0, 200));
    r = await call(V, 'POST', '/week/plan/save', { week_start: WEEK, owner_user_id: M.id, inputs: {}, proposals: [], chosen: [{ rank: 1, text: 'x', as: 'commitment' }] });
    ok('viewer cannot save (403)', r.status === 403, `${r.status}`);
    ok('still exactly 1 usage row after all saves', ins(await svc.from('business_anthropic_usage').select('id').eq('business_id', T)).length === 1);
  } catch (e) { console.log('ERROR', e.message); ok('no exception', false, e.message); } finally {
    await cleanup();
  }
  const left = { businesses: (await svc.from('businesses').select('id').like('access_code', `${tag}%`)).data?.length, plans: made.biz ? (await svc.from('sales_week_plans').select('id').eq('business_id', made.biz)).data?.length : 0 };
  const hlAfter = await hl();
  ok('teardown: temp workspace + plans gone', left.businesses === 0 && left.plans === 0, JSON.stringify(left));
  ok('HomeLover counts identical (15 tables)', JSON.stringify(hlBefore) === JSON.stringify(hlAfter), `${JSON.stringify(hlBefore)} vs ${JSON.stringify(hlAfter)}`);
  console.log(`HomeLover: ${JSON.stringify(hlAfter)}`);
  console.log(`\n${pass}/${total} passed in ${((Date.now() - t0) / 1000).toFixed(0)}s; Claude calls: 1; Apollo calls: 0; cost_usd: ${cost}`);
  process.exit(pass === total ? 0 : 1);
})();
