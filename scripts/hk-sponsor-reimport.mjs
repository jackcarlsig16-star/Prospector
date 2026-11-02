// grow-sponsor-deals-v1 S3 - one-time, re-runnable correction of HumanKind's sponsor months from the tracker sheet's
// month + launch tabs (column A fill = state; Paid / Amount; deal type + details). Dry run by default: prints the report
// per month and writes nothing. --apply (only after Jack's "apply") snapshots every period + brand it will touch to
// audits/ first, then updates / inserts months (never deletes), moves relationships per S2, and writes ONE Activity row
// per brand changed.
// SCOPE (declared): 1 workbook (local file), HumanKind live brands (~1,000) + hk_sponsor_periods (132 today): 3 reads;
// --apply writes <= ~150 period rows + <= ~30 brands + one event each. 0 Gmail, 0 Claude, 0 Apollo. Runtime < 30 s, cap 120 s.
// Usage: node scripts/hk-sponsor-reimport.mjs <sheet.xlsx> [--apply]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const ExcelJS = require('exceljs');
const { parseSponsorTabs, planReimport, changeWords } = await import('../api/hk/sponsorSheet.js');
const { logEvent, liveBrands, selectAllPages } = await import('../api/hk/hkShared.js');
const { moneyByMonth } = await import('../api/hk/deals.js');

const file = process.argv.slice(2).find(a => !a.startsWith('--'));
const APPLY = process.argv.includes('--apply');
if (!file) { console.log('Usage: node scripts/hk-sponsor-reimport.mjs <sheet.xlsx> [--apply]'); process.exit(1); }
setTimeout(() => { console.log('ABORT: over the 120 s cap'); process.exit(1); }, 120000).unref();
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const hk = must(await svc.from('businesses').select('id, features').eq('name', 'HumanKind')).find(b => b.features?.hk_sales);
const B = hk.id, now = new Date();

const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
const { tabs } = parseSponsorTabs(wb);
const brands = await liveBrands(svc, B);
const periods = await selectAllPages(() => svc.from('hk_sponsor_periods').select('*').eq('business_id', B).order('id'));
const plan = planReimport({ tabs, brands, periods });

const list = (label, xs) => { if (xs.length) console.log(`   ${label} ${xs.length}: ${xs.join(' · ')}`); };
console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} - ${tabs.length} tabs, ${brands.length} live brands, ${periods.length} periods in Grow (${periods.filter(p => p.archived_at).length} archived)`);
for (const t of plan.tabs) {
  const src = tabs.find(x => x.name === t.tab);
  console.log(`\n## ${t.tab} (${t.period}${t.shifted ? ', Paid / Amount read two columns over' : ''}) - ${src.rows.length} rows`);
  list('would-confirm', t.would_confirm); list('would-mark-discussing', t.would_mark_discussing); list('would-fill (same state; gains type / details / amount / paid)', t.would_fill); list('would-add', t.would_add); list('yellow but paid -> confirmed (ruling 1)', t.paid_override || []);
  if (t.unchanged) console.log(`   unchanged ${t.unchanged}`);
  list('would-leave', t.would_leave); list('unmatched (offered as Add brand)', t.unmatched); list('skipped rows', t.skipped); list('warnings', t.warnings);
}
console.log(`\n## Relationships (${plan.relationships.length})`);
for (const r of plan.relationships) console.log(`   ${r.brand}: ${r.from} -> ${r.to}${r.status_to !== r.status_from ? ` (status ${r.status_from} -> ${r.status_to})` : ''}`);
console.log(`\n## Name families (a note for Review - never merged): ${plan.families.map(f => f.join(' / ')).join(' · ') || 'none'}`);
const live = new Set(brands.map(b => b.id)), money = moneyByMonth(plan.after.filter(p => live.has(p.brand_id)), ['2026-10', '2026-11', '2026-12', '2027-01']);
const usd = v => (v == null ? '—' : `$${v}`);
console.log('\n## Money after apply (S4)');
for (const m of money.months) console.log(`   ${m.month}: confirmed ${usd(m.confirmed_usd)} (${m.confirmed}) · paid ${usd(m.paid_usd)} (${m.paid}) · unpaid ${usd(m.unpaid_usd)} · in discussion ${usd(m.discussing_usd)} (${m.discussing}) · declined ${m.declined} · no amount ${m.without_amount}`);
console.log(`\nTotals: writes ${plan.writes.length} (add ${plan.writes.filter(w => !w.period_id).length}, change ${plan.writes.filter(w => w.period_id).length}) · relationships ${plan.relationships.length} · unmatched ${plan.unmatched.length} · left ${plan.leave.length}`);
if (!APPLY) { console.log('\nNothing written. Re-run with --apply after Jack says "apply".'); process.exit(0); }

const touched = [...new Set(plan.writes.map(w => w.brand_id))];
const snap = { at: now.toISOString(), business_id: B, file: path.basename(file), periods: periods.filter(p => touched.includes(p.brand_id)), brands: brands.filter(b => touched.includes(b.id)).map(b => ({ id: b.id, relationship: b.relationship, status: b.status, updated_at: b.updated_at })) };
const out = path.join(ROOT, 'audits', `hk-sponsor-reimport-apply-${now.toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(out, JSON.stringify(snap, null, 1));
console.log(`snapshot: ${path.relative(ROOT, out)}`);
const at = now.toISOString();
for (const w of plan.writes) {
  const row = { ...w.next, paid_at: w.next.paid ? (w.prev?.paid ? undefined : at) : null, source: 'sheet', ...(w.prev?.state !== w.next.state ? { state_changed_at: at, state_changed_by: null } : {}) };
  if (row.paid_at === undefined) delete row.paid_at;
  if (w.period_id) must(await svc.from('hk_sponsor_periods').update(row).eq('id', w.period_id));
  else must(await svc.from('hk_sponsor_periods').insert({ business_id: B, brand_id: w.brand_id, period: w.period, kind: w.kind, note: 'Sheet re-import', ...row }));
}
for (const r of plan.relationships) must(await svc.from('hk_brands').update({ ...r.patch, updated_at: at }).eq('id', r.brand_id).eq('business_id', B));
for (const id of touched) {
  const ws = plan.writes.filter(w => w.brand_id === id), rel = plan.relationships.find(r => r.brand_id === id);
  await logEvent(svc, { businessId: B, actorKind: 'system', entityType: 'brand', entityId: id, action: 'sheet.reimport', detail: { line: `Sheet re-import: ${ws.map(changeWords).join('; ')}`.slice(0, 600), ...(rel ? { relationship: { from: rel.from, to: rel.to }, status: { from: rel.status_from, to: rel.status_to } } : {}) } });
}
console.log(`applied: ${plan.writes.length} months, ${plan.relationships.length} relationships, ${touched.length} Activity rows`);
