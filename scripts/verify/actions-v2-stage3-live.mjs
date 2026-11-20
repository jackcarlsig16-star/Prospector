// actions-v2 Stage 3 live check - localhost against the build, as Jack (ownerSession) on the REAL HomeLover workspace.
// DECLARED before it runs:
//   Claude  cap 5 HARD, cached in .screenshots/actions-v2/live-ledger.json (a re-run answers from the cache, 0 Claude; a
//           sixth call throws before it is made): 1 Draft email on one row · 2 Try again · 3 Prep call · 4 Next steps ·
//           5 Scout "what should I do next on #n" (the plan opens the panel - no call - and the panel's call is the fifth).
//   Apollo  0 (the server runs with the Apollo key empty).
//   Writes  through the real routes (/api/scout/plan -> /act -> /undo), each undone and then restored:
//           (1) "Done and mark contacted" on Jack's one to-do with a person: the to-do done + the person contacted ->
//               Undo; the to-do's and the person's rows are put back exactly (values + timestamps); the to-do's 2 event
//               rows are KEPT and listed.
//           (2) the drawer's "Add n to-dos" for the owed replies -> Undo (dropped) -> the test to-dos and their event
//               rows are deleted (they exist only because of this run).
//           (3) bulk date on 3 undated to-dos -> Undo; their updated_at put back exactly; their event rows KEPT.
//           The drafts write nothing but their usage rows (kept: the cost record). Nothing is sent.
//   Reads   ~14 route calls, 5 page loads (1440 x2 incl. a Viewer, 390 x1; the browser's work calls are answered from
//           this run's replies, every other browser write is refused). ~150 s, cap 235 s.
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
const { hasPii } = await import('../../api/sales/scrubText.js');
const OUT = path.join(ROOT, '.screenshots', 'actions-v2', 'stage3-live');
const PORT = 3995, BASE = `http://localhost:${PORT}`;
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
const CLAUDE_CAP = 5;
// --screens-only: a re-run for the screens alone - the calls come from the ledger and the three writes are NOT repeated
// (each run of them leaves event rows on real to-dos).
const SCREENS_ONLY = process.argv.includes('--screens-only');
const LEDGER = path.join(ROOT, '.screenshots', 'actions-v2', 'live-ledger.json');
fs.mkdirSync(OUT, { recursive: true });
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { spent: 0, calls: {} };
const saveLedger = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
let srv, browser, owner, claudeThisRun = 0;
const results = { checks: [], errors: [] }, leftovers = [];
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 500)}` : ''); };
async function teardown() {
  for (const undo of leftovers.splice(0).reverse()) { try { log(await undo()); } catch (e) { log(`RESTORE FAILED: ${e.message}`); results.errors.push(`restore: ${e.message}`); } }
  if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 235000 });
const before = await snapshot();
log('before', JSON.stringify(before), `· Claude spent so far ${ledger.spent}/${CLAUDE_CAP}`);
const ADDRESS = /[^\s"<>]+@[^\s"<>]+\.[a-z]{2,}/i;
const VERBS = ['draft_reply', 'prep_call', 'draft_email', 'find_people', 'next_steps'];

try {
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const call = async (method, p, body) => { const r = await fetch(`${BASE}${p}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const get = p => call('GET', p), post = (p, body) => call('POST', p, body);
  const paid = async (key, p, body) => {
    if (ledger.calls[key]) return { ...ledger.calls[key], cached: true };
    if (ledger.spent >= CLAUDE_CAP) throw new Error(`STOP: the Claude cap (${CLAUDE_CAP}) is spent and "${key}" is not cached - a sixth call needs Jack's ok`);
    ledger.spent += 1; claudeThisRun += 1; saveLedger();
    const t = Date.now(), r = await post(p, body);
    ledger.calls[key] = { status: r.status, body: r.body, elapsed: Math.round((Date.now() - t) / 100) / 10, at: new Date().toISOString() }; saveLedger();
    return ledger.calls[key];
  };
  const startIso = new Date(T0 - 5000).toISOString();
  const workPath = key => `/api/sales/${HL}/goals/today/${encodeURIComponent(key)}/work`;

  // ---- 1. the list vs the database (groups, counts, verbs, numbering)
  const mine = (await get(`/api/sales/${HL}/goals/today?owner=me`)).body, team = (await get(`/api/sales/${HL}/goals/today`)).body;
  const rows = mine.groups.flatMap(g => g.rows), teamRows = team.groups.flatMap(g => g.rows);
  const raw = (await svc.from('sales_week_goals').select('id, due_date, owner_user_id, snooze_until, prospect_contact_id, person_key', { count: 'exact' }).eq('business_id', HL).eq('kind', 'todo').eq('status', 'open').limit(2000)).data || [];
  const listed = raw.filter(t => !(t.snooze_until && t.snooze_until > today));
  const apiTodos = teamRows.filter(r => r.kind === 'todo');
  ok(`list vs raw: open to-dos on the list ${apiTodos.length} (API open_todos ${team.counts.open_todos}) vs ${listed.length} open, unsnoozed to-do rows in the table${raw.length - listed.length ? ` (+${raw.length - listed.length} snoozed, API says ${team.counts.snoozed})` : ''}; every listed id is an open row: ${apiTodos.every(r => raw.some(t => t.id === r.id))}`,
    apiTodos.every(r => raw.some(t => t.id === r.id)) && team.counts.open_todos === apiTodos.length && Math.abs(listed.length - apiTodos.length) <= listed.filter(t => t.prospect_contact_id).length, `flag rows (prospect_contact_id) in the table: ${listed.filter(t => t.prospect_contact_id).length}`);
  const rawOverdueMine = listed.filter(t => t.owner_user_id === owner.userId && t.due_date && t.due_date < today && apiTodos.some(r => r.id === t.id)).length;
  const rawUndatedMine = listed.filter(t => t.owner_user_id === owner.userId && !t.due_date && apiTodos.some(r => r.id === t.id)).length;
  ok(`counts vs raw (mine): overdue ${mine.counts.overdue} vs ${rawOverdueMine} · undated ${mine.counts.undated} vs ${rawUndatedMine} · groups ${mine.groups.map(g => `${g.id} ${g.n}`).join(' · ')} = shown ${mine.counts.shown}`,
    mine.counts.overdue === rawOverdueMine && mine.counts.undated === rawUndatedMine && mine.groups.reduce((n, g) => n + g.n, 0) === mine.counts.shown);
  const shownRows = rows.filter(r => !r.folded);
  ok(`verbs: every row has one of the five (${Object.entries(mine.verbs).map(([k, v]) => `${v} ${k}`).join(' · ')}); P3 numbering: the ${shownRows.length} rows shown read 1…n, the ${rows.length - shownRows.length} folded rows follow group 1's shown rows when the fold opens`,
    rows.every(r => VERBS.includes(r.verb)) && shownRows.every((r, i) => r.rank === i + 1) && rows.every((r, i) => r.rank_open === i + 1) && rows.filter(r => r.folded).every(r => r.rank == null && r.group === 'due'));
  ok(`R2 / R3 flag: the data-keys migration has NOT run -> five.can_add ${mine.five.can_add} (the menu hides "Add to this week's five"; reply to-dos are written with origin scout)`, mine.five.can_add === false);
  ok('the list holds no address', !ADDRESS.test(JSON.stringify(team)));

  // ---- 2. the five Claude calls (cap 5 HARD)
  const personRow = rows.find(r => r.kind === 'todo' && r.person && r.company?.id);
  const prepRow = rows.find(r => r.kind === 'todo' && r.verb === 'prep_call' && r.company?.id && r.key !== personRow?.key);
  const coRows = rows.filter(r => r.kind === 'todo' && r.company?.id && r.key !== personRow?.key && r.key !== prepRow?.key);
  if (!personRow || !prepRow || coRows.length < 2) throw new Error(`the list has no row for a step: person ${!!personRow} · prep ${!!prepRow} · company rows ${coRows.length}`);
  const describe = w => `HTTP ${w.status} · ${w.body?.grounds?.length ?? 0} grounds (${[...new Set((w.body?.grounds || []).map(g => g.kind))].join(', ') || 'none'}) · ${w.body?.steps?.length ?? 0} steps, each citing a ground whose text is its "based on": ${(w.body?.steps || []).every(s => (w.body.grounds || []).some(g => g.id === s.ground && g.text === s.based_on))} · calls ${w.body?.usage?.calls} · cost $${w.body?.usage?.cost_usd} · Write email ${w.body?.usage?.cap?.used} of ${w.body?.usage?.cap?.max}${w.elapsed ? ` · ${w.elapsed} s` : ''}`;
  const stepsOk = w => (w.body?.steps || []).every(s => (w.body.grounds || []).some(g => g.id === s.ground && g.text === s.based_on));
  const d1 = await paid('draft', workPath(personRow.key), { verb: 'draft_email' });
  const D = d1.body?.draft, first = String(personRow.person.name).split(/\s+/)[0];
  ok(`1 Draft email${d1.cached ? ' (cached, 0 Claude)' : ''} on #${personRow.rank ?? personRow.rank_open}: ${describe(d1)} · To = the row's person with ${D?.to?.title ? 'a title' : 'no title'} at its company: ${D?.to?.name === personRow.person.name && D?.to?.company === personRow.company.name} · ${D?.withheld ? `WITHHELD: ${D.reason}` : `greets them by first name: ${new RegExp(`\\b${first}\\b`).test(D?.body || '')} · subject ${D?.subject?.length} chars · body ${D?.body?.length} chars · lint ${D?.lint ? (D.lint.ok ? 'ok' : `${D.lint.issues} issues`) : 'n/a'}`}`,
    d1.status === 200 && D?.to?.name === personRow.person.name && D?.to?.company === personRow.company.name && (D.withheld || new RegExp(`\\b${first}\\b`).test(D.body)) && stepsOk(d1) && d1.body.usage.calls === 1 && d1.body.usage.cost_usd > 0 && !ADDRESS.test(JSON.stringify(d1.body)));
  const d2 = await paid('try-again', workPath(personRow.key), { verb: 'draft_email' });
  ok(`2 Try again${d2.cached ? ' (cached, 0 Claude)' : ''}: ${describe(d2)} · a new draft: ${d2.body?.draft?.body !== D?.body} · the cap moved on: ${(d2.body?.usage?.cap?.used ?? 0) > (d1.body?.usage?.cap?.used ?? 0)}`,
    d2.status === 200 && d2.body?.draft && d2.body.usage.calls === 1 && (d2.body.usage.cap?.used ?? 0) > (d1.body.usage.cap?.used ?? 0) && !ADDRESS.test(JSON.stringify(d2.body)));
  const p3 = await paid('prep-call', workPath(prepRow.key), { verb: 'prep_call' });
  ok(`3 Prep call${p3.cached ? ' (cached, 0 Claude)' : ''} on #${prepRow.rank ?? prepRow.rank_open}: ${describe(p3)} · brief ${p3.body?.brief?.withheld ? `WITHHELD: ${p3.body.brief.reason}` : `${p3.body?.brief?.text?.length} chars`} · no draft: ${p3.body?.draft === undefined}`,
    p3.status === 200 && p3.body?.brief && (p3.body.brief.withheld || p3.body.brief.text.length > 80) && p3.body.draft === undefined && stepsOk(p3) && p3.body.usage.calls === 1 && !ADDRESS.test(JSON.stringify(p3.body)));
  const n4 = await paid('next-steps', workPath(coRows[0].key), { verb: 'next_steps' });
  ok(`4 Next steps${n4.cached ? ' (cached, 0 Claude)' : ''} on #${coRows[0].rank ?? coRows[0].rank_open}: ${describe(n4)} · no draft, no brief: ${n4.body?.draft === undefined && n4.body?.brief === undefined}${n4.body?.note ? ` · note "${n4.body.note}"` : ''}`,
    n4.status === 200 && n4.body?.draft === undefined && n4.body?.brief === undefined && stepsOk(n4) && !ADDRESS.test(JSON.stringify(n4.body)));
  // 5: Scout's plan opens the panel (no call); the panel's own call is the fifth
  const scoutRow = coRows[1], listRows = [scoutRow, coRows[0]].map(r => ({ entity: 'todos', id: r.id, title: r.text }));
  const sp = await post('/api/scout/plan', { scope: HL, text: 'what should I do next on #1', rows: listRows });
  const o = sp.body?.open;
  ok(`5a Scout "what should I do next on #1": HTTP ${sp.status} · opens the work panel (${o?.panel}) on that to-do: ${o?.key === scoutRow.key} · verb ${o?.verb} · no card, no draft, no call: ${!sp.body?.plan_id && !sp.body?.draft}`, sp.status === 200 && o?.panel === 'today_work' && o.key === scoutRow.key && o.verb === 'next_steps' && !sp.body.plan_id && !sp.body.draft);
  const s5 = await paid('scout-next', workPath(o?.key || scoutRow.key), { verb: o?.verb || 'next_steps' });
  ok(`5b the panel's call${s5.cached ? ' (cached, 0 Claude)' : ''}: ${describe(s5)}${s5.body?.note ? ` · note "${s5.body.note}"` : ''}`, s5.status === 200 && stepsOk(s5) && !ADDRESS.test(JSON.stringify(s5.body)));
  // the work route's calls are Write-email calls (intent_compose); any other call type in the window is not this run's
  const usageAll = (await svc.from('business_anthropic_usage').select('cost_usd, model, call_type, created_at').eq('user_id', owner.userId).gte('created_at', startIso).order('created_at')).data || [];
  const usage = usageAll.filter(u => u.call_type === 'intent_compose'), other = usageAll.filter(u => u.call_type !== 'intent_compose');
  const shownCosts = [d1, d2, p3, n4, s5].filter(w => !w.cached && w.body?.usage?.calls).map(w => w.body.usage.cost_usd);
  ok(`cost from the usage row: ${claudeThisRun ? `${usage.length} usage rows this run (${usage.map(u => `$${Number(u.cost_usd).toFixed(4)} ${u.call_type}`).join(', ')}) vs the costs shown (${shownCosts.map(c => `$${c}`).join(', ')})${other.length ? ` · ALSO in the window, not written by any path of this run: ${other.map(u => `${u.call_type} $${Number(u.cost_usd).toFixed(4)} at ${u.created_at.slice(11, 19)}Z`).join(', ')}` : ''}` : 'cached run - no new usage rows'} · Claude this run ${claudeThisRun}, total ${ledger.spent} of ${CLAUDE_CAP}`,
    ledger.spent <= CLAUDE_CAP && (!claudeThisRun || (usage.length === shownCosts.length && shownCosts.every(c => usage.some(u => Math.abs(Number(u.cost_usd) - c) < 0.00006)))));
  // the Copy prompt: its real length and the hasPii result, per ask chip
  const pack = d1.body?.prompt_pack;
  ok(`Copy prompt: ${pack?.asks?.map(a => (a.blocked ? `${a.label}: BLOCKED` : `${a.label}: ${a.chars} chars (text ${a.text.length}) · hasPii ${hasPii(a.text)}`)).join(' | ')}`, pack?.asks?.length === 3 && pack.asks.every(a => a.blocked || (a.chars === a.text.length && !hasPii(a.text) && !ADDRESS.test(a.text))));

  // ---- 3. writes, each undone and restored
  const sendsBefore = await count('sales_team_email_sends');
  if (!SCREENS_ONLY) {
  { // (1) Done and mark contacted -> Undo
    const todoCols = 'id, status, completed_at, updated_at, due_date, owner_user_id, person_key';
    const readTodo = async () => (await svc.from('sales_week_goals').select(todoCols).eq('id', personRow.id).single()).data;
    const wasTodo = await readTodo(), contactId = String(wasTodo.person_key).replace(/^prospect:/, '');
    const readPerson = async () => (await svc.from('sales_prospect_state').select('*').eq('business_id', HL).eq('contact_id', contactId).single()).data;
    const wasPerson = await readPerson();
    leftovers.push(async () => {
      const t = await readTodo(), p = await readPerson(), out = [];
      if (JSON.stringify(t) !== JSON.stringify(wasTodo)) { const { id, ...rest } = wasTodo; const r = await svc.from('sales_week_goals').update(rest).eq('id', id).select('id'); out.push(`finished to-do: put back exactly (${r.data?.length} row)`); } else out.push('finished to-do: already as it was');
      if (JSON.stringify(p) !== JSON.stringify(wasPerson)) { const { business_id, contact_id, ...rest } = wasPerson; const r = await svc.from('sales_prospect_state').update(rest).eq('business_id', business_id).eq('contact_id', contact_id).select('contact_id'); out.push(`its person: put back exactly (${r.data?.length} row)`); } else out.push('its person: already as they were');
      return out.join(' · ');
    });
    const stageOf = async () => (personRow.company.type === 'employer' ? (await svc.from('sales_opportunities').select('stage, updated_at').eq('id', personRow.company.id).single()).data : null);
    const stageBefore = await stageOf();
    const card = await post('/api/scout/plan', { scope: HL, verb: 'task_finish', rows: [{ entity: 'todos', id: personRow.id, title: personRow.text }], keys: [`todos:${personRow.id}`], args: {}, text: '' });
    const c = card.body, did = c?.plan_id ? await post('/api/scout/act', { plan_id: c.plan_id }) : null;
    const midTodo = await readTodo(), midPerson = await readPerson(), stageMid = await stageOf();
    const un = did?.body?.can_undo ? await post('/api/scout/undo', { plan_id: c.plan_id }) : null;
    const endTodo = await readTodo(), endPerson = await readPerson();
    const evs = (await svc.from('sales_todo_events').select('kind, origin, batch_id').eq('business_id', HL).eq('todo_id', personRow.id).gte('at', startIso).order('at')).data || [];
    ok(`Done and mark contacted: card "${c?.verb}" 1 row ${c?.rows?.[0]?.from} -> "${String(c?.rows?.[0]?.to).replace(personRow.person.name, '<person>')}" (${c?.rows?.[0]?.note}) · act "${did?.body?.line}" -> to-do ${wasTodo.status} -> ${midTodo.status}, person ${wasPerson.status} -> ${midPerson.status}, the company's stage unchanged: ${JSON.stringify(stageBefore) === JSON.stringify(stageMid)} · ONE Undo "${un?.body?.line}" -> to-do ${endTodo.status}, person ${endPerson.status} · to-do events ${evs.map(e => `${e.kind} (${e.origin}, the card's batch: ${e.batch_id === c?.plan_id})`).join(', ')} (kept)`,
      card.status === 200 && c.verb === 'task_finish' && c.rows.length === 1 && did?.body?.done === 1 && midTodo.status === 'done' && midPerson.status === 'contacted' && JSON.stringify(stageBefore) === JSON.stringify(stageMid) && un?.body?.line === 'undone' && endTodo.status === wasTodo.status && endPerson.status === wasPerson.status && evs.map(e => e.kind).join() === 'done,undo');
  }
  { // (2) the drawer's fix: Add n to-dos for the owed replies -> Undo
    const fixes = (await get(`/api/sales/${HL}/goals/today/fixes`)).body;
    const fix = fixes.items.find(i => i.id === 'replies');
    ok(`Needs attention: ${fixes.n} fixes, worst first (${fixes.items.map(i => i.id).join(' · ')}), never more than five; Data feeds: ${fixes.feeds.map(f => `${f.label} ${f.status}`).join(' · ')}`, fixes.n <= 5 && fixes.items.length === fixes.n && ['apollo', 'visitors', 'call_notes'].every(id => fixes.feeds.some(f => f.id === id)) && !ADDRESS.test(JSON.stringify(fixes)));
    if (!fix?.action) ok('drawer fix: no reply is owed today, so there is no "Add n to-dos" to run', false);
    else {
      const madeSince = new Date().toISOString();
      const find = async () => (await svc.from('sales_week_goals').select('id, text, status, origin, person_key, due_date').eq('business_id', HL).eq('kind', 'todo').in('origin', ['scout', 'reply']).gte('created_at', madeSince)).data || [];
      leftovers.push(async () => { const made = await find(); if (!made.length) return 'reply to-dos: none left'; const ids = made.map(t => t.id); const ev = await svc.from('sales_todo_events').delete().in('todo_id', ids).select('id'); const td = await svc.from('sales_week_goals').delete().in('id', ids).select('id'); return `reply to-dos: ${td.data?.length} to-do + ${ev.data?.length} event rows deleted (they existed only because of this run)`; });
      const card = await post('/api/scout/plan', { scope: HL, verb: fix.action.verb, rows: fix.action.rows, keys: fix.action.rows.map(r => `${r.entity}:${r.id}`), args: {}, text: '' });
      const c = card.body, will = c?.summary?.will ?? 0, did = c?.plan_id ? await post('/api/scout/act', { plan_id: c.plan_id }) : null;
      const made = await find();
      const un = did?.body?.can_undo ? await post('/api/scout/undo', { plan_id: c.plan_id }) : null;
      const after = await find();
      ok(`drawer fix "${fix.action.label}": the card lists ${c?.rows?.length} rows (${will} to add, ${c?.summary?.skipped} skipped) · act "${did?.body?.line}" -> ${made.length} to-dos exist, origin ${[...new Set(made.map(t => t.origin))].join('/')}, each with a person key and due today: ${made.every(t => t.person_key && t.due_date === today && t.status === 'open')} · ONE Undo "${un?.body?.line}" -> ${after.filter(t => t.status === 'dropped').length} dropped`,
        card.status === 200 && c.verb === 'reply_todos' && will > 0 && did?.body?.done === will && made.length === will && made.every(t => t.origin === 'scout' && t.person_key && t.status === 'open') && un?.body?.line === 'undone' && after.every(t => t.status === 'dropped'));
    }
  }
  { // (3) bulk date on 3 undated -> Undo
    const three = rows.filter(r => r.kind === 'todo' && !r.due && r.group === 'rest').slice(0, 3), ids = three.map(r => r.id);
    const read = async () => (await svc.from('sales_week_goals').select('id, due_date, week_start, updated_at').in('id', ids).order('id')).data;
    const was = await read(), date = new Date(Date.parse(`${today}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
    leftovers.push(async () => { const cur = await read(); let n = 0; for (const w of was) { const c = cur.find(x => x.id === w.id); if (JSON.stringify(c) !== JSON.stringify(w)) { const { id, ...rest } = w; await svc.from('sales_week_goals').update(rest).eq('id', id); n++; } } return n ? `dated to-dos: ${n} put back exactly (due date, week, updated_at)` : 'dated to-dos: already as they were'; });
    const card = await post('/api/scout/plan', { scope: HL, verb: 'task_due', rows: three.map(r => ({ entity: 'todos', id: r.id, title: r.text })), keys: ids.map(i => `todos:${i}`), args: { date }, text: '' });
    const c = card.body, did = c?.plan_id ? await post('/api/scout/act', { plan_id: c.plan_id }) : null;
    const mid = await read();
    const un = did?.body?.can_undo ? await post('/api/scout/undo', { plan_id: c.plan_id }) : null;
    const end = await read();
    const evs = (await svc.from('sales_todo_events').select('kind, batch_id').eq('business_id', HL).in('todo_id', ids).gte('at', startIso)).data || [];
    ok(`bulk date on 3 undated: the card lists ${c?.rows?.length} rows, each "no date" -> "due ${date}": ${c?.rows?.every(r => r.from === 'no date' && r.to === `due ${date}`)} · act "${did?.body?.line}" -> ${mid.filter(t => t.due_date === date).length} dated · ONE Undo "${un?.body?.line}" -> ${end.filter(t => !t.due_date).length} undated again · events ${evs.length} (3 due + 3 undo, one batch: ${new Set(evs.filter(e => e.kind === 'due').map(e => e.batch_id)).size === 1}) kept`,
      card.status === 200 && c.verb === 'task_due' && c.rows.length === 3 && did?.body?.done === 3 && mid.every(t => t.due_date === date) && un?.body?.line === 'undone' && end.every(t => !t.due_date) && evs.length === 6);
  }
  } else log('--screens-only: the three writes are not repeated');
  ok(`nothing sent: sales_team_email_sends ${sendsBefore} -> ${await count('sales_team_email_sends')}`, (await count('sales_team_email_sends')) === sendsBefore);

  // ---- 4. the screens, on the real list (the browser's work calls are answered from this run's replies: 0 Claude)
  browser = await chromium.launch();
  const blocked = [], outside = [];
  const replyFor = key => (key === personRow.key ? d1.body : key === prepRow.key ? p3.body : key === coRows[0].key ? n4.body : key === scoutRow.key ? s5.body : null);
  async function openToday(width, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return route.continue();
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (/anthropic\.com$|apollo\.io$/.test(u.host)) outside.push(u.host);
      const m = isLocal && req.method() === 'POST' && /\/goals\/today\/([^/]+)\/work$/.exec(u.pathname);
      if (m) { const body = replyFor(decodeURIComponent(m[1])); if (!body) { blocked.push(`work ${m[1].slice(0, 12)}`); return route.abort(); } return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); }
      const write = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (write) { blocked.push(`${req.method()} ${u.pathname.replace(HL, ':b')}`); return route.abort(); }
      if (viewer && isLocal && u.pathname === '/api/me') { const r = await route.fetch(); const j = await r.json(); j.profile = { ...j.profile, is_platform_owner: false }; j.memberships = (j.memberships || []).map(x => (x.business_id === HL ? { ...x, role: 'viewer' } : x)); return route.fulfill({ response: r, json: j }); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(25000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?tab=actions`);
    const compact = width < 900;
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.getByLabel('Workspace').waitFor({ timeout: 25000 }); await page.getByLabel('Workspace').selectOption({ label: 'HomeLover' }); await page.waitForTimeout(1500);
    if (compact) { await page.getByRole('button', { name: 'Open menu' }).click(); await page.waitForTimeout(400); }
    await page.locator('#root').getByRole('button', { name: 'Sales & Marketing', exact: true }).dispatchEvent('click'); await page.waitForTimeout(1500);
    if (!(await page.locator('[data-today]').count())) await page.getByRole('button', { name: /^Actions/ }).first().click().catch(() => {});
    await page.waitForSelector('[data-today] [data-today-row]', { timeout: 25000 });
    return { ctx, page, errors };
  }
  const audit = async (page, name, tag) => {
    await page.waitForTimeout(400);
    await page.addScriptTag({ content: AXE });
    // the Today screen and its drawer: the app shell around them is not this spec's
    const v = await page.evaluate(async () => (await window.axe.run({ include: [['[data-today]'], ['#sales-frame-tools'], ...(document.querySelector('[data-attention-drawer]') ? [['[data-attention-drawer]']] : [])] }, { resultTypes: ['violations'] })).violations.map(x => ({ id: x.id, nodes: x.nodes.length, target: x.nodes[0].target.join(' ').slice(0, 80) })));
    const n2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    // the PNGs hold real names: they stay in .screenshots/ (gitignored) and are never committed
    await page.screenshot({ path: path.join(OUT, `${name}-${tag}.png`), fullPage: false });
    ok(`${name} @ ${tag}: axe 0 · N2 0 px`, v.length === 0 && n2 <= 0, v.length || n2 > 0 ? JSON.stringify({ axe: v, n2 }) : '');
  };
  for (const width of [1440, 390]) {
    const tag = String(width), { ctx, page, errors } = await openToday(width);
    await audit(page, 'list', tag);
    const head = await page.locator('#sales-frame-tools').innerText().catch(() => '');
    ok(`P1 header @ ${tag}: "Needs attention n" (or All clear) and "+ To-do" on the real frame row`, /Needs attention\s*\d+|All clear/.test(head) && /\+ To-do/.test(head), head.replace(/\s+/g, ' ').slice(0, 120));
    const nums = await page.$$eval('[data-today-row] .td-rk', els => els.map(e => Number(e.textContent)));
    ok(`P3 @ ${tag}: the ${nums.length} rows on screen read 1…n`, nums.length > 0 && nums.every((n, i) => n === i + 1));
    ok(`D43 @ ${tag}: the list loaded with verb buttons only - no work call`, !blocked.some(b => b.startsWith('work')) && await page.locator('[data-today-verb]').count() > 0 && await page.locator('[data-work]').count() === 0);
    await page.locator(`[data-today-row="${personRow.key}"] [data-today-verb]`).click();
    await page.waitForSelector('[data-work="ready"]');
    await audit(page, 'work-draft', tag);
    const panelText = await page.locator('[data-work]').innerText();
    ok(`work panel @ ${tag}: the real draft To = name · title, company; no address in the panel; the finish button names the person`, new RegExp(`${first}`).test(panelText) && !ADDRESS.test(panelText) && await page.locator('[data-work-finish]').count() === 1 && (await page.locator('[data-work-body]').inputValue()) === D.body);
    if (width === 1440) {
      ok('the prompt count on screen is the pack\'s real length', Number((await page.locator('[data-work-chars]').innerText()).replace(/,/g, '')) === pack.asks[0].text.length);
      await page.keyboard.press('Escape');
      await page.locator(`[data-today-row="${prepRow.key}"] [data-today-verb]`).click(); await page.waitForSelector('[data-work-brief], [data-work-withheld]'); await audit(page, 'work-prep-call', tag);
      await page.locator('[data-work-close]').click();
    } else await page.locator('[data-work-sheet]').getByRole('button', { name: 'Close' }).click();
    await page.locator('[data-attention-button] button').click(); await page.waitForSelector('[data-attention-drawer] [data-today-fixes]'); await page.waitForTimeout(1500);
    await audit(page, 'drawer', tag);
    const box = await page.locator('[data-attention-drawer]').boundingBox();
    ok(`P1 / P2 drawer @ ${tag}: ${width === 1440 ? '440 px over the list' : 'a full-height sheet'}, Data feeds under the fixes with Call-note intake`, (width === 1440 ? box.width === 440 : box.width === 390) && await page.locator('[data-attention-feeds] [data-source="call_notes"]').count() === 1 && await page.locator('[data-today-row]').count() > 0);
    await page.keyboard.press('Escape');
    if (width === 390) {
      const bar = await page.locator('.td-bar').evaluate(el => { el.scrollLeft = el.scrollWidth; const last = el.lastElementChild.getBoundingClientRect(), b = el.getBoundingClientRect(); return { scrolls: el.scrollWidth > el.clientWidth, lastRight: Math.round(last.right), boxRight: Math.round(b.right), page: document.documentElement.scrollWidth - window.innerWidth }; });
      ok('P5 @ 390: the chip row scrolls inside its box, the last chip reachable, the page 0 px sideways', bar.scrolls && bar.lastRight <= bar.boxRight && bar.page <= 0, JSON.stringify(bar));
    }
    ok(`no page error @ ${tag}`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  { // Viewer
    const { ctx, page, errors } = await openToday(1440, { viewer: true });
    await audit(page, 'viewer', '1440');
    ok('Viewer: the same list with no Done, no ⋯, no verb, no "+ To-do"', await page.locator('[data-today-done], [data-today-more], [data-today-verb]').count() === 0 && await page.locator('[data-today-row]').count() > 0 && !/\+ To-do/.test(await page.locator('#sales-frame-tools').innerText()) && errors.length === 0, errors.join(' | '));
    const refused = await fetch(`${BASE}${workPath(personRow.key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    ok(`the work route refuses a caller with no session: HTTP ${refused.status}`, refused.status === 401 || refused.status === 403);
    await ctx.close();
  }
  ok(`the browser reached no model or Apollo host (${outside.length}) and wrote nothing (${blocked.length} refused: ${[...new Set(blocked)].join(', ').slice(0, 200) || 'none'})`, outside.length === 0);
} catch (e) { ok('run', false, e.message); results.errors.push(e.message); }

await cleanup();
const after = await snapshot();
const same = t => before[t] === after[t];
const eventDelta = after.sales_todo_events - before.sales_todo_events;
const restored = TABLES.filter(t => t !== 'sales_todo_events').every(same) && !results.errors.some(e => e.startsWith('restore'));
log('after ', JSON.stringify(after));
const failed = results.checks.filter(c => !c.pass);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ checks: results.checks, before, after, claude: { thisRun: claudeThisRun, total: ledger.spent, cap: CLAUDE_CAP } }, null, 1));
console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks · Claude this run ${claudeThisRun} (ledger ${ledger.spent} of ${CLAUDE_CAP}) · Apollo 0 · sent 0 · sales_todo_events +${eventDelta} (the events of the to-dos that already existed: kept by rule) · restored: ${restored ? 'yes' : `NO - ${TABLES.filter(t => !same(t)).map(t => `${t} ${before[t]} -> ${after[t]}`).join(', ')}`}`);
process.exit(failed.length ? 1 : 0);
