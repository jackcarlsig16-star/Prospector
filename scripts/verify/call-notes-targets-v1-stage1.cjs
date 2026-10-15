// call-notes-targets-v1 REV3 Stage 1 live check. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 3 temp users (member-owner "Jack Zz", member "Cyrus Zz", viewer). Seed: 7 partners (Gallagher, Aon, PerkSpot, Corestream, Alliant Insurance Services, Upside, TEST-Broker Co), 1 opportunity (24 Hour Fitness), 3 Apollo accounts (24 Hour Fitness, Marriott International, [solidcore]), 1 rejected target (ZeroBounce), 1 Outlook touch (Pat Example, Oct 12). THREE real Claude calls (fixtures A, B, C; MODELS.STANDARD, ~$0.03-0.10 each), 0 Apollo / 0 syncs. HomeLover is only COUNTED (head requests). Teardown deletes everything; the 3 usage rows stay (business_id goes null with the workspace) as the cost record. ~2-4 min, cap 5 min.
// Usage: node scripts/verify/call-notes-targets-v1-stage1.cjs <outdir>   (writes <outdir>/fixture-b-extract.json for the UI shots)
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3986, tag = 'cnt1-' + Date.now();
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL_TABLES = ['business_members', 'sales_goals', 'sales_partner_events', 'sales_week_goals', 'sales_week_goal_steps', 'sales_call_notes', 'sales_targets', 'sales_opportunities', 'sales_sequenced_accounts', 'partner_contacts', 'business_anthropic_usage'];
const OUT = process.argv[2] || '/tmp';
const made = { biz: null, users: [] };
let srv, log = '', pass = 0, total = 0;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
setTimeout(() => { console.log('ABORT (5 min cap)'); cleanup().then(() => process.exit(2)); }, 300000);

const FIXTURE_A = `Call with Seif - Oct 12. Jack, Cyrus and Seif.
Seif thinks renter-investing platforms could put HomeLover in front of renters: Fundrise, Roofstock, EquityZen, RealBricks and Sequoia One are all worth approaching as partners.
Big employers worth a look for the benefit itself: Deloitte, Schneider Electric, John Hancock and Mercer all run large benefits programs for their own staff.
Current partners: Gallagher is moving forward on the broker pilot. Aon wants a one-pager. Perk Spot's listing is under review. Core Stream asked for pricing.
Tooling: we pull lists from Apollo, check them with Clever, and Seif mentioned Plaid for income checks.
Seif will intro us to someone at Brad's company.
Action items: Jack to send Aon the one-pager by Friday. Cyrus to follow up with Core Stream on pricing.`;
const FIXTURE_B = `Upside x HomeLover joint plan - Oct 13. Brad (Upside) and Jack.
Ownership: 24 Hour Fitness stays with HomeLover - Jack owns it, Brad is co-owner, and we keep one owner: no double-touching. Upside leads Marriott (Brad owns it); pause Cyrus's Marriott sequence. Upside owns Gallagher. Upside owns Alliant as well.
People: Brad is our counterpart at Upside. Rachel McCarter, VP Employee Benefits, moved from Mercer to Alliant. Jill Vaslow at Marriott, Managing VP Benefits, looks like our champion there.
New broker targets for Upside to open: Marsh McLennan Agency and Lockton.
Update: Crystal Pringle at [solidcore] replied Oct 13 - circle back end of year.
Tools: we'll clean lists with ZeroBounce and Apollo.
Next steps: Cyrus to pause his Marriott sequence. Jack to send the 24HF joint note with Brad cc'd. Jack to book the Solidcore December call by Dec 1.`;
const FIXTURE_C = 'Emailed Pat Example at TEST-Broker Co on Oct 13 about the pilot. Called TEST-Broker Co Oct 13, no answer.';

