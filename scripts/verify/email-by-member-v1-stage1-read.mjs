// email-by-member-v1 Stage 1 - READ-ONLY (0 writes, 0 Claude, 0 Apollo, no sends). HomeLover only.
// Declared scope: ONE loadWeekly(member=all) (the function behind GET goals/weekly?member=all), ONE loadWeekly per
// sending member, ONE listMailboxes (behind GET goals/mailbox-map), and one raw paged read of sales_email_daily_counts
// + sales_mailbox_owners to compare against. Estimated 15 s; hard cap 90 s. Names, domains and counts only.
// Usage: node scripts/verify/email-by-member-v1-stage1-read.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { loadWeekly } = await import('../../api/sales/weeklyRoutes.js');
const { listMailboxes } = await import('../../api/sales/mailboxMap.js');
const { addDays } = await import('../../api/sales/goalsShared.js');
setTimeout(() => { console.log('CAP: 90 s'); process.exit(1); }, 90000).unref();
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
const t0 = Date.now();
let pass = 0, fail = 0;
const check = (ok, label) => { ok ? pass++ : fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const of = (ms, key) => ms.find(x => x.key === key);

const all = await loadWeekly(svc, HL, { weeks: 12, member: 'all' });
check(all.status === 200, `goals/weekly?member=all -> ${all.status}`);
const b = all.body, team = b.rows.find(r => r.id === 'team'), parts = b.rows.filter(r => r.id !== 'team');
console.log(`rows: ${b.rows.map(r => r.name).join(' · ')} · unassigned mailboxes ${b.unassigned_mailboxes} · week ${b.week_start} · day ${b.elapsed.days} of 7`);
const [counts, owners] = await Promise.all([
  selectAllPages(() => svc.from('sales_email_daily_counts').select('day, mailbox, sequence_id, step, delivered').eq('business_id', HL).gte('day', b.weeks[0]).order('day').order('mailbox').order('sequence_id').order('step')),
  svc.from('sales_mailbox_owners').select('mailbox_email, user_id').eq('business_id', HL).then(r => r.data),
]);
const ownerOf = new Map(owners.map(o => [o.mailbox_email, o.user_id]));
const weeksToCheck = b.weeks.slice(-2);
for (const key of ['delivered', 'human_clicks', 'replies']) for (const w of weeksToCheck) {
  const i = b.weeks.indexOf(w), sum = parts.reduce((n, r) => n + (of(r.metrics, key).series[i].value || 0), 0), t = of(team.metrics, key).series[i].value || 0;
  check(sum === t, `${key} week of ${w}: members + unassigned ${sum} = team ${t}`);
}
for (const w of weeksToCheck) for (const r of parts) {
  const i = b.weeks.indexOf(w), to = w === b.week_start ? b.today : addDays(w, 6);
  const raw = counts.filter(c => c.day >= w && c.day <= to && (r.id === 'unassigned' ? !ownerOf.has(c.mailbox) : ownerOf.get(c.mailbox) === r.id)).reduce((n, c) => n + c.delivered, 0);
  const got = of(r.metrics, 'delivered').series[i].value;
  check((got || 0) === raw, `${r.name} delivered week of ${w}: route ${got ?? '—'} = raw daily_counts ${raw}`);
}
for (const r of parts.filter(x => x.id !== 'unassigned')) {
  const one = await loadWeekly(svc, HL, { weeks: 12, member: r.id });
  check(one.status === 200 && JSON.stringify(one.body.metrics) === JSON.stringify(r.metrics), `goals/weekly?member=${r.name} equals its row in member=all`);
  const pct = v => (v == null ? '—' : `${(100 * v).toFixed(1)} %`);
  console.log(`     ${r.name}: delivered ${of(r.metrics, 'delivered').this_week.to_date ?? '—'} (same point last week ${of(r.metrics, 'delivered').this_week.same_point_last_week ?? '—'}) · human open rate ${pct(of(r.metrics, 'human_open_rate').this_week.to_date)} · last week ${of(r.metrics, 'delivered').last_week.value ?? '—'} delivered, ${pct(of(r.metrics, 'human_open_rate').last_week.value)} opened`);
}
check(parts.concat(team).every(r => r.metrics.filter(x => x.unit === 'rate').every(x => x.this_week.pace == null)), 'no rate carries a pace');
const list = await listMailboxes(svc, HL);
check(list.status === 200, `goals/mailbox-map -> ${list.status}`);
for (const m of list.body.mailboxes) console.log(`     ${m.domain} · first seen ${m.first_seen || '—'} · ${m.delivered} delivered · ${list.body.members.find(x => x.id === m.user_id)?.name || 'Unassigned'}${m.suggested_user_id ? ` · suggested: ${list.body.members.find(x => x.id === m.suggested_user_id)?.name}` : ''}${m.connected_account_of ? ' · a connected account' : ''}`);
check(!JSON.stringify([all.body, list.body]).includes('@'), "no '@' in either response");
console.log(`${pass}/${pass + fail} · ${((Date.now() - t0) / 1000).toFixed(1)} s · writes: 0 · Claude 0 · Apollo 0 · restored: yes (nothing changed)`);
process.exit(fail ? 1 : 0);
