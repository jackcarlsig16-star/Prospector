// fathom-notes-v1 REV 2 Stage 3 live check - localhost, the real routes and the real screen, as Jack (ownerSession) on
// the REAL HomeLover workspace. Needs `npm run build` first (the local server serves build/).
// DECLARED before it runs:
//   Claude  cap 1 HARD: ONE Scout ask "calls this week" (POST /api/scout/ask). Counted in
//           .screenshots/fathom-notes-v1/stage3-ledger.json BEFORE it is made; a run that finds the ledger spent replays
//           the kept answer and sends nothing - a re-run of the paid call needs Jack's ok. --no-ask sends none.
//   Apollo  0 (the server runs with the Apollo key empty).   Fathom API  0.
//   Writes  2, through the real route, clicked in the real picker: PUT goals/call-notes/<the Nov 20 Seif note>/record
//           -> the target "Master Magnetics, Inc." (the declared record), then -> none. The note ends as it started
//           (no record). Each PUT writes ONE sales_flow_events row on that target ("Call linked: …" / "Call unlinked: …")
//           - those 2 rows STAY (the event log is the history; same rule as the pin runs). Every other browser write
//           is refused in the browser.
//   Reads   ~20 route calls (the Calls log with each chip, one company window, one Brief), ~8 raw count queries on
//           sales_call_notes / sales_calls_v, 3 page loads (1440 Calls, 1440 the picker, 390 Calls). ~90 s, cap 230 s.
//   --read-only  the same run with NO write and NO ask: every read, the three page loads, the picker opened and searched
//           but nothing picked. Proves the script before the 2 writes and the paid ask.
//   Never   creates a workspace or a user; the sign-in row ownerSession adds is kept by rule.
// Prints titles, names and counts only - never a note's text.
import fs from 'fs';
import path from 'path';
import { readOnlyBrowser } from './lib/readOnlyBrowser.mjs';

const RO = process.argv.includes('--read-only');
const NO_ASK = RO || process.argv.includes('--no-ask');
const SEIF_NOTE = { call_date: '2026-11-20', title: 'Impromptu Zoom Meeting', idStarts: '9e020b65' };
const DECLARED = { type: 'target', id: '9778c9f1-d332-477a-b562-ee92ae9e9202', name: 'Master Magnetics, Inc.' };
const PORT = 3995;

// The note id is needed for the one allowed PUT path before the browser helper starts.
const { createRequire } = await import('module');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const pre = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const d = new Date(), toSix = ((6 - (d.getHours() % 6)) % 6) * 60 - d.getMinutes();
if ((toSix >= 0 && toSix < 5) || (d.getHours() % 6 === 0 && d.getMinutes() < 2)) { console.log('ABORT: within 5 min of a server.js cron time'); process.exit(1); }
const HL = must(await pre.from('businesses').select('id').ilike('name', 'homelover'))[0]?.id;
const seif = must(await pre.from('sales_call_notes').select('id, title, call_date, record_type, record_id, accepted_at').eq('business_id', HL).eq('call_date', SEIF_NOTE.call_date).eq('title', SEIF_NOTE.title)).find(n => n.id.startsWith(SEIF_NOTE.idStarts));
if (!seif) { console.log('ABORT: the Nov 20 Seif note is not there'); process.exit(1); }
if (seif.record_id) { console.log(`ABORT: the Nov 20 Seif note already has a record (${seif.record_type}) - a member mapped it; this run would overwrite that. Look before running.`); process.exit(1); }
const target = must(await pre.from('sales_targets').select('id, name').eq('business_id', HL).eq('id', DECLARED.id).maybeSingle());
if (!target || target.name !== DECLARED.name) { console.log('ABORT: the declared record is not there under that name'); process.exit(1); }
const PUT_PATH = `/api/sales/${HL}/goals/call-notes/${seif.id}/record`;

