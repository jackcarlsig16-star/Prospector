// call-notes-targets-v1 REV5 Stage 5 live check. TEMP data only: 1 workspace (goals_sales on, added to SALES_ANALYTICS_BUSINESS_IDS for the local server only), 3 temp users ("Jack Zz" owner, "Cyrus Zz" member, viewer), 1 partner Equifax at Meeting set. ONE real Claude extract of fixture D (api/sales/testing/callNoteFixtureD.txt) - its stored extract is written back to callNoteFixtureD.real.json for the 0-Claude replays. Then: Accept (waiting rows, counterparts, decisions, terms, next meeting, stored extract), duplicate paste + second Accept refused, Viewer gates, Nudge + Got it, carry-over skips waiting rows, Tidy nudge + reply suppression, bundle sections. UI (Playwright, serves build/ - run npm run build first): review sections (the browser's extract is fulfilled from the saved real reply: 0 more Claude), Today chip + overdue section, drawer Waiting list, card Tasks drawer + Decision chips + header line, Pipeline Due, Viewer read-only, 1440 + 390 shots, report PDF prints. 0 Apollo / 0 syncs. HomeLover is only COUNTED. Teardown deletes everything. ~90-150s, cap 235s.
// Usage: node scripts/verify/call-notes-targets-v1-rev5-stage5.cjs <outdir> [--replay <saved extract reply .json>]
// --replay = 0 Claude: the extract checks run on a reply this script saved earlier (cnt5-extract.json), and Accept uses it.
const ROOT = require('path').resolve(__dirname, '../..');
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { spawn } = require('child_process');
const fs = require('fs');
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js');
const { chromium } = require(ROOT + '/node_modules/playwright');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const PORT = 3991, tag = 'cnt5-' + Date.now();
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0];
const HOMELOVER = process.env.SALES_ANALYTICS_BUSINESS_IDS.split(',')[0];
const HL_TABLES = ['business_members', 'sales_goals', 'sales_partner_events', 'sales_week_goals', 'sales_call_notes', 'partner_contacts', 'sales_suggestions', 'sales_tidy_runs', 'business_anthropic_usage'];
const OUT = process.argv[2] || '/tmp';
const REPLAY = process.argv.includes('--replay') ? process.argv[process.argv.indexOf('--replay') + 1] : null;
const NOTE = fs.readFileSync(`${ROOT}/api/sales/testing/callNoteFixtureD.txt`, 'utf8');
const made = { biz: null, users: [] };
let srv, browser, log = '', pass = 0, total = 0, blocked = 0, uiExtracts = 0, uiAccepts = 0, cost = null;
const ok = (n, c, d = '') => { total++; if (c) pass++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && d ? ` - ${d}` : ''}`); };
const ins = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const DAY = 864e5;
const cleanup = require('./lib/tempGuard.cjs')(removeTemp, { capMs: 235000 });
const PII = s => /@/.test(s) || /(?:\+?\d[\d\s().-]{7,}\d)/.test(s.replace(/\d{4}-\d{2}-\d{2}/g, ''));

async function hl() {
  const o = {};
  for (const t of HL_TABLES) { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HOMELOVER); o[t] = r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; }
  return o;
}
async function removeTemp() {
  if (browser) await browser.close().catch(() => {});
  if (srv) srv.kill();
  const b = made.biz;
  if (b) {
    for (const t of ['sales_suggestions', 'sales_tidy_runs', 'sales_partner_events', 'partner_contacts', 'sales_week_goal_steps', 'sales_week_goals', 'sales_targets', 'sales_call_notes', 'sales_opportunities', 'sales_goals', 'business_anthropic_usage', 'business_members', 'auth_events']) {
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
  const { data: s } = await c.auth.signInWithPassword({ email, password });
  return { id: u.user.id, token: s.session.access_token, session: s.session };
}
let WS_NAME, extractReply = null;
async function newPage(u, width, height, url = '/?tab=today') {
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage(); page.setDefaultTimeout(12000);
  page.on('console', m => { if (m.type() === 'error' && !/favicon|net::ERR_FAILED|Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => errs.push('PAGE ' + e.message.slice(0, 160)));
  await page.route(/\/api\/sales\/[^/]+\/(sync|apollo)/, r => { blocked++; r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"blocked by verify script"}' }); });
  await page.route(/\/goals\/tidy\/run$/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ran":false,"reason":"blocked by verify script"}' }));
  await page.route(/\/goals\/call-notes\/extract$/, r => { uiExtracts++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(extractReply) }); });
  await page.route(/\/goals\/call-notes$/, r => { uiAccepts++; r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"accept blocked by verify script"}' }); });
  await page.addInitScript(([k, v]) => { if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v); }, [`sb-${REF}-auth-token`, JSON.stringify(u.session)]);
  await page.goto(`http://localhost:${PORT}${url}`); await page.waitForTimeout(3000);
  return { page, errs };
}
async function navSales(page, compact) {
  const menu = async () => { if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); } };
  await menu(); await page.getByLabel('Workspace').selectOption({ label: WS_NAME }); await page.waitForTimeout(2500);
  await menu(); await page.locator('#root').getByRole('button', { name: 'Goals & Sales', exact: true }).dispatchEvent('click'); await page.waitForTimeout(4000);
}
const drawerSel = 'aside[aria-labelledby="task-drawer-title"]';
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: 'disabled', caret: 'hide' });
const tab = (page, name) => page.locator('#workspace-header-tabs').getByRole('button', { name }).first().click();
const partnerRow = (page, name) => page.locator('[data-partner-id]', { hasText: name }).first();

