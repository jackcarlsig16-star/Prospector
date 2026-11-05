// homelover-flow-v1 Stage 1 (ruling F-d) - the one-off visit re-match over the REAL HomeLover workspace: every web_visits
// row with no match is matched to a live partner / employer / target by the pull's own matcher (name or confirmed partner
// domain) or by the record's domain column. Declared: reads web_visits (unmatched rows, ~300), the dupe context (~450
// records) and the domain columns; 0 Apollo, 0 Claude, 0 Outlook. Writes: NONE without --apply; with --apply only
// web_visits.matched_type / matched_id on the planned rows (each printed first), nothing else. Runtime < 30 s, cap 120 s.
// Report = counts and company names only. Mace's rows are the live check (ruling F-d). With --apply the planned rows
// (visit id, prior match = none, new match) are written to audits/homelover-flow-visit-backfill-apply-<ts>.json first,
// so the run can be reverted row by row (set matched_type / matched_id back to null on those ids).
// Usage: node scripts/verify/homelover-flow-v1-stage1-visit-backfill.mjs [--apply]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { backfillVisitMatches } = await import('../../api/sales/visitMatch.js');
const APPLY = process.argv.includes('--apply');
setTimeout(() => { console.error('ABORT: 120 s cap'); process.exit(2); }, 120e3).unref();
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const biz = must(await svc.from('businesses').select('id, name').ilike('name', '%homelover%'));
if (biz.length !== 1) throw new Error('expected one HomeLover business');
const HL = biz[0].id;
const T0 = Date.now();
const count = async (q) => { const r = await q; if (r.error || typeof r.count !== 'number') throw new Error(r.error?.message || 'no count'); return r.count; };
const unmatchedBefore = await count(svc.from('web_visits').select('*', { count: 'exact', head: true }).eq('business_id', HL).is('matched_id', null));
const totalVisits = await count(svc.from('web_visits').select('*', { count: 'exact', head: true }).eq('business_id', HL));
let out = await backfillVisitMatches(svc, HL, { apply: false });
if (APPLY) {
  const file = path.join(ROOT, 'audits', `homelover-flow-visit-backfill-apply-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ business: 'HomeLover', planned: out.planned, rows: out.rows.map(r => ({ visit_id: r.visit_id, company_key: r.company_key, prior: { matched_type: null, matched_id: null }, type: r.type, id: r.id, via: r.via })) }, null, 2));
  console.log(`revert manifest: ${path.relative(ROOT, file)}`);
  out = await backfillVisitMatches(svc, HL, { apply: true });
}
const unmatchedAfter = await count(svc.from('web_visits').select('*', { count: 'exact', head: true }).eq('business_id', HL).is('matched_id', null));
console.log(`homelover-flow-v1 visit backfill ${APPLY ? 'APPLY' : 'DRY RUN'} · ${Date.now() - T0} ms`);
console.log(`web_visits ${totalVisits} · unmatched before ${unmatchedBefore} · planned ${out.planned} (${Object.entries(out.by_type).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}) · matched ${out.matched} · unmatched after ${unmatchedAfter}`);
const byRecord = new Map();
for (const r of out.rows) { const k = `${r.type}:${r.name}`; byRecord.set(k, (byRecord.get(k) || 0) + 1); }
for (const [k, n] of [...byRecord].sort((a, b) => b[1] - a[1])) console.log(`  ${k} · ${n} row${n === 1 ? '' : 's'} · via ${out.rows.find(r => `${r.type}:${r.name}` === k).via}`);
const mace = out.rows.filter(r => /mace/i.test(r.name) || /mace/i.test(r.company_key));
console.log(`Mace rows planned: ${mace.length}${mace.length ? ` -> ${mace[0].type} ${mace[0].name} (${mace[0].via})` : ''}`);
console.log(`restored: ${APPLY ? `n/a (applied ${out.matched} matches on purpose; nothing else written)` : 'yes (read-only)'}`);
