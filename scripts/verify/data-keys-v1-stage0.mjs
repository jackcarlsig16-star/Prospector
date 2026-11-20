// data-keys-v1 Stage 0 - READ-ONLY (0 writes, 0 Claude, 0 Apollo). HomeLover only.
// Declared scope: one paged read each of sales_opportunities, sales_targets, sales_goals, partner_domains, web_visits,
// sales_week_goals (link columns), sales_email_delivered (account_id only), sales_sequenced_accounts, business_members,
// plus 100 calls of the SQL function sales_norm_name (one name each). Estimated 20 s; hard cap 90 s.
// Prints names / companies / first names only - never an address.
// Usage: node scripts/verify/data-keys-v1-stage0.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { normName } = await import('../../api/sales/normName.js');
// orgKey as it was before data-keys-v1 Stage 1 replaced it with normName (kept here so this Stage 0 read still runs).
const orgKey = name => String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && !['inc', 'llc', 'corp', 'co'].includes(w)).join(' ');

setTimeout(() => { console.log('CAP: 90 s'); process.exit(1); }, 90000).unref();
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
const all = (table, cols, order = 'id') => selectAllPages(() => svc.from(table).select(cols).eq('business_id', HL).order(order));
const tally = (rows, f) => { const m = {}; for (const r of rows) { const k = String(f(r)); m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort().map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'; };

const [opps, targets, goals, pdomains, visits, todos, delivered, sequenced] = await Promise.all([
  all('sales_opportunities', '*'), all('sales_targets', '*'), all('sales_goals', '*'), all('partner_domains', '*'),
  all('web_visits', 'id, company_key, company_name, matched_type, matched_id, pulled_on'),
  all('sales_week_goals', 'id, kind, status, link_type, link_id'),
  all('sales_email_delivered', 'apollo_message_id, account_id', 'apollo_message_id'),
  all('sales_sequenced_accounts', 'account_id, name', 'account_id'),
]);
const members = (await svc.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', HL).not('user_id', 'is', null)).data || [];
const liveOpps = opps.filter(o => !o.archived_at);
console.log(`rows read: employers ${opps.length} (live ${liveOpps.length}) · targets ${targets.length} · partners ${goals.length} · partner_domains ${pdomains.length} · web_visits ${visits.length} · week_goals ${todos.length} · delivered ${delivered.length} · sequenced ${sequenced.length} · members ${members.length}`);
console.log(`target columns: ${Object.keys(targets[0] || {}).join(', ')}`);
console.log(`employer id/owner columns: ${Object.keys(opps[0] || {}).filter(k => /owner|apollo|domain|employees|archiv/.test(k)).join(', ')}`);

console.log('\n(a) values on disk');
console.log(`web_visits.matched_type: ${tally(visits, v => v.matched_type)}`);
console.log(`sales_week_goals.link_type: ${tally(todos, t => t.link_type)}`);
console.log(`  of which kind/status for 'opportunity': ${tally(todos.filter(t => t.link_type === 'opportunity'), t => `${t.kind}/${t.status}`)}`);

console.log('\n(b) accepted targets -> employer by normName');
const tName = t => t.name || t.company_name || t.organization;
const oppByNorm = new Map();
for (const o of liveOpps) { const k = normName(o.organization); if (k) oppByNorm.set(k, [...(oppByNorm.get(k) || []), o]); }
const goalByNorm = new Map(goals.map(g => [normName(g.name), g]));
console.log(`targets by status: ${tally(targets, t => t.status)}`);
let pairs = 0, conflicts = 0;
for (const t of targets.filter(x => x.status === 'accepted')) {
  const k = normName(tName(t)), hits = oppByNorm.get(k) || [], partner = goalByNorm.get(k);
  if (t.promoted_goal_id) { console.log(`  ${tName(t)} -> partner (promoted_goal_id set) - not an employer pair`); continue; }
  if (!hits.length) { console.log(`  ${tName(t)} -> NO employer by name${partner ? ' (a partner has this name)' : ''} - LISTED, not linked`); continue; }
  if (hits.length > 1) { console.log(`  ${tName(t)} -> ${hits.length} employers share the name - AMBIGUOUS, not linked`); continue; }
  pairs++;
  const o = hits[0], diff = t.employees != null && o.employees != null && Number(t.employees) !== Number(o.employees);
  if (diff) conflicts++;
  console.log(`  ${tName(t)} -> ${o.organization} · headcount target ${t.employees ?? '—'} / employer ${o.employees ?? '—'}${diff ? '  CONFLICT (employer wins; target value -> promoted_from_note)' : ''}`);
}
console.log(`pairs linkable 1:1 by name: ${pairs} · headcount conflicts: ${conflicts}`);

console.log('\n(c) apollo_account_id coverage and what existing rows could backfill');
console.log(`employers with apollo_account_id today: ${liveOpps.filter(o => o.apollo_account_id).length} of ${liveOpps.length} live (${opps.filter(o => o.apollo_account_id).length} of ${opps.length} all) · targets have the column: ${targets[0] && 'apollo_account_id' in targets[0] ? 'yes' : 'no'}`);
const seqName = new Map(sequenced.map(s => [s.account_id, s.name]));
const acctIds = new Set([...delivered.map(d => d.account_id).filter(Boolean), ...sequenced.map(s => s.account_id)]);
const deliveredIds = new Set(delivered.map(d => d.account_id).filter(Boolean));
console.log(`distinct Apollo account ids: delivered ${deliveredIds.size} · sequenced ${sequenced.length} · union ${acctIds.size} · delivered rows with no account_id ${delivered.filter(d => !d.account_id).length} · union ids with a stored name ${[...acctIds].filter(a => seqName.get(a)).length}`);
const haveId = new Set(opps.map(o => o.apollo_account_id).filter(Boolean));
const liveTargetByNorm = new Map();
for (const t of targets.filter(x => x.status !== 'rejected')) { const k = normName(tName(t)); if (k) liveTargetByNorm.set(k, [...(liveTargetByNorm.get(k) || []), t]); }
const byNormAcct = new Map();
for (const a of acctIds) { const k = normName(seqName.get(a)); if (k) byNormAcct.set(k, [...(byNormAcct.get(k) || []), a]); }
let already = 0, empFill = 0, tgtFill = 0, noName = 0, noRecord = 0;
const ambiguous = [];
for (const a of acctIds) {
  if (haveId.has(a)) { already++; continue; }
  const k = normName(seqName.get(a));
  if (!k) { noName++; continue; }
  const e = oppByNorm.get(k) || [], t = liveTargetByNorm.get(k) || [];
  if (!e.length && !t.length) { noRecord++; continue; }
  if ((byNormAcct.get(k) || []).length > 1) { ambiguous.push(`${seqName.get(a)}: ${(byNormAcct.get(k) || []).length} Apollo accounts share this name`); continue; }
  if (e.length > 1 || t.length > 1) { ambiguous.push(`${seqName.get(a)}: ${e.length} employers / ${t.length} targets share this name`); continue; }
  if (e.length && e[0].apollo_account_id) { ambiguous.push(`${seqName.get(a)}: the employer already holds a different Apollo account id`); continue; }
  if (e.length) empFill++;
  if (t.length) tgtFill++;
}
console.log(`already on an employer: ${already} · could backfill by name: employers +${empFill}, targets +${tgtFill} · no stored name: ${noName} · name matches no record: ${noRecord} · ambiguous: ${ambiguous.length}`);
for (const line of [...new Set(ambiguous)]) console.log(`  AMBIGUOUS ${line}`);
console.log('(sales_email_delivered and sales_sequenced_accounts carry no domain: the only match key from existing rows is the name)');

console.log('\n(d) normName vs the live SQL sales_norm_name on 100 real names (dry) and vs orgKey');
const names = [...new Set([...liveOpps.map(o => o.organization), ...targets.map(tName), ...goals.map(g => g.name), ...visits.map(v => v.company_name)].filter(Boolean))];
const odd = names.filter(n => /[^\x20-\x7e]|[&()'.,/-]/.test(n));
const sample = [...odd.slice(0, 60), ...names.filter(n => !odd.includes(n))].slice(0, 100);
let mism = 0, rpcErr = null;
for (const n of sample) {
  const r = await svc.rpc('sales_norm_name', { s: n });
  if (r.error) { rpcErr = r.error.message; break; }
  if (r.data !== normName(n)) { mism++; console.log(`  MISMATCH "${n}": js "${normName(n)}" / sql "${r.data}"`); }
}
console.log(rpcErr ? `the SQL function could not be called through the API (${rpcErr}) - equality NOT measured` : `names tested ${sample.length} (${Math.min(odd.length, 60)} with punctuation or non-ASCII) · mismatches ${mism}`);
const orgDiff = liveOpps.filter(o => orgKey(o.organization) !== normName(o.organization));
console.log(`orgKey <> normName on ${orgDiff.length} of ${liveOpps.length} live employers${orgDiff.length ? ':' : ''}`);
for (const o of orgDiff.slice(0, 15)) console.log(`  "${o.organization}": orgKey "${orgKey(o.organization)}" / normName "${normName(o.organization)}"`);
const dupNorm = [...oppByNorm.entries()].filter(([, v]) => v.length > 1);
console.log(`live employers sharing one normName: ${dupNorm.length}${dupNorm.length ? ' - ' + dupNorm.map(([k, v]) => `${k} ×${v.length}`).join(' · ') : ''}`);

console.log('\n(e) partner domain: partner_domains vs sales_goals.company_domain');
const domByGoal = new Map();
for (const d of [...pdomains].sort((a, b) => (b.is_primary - a.is_primary) || String(a.created_at).localeCompare(String(b.created_at)))) if (!domByGoal.has(d.goal_id)) domByGoal.set(d.goal_id, d.domain);
const withCol = goals.filter(g => g.company_domain), withRows = goals.filter(g => domByGoal.has(g.id));
console.log(`partners ${goals.length} · company_domain filled ${withCol.length} · with a partner_domains row ${withRows.length} (${pdomains.length} rows, ${pdomains.filter(d => d.is_primary).length} primary, ${pdomains.filter(d => !d.confirmed).length} unconfirmed)`);
console.log(`backfill from partner_domains would set ${withRows.filter(g => !g.company_domain).length} · column agrees ${withCol.filter(g => domByGoal.get(g.id) === g.company_domain).length} · column differs ${withCol.filter(g => domByGoal.has(g.id) && domByGoal.get(g.id) !== g.company_domain).length} · column set with no row ${withCol.filter(g => !domByGoal.has(g.id)).length} · neither ${goals.filter(g => !g.company_domain && !domByGoal.has(g.id)).length}`);

console.log('\n(f) employer owner text vs owner_user_id');
const first = m => ((m.profile?.display_name || m.name || '').trim().split(/\s+/)[0] || '').toLowerCase();
const textOnly = opps.filter(o => (o.owner || '').trim() && !o.owner_user_id);
console.log(`owner text set ${opps.filter(o => (o.owner || '').trim()).length} · owner_user_id set ${opps.filter(o => o.owner_user_id).length} · text only ${textOnly.length} · id only ${opps.filter(o => o.owner_user_id && !(o.owner || '').trim()).length}`);
console.log(`text spellings: ${tally(opps.filter(o => (o.owner || '').trim()), o => `"${o.owner.trim()}"`)}`);
for (const o of textOnly) {
  const w = o.owner.trim().split(/\s+/)[0].toLowerCase(), hit = members.filter(m => first(m) === w);
  console.log(`  ${o.organization}: "${o.owner.trim()}" -> ${hit.length === 1 ? 'one member' : hit.length ? `${hit.length} members - AMBIGUOUS` : 'no member - UNMATCHED, listed not guessed'}`);
}

console.log('\n(g) companies matched to more than one record in web_visits');
const byKey = new Map();
for (const v of visits) if (v.matched_type && v.matched_id) { const s = byKey.get(v.company_key) || new Map(); const k = `${v.matched_type}:${v.matched_id}`; s.set(k, [...(s.get(k) || []), v.pulled_on]); byKey.set(v.company_key, s); }
const recName = (type, id) => type === 'partner' ? goals.find(g => g.id === id)?.name : type === 'target' ? tName(targets.find(t => t.id === id) || {}) : opps.find(o => o.id === id)?.organization;
let doubles = 0;
for (const [key, s] of byKey) if (s.size > 1) {
  doubles++;
  console.log(`  ${key}:`);
  for (const [k, ds] of s) { const [type, id] = k.split(':'); console.log(`    ${type} "${recName(type, id) ?? 'MISSING'}" · ${ds.length} rows · ${ds.slice().sort()[0]} → ${ds.slice().sort().pop()}`); }
}
console.log(`double-matched companies: ${doubles}`);
const stale = [...byKey.entries()].filter(([key, s]) => s.size === 1 && (() => { const [type, id] = [...s.keys()][0].split(':'); const n = recName(type, id); return n && normName(n) !== key; })());
console.log(`matched companies whose record name no longer normalises to company_key: ${stale.length}${stale.length ? ' - ' + stale.map(([key, s]) => { const [type, id] = [...s.keys()][0].split(':'); return `${key} -> ${type} "${recName(type, id)}"`; }).join(' · ') : ''}`);

console.log('\nwrites: 0 · Claude 0 · Apollo 0 · restored: yes (nothing changed)');
process.exit(0);
