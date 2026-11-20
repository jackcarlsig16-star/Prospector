// FIX touch-truth Stage 0 - READ-ONLY (0 writes, 0 Claude, 0 Apollo). HomeLover only.
// Declared scope: one paged read each of the funnel's 13 tables (loadFunnelRows), sales_company_scores, web_visits
// (id, us_500, flags), sales_visit_skip, sales_week_goals (done to-dos), the three event tables; then the visitor email's
// own loader (loadVisitorData) once per weekday send date of the last 30 days (<= 22 runs, each ~6 reads + <= 20 small
// last-touch reads). Estimated 60 s; hard cap 240 s. Prints company names, first names and counts only.
// Usage: node scripts/verify/touch-truth-stage0.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { normName } = await import('../../api/sales/normName.js');
const { loadFunnelRows } = await import('../../api/sales/funnelRoutes.js');
const { funnelContext } = await import('../../api/sales/funnelMath.js');
const { lastTouchFor } = await import('../../api/sales/companyPanel.js');
const { loadVisitorData, dayWindowFor, rankVisitors, qualifies, TOP_N } = await import('../../api/sales/teamEmails/visitorEmail.js');
const { recordDecision } = await import('../../api/sales/visitorRecords.js');
const { laDateString } = await import('../../api/sales/laDate.js');

const t0 = Date.now();
setTimeout(() => { console.log('CAP: 240 s'); process.exit(1); }, 240000).unref();
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
const all = (table, cols, build = q => q, order = 'id') => selectAllPages(() => build(svc.from(table).select(cols).eq('business_id', HL)).order(order));
const day = iso => (iso ? laDateString(new Date(iso)) : '—');

const [rows, scores, visits, skipRows, todos, oppEvents, partnerEvents, flowEvents, settings, memberRows] = await Promise.all([
  loadFunnelRows(svc, HL),
  all('sales_company_scores', 'company_type, company_id, score, band, closed, flagged_out, duplicate_of, components', q => q, 'company_id'),
  all('web_visits', 'id, company_key, company_name, us_500, maybe_user, noise_reason, matched_type, matched_id, visits_7d, unique_visitors_7d, pulled_on'),
  all('sales_visit_skip', 'company_key'),
  all('sales_week_goals', 'id, kind, status, link_type, link_id, completed_at, source_note_id'),
  all('sales_opportunity_events', 'opportunity_id, event_type, changed_at'),
  all('sales_partner_events', 'goal_id, event, touch_type, at'),
  all('sales_flow_events', 'record_type, record_id, kind, at'),
  svc.from('sales_settings').select('buyer_titles, auto_create_daily_cap').eq('business_id', HL).maybeSingle().then(r => r.data || {}),
  svc.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', HL).not('user_id', 'is', null).then(r => r.data || []),
]);
const ctx = funnelContext(rows);
console.log(`rows read: delivered ${rows.delivered.length} · messages ${rows.messages.length} · activity ${rows.events.length} · prospects ${rows.prospects.length} · employers ${rows.opportunities.length} · targets ${rows.targets.length} · partners ${rows.partners.length} · scores ${scores.length} · web_visits ${visits.length} · done to-dos ${todos.filter(t => t.kind === 'todo' && t.status === 'done').length}`);
const joined = { id: 0, name: 0, none: 0, no_record: 0 };
for (const d of ctx.delivered) { if (!d.company) joined.none++; else { joined[d.company.matched_by]++; if (!d.company.id) joined.no_record++; } }
console.log(`K3 join over delivered: by id ${joined.id} · by name ${joined.name} (of which no record ${joined.no_record}) · unresolved ${joined.none}`);

console.log('\n(b) the three companies - raw');
const records = [
  ...rows.opportunities.map(o => ({ type: 'employer', id: o.id, name: o.organization })),
  ...rows.targets.map(t => ({ type: 'target', id: t.id, name: t.name })),
  ...rows.partners.map(g => ({ type: 'partner', id: g.id, name: g.name })),
];
const scoreOf = new Map(scores.map(s => [`${s.company_type}:${s.company_id}`, s]));
for (const needle of ['hilton', 'bass pro', 'jack morton']) {
  const recs = records.filter(r => normName(r.name).includes(needle));
  const mail = ctx.delivered.filter(d => d.company && normName(d.company.name).includes(needle));
  const last = mail.map(d => d.delivered_at).sort().pop();
  const vis = visits.filter(v => normName(v.company_name || v.company_key).includes(needle));
  console.log(`\n"${needle}": records ${recs.length ? recs.map(r => `${r.name} [${r.type}]`).join(' · ') : 'NONE'}`);
  console.log(`  Apollo delivered ${mail.length}${mail.length ? ` · last ${day(last)} · people emailed ${new Set(mail.map(d => d.contact_id)).size} · joined ${[...new Set(mail.map(d => `${d.company.matched_by}${d.company.id ? '' : ' (no record)'}`))].join(', ')}` : ''}`);
  console.log(`  human opens ${mail.filter(d => ctx.humanOpen.has(d.apollo_message_id)).length} · human clicks ${mail.filter(d => ctx.humanClick.has(d.apollo_message_id)).length} · replies ${mail.filter(d => ctx.replied.has(d.apollo_message_id)).length} (messages with one)`);
  console.log(`  web_visits rows ${vis.length}${vis.length ? ` · latest pull ${vis.map(v => v.pulled_on).sort().pop()} · matched ${[...new Set(vis.map(v => v.matched_type || 'none'))].join(', ')} · us_500 ${vis.some(v => v.us_500)}` : ''}`);
  for (const r of recs) {
    const done = todos.filter(t => t.kind === 'todo' && t.status === 'done' && t.link_type === r.type && String(t.link_id) === String(r.id)).length;
    const open = todos.filter(t => t.kind === 'todo' && t.status !== 'done' && t.link_type === r.type && String(t.link_id) === String(r.id));
    const ev = r.type === 'employer' ? oppEvents.filter(e => e.opportunity_id === r.id && e.event_type === 'stage_change').length : r.type === 'partner' ? partnerEvents.filter(e => e.goal_id === r.id).length : 0;
    const flow = flowEvents.filter(e => e.record_type === r.type && String(e.record_id) === String(r.id)).length;
    const meta = scoreOf.get(`${r.type}:${r.id}`)?.components?.meta || {};
    const lt = await lastTouchFor(svc, HL, { type: r.type, id: r.id, last_touch_at: meta.last_touch_at || null });
    console.log(`  ${r.name} [${r.type}]: done to-dos ${done} · open to-dos ${open.length} (from a call ${open.filter(t => t.source_note_id).length}) · ${r.type === 'employer' ? 'stage moves' : 'partner events'} ${ev} · flow events ${flow}`);
    console.log(`    today: lastTouchFor -> ${lt ? `${day(lt.at)} ${lt.touch_type || ''}` : 'null ("No touch yet")'} · scores meta last touch ${meta.last_touch_at ? `${day(meta.last_touch_at)} ${meta.last_touch_channel || ''}` : 'none'}`);
  }
}

