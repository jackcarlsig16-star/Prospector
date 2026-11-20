// data-keys-v1 Stage 2, part 1 - READ-ONLY before / after on prod HomeLover (0 writes - a write throws in the guard;
// 0 Claude; 0 Apollo). "Before" = the code as it was at 80a0e61 (a git worktree, its path = argv[2]) reading today's
// rows through a shim that shows the two K1 columns as they were ('employer' -> 'opportunity' in what it reads and in
// what it filters by); "after" = this checkout. Same rows, same instant - so every difference is a code change or a
// backfilled value, and each one is printed by name.
// Declared: the score inputs (gatherInputs, no write), Top targets (Mine), the funnel (30 d) and People (all time),
// each run twice. ~150 requests, ~15 s; cap 120 s. Prints company names, counts and member first names only.
// Usage: node scripts/verify/data-keys-v1-stage2-compare.mjs <path to a worktree at 80a0e61>
import { createRequire } from 'module';
import path from 'path';
import { svc, HL, cap, footer, ROOT } from './homelover-data-model-v1-lib.mjs';
cap(120);
const OLD = process.argv[2];
if (!OLD) { console.log('usage: node scripts/verify/data-keys-v1-stage2-compare.mjs <worktree at 80a0e61>'); process.exit(1); }
const require = createRequire(ROOT + '/package.json');
const { createClient } = require('@supabase/supabase-js');
// The pre-stage view of the two columns. The global fetch is the guard (GET / HEAD to Supabase only).
const asBefore = async (input, init = {}) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  for (const k of ['matched_type', 'link_type']) if (u.searchParams.has(k)) u.searchParams.set(k, u.searchParams.get(k).replace(/\bopportunity\b/g, 'employer'));
  const url = u.toString();
  const res = await fetch(url, init);
  if (!/\/rest\/v1\/(web_visits|sales_week_goals)\b/.test(url)) return res;
  const text = (await res.text()).replace(/"(matched_type|link_type)":"employer"/g, '"$1":"opportunity"');
  const headers = new Headers(res.headers); headers.delete('content-length'); headers.delete('content-encoding');
  return new Response(res.status === 204 ? null : text, { status: res.status, statusText: res.statusText, headers });
};
const before = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, global: { fetch: asBefore } });
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const load = async rel => ({ old: await import(path.join(OLD, rel)), cur: await import(path.join(ROOT, rel)) });
const now = Date.now();
const me = (await svc.from('profiles').select('id').eq('is_platform_owner', true)).data[0].id;
let unexplained = 0;
const line = (ok, text) => { if (!ok) unexplained += 1; console.log(`  ${ok ? 'same' : 'DIFF'} ${text}`); };

console.log('1. The Map: score inputs and scores, computed fresh by both (nothing stored)');
const run = await load('api/sales/intentScoreRun.js');
const scored = async (m, client) => {
  const { inputs, weights, settings } = await m.gatherInputs(client, HL, { now });
  return new Map(inputs.map(i => { const r = m.scoreRow(i, weights, { businessId: HL, now, fitSettings: settings?.fit_settings || null }); return [`${i.type}:${i.id}`, { name: i.name, type: i.type, score: r.score, band: r.band, dup: !!r.duplicate_of, closed: !!r.closed, visits: i.visit?.visits_7d ?? null }]; }));
};
const [a, b] = [await scored(run.old, before), await scored(run.cur, svc)];
const tally = m => { const t = {}; for (const r of m.values()) { t[r.type] = (t[r.type] || 0) + 1; } return Object.entries(t).sort().map(([k, n]) => `${k} ${n}`).join(' · '); };
const bands = m => ['P1', 'P2', 'P3', 'P4'].map(k => `${k} ${[...m.values()].filter(r => r.band === k && !r.dup).length}`).join(' · ');
console.log(`  before: ${a.size} companies (${tally(a)}) · ${bands(a)} · duplicates ${[...a.values()].filter(r => r.dup).length}`);
console.log(`  after:  ${b.size} companies (${tally(b)}) · ${bands(b)} · duplicates ${[...b.values()].filter(r => r.dup).length}`);
const changed = [...new Set([...a.keys(), ...b.keys()])].filter(k => JSON.stringify(a.get(k) || null) !== JSON.stringify(b.get(k) || null));
for (const k of changed) { const x = a.get(k), y = b.get(k); console.log(`    ${(x || y).name} (${(x || y).type}): ${x ? `${x.score} ${x.band}${x.dup ? ' dup' : ''} visits ${x.visits}` : 'absent'} -> ${y ? `${y.score} ${y.band}${y.dup ? ' dup' : ''} visits ${y.visits}` : 'absent'}`); }
line(!changed.length, `${changed.length} of ${b.size} companies differ`);

