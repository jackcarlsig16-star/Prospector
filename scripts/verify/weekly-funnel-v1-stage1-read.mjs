// weekly-funnel-v1 Stage 1 - READ-ONLY (0 writes, 0 Claude, 0 Apollo). HomeLover only: ONE loadWeekly call (the
// function behind GET goals/weekly) and the table it returns, beside the Stage 0 raw sums for delivered.
// Usage: node scripts/verify/weekly-funnel-v1-stage1-read.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { loadWeekly } = await import('../../api/sales/weeklyRoutes.js');
setTimeout(() => { console.log('CAP: 60 s'); process.exit(1); }, 60000).unref();
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
const t0 = Date.now();
const { status, body } = await loadWeekly(svc, HL, { weeks: 12 });
const f = (x, v) => (v == null ? '—' : x.unit === 'rate' ? `${(100 * v).toFixed(1)}%` : String(v));
console.log(`status ${status} · ${Date.now() - t0} ms · today ${body.today} · week ${body.week_start} · day ${body.elapsed.days} of 7 · same point ${body.same_point.from} → ${body.same_point.to}`);
console.log(`weeks: ${body.weeks.map(w => w.slice(5)).join('  ')}`);
for (const x of body.metrics) console.log(`${x.key.padEnd(24)} ${x.series.map(s => f(x, s.value).padStart(6)).join(' ')}  | to date ${f(x, x.this_week.to_date)} · same pt ${f(x, x.this_week.same_point_last_week)} · pace ${x.this_week.pace ?? '—'} · goal ${f(x, x.this_week.goal)}`);
console.log(`'@' in the body: ${JSON.stringify(body).includes('@')}`);
console.log('writes: 0 · Claude 0 · Apollo 0 · restored: yes (nothing changed)');
process.exit(0);
