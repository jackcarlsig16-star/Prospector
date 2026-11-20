// data-keys-v1 Stage 1 - READ-ONLY check of the post-"ran" code on prod HomeLover (0 writes - a write throws in the
// guard; 0 Claude; 0 Apollo). Declared: one paged read each of web_visits (type + id), sales_week_goals (link type),
// sales_targets, sales_opportunities (ids, names, owner id), sales_goals + partner_domains; then three readers run in
// process - Top targets, the funnel (30 d) and one company window (a promoted target). ~70 requests, ~25 s; cap 120 s.
// Prints counts and company names only.
// Usage: node scripts/verify/data-keys-v1-stage1-read.mjs
import { svc, HL, cap, footer } from './homelover-data-model-v1-lib.mjs';
cap(120);
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { topTargets } = await import('../../api/sales/topTargets.js');
const { loadFunnel } = await import('../../api/sales/funnelRoutes.js');
const { companyDetail } = await import('../../api/sales/companyPanel.js');
const { visitIndex } = await import('../../api/sales/visitJoin.js');
const { aliasCount } = await import('../../api/sales/readType.js');
const all = (table, cols, build = x => x, order = 'id') => selectAllPages(() => build(svc.from(table).select(cols).eq('business_id', HL)).order(order));
const tally = (rows, f) => { const m = {}; for (const r of rows) { const k = String(f(r)); m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort().map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'; };
let bad = 0;
const check = (ok, text) => { if (!ok) bad += 1; console.log(`  ${ok ? 'ok ' : 'BAD'} ${text}`); };

const [visits, todos, targets, opps, goals, pdomains] = await Promise.all([
  all('web_visits', 'id, company_key, company_name, matched_type, matched_id, pulled_on'),
  all('sales_week_goals', 'id, kind, status, link_type, link_id'),
  all('sales_targets', 'id, name, status, employer_id, promoted_goal_id, apollo_account_id'),
  all('sales_opportunities', 'id, organization, owner, owner_user_id, apollo_account_id, archived_at'),
  all('sales_goals', 'id, name, company_domain', x => x.eq('goal_type', 'partnership')),
  all('partner_domains', 'id, goal_id, domain, confirmed, is_primary, updated_at'),
]);
console.log('K1 the word on disk since "ran" (a row written by the old code in the window would still say opportunity)');
console.log(`  web_visits.matched_type: ${tally(visits, v => v.matched_type)}`);
console.log(`  sales_week_goals.link_type: ${tally(todos, t => t.link_type)}`);
check(!visits.some(v => v.matched_type === 'opportunity') && !todos.some(t => t.link_type === 'opportunity'), 'no row says opportunity');
const oppById = new Map(opps.map(o => [o.id, o]));
const empVisits = visits.filter(v => v.matched_type === 'employer'), empTodos = todos.filter(t => t.link_type === 'employer');
check(empVisits.every(v => oppById.has(v.matched_id)), `${empVisits.length} employer visit rows all point at an employer row`);
check(empTodos.every(t => oppById.has(t.link_id)), `${empTodos.length} employer to-do links all point at an employer row`);
const find = visitIndex(visits);
const byId = opps.filter(o => !o.archived_at && find({ type: 'employer', id: o.id, name: '' })).length;
console.log(`  employers whose latest visit row is found by id (no name used): ${byId}`);
check(byId > 0, 'the visit join reads the employer rows by id');

console.log('\nK2 promoted targets');
const linked = targets.filter(t => t.employer_id);
check(linked.length === 17 && linked.every(t => oppById.has(t.employer_id) && t.status === 'accepted'), `${linked.length} targets carry employer_id, each accepted and pointing at an employer row`);
const cloud = linked.find(t => /cloudflare/i.test(t.name));
if (cloud) { const w = await companyDetail(svc, { businessId: HL, type: 'target', id: cloud.id }); check(w.status === 200 && w.body.record.promoted_to?.type === 'employer', `window of the target ${cloud.name}: promoted → ${w.body.record?.promoted_to?.name}`); }

console.log('\nK3 the funnel, 30 days');
const f = await loadFunnel(svc, HL, { windows: ['30d'] });
const w30 = f.body?.windows?.['30d'];
check(f.status === 200 && w30 && w30.companies_by_name != null, `company rate ${w30 ? `${w30.company_rate.n} of ${w30.company_rate.d}` : '—'} · ${w30?.companies_by_name} of ${w30?.companies_emailed} companies matched by name · ${w30?.companies_no_record} without a record`);
console.log(`  apollo_account_id on employers ${opps.filter(o => o.apollo_account_id).length} · on targets ${targets.filter(t => t.apollo_account_id).length}`);

console.log('\nK7 partner domain = the confirmed row, primary first');
const conf = pdomains.filter(d => d.confirmed).sort((a, b) => (b.is_primary - a.is_primary) || String(a.updated_at).localeCompare(String(b.updated_at)) || String(a.id).localeCompare(String(b.id)));
const domOf = new Map(); for (const d of conf) if (!domOf.has(d.goal_id)) domOf.set(d.goal_id, d.domain);
const differ = goals.filter(g => (g.company_domain || null) !== (domOf.get(g.id) || null));
check(!differ.length, `${goals.filter(g => g.company_domain).length} partners have a domain; ${differ.length} differ from their confirmed row${differ.length ? `: ${differ.map(g => g.name).join(', ')}` : ''}`);

console.log('\nK8 one owner');
check(!opps.some(o => o.owner && !o.owner_user_id), `employers with an owner text and no owner id: ${opps.filter(o => o.owner && !o.owner_user_id).length} (of ${opps.filter(o => o.owner_user_id).length} owned)`);

console.log('\nTop targets through the new code (Team, first 10)');
const tt = await topTargets(svc, HL, { limit: '10' });
check(tt.status === 200 && (tt.body.rows || []).length > 0, `rows ${tt.body?.rows?.length} · with an owner name ${tt.body?.rows?.filter(r => r.owner).length} · with a next to-do ${tt.body?.rows?.filter(r => r.todo || r.next).length}`);
for (const r of (tt.body?.rows || []).slice(0, 10)) console.log(`    ${r.rank ?? ''} ${r.name} · ${r.type} · ${r.band || ''} ${r.score ?? ''}`);
console.log(`\nalias fired ${aliasCount()} time(s) in this run (expect 0) · ${bad ? `${bad} CHECK(S) BAD` : 'all checks ok'}`);
footer();
