// huddle-live-feed-v1 Stage 1 check - GET /huddle/live vs the raw HomeLover rows, recomputed here independently. Read-only on real data; writes = 2 temp users (Vera = Viewer member of HomeLover, Nora = no membership), both deleted. 0 AI / 0 Apollo calls. ~20s, cap 4 min.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const B = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0].trim();
const PORT = 3957, tag = 'hlf-' + Date.now();
const WATCH = ['sales_sync_runs', 'sales_email_activity', 'sales_email_messages', 'sales_prospect_state', 'sales_prospect_events', 'sales_week_goals', 'business_members'];
const made = { users: [] };
let srv, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true }).eq(t === 'business_members' ? 'business_id' : 'business_id', B)).count; return o; };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (srv) srv.kill();
  for (const u of made.users) { await svc.from('business_members').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(name, role) {
  const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  if (role) { const r = await svc.from('business_members').insert({ business_id: B, email, name: `${name} Test`, user_id: u.user.id, role }); if (r.error) throw new Error(r.error.message); }
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s } = await c.auth.signInWithPassword({ email, password });
  return { id: u.user.id, cookie: `prospector_at=${encodeURIComponent(s.session.access_token)}` };
}
const all = async (t, cols, f = q => q) => { let out = [], from = 0; for (;;) { const { data, error } = await f(svc.from(t).select(cols).eq('business_id', B)).order(t === 'sales_email_messages' ? 'apollo_message_id' : t === 'sales_prospect_state' ? 'contact_id' : 'id').range(from, from + 999); if (error) throw new Error(error.message); out = out.concat(data); if (data.length < 1000) return out; from += 1000; } };

// Independent restatement of the spec's rule: bot open = tracking service, a "generic linux" agent, or within 60s of delivery; human click = >120s after a known delivery.
const botOpen = (e, d) => !!e.tracking_service || /generic linux/i.test(e.user_agent || '') || (!!d && (Date.parse(e.occurred_at) - Date.parse(d)) / 1000 <= 60);
const humanClick = (e, d) => !!d && (Date.parse(e.occurred_at) - Date.parse(d)) / 1000 > 120;