const h = await readOnlyBrowser({ port: PORT, capMs: 230000, allowPut: RO ? [] : [PUT_PATH] });
const { SESSION_COOKIE } = await import('../../api/lib/authUser.js');
const { laMonday } = await import('../../api/sales/goalsShared.js');
const svc = h.svc, B = h.workspace.id, T0 = Date.now(), startIso = new Date(T0 - 2000).toISOString();
if (B !== HL) { console.log('ABORT: the sales workspace is not HomeLover'); await h.close(); process.exit(1); }
const OUT = path.join(h.ROOT, '.screenshots', 'fathom-notes-v1', 'stage3-live');
fs.mkdirSync(OUT, { recursive: true });
const LEDGER = path.join(h.ROOT, '.screenshots', 'fathom-notes-v1', 'stage3-ledger.json');
const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : { asks: [] };
const AXE = fs.readFileSync(path.join(h.ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const checks = [];
const ok = (name, pass, detail = '') => { checks.push(!!pass); console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${String(detail).slice(0, 700)}` : ''}`); };
const cookie = `${SESSION_COOKIE}=${encodeURIComponent(h.owner.session.access_token)}`;
const call = async (p, method = 'GET', body = null) => { const r = await fetch(`${h.BASE}${p}`, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const sales = p => call(`/api/sales/${B}/goals${p}`);
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const AT = String.fromCharCode(64);
const n = async (table, f = q => q) => { const r = await f(svc.from(table).select('*', { count: 'exact', head: true }).eq('business_id', B)); if (r.error) throw new Error(`${table}: ${r.error.message}`); return r.count; };
const TABLES = ['sales_call_notes', 'sales_flow_events', 'business_anthropic_usage', 'sales_week_goals', 'sales_targets', 'sales_goals', 'sales_opportunities', 'sales_partner_events', 'sales_todo_events'];
const snapshot = async () => Object.fromEntries(await Promise.all(TABLES.map(async t => [t, await n(t)])));
const noteNow = async () => must(await svc.from('sales_call_notes').select('record_type, record_id, accepted_at').eq('id', seif.id).single());
const myEvents = async () => must(await svc.from('sales_flow_events').select('id, kind, text, record_type, record_id, by_user, meta, at').eq('business_id', B).in('kind', ['call_link', 'call_unlink']).gte('at', startIso).order('at'));
const before = await snapshot();
console.log(`before ${JSON.stringify(before)} · the note "${seif.title}" ${seif.call_date} has no record · declared record: ${DECLARED.type} "${DECLARED.name}"`);

try {
  // ── 1. the Calls log vs raw counts
  const raw = {
    notes: before.sales_call_notes, view: await n('sales_calls_v'),
    unreviewed: await n('sales_call_notes', q => q.is('accepted_at', null)), noCompany: await n('sales_call_notes', q => q.is('record_id', null)),
    mine: await n('sales_call_notes', q => q.eq('created_by', h.owner.userId)), week: await n('sales_call_notes', q => q.gte('call_date', laMonday(today))),
    weekUnreviewed: await n('sales_call_notes', q => q.gte('call_date', laMonday(today)).is('accepted_at', null)), weekNoCompany: await n('sales_call_notes', q => q.gte('call_date', laMonday(today)).is('record_id', null)),
    fathom: await n('sales_call_notes', q => q.not('fathom_recording_id', 'is', null)),
  };
  const all = await sales('/calls');
  ok(`the view holds one row per note: sales_calls_v ${raw.view} = sales_call_notes ${raw.notes}`, raw.view === raw.notes);
  ok(`Calls (Team): HTTP ${all.status} · ${all.body?.counts?.calls} calls · ${all.body?.counts?.unreviewed} unreviewed · ${all.body?.counts?.no_company} without a company = raw ${raw.notes} · ${raw.unreviewed} · ${raw.noCompany}`,
    all.status === 200 && all.body.total === raw.notes && all.body.counts.calls === raw.notes && all.body.counts.unreviewed === raw.unreviewed && all.body.counts.no_company === raw.noCompany);
  const chip = async (query, want, label) => { const r = await sales(`/calls?${query}`); ok(`chip ${label}: ${r.body?.counts?.calls} = raw ${want}`, r.status === 200 && r.body.counts.calls === want && r.body.calls.length === want); return r; };
  await chip('who=mine', raw.mine, 'Mine');
  await chip('unreviewed=1', raw.unreviewed, 'Unreviewed');
  const wk = await chip('week=1', raw.week, `This week (since ${laMonday(today)})`);
  await chip('company=with', raw.notes - raw.noCompany, 'With a company');
  await chip('company=none', raw.noCompany, 'No company');
  const dates = all.body.calls.map(c => c.call_date);
  ok(`newest first (${dates[0]} … ${dates.at(-1)}) · ${all.body.calls.filter(c => c.source === 'Fathom').length} Fathom = raw ${raw.fathom} · every row has a member name · no "${AT}", no text / transcript / extract in the reply`,
    dates.every((x, i) => i === 0 || dates[i - 1] >= x) && all.body.calls.filter(c => c.source === 'Fathom').length === raw.fathom && all.body.calls.every(c => c.member?.name && !('text' in c) && !('transcript' in c) && !('extract' in c)) && !JSON.stringify(all.body).includes(AT));
  const backfilled = all.body.calls.filter(c => c.record);
  ok(`mapped calls: ${backfilled.length} (${['partner', 'employer', 'target'].map(t => `${backfilled.filter(c => c.record.type === t).length} ${t}`).join(' · ')})`, backfilled.length === raw.notes - raw.noCompany);

  // ── 2. the readers on one mapped record
  const sample = backfilled[0];
  if (sample) {
    const det = await sales(`/company?type=${sample.record.type}&id=${sample.record.id}`);
    const linked = backfilled.filter(c => c.record.type === sample.record.type && c.record.id === sample.record.id);
    ok(`company window of "${sample.record.name}": ${det.body?.calls?.length} call(s) listed, newest "${det.body?.calls?.[0]?.title}" ${det.body?.calls?.[0]?.call_date} = the log's ${Math.min(5, linked.length)}`, det.status === 200 && det.body.calls.length === Math.min(5, linked.length) && det.body.calls[0].id === linked[0].id);
    const brief = await sales(`/brief/${sample.record.type}/${sample.record.id}`);
    const line = (brief.body?.lines || []).find(l => l.kind === 'call');
    ok(`Brief of "${sample.record.name}": "${line?.text}"`, brief.status === 200 && !!line && line.text.startsWith('Last call: ') && line.text.includes(linked[0].title.slice(0, 20)));
  } else ok('a mapped record to read', false);

  // ── 3. Scout's read for "calls this week" (the ask's own path up to the model, 0 Claude)
  const { ensureRegistry, scoutDeps } = await import('../../api/scout/registry.js');
  await ensureRegistry([path.join(h.ROOT, 'api/sales/scoutEntities.js'), path.join(h.ROOT, 'api/hk/scoutEntities.js')]);
  const { buildContext } = await import('../../api/scout/retrieve.js');
  const ctxOf = q => buildContext(svc, scoutDeps.registry(), { auth: { user: { id: h.owner.userId }, isPlatformOwner: true, roles: new Map([[B, 'owner']]) }, scope: B, q });
  const c1 = await ctxOf('calls this week');
  const want = `${raw.week} call${raw.week === 1 ? '' : 's'} · ${raw.weekUnreviewed} unreviewed · ${raw.weekNoCompany} without a company`;
  ok(`Scout context "calls this week": intent ${c1.stats?.intent} · the read: ${c1.parts?.[0]?.read} · raw: ${want}`, !c1.cant && /(^|\+)calls($|\+)/.test(c1.stats.intent) && c1.parts.some(p => p.read.includes(want)) && !c1.pack.includes(AT), JSON.stringify(c1.cant || {}).slice(0, 200));
  ok(`Scout glossary carries call / recording / unreviewed`, (c1.glossary || []).some(l => /A call = one row of the Calls log/.test(l) && /A recording = /.test(l) && /Unreviewed = /.test(l)));
  if (sample) {
    const c2 = await ctxOf(`what calls did we have with ${sample.record.name}`);
    const linkedN = backfilled.filter(c => c.record.id === sample.record.id).length;
    ok(`Scout context "what calls did we have with ${sample.record.name}": ${c2.parts?.[0]?.read} (the log has ${linkedN})`, !c2.cant && c2.parts.some(p => p.read.includes(`about ${sample.record.name}`) && p.read.includes(` ${linkedN} call`)));
  }

  // ── 4. the screen: Calls at 1440, the picker (2 declared writes), Calls at 390
  const measure = async (page, name, sel) => {
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async s => (await window.axe.run(s ? { include: [[s]] } : document, { resultTypes: ['violations'] })).violations.map(x => `${x.id} (${x.nodes.length}) ${x.nodes[0]?.target?.join(' ')}`), sel);
    const n2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(`${name}: axe 0 · N2 0 px`, v.length === 0 && n2 <= 0, v.length || n2 > 0 ? JSON.stringify({ v, n2 }) : '');
  };
  const openCalls = async width => {
    const ctx = await h.context(width);
    const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${h.BASE}/?business=${B}&tab=dashboard&view=calls`);
    await page.waitForSelector('[data-calls-view] [data-call]'); await page.waitForTimeout(800);
    return { ctx, page, errors };
  };
  {
    const { ctx, page, errors } = await openCalls(1440);
    await page.screenshot({ path: path.join(OUT, 'calls-1440.png'), fullPage: true });
    const line = (await page.locator('[data-calls-count]').innerText()).replace(/\s+/g, ' ');
    const rows = await page.locator('tr[data-call]').count();
    ok(`Calls @ 1440: "${line}" · ${rows} rows = raw ${raw.notes} · the Calls sub-tab is selected`, line === `${raw.notes} call${raw.notes === 1 ? '' : 's'} · ${raw.unreviewed} unreviewed · ${raw.noCompany} without a company` && rows === raw.notes);
    await measure(page, 'Calls @ 1440 (the view)', '[data-calls-view]');
    await page.getByRole('button', { name: 'This week', exact: true }).click(); await page.waitForTimeout(900);
    ok(`Calls @ 1440, This week: ${await page.locator('tr[data-call]').count()} rows = raw ${raw.week}`, await page.locator('tr[data-call]').count() === raw.week);
    await page.getByRole('button', { name: 'This week', exact: true }).click(); await page.waitForTimeout(900);

    // the picker: map the Nov 20 Seif note to the declared record
    const row = page.locator(`tr[data-call="${seif.id}"]`);
    await row.scrollIntoViewIfNeeded();
    ok(`the Nov 20 Seif note's row: "${(await row.innerText()).replace(/\s+/g, ' ').slice(0, 90)}" · company —`, (await row.locator('td').nth(4).innerText()).trim() === '—');
    await row.getByRole('button', { name: `Open ${seif.title}`, exact: true }).click();
    await page.waitForSelector(`[data-note-review="${seif.id}"] [data-call-about]`);
    await page.getByRole('button', { name: 'Link for this call', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search what to link for this call' }).fill('Master Magnetics');
    await page.getByRole('option', { name: DECLARED.name, exact: true }).waitFor();
    await page.screenshot({ path: path.join(OUT, 'picker-open-1440.png') });
    const groups = await page.locator('[data-call-about] [role="listbox"] [role="group"]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
    ok(`the picker searches records only: groups ${groups.join(' · ')}`, groups.length >= 1 && groups.every(g => ['Partners', 'Employers', 'Targets'].includes(g)));
    await measure(page, 'the picker, open, in the review drawer @ 1440', '[data-call-about]');
    if (!RO) {
    const put = page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === PUT_PATH);
    await page.getByRole('option', { name: DECLARED.name, exact: true }).click();
    const res = await put;
    await page.getByRole('button', { name: 'Change link for this call', exact: true }).waitFor();
    await page.screenshot({ path: path.join(OUT, 'picker-mapped-1440.png') });
    const mapped = await noteNow(), ev1 = await myEvents();
    ok(`WRITE 1 of 2 - the pick: PUT ${res.status()} · the note is about ${mapped.record_type} ${mapped.record_id === DECLARED.id ? `"${DECLARED.name}"` : mapped.record_id} · Activity line "${ev1[0]?.text}" by Jack ${ev1[0]?.by_user === h.owner.userId} · accepted_at untouched ${mapped.accepted_at === seif.accepted_at}`,
      res.status() === 200 && mapped.record_type === DECLARED.type && mapped.record_id === DECLARED.id && ev1.length === 1 && ev1[0].kind === 'call_link' && ev1[0].record_type === DECLARED.type && ev1[0].record_id === DECLARED.id && ev1[0].by_user === h.owner.userId && ev1[0].meta?.note_id === seif.id && ev1[0].text === `Call linked: ${seif.title} · Nov 20` && mapped.accepted_at === seif.accepted_at);
    await measure(page, 'the picker, mapped, in the review drawer @ 1440', '[data-call-about]');
    const viaLog = await sales(`/calls?company=with`);
    const det = await sales(`/company?type=${DECLARED.type}&id=${DECLARED.id}`);
    ok(`while mapped: the log lists it with the company (${viaLog.body.calls.find(c => c.id === seif.id)?.record?.name}) · the target's window lists the call (${det.body?.calls?.[0]?.title})`, viaLog.body.calls.find(c => c.id === seif.id)?.record?.id === DECLARED.id && det.body.calls.some(c => c.id === seif.id));
    // unmap, in the same picker
    const put2 = page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === PUT_PATH);
    await page.getByRole('button', { name: 'Remove link for this call', exact: true }).click();
    const res2 = await put2;
    await page.getByRole('button', { name: 'Link for this call', exact: true }).waitFor();
    const unmapped = await noteNow(), ev2 = await myEvents();
    ok(`WRITE 2 of 2 - none: PUT ${res2.status()} · the note has no record again (${unmapped.record_type} / ${unmapped.record_id}) · Activity line "${ev2[1]?.text}"`,
      res2.status() === 200 && unmapped.record_type === null && unmapped.record_id === null && ev2.length === 2 && ev2[1].kind === 'call_unlink' && ev2[1].record_id === DECLARED.id && ev2[1].text === `Call unlinked: ${seif.title} · Nov 20`);
    }
    const refused = h.blocked.filter(b => !/^GET/.test(b));
    ok(`the browser wrote nothing else: ${refused.length} other non-GET request(s) refused${refused.length ? ` (${[...new Set(refused)].slice(0, 3).join(', ')})` : ''} · page errors ${errors.length}`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await openCalls(390);
    await page.screenshot({ path: path.join(OUT, 'calls-390.png'), fullPage: true });
    ok(`Calls @ 390: ${await page.locator('li[data-call]').count()} cards = raw ${raw.notes}, no table · page errors ${errors.length}`, await page.locator('li[data-call]').count() === raw.notes && await page.locator('[data-calls-view] table').count() === 0 && errors.length === 0, errors.join(' | '));
    await measure(page, 'Calls @ 390 (the view)', '[data-calls-view]');
    await ctx.close();
  }

  // ── 5. the ONE paid ask
  let ask = ledger.asks.find(a => a.q === 'calls this week') || null;
  let sent = 0;
  if (!ask && !NO_ASK) {
    ledger.asks.push({ q: 'calls this week', at: new Date().toISOString(), pending: true }); fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
    const at = Date.now();
    const r = await call('/api/scout/ask', 'POST', { q: 'calls this week', scope: B });
    sent = 1;
    ask = { q: 'calls this week', at: new Date(at).toISOString(), day: today, status: r.status, elapsed: Math.round((Date.now() - at) / 1000), intent: r.body?.context_stats?.intent || null, reads: r.body?.context_stats?.reads || [], cost: r.body?.usage?.cost_usd ?? null,
      summary: r.body?.summary || '', sections: (r.body?.sections || []).map(s => ({ title: s.title, count: s.count, total: s.total, rows: (s.rows || []).map(x => ({ id: x.id, title: x.title })) })), withheld: !!r.body?.withheld, cant: r.body?.cant?.reason || null };
    ledger.asks[ledger.asks.length - 1] = ask; fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  }
  if (RO) ok('read-only run: no write, no ask', (await myEvents()).length === 0);
  else if (!ask || ask.pending) ok(`ask "calls this week": ${ask?.pending ? 'the ledger holds an unfinished ask - not sent again' : 'not sent (--no-ask) and not in the ledger'}`, false);
  else {
    const sec = ask.sections.find(s => s.title === 'Calls');
    ok(`ask "${ask.q}"${sent ? '' : ' (replayed from the ledger, nothing sent)'}: HTTP ${ask.status} · intent ${ask.intent} · $${ask.cost} · ${ask.elapsed} s · section Calls ${sec?.count}${sec?.total > sec?.count ? ` of ${sec.total}` : ''}${ask.day === today ? ` = raw ${raw.week}` : ` (asked ${ask.day})`}`,
      ask.status === 200 && /(^|\+)calls($|\+)/.test(ask.intent || '') && !ask.withheld && !ask.cant && !!sec && (ask.day !== today || (sec.total ?? sec.count) === raw.week) && !JSON.stringify(ask).includes(AT));
    console.log(`\n--- the answer (titles and counts)\n${ask.summary}\n---\n`);
  }
  ok(`Claude: ${sent} ask sent by this run, ${ledger.asks.length} in the ledger (cap 1)`, ledger.asks.length <= 1 && !(RO && sent));
} catch (e) {
  ok('run', false, e.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  // The note must end with no record whatever happened above.
  const end = await noteNow();
  if (end.record_id === DECLARED.id) { const r = await call(PUT_PATH, 'PUT', { type: null }); console.log(`the note was still mapped - unmapped through the route: HTTP ${r.status}`); }
  const after = await snapshot(), final = await noteNow(), ev = await myEvents();
  await h.close();
  const moved = TABLES.filter(t => before[t] !== after[t]);
  const expected = { sales_flow_events: ev.length, business_anthropic_usage: after.business_anthropic_usage - before.business_anthropic_usage };
  const unexpected = moved.filter(t => !(t in expected) || after[t] - before[t] !== expected[t]);
  const passed = checks.filter(Boolean).length;
  console.log(`after ${JSON.stringify(after)}`);
  console.log(`\n${passed}/${checks.length} checks passed`);
  console.log(`kept by rule: ${ev.length} sales_flow_events row(s) on ${DECLARED.type} "${DECLARED.name}" (${ev.map(e => `${e.kind} ${e.id.slice(0, 8)}`).join(', ') || 'none'}) · business_anthropic_usage +${expected.business_anthropic_usage} (the cost record) · the sign-in row`);
  console.log(`restored: ${final.record_id || final.record_type ? 'NO - the Nov 20 Seif note still has a record' : unexpected.length ? `CHECK - the note is as before, but counts moved on ${unexpected.map(t => `${t} ${before[t]} -> ${after[t]}`).join(', ')} (see who wrote)` : 'yes (the note has no record, as before; every other watched count unchanged)'}`);
  process.exit(passed === checks.length && !final.record_id ? 0 : 1);
}
