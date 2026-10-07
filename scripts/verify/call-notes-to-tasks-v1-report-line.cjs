// call-notes-to-tasks-v1 "Add to report §1" check - API only, no browser, 0 AI calls. Temp workspace: 2 temp users (member, viewer), this week's §1 section + a final far-future week, all deleted. HomeLover untouched. ~30s, cap 4 min.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3954, tag = 'cnr-' + Date.now();
const WATCH = ['businesses', 'business_members', 'sales_week_report', 'sales_week_report_sections', 'profiles', 'auth_events'];
const made = { users: [], biz: null };
let srv, pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const snap = async () => { const o = {}; for (const t of WATCH) o[t] = (await svc.from(t).select('*', { count: 'exact', head: true })).count; return o; };
const wait = ms => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.log('ABORT (4 min cap)'); cleanup().then(() => process.exit(2)); }, 240000);
async function cleanup() {
  if (srv) srv.kill();
  const b = made.biz;
  if (b) {
    await svc.from('sales_week_report_sections').delete().eq('business_id', b);
    await svc.from('sales_week_report').delete().eq('business_id', b);
    await svc.from('business_members').delete().eq('business_id', b);
    await svc.from('auth_events').delete().eq('business_id', b);
  }
  for (const u of made.users) {
    await svc.from('business_members').delete().eq('user_id', u);
    await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u);
  }
  if (b) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(biz, name, role) {
  const email = `${tag}-${name.toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: `${name} Test`, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: biz, email, name: `${name} Test`, user_id: u.user.id, role }).select());
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s } = await c.auth.signInWithPassword({ email, password });
  return { id: u.user.id, token: s.session.access_token };
}
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
const WEEK = new Date(Date.parse(`${today}T12:00:00Z`) - ((dow + 6) % 7) * 864e5).toISOString().slice(0, 10);
const FINAL_WEEK = '2099-01-05';

(async () => {
  const before = await snap();
  try {
    made.biz = ins(await svc.from('businesses').insert({ name: `ZZ Report ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const B = made.biz;
    const jack = await user(B, 'Jack', 'member'), vera = await user(B, 'Vera', 'viewer');
    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${B}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(500); } }
    const api = (u, path, body) => fetch(`http://localhost:${PORT}/api/sales/${B}/goals${path}`, { method: 'POST', headers: { Cookie: `prospector_at=${encodeURIComponent(u.token)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const notes = async w => (await svc.from('sales_week_report_sections').select('notes, updated_by').eq('business_id', B).eq('week_start', w).eq('section_key', 's1').maybeSingle()).data;
    const L1 = 'From call · Oct 7 · Weekly sync: Decided A. Decided B.';
    const L2 = 'From call · Oct 7: Decided C.';

    let r = await api(jack, `/report/${WEEK}/sections/s1/append`, { line: L1 });
    let n = await notes(WEEK);
    ok('empty §1 -> the line alone', r.status === 200 && n?.notes === L1 && n.updated_by === jack.id, `${r.status} ${JSON.stringify(n?.notes)}`);
    await svc.from('sales_week_report_sections').update({ notes: 'Biggest win: X\n' }).eq('business_id', B).eq('week_start', WEEK).eq('section_key', 's1');
    r = await api(jack, `/report/${WEEK}/sections/s1/append`, { line: L2 });
    n = await notes(WEEK);
    ok('existing notes kept, line added below', n?.notes === `Biggest win: X\n${L2}`, JSON.stringify(n?.notes));
    r = await api(jack, `/report/${WEEK}/sections/s1/append`, { line: L2 });
    const again = await r.json(); n = await notes(WEEK);
    ok('same line twice -> not duplicated', r.status === 200 && again.already === true && n?.notes === `Biggest win: X\n${L2}`, JSON.stringify(n?.notes));
    r = await api(vera, `/report/${WEEK}/sections/s1/append`, { line: 'viewer line' });
    ok('viewer refused', r.status === 403 && (await notes(WEEK)).notes === `Biggest win: X\n${L2}`, String(r.status));
    ins(await svc.from('sales_week_report').insert({ business_id: B, week_start: FINAL_WEEK, status: 'final', finalized_at: new Date().toISOString(), finalized_by: jack.id }).select());
    r = await api(jack, `/report/${FINAL_WEEK}/sections/s1/append`, { line: L1 });
    ok('final week -> 409, nothing written', r.status === 409 && !(await notes(FINAL_WEEK)), String(r.status));
    const bad = await Promise.all([
      api(jack, `/report/${WEEK}/sections/s1/append`, { line: '  ' }),
      api(jack, `/report/${WEEK}/sections/s99/append`, { line: 'x' }),
      api(jack, `/report/2026-10-07/sections/s1/append`, { line: 'x' }),
      api(jack, `/report/${WEEK}/sections/s1/append`, { line: 'x', notes: 'y' }),
    ]);
    ok('bad bodies 400 x4', bad.every(b => b.status === 400), bad.map(b => b.status).join(','));
    const other = (await svc.from('businesses').select('id').neq('id', B).limit(1)).data[0].id;
    r = await fetch(`http://localhost:${PORT}/api/sales/${other}/goals/report/${WEEK}/sections/s1/append`, { method: 'POST', headers: { Cookie: `prospector_at=${encodeURIComponent(jack.token)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ line: 'x' }) });
    ok('another workspace refused', r.status === 403 || r.status === 404, String(r.status));
  } catch (e) { ok('run', false, e.message); }
  await cleanup();
  const after = await snap();
  const moved = WATCH.filter(t => before[t] !== after[t]);
  console.log(`\n${pass}/${total} passed`);
  console.log(moved.length ? `restored: CHECK - counts moved on ${moved.map(t => `${t} ${before[t]}->${after[t]}`).join(', ')}` : 'restored: yes');
  process.exit(pass === total ? 0 : 1);
})();
