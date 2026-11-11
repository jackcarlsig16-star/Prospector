// email-funnel-v1 Stage 1 (rulings R1 / R4) - the declared backfill, HomeLover only.
// Dry run (default): prints the declaration - the weeks, the expected calls (one Apollo page per 100 delivered
//   messages per week from the counts table, + 2 balance reads), the cap - and makes NO call and NO write.
// APPLY=1: (1) sales_email_delivered for the weeks of Oct 26, Nov 2 and Nov 9 through emailCounts.backfillDelivered
//   (the delivered stat alone, the same fetchStat the weekly counts use; credits expected 0, measured by the balance
//   before / after; ctx cap 20 calls - a CallCapError stops it); (2) sales_funnel_days from Oct 20 through today via
//   writeFunnelDays (DB only). Prints calls, credits, rows, first / last day, per-day delivered rows vs the counts
//   table, and the day rows per sides_present. Writes a JSON record under audits/. Ids only - no name or address.
// Usage: node scripts/verify/email-funnel-v1-stage1-backfill.mjs            APPLY=1 node scripts/verify/email-funnel-v1-stage1-backfill.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { laDateString } = await import('../../api/sales/laDate.js');
const { backfillDelivered, weekStartOf, addDays } = await import('../../api/sales/emailCounts.js');
const { apolloBalance } = await import('../../api/sales/apolloClient.js');
const { writeFunnelDays } = await import('../../api/sales/funnelRoutes.js');
const { FUNNEL_SINCE } = await import('../../api/sales/funnelMath.js');

const APPLY = process.env.APPLY === '1';
const CAP = 20;
setTimeout(() => { console.log('CAP: 240 s'); process.exit(1); }, 240000).unref();
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
const today = laDateString();
const weeks = []; for (let w = weekStartOf(FUNNEL_SINCE); w <= today; w = addDays(w, 7)) weeks.push(w);
const counts = await selectAllPages(() => svc.from('sales_email_daily_counts').select('day, delivered').eq('business_id', HL).gte('day', FUNNEL_SINCE).order('day'));
const byDay = new Map(); for (const c of counts) byDay.set(c.day, (byDay.get(c.day) || 0) + c.delivered);
const perWeek = weeks.map(w => ({ week: w, delivered: [...byDay.entries()].filter(([d]) => d >= w && d <= addDays(w, 6)).reduce((n, [, v]) => n + v, 0) }));
const expectedCalls = perWeek.reduce((n, w) => n + Math.floor(w.delivered / 100) + 1, 0) + 2;
const existing = await selectAllPages(() => svc.from('sales_email_delivered').select('apollo_message_id, delivered_day').eq('business_id', HL).order('apollo_message_id'));
console.log(`email-funnel-v1 Stage 1 backfill · HomeLover · today ${today} · ${APPLY ? 'APPLY' : 'DRY RUN'}`);
console.log(`DECLARED: weeks ${perWeek.map(w => `${w.week} (${w.delivered} delivered per the counts table)`).join(', ')} · expected Apollo calls ${expectedCalls} (${expectedCalls - 2} delivered pages + 2 balance reads) · cap ${CAP} · credits expected 0 · writes: sales_email_delivered upserts (${existing.length} rows now) + sales_funnel_days upserts (Oct 20 → today)`);
if (!APPLY) { console.log('dry run - nothing called, nothing written. APPLY=1 to run.'); process.exit(0); }

const ctx = { callCounter: { count: 0, max: CAP }, endpointCounts: {} };
const t0 = Date.now();
const before = await apolloBalance(ctx);
let weeksOut = [], err = null;
try { weeksOut = await backfillDelivered({ ctx, supabase: svc, businessId: HL, weekStarts: weeks }); }
catch (e) { err = String(e.message || e); console.log('STOPPED:', err); }
const after = await apolloBalance(ctx);
for (const w of weeksOut) console.log(`  week ${w.week ?? w.weekStart}: calls ${w.calls} · messages ${w.messages} · rows ${w.rows} · written ${w.written} · complete ${w.complete} · ${w.first_day} → ${w.last_day}`);
const rows = await selectAllPages(() => svc.from('sales_email_delivered').select('apollo_message_id, delivered_day, contact_id, account_id').eq('business_id', HL).order('apollo_message_id'));
const rowsByDay = new Map(); for (const r of rows) rowsByDay.set(r.delivered_day, (rowsByDay.get(r.delivered_day) || 0) + 1);
const days = [...new Set([...byDay.keys(), ...rowsByDay.keys()])].sort();
console.log(`\nper LA day · counts table delivered · delivered rows · gap`);
let gaps = 0;
for (const d of days) { const c = byDay.get(d) || 0, r = rowsByDay.get(d) || 0; if (c !== r) gaps++; console.log(`  ${d} · ${c} · ${r} · ${r - c >= 0 ? '+' : ''}${r - c}`); }
const first = rows.map(r => r.delivered_day).sort()[0] || null, last = rows.map(r => r.delivered_day).sort().pop() || null;
console.log(`TOTAL delivered rows ${rows.length} (${rows.filter(r => r.account_id).length} with an account id, ${new Set(rows.map(r => r.contact_id)).size} contacts) · first day ${first} · last day ${last} · reaches ${FUNNEL_SINCE}: ${first != null && first <= FUNNEL_SINCE} · days with a gap vs the counts table ${gaps}`);
console.log(`Apollo calls ${ctx.callCounter.count} (${JSON.stringify(ctx.endpointCounts)}) · balance ${before} → ${after} · credits ${before != null && after != null ? before - after : 'unknown'} · ${Date.now() - t0} ms`);

const fd = await writeFunnelDays(svc, HL);
console.log(`\nsales_funnel_days: ${JSON.stringify(fd)}`);
const series = await selectAllPages(() => svc.from('sales_funnel_days').select('day, delivered, companies_emailed, companies_visited, people_emailed, people_identified, human_opens, human_clicks, replies, meetings, sides_present, window_days').eq('business_id', HL).order('day'));
for (const r of series) console.log(`  ${r.day} · ${r.sides_present}${r.window_days > 1 ? ` (window ${r.window_days} d)` : ''} · delivered ${r.delivered} · companies ${r.companies_emailed} visited ${r.companies_visited} · people ${r.people_emailed} identified ${r.people_identified} · opens ${r.human_opens} clicks ${r.human_clicks} replies ${r.replies} meetings ${r.meetings}`);
const record = { when: new Date().toISOString(), today, weeks: weeksOut, error: err, calls: ctx.callCounter.count, endpoints: ctx.endpointCounts, balance_before: before, balance_after: after, rows: rows.length, first_day: first, last_day: last, gaps, funnel_days: fd, series };
const outPath = path.join(ROOT, 'audits', `email-funnel-v1-stage1-backfill-apply-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(outPath, JSON.stringify(record, null, 2));
console.log(`record: ${outPath}`);
process.exit(err ? 1 : 0);
