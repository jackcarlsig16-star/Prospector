// scout-v3 Stage 3 - live, localhost against the build, as Jack (ownerSession) on the REAL HomeLover workspace.
// DECLARED before it runs:
//   Claude  3 real asks through POST /api/scout/ask (cap 5). Every reply is cached in .screenshots/scout-v3/stage3/
//           ledger.json with a spent counter; a re-run answers from the cache (0 Claude) and the script REFUSES a call
//           that would pass the cap. The phone pass replays ask 1 from the cache.
//   Apollo  0 (the key is removed from the server's environment).
//   Writes  (a) "assign the Cloudflare ones to <member>": the owner of at most 4 Cloudflare records (owner_user_id, and
//           the employer's owner text) + 1 sales_flow_events row each, then Undo within 10 s -> the owner back + 1
//           'undo' event row each. (b) "snooze <partner> until next week": sales_goals.snoozed_until + 1
//           sales_partner_events row, then Undo -> the value back + 1 'undo' row. The event rows stay (they are the
//           history). 3 usage rows (kept). The owner session is released; sign-in rows are kept by rule.
//           Safety net: teardown compares every touched value with its snapshot and puts it back by id if it differs.
//   Not written: the prefilled quick capture is never saved; every other non-GET call is aborted in the browser.
//   Viewer  no user is created: /api/me is rewritten to role viewer in the browser, and the plan reply is the real
//           plan() function run in process with a Viewer's roles against the real workspace (403).
//   ~60 s of asks + ~40 s of UI; cap 235 s.
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
const { hasPii } = await import('../../api/sales/scrubText.js');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const OUT = path.join(ROOT, '.screenshots', 'scout-v3', 'stage3');
const PORT = 3992, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0], SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const CLAUDE_CAP = 5;
// PHONE_ONLY=1: ask 1 (from the cache) at 1440 and the 390 pass only - no act, no write, no Claude.
const FULL = !process.env.PHONE_ONLY;
fs.mkdirSync(OUT, { recursive: true });
const LEDGER = path.join(OUT, 'ledger.json');
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { spent: 0, asks: {} };
const REASK = (process.env.REASK || '').split(',').filter(Boolean);
// REASK='<label>' drops one cached reply so that ask is made again (counted against the cap).
const saveLedger = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const startIso = new Date().toISOString();
const results = { checks: [], asks: [], acts: [], blocked: [], claude_this_run: 0 };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 500)}` : ''); };

// ---- snapshots (names of companies only)
const members = (await svc.from('business_members').select('user_id, name').eq('business_id', HL).not('user_id', 'is', null)).data;
const first = id => (id ? (members.find(m => m.user_id === id)?.name || 'a member').split(' ')[0] : 'Unassigned');
const cyrus = members.find(m => /^cyrus/i.test(m.name || ''));
const TABLES = { employer: ['sales_opportunities', 'organization', 'id, organization, owner_user_id, owner'], target: ['sales_targets', 'name', 'id, name, owner_user_id'], partner: ['sales_goals', 'name', 'id, name, owner_user_id'] };
const cloudflare = async () => { const out = []; for (const [type, [table, col, cols]] of Object.entries(TABLES)) { let q = svc.from(table).select(cols).eq('business_id', HL).ilike(col, 'cloudflare%'); if (type === 'partner') q = q.eq('goal_type', 'partnership'); for (const r of (await q).data || []) out.push({ type, table, id: r.id, name: r[col], owner_user_id: r.owner_user_id || null, owner: r.owner ?? undefined }); } return out; };
const cfBefore = await cloudflare();
const partners = (await svc.from('sales_goals').select('id, name, snoozed_until, pipeline_status').eq('business_id', HL).eq('goal_type', 'partnership').is('archived_at', null).is('snoozed_until', null).order('name')).data || [];
const partner = partners.find(p => /^[A-Z][A-Za-z]+( [A-Z][A-Za-z]+)?$/.test(p.name) && !/^(Cloudflare)/.test(p.name));
if (!partner) throw new Error('no partner to snooze');
const partnerNow = async () => (await svc.from('sales_goals').select('snoozed_until, updated_at').eq('id', partner.id).single()).data;
const counts = async () => ({ todos: (await svc.from('sales_week_goals').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count, usage: (await svc.from('business_anthropic_usage').select('*', { count: 'exact', head: true }).eq('call_type', 'scout_ask')).count, flow: (await svc.from('sales_flow_events').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count, partner_events: (await svc.from('sales_partner_events').select('*', { count: 'exact', head: true }).eq('business_id', HL)).count });
const before = await counts();
log('before', JSON.stringify(before), `· Cloudflare records ${cfBefore.map(r => `${r.type} owner ${first(r.owner_user_id)}`).join(', ') || 'none'} · partner to snooze: ${partner.name} · Claude spent so far ${ledger.spent}/${CLAUDE_CAP}`);

let srv, browser, owner;
async function teardown() {
  if (browser) await browser.close().catch(() => {}); browser = null;
  if (srv) srv.kill(); srv = null;
  const fixes = [];
  for (const b of cfBefore) { const now = (await svc.from(b.table).select(b.type === 'employer' ? 'owner_user_id, owner' : 'owner_user_id').eq('id', b.id).single()).data; if ((now.owner_user_id || null) !== b.owner_user_id || (b.type === 'employer' && (now.owner ?? null) !== (b.owner ?? null))) { await svc.from(b.table).update(b.type === 'employer' ? { owner_user_id: b.owner_user_id, owner: b.owner ?? null } : { owner_user_id: b.owner_user_id }).eq('id', b.id); fixes.push(`${b.type} ${b.name} owner`); } }
  const p = await partnerNow(); if ((p.snoozed_until || null) !== (partner.snoozed_until || null)) { await svc.from('sales_goals').update({ snoozed_until: partner.snoozed_until }).eq('id', partner.id); fixes.push(`${partner.name} snoozed_until`); }
  results.safety_net = fixes;
  log(`safety net: ${fixes.length ? `PUT BACK by id: ${fixes.join(', ')}` : 'nothing to put back (every value already equals its snapshot)'}`);
  if (owner) { log(await owner.release()); owner = null; }
}
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 235000 });

try {
  owner = await ownerSession(svc);
  const { ensureRegistry } = await import('../../api/scout/registry.js');
  const actions = await import('../../api/scout/actions.js');
  const registry = await ensureRegistry([path.join(ROOT, 'api/sales/scoutEntities.js'), path.join(ROOT, 'api/hk/scoutEntities.js')]);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  browser = await chromium.launch();
  const ALLOWED = ['/api/scout/plan', '/api/scout/act', '/api/scout/undo', '/api/scout/pack'];

  async function open(width, height, { viewer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    await ctx.addInitScript(([k, v, bz, dd]) => {
      if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
      for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
      localStorage.setItem('prospector_auto_assay_disabled', '1');
    }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
    await ctx.route('**/*', async route => {
      const req = route.request(); const u = new URL(req.url());
      const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
      if (isLocal && req.method() === 'POST' && u.pathname === '/api/scout/ask') {
        const q = JSON.parse(req.postData() || '{}').q;
        if (ledger.asks[q]) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ledger.asks[q].body) });
        if (ledger.spent >= CLAUDE_CAP) { results.blocked.push('POST /api/scout/ask (would pass the cap)'); return route.abort(); }
        ledger.spent += 1; results.claude_this_run += 1; saveLedger();
        return route.continue();
      }
      if (viewer && isLocal && u.pathname === '/api/me') { const r = await route.fetch(); const j = await r.json(); j.profile = { ...j.profile, is_platform_owner: false }; j.memberships = (j.memberships || []).map(m => (m.business_id === HL ? { ...m, role: 'viewer' } : m)); return route.fulfill({ response: r, json: j }); }
      if (viewer && isLocal && u.pathname === '/api/scout/plan') {
        const r = await actions.plan(svc, registry, { auth: { user: { id: owner.userId }, isPlatformOwner: false, roles: new Map([[HL, 'viewer']]) }, body: JSON.parse(req.postData() || '{}') });
        results.viewer_plan_status = r.status;
        return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
      }
      const apiWrite = isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname) && !ALLOWED.includes(u.pathname);
      const deny = apiWrite || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
      if (deny) { results.blocked.push(`${req.method()} ${u.pathname}`); return route.abort(); }
      return route.continue();
    });
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
    await page.goto(`${BASE}/?business=${HL}`);
    return { ctx, page, errors };
  }
  // a screenshot that stalls (seen twice, on a focused field) is skipped after 8 s and named in the results
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 8000 }).catch(e => { (results.shots_skipped ||= []).push(name); log(`shot ${name} skipped: ${e.message.slice(0, 60)}`); });
  const n2 = page => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));

  // ================= 1440 as Jack
  const { ctx, page, errors } = await open(1440, 1000);
  const bar = page.locator('.scout-bar input').first();
  await bar.waitFor(); await page.waitForTimeout(2500);
  const type = async q => { await bar.click(); await bar.fill(q); await page.waitForTimeout(300); };
  const runAsk = async (label, q) => {
    if (REASK.includes(label) && ledger.asks[q] && !ledger.reasked?.includes(label)) { delete ledger.asks[q]; ledger.reasked = [...(ledger.reasked || []), label]; saveLedger(); }
    const cached = !!ledger.asks[q];
    await type(q);
    const t = Date.now();
    const respP = page.waitForResponse(r => r.url().endsWith('/api/scout/ask') && r.request().method() === 'POST', { timeout: 90000 });
    await page.keyboard.press('Enter');
    const body = await (await respP).json().catch(() => ({}));
    await page.locator('[data-scout-answer], [data-scout-edge]').first().waitFor({ timeout: 15000 });
    const elapsed = cached ? ledger.asks[q].elapsed : Math.round((Date.now() - t) / 100) / 10;
    if (!cached && body.answer_md) {
      const usage = (await svc.from('business_anthropic_usage').select('input_tokens, output_tokens, cost_usd, model').eq('call_type', 'scout_ask').eq('user_id', owner.userId).gte('created_at', startIso).order('created_at', { ascending: false }).limit(1)).data?.[0] || null;
      ledger.asks[q] = { body, usage, elapsed, at: new Date().toISOString() }; saveLedger();
    }
    const usage = ledger.asks[q]?.usage || null;
    const sections = (body.sections || []).map(s => ({ title: s.title, count: s.count, total: s.total, rows: s.rows.length, kinds: [...new Set(s.rows.map(r => r.row?.kind || r.entity))].join('/'), brief: !!s.brief, rule: !!s.rule }));
    const rec = { label, q, cached, parts: body.context_stats?.parts, intent: body.context_stats?.intent, sections, tokens: usage ? `${usage.input_tokens} in / ${usage.output_tokens} out` : null, cost: usage ? Number(usage.cost_usd) : null, model: usage?.model || null, elapsed, at: hasPii(body.answer_md || '') || JSON.stringify(body.sections || []).includes('@') };
    results.asks.push(rec);
    log(`${label}${cached ? ' (from the cache, 0 Claude)' : ''}: parts ${rec.parts} · intents ${rec.intent} · ${sections.map(s => `[${s.title}: ${s.rows} rows ${s.kinds}, count ${s.count} of ${s.total}]`).join(' ')} · ${rec.tokens} · $${rec.cost} · ${elapsed} s`);
    await page.waitForTimeout(500);
    await shot(page, `${label}-1440`);
    return { body, rec };
  };

  // an independent count for ask 1's first part, from the People read itself (the rule: the company on the site in the
  // 7 days to today, or the person identified there; "hot" = the heat band) - what the answer must show is min(5, that).
  const { salesReads } = await import('../../api/sales/scoutIntents.js');
  const pa = await salesReads.peopleActivity(svc, HL, { window: '7' });
  const since7 = new Date(Date.parse(`${today}T12:00:00Z`) - 6 * 864e5).toISOString().slice(0, 10);
  const visiting = pa.body.rows.filter(p => (p.visits && p.visits.visits_7d > 0 && (!p.visits.seen_to || p.visits.seen_to >= since7)) || (p.identified_at && p.identified_at >= since7));
  const real = { people_7d: pa.body.rows.length, visiting: visiting.length, hot_visiting: visiting.filter(p => p.heat_band === 'hot').length, warm_visiting: visiting.filter(p => p.heat_band === 'warm').length, hot_all: (await salesReads.peopleActivity(svc, HL, { window: 'all' })).body.rows.filter(p => p.heat_band === 'hot').length };
  results.real = real;
  const want = Math.min(5, real.hot_visiting);
  log(`independent count: people in the 7-day read ${real.people_7d} · visiting ${real.visiting} · hot AND visiting ${real.hot_visiting} (warm and visiting ${real.warm_visiting}) · hot in all ${real.hot_all}`);
  // ask 1 - the exact Nov 10 ask
  const a1 = await runAsk('ask1', 'pull me 5 most important prospects who are visiting and hot and show 5 most important tasks');
  const s = a1.rec.sections;
  ok(`ask 1: two sections - ① people = min(5, the ${real.hot_visiting} hot people visiting today) = ${want} ② five tasks, no Records block, no "@"`, s.length === 2 && s[0].rows === want && s[0].total === real.hot_visiting && (want === 0 || s[0].kinds === 'person') && s[1].rows === 5 && s[1].kinds === 'task' && !a1.rec.at && !(await page.locator('[data-scout-records]').count()), JSON.stringify(s));
  // the owner names arrive with the members read
  await page.waitForFunction(() => [...document.querySelectorAll('[data-scout-table="task"] tbody tr td:nth-child(3)')].every(td => !/^(You|Another owner)$/.test(td.textContent)), null, { timeout: 8000 }).catch(() => {});
  const ui1 = await page.evaluate(() => ({ sections: document.querySelectorAll('[data-scout-section]').length, people: document.querySelectorAll('[data-scout-table="person"] tbody tr').length, tasks: document.querySelectorAll('[data-scout-table="task"] tbody tr').length, links: document.querySelectorAll('[data-scout-table="person"] .scout-link').length, dots: document.querySelectorAll('[data-scout-table="task"] .scout-owner .scout-dot').length, paths: [...document.querySelectorAll('[data-scout-table="person"] tbody tr td:nth-child(4)')].filter(td => td.textContent.includes('/')).length, owners: [...document.querySelectorAll('[data-scout-table="task"] tbody tr td:nth-child(3)')].map(td => td.textContent), taskHead: [...document.querySelectorAll('[data-scout-table="task"] thead th')].map(th => th.textContent.trim()) }));
  ok(`ask 1 on screen: ${want} person rows + 5 task rows; company names are links; Last visit carries a path; task rows show a Company column and the owner by name`, ui1.sections === 2 && ui1.people === want && ui1.tasks === 5 && (want === 0 || (ui1.links >= 1 && ui1.paths >= 1)) && ui1.taskHead.includes('Company') && ui1.owners.every(o => !/^(You|Another owner)$/.test(o)), JSON.stringify({ ...ui1, owners: ui1.owners.map(o => (/^(Unassigned|You|Another owner)$/.test(o) ? o : 'a name')) }));
  await page.addScriptTag({ content: AXE });
  const axe1 = await page.evaluate(async () => (await window.axe.run(document.querySelector('.scout'), { resultTypes: ['violations'] })).violations.map(v => `${v.id} x${v.nodes.length}`));
  ok('ask 1 @ 1440: axe 0 on Scout · N2 0 px', axe1.length === 0 && (await n2(page)) === 0, axe1.join(', '));

  if (FULL) {
  // ask 2 + the assign command on its rows
  const a2 = await runAsk('ask2', "who are our hottest prospects at Cloudflare and what's due this week");
  ok('ask 2: two parts (people at Cloudflare · what is due); each count pill = the rows shown, with the total matched beside it', a2.rec.sections.length === 2 && a2.rec.sections[0].kinds.includes('person') && a2.rec.sections[0].title === 'People' && a2.rec.sections.every(x => x.count === x.rows && x.total >= x.count), JSON.stringify(a2.rec.sections));
  const act = async (label, command, { read, expectAfter }) => {
    await type(command);
    const planP = page.waitForResponse(r => r.url().endsWith('/api/scout/plan'), { timeout: 20000 });
    await page.keyboard.press('Enter');
    const card = await (await planP).json();
    if (!card.plan_id) { results.acts.push({ label, command, card }); return { card }; }
    await page.locator('[data-scout-card]').waitFor();
    await shot(page, `${label}-card-1440`);
    const b = await read();
    const actP = page.waitForResponse(r => r.url().endsWith('/api/scout/act'), { timeout: 30000 });
    await page.click('[data-scout-confirm]');
    const done = await (await actP).json();
    await page.locator('[data-scout-done-line]').waitFor();
    const mid = await read();
    const marks = await page.locator('[data-scout-result="updated"]').count();
    await shot(page, `${label}-done-1440`);
    const undoP = page.waitForResponse(r => r.url().endsWith('/api/scout/undo'), { timeout: 20000 });
    const tUndo = Date.now();
    await page.click('[data-scout-undo]');
    const undone = await (await undoP).json();
    await page.waitForFunction(() => document.querySelector('[data-scout-done-line]')?.textContent === 'Undone');
    const after = await read();
    await shot(page, `${label}-undone-1440`);
    const rec = { label, command, card: { rows: card.rows.map(r => ({ title: r.kind === 'person' ? 'a person' : r.title, kind: r.kind, from: r.from, to: r.to, skipped: r.skipped })), summary: card.summary }, done: { line: done.line, done: done.done, failed: done.failed, skipped: done.skipped }, undo: { line: undone.line, within_s: Math.round((Date.now() - tUndo) / 100) / 10 }, before: b, during: mid, after, marks, restored: JSON.stringify(b) === JSON.stringify(after), changed: expectAfter(mid) };
    results.acts.push(rec);
    return rec;
  };
  const cfRead = async () => (await cloudflare()).map(r => `${r.type}:${first(r.owner_user_id)}${r.owner !== undefined ? `/${r.owner ?? ''}` : ''}`);
  let assignee = cyrus;
  if (cfBefore.length && cfBefore.every(r => r.owner_user_id === cyrus?.user_id)) assignee = members.find(m => m.user_id !== cyrus.user_id);
  const toName = first(assignee.user_id);
  const r4 = await act('ask4-assign', `assign the Cloudflare ones to ${toName}`, { read: cfRead, expectAfter: mid => mid.some(x => x.includes(`:${toName}`)) });
  if (r4.done) {
    const ids = cfBefore.map(r => r.id);
    const ev = (await svc.from('sales_flow_events').select('kind, text, undone_at, meta, at').eq('business_id', HL).in('record_id', ids).gte('at', startIso).order('at')).data || [];
    r4.events = ev.map(e => `${e.kind}${e.meta?.origin ? ` (origin ${e.meta.origin})` : ''}${e.undone_at ? ' · undone' : ''}`);
    ok(`ask 4: "assign the Cloudflare ones to ${toName}" - card ${r4.card.rows.length} rows (${r4.card.summary.will} will change, ${r4.card.summary.skipped} skipped) -> ${r4.done.line} -> in place (${r4.marks} rows marked updated) -> Undo in ${r4.undo.within_s} s -> owner before = after`, r4.changed && r4.restored && r4.marks >= 1 && r4.undo.line === 'undone' && ev.some(e => e.kind === 'assign' && e.meta?.origin === 'scout' && e.undone_at) && ev.some(e => e.kind === 'undo'), JSON.stringify({ before: r4.before, during: r4.during, after: r4.after, events: r4.events, rows: r4.card.rows.map(x => [x.title, x.from, x.to, x.skipped]) }));
  } else ok('ask 4: the assign produced a card', false, JSON.stringify(r4.card).slice(0, 400));

  // ask 3 - the brief + Copy for Claude
  const a3 = await runAsk('ask3', 'pull the intel on our recent call with Northrop Grumman');
  const hasBrief = await page.locator('[data-scout-brief]').count();
  let packInfo = null;
  if (hasBrief) {
    const packP = page.waitForResponse(r => r.url().endsWith('/api/scout/pack'), { timeout: 30000 });
    await page.click('[data-scout-copy]');
    const packRes = await packP; const pack = await packRes.json();
    await page.locator('[data-scout-note="copied"], [data-scout-note="note"]').first().waitFor();
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    packInfo = { status: packRes.status(), chars: pack.chars, records: pack.records, trimmed: pack.trimmed, hasPii: pack.text ? hasPii(pack.text) : null, at: pack.text ? pack.text.includes('@') : null, clipboard: clip.length, line: await page.locator('[data-scout-note]').first().textContent(), head: (pack.text || '').split('\n').slice(0, 2).join(' | ').slice(0, 160) };
    await shot(page, 'ask3-copied-1440');
  }
  results.pack = packInfo;
  ok('ask 3: a brief (header + Copy for Claude) -> the pack: length, hasPii false, no "@", the clipboard holds it', !!hasBrief && packInfo && packInfo.status === 200 && packInfo.chars > 0 && packInfo.chars <= 6000 && packInfo.hasPii === false && packInfo.at === false && packInfo.clipboard === packInfo.chars, JSON.stringify({ sections: a3.rec.sections, pack: packInfo }));

  // ask 5 - snooze a real partner until next week (a command; no Claude)
  const r5 = await act('ask5-snooze', `snooze ${partner.name} until next week`, { read: async () => [(await partnerNow()).snoozed_until || null], expectAfter: mid => !!mid[0] });
  if (r5.done) {
    const ev = (await svc.from('sales_partner_events').select('event, meta, recorded_at').eq('goal_id', partner.id).gte('recorded_at', startIso).order('recorded_at')).data || [];
    r5.events = ev.map(e => `${e.event}${e.meta?.origin ? ` (origin ${e.meta.origin})` : ''}${e.meta?.until ? ` until ${e.meta.until}` : ''}`);
    ok(`ask 5: "snooze ${partner.name} until next week" -> card (${r5.card.rows[0]?.from} -> ${r5.card.rows[0]?.to}) -> ${r5.done.line} -> Undo -> snoozed_until before = after`, r5.changed && r5.restored && r5.undo.line === 'undone' && ev.some(e => e.event === 'snooze' && e.meta?.origin === 'scout') && ev.some(e => e.event === 'undo'), JSON.stringify({ before: r5.before, during: r5.during, after: r5.after, events: r5.events }));
  } else ok('ask 5: the snooze produced a card', false, JSON.stringify(r5.card).slice(0, 400));

  // add a task -> quick capture prefilled, nothing saved
  await type('add a task to call MetLife Thursday'); await page.keyboard.press('Enter');
  await page.locator('input[aria-label="New task"]').waitFor({ timeout: 10000 });
  const qc = await page.evaluate(() => ({ text: document.querySelector('input[aria-label="New task"]').value, due: document.querySelector('input[aria-label="Due date of the new task"]')?.value || null, line: document.querySelector('[data-scout-note="opened"]')?.textContent || null }));
  await shot(page, 'add-task-quick-capture-1440');
  ok('"add a task to call MetLife Thursday" -> quick capture opens prefilled; nothing is saved', qc.text === 'Call MetLife' && /^\d{4}-\d{2}-\d{2}$/.test(qc.due || '') && new Date(`${qc.due}T12:00:00Z`).getUTCDay() === 4 && qc.line === 'Opened - save it there' && (await counts()).todos === before.todos, JSON.stringify(qc));
  await page.keyboard.press('Escape'); await page.locator('button[aria-label="Close quick capture"]').click({ timeout: 1500 }).catch(() => {});

  // can't-do
  await type('send an email to Danilea'); await page.keyboard.press('Enter');
  await page.locator('[data-scout-cant]').waitFor();
  const cant = await page.evaluate(() => ({ reason: document.querySelector('[data-scout-cant] .scout-edge-line').textContent, pills: [...document.querySelectorAll('[data-scout-pill]')].map(p => p.textContent), nearest: document.querySelector('[data-scout-nearest]')?.textContent || null }));
  await shot(page, 'cant-do-1440');
  ok('"send an email to Danilea" -> can\'t-do: the reason, seven verb pills, one nearest action', /can't send email/.test(cant.reason) && cant.pills.length === 7 && cant.nearest === 'Draft email instead', JSON.stringify(cant));
  }
  ok('1440: no page error · N2 0 px', errors.length === 0 && (await n2(page)) === 0, errors.join(' | '));
  await ctx.close();

  // ================= Viewer (no user created)
  if (FULL) { const { ctx: vc, page: vp, errors: ve } = await open(1440, 1000, { viewer: true });
    const vb = vp.locator('.scout-bar input').first(); await vb.waitFor(); await vp.waitForTimeout(2000);
    await vb.click(); await vb.fill('assign those to Cyrus'); await vp.keyboard.press('Enter');
    await vp.locator('[data-scout-cant]').waitFor();
    const reason = await vp.locator('[data-scout-cant] .scout-edge-line').textContent();
    await shot(vp, 'viewer-cant-1440');
    ok('Viewer: a command -> plan 403 (the real plan() with a Viewer\'s roles) -> the can\'t-do state', results.viewer_plan_status === 403 && /view access/.test(reason) && ve.length === 0, `${results.viewer_plan_status} · ${reason}`);
    await vc.close(); }

  // ================= 390 (ask 1 replayed from the cache - 0 Claude)
  { const { ctx: pc, page: pp, errors: pe } = await open(390, 844);
    await pp.locator('button[aria-label="Search or ask Scout"]').first().click();
    const pb = pp.locator('[data-scout-sheet] input').first(); await pb.waitFor();
    await pb.fill('pull me 5 most important prospects who are visiting and hot and show 5 most important tasks'); await pp.waitForTimeout(600); await pp.keyboard.press('Enter');
    try { await pp.locator('[data-scout-sheet] [data-scout-section="2"]').waitFor({ timeout: 12000 }); }
    catch (e) { await shot(pp, 'debug-390'); log('390 debug:', JSON.stringify(await pp.evaluate(() => ({ sheet: !!document.querySelector('[data-scout-sheet]'), text: (document.querySelector('[data-scout-sheet]') || document.body).innerText.slice(0, 400), url: location.search }))), pe.join(' | ')); throw e; }
    await shot(pp, 'ask1-390');
    const ph = await pp.evaluate(() => ({ tables: document.querySelectorAll('[data-scout-sheet] table').length, s1: document.querySelectorAll('[data-scout-section="1"] .scout-card').length, s2: document.querySelectorAll('[data-scout-section="2"] .scout-card').length, more: [...document.querySelectorAll('[data-scout-sheet] .scout-more')].map(b => b.textContent.trim()) }));
    await pb.fill('send an email to Danilea'); await pp.keyboard.press('Enter');
    await pp.locator('[data-scout-cant]').waitFor({ timeout: 10000 });
    await shot(pp, 'cant-do-390');
    await pp.locator('[data-scout-sheet] .scout-more-btn').first().click({ timeout: 10000 });
    await pp.locator('.scout-menu--sheet').waitFor({ timeout: 10000 });
    const rowH = await pp.evaluate(() => Math.round(document.querySelector('.scout-menu--sheet [role="menuitem"]').getBoundingClientRect().height));
    await shot(pp, 'action-sheet-390');
    const wantMore = [want > 3 ? `${want - 3} more` : null, '3 more'].filter(Boolean).join('|');
    ok(`390: the sheet stacks cards (${Math.min(3, want)} of ${want} people${want > 3 ? ` + "${want - 3} more"` : ''}, 2 tasks + "3 more"), the ⋯ opens an action sheet with 44 px rows, can't-do wraps · N2 0 px · no page error`, ph.tables === 0 && ph.s1 === Math.min(3, want) && ph.s2 === 2 && ph.more.join('|') === wantMore && rowH >= 44 && (await n2(pp)) === 0 && pe.length === 0, JSON.stringify({ ...ph, rowH, errors: pe }));
    await pc.close(); }

  const after = await counts();
  results.counts = { before, after };
  const net = { todos: after.todos - before.todos, usage: after.usage - before.usage, flow: after.flow - before.flow, partner_events: after.partner_events - before.partner_events };
  ok(`counts: to-dos ${net.todos} · usage rows +${net.usage} (= real asks this run ${results.claude_this_run}) · flow events +${net.flow} · partner events +${net.partner_events} (the act + undo history, kept)`, net.todos === 0 && net.usage === results.claude_this_run, JSON.stringify(net));
  const stray = results.blocked.filter(b => !/\/api\/(visits|me|sales\/[^/]+\/goals\/(week\/carry|attention))/.test(b));
  log(`blocked non-GET calls: ${results.blocked.length}${results.blocked.length ? ` (${[...new Set(results.blocked)].slice(0, 6).join(', ')})` : ''}`);
  results.stray = stray;
} catch (e) { ok('run completed', false, e.message.slice(0, 400)); }
finally { await cleanup(); }
results.ledger = { spent: ledger.spent, cap: CLAUDE_CAP };
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
const failed = results.checks.filter(c => !c.pass);
console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks · Claude this run ${results.claude_this_run} · spent in all ${ledger.spent} of ${CLAUDE_CAP} · Apollo 0 · restored: ${results.safety_net && !results.safety_net.length && results.acts.every(a => !a.done || a.restored) ? 'yes' : `CHECK (${JSON.stringify(results.safety_net)})`}`);
process.exit(failed.length ? 1 : 0);
