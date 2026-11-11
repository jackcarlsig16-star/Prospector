// AUDIT homelover-data-model-v1 Part B - READ-ONLY, in process (no HTTP route, no model call). Declared: 14 asks x 3
// runs of buildContext + 8 read pairs x 3 runs; each run is the route's own reads (~10-40 selects); ~2,500 requests,
// ~40 MB read from prod, ~4 min; cap 420 s. 0 writes (a write throws in the guard and is reported), 0 Claude, 0 Apollo.
import fs from 'fs';
import { svc, HL, cap, footer, net, median3, ROOT } from './homelover-data-model-v1-lib.mjs';
cap(420); net.trace = true;
const { createRegistry } = await import('../../api/scout/registry.js');
const { buildContext } = await import('../../api/scout/retrieve.js');
const sales = await import('../../api/sales/scoutEntities.js');
const { salesReads, salesStanding } = await import('../../api/sales/scoutIntents.js');
const { SYSTEM } = await import('../../api/scout/ask.js');
const reg = createRegistry(); await sales.register(reg);
const members = (await svc.from('business_members').select('user_id, name, role').eq('business_id', HL).not('user_id', 'is', null)).data;
const jack = members.find(m => /jack/i.test(m.name || '')) || members.find(m => m.role === 'owner');
const auth = { user: { id: jack.user_id }, roles: new Map([[HL, jack.role]]), isPlatformOwner: false };
const out = { asks: [], pairs: [] };
const slice = async fn => { const i = net.log.length; const t = performance.now(); let r, err = null; try { r = await fn(); } catch (e) { err = e.message; } const log = net.log.slice(i); const by = {}; for (const l of log) { const k = l.table.split('?')[0]; by[k] = by[k] || { n: 0, rows: 0, bytes: 0 }; by[k].n += 1; by[k].rows += l.rows; by[k].bytes += l.bytes; } return { r, err, ms: Math.round(performance.now() - t), requests: log.length, rows: log.reduce((n, l) => n + l.rows, 0), bytes: log.reduce((n, l) => n + l.bytes, 0), by }; };
const med = a => [...a].sort((x, y) => x - y)[1];
const ASKS = [
  ['brief', 'what do we know about Hilton'], ['todos', 'show me my open tasks'], ['visitors', 'who visited yesterday'],
  ['ranked', 'hot targets Brad referred'], ['ranked (all)', 'top companies by score'], ['people_visiting', 'hottest people on the site this week'],
  ['people', 'who opened our emails'], ['email_site', "what's our email to site rate"], ['emails', 'how are our emails doing this month'],
  ['funnel', 'show me the referral funnel'], ['attention', 'what needs attention'], ['clients', 'list our clients'], ['notes', 'notes about Hilton'],
  ['none (standing)', 'what should I focus on'],
  ['NOV 10 ASK', 'pull me 5 most important prospects who are visiting and hot and show 5 most important tasks'],
];
console.log(`Part B · HomeLover · as ${jack.role} · PACK_MAX 12000 · system prompt ${SYSTEM.length} chars`);
console.log('\nB1/B2 - buildContext per ask (median of 3; rows = rows fetched from the DB in one run -> lines in the pack)');
for (const [want, q] of ASKS) {
  const runs = []; for (let i = 0; i < 3; i++) runs.push(await slice(() => buildContext(svc, reg, { auth, scope: HL, q })));
  const last = runs[2]; const s = last.r?.stats;
  const top = Object.entries(last.by).sort((a, b) => b[1].rows - a[1].rows).slice(0, 6).map(([k, v]) => `${k} ${v.rows}r/${v.n}q`).join(', ');
  const rec = { want, q, intent: s?.intent, ms: med(runs.map(r => r.ms)), all_ms: runs.map(r => r.ms), requests: last.requests, rows_fetched: last.rows, kb: Math.round(last.bytes / 1024), lines: s?.lines, chars: s?.chars, dropped_pii: s?.dropped_pii, truncated: s?.truncated, rows_by_entity: s?.rows_by_entity, reads: s?.reads, glossary_chars: (last.r?.glossary || []).join('\n').length, by: last.by, err: last.err, ask: last.r?.ask && { entity: last.r.ask.entity, band: last.r.ask.band, bandKind: last.r.ask.bandKind, flags: Object.entries(last.r.ask.flags).filter(([, v]) => v).map(([k]) => k), company: last.r.ask.company, terms: last.r.ask.terms } };
  out.asks.push(rec);
  console.log(`\n[${want}] "${q}"\n  intent ${rec.intent} · ${rec.ms} ms (${rec.all_ms.join(' / ')}) · ${rec.requests} requests · ${rec.rows_fetched} rows fetched · ${rec.kb} KB -> ${rec.lines} lines · ${rec.chars} chars · dropped pii ${rec.dropped_pii} · cut by cap ${rec.truncated}${rec.err ? ' · ERROR ' + rec.err : ''}\n  reads: ${(rec.reads || []).join(' | ')}\n  by entity: ${JSON.stringify(rec.rows_by_entity)} · glossary ${rec.glossary_chars} chars\n  tables: ${top}`);
  if (want === 'NOV 10 ASK') { out.nov10_pack_head = last.r.lines.slice(0, 3).map(l => l.slice(0, 160)); console.log('  parsed: ' + JSON.stringify(rec.ask)); }
}
// the glossary alone (runs before every ask)
const g = []; for (let i = 0; i < 3; i++) g.push(await slice(() => sales.glossary(svc, { businessId: HL })));
out.glossary = { ms: med(g.map(r => r.ms)), requests: g[2].requests, rows: g[2].rows };
console.log(`\nglossary alone: ${out.glossary.ms} ms · ${out.glossary.requests} requests · ${out.glossary.rows} rows (runs on every ask)`);

