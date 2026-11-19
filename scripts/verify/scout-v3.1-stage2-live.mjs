// scout-v3.1 Stage 2 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover workspace.
// DECLARED before it runs:
//   Claude  cap 3, cached in .screenshots/scout-v3.1/live-ledger.json (a re-run answers from the cache, 0 Claude):
//           1 ask (the exact Nov 10 ask) + 1 draft ("write an email to the second one") + 1 regenerate.
//           "Cyrus's top 5" and the Northrop brief are NOT asked of the model (that would be calls 4 and 5): their REAL
//           reads run in process (buildContext, 0 Claude) and the brief's screen is drawn from that read with a stand-in
//           sentence where the model's prose would be.
//   Apollo  0 (the server runs with the Apollo key empty).
//   Writes  through the real routes (/plan -> /act -> /undo), each undone and then restored:
//           (1) "snooze the first task until next week": that to-do's snooze_until -> next Monday -> back; its
//               updated_at is put back exactly; its 2 event rows (snooze + undo) are KEPT and listed.
//           (2) "add a task to call MetLife Thursday": one to-do (origin scout) -> Undo (dropped) -> the test to-do and
//               its 2 event rows are deleted (they exist only because of this run).
//           The draft writes nothing but its usage rows (kept: they are the cost record). Nothing is sent.
//   Reads   ~12 route calls, 3 in-process reads, 4 page loads (1440 x3 incl. a Viewer, 390 x1). ~170 s, cap 235 s.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ownerSession } from './lib/ownerSession.mjs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const OUT = path.join(ROOT, '.screenshots', 'scout-v3.1');
const PORT = 3994, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0], SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const TABLES = ['sales_week_goals', 'sales_todo_events', 'sales_team_email_sends', 'sales_prospect_state', 'sales_opportunities', 'sales_goals'];
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); return r.error ? `n/a (${r.error.message.slice(0, 40)})` : r.count; };
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const now = new Date();
const minsToSix = ((6 - (now.getHours() % 6)) % 6) * 60 - now.getMinutes();
if ((minsToSix >= 0 && minsToSix < 5) || (now.getHours() % 6 === 0 && now.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const CLAUDE_CAP = 3, ASK = 'pull me 5 most important prospects who are visiting and hot and show 5 most important tasks';
const LEDGER = path.join(OUT, 'live-ledger.json');
fs.mkdirSync(OUT, { recursive: true });
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { spent: 0, calls: {} };
const saveLedger = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
let srv, browser, owner, claudeThisRun = 0;
const results = { checks: [], errors: [] }, leftovers = [];
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 700)}` : ''); };
async function teardown() {
  for (const undo of leftovers.splice(0).reverse()) { try { log(await undo()); } catch (e) { log(`RESTORE FAILED: ${e.message}`); results.errors.push(`restore: ${e.message}`); } }
  if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 235000 });
const before = await snapshot();
log('before', JSON.stringify(before), `· Claude spent so far ${ledger.spent}/${CLAUDE_CAP}`);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ADDRESS = /[^\s"<>]+@[^\s"<>]+\.[a-z]{2,}/i;

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const post = async (p, body) => { const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  // one model call through the real route, counted against the cap and cached; a cached key costs nothing
  const paid = async (key, p, body) => {
    if (ledger.calls[key]) return { ...ledger.calls[key], cached: true };
    if (ledger.spent >= CLAUDE_CAP) throw new Error(`the Claude cap (${CLAUDE_CAP}) is spent and "${key}" is not cached`);
    ledger.spent += 1; claudeThisRun += 1; saveLedger();
    const t = Date.now(), r = await post(p, body);
    ledger.calls[key] = { status: r.status, body: r.body, elapsed: Math.round((Date.now() - t) / 100) / 10, at: new Date().toISOString() }; saveLedger();
    return ledger.calls[key];
  };
  const usageCost = async (callType, sinceIso) => (await svc.from('business_anthropic_usage').select('cost_usd, model, input_tokens, output_tokens, created_at').eq('call_type', callType).eq('user_id', owner.userId).gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(3)).data || [];
  const startIso = new Date(T0 - 5000).toISOString();

  // ---- 1. the exact Nov 10 ask (Claude 1 of 3)
  const a = await paid('ask', '/api/scout/ask', { q: ASK, scope: HL });
  const A = a.body, s1 = A.sections?.[0], s2 = A.sections?.[1];
  const bands = (s1?.rows || []).map(r => r.row?.heat_band);
  const split = bands.reduce((m, b) => { m[b] = (m[b] || 0) + 1; return m; }, {});
  ok(`ask${a.cached ? ' (cached, 0 Claude)' : ''}: HTTP ${a.status} · ${A.sections?.length} sections · people ${s1?.rows.length} (${Object.entries(split).map(([k, v]) => `${v} ${k}`).join(' · ')}) · tasks ${s2?.rows.length} · pill "${s1?.fill?.text || `${s1?.count} of ${s1?.total}`}"${s1?.fill ? '' : ' (no fill needed: the strict band already holds the count asked, or nothing warmer is on the site)'}`,
    a.status === 200 && A.sections?.length === 2 && s1.rows.every(r => r.entity === 'people') && s2.rows.every(r => r.entity === 'todos') && (s1.fill ? s1.fill.text === `${s1.rows.length} people · ${s1.fill.counts.map((c, i) => `${c.n} ${c.band}${i > 0 && i === s1.fill.counts.length - 1 ? ` to make ${s1.rows.length}` : ''}`).join(' · ')}${s1.rows.length < 5 ? ' (5 asked - that is every one on file)' : ''}` && s1.fill.counts.every(c => (split[c.band] || 0) === c.n) : true));
  const reads = [...(A.context_stats?.reads || []), ...(A.sections || []).map(s => s.read)];
  ok(`footer: ${A.context_stats?.reads?.length} reads, none holds a record id - ${(A.context_stats?.reads || []).join(' | ').slice(0, 300)}`, reads.length > 0 && reads.every(r => !UUID.test(r) && !/prospect:|person:/.test(r)));
  ok('ask: no address in the reply', !ADDRESS.test(JSON.stringify(A)));
  const rows = (A.sections || []).flatMap(s => s.rows).map(r => ({ entity: r.entity, id: r.id, title: r.title, company: r.row?.company ? { type: r.row.company.type, id: r.row.company.id, name: r.row.company.name } : null }));

  // ---- 2. "write an email to the second one" (Claude 2 of 3) and Regenerate (3 of 3): never sent
  const second = rows[1];
  const sendsBefore = await count('sales_team_email_sends');
  const d1 = await paid('draft', '/api/scout/plan', { scope: HL, inline: true, text: 'write an email to the second one', rows });
  const D = d1.body?.draft;
  if (second?.entity !== 'people') ok(`draft: the second row of the answer is a ${second?.entity} ("${second?.title}"), not a person - today's answer holds ${s1?.rows.length} person`, false);
  else if (d1.body?.cant) ok(`draft: Scout answered can't-do - "${d1.body.cant.reason}"`, false);
  else {
    const first = String(second.title).split(/\s+/)[0];
    ok(`draft${d1.cached ? ' (cached, 0 Claude)' : ''}: HTTP ${d1.status} · to ${D?.to?.name === second.title ? 'the second person of the answer' : `"${D?.to?.name}"`}${D?.to?.title ? ' (with a title)' : ''} at ${D?.company?.name} · ${D?.withheld ? `WITHHELD: ${D.reason}` : `greets them by first name: ${new RegExp(`^(hi|hello|hey|dear)\\s+${first}\\b`, 'i').test(D?.body || '')} · subject ${D?.subject?.length} chars · body ${D?.body?.split(/\s+/).length} words`} · cost $${D?.cost?.usd} · Write email ${D?.cap?.used} of ${D?.cap?.max} today · line "${d1.body?.line}"`,
      d1.status === 200 && D?.to?.name === second.title && D?.company?.name && D?.cost?.usd > 0 && (D.withheld || new RegExp(`\\b${first}\\b`).test(D.body)) && !ADDRESS.test(JSON.stringify(d1.body)));
    const d2 = await paid('regenerate', '/api/scout/plan', { scope: HL, inline: true, text: 'write an email to the second one', rows });
    const D2 = d2.body?.draft;
    ok(`regenerate${d2.cached ? ' (cached, 0 Claude)' : ''}: HTTP ${d2.status} · to the same person: ${D2?.to?.name === second.title} · a new draft: ${D2?.body !== D?.body} · cost $${D2?.cost?.usd} · Write email ${D2?.cap?.used} of ${D2?.cap?.max} today`, d2.status === 200 && D2?.to?.name === second.title && D2?.cost?.usd > 0 && (D2.cap?.used ?? 0) > (D.cap?.used ?? 0));
    const rowsUsed = await usageCost('intent_compose', startIso);
    ok(`cost from the usage row: ${claudeThisRun ? `${rowsUsed.length} intent_compose rows this run (${rowsUsed.map(u => `$${Number(u.cost_usd).toFixed(4)} ${u.model}`).join(', ')}) = the costs shown ($${D?.cost?.usd}, $${D2?.cost?.usd})` : 'cached run - no new usage rows'}; nothing sent: sales_team_email_sends ${sendsBefore} -> ${await count('sales_team_email_sends')}`,
      (await count('sales_team_email_sends')) === sendsBefore && (!claudeThisRun || rowsUsed.some(u => Math.abs(Number(u.cost_usd) - D2.cost.usd) < 0.00006)));
  }

  // ---- 3. "snooze the first task until next week": card -> act -> Undo, the to-do back exactly, its events listed
  const firstTask = rows.find(r => r.entity === 'todos');
  if (!firstTask) ok('snooze: the answer holds no task row', false);
  else {
    const read = async () => (await svc.from('sales_week_goals').select('id, status, snooze_until, due_date, owner_user_id, updated_at').eq('business_id', HL).eq('id', firstTask.id).single()).data;
    const was = await read();
    const eventsOf = async () => (await svc.from('sales_todo_events').select('id, kind, origin, batch_id, before, after, at').eq('business_id', HL).eq('todo_id', firstTask.id).gte('at', startIso).order('at')).data || [];
    leftovers.push(async () => { const cur = await read(); if (cur.snooze_until === was.snooze_until && cur.updated_at === was.updated_at) return 'snoozed task: already as it was'; const r = await svc.from('sales_week_goals').update({ snooze_until: was.snooze_until, updated_at: was.updated_at }).eq('id', firstTask.id).select('id'); return `snoozed task: snooze_until + updated_at put back (${r.data?.length} row)`; });
    const card = await post('/api/scout/plan', { scope: HL, text: 'snooze the first task until next week', rows });
    const c = card.body;
    const did = c?.plan_id ? await post('/api/scout/act', { plan_id: c.plan_id }) : null;
    const mid = await read();
    const un = did?.body?.can_undo ? await post('/api/scout/undo', { plan_id: c.plan_id }) : null;
    const after = await read(), evs = await eventsOf();
    ok(`snooze: card "${c?.verb}" for 1 task (the first task of the answer: ${c?.rows?.[0]?.key === `todos:${firstTask.id}`}) ${c?.rows?.[0]?.from} -> ${c?.rows?.[0]?.to} · act "${did?.body?.line}" -> the to-do's snooze_until ${was.snooze_until} -> ${mid.snooze_until} · Undo "${un?.body?.line}" -> ${after.snooze_until} · events: ${evs.map(e => `${e.kind} (origin ${e.origin}, batch = the card: ${e.batch_id === c?.plan_id})`).join(' + ')}`,
      card.status === 200 && c.verb === 'snooze' && c.rows.length === 1 && c.rows[0].key === `todos:${firstTask.id}` && did?.body?.done === 1 && mid.snooze_until === c.to && un?.body?.line === 'undone' && after.snooze_until === was.snooze_until && evs.map(e => e.kind).join() === 'snooze,undo' && evs.every(e => e.origin === 'scout' && e.batch_id === c.plan_id));
  }

  // ---- 4. "add a task to call MetLife Thursday": card -> act -> the to-do exists with origin scout -> Undo
  {
    const madeSince = new Date().toISOString();
    const find = async () => (await svc.from('sales_week_goals').select('id, text, status, origin, due_date, link_type, link_id, owner_user_id, created_at').eq('business_id', HL).eq('origin', 'scout').gte('created_at', madeSince).order('created_at', { ascending: false }).limit(3)).data || [];
    leftovers.push(async () => { const mine = await find(); if (!mine.length) return 'test to-do: none left'; const ids = mine.map(t => t.id); const ev = await svc.from('sales_todo_events').delete().in('todo_id', ids).select('id'); const td = await svc.from('sales_week_goals').delete().in('id', ids).select('id'); return `test to-do: ${td.data?.length} to-do + ${ev.data?.length} event rows deleted (they existed only because of this run)`; });
    const card = await post('/api/scout/plan', { scope: HL, text: 'add a task to call MetLife Thursday', rows });
    const c = card.body, f = c?.fields;
    const did = c?.plan_id ? await post('/api/scout/act', { plan_id: c.plan_id }) : null;
    const made = (await find())[0];
    const un = did?.body?.can_undo ? await post('/api/scout/undo', { plan_id: c.plan_id }) : null;
    const gone = (await find())[0];
    const dow = new Date(`${f?.due}T12:00:00Z`).getUTCDay();
    ok(`add task: card Task "${f?.task}" · Linked to ${f?.linked_to ? `${f.linked_to} (${f.linked_detail})` : 'no record'} · Owner ${f?.owner} · Due ${f?.due} (a Thursday after today: ${dow === 4 && f?.due > today}) · note "${f?.due_note}" · act "${did?.body?.line}" -> a to-do exists: "${made?.text}" origin ${made?.origin} due ${made?.due_date} status ${made?.status}${made?.link_id ? ` linked (${made.link_type})` : ' not linked'} · Undo "${un?.body?.line}" -> status ${gone?.status}`,
      card.status === 200 && c.verb === 'add_task' && f.task === 'Call MetLife' && dow === 4 && f.due > today && did?.body?.done === 1 && made?.origin === 'scout' && made.text === 'Call MetLife' && made.status === 'open' && made.due_date === f.due && made.owner_user_id === owner.userId && un?.body?.line === 'undone' && gone?.status === 'dropped');
  }

  // ---- 5. the reads of the two asks the cap does not cover (in process, 0 Claude)
  const { ensureRegistry } = await import('../../api/scout/registry.js');
  const registry = await ensureRegistry([path.join(ROOT, 'api/sales/scoutEntities.js')]);
  const { buildContext } = await import('../../api/scout/retrieve.js');
  const { sectioned } = await import('../../api/scout/ask.js');
  const auth = { user: { id: owner.userId, name: 'Jack' }, isPlatformOwner: true, roles: new Map([[HL, 'owner']]) };
  const cy = await buildContext(svc, registry, { auth, scope: HL, q: "Cyrus's top 5", now: Date.now() });
  ok(`"Cyrus's top 5" (the real read, no model call): intents "${cy.stats.intent}" · ${cy.stats.reads.length} read (${cy.stats.reads.join(' | ').slice(0, 160)}) · ${cy.items.size} companies · member read as ${cy.ask.member?.name} · company candidates ${JSON.stringify(cy.ask.company)}`,
    cy.stats.intent === 'top_targets' && cy.stats.reads.length === 1 && /^goals\/top-targets/.test(cy.stats.reads[0]) && !cy.stats.reads.some(r => /brief|scores/.test(r)) && cy.ask.member?.name === 'Cyrus' && cy.ask.company.length === 0 && cy.items.size <= 5 && !UUID.test(cy.stats.reads.join(' ')));
  const BRIEF_Q = 'pull the intel on Northrop Grumman';
  const br = await buildContext(svc, registry, { auth, scope: HL, q: BRIEF_Q, now: Date.now() });
  const grid = br.parts[0].brief?.grid || [];
  ok(`Northrop brief (the real read, no model call): intent "${br.stats.intent}" · grid ${grid.map(g => `${g.label}: ${g.value === '—' ? '—' : `${g.value.length} chars`}`).join(' · ')} · read "${br.parts[0].read}"`,
    br.parts[0].brief?.entity && grid.map(g => g.label).join() === 'Record,Visits,Last touch,Notes,People' && grid[0].value !== '—' && !UUID.test(br.parts[0].read) && !ADDRESS.test(JSON.stringify(grid)));
  const STAND_IN = 'This check did not ask the model for prose (the Claude cap covers the ask, the draft and the regenerate): the grid above and the row below are the real read.';
  const firstLabel = [...br.items.keys()][0];
  const briefBody = { ...sectioned(`${STAND_IN} [${firstLabel}]`, br), usage: null, withheld: false, ask: {}, context_stats: br.stats, scope: HL, cap: A.cap };

  // ---- 6. the screens, from the real replies (the browser's ask / draft calls are answered from this run's replies: 0 Claude)
  browser = await chromium.launch();
  const drafts = [d1.body, ledger.calls.regenerate?.body || d1.body];
  const blocked = [], claudeFromBrowser = [];
  async function openScout(width, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    let nDraft = 0;
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return route.continue();
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) claudeFromBrowser.push(u.host);
      if (isLocal && req.method() === 'POST' && u.pathname === '/api/scout/ask') { const b = JSON.parse(req.postData() || '{}'); const body = b.q === ASK ? A : b.q === BRIEF_Q ? briefBody : null; if (!body) { blocked.push(`ask "${b.q}"`); return route.abort(); } return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); }
      if (isLocal && req.method() === 'POST' && u.pathname === '/api/scout/plan') { const b = JSON.parse(req.postData() || '{}'); if (/^write an email/.test(b.text || '')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(drafts[Math.min(nDraft++, 1)]) }); return route.continue(); }
      if (isLocal && req.method() === 'POST' && u.pathname === '/api/scout/pack') return route.continue();
      const write = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (write) { blocked.push(`${req.method()} ${u.pathname.replace(HL, ':b')}`); return route.abort(); }
      if (viewer && isLocal && u.pathname === '/api/me') { const r = await route.fetch(); const j = await r.json(); j.profile = { ...j.profile, is_platform_owner: false }; j.memberships = (j.memberships || []).map(m => (m.business_id === HL ? { ...m, role: 'viewer' } : m)); return route.fulfill({ response: r, json: j }); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?tab=dashboard&view=overview`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(2500);
    if (compact) { await page.getByRole('button', { name: 'Search or ask Scout' }).first().click(); await page.waitForTimeout(400); }
    const input = page.getByRole('combobox', { name: 'Search or ask Scout' }).first();
    const say = async text => { await input.click(); await input.fill(text); await page.waitForTimeout(300); await input.press('Enter'); };
    return { ctx, page, errors, say };
  }
  const n2 = page => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  const axe = async (page, key) => { await page.addScriptTag({ content: AXE }); const v = await page.evaluate(async () => { const el = document.querySelector('[data-scout-pop], [data-scout-sheet]'); const r = await window.axe.run(el || document, { resultTypes: ['violations'] }); return r.violations.map(x => ({ id: x.id, nodes: x.nodes.length, t: x.nodes.slice(0, 2).map(n => n.target.join(' ')) })); }); ok(`axe ${key}: ${v.length} violations`, v.length === 0, JSON.stringify(v)); };
  const shot = (page, name) => page.screenshot({ path: `${OUT}/live-${name}.png`, animations: 'disabled' });
  {
    const { ctx, page, errors, say } = await openScout(1440);
    await say(ASK); await page.locator('[data-scout-section="2"]').waitFor(); await page.waitForTimeout(600);
    const pill = await page.locator('[data-scout-section="1"] [data-scout-count]').textContent();
    const foot = await page.locator('[data-scout-footer]').textContent();
    await shot(page, 'answer-1440'); await axe(page, 'answer@1440');
    ok(`screen 1440: the pill reads "${pill}" = the reply's; the footer holds no id; N2 ${await n2(page)} px`, pill === (s1.fill?.text || pill) && !UUID.test(foot) && !/prospect:|person:/.test(foot) && (await n2(page)) === 0);
    if (second?.entity === 'people' && D) {
      await say('write an email to the second one'); await page.locator('[data-scout-draft]').waitFor(); await page.waitForTimeout(400);
      const to = await page.locator('[data-scout-draft-to]').textContent(), cost = await page.locator('[data-scout-draft-cost]').textContent();
      await page.locator('[data-scout-draft]').scrollIntoViewIfNeeded(); await shot(page, 'draft-1440'); await axe(page, 'draft@1440');
      await page.locator('[data-scout-draft-again]').click(); await page.waitForTimeout(900);
      const cost2 = await page.locator('[data-scout-draft-cost]').textContent();
      await shot(page, 'draft-regenerated-1440');
      ok(`screen draft: "${to.replace(second.title, 'To <the second person>').replace(/^To To/, 'To')}" · cost line "${cost}" -> after Regenerate "${cost2}" · Copy · Open in Write email · Regenerate present; nothing sent`, to.includes(second.title) && /\$0\.\d+/.test(cost) && cost2 !== cost && (await page.locator('[data-scout-draft-copy], [data-scout-draft-open], [data-scout-draft-again]').count()) >= 2);
    }
    // the task card as the screen draws it (a real /plan: no write until Confirm; cancelled with Escape)
    await say('add a task to call MetLife Thursday'); await page.locator('[data-scout-taskcard]').waitFor(); await page.waitForTimeout(300);
    const fields = await page.locator('[data-scout-taskcard] dt').allTextContents();
    await page.locator('[data-scout-taskcard]').scrollIntoViewIfNeeded(); await shot(page, 'taskcard-1440'); await axe(page, 'taskcard@1440');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await say('snooze the first task until next week'); await page.locator('[data-scout-card="snooze"]').waitFor(); await page.waitForTimeout(300);
    const title = await page.locator('[data-scout-card="snooze"]').getAttribute('aria-label');
    await page.locator('[data-scout-card="snooze"]').scrollIntoViewIfNeeded(); await shot(page, 'snoozecard-1440');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    ok(`screen cards: the task card's fields ${fields.join(' · ')}; the snooze card "${title}"; both cancelled with Escape (no act from the browser: ${blocked.filter(b => /act|undo/.test(b)).length} blocked)`, fields.join() === 'Task,Linked to,Owner,Due' && /^Snooze 1 task until /.test(title));
    // the brief: grid + Copy for Claude (the real pack route, 0 Claude)
    await say(BRIEF_Q); await page.locator('[data-scout-brief-grid]').waitFor(); await page.waitForTimeout(500);
    const labels = await page.locator('[data-scout-brief-grid] dt').allTextContents();
    await shot(page, 'brief-1440'); await axe(page, 'brief@1440');
    await page.locator('[data-scout-copy]').click(); await page.locator('[data-scout-note="copied"]').waitFor({ timeout: 15000 }).catch(() => {});
    const copied = await page.locator('[data-scout-actblock]').textContent().catch(() => '');
    ok(`screen brief: grid ${labels.join(' · ')} above the prose; Copy for Claude -> "${copied}"; page errors ${errors.length}; N2 ${await n2(page)} px`, labels.join() === 'Record,Visits,Last touch,Notes,People' && /^✓ Copied · 1 record · [\d,]+ chars$/.test(copied) && errors.length === 0 && (await n2(page)) === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, errors, say } = await openScout(390);
    await say(ASK); await page.locator('[data-scout-cards]').first().waitFor(); await page.waitForTimeout(600);
    await shot(page, 'answer-390'); await axe(page, 'answer@390');
    ok(`screen 390: cards, no table (${await page.locator('[data-scout-sheet] table, [data-scout-pop] table').count()}); N2 ${await n2(page)} px; page errors ${errors.length}`, (await n2(page)) === 0 && errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, say } = await openScout(1440, { viewer: true });
    await say(ASK); await page.locator('[data-scout-section="2"]').waitFor(); await page.waitForTimeout(600);
    const menus = await page.locator('[data-scout-answer] button[aria-label^="Actions for"]').count(), note = await page.locator('[data-scout-viewer]').count();
    await shot(page, 'viewer-1440');
    ok(`Viewer (the screen with a viewer membership; the server's 403 on /plan is the unit test's): ${menus} row menus, the read-only line shown: ${note === 1}`, menus === 0 && note === 1);
    await ctx.close();
  }
  ok(`Claude: ${claudeThisRun} this run, ${ledger.spent} of cap ${CLAUDE_CAP} in all; the browser reached a model or Apollo host ${claudeFromBrowser.length} times; writes blocked in the browser: ${blocked.length}${blocked.length ? ` (${[...new Set(blocked)].slice(0, 5).join(', ')})` : ''}`, ledger.spent <= CLAUDE_CAP && claudeFromBrowser.length === 0);
} catch (e) {
  results.errors.push(e.message); log('ERROR', e.stack?.split('\n').slice(0, 4).join(' | '));
} finally {
  await cleanup();
  let line;
  try {
    const after = await snapshot();
    const moved = TABLES.filter(t => after[t] !== before[t]);
    const expected = moved.every(t => t === 'sales_todo_events' && after[t] - before[t] <= 2);
    line = !moved.length ? `yes (${TABLES.length} table counts identical)` : expected ? `yes - sales_todo_events ${before.sales_todo_events} -> ${after.sales_todo_events}: the snooze + undo events on the real to-do are kept (history); that to-do's fields and updated_at are back exactly; the test to-do and its events are deleted; every other count identical` : `NO - counts moved on ${moved.map(t => `${t} ${before[t]} -> ${after[t]}`).join(', ')}; check who wrote them`;
  } catch (e) { line = `NO - ${e.message}`; }
  const passed = results.checks.filter(c => c.pass).length;
  console.log(`\n${passed}/${results.checks.length} checks passed${results.errors.length ? ` · errors: ${results.errors.join(' | ')}` : ''}`);
  console.log(`Claude: ${claudeThisRun} this run, ${ledger.spent} of cap ${CLAUDE_CAP} in all · Apollo: 0`);
  console.log(`restored: ${line}`);
  process.exit(results.errors.length || passed !== results.checks.length ? 1 : 0);
}