(async () => {
  const before = await snap();
  try {
    const [prospects, messages, events, runs, members] = await Promise.all([
      all('sales_prospect_state', 'contact_id,owner,name,company'),
      all('sales_email_messages', 'apollo_message_id,contact_id,delivered_at,replied,replied_seen_at'),
      all('sales_email_activity', 'id,apollo_message_id,contact_id,event,occurred_at,user_agent,tracking_service', q => q.in('event', ['open', 'click'])),
      svc.from('sales_sync_runs').select('status,started_at,finished_at,trigger').eq('business_id', B).neq('trigger', 'test').order('started_at', { ascending: false }).limit(10).then(r => r.data),
      svc.from('business_members').select('user_id,name').eq('business_id', B).then(r => r.data),
    ]);
    const deliv = new Map(messages.map(m => [m.apollo_message_id, m.delivered_at]));
    const owner = new Map(prospects.map(p => [p.contact_id, p.owner]));
    const truth = new Map();
    const t = id => { if (!truth.has(id)) truth.set(id, { opens: 0, bots: 0, clicks: 0, real: [], any: [], replied: false }); return truth.get(id); };
    for (const e of events) {
      if (!owner.has(e.contact_id)) continue;
      const x = t(e.contact_id), d = deliv.get(e.apollo_message_id);
      const human = e.event === 'open' ? !botOpen(e, d) : humanClick(e, d);
      if (e.event === 'open') human ? x.opens++ : x.bots++;
      if (e.event === 'click' && human) x.clicks++;
      (human ? x.real : x.any).push(e.occurred_at);
    }
    for (const m of messages) if (m.replied && owner.has(m.contact_id)) { const x = t(m.contact_id); x.replied = true; x.real.push(m.replied_seen_at || m.delivered_at); }
    const last = x => (x.real.length ? x.real : x.any).sort().pop();
    const humanIds = [...truth].filter(([, x]) => x.real.length).map(([id]) => id);
    const botOnlyIds = [...truth].filter(([, x]) => !x.real.length).map(([id]) => id);
    console.log(`raw: ${prospects.length} prospects, ${messages.length} messages, ${events.length} open/click events -> ${humanIds.length} people with real activity, ${botOnlyIds.length} bot-only`);

    const vera = await user('Vera', 'viewer'), nora = await user('Nora', null);
    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(500); } }
    const get = (u, qs = '') => fetch(`http://localhost:${PORT}/api/sales/${B}/huddle/live${qs}`, { headers: { Cookie: u.cookie } }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const everything = async (qs = '') => { let rows = [], off = 0, first; for (;;) { const r = await get(vera, `?limit=100&offset=${off}${qs}`); first = first || r.body; rows = rows.concat(r.body.rows || []); if (r.body.next_offset == null) return { ...first, rows }; off = r.body.next_offset; } };

    let r = await get(vera);
    ok('viewer GET 200, first page 25 rows, total = people with real activity', r.status === 200 && r.body.rows.length === Math.min(25, humanIds.length) && r.body.total === humanIds.length, `${r.status} ${r.body.rows?.length} ${r.body.total} vs ${humanIds.length}`);
    const full = await everything();
    ok('paging: every person exactly once, no bot-only rows', full.rows.length === humanIds.length && new Set(full.rows.map(x => x.contact_id)).size === humanIds.length && full.rows.every(x => !x.bot_only));
    ok('newest-first order across all pages', full.rows.every((x, i) => i === 0 || full.rows[i - 1].last_activity_at >= x.last_activity_at));
    const ten = full.rows.slice(0, 10);
    const bad = ten.filter(x => { const y = truth.get(x.contact_id); return x.real_opens !== y.opens || x.bot_opens !== y.bots || x.human_clicks !== y.clicks || x.replied !== y.replied || x.last_activity_at !== last(y); });
    ok('10 newest people: real opens, bot opens, clicks, replied, last activity = raw rows', ten.length === Math.min(10, humanIds.length) && !bad.length, bad.map(x => `${x.name}: ${x.real_opens}/${truth.get(x.contact_id).opens} opens, last ${x.last_activity_at} vs ${last(truth.get(x.contact_id))}`).join('; '));
    for (const x of ten.slice(0, 5)) console.log(`      ${x.name} · ${x.company} · ${x.sequence?.name || '-'} step ${x.step} · last ${x.last_activity_at} ${x.last_activity_kind} · "${x.insight}" · next: ${x.next_step.label}`);

    const bots = await everything('&show_bots=1');
    const added = bots.rows.filter(x => !full.rows.some(y => y.contact_id === x.contact_id)).map(x => x.contact_id).sort();
    ok('show_bots adds exactly the bot-only people', bots.rows.length === humanIds.length + botOnlyIds.length && JSON.stringify(added) === JSON.stringify([...botOnlyIds].sort()) && r.body.bot_only_count === botOnlyIds.length, `${added.length} added, ${botOnlyIds.length} expected`);

    const cy = members.find(m => /^cyrus/i.test(m.name || ''));
    const cyRows = await everything(`&owner=${cy.user_id}`);
    const cyTruth = humanIds.filter(id => owner.get(id) === 'cyrus');
    ok("owner = Cyrus's member id: only Cyrus's people, count = raw", cyRows.rows.every(x => x.owner === 'cyrus') && cyRows.rows.length === cyTruth.length, `${cyRows.rows.length} vs ${cyTruth.length}`);
    const un = await everything('&owner=unassigned');
    ok('owner = unassigned: count = raw', un.rows.length === humanIds.filter(id => owner.get(id) === 'unassigned').length);

    const rep = await everything('&filter=replied'), clk = await everything('&filter=clicked'), o2 = await everything('&filter=opened2');
    ok('filter replied / clicked / opened 2+ = raw counts', rep.rows.length === humanIds.filter(id => truth.get(id).replied).length && clk.rows.length === humanIds.filter(id => truth.get(id).clicks > 0).length && o2.rows.length === humanIds.filter(id => truth.get(id).opens >= 2).length,
      `${rep.rows.length}/${clk.rows.length}/${o2.rows.length}`);
    const since = r.body.since;
    const sinceClk = humanIds.filter(id => events.some(e => e.contact_id === id && e.event === 'click' && e.occurred_at > since && humanClick(e, deliv.get(e.apollo_message_id)))).length;
    const sinceRep = humanIds.filter(id => messages.some(m => m.contact_id === id && m.replied && m.replied_seen_at && m.replied_seen_at > since)).length;
    const nums = r.body.numbers;
    const drill = await everything('&filter=clicked&since=huddle');
    ok('numbers since last huddle: replies + clicks = raw, and the clicks number = its drill-down list', nums.replied === sinceRep && nums.clicked === sinceClk && drill.rows.length === nums.clicked, `since ${since}: ${JSON.stringify(nums)} raw replies ${sinceRep} clicks ${sinceClk}`);
    ok("flagged to me = 0 for a new viewer", nums.flagged_me === 0 && (await everything('&filter=flagged_me')).rows.length === 0);

    const q = full.rows[0];
    const word = (q.company || q.name).split(' ')[0];
    const s = await everything(`&q=${encodeURIComponent(word.toLowerCase())}`);
    ok('search matches name/company, case-insensitive', s.rows.some(x => x.contact_id === q.contact_id) && s.rows.every(x => `${x.name} ${x.company}`.toLowerCase().includes(word.toLowerCase())), `"${word}" -> ${s.rows.length}`);
    const seqId = q.sequence?.id;
    if (seqId) { const sq = await everything(`&sequence=${seqId}`); ok('sequence filter: every row has a message in it', sq.rows.length > 0 && sq.rows.every(x => x.sequence_ids.includes(seqId)), `${sq.rows.length}`); }

    const done = runs.find(x => x.finished_at && ['success', 'partial'].includes(x.status));
    ok('sync line = newest finished run', r.body.sync.synced_at === (done?.finished_at || null), `${r.body.sync.synced_at} stale=${r.body.sync.stale} running=${r.body.sync.running}`);
    ok('no phone field on any row', full.rows.every(x => !('phone' in x)));
    ok('non-member 403, bad filter 400', (await get(nora)).status === 403 && (await get(vera, '?filter=hot')).status === 400);
  } catch (e) { ok('run without exceptions', false, e.stack); }
  await cleanup();
  const after = await snap();
  const moved = WATCH.filter(t => before[t] !== after[t]);
  ok('watched tables unchanged (0 sync runs, 0 Apollo writes)', !moved.length, moved.map(t => `${t} ${before[t]}->${after[t]}`).join(', '));
  console.log(`\n${pass}/${total} passed`);
  console.log(moved.length ? `restored: NO - moved: ${moved.join(', ')} (check who wrote it)` : 'restored: yes');
  process.exit(pass === total ? 0 : 1);
})();
