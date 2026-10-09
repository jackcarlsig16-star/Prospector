// microsoft-connect-v1 Stage 4b check. A = temp workspace (allowlisted for the spawned server only) + 2 temp users with fixture partners / confirmed domains / calendar rows, read through GET /goals/kpi and /goals/scorecard as a member (viewer may read too - it's a GET), all rows deleted. B = HomeLover READ-ONLY: in-process count for the current week vs a hand count from its raw rows (11 events, no membership added, nothing written). 0 Microsoft, 0 Apollo, 0 AI calls. Proves: feature off -> no outlook fields; on -> held / booked by confirmed domain only (contact-email match, unconfirmed domain, two-partner ambiguity, cancelled, future, next week, no created time all excluded), the same meeting on both calendars once, typed actual untouched and still the value, sales_metric_targets count unchanged. ~30s, cap 4 min.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3974, tag = 'ms4b-' + Date.now();
const HL = 'bc69beab-effd-452d-9e81-fd652333bb95';
const WATCH = ['businesses', 'business_members', 'profiles', 'auth_events', 'sales_goals', 'partner_domains', 'partner_contacts', 'sales_metric_targets', 'microsoft_events'];
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
  if (b) { for (const t of ['microsoft_events', 'sales_metric_targets', 'partner_contacts', 'partner_domains', 'sales_goals', 'business_members', 'auth_events']) await svc.from(t).delete().eq('business_id', b); }
  for (const u of made.users) { await svc.from('business_members').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
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
  return { id: u.user.id, email, cookie: `prospector_at=${encodeURIComponent(s.session.access_token)}` };
}
// This week's Monday (LA) and the one before.
const addDays = (v, n) => new Date(Date.parse(`${v}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const monday = () => { const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()); return addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)); };

(async () => {
  const before = await snap();
  try {
    made.biz = ins(await svc.from('businesses').insert({ name: `ZZ MS4B ${tag.slice(-5)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-owner@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const B = made.biz;
    const jack = await user(B, 'Jack', 'member'), cy = await user(B, 'Cyrus', 'member');
    const goal = async name => ins(await svc.from('sales_goals').insert({ business_id: B, goal_type: 'partnership', name, pipeline_status: 'researching', category: '3. PEOs', tier: '1', owner_user_id: jack.id }).select().single());
    const acme = await goal('Acme Test'), beta = await goal('Beta Test'), unconf = await goal('Unconfirmed Test');
    ins(await svc.from('partner_domains').insert([
      { business_id: B, goal_id: acme.id, domain: 'acme.test', source: 'manual', confirmed: true, created_by: jack.id }, { business_id: B, goal_id: beta.id, domain: 'beta.test', source: 'manual', confirmed: true, created_by: jack.id },
      { business_id: B, goal_id: unconf.id, domain: 'unconf.test', source: 'manual', confirmed: false, created_by: jack.id },
    ]).select());
    ins(await svc.from('partner_contacts').insert({ business_id: B, goal_id: acme.id, name: 'Amy Acme', email: 'amy@contact-only.test', source: 'manual' }).select());
    const WEEK = monday(), LAST = addDays(WEEK, -7);
    // Times inside the LA week: Tuesday 10:00 LA = 17:00Z (PDT).
    const at = (day, h) => new Date(Date.parse(`${day}T${String(h).padStart(2, '0')}:00:00Z`)).toISOString();
    const tue = addDays(WEEK, 1), thu = addDays(WEEK, 3), lastTue = addDays(LAST, 1), nextTue = addDays(WEEK, 8);
    let n = 0;
    const ev = (user_id, domains, over = {}) => ({ business_id: B, user_id, graph_id: `${tag}-e${++n}`, ical_uid: over.ical_uid ?? `${tag}-ical${n}`, mailbox_email: `${tag}@homelover.ai`, organizer_email: `x@${domains[0]}`, external_emails: domains.map(d => `x@${d}`), external_names: domains.map(() => ''), external_domains: domains,
      subject: 'Intro', start_at: over.start_at || at(tue, 17), end_at: over.end_at || at(tue, 18), is_cancelled: !!over.is_cancelled, created_at_graph: 'created_at_graph' in over ? over.created_at_graph : at(lastTue, 15) });
    const far = new Date(Date.now() + 30 * 864e5).toISOString();
    const events = [
      ev(jack.id, ['acme.test'], { ical_uid: `${tag}-shared` }),                                   // held this week, created last week (shared with Cyrus)
      ev(cy.id, ['acme.test'], { ical_uid: `${tag}-shared` }),                                     // same meeting, Cyrus's calendar -> once
      ev(jack.id, ['beta.test'], { start_at: at(thu, 17), end_at: at(thu, 18), created_at_graph: at(tue, 9) }),   // held (if Thu is past) + booked this week
      ev(jack.id, ['beta.test'], { start_at: far, end_at: far, created_at_graph: at(tue, 10) }),  // booked this week, held never (future)
      ev(jack.id, ['acme.test'], { is_cancelled: true, created_at_graph: at(tue, 11) }),           // cancelled -> neither
      ev(jack.id, ['acme.test', 'beta.test'], { created_at_graph: at(tue, 12) }),                  // ambiguous -> neither
      ev(jack.id, ['unconf.test'], { created_at_graph: at(tue, 13) }),                             // unconfirmed -> unmatched
      ev(jack.id, ['contact-only.test'], { created_at_graph: at(tue, 14) }),                        // contact email only -> unmatched (domain only)
      ev(jack.id, ['acme.test'], { start_at: at(nextTue, 17), end_at: at(nextTue, 18), created_at_graph: at(nextTue, 9) }), // next week
      ev(jack.id, ['acme.test'], { start_at: at(lastTue, 17), end_at: at(lastTue, 18), created_at_graph: null }),            // held last week, no created time
    ];
    ins(await svc.from('microsoft_events').insert(events).select());
    ins(await svc.from('sales_metric_targets').insert({ business_id: B, period: 'week', period_start: WEEK, metric_key: 'meetings_held', actual: 7, actual_by: jack.id, actual_at: new Date().toISOString() }).select());
    const thuPast = Date.parse(at(thu, 18)) <= Date.now();
    const expHeld = 1 + (thuPast ? 1 : 0), expBooked = 2;

    srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: [process.env.SALES_ANALYTICS_BUSINESS_IDS, B].filter(Boolean).join(',') }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 40; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await wait(500); } }
    const get = async (u, path) => { const r = await fetch(`http://localhost:${PORT}${path}`, { headers: { Cookie: u.cookie } }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
    const kpi = async () => (await get(jack, `/api/sales/${B}/goals/kpi?week_start=${WEEK}`)).data.rows;
    const rowOf = (rows, k) => rows.find(r => r.key === k);

    let rows = await kpi();
    ok('A1 feature off: KPI meeting rows carry no outlook fields, typed 7 is the value', !('this_week_outlook' in rowOf(rows, 'meetings_held')) && rowOf(rows, 'meetings_held').this_week === 7, JSON.stringify(rowOf(rows, 'meetings_held')));
    ins(await svc.from('businesses').update({ features: { goals_sales: true, outlook_meetings: true } }).eq('id', B).select());
    rows = await kpi();
    const held = rowOf(rows, 'meetings_held'), booked = rowOf(rows, 'meetings_set');
    ok(`A2 feature on: Meetings held this week from Outlook = ${expHeld} (shared meeting once${thuPast ? ' + Thursday' : ', Thursday not over yet'}); cancelled / ambiguous / unconfirmed / contact-only / future / next week excluded`, held.this_week_outlook === expHeld, `got ${held.this_week_outlook}`);
    ok('A3 Meetings held last week from Outlook = 1 (the row with no created time still counts as held)', held.last_week_outlook === 1, `got ${held.last_week_outlook}`);
    ok(`A4 New meetings booked this week from Outlook = ${expBooked} (Thursday + the future one, created this week); last week = 1 (the shared meeting)`, booked.this_week_outlook === expBooked && booked.last_week_outlook === 1, `got ${booked.this_week_outlook} / ${booked.last_week_outlook}`);
    ok('A5 typed actual stays the value: held this_week 7, booked this_week null (nothing typed)', held.this_week === 7 && booked.this_week === null, `${held.this_week} / ${booked.this_week}`);
    ok('A6 non-meeting rows carry no outlook fields', rows.filter(r => 'this_week_outlook' in r).map(r => r.key).sort().join() === 'meetings_held,meetings_set');
    const sc = (await get(jack, `/api/sales/${B}/goals/scorecard?month=${WEEK.slice(0, 7)}-01`)).data;
    const wk = sc.weeks.find(w => w.week_start === WEEK);
    ok(`A7 scorecard: meetings_set this week carries outlook ${expBooked} beside the typed value (null); other metrics untouched`, wk && wk.metrics.meetings_set.outlook === expBooked && wk.metrics.meetings_set.value === null && !('outlook' in wk.metrics.outbound_audience), JSON.stringify(wk && wk.metrics.meetings_set));
    const tgt = (await svc.from('sales_metric_targets').select('*').eq('business_id', B)).data;
    ok('A8 nothing written: exactly the one typed row, still 7', tgt.length === 1 && Number(tgt[0].actual) === 7);
    const asCy = await get(cy, `/api/sales/${B}/goals/kpi?week_start=${WEEK}`);
    ok('A9 the other member reads the same numbers (workspace-wide, not per mailbox)', asCy.status === 200 && rowOf(asCy.data.rows, 'meetings_held').this_week_outlook === expHeld);

    // B: HomeLover READ-ONLY - in-process count vs hand count from the raw rows
    const { countOutlookMeetings, loadOutlookMeetingInputs } = await import(ROOT + '/api/sales/outlookMeetings.js');
    const inputs = await loadOutlookMeetingInputs(svc, HL);
    const r = countOutlookMeetings({ ...inputs, weekStart: WEEK });
    const domSet = new Map(inputs.domains.map(d => [d.domain, d.goal_id]));
    const { laStartOfDayMs } = await import(ROOT + '/api/sales/goalsShared.js');
    const s0 = laStartOfDayMs(WEEK), s1 = laStartOfDayMs(addDays(WEEK, 7));
    const seen = new Set(); let hHeld = 0, hBooked = 0;
    for (const e of inputs.events) {
      const k = e.ical_uid || e.graph_id; if (seen.has(k) || e.is_cancelled) { seen.add(k); continue; } seen.add(k);
      const goals = new Set(e.external_domains.map(d => domSet.get(d)).filter(Boolean)); if (goals.size !== 1) continue;
      const end = Date.parse(e.end_at); if (end >= s0 && end < s1 && end <= Date.now()) hHeld++;
      const c = Date.parse(e.created_at_graph || ''); if (c >= s0 && c < s1) hBooked++;
    }
    ok(`B1 HomeLover: ${inputs.events.length} events / ${inputs.domains.length} confirmed domains read = DB; week ${WEEK} held ${r.counts.held} = hand ${hHeld}, booked ${r.counts.booked} = hand ${hBooked} (no created time on ${r.counts.no_created_time}, unmatched ${r.counts.unmatched}, ambiguous ${r.counts.ambiguous}, cancelled ${r.counts.cancelled})`, r.counts.held === hHeld && r.counts.booked === hBooked);
    console.log('HomeLover held this week:', r.held.map(h => `${h.domain} ${h.subject} ${h.end_at}`).join(' | ') || 'none');
    const hl = (await svc.from('businesses').select('features').eq('id', HL).maybeSingle()).data;
    ok(`B2 HomeLover: outlook_meetings is ${hl?.features?.outlook_meetings === true ? 'ON (Jack switched it on in Admin) - the KPI table shows "from Outlook" today' : 'off (Jack switches it on in Admin > Workspace features)'}`, !!hl, JSON.stringify(hl && hl.features));
  } catch (e) { ok('run', false, e.stack.split('\n').slice(0, 3).join(' ')); }
  await cleanup();
  const after = await snap();
  const moved = WATCH.filter(t => before[t] !== after[t]);
  console.log(`\n${pass}/${total} passed`);
  console.log(moved.length ? `restored: CHECK - counts moved on ${moved.map(t => `${t} ${before[t]}->${after[t]}`).join(', ')}` : 'restored: yes');
  process.exit(pass === total ? 0 : 1);
})();