console.log('\n2. Top targets, Mine (stored scores; the Next to-do is joined by the link type)');
const tt = await load('api/sales/topTargets.js');
const top = async (m, client) => (await m.topTargets(client, HL, { owner: 'me', limit: '50' }, { now, meId: me })).body;
const [ta, tb] = [await top(tt.old, before), await top(tt.cur, svc)];
const sig = r => `${r.rank}|${r.type}:${r.id}|${r.score}|${(r.todo || r.next)?.text || ''}`;
const topDiff = (tb.rows || []).filter((r, i) => sig(r) !== sig((ta.rows || [])[i] || {}));
console.log(`  before: ${ta.rows?.length} rows of ${ta.total} · with a Next to-do ${ta.rows?.filter(r => r.todo || r.next).length}   after: ${tb.rows?.length} rows of ${tb.total} · with a Next to-do ${tb.rows?.filter(r => r.todo || r.next).length}`);
for (const r of topDiff.slice(0, 10)) console.log(`    #${r.rank} ${r.name}`);
line(!topDiff.length && ta.rows?.length === tb.rows?.length, `order, scores and Next to-dos: ${topDiff.length} rows differ`);

console.log('\n3. The funnel, last 30 days');
const fr = await load('api/sales/funnelRoutes.js');
const fun = async (m, client) => (await m.loadFunnel(client, HL, { windows: ['30d'], now })).body.windows['30d'];
const [fa, fb] = [await fun(fr.old, before), await fun(fr.cur, svc)];
const f = w => `company rate ${w.company_rate.n} of ${w.company_rate.d} · person rate ${w.person_rate.n} of ${w.person_rate.d} · without a record ${w.companies_no_record} · unresolved ${w.companies_unresolved}`;
console.log(`  before: ${f(fa)}\n  after:  ${f(fb)} · matched by name ${fb.companies_by_name} of ${fb.companies_emailed}`);
const visitedDiff = [...new Set([...fa.companies_visited_names, ...fb.companies_visited_names])].filter(n => fa.companies_visited_names.includes(n) !== fb.companies_visited_names.includes(n));
for (const n of visitedDiff) console.log(`    ${n}: ${fa.companies_visited_names.includes(n) ? 'visited before only' : 'visited after only'}`);
line(f(fa) === f(fb) && !visitedDiff.length, 'the 30-day rates and the visited companies');

console.log('\n4. People, all time');
const pr = await load('api/sales/peopleActivityRoutes.js');
const ppl = async (m, client) => (await m.peopleActivity(client, HL, { window: 'all', now })).body;
const [pa, pb] = [await ppl(pr.old, before), await ppl(pr.cur, svc)];
const p = x => `rows ${x.n} of ${x.total} · ${Object.entries(x.counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`;
console.log(`  before: ${p(pa)}\n  after:  ${p(pb)}`);
const visitOf = x => new Map(x.rows.map(r => [r.key, `${r.company?.type || ''}:${r.company?.id || ''}|${r.visits?.visits_7d ?? ''}|${r.visits?.seen_to || ''}`]));
const [va, vb] = [visitOf(pa), visitOf(pb)];
const pdiff = [...vb.keys()].filter(k => va.get(k) !== vb.get(k));
for (const k of pdiff.slice(0, 10)) { const r = pb.rows.find(x => x.key === k); console.log(`    a person at ${r.company?.name || 'no company'}: ${va.get(k)} -> ${vb.get(k)}`); }
line(p(pa) === p(pb) && !pdiff.length, `counts and each person's company + visits: ${pdiff.length} people differ`);

console.log('\n5. Across the migration: the scores stored on disk (last full compute) against a fresh compute now');
const stored = await selectAllPages(() => svc.from('sales_company_scores').select('company_type, company_id, score, band, computed_at').eq('business_id', HL).order('company_id'));
const at = stored.map(r => r.computed_at).filter(Boolean).sort();
console.log(`  stored rows ${stored.length} · computed ${at[0]?.slice(0, 16)} … ${at[at.length - 1]?.slice(0, 16)} UTC (the first migration ran the evening of Nov 19 PT = Nov 20 UTC)`);
const moved = stored.filter(r => { const y = b.get(`${r.company_type}:${r.company_id}`); return y && (y.score !== r.score || y.band !== r.band); });
const gone = stored.filter(r => !b.has(`${r.company_type}:${r.company_id}`)), fresh = [...b.keys()].filter(k => !stored.some(r => `${r.company_type}:${r.company_id}` === k));
for (const r of moved.slice(0, 25)) { const y = b.get(`${r.company_type}:${r.company_id}`); console.log(`    ${y.name} (${y.type}): stored ${r.score} ${r.band} (${r.computed_at.slice(0, 16)}) -> now ${y.score} ${y.band} · visits ${y.visits}`); }
console.log(`  ${moved.length} scores moved · ${gone.length} stored rows with no company now · ${fresh.length} companies with no stored row`);

console.log(`\n${unexplained ? `${unexplained} section(s) differ - each row above needs a named cause` : 'no difference between the code before and after on today\'s rows'}`);
footer();