// B3 - the existing read vs the summary-shaped query (what a materialised read would cost). Median of 3 each.
const now = Date.now();
const { laDateString } = await import('../../api/sales/laDate.js');
const { addDays } = await import('../../api/sales/goalsShared.js');
const today = laDateString(new Date(now)), yday = addDays(today, -1);
const hilton = (await svc.from('sales_opportunities').select('id').eq('business_id', HL).ilike('organization', '%hilton%').limit(1)).data?.[0] || (await svc.from('sales_targets').select('id').eq('business_id', HL).limit(1)).data?.[0];
const PAIRS = [
  ['people + company + visits + heat (people / people_visiting)', () => salesReads.peopleActivity(svc, HL, { window: '7' }), () => svc.from('sales_person_activity').select('person_key, heat, heat_band, sent, opened_h, clicked, replied, last_signal_at').eq('business_id', HL).order('heat', { ascending: false }).limit(25)],
  ['to-dos + steps + owner (todos)', () => salesReads.openTodosFor(svc, HL, jack.user_id, { cap: 60 }), () => svc.from('sales_week_goals').select('id, text, due_date, owner_user_id, link_type, link_id, status').eq('business_id', HL).eq('kind', 'todo').neq('status', 'done').eq('owner_user_id', jack.user_id).order('due_date', { ascending: true, nullsFirst: false }).limit(60)],
  ['ranked companies (ranked + standing)', () => salesReads.listScores(svc, HL, {}, { now }), () => svc.from('sales_company_scores').select('company_type, company_id, score, band, source_label, computed_at').eq('business_id', HL).order('score', { ascending: false }).limit(40)],
  ['visitors yesterday (visitors)', async () => salesReads.loadVisitorData(svc, HL, { window: { date: today, days: [yday], first: yday, last: yday }, members: members.map(m => ({ userId: m.user_id, firstName: (m.name || 'Member').split(' ')[0] })) }), () => svc.from('web_visits').select('id, company_name, matched_type, matched_id, visits_7d, unique_visitors_7d, priority, seen_from, seen_to').eq('business_id', HL).lte('seen_from', yday).gte('seen_to', yday).limit(60)],
  ['company brief (brief)', () => salesReads.companyBrief(svc, { businessId: HL, type: 'employer', id: hilton.id }), () => svc.from('sales_company_scores').select('score, band, components').eq('business_id', HL).eq('company_id', hilton.id).limit(1)],
  ['standing context (every unmatched ask)', () => salesStanding(svc, { businessId: HL, auth, today, now }), () => svc.from('sales_week_goals').select('id, text, due_date').eq('business_id', HL).eq('kind', 'todo').neq('status', 'done').eq('owner_user_id', jack.user_id).limit(30)],
  ['email -> site funnel (email_site)', () => salesReads.loadFunnel(svc, HL, { windows: ['yesterday', '7d', '30d'], now }), () => svc.from('sales_funnel_days').select('*').eq('business_id', HL).order('day', { ascending: false }).limit(30)],
  ['needs attention (attention)', () => salesReads.attention(svc, { businessId: HL, userId: jack.user_id, now }), null],
  ['pulse month (emails)', () => salesReads.loadPulse(svc, HL, { period: 'month' }, new Date(now)), () => svc.from('sales_email_daily_counts').select('day, delivered, opened, clicked, replied').eq('business_id', HL).gte('day', `${today.slice(0, 7)}-01`)],
  ['referral funnel (funnel)', () => salesReads.sourcesFunnel(svc, { businessId: HL, query: {}, now }), null],
  ['clients (clients)', () => salesReads.listClients(svc, { businessId: HL }), () => svc.from('sales_opportunities').select('id, organization, client_status, covered_lives, expected_launch, owner').eq('business_id', HL).not('client_status', 'is', null).is('archived_at', null)],
];
console.log('\nB3 - existing read vs summary-shaped query (median of 3)');
for (const [name, a, b] of PAIRS) {
  const ra = []; for (let i = 0; i < 3; i++) ra.push(await slice(a));
  const rb = []; if (b) for (let i = 0; i < 3; i++) rb.push(await slice(b));
  const rec = { name, read_ms: med(ra.map(r => r.ms)), read_requests: ra[2].requests, read_rows: ra[2].rows, read_kb: Math.round(ra[2].bytes / 1024), err: ra[2].err, by: ra[2].by, summary_ms: b ? med(rb.map(r => r.ms)) : null, summary_rows: b ? rb[2].rows : null, summary_err: b ? (rb[2].err || rb[2].r?.error?.message || null) : null };
  rec.saving_ms = b ? rec.read_ms - rec.summary_ms : null;
  out.pairs.push(rec);
  console.log(`${name}\n  read ${rec.read_ms} ms · ${rec.read_requests} requests · ${rec.read_rows} rows · ${rec.read_kb} KB${rec.err ? ' · ERROR ' + rec.err : ''}${b ? `  |  summary-shaped ${rec.summary_ms} ms · 1 request · ${rec.summary_rows} rows${rec.summary_err ? ' ERR ' + rec.summary_err : ''}  |  saving ${rec.saving_ms} ms (${Math.round(100 * rec.saving_ms / rec.read_ms)} %)` : ''}\n  tables: ${Object.entries(rec.by).sort((x, y) => y[1].rows - x[1].rows).slice(0, 8).map(([k, v]) => `${k} ${v.rows}r/${v.n}q`).join(', ')}`);
}
// B2 - the recorded usage rows for scout asks on Nov 10 LA (tokens and cost as logged by the real calls)
const usage = (await svc.from('business_anthropic_usage').select('created_at, input_tokens, output_tokens, cost_usd, model').eq('business_id', HL).eq('call_type', 'scout_ask').gte('created_at', '2026-11-10T08:00:00Z').order('created_at')).data;
out.usage = usage;
console.log('\nB2 - scout_ask usage rows since Nov 10 00:00 PT:'); for (const u of usage) console.log(`  ${u.created_at} · in ${u.input_tokens} · out ${u.output_tokens} · $${u.cost_usd} · ${u.model}`);
const allAsk = (await svc.from('business_anthropic_usage').select('input_tokens, output_tokens, cost_usd', { count: 'exact' }).eq('business_id', HL).eq('call_type', 'scout_ask')).data;
console.log(`  all scout_ask rows: ${allAsk.length} · median in ${med3(allAsk.map(u => u.input_tokens))} · median out ${med3(allAsk.map(u => u.output_tokens))} · total $${allAsk.reduce((n, u) => n + Number(u.cost_usd || 0), 0).toFixed(4)}`);
function med3(a) { const s = a.filter(x => x != null).sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
fs.writeFileSync(ROOT + '/scripts/verify/_hdm/scout.json', JSON.stringify(out, null, 1));
footer();