console.log('\n(c) T4 sizing - "Not in Prospector" companies in the emails of the last 30 days');
const members = memberRows.map(m => ({ userId: m.user_id, firstName: String(m.profile?.display_name || m.name || '').split(' ')[0] }));
const visitById = new Map(visits.map(v => [v.id, v]));
const skip = new Set(skipRows.map(s => s.company_key));
const buyerTitles = settings.buyer_titles || [];
const today = laDateString(new Date());
const seen = new Map();
const perDay = [];
for (let i = 29; i >= 0; i--) {
  const date = new Date(Date.parse(`${today}T12:00:00Z`) - i * 864e5).toISOString().slice(0, 10);
  if ([0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay())) continue;
  const w = dayWindowFor(date);
  const companies = await loadVisitorData(svc, HL, { window: w, members });
  const ranked = rankVisitors(companies);
  const printed = new Set([...ranked.filter(c => c.is_new).slice(0, TOP_N), ...ranked.filter(qualifies).slice(0, TOP_N)]);
  let dayA = 0, dayTop = 0, dayAny = 0;
  for (const c of ranked.filter(x => !x.type)) {
    const v = visitById.get(c.visit_id) || {};
    const blocked = skip.has(v.company_key) ? 'skip list' : v.noise_reason ? 'noise' : v.maybe_user ? 'maybe a user' : null;
    const a = !blocked && recordDecision({}, c.buyers ? [{ title: buyerTitles[0] }] : [], { buyerTitles, visit: v }).action === 'create';
    const top = !blocked && printed.has(c);
    if (a) dayA++; if (top) dayTop++; if (a || top) dayAny++;
    const key = normName(c.company);
    const cur = seen.get(key) || { name: c.company, a: false, top: false, blocked, days: 0, visits: 0 };
    cur.a = cur.a || a; cur.top = cur.top || top; cur.days++; cur.visits = Math.max(cur.visits, c.visits || 0);
    seen.set(key, cur);
  }
  perDay.push({ date, visited: ranked.length, not_in: ranked.filter(x => !x.type).length, a: dayA, top: dayTop, any: dayAny });
}
const list = [...seen.values()];
const both = list.filter(c => c.a && c.top), onlyA = list.filter(c => c.a && !c.top), onlyTop = list.filter(c => !c.a && c.top), neither = list.filter(c => !c.a && !c.top);
console.log(`send days read: ${perDay.length} · distinct companies not in Prospector: ${list.length}`);
console.log(`  meet the A-list rule (US 500+ or a buyer-title visitor): ${both.length + onlyA.length}`);
console.log(`  printed in a top-${TOP_N} list of the email (New / Worth a look): ${both.length + onlyTop.length}`);
console.log(`  both ${both.length} · A-list only ${onlyA.length} · top-${TOP_N} only ${onlyTop.length} · neither ${neither.length} (of which blocked: ${list.filter(c => c.blocked).length} skip list / noise / maybe a user)`);
console.log(`  would have been auto-added (either rule): ${list.length - neither.length} over 30 days · busiest day ${Math.max(0, ...perDay.map(d => d.any))} · current auto_create_daily_cap ${settings.auto_create_daily_cap ?? '25 (default)'}`);
console.log('  per send day (visited / not in Prospector / A-list / top-10 / either):');
for (const d of perDay) console.log(`    ${d.date}  ${d.visited} / ${d.not_in} / ${d.a} / ${d.top} / ${d.any}`);
console.log(`  names, either rule: ${[...both, ...onlyA, ...onlyTop].map(c => `${c.name}${c.a && c.top ? '' : c.a ? ' (A)' : ' (top)'}`).sort().join(' · ') || 'none'}`);
const book = scores.filter(s => !s.flagged_out && !s.duplicate_of && !s.closed && s.components?.meta?.fit?.level !== 'deprioritized').sort((a, b) => b.score - a.score).slice(0, TOP_N);
console.log(`  whole-book top ${TOP_N} today (records by construction): ${book.map(s => `${s.components?.meta?.name} [${s.company_type}]`).join(' · ')}`);
console.log(`\nrestored: yes (read-only) · ${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(0);
