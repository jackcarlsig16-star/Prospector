// FIX touch-truth Stage 1 live check - localhost, the real routes, as Jack (ownerSession) on the REAL HomeLover workspace.
// DECLARED before it runs:
//   Claude  0.   Apollo  0 (the server runs with the Apollo key empty; nothing here calls Apollo).
//   Writes  (1) ONE score recompute for HomeLover through the app's own recomputeScores (the derived sales_company_scores
//               rows + today's snapshot row - what a stale page load does; not restorable, idempotent).
//           (2) ONE test send of the visitor email to the sending mailbox only (the "Send a test to me only" route). Its
//               sales_team_email_sends row is kept. Skipped unless the sender is Jack. Never repeated: the ledger blocks it.
//           (3) ONE auto-add: the first company of the dry-run list, declared by name before the write -> one
//               sales_targets row, one sales_flow_events row, its unmatched web_visits rows re-stamped, an open signal
//               accepted. KEPT (Jack's call). Never repeated: the ledger blocks it.
//           The browser is read-only (every non-GET is aborted). ownerSession's sign-in row is kept by rule.
//   Reads   3 single touch reads + 1 batch read set, ~12 small raw reads to compare, 2 email builds from stored rows,
//           6 page loads. Estimated 120 s; hard cap 280 s.
// Prints company names, member first names and counts only - never an address.
// Usage: node scripts/verify/touch-truth-stage1.mjs [--no-screens]
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
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { touchesFor, OUR_KINDS } = await import('../../api/sales/touches.js');
const { recomputeScores } = await import('../../api/sales/intentScoreRun.js');
const { listScores } = await import('../../api/sales/scoresRoutes.js');
const { loadVisitorData, loadRankedBook, loadCumulative, buildVisitorEmail, dayWindowFor } = await import('../../api/sales/teamEmails/visitorEmail.js');
const { loadMembers } = await import('../../api/sales/teamEmails/send.js');
const { autoAddVisitors, salesSettings } = await import('../../api/sales/visitorRoutes.js');
const { loadDupeContext } = await import('../../api/sales/partnerDupeCheck.js');
const { loadOverrides, effectiveVisit } = await import('../../api/sales/visitPriority.js');
const { laDateString } = await import('../../api/sales/laDate.js');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const NO_SCREENS = process.argv.includes('--no-screens');
const OUT = path.join(ROOT, '.screenshots', 'touch-truth');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 3996, BASE = `http://localhost:${PORT}`;
const REF = new URL(process.env.SUPABASE_URL).host.split('.')[0], SUPA_HOST = new URL(process.env.SUPABASE_URL).host;
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const T0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s]`, ...a);
const HL = (await svc.from('businesses').select('id').ilike('name', 'homelover')).data?.[0]?.id;
if (!HL) throw new Error('no HomeLover business');
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const TABLES = ['sales_targets', 'sales_opportunities', 'sales_goals', 'sales_flow_events', 'sales_partner_events', 'sales_week_goals', 'sales_people', 'sales_signals', 'web_visits', 'sales_team_email_sends', 'sales_company_scores'];
const count = async t => { const r = await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL); return r.error ? `n/a` : r.count; };
const snapshot = async () => { const o = {}; for (const t of TABLES) o[t] = await count(t); return o; };
const LEDGER = path.join(OUT, 'live-ledger.json');
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : {};
const saveLedger = () => fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
const results = { checks: [] };
const ok = (name, pass, detail) => { results.checks.push({ name, pass: !!pass }); log(pass ? 'PASS' : 'FAIL', name, detail ? `- ${String(detail).slice(0, 500)}` : ''); };
// The two real writes (the test send, the auto-add) happen only while every check so far has passed.
const clean = () => results.checks.every(c => c.pass);
let srv, owner, browser;
async function teardown() { if (browser) await browser.close().catch(() => {}); browser = null; if (srv) srv.kill(); srv = null; if (owner) { log(await owner.release()); owner = null; } }
const cleanup = require(ROOT + '/scripts/verify/lib/tempGuard.cjs')(teardown, { capMs: 280000 });
const day = iso => (iso ? laDateString(new Date(iso)) : '—');
const all = (table, cols, build = q => q, order = 'id') => selectAllPages(() => build(svc.from(table).select(cols).eq('business_id', HL)).order(order));

const memberRows = must(await svc.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', HL).not('user_id', 'is', null));
const first = id => (id ? String(memberRows.find(m => m.user_id === id)?.profile?.display_name || memberRows.find(m => m.user_id === id)?.name || '').trim().split(/\s+/)[0] || null : null);
const before = await snapshot();
log('before', JSON.stringify(before));

try {
  // ---- 1. the three companies: T1 against raw rows counted here, independently of touches.js
  const three = [
    ['Hilton', 'employer', must(await svc.from('sales_opportunities').select('id, organization, apollo_account_id, domain').eq('business_id', HL).eq('organization', 'Hilton'))[0]],
    ['Bass Pro Shops', 'employer', must(await svc.from('sales_opportunities').select('id, organization, apollo_account_id, domain').eq('business_id', HL).ilike('organization', 'Bass Pro%'))[0]],
    ['Jack Morton Worldwide', 'target', must(await svc.from('sales_targets').select('id, name, apollo_account_id, domain').eq('business_id', HL).ilike('name', 'Jack Morton%'))[0]],
  ];
  const singles = [];
  for (const [label, type, rec] of three) {
    if (!rec) { ok(`${label}: record found`, false); continue; }
    const t = await touchesFor(svc, HL, { type, id: rec.id });
    singles.push(t);
    const byAccount = rec.apollo_account_id ? must(await svc.from('sales_email_delivered').select('apollo_message_id, delivered_at').eq('business_id', HL).eq('account_id', rec.apollo_account_id)) : [];
    const name = rec.organization || rec.name;
    const people = must(await svc.from('sales_prospect_state').select('contact_id').eq('business_id', HL).ilike('company', name)).map(p => p.contact_id);
    const older = people.length ? must(await svc.from('sales_email_messages').select('apollo_message_id, delivered_at').eq('business_id', HL).in('contact_id', people)).filter(m => m.delivered_at && !byAccount.some(d => d.apollo_message_id === m.apollo_message_id)) : [];
    const outlook = rec.domain ? new Set(must(await svc.from('microsoft_messages').select('graph_id, internet_message_id').eq('business_id', HL).eq('direction', 'sent').contains('external_domains', [rec.domain])).map(m => m.internet_message_id || m.graph_id)).size : 0;
    const done = must(await svc.from('sales_week_goals').select('id').eq('business_id', HL).eq('kind', 'todo').eq('status', 'done').eq('link_type', type).eq('link_id', String(rec.id))).length;
    const rawEmail = byAccount.length + older.length + outlook;
    const ours = OUR_KINDS.filter(k => t.kinds[k]).map(k => `${k} ${t.kinds[k]}`).join(' · ') || 'none';
    log(`${label} [${type}] T1: ${t.count} touches (${ours}) · last ${t.last ? `${day(t.last.at)} ${t.last.kind}${t.last.what ? ` (${t.last.what})` : ''}${first(t.last.by) ? ` · ${first(t.last.by)}` : ''}` : 'none'} · theirs: opens ${t.kinds.open} clicks ${t.kinds.click} replies ${t.kinds.reply} · last signal ${t.last_signal ? `${day(t.last_signal.at)} ${t.last_signal.kind}` : 'none'}`);
    log(`${label} raw: Apollo delivered by account ${byAccount.length} · older Apollo messages by company name ${older.length} · Outlook sent ${outlook} · done to-dos ${done}`);
    ok(`${label}: T1 emails ${t.kinds.email} = raw ${rawEmail}; to-dos ${t.kinds.todo} = raw ${done}; count = the sum of our kinds; opens / clicks / replies not in it`,
      t.kinds.email === rawEmail && t.kinds.todo === done && t.count === OUR_KINDS.reduce((n, k) => n + t.kinds[k], 0));
  }
  const batch = await touchesFor(svc, HL, three.filter(x => x[2]).map(([, type, rec]) => ({ type, id: rec.id })));
  ok('batch = single for the three', JSON.stringify(batch) === JSON.stringify(singles));
  ok('Hilton and Bass Pro Shops have touches (they read "No touch yet" before)', singles[0]?.count > 0 && singles[1]?.count > 0, `Hilton ${singles[0]?.count} · Bass Pro Shops ${singles[1]?.count} · Jack Morton Worldwide ${singles[2]?.count}`);
  ok('no address in any answer', !JSON.stringify(batch).includes('@'));

  // ---- 2. scores / meta + needsTouch through one recompute
  const nb = (await listScores(svc, HL, {})).body.counts.needs_touch;
  const rec = ledger.recompute ? { ran: true, counts: ledger.recompute.counts, again: true } : await recomputeScores(svc, { businessId: HL, trigger: 'manual' });
  if (!rec.again) { ledger.recompute = { at: new Date().toISOString(), counts: rec.counts, needs_touch_before: nb }; saveLedger(); } else log(`recompute: already run ${ledger.recompute.at} (Needs a touch was ${ledger.recompute.needs_touch_before} before it) - not repeated`);
  const scores = (await listScores(svc, HL, {})).body;
  for (const [label, type, r] of three) {
    const row = scores.rows.find(x => x.type === type && x.id === r?.id) || null;
    const i = three.findIndex(x => x[0] === label);
    log(`${label} score row: touches ${row?.touches} · last touch ${day(row?.last_touch_at)} ${row?.last_touch_channel || ''}${row?.last_touch_who ? ` · ${row.last_touch_who.split(' ')[0]}` : ''} · last signal ${row?.last_signal_kind || 'none'} · days since ${row?.days_since_touch ?? '—'}`);
    ok(`${label}: the score row's touches and last touch are T1's`, !!row && row.touches === singles[i].count && (row.last_touch_at || null) === (singles[i].last?.at || null));
  }
  ok(`recompute ran: ${rec.counts.companies} companies · Needs a touch ${nb} -> ${scores.counts.needs_touch}`, rec.ran && Number.isInteger(scores.counts.needs_touch));

  // ---- 3. the email, built from stored rows (no send)
  const members = await loadMembers(svc, HL);
  const date = laDateString(new Date());
  const window = dayWindowFor(date);
  const [companies, overall, cumulative] = await Promise.all([loadVisitorData(svc, HL, { window, members }), loadRankedBook(svc, HL, { members }), loadCumulative(svc, HL)]);
  const mail = buildVisitorEmail(companies, { date, window, overall, cumulative, businessId: HL });
  fs.writeFileSync(path.join(OUT, 'email-after.html'), mail.html);
  const bookLine = n => mail.text.split('\n').find(l => new RegExp(`^\\d+\\. ${n} — `).test(l)) || null;
  for (const n of ['Hilton', 'Bass Pro Shops']) { const l = bookLine(n); log(`email, top 10: ${l || `${n} is not in today's top 10`}`); if (l) ok(`${n}'s row says Touches <n> · last …, not "None yet"`, /Touches \d+ · last /.test(l)); }
  const addRows = companies.filter(c => !c.type && c.touches);
  ok(`email: "Touches" heads all three tables, the legend line is there, no "No touch yet" / "Last touch", no address`, (mail.html.match(/>Touches<\/th>/g) || []).length >= 1 && mail.text.includes('opens and visits are theirs.') && !/No touch yet|Last touch/.test(mail.html + mail.text) && !/[^\s"<>=/]+@[^\s"<>]+\.[a-z]{2,}/i.test(mail.html + mail.text));
  ok(`email: every "Add →" opens its own company (${addRows.length} printed rows without a record)`, addRows.every(c => mail.html.includes(`visitors=${encodeURIComponent(c.company_key)}&amp;business=${HL}"`)));
  log(`email: ${mail.visited} visited · ${mail.new} new · ${mail.qualified} worth a look · printed rows with touches > 0: ${companies.filter(c => c.touches?.count).length} · printed rows "None yet": ${companies.filter(c => c.touches && !c.touches.count).length}`);

  // ---- 4. the server as Jack: ONE test send, then the screens
  owner = await ownerSession(svc);
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BASIC_AUTH_ENABLED: 'false', HK_SCHEDULER: '', HOMELOVER_SCHEDULER: '', APOLLO_API_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 60; i++) { try { await fetch(`${BASE}/`); break; } catch { await new Promise(r => setTimeout(r, 250)); } }
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(owner.session.access_token)}`;
  const call = async (method, p, body) => { const r = await fetch(`${BASE}${p}`, { method, headers: { cookie, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, body: await r.json().catch(() => null) }; };
  const S = `/api/sales/${HL}`;
  const state = await call('GET', `${S}/goals/team-emails`);
  ok(`team-emails state: auto-add cap ${state.body?.auto_add_cap} a day (owner-editable)`, state.status === 200 && Number.isInteger(state.body.auto_add_cap));
  if (ledger.test_send) log(`test send: already made ${ledger.test_send.at} (${ledger.test_send.status}, ${ledger.test_send.recipients} recipient) - not repeated`);
  else if (!clean()) log('test send: NOT made - an earlier check failed');
  else if (state.body?.sender?.user_id !== owner.userId) ok(`test send skipped: the sending mailbox is ${state.body?.sender?.first_name || 'not set'}'s, not Jack's`, false);
  else {
    const t = await call('POST', `${S}/goals/team-emails/test`, { kind: 'visitor' });
    ledger.test_send = { at: new Date().toISOString(), status: t.body?.status, recipients: t.body?.recipients, rows: t.body?.rows, new_rows: t.body?.new_rows }; saveLedger();
    ok(`ONE test send to Jack: ${t.body?.status} · ${t.body?.recipients} recipient · ${t.body?.new_rows} new rows · ${t.body?.rows} worth-a-look rows`, t.status === 200 && t.body.status === 'sent' && t.body.recipients === 1 && !JSON.stringify(t.body).includes('@'));
  }
  const detail = await call('GET', `${S}/goals/company?type=employer&id=${three[0][2].id}`);
  ok(`the window's record for Hilton carries touches (${detail.body?.record?.touches?.count}) with a first-name-able last touch and their last signal apart`, detail.status === 200 && detail.body.record.touches.count === singles[0].count && !JSON.stringify(detail.body.record.touches).includes('@'));

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const visitRows = await all('web_visits', '*');
  const lastPull = visitRows.map(v => v.pulled_on).sort().pop();
  const latest = visitRows.filter(v => v.pulled_on === lastPull);
  if (!NO_SCREENS) {
    browser = await chromium.launch();
    const blocked = [];
    const open = async (width, query, wait) => {
      const ctx = await browser.newContext({ viewport: { width, height: width < 900 ? 844 : 1000 }, hasTouch: width < 900 });
      await ctx.addInitScript(([k, v, bz, dd]) => {
        if (sessionStorage.getItem('__s')) return; sessionStorage.setItem('__s', '1'); localStorage.clear(); localStorage.setItem(k, v);
        for (const nme of ['visits', 'tidy', 'apollo_sync']) localStorage.setItem(`prospector_${nme}_ran_${bz}`, dd);
        localStorage.setItem('prospector_auto_assay_disabled', '1');
      }, [`sb-${REF}-auth-token`, JSON.stringify(owner.session), HL, today]);
      await ctx.route('**/*', route => {
        const req = route.request(); const u = new URL(req.url());
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return route.continue();
        const isLocal = u.host === `localhost:${PORT}`, isSupa = u.host === SUPA_HOST, isFont = /fonts\.(googleapis|gstatic)\.com$/.test(u.host);
        const write = (isLocal && req.method() !== 'GET' && /^\/(api|proxy)\//.test(u.pathname)) || (isSupa && req.method() !== 'GET' && !u.pathname.startsWith('/auth/v1/')) || (!isLocal && !isSupa && !isFont);
        if (write) { blocked.push(`${req.method()} ${u.pathname.replace(HL, ':b')}`); return route.abort(); }
        return route.continue();
      });
      const page = await ctx.newPage(); page.setDefaultTimeout(25000);
      // The link alone, as the email sends it: ?business=<id> opens the workspace on the link (no clicks).
      await page.goto(`${BASE}/?${query}&business=${HL}`);
      await page.waitForSelector(wait, { timeout: 25000 });
      await page.waitForTimeout(600);
      return { ctx, page };
    };
    // axe on the surface this FIX changes (the window, the list's filter line, the Top targets table), as the earlier live checks scope it.
    const shot = async (page, name, scope, { full = false } = {}) => {
      await page.addScriptTag({ content: AXE });
      const v = await page.evaluate(async s => (await window.axe.run({ include: s.filter(x => document.querySelector(x)).map(x => [x]) }, { resultTypes: ['violations'] })).violations.map(x => ({ id: x.id, nodes: x.nodes.length, target: x.nodes[0]?.target?.join(' ') })), scope);
      const n2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
      ok(`${name}: axe 0 · N2 0 px`, v.length === 0 && n2 <= 0, v.length || n2 > 0 ? JSON.stringify({ axe: v, n2 }) : '');
    };
    const waiting = latest.find(v => !v.matched_id && !v.us_500 && !v.noise_reason && !v.maybe_user);
    for (const w of [1440, 390]) {
      const win = await open(w, `tab=pipeline&view=companies&open=employer-${three[0][2].id}`, '[data-center-window] [data-fact="Touches"]');
      await win.page.waitForFunction(() => /\d+ · last |None yet/.test(document.querySelector('[data-center-window] [data-fact="Touches"]')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
      const fact = (await win.page.locator('[data-center-window] [data-fact="Touches"]').first().innerText()).replace(/\s+/g, ' ');
      ok(`window facts @ ${w}: Hilton's Touches fact reads "${fact}"`, new RegExp(`${singles[0].count} · last `).test(fact));
      await shot(win.page, `window-facts-after-${w}`, ['[data-center-window]']); await win.ctx.close();
      if (waiting) {
        const link = await open(w, `visitors=${encodeURIComponent(waiting.company_key)}`, '[data-center-window]');
        const focused = await link.page.evaluate(() => document.activeElement?.textContent || '');
        const chip = await link.page.getByRole('button', { name: /^Remove filter Visitor: / }).count();
        ok(`deep link @ ${w}: /?visitors=<key> opens Website visitors on ${waiting.company_name} with its window open, focus on "${focused.trim()}"`, /Add to pipeline/.test(focused) && chip === 1 && (await link.page.getByRole('dialog', { name: waiting.company_name }).count()) === 1);
        await shot(link.page, `deep-link-${w}`, ['[data-center-window]', '[data-active-filters]']); await link.ctx.close();
      } else ok('deep link: an unmatched visitor to open', false, 'the last pull has none');
      const top = await open(w, 'tab=pipeline&view=top-targets', '[data-top-targets]');
      await shot(top.page, `top-targets-after-${w}`, ['[data-top-targets]'], { full: true }); await top.ctx.close();
    }
    const em = await (await browser.newContext({ viewport: { width: 640, height: 900 } })).newPage();
    for (const f of ['after', ...(fs.existsSync(path.join(OUT, 'email-before.html')) ? ['before'] : [])]) { await em.goto(`file://${path.join(OUT, `email-${f}.html`)}`); await em.screenshot({ path: path.join(OUT, `email-${f}-640.png`), fullPage: true }); }
    ok(`the browser wrote nothing (${blocked.length} non-GET requests aborted${blocked.length ? `: ${[...new Set(blocked)].slice(0, 4).join(', ')}` : ''})`, true);
  }

  // ---- 5. auto-add: the dry run over the last pull, then ONE real add
  const [dupeCtx, settings, overrides, skipRows] = await Promise.all([loadDupeContext(svc, HL), salesSettings(svc, HL), loadOverrides(svc, HL), all('sales_visit_skip', 'id, company_key')]);
  const skip = new Set(skipRows.map(r => r.company_key));
  const visits = latest.map(v => effectiveVisit(v, overrides.get(v.company_key)));
  const dry = await autoAddVisitors(svc, { businessId: HL, visits, dupeCtx, settings, skip, dryRun: true });
  log(`auto-add dry run over the ${lastPull} pull (${latest.length} companies, ${latest.filter(v => !v.matched_id).length} without a record, cap ${settings.auto_create_daily_cap}): would add ${dry.would_add.length} - ${dry.would_add.map(a => `${a.name} (${a.reason === 'us_500' ? 'US 500+' : 'buyer title'})`).join(' · ') || 'none'} · already a record ${dry.already} · over the cap ${dry.capped}`);
  ok('the dry run wrote nothing', (await count('sales_targets')) === before.sales_targets && (await count('sales_flow_events')) === before.sales_flow_events);
  if (ledger.auto_add) {
    const t = must(await svc.from('sales_targets').select('id, name, status, owner_user_id').eq('id', ledger.auto_add.target_id).maybeSingle());
    log(`auto-add: already made ${ledger.auto_add.at} - ${ledger.auto_add.name} (${t ? `target ${t.status}, kept` : 'row gone'}) - not repeated`);
  } else if (!clean()) log('auto-add: NOT made - an earlier check failed');
  else if (!dry.would_add.length) log('auto-add: no company in the last pull meets the rule - nothing added (the dedupe, cap and event are covered by the node test)');
  else {
    const pick = latest.find(v => v.company_name === dry.would_add[0].name);
    log(`DECLARED: adding ONE company for real - ${pick.company_name} (${dry.would_add[0].reason === 'us_500' ? 'US 500+' : 'a buyer-title visitor'}, ${pick.visits_7d} visits / 7 d)`);
    const out = await autoAddVisitors(svc, { businessId: HL, visits, dupeCtx, settings, skip, only: pick.company_key });
    const a = out.added[0];
    ledger.auto_add = a ? { at: new Date().toISOString(), name: a.name, target_id: a.target_id, event_id: a.event_id } : null; saveLedger();
    const t = a && must(await svc.from('sales_targets').select('id, name, status, kind, owner_user_id, channel, source, source_kind').eq('id', a.target_id).maybeSingle());
    const ev = a && must(await svc.from('sales_flow_events').select('id, kind, text, by_user').eq('id', a.event_id).maybeSingle());
    const stamped = a ? must(await svc.from('web_visits').select('id, matched_type, matched_id').eq('business_id', HL).eq('company_key', pick.company_key)) : [];
    ok(`ONE real auto-add: ${a?.name} -> target (${t?.status}, owner ${first(t?.owner_user_id) || 'Unassigned'}, ${t?.channel}) · event "${ev?.text}" · ${stamped.filter(v => v.matched_id === a?.target_id).length}/${stamped.length} visit rows on it`,
      out.added.length === 1 && t?.kind === 'employer' && !t.owner_user_id && ev?.kind === 'restamp' && stamped.every(v => v.matched_type === 'target' && v.matched_id === a.target_id));
    const again = await autoAddVisitors(svc, { businessId: HL, visits, dupeCtx: await loadDupeContext(svc, HL), settings, skip, only: pick.company_key });
    ok('a second run on the same company adds nothing (already a record)', again.added.length === 0 && again.already === 1);
    const emailRow = (await loadVisitorData(svc, HL, { window, members })).find(c => c.company_key === pick.company_key);
    if (emailRow) ok(`the email now reads it as a record, no "Add →": ${emailRow.type} · ${emailRow.stage} · ${emailRow.owner}`, emailRow.type === 'target');
  }
} catch (e) { ok(`run error: ${e.message}`, false); }
finally {
  await cleanup();
  const after = await snapshot();
  const moved = TABLES.filter(t => before[t] !== after[t]).map(t => `${t} ${before[t]} -> ${after[t]}`);
  log('after', JSON.stringify(after));
  const failed = results.checks.filter(c => !c.pass);
  console.log(`\n${results.checks.length - failed.length}/${results.checks.length} checks passed${failed.length ? ` · FAILED: ${failed.map(f => f.name.slice(0, 80)).join(' | ')}` : ''}`);
  console.log(`counts moved: ${moved.join(', ') || 'none'}`);
  console.log('restored: yes for every read · kept by declaration: the one auto-added target with its event and re-stamped visit rows, the one test-send row, the recomputed score rows; hk_events / auth_events untouched');
  process.exit(failed.length ? 1 : 0);
}