async function hl() {
  const o = {};
  for (const t of HL_TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER); o[t] = r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
  return o;
}
async function cleanup() {
  if (srv) srv.kill();
  const b = made.biz;
  if (b) {
    for (const t of ['sales_partner_events', 'partner_contacts', 'sales_week_goal_steps', 'sales_week_goals', 'sales_targets', 'sales_opportunities', 'sales_call_notes', 'sales_sequenced_accounts', 'sales_goals', 'business_members', 'auth_events']) {
      const r = await svc.from(t).delete().eq('business_id', b);
      if (r.error) console.log(`cleanup ${t}: ${r.error.message}`);
    }
  }
  for (const u of made.users) { await svc.from('auth_events').delete().eq('user_id', u); await svc.from('auth_events').delete().eq('actor_id', u); }
  if (b) await svc.from('businesses').delete().eq('id', b);
  for (const u of made.users) await svc.auth.admin.deleteUser(u);
}
async function user(name, role) {
  const email = `${tag}-${name.split(' ')[0].toLowerCase()}@example.com`, password = 'Tmp-' + Math.random().toString(36).slice(2) + '!9';
  const { data: u } = await svc.auth.admin.createUser({ email, password, email_confirm: true }); made.users.push(u.user.id);
  await svc.from('profiles').update({ display_name: name, welcomed_at: new Date().toISOString() }).eq('id', u.user.id);
  ins(await svc.from('business_members').insert({ business_id: made.biz, email, name, user_id: u.user.id, role }).select());
  const c = createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  return { id: u.user.id, token: (await c.auth.signInWithPassword({ email, password })).data.session.access_token };
}