(async () => {
  const hlBefore = await hl(); const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  const { acceptBody } = await import(`${ROOT}/src/components/salesAnalytics/tasks/intakeBody.js`);
  try {
    WS_NAME = `ZZ Deal ${tag.slice(-4)}`;
    const T = made.biz = ins(await svc.from('businesses').insert({ name: WS_NAME, website_url: 'https://example.com', color: '#777777', owner_email: `${tag}-jack@example.com`, access_code: tag, features: { goals_sales: true } }).select().single()).id;
    const J = await user('Jack Zz', 'owner'), C = await user('Cyrus Zz', 'member'), V = await user('Viewer Zz', 'viewer');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const monday = new Date(Date.parse(`${today}T12:00:00Z`) - ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
    const daysBack = n => new Date(Date.parse(`${today}T12:00:00Z`) - n * DAY).toISOString().slice(0, 10);
    const EQ = ins(await svc.from('sales_goals').insert({ business_id: T, goal_type: 'partnership', name: 'Equifax', owner_user_id: J.id, pipeline_status: 'meeting_set', notes: 'Met at the benefits summit' }).select().single()).id;
    console.log(`seed: workspace ${T}, 3 users, partner Equifax (meeting_set)`);

    srv = spawn('node', ['--dns-result-order=ipv4first', 'server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', SALES_ANALYTICS_BUSINESS_IDS: `${process.env.SALES_ANALYTICS_BUSINESS_IDS},${T}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    for (let i = 0; i < 60 && !log.includes(`port ${PORT}`); i++) await wait(250);
    const call = (u, method, path, body) => fetch(`http://localhost:${PORT}/api/sales/${T}/goals${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: `prospector_at=${encodeURIComponent(u.token)}` }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const rows = async (t, f = q => q) => ins(await f(svc.from(t).select('*').eq('business_id', T)));
    const usageCount = async () => (await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).eq('business_id', T)).count;

    console.log('--- extract (ONE real Claude call)');
    ok('viewer cannot extract (403, 0 Claude)', (await call(V, 'POST', '/call-notes/extract', { text: NOTE, call_date: '2026-10-16' })).status === 403);
    const ex = REPLAY ? { status: 200, body: JSON.parse(fs.readFileSync(REPLAY, 'utf8')) } : await call(J, 'POST', '/call-notes/extract', { text: NOTE, call_date: '2026-10-16', title: 'Equifax partnership sync', source_type: 'call' });
    ok(REPLAY ? 'replayed extract (0 Claude)' : 'real extract 200', ex.status === 200 && !ex.body.duplicate, JSON.stringify(ex.body).slice(0, 200));
    const r = ex.body;
    if (!REPLAY) fs.writeFileSync(`${OUT}/cnt5-extract.json`, JSON.stringify(r));
    // Ids in a saved reply belong to that run's temp workspace: re-point them at this one.
    if (REPLAY) for (const k of ['decisions', 'waiting_on', 'terms', 'next_meeting', 'touches', 'people', 'facts', 'companies']) for (const x of r[k] || []) if (x.match?.type === 'partner') x.match.id = EQ;
    if (REPLAY) for (const t of r.tasks || []) { t.owner_user_id = t.owner_user_id ? (/Cyrus/i.test(`${t.text} ${t.evidence}`) ? C.id : J.id) : null; if (t.link_type === 'partner') t.link_id = EQ; }
    const USAGE = REPLAY ? 0 : 1;
    cost = r.usage;
    console.log(`cost: ${JSON.stringify(r.usage)}${REPLAY ? ' (from the saved run)' : ''}`);
    ok(`exactly ${USAGE} usage row written for the temp workspace`, (await usageCount()) === USAGE);
    console.log(`tasks: ${(r.tasks || []).map(t => t.text).join(' | ')}`);
    console.log(`waiting: ${(r.waiting_on || []).map(w => `${w.who}: ${w.text} (${w.due_date})`).join(' | ')}`);
    ok('0 tasks for counterpart items or the meeting (no Dana / Priya / reconvene)', (r.tasks || []).every(t => !/\b(Dana|Priya|reconvene)\b/i.test(`${t.text} ${t.evidence}`)), (r.tasks || []).map(t => t.text).join(' | '));
    ok('every task owner is a member (Jack or Cyrus)', (r.tasks || []).length > 0 && r.tasks.every(t => [J.id, C.id].includes(t.owner_user_id)), (r.tasks || []).map(t => `${t.text}:${t.owner_user_id}`).join(' | '));
    ok('4+ waiting-on rows, each on Equifax with Dana or Priya', (r.waiting_on || []).length >= 4 && r.waiting_on.every(w => w.on && w.match?.id === EQ && /^(Dana|Priya)$/.test(w.who)), JSON.stringify(r.waiting_on).slice(0, 300));
    ok('Dana\'s list is due Oct 23', (r.waiting_on || []).some(w => w.who === 'Dana' && w.due_date === '2026-10-23'));
    const covers = (list, keys) => { const all = list.map(x => x.text).join(' ').toLowerCase(); return keys.every(k => all.includes(k)); };
    console.log(`decisions ${(r.decisions || []).length} · terms ${(r.terms || []).length} (the note has 5 · 3)`);
    ok('decisions cover all 5 decision bullets', covers(r.decisions || [], ['3 equifax employer clients', 'featured partner', 'owns the employer relationship', 'co-branded one-pager', 'monthly check-in']));
    ok('terms cover all 3 economic-model bullets, each line "(10/16) Terms: …"', covers(r.terms || [], ['20%', 'pay nothing', '$500']) && r.terms.every(t => t.line.startsWith('(10/16) Terms: ')));
    ok('next meeting = Monday Oct 26 (the week of Oct 27)', r.next_meeting?.length === 1 && r.next_meeting[0].date === '2026-10-26', JSON.stringify(r.next_meeting));
    ok('extract + signature returned, no "@" / phone in the reply', !!r.extract && typeof r.extract_sig === 'string' && !PII(JSON.stringify(r.extract)));
    ok('no recent-accept warning on a fresh partner', Array.isArray(r.recent_accepts) && r.recent_accepts.length === 0);

    console.log('--- accept');
    const tasks = (r.tasks || []).map(t => ({ text: t.text, owner_user_id: t.owner_user_id, due_date: t.due_date, link_type: t.link_type, link_id: t.link_id, steps: t.steps }));
    const body = { text: NOTE, title: 'Equifax partnership sync', call_date: r.call_date, source_type: 'call', tasks, ...acceptBody(r), extract: r.extract, extract_sig: r.extract_sig };
    const a = await call(J, 'POST', '/call-notes', body);
    ok('Accept 201', a.status === 201, JSON.stringify(a.body).slice(0, 240));
    const note = ins(await svc.from('sales_call_notes').select('*').eq('id', a.body.note?.id).single());
    const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
    ok('note.extract stored = the model reply (signed copy; jsonb reorders keys)', !!note.extract && canon(note.extract) === canon(r.extract));
    if (!REPLAY) fs.writeFileSync(`${ROOT}/api/sales/testing/callNoteFixtureD.real.json`, `${JSON.stringify(note.extract, null, 1)}\n`);
    const week = await rows('sales_week_goals');
    const waiting = week.filter(w => w.kind === 'waiting');
    ok('waiting rows: 4+, owner null, waiting_on set, linked to Equifax, open, this week', waiting.length >= 4 && waiting.every(w => w.owner_user_id === null && w.waiting_on && w.link_type === 'partner' && w.link_id === EQ && w.status === 'open' && w.week_start === monday && w.source_note_id === note.id));
    const todos = week.filter(w => w.kind === 'todo');
    ok('our to-dos only: owned, none for the meeting', todos.length === tasks.length && todos.every(t => t.owner_user_id) && !todos.some(t => /reconvene|meeting/i.test(t.text)), todos.map(t => t.text).join(' | '));
    const contacts = await rows('partner_contacts');
    ok('Dana + Priya are people on Equifax, role counterpart, no email', ['Dana', 'Priya'].every(n => contacts.some(c => c.name === n && c.goal_id === EQ && c.role_in_notes === 'counterpart' && !c.email)), JSON.stringify(contacts.map(c => [c.name, c.role_in_notes])));
    const events = await rows('sales_partner_events');
    const decisions = events.filter(e => e.event === 'note' && e.meta?.kind === 'decision');
    const D = (r.decisions || []).length, M = (r.terms || []).length;
    ok(`one decision note event per decision row (${D}) with meta.kind + from_note_id`, decisions.length === D && decisions.every(e => e.meta.from_note_id === note.id));
    const g = ins(await svc.from('sales_goals').select('*').eq('id', EQ).single());
    ok(`notes kept + one Terms line per terms row (${M}) appended`, g.notes.startsWith('Met at the benefits summit\n') && g.notes.split('\n').filter(l => l.startsWith('(10/16) Terms: ')).length === M, g.notes);
    ok('next_meeting_at = 2026-10-26; stage unchanged (meeting_set)', g.next_meeting_at === '2026-10-26' && g.pipeline_status === 'meeting_set');
    ok('second Accept of the same notes -> 409', (await call(J, 'POST', '/call-notes', body)).status === 409);
    const dup = await call(J, 'POST', '/call-notes/extract', { text: NOTE, call_date: '2026-10-16' });
    ok('same notes pasted again -> duplicate, no Claude call', dup.status === 200 && dup.body.duplicate?.id === note.id && (await usageCount()) === USAGE);

    console.log('--- surfaces (API)');
    const board = await call(V, 'GET', '/pipeline-board');
    const eqRow = (board.body.rows || board.body || []).find?.(x => x.id === EQ);
    ok('Pipeline board: Equifax next_step_due = next meeting', eqRow?.next_step_due === '2026-10-26', JSON.stringify(eqRow).slice(0, 160));
    const vw = await call(V, 'GET', `/tasks?link_type=partner&link_id=${EQ}&kind=waiting`);
    ok('viewer reads waiting rows', vw.status === 200 && vw.body.tasks.length === waiting.length);
    const dana = waiting.find(w => w.waiting_on === 'Dana'), priya = waiting.find(w => w.waiting_on === 'Priya');
    ok('viewer cannot Got it (403) or Nudge (403)', (await call(V, 'PATCH', `/week/${dana.id}`, { status: 'done' })).status === 403 && (await call(V, 'POST', `/waiting/${dana.id}/nudge`, {})).status === 403);
    const wk = await call(J, 'GET', `/week?from=${monday}&to=${monday}&kind=todo`);
    ok('This week\'s to-do list has no waiting rows', wk.status === 200 && wk.body.goals.every(x => x.kind === 'todo') && wk.body.goals.length === todos.length);
    const next = new Date(Date.parse(`${monday}T12:00:00Z`) + 7 * DAY).toISOString().slice(0, 10);
    const co = await call(J, 'POST', '/week/carry-over', { week_start: next });
    ok('carry-over copies our open to-dos, never a waiting row', co.status === 200 && co.body.carried.length === todos.length && co.body.carried.every(x => x.kind === 'todo'), JSON.stringify(co.body).slice(0, 160));
    await svc.from('sales_week_goals').delete().in('id', co.body.carried.map(x => x.id));
    const n1 = await call(C, 'POST', `/waiting/${dana.id}/nudge`, {});
    ok('Nudge (Cyrus) -> OUR open to-do "Nudge Dana re …", due today, owner Cyrus, linked to Equifax', n1.status === 201 && n1.body.todo.kind === 'todo' && n1.body.todo.text.startsWith('Nudge Dana re ') && n1.body.todo.due_date === today && n1.body.todo.owner_user_id === C.id && n1.body.todo.link_id === EQ, JSON.stringify(n1.body).slice(0, 200));
    const lastPriya = waiting.filter(w => w.waiting_on === 'Priya').slice(-1)[0];
    const got = await call(J, 'PATCH', `/week/${lastPriya.id}`, { status: 'done' });
    ok('Got it -> that row done; the rest stay open', got.status === 200 && got.body.goal.status === 'done');
    ok('PATCH waiting_on > 120 chars -> 400', (await call(J, 'PATCH', `/week/${dana.id}`, { waiting_on: 'x'.repeat(121) })).status === 400);

    console.log('--- Tidy');
    ins(await svc.from('sales_week_goals').update({ due_date: daysBack(3) }).eq('id', priya.id).select());
    const tr = await call(J, 'POST', '/tidy/run', { trigger: 'test', force: true });
    const sugg = await rows('sales_suggestions');
    ok('Tidy: exactly one nudge (Priya, 3 days late), no Reply task for Equifax', tr.status === 200 && sugg.filter(s => s.kind === 'nudge').length === 1 && sugg.find(s => s.kind === 'nudge').ref_id === priya.id && sugg.find(s => s.kind === 'nudge').text === 'Nudge Priya at Equifax' && !sugg.some(s => s.kind === 'reply_task'), sugg.map(s => `${s.kind}:${s.text}`).join(' | '));
    const ta = await call(J, 'POST', `/suggestions/${sugg.find(s => s.kind === 'nudge').id}/accept`, {});
    ok('accept the nudge -> to-do "Nudge Priya re …", due today, linked to Equifax', ta.status === 200 && ta.body.todo?.text.startsWith('Nudge Priya re ') && ta.body.todo.due_date === today && ta.body.todo.link_id === EQ, JSON.stringify(ta.body).slice(0, 200));

    const cb = await call(V, 'GET', `/copy-bundle?type=partner&id=${EQ}`);
    const md = cb.body.markdown || '';
    ok(`Copy for Claude: Next meeting + Decisions (${D}) + Waiting on them + Terms (${M}), no "@" / phone`, cb.status === 200 && /Next meeting: Oct 26, 2026/.test(md) && md.split('## Decisions')[1]?.split('\n## ')[0].split('\n').filter(l => l.startsWith('- ')).length === D && /## Waiting on them\n(- .+\n)*- Dana · /.test(md) && md.split('## Terms')[1]?.split('\n## ')[0].split('\n').filter(l => l.startsWith('- (10/16) Terms: ')).length === M && !PII(md), md.slice(md.indexOf('## Decisions'), md.indexOf('## Decisions') + 400));

    console.log('--- UI');
    const build = fs.readdirSync(`${ROOT}/build/static/js`).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(`${ROOT}/build/static/js/${f}`, 'utf8')).join('\n');
    ok('bundle marker: "Waiting on them" + "Nudge to-do added for today" + "only a partner keeps it" in build/', build.includes('Waiting on them') && build.includes('Nudge to-do added for today') && build.includes('only a partner keeps it'));
    // The browser's extract replays the real reply above; the warning line carries the real accepted note's numbers.
    const evCount = (await rows('sales_partner_events')).filter(e => e.meta?.from_note_id === note.id).length;
    extractReply = { ...r, recent_accepts: [{ partner: 'Equifax', partner_id: EQ, note_id: note.id, minutes_ago: Math.round((Date.now() - Date.parse(note.created_at)) / 60000), todos: todos.length + waiting.length, events: evCount }] };
    browser = await chromium.launch();
    const openOn = (await rows('sales_week_goals')).filter(w => w.kind === 'waiting' && w.status === 'open').length;
    for (const [width, height, compact] of [[1440, 900, false], [390, 844, true]]) {
      const { page, errs } = await newPage(J, width, height);
      await navSales(page, compact);
      const chip = page.locator('[data-today-chips] button', { hasText: 'Waiting on' });
      await chip.waitFor();
      ok(`${width}: Today chip "⏳ Waiting on (${openOn})"`, (await chip.innerText()).trim() === `⏳ Waiting on (${openOn})`, await chip.innerText());
      const late = page.locator('[aria-label="Waiting on them · overdue"]');
      ok(`${width}: Your day "Waiting on them · overdue (1)" = Priya; not in Overdue`, (await late.locator('li').count()) === 1 && /Priya:/.test(await late.innerText()) && !(await page.locator('[aria-label="Overdue"]').innerText().catch(() => '')).includes('Priya'), await late.innerText().catch(() => 'missing'));
      await shot(page, `cnt5-${width}-today`);
      await chip.click();
      const drawer = page.locator(drawerSel); await drawer.waitFor(); await page.waitForTimeout(800);
      ok(`${width}: chip opens the drawer on Waiting on: ${openOn} rows with Got it + Nudge`, (await drawer.locator('li[data-waiting-id]').count()) === openOn && (await drawer.getByRole('button', { name: /^Got it/ }).count()) === openOn && (await drawer.getByRole('button', { name: /^⏳ Waiting on/ }).getAttribute('aria-pressed')) === 'true');
      await shot(page, `cnt5-${width}-drawer-waiting`);
      await drawer.getByRole('button', { name: '📝 Paste notes' }).click();
      await drawer.getByRole('textbox', { name: 'Call notes' }).fill(NOTE.replace('Oct 16', 'Oct 16.'));
      await drawer.getByRole('button', { name: 'Read notes' }).click();
      await drawer.getByRole('region', { name: 'Decisions' }).waitFor();
      const order = await drawer.locator('section[aria-label]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
      const at = order.indexOf('Decisions');
      ok(`${width}: review order … Decisions · Waiting on them · Terms · Next meeting (after Touches)`, order.slice(at, at + 4).join('|') === 'Decisions|Waiting on them|Terms|Next meeting' && order.indexOf('Touches') < at, order.join('|'));
      ok(`${width}: 24 h warning line names Equifax`, /Another note on Equifax was accepted \d+ min ago/.test(await drawer.getByRole('note').first().innerText()));
      await drawer.getByRole('region', { name: 'Decisions' }).scrollIntoViewIfNeeded();
      await shot(page, `cnt5-${width}-review`);
      await drawer.getByRole('button', { name: 'Cancel' }).click().catch(() => {}); await page.waitForTimeout(300);
      await drawer.getByRole('button', { name: 'Close tasks' }).click().catch(() => {}); await page.waitForTimeout(300);
      await tab(page, /^Pipeline/); await page.waitForTimeout(2000);
      await page.locator('.ui-seg').getByRole('button', { name: 'Partner workflow', exact: true }).first().click().catch(() => {}); await page.waitForTimeout(1800);
      const row = partnerRow(page, 'Equifax'); await row.waitFor();
      await row.locator('button[aria-expanded]').first().click(); await page.waitForTimeout(1500);
      ok(`${width}: card header "Next meeting Oct 26 · Terms: …"`, /Next meeting Oct 26 · Terms: /.test(await row.innerText()));
      const tasksHead = row.getByRole('button', { name: /^Tasks/ });
      if ((await tasksHead.getAttribute('aria-expanded')) !== 'true') await tasksHead.click();
      const group = row.locator(`section[aria-label="Waiting on Equifax"]`); await group.waitFor();
      ok(`${width}: Tasks drawer "Waiting on Equifax (${openOn})" with Got it + Nudge`, (await group.innerText()).includes(`Waiting on Equifax (${openOn})`) && (await group.getByRole('button', { name: /^Got it/ }).count()) === openOn);
      const actHead = row.getByRole('button', { name: /^Activity/ });
      if ((await actHead.getAttribute('aria-expanded')) !== 'true') await actHead.click();
      await page.waitForTimeout(500);
      ok(`${width}: Activity shows a Decision chip per decision (${D})`, (await row.locator('ol[aria-label="Activity timeline"] li', { hasText: 'Decision' }).count()) >= D);
      await group.scrollIntoViewIfNeeded();
      await shot(page, `cnt5-${width}-card`);
      if (!compact) {
        await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'Board' }).click().catch(() => {});
        await page.locator('.ui-seg').getByRole('button', { name: /Board|Pipeline/, exact: false }).first().click().catch(() => {});
        await page.waitForTimeout(2000);
        const due = page.locator(`[data-row][data-key="partner-${EQ}"]`);
        const dueText = await due.innerText().catch(() => '');
        ok('1440: Pipeline Due for Equifax reads Oct 26 (read-only)', /Oct 26/.test(dueText) && (await due.getByLabel('Due for Equifax').count()) === 0, dueText.slice(0, 160));
        await shot(page, 'cnt5-1440-pipeline-due');
      }
      ok(`${width}: no sideways scroll`, await noSideScroll(page));
      ok(`${width}: 0 console errors`, !errs.length, errs.join(' | '));
      await page.context().close();
    }
    const { page: rp } = await newPage(J, 1440, 900);
    await navSales(rp, false);
    await tab(rp, /^Reports/); await rp.waitForTimeout(2500);
    await rp.pdf({ path: `${OUT}/cnt5-report.pdf`, landscape: true });
    ok('Weekly report PDF prints', fs.statSync(`${OUT}/cnt5-report.pdf`).size > 1000);
    await rp.context().close();

    const { page: vp, errs: verrs } = await newPage(V, 1440, 900, '/?tab=pipeline&view=partners');
    await navSales(vp, false);
    ok('viewer: no Waiting-on chip on Today', (await vp.locator('[data-today-chips] button', { hasText: 'Waiting on' }).count()) === 0);
    await tab(vp, /^Pipeline/); await vp.waitForTimeout(2000);
    await vp.locator('.ui-seg').getByRole('button', { name: 'Partner workflow', exact: true }).first().click().catch(() => {}); await vp.waitForTimeout(1800);
    const vrow = partnerRow(vp, 'Equifax'); await vrow.waitFor();
    await vrow.locator('button[aria-expanded]').first().click(); await vp.waitForTimeout(1500);
    const vth = vrow.getByRole('button', { name: /^Tasks/ });
    if ((await vth.getAttribute('aria-expanded')) !== 'true') await vth.click();
    const vg = vrow.locator('section[aria-label="Waiting on Equifax"]'); await vg.waitFor();
    ok('viewer: card lists Waiting on Equifax with no Got it / Nudge', (await vg.locator('li[data-waiting-id]').count()) === openOn && (await vg.getByRole('button').count()) === 0);
    await vg.scrollIntoViewIfNeeded();
    await shot(vp, 'cnt5-1440-viewer-card');
    ok('viewer: 0 console errors', !verrs.length, verrs.join(' | '));
    await vp.context().close();
    ok(`UI made 0 real extracts / accepts (fulfilled ${uiExtracts} / blocked ${uiAccepts}); usage rows still ${USAGE}`, (await usageCount()) === USAGE);
    ok('0 sync/Apollo requests reached the server', !/apollo\.io|\[sync\]/i.test(log), `blocked ${blocked}`);
  } catch (e) {
    ok('script ran without throwing', false, e.stack?.split('\n').slice(0, 3).join(' | ') || e.message);
  } finally {
    await cleanup();
    const left = await svc.from('businesses').select('id', { count: 'exact', head: true }).eq('id', made.biz);
    const profiles = await svc.from('profiles').select('id', { count: 'exact', head: true }).in('id', made.users.length ? made.users : ['00000000-0000-0000-0000-000000000000']);
    console.log(`teardown: workspace left ${left.count}, temp profiles left ${profiles.count}`);
    const hlAfter = await hl();
    const diff = Object.keys(hlBefore).filter(k => hlBefore[k] !== hlAfter[k]);
    ok(`HomeLover counts identical (${HL_TABLES.length} tables)`, !diff.length, diff.map(k => `${k} ${hlBefore[k]}->${hlAfter[k]}`).join(', '));
    console.log(`${pass}/${total} passed · ${Math.round((Date.now() - t0) / 1000)}s · Claude ${REPLAY ? '0 this run, replaying the 1 real' : 1} (${cost ? `$${cost.cost_usd} · ${cost.input_tokens} in / ${cost.output_tokens} out` : 'n/a'}) · Apollo 0`);
    process.exit(pass === total ? 0 : 1);
  }
})();
