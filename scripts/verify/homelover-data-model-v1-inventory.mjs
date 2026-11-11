// AUDIT homelover-data-model-v1 Part A1 - READ-ONLY. Declared: ~115 tables x (1 schema RPC + 1 head count + <= 5
// "newest row" reads of one column) ~ 700 small requests, < 1 MB, ~2 min; cap 300 s. Writes _hdm/inventory.json.
import fs from 'fs';
import { svc, HL, cap, footer, ROOT, net } from './homelover-data-model-v1-lib.mjs';
cap(300);
const S = process.argv[2];
const tables = fs.readFileSync(S + '/tables_mig.txt', 'utf8').split('\n').filter(Boolean).filter(t => !t.startsWith('hk_'));
const t0 = Date.now();
const out = {};
const one = async t => {
  const sch = await svc.rpc('audit_table_schema', { target_table: t });
  if (sch.error || !sch.data?.length) { out[t] = { missing: true, err: sch.error?.message || 'no columns (table not in the DB)' }; return; }
  const cols = sch.data.map(c => ({ n: c.column_name, t: c.data_type, fk: c.fk_target }));
  const hasBiz = cols.some(c => c.n === 'business_id');
  const scope = q => (hasBiz ? q.eq('business_id', HL) : q);
  const total = await svc.from(t).select('*', { count: 'exact', head: true });
  const mine = hasBiz ? await svc.from(t).select('*', { count: 'exact', head: true }).eq('business_id', HL) : null;
  const stamps = cols.filter(c => /timestamp/.test(c.t)).map(c => c.n);
  const pref = ['updated_at', 'created_at', 'synced_at', 'fetched_at', 'finished_at', 'started_at', 'computed_at', 'occurred_at', 'pulled_at', 'last_seen_at'];
  stamps.sort((a, b) => (pref.indexOf(a) + 1 || 99) - (pref.indexOf(b) + 1 || 99));
  const dates = cols.filter(c => c.t === 'date').map(c => c.n);
  const last = {};
  for (const c of [...stamps.slice(0, 4), ...(stamps.length ? [] : dates.slice(0, 2))]) {
    const r = await scope(svc.from(t).select(c)).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    if (r.data?.[0]) last[c] = r.data[0][c];
  }
  out[t] = { cols, hasBiz, total: total.count, rows: hasBiz ? mine.count : null, err: total.error?.message || mine?.error?.message || null, last };
};
const queue = [...tables];
await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await one(queue.shift()); }));
fs.writeFileSync(ROOT + '/scripts/verify/_hdm/inventory.json', JSON.stringify(out, null, 1));
for (const t of tables) { const r = out[t]; if (r.missing) { console.log(`${t.padEnd(34)} NOT IN DB (${r.err})`); continue; } const lw = Object.values(r.last).sort().pop(); console.log(`${t.padEnd(34)} ${String(r.hasBiz ? r.rows : `(${r.total} all)`).padStart(8)} ${r.hasBiz ? `of ${r.total}`.padEnd(10) : 'no biz_id '} ${String(lw || '—').slice(0, 16)} ${r.cols.length} cols${r.err ? ' ERR ' + r.err : ''}`); }
console.log(`\n${tables.length} tables · ${Date.now() - t0} ms`);
footer();