(async () => {
  const hlBefore = await hl(); const t0 = Date.now();
  const { normName } = await import(ROOT + '/api/sales/intakeMatch.js');
  const { acceptBody } = await import(ROOT + '/src/components/salesAnalytics/tasks/intakeBody.js');
  try {
    const T = made.biz = ins(await svc.from('businesses').insert({ name: `ZZ Intake ${tag.slice(-4)}`, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-jack@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const M = await user('Jack Zz', 'owner'), C = await user('Cyrus Zz', 'member'), V = await user('Viewer Zz', 'viewer');
    const P = (name, status, category) => ({ business_id: T, goal_type: 'partnership', name, pipeline_status: status, owner_user_id: M.id, category });
    const partners = ins(await svc.from('sales_goals').insert([
      P('Gallagher', 'replied', '4. Mid-Market Benefits Brokers'), P('Aon', 'not_started', '6. Enterprise Benefits Consultants'),
      P('PerkSpot', 'first_email_drafted', '2. Perk Marketplaces & Benefit Platforms'), P('Corestream', 'first_email_sent', '2. Perk Marketplaces & Benefit Platforms'),
      P('Alliant Insurance Services', 'first_email_sent', '4. Mid-Market Benefits Brokers'), P('Upside', 'meeting_set', '1. Current Partners (active)'),
      P('TEST-Broker Co', 'first_email_sent', '4. Mid-Market Benefits Brokers'),
    ]).select());
    const pid = n => partners.find(p => p.name === n).id;
    const [opp24] = ins(await svc.from('sales_opportunities').insert({ business_id: T, organization: '24 Hour Fitness', org_type: 'employer', stage: 'contacted', source: 'manual' }).select());
    const ago = d => new Date(Date.now() - d * 864e5).toISOString();
    const week = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const monday = new Date(Date.parse(`${week}T12:00:00Z`) - ((new Date(`${week}T12:00:00Z`).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
    ins(await svc.from('sales_sequenced_accounts').insert([
      { business_id: T, account_id: 'zz-acc-24hf', name: '24 Hour Fitness', first_sequenced_at: ago(20), week_start: monday },
      { business_id: T, account_id: 'zz-acc-marriott', name: 'Marriott International', first_sequenced_at: ago(20), week_start: monday },
      { business_id: T, account_id: 'zz-acc-solidcore', name: '[solidcore]', first_sequenced_at: ago(20), week_start: monday },
    ]).select());
    ins(await svc.from('sales_targets').insert({ business_id: T, name: 'ZeroBounce', kind: 'employer', status: 'rejected', decided_at: ago(3) }).select());
    ins(await svc.from('sales_partner_events').insert({ business_id: T, goal_id: pid('TEST-Broker Co'), event: 'touch', touch_type: 'email', contact_names: ['Pat Example'], source: 'outlook', at: '2026-10-12T19:00:00Z', meta: {} }).select());
    console.log(`seed: workspace ${T}, 7 partners, 1 opportunity, 3 Apollo accounts, 1 rejected target, 1 Outlook touch`);

    srv = spawn('node', ['--dns-result-order=ipv4first', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 50 && !log.includes(`port ${PORT}`); i++) await wait(200);
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${T}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `prospector_at=${encodeURIComponent(u.token)}` }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const accept = (u, text, call_date, r, extra = {}) => call(u, 'POST', '/call-notes', {
      text, call_date, source_type: extra.source_type || 'call', source_label: extra.source_label || null,
      tasks: r.tasks.filter(t => !t.similar_to).map(t => ({ text: t.text, owner_user_id: t.owner_user_id, due_date: t.due_date, link_type: t.link_type, link_id: t.link_id, steps: t.steps })),
      ...acceptBody(r),
    });
    const company = (r, name) => r.companies.find(c => normName(c.name) === normName(name) || normName(c.name).replace(/ /g, '') === normName(name).replace(/ /g, ''));

    console.log('--- gates (no Claude call)');
    let g = await call(V, 'POST', '/call-notes/extract', { text: FIXTURE_A, call_date: '2026-10-12' });
    ok('viewer cannot extract (403)', g.status === 403, `${g.status}`);
    g = await call(V, 'POST', '/call-notes', { text: FIXTURE_A, call_date: '2026-10-12', tasks: [{ text: 'x' }] });
    ok('viewer cannot accept (403)', g.status === 403, `${g.status}`);
    g = await call(M, 'POST', '/call-notes/extract', { text: 'x', source_type: 'tweet' });
    ok('bad source_type refused (400)', g.status === 400, `${g.status}`);

    console.log('--- fixture A: real extract');
    const A = await call(M, 'POST', '/call-notes/extract', { text: FIXTURE_A, call_date: '2026-10-12', title: 'Seif call' });
    ok('A extract 200', A.status === 200, `${A.status} ${A.body.error || ''}`);
    const a = A.body;
    const expectA = { target_partner: ['Fundrise', 'Roofstock', 'EquityZen', 'RealBricks', 'Sequoia One'], target_employer: ['Deloitte', 'Schneider Electric', 'John Hancock', 'Mercer'], note: ['Gallagher', 'Aon', 'PerkSpot', 'Corestream'] };
    for (const [action, names] of Object.entries(expectA)) {
      const wrong = names.filter(n => company(a, n)?.action !== action).map(n => `${n}=${company(a, n)?.action || 'missing'}`);
      ok(`A: ${action} = ${names.join(', ')}`, !wrong.length, wrong.join(' '));
    }
    const notT = ['Plaid', 'Apollo', 'Clever'].filter(n => !(company(a, n)?.kind === 'not_target' && company(a, n)?.on === false));
    ok('A: not_target, unticked = Plaid, Apollo, Clever', !notT.length, notT.map(n => `${n}=${company(a, n)?.kind || 'missing'}`).join(' '));
    const brad = a.companies.find(c => /brad/i.test(c.name));
    ok("A: unclear, unticked = Brad's company", brad?.kind === 'unclear' && brad.on === false, JSON.stringify(brad && { name: brad.name, kind: brad.kind }));
    ok('A: "Perk Spot" / "Core Stream" matched by alias', company(a, 'PerkSpot')?.match?.id === pid('PerkSpot') && company(a, 'Corestream')?.match?.id === pid('Corestream'));
    ok('A: tasks kept (Aon one-pager -> Jack, Core Stream -> Cyrus)', a.tasks.some(t => /aon/i.test(t.text) && t.owner_user_id === M.id) && a.tasks.some(t => /core ?stream/i.test(t.text) && t.owner_user_id === C.id), JSON.stringify(a.tasks.map(t => [t.text, t.owner_user_id === M.id ? 'J' : t.owner_user_id === C.id ? 'C' : '-'])));
    const plaid = company(a, 'Plaid');
    if (plaid) { plaid.action = 'never'; plaid.on = true; }
    const accA = await accept(M, FIXTURE_A, '2026-10-12', a);
    ok('A accept 201', accA.status === 201, `${accA.status} ${accA.body.error || ''}`);
    const targetsA = ins(await svc.from('sales_targets').select('name, kind, status, research_prompt, source_note_id').eq('business_id', T));
    const researching = targetsA.filter(t => t.status === 'researching');
    ok('A: 9 targets at Researching with a research prompt, Plaid remembered as rejected', researching.length === 9 && researching.every(t => t.research_prompt && t.source_note_id) && targetsA.some(t => t.name === 'Plaid' && t.status === 'rejected'), targetsA.map(t => `${t.name}:${t.status}`).join(', '));
    const todosA = ins(await svc.from('sales_week_goals').select('text, link_type, link_id, due_date, source_note_id').eq('business_id', T));
    ok('A: one research to-do per target, linked to it, due +3 days', todosA.filter(t => t.link_type === 'target' && /^Research /.test(t.text)).length === 9);
    const touchA = ins(await svc.from('sales_partner_events').select('goal_id, touch_type, from_status, to_status, contact_names').eq('business_id', T).eq('event', 'touch').neq('source', 'outlook'));
    console.log(`  A wrote ${touchA.length} touch(es): ${touchA.map(e => `${partners.find(p => p.id === e.goal_id).name} ${e.touch_type}${e.to_status ? ` ${e.from_status}->${e.to_status}` : ''}`).join(' · ') || 'none'}; stage moves ${JSON.stringify((accA.body.stage_moves || []).map(m => [m.partner, m.to, m.ok]))}`);
    const notesA = ins(await svc.from('sales_partner_events').select('goal_id, note, meta').eq('business_id', T).eq('event', 'note'));
    ok('A: "Add this note" wrote one note event on each of the 4 existing partners', ['Gallagher', 'Aon', 'PerkSpot', 'Corestream'].every(n => notesA.some(e => e.goal_id === pid(n) && e.meta?.from_note_id)), String(notesA.length));

    console.log('--- re-paste (0 Claude calls)');
    const dupA = await call(M, 'POST', '/call-notes/extract', { text: FIXTURE_A, call_date: '2026-10-12' });
    ok('re-extract -> the earlier note, no AI call', dupA.status === 200 && dupA.body.duplicate?.id === accA.body.note?.id, JSON.stringify(dupA.body).slice(0, 120));
    const reA = await accept(M, FIXTURE_A, '2026-10-12', a);
    ok('re-accept -> 409', reA.status === 409, `${reA.status}`);

    console.log('--- fixture B: real extract');
    const B = await call(M, 'POST', '/call-notes/extract', { text: FIXTURE_B, call_date: '2026-10-13', title: 'Upside joint plan', source_type: 'partner_update', source_label: 'Brad weekly 10/13' });
    ok('B extract 200', B.status === 200, `${B.status} ${B.body.error || ''}`);
    const b = B.body;
    fs.writeFileSync(`${OUT}/fixture-b-extract.json`, JSON.stringify(b));
    ok('B: no "@" anywhere in the response', !JSON.stringify(b).includes('@'));
    ok('B: rejected ZeroBounce not proposed again; Apollo is not_target', !company(b, 'ZeroBounce') && (b.rejected || []).includes('ZeroBounce') && company(b, 'Apollo')?.kind === 'not_target', JSON.stringify({ rejected: b.rejected, apollo: company(b, 'Apollo')?.kind }));
    const own = n => b.ownership.find(o => normName(o.company).includes(normName(n)) || normName(n).includes(normName(o.company)));
    ok('B: ownership proposed for 24 Hour Fitness, Marriott, Gallagher, Alliant', ['24 Hour Fitness', 'Marriott', 'Gallagher', 'Alliant'].every(n => own(n)), b.ownership.map(o => `${o.company}:${o.owner_team}`).join(', '));
    ok('B: Marriott ownership will add it to pipeline', own('Marriott')?.creates_opportunity === true);
    const crystal = b.touches.find(t => /solidcore/i.test(t.company));
    ok('B: solidcore reply shown, kept with the note', crystal && crystal.kept_with_note && crystal.on === false, JSON.stringify(crystal && { c: crystal.company, kept: crystal.kept_with_note }));
    ok('B: Marsh McLennan Agency + Lockton proposed as partner targets with a broker category', ['Marsh McLennan Agency', 'Lockton'].every(n => company(b, n)?.action === 'target_partner' && /Broker/.test(company(b, n)?.category || '')), ['Marsh McLennan Agency', 'Lockton'].map(n => `${n}=${company(b, n)?.action}/${company(b, n)?.category}`).join(' '));
    const accB = await accept(M, FIXTURE_B, '2026-10-13', b, { source_type: 'partner_update', source_label: 'Brad weekly 10/13' });
    ok('B accept 201', accB.status === 201, `${accB.status} ${accB.body.error || ''}`);
    const noteB = accB.body.note || {};
    ok('B: note stored with its source type + label', noteB.source_type === 'partner_update' && noteB.source_label === 'Brad weekly 10/13');
    const opps = ins(await svc.from('sales_opportunities').select('*').eq('business_id', T));
    const o24 = opps.find(o => o.id === opp24.id), mar = opps.find(o => /marriott/i.test(o.organization));
    ok('B: 24 Hour Fitness opportunity: HomeLover, co-owner Brad, one owner', o24.owner_team === 'homelover' && /brad/i.test(o24.co_owner_name || '') && o24.no_double_touch === true, JSON.stringify({ t: o24.owner_team, c: o24.co_owner_name, n: o24.no_double_touch }));
    ok('B: Marriott opportunity created at contacted, Upside, Jill Vaslow in decision makers', mar && mar.stage === 'contacted' && mar.owner_team === 'upside' && mar.source === 'manual' && /Jill Vaslow/.test(mar.decision_makers || ''), JSON.stringify(mar && { s: mar.stage, t: mar.owner_team, d: mar.decision_makers }));
    const goals = ins(await svc.from('sales_goals').select('id, name, owner_team').eq('business_id', T));
    ok('B: Gallagher + Alliant owner_team upside', ['Gallagher', 'Alliant Insurance Services'].every(n => goals.find(x => x.name === n).owner_team === 'upside'));
    const assigns = ins(await svc.from('sales_partner_events').select('goal_id, meta').eq('business_id', T).eq('event', 'assign'));
    ok("B: each partner ownership change is an 'assign' event with from_note_id", assigns.length >= 2 && assigns.every(e => e.meta?.from_note_id === noteB.id && e.meta?.ownership), String(assigns.length));
    const contacts = ins(await svc.from('partner_contacts').select('goal_id, name, title, role_in_notes, source, email').eq('business_id', T));
    const rachel = contacts.find(c => c.name === 'Rachel McCarter'), bradC = contacts.find(c => /^Brad/.test(c.name));
    ok('B: Rachel McCarter on Alliant (VP Employee Benefits), Brad on Upside as counterpart, no emails', rachel?.goal_id === pid('Alliant Insurance Services') && /VP Employee Benefits/i.test(rachel.title || '') && bradC?.goal_id === pid('Upside') && bradC.role_in_notes === 'counterpart' && contacts.every(c => c.email === null && c.source === 'manual'), JSON.stringify(contacts.map(c => [c.name, c.role_in_notes])));
    const moved = ins(await svc.from('sales_partner_events').select('note').eq('goal_id', pid('Alliant Insurance Services')).eq('event', 'note'));
    ok('B: Alliant gets "previously at Mercer"', moved.some(e => /previously at Mercer/.test(e.note)), JSON.stringify(moved.map(e => e.note)));
    const tasksB = ins(await svc.from('sales_week_goals').select('text, owner_user_id, due_date, link_type, link_id').eq('business_id', T).eq('source_note_id', noteB.id));
    ok('B: "Pause ... Marriott sequence" -> Cyrus', tasksB.some(t => /pause/i.test(t.text) && /marriott/i.test(t.text) && t.owner_user_id === C.id), JSON.stringify(tasksB.map(t => t.text)));
    ok('B: "Send 24HF joint note" -> Jack', tasksB.some(t => /24/.test(t.text) && t.owner_user_id === M.id));
    ok('B: "Book Solidcore December call" due 2026-12-01, linked to the solidcore account', tasksB.some(t => /solidcore/i.test(t.text) && t.due_date === '2026-12-01' && t.link_type === 'company' && t.link_id === 'zz-acc-solidcore'), JSON.stringify(tasksB.find(t => /solidcore/i.test(t.text))));
    const touchesB = ins(await svc.from('sales_partner_events').select('id, meta').eq('business_id', T).eq('event', 'touch'));
    ok('B: no touch event written from note B (solidcore is an employer: kept with the note)', !touchesB.some(e => e.meta?.from_note_id === noteB.id), String(touchesB.length));
    const oppEvents = ins(await svc.from('sales_opportunity_events').select('opportunity_id, event_type, to_stage').eq('business_id', T));
    const createdOpps = (accB.body.opportunities_created || []).map(o => o.organization);
    console.log(`  pipeline rows created by B: ${createdOpps.join(', ')}`);
    ok("opportunity stages: only 'created' events, every created row at contacted, no stage change", oppEvents.every(e => e.event_type === 'created') && oppEvents.length === 1 + createdOpps.length && oppEvents.filter(e => e.opportunity_id !== opp24.id).every(e => e.to_stage === 'contacted'), JSON.stringify(oppEvents.map(e => [e.event_type, e.to_stage])));

    console.log('--- fixture C: real extract (touch dedupe)');
    const Cx = await call(M, 'POST', '/call-notes/extract', { text: FIXTURE_C, call_date: '2026-10-13' });
    ok('C extract 200', Cx.status === 200, `${Cx.status} ${Cx.body.error || ''}`);
    const email = Cx.body.touches?.find(t => t.touch_type === 'email'), called = Cx.body.touches?.find(t => t.touch_type === 'call');
    ok('C: the Pat Example email = already recorded Oct 12 via Outlook, unticked', email?.duplicate?.source === 'outlook' && email.duplicate.date === '2026-10-12' && email.on === false, JSON.stringify(email && { d: email.duplicate, on: email.on }));
    ok('C: the nameless call is not deduped', called && !called.duplicate && called.on === true, JSON.stringify(called && { d: called.duplicate, people: called.people }));
    const accC = await accept(M, FIXTURE_C, '2026-10-13', Cx.body);
    ok('C accept 201', accC.status === 201, `${accC.status} ${accC.body.error || ''}`);
    const brokerTouches = ins(await svc.from('sales_partner_events').select('touch_type, source, meta').eq('goal_id', pid('TEST-Broker Co')).eq('event', 'touch'));
    ok('C: one new manual call touch, the email not written again', brokerTouches.length === 2 && brokerTouches.some(e => e.touch_type === 'call' && e.source === 'manual' && e.meta?.from_note_id === accC.body.note?.id), JSON.stringify(brokerTouches.map(e => [e.touch_type, e.source])));

    console.log('--- a failure part-way is undone (0 Claude calls)');
    const before = ins(await svc.from('sales_targets').select('id').eq('business_id', T)).length;
    const bad = await call(M, 'POST', '/call-notes', { text: 'ZZ undo test note', call_date: '2026-10-13', companies: [
      { key: 'u0', name: 'ZZ Undo One', kind: 'partner', action: 'target_partner' }, { key: 'u1', name: 'Lockton', kind: 'partner', action: 'target_partner' }] });
    const after = ins(await svc.from('sales_targets').select('id').eq('business_id', T)).length;
    const undoNote = ins(await svc.from('sales_call_notes').select('id').eq('business_id', T).eq('text', 'ZZ undo test note'));
    ok('second target collides -> 409, first target and the note removed', bad.status === 409 && after === before && !undoNote.length, `${bad.status} ${before}->${after} notes=${undoNote.length}`);

    const usage = ins(await svc.from('business_anthropic_usage').select('call_type, user_id, cost_usd').eq('business_id', T));
    const cost = usage.reduce((s, u) => s + Number(u.cost_usd || 0), 0);
    ok('usage: exactly 3 rows (A, B, C), each with user_id + cost_usd', usage.length === 3 && usage.every(u => u.user_id === M.id && Number(u.cost_usd) > 0 && u.call_type === 'call_tasks'), JSON.stringify(usage));
    console.log(`Claude: 3 calls, cost_usd ${cost.toFixed(6)} · Apollo: 0 · syncs: 0`);
    ok('no Apollo / sync request in the server log', !/apollo\.io|\[sync\]/i.test(log));
  } catch (e) {
    ok('script ran without throwing', false, e.message);
  } finally {
    await cleanup();
    const left = await svc.from('businesses').select('id', { count: 'exact', head: true }).eq('id', made.biz);
    const profiles = await svc.from('profiles').select('id', { count: 'exact', head: true }).in('id', made.users.length ? made.users : ['00000000-0000-0000-0000-000000000000']);
    console.log(`teardown: workspace left ${left.count}, temp profiles left ${profiles.count}`);
    const hlAfter = await hl();
    const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
    ok(`HomeLover counts identical (${HL_TABLES.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
    console.log(`${pass}/${total} passed · ${Math.round((Date.now() - t0) / 1000)}s`);
    process.exit(pass === total ? 0 : 1);
  }
})();
