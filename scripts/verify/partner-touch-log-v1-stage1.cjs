// partner-touch-log-v1 Stage 1 check - API only, no browser, 0 AI / 0 Apollo calls. Temp workspace: 3 temp users (Jack + Cyrus members, Vera viewer), 7 temp partners + their events, all deleted. A second temp workspace for the cross-workspace check. HomeLover untouched. ~30s, cap 4 min.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3956, tag = 'ptl-' + Date.now();
const WATCH = ['businesses', 'business_members', 'sales_goals', 'sales_partner_events', 'profiles', 'auth_events'];
const made = { users: [], biz: [] };
let srv, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (srv) srv.kill();
  for (const b of made.biz) {
    await svc.from('sales_partner_events').delete().eq('business_id', b);
    await svc.from('sales_goals').delete().eq('business_id', b);
    await svc.from('business_members').delete().eq('business_id', b);
    await svc.from('auth_events').delete().eq('business_id', b);
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
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const addDays = (v, n) => new Date(Date.parse(`${v}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const monday = d => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const WEEK = monday(today), LAST = addDays(WEEK, -7), PAST = addDays(WEEK, -5); // a Wednesday last week

(async () => {
  const before = await snap();
  try {
    const B = await biz('touch'), OTHER = await biz('other');
    const jack = await user(B, 'Jack', 'member'), cy = await user(B, 'Cyrus', 'member'), vera = await user(B, 'Vera', 'viewer');
    const partner = async (name, extra = {}) => ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name: `${name} ${tag.slice(-4)}`, pipeline_status: 'not_started', ...extra }).select().single());
    const [p1, p2, p3, p4, p5, p6, p7] = await Promise.all(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf'].map((n, i) => partner(n, i === 1 ? { pipeline_status: 'replied' } : i === 2 ? { pipeline_status: 'meeting_set' } : {})));
    const foreign = ins(await svc.from('sales_goals').insert({ business_id: OTHER, goal_type: 'partnership', name: `Foreign ${tag.slice(-4)}`, pipeline_status: 'not_started' }).select().single());
    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B},${OTHER}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(500); } }
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${B}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: u.cookie }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const goalRow = async id => (await svc.from('sales_goals').select('*').eq('id', id).single()).data;
    const events = async id => (await svc.from('sales_partner_events').select('*').eq('goal_id', id).order('recorded_at')).data;
    const firstTouched = async w => (await call(jack, 'GET', `/report?week_start=${w}`)).body.partners?.metrics?.partners_first_touched?.value;

    const lastBefore = await firstTouched(LAST), thisBefore = await firstTouched(WEEK);
    // 1. Backdated email on Not started -> Sent, counts last week, not this week
    let r = await call(jack, 'POST', `/partners/${p1.id}/signal`, { type: 'touch', touch_type: 'email', date: PAST, contacts: ['Lisa Park', 'Ken'], note: 'Emailed merchant team', expect: 'not_started' });
    let g = await goalRow(p1.id), ev = await events(p1.id);
    ok('backdated email: Not started -> Sent, event dated that day, names + note kept', r.status === 200 && g.pipeline_status === 'first_email_sent' && g.first_email_at === PAST
      && ev.length === 1 && ev[0].event === 'touch' && ev[0].at.slice(0, 10) === PAST && ev[0].touch_type === 'email' && ev[0].source === 'manual'
      && JSON.stringify(ev[0].contact_names) === '["Lisa Park","Ken"]' && ev[0].note === 'Emailed merchant team' && ev[0].by_user === jack.id, `${r.status} ${g.pipeline_status} ${ev[0]?.at}`);
    ok('last_touch_at = the touch day, not today', g.last_touch_at.slice(0, 10) === PAST, g.last_touch_at);
    ok('first-touched: last week +1, this week unchanged', (await firstTouched(LAST)) === lastBefore + 1 && (await firstTouched(WEEK)) === thisBefore, `${lastBefore}->${await firstTouched(LAST)}, ${thisBefore}->${await firstTouched(WEEK)}`);
    // 2. Undo the backdated touch (it's the latest recorded, though dated last week)
    r = await call(jack, 'POST', `/partners/${p1.id}/undo`, { event_id: ev[0].id });
    g = await goalRow(p1.id);
    ok('undo a backdated touch: stage, stamps and count all back', r.status === 200 && g.pipeline_status === 'not_started' && g.first_email_at === null && g.last_touch_at === null && (await firstTouched(LAST)) === lastBefore, `${r.status} ${JSON.stringify(r.body.error || '')} ${g.pipeline_status}`);
    // 3. Meeting on Replied -> Meeting; email on Meeting -> no change but logged
    r = await call(jack, 'POST', `/partners/${p2.id}/signal`, { type: 'touch', touch_type: 'meeting', date: today, contacts: ['Brad'] });
    ok('meeting touch on Replied -> Meeting set', r.status === 200 && (await goalRow(p2.id)).pipeline_status === 'meeting_set');
    r = await call(cy, 'POST', `/partners/${p3.id}/signal`, { type: 'touch', touch_type: 'email', date: today, contacts: ['Dana'] });
    ev = await events(p3.id);
    ok('email touch on Meeting -> no stage change, still logged', r.status === 200 && (await goalRow(p3.id)).pipeline_status === 'meeting_set' && ev.length === 1 && ev[0].to_status === null && ev[0].contact_names[0] === 'Dana');
    // 4. Refusals
    r = await call(jack, 'POST', `/partners/${p3.id}/signal`, { type: 'touch', touch_type: 'email', date: today, move_to: 'first_email_sent' });
    ok('explicit backwards stage -> 409, nothing written', r.status === 409 && (await events(p3.id)).length === 1, String(r.status));
    r = await call(jack, 'POST', `/partners/${p4.id}/signal`, { type: 'touch', touch_type: 'email', date: addDays(today, 1) });
    ok('future date -> 400', r.status === 400 && !(await events(p4.id)).length);
    r = await call(jack, 'POST', `/partners/${p4.id}/signal`, { type: 'touch', touch_type: 'email', date: today, expect: 'replied' });
    ok('stale screen (expect) -> 409', r.status === 409);
    r = await call(vera, 'POST', `/partners/${p4.id}/signal`, { type: 'touch', touch_type: 'email', date: today });
    const rb = await call(vera, 'POST', '/partners/touches', { dry_run: true, touches: [{ goal_id: p4.id, touch_type: 'email', date: today }] });
    ok('viewer refused (single + bulk)', r.status === 403 && rb.status === 403 && !(await events(p4.id)).length, `${r.status} ${rb.status}`);
    r = await call(jack, 'POST', `/partners/${foreign.id}/signal`, { type: 'touch', touch_type: 'email', date: today });
    ok('partner from another workspace -> 404', r.status === 404, String(r.status));
    // 5. Bulk: dry run writes nothing; apply writes exactly one event per row
    const batch = [p4, p5, p6, p7].map((p, i) => ({ goal_id: p.id, touch_type: i === 3 ? 'event' : 'email', date: i % 2 ? today : PAST, contacts: [`Person ${i}`], expect: 'not_started' }));
    const countBefore = (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
    r = await call(jack, 'POST', '/partners/touches', { dry_run: true, touches: batch });
    const pv = r.body.preview || [];
    ok('bulk dry run: per-partner preview, 0 writes', r.status === 200 && pv.length === 4 && (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', B)).count === countBefore
      && pv[0].from_status === 'not_started' && pv[0].to_status === 'first_email_sent' && pv[0].week_start === LAST && pv[0].first_touch === true
      && pv[1].week_start === WEEK && pv[3].to_status === null && pv[3].first_touch === false, JSON.stringify(pv.map(p => [p.to_status, p.week_start, p.first_touch])));
    r = await call(jack, 'POST', '/partners/touches', { touches: [...batch, { goal_id: foreign.id, touch_type: 'email', date: today }] });
    ok('bulk with a bad row: whole batch refused, 0 writes', r.status === 400 && r.body.preview?.[4]?.status === 404 && (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', B)).count === countBefore);
    r = await call(jack, 'POST', '/partners/touches', { touches: [batch[0], batch[0]] });
    ok('same partner twice -> 400', r.status === 400);
    const lastMid = await firstTouched(LAST), thisMid = await firstTouched(WEEK);
    r = await call(jack, 'POST', '/partners/touches', { touches: batch });
    const countAfter = (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', B)).count;
    ok('bulk apply: exactly 4 events, stages as previewed', r.status === 200 && r.body.logged === 4 && countAfter === countBefore + 4
      && (await goalRow(p4.id)).pipeline_status === 'first_email_sent' && (await goalRow(p7.id)).pipeline_status === 'not_started', `${r.status} logged ${r.body.logged} +${countAfter - countBefore}`);
    ok('bulk first-touched: +2 last week (p4, p6), +1 this week (p5), p7 Event not counted', (await firstTouched(LAST)) === lastMid + 2 && (await firstTouched(WEEK)) === thisMid + 1, `${lastMid}->${await firstTouched(LAST)}, ${thisMid}->${await firstTouched(WEEK)}`);
    // 6. History list returns touches with their fields (UI reads this)
    r = await call(vera, 'GET', `/partners/events?goal_id=${p4.id}`);
    ok('viewer can read the touch in history', r.status === 200 && r.body.events?.[0]?.event === 'touch' && r.body.events[0].contact_names[0] === 'Person 0');
  } catch (e) { ok('run', false, e.stack.split('\n').slice(0, 2).join(' ')); }
  await cleanup();
  const after = await snap();
  const moved = WATCH.filter(t => before[t] !== after[t]);
  console.log(`\n${pass}/${total} passed`);
  console.log(moved.length ? `restored: CHECK - counts moved on ${moved.map(t => `${t} ${before[t]}->${after[t]}`).join(', ')}` : 'restored: yes');
  process.exit(pass === total ? 0 : 1);
})();
