// data-keys-v1 Stage 1 - READ-ONLY dry read for the migration file (0 writes, 0 Claude, 0 Apollo). HomeLover only.
// Declared scope: one paged read each of sales_opportunities, sales_targets, sales_goals, partner_domains, web_visits,
// sales_week_goals (link_type, origin, kind), sales_todo_events (origin), sales_email_delivered (account_id only),
// sales_sequenced_accounts (account_id, name). ~15 requests, ~10 s; hard cap 90 s.
// Prints what each step of 20261121_data_keys_v1_stage1.sql will find (names of companies only - never an address) and
// writes the 100-name fixture (name -> normName) the migration's proof embeds: .screenshots/data-keys-v1/norm-100.json.
// Usage: node scripts/verify/data-keys-v1-stage1-dry.mjs
import fs from 'fs';
import path from 'path';
import { svc, HL, cap, footer, ROOT } from './homelover-data-model-v1-lib.mjs';
cap(90);
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { normName } = await import('../../api/sales/normName.js');
const all = (table, cols, order = 'id') => selectAllPages(() => svc.from(table).select(cols).eq('business_id', HL).order(order));
const tally = (rows, f) => { const m = {}; for (const r of rows) { const k = String(f(r)); m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort().map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'; };
const [opps, targets, goals, pdomains, visits, todos, events, delivered, sequenced] = await Promise.all([
  all('sales_opportunities', 'id, organization, employees, employees_source, apollo_account_id, archived_at'),
  all('sales_targets', 'id, name, status, employees, employees_source, promoted_goal_id'),
  all('sales_goals', 'id, name, goal_type, company_domain, archived_at'),
  all('partner_domains', 'id, goal_id, domain, is_primary, confirmed, updated_at'),
  all('web_visits', 'id, company_key, company_name, matched_type, matched_id, pulled_on'),
  all('sales_week_goals', 'id, kind, link_type, origin'),
  all('sales_todo_events', 'id, origin'),
  all('sales_email_delivered', 'apollo_message_id, account_id', 'apollo_message_id'),
  all('sales_sequenced_accounts', 'account_id, name', 'account_id'),
]);
console.log(`HomeLover ${HL}`);
console.log(`rows read: employers ${opps.length} · targets ${targets.length} · goals ${goals.length} · partner_domains ${pdomains.length} · web_visits ${visits.length} · week_goals ${todos.length} · todo_events ${events.length} · delivered ${delivered.length} · sequenced ${sequenced.length}`);

console.log('\nK1 the type word on disk');
console.log(`  web_visits.matched_type: ${tally(visits, v => v.matched_type)}`);
console.log(`  sales_week_goals.link_type: ${tally(todos, t => t.link_type)}`);
console.log(`  sales_week_goals.origin: ${tally(todos, t => t.origin)} · sales_todo_events.origin: ${tally(events, e => e.origin)}`);

console.log('\nK2 accepted target -> the one live employer of the same normName (not a partner promotion)');
const live = opps.filter(o => !o.archived_at);
const oppBy = new Map(); for (const o of live) { const k = normName(o.organization); if (k) oppBy.set(k, [...(oppBy.get(k) || []), o]); }
const accepted = targets.filter(t => t.status === 'accepted' && !t.promoted_goal_id);
const accBy = new Map(); for (const t of accepted) { const k = normName(t.name); accBy.set(k, [...(accBy.get(k) || []), t]); }
const pairs = accepted.map(t => ({ t, e: oppBy.get(normName(t.name)) || [] })).filter(p => p.e.length === 1 && accBy.get(normName(p.t.name)).length === 1);
for (const p of pairs) { const diff = p.t.employees != null && p.e[0].employees != null && Number(p.t.employees) !== Number(p.e[0].employees); console.log(`  ${p.t.name} -> ${p.e[0].organization}${diff ? ` · CONFLICT target ${p.t.employees} / employer ${p.e[0].employees}` : ''}`); }
console.log(`  pairs ${pairs.length} · conflicts ${pairs.filter(p => p.t.employees != null && p.e[0].employees != null && Number(p.t.employees) !== Number(p.e[0].employees)).length} · accepted with no / several employers: ${accepted.filter(t => (oppBy.get(normName(t.name)) || []).length !== 1).map(t => t.name).join(', ') || 'none'}`);

console.log('\nK3 Apollo account ids that existing rows can place (the Stage 0 rule)');
const seqName = new Map(sequenced.map(s => [s.account_id, s.name]));
const acctIds = new Set([...delivered.map(d => d.account_id).filter(Boolean), ...sequenced.map(s => s.account_id)]);
const haveId = new Set(opps.map(o => o.apollo_account_id).filter(Boolean));
const tgtBy = new Map(); for (const t of targets.filter(x => x.status !== 'rejected')) { const k = normName(t.name); if (k) tgtBy.set(k, [...(tgtBy.get(k) || []), t]); }
const acctBy = new Map(); for (const a of acctIds) { const k = normName(seqName.get(a)); if (k) acctBy.set(k, [...(acctBy.get(k) || []), a]); }
const emp = [], tgt = [];
for (const a of acctIds) {
  if (haveId.has(a)) continue;
  const k = normName(seqName.get(a));
  if (!k) continue;
  const e = oppBy.get(k) || [], t = tgtBy.get(k) || [];
  if ((!e.length && !t.length) || acctBy.get(k).length > 1 || e.length > 1 || t.length > 1 || (e.length && e[0].apollo_account_id)) continue;
  if (e.length) emp.push(e[0].organization);
  if (t.length) tgt.push(t[0].name);
}
console.log(`  employers +${emp.length}: ${emp.sort().join(' · ') || '—'}`);
console.log(`  targets   +${tgt.length}: ${tgt.sort().join(' · ') || '—'}`);

console.log('\nK7 partner domain = what the window reads (companyPanel.js:283: confirmed rows; primary first)');
const partners = goals.filter(g => g.goal_type === 'partnership');
const conf = pdomains.filter(d => d.confirmed).sort((a, b) => (b.is_primary - a.is_primary) || String(a.updated_at).localeCompare(String(b.updated_at)) || String(a.id).localeCompare(String(b.id)));
const domOf = new Map(); for (const d of conf) if (!domOf.has(d.goal_id)) domOf.set(d.goal_id, d.domain);
console.log(`  partner_domains rows ${pdomains.length} · confirmed ${conf.length} (primary ${conf.filter(d => d.is_primary).length}) · unconfirmed ${pdomains.length - conf.length}`);
console.log(`  partners ${partners.length} · with a confirmed row ${partners.filter(g => domOf.has(g.id)).length} · would set (column empty) ${partners.filter(g => domOf.has(g.id) && !g.company_domain).length} · agrees ${partners.filter(g => g.company_domain && domOf.get(g.id) === g.company_domain).length} · differs ${partners.filter(g => g.company_domain && domOf.has(g.id) && domOf.get(g.id) !== g.company_domain).length} · column set with no confirmed row ${partners.filter(g => g.company_domain && !domOf.has(g.id)).length}`);

console.log('\nK10 visit rows still on a target that was promoted to a partner');
const tById = new Map(targets.map(t => [t.id, t])), gById = new Map(goals.map(g => [g.id, g]));
const stale = visits.filter(v => v.matched_type === 'target' && tById.get(v.matched_id)?.promoted_goal_id);
for (const v of stale) console.log(`  ${v.company_name} · pulled ${v.pulled_on} · target "${tById.get(v.matched_id).name}" -> partner "${gById.get(tById.get(v.matched_id).promoted_goal_id)?.name}"`);
console.log(`  rows ${stale.length}`);

console.log('\nK6 the 100-name fixture (name -> normName)');
const names = [...new Set([...live.map(o => o.organization), ...targets.map(t => t.name), ...partners.map(g => g.name), ...visits.map(v => v.company_name)].filter(Boolean))].filter(n => !/@/.test(n));
const accented = names.filter(n => /[^\x00-\x7f]/.test(n)), odd = names.filter(n => !accented.includes(n) && /[&()'.,/-]/.test(n)), plainNames = names.filter(n => !accented.includes(n) && !odd.includes(n));
const sample = [...accented.slice(0, 30), ...odd.slice(0, 45), ...plainNames].slice(0, 100).map(n => ({ name: n, norm: normName(n) }));
const out = path.join(ROOT, '.screenshots', 'data-keys-v1');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'norm-100.json'), JSON.stringify(sample, null, 1));
console.log(`  names on file ${names.length} · non-ASCII ${accented.length} · with punctuation ${odd.length} · fixture ${sample.length} (${Math.min(accented.length, 30)} non-ASCII, ${Math.min(odd.length, 45)} with punctuation) -> .screenshots/data-keys-v1/norm-100.json`);
console.log(`  includes L'Oréal: ${sample.some(s => /or.al/i.test(s.name) && /l.or/i.test(s.name))} · Star Médica: ${sample.some(s => /m.dica/i.test(s.name))}`);
console.log(`  non-ASCII letters seen: ${[...new Set(accented.join('').match(/[^\x00-\x7f]/g) || [])].join(' ')}`);
footer();
