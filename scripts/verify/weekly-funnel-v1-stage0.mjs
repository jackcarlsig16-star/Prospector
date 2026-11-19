// weekly-funnel-v1 Stage 0 - READ-ONLY (0 writes, 0 Claude, 0 Apollo). HomeLover only. One paged read each of
// sales_email_daily_counts (the last 12 Mon-Sun LA weeks), sales_funnel_days (since Oct 20), sales_metric_targets (all
// rows) and business_members (first names for "who"). Prints (b) delivered / hard_bounced / spam_blocked and
// deliverability per week, (c) funnel-day coverage per week by sides_present, (d) the target rows by key, week and who.
// First names only - never an address.
// Usage: node scripts/verify/weekly-funnel-v1-stage0.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { laDateString } = await import('../../api/sales/laDate.js');
const { addDays, laMonday } = await import('../../api/sales/goalsShared.js');

setTimeout(() => { console.log('CAP: 60 s'); process.exit(1); }, 60000).unref();
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
const today = laDateString();
const mon = laMonday(today);
const weeks = Array.from({ length: 12 }, (_, i) => addDays(mon, -7 * (11 - i)));
const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)} %` : '—');
console.log(`today ${today} · this week ${mon} · weeks ${weeks[0]} → ${mon}`);

const counts = await selectAllPages(() => svc.from('sales_email_daily_counts').select('day, mailbox, sequence_id, step, delivered, hard_bounced, spam_blocked, opened, clicked, replied')
  .eq('business_id', HL).gte('day', weeks[0]).order('day').order('mailbox').order('sequence_id').order('step'));
console.log(`\n(b) sales_email_daily_counts: ${counts.length} rows since ${weeks[0]} · first day ${counts[0]?.day || 'none'} · last day ${counts[counts.length - 1]?.day || 'none'}`);
console.log('week        days  delivered  hard_bounced  spam_blocked  sent  deliverability  opened  replied');
for (const w of weeks) {
  const rows = counts.filter(r => r.day >= w && r.day <= addDays(w, 6));
  const s = k => rows.reduce((n, r) => n + (r[k] || 0), 0);
  const d = s('delivered'), b = s('hard_bounced'), x = s('spam_blocked');
  console.log(`${w}  ${String(new Set(rows.map(r => r.day)).size).padStart(4)}  ${String(d).padStart(9)}  ${String(b).padStart(12)}  ${String(x).padStart(12)}  ${String(d + b + x).padStart(4)}  ${pct(d, d + b + x).padStart(14)}  ${String(s('opened')).padStart(6)}  ${String(s('replied')).padStart(7)}`);
}

const days = await selectAllPages(() => svc.from('sales_funnel_days').select('day, delivered, human_opens, human_clicks, companies_emailed, companies_visited, people_emailed, people_identified, replies, meetings, sides_present, window_days, computed_at')
  .eq('business_id', HL).gte('day', '2026-10-20').order('day'));
console.log(`\n(c) sales_funnel_days: ${days.length} rows · ${days[0]?.day || 'none'} → ${days[days.length - 1]?.day || 'none'} · last computed ${days.map(r => r.computed_at).sort().pop() || 'none'}`);
console.log('week        rows  both  email  visits  none  delivered  h_opens  h_clicks  co_emailed  co_visited  ppl_ident  replies  meetings');
for (let w = laMonday('2026-10-20'); w <= mon; w = addDays(w, 7)) {
  const rows = days.filter(r => r.day >= w && r.day <= addDays(w, 6));
  const n = side => rows.filter(r => r.sides_present === side).length;
  const s = k => rows.reduce((t, r) => t + (r[k] || 0), 0);
  console.log(`${w}  ${String(rows.length).padStart(4)}  ${String(n('both')).padStart(4)}  ${String(n('email')).padStart(5)}  ${String(n('visits')).padStart(6)}  ${String(n('none')).padStart(4)}  ${String(s('delivered')).padStart(9)}  ${String(s('human_opens')).padStart(7)}  ${String(s('human_clicks')).padStart(8)}  ${String(s('companies_emailed')).padStart(10)}  ${String(s('companies_visited')).padStart(10)}  ${String(s('people_identified')).padStart(9)}  ${String(s('replies')).padStart(7)}  ${String(s('meetings')).padStart(8)}`);
}

const members = (await svc.from('business_members').select('user_id, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', HL).not('user_id', 'is', null)).data || [];
const first = id => { const m = members.find(x => x.user_id === id); return m ? ((m.profile?.display_name || m.name || '').trim().split(/\s+/)[0] || 'a member') : id ? 'not a member' : '—'; };
const targets = await selectAllPages(() => svc.from('sales_metric_targets').select('period, period_start, metric_key, goal, actual, unit, updated_by, updated_at, actual_by')
  .eq('business_id', HL).order('period').order('period_start').order('metric_key'));
console.log(`\n(d) sales_metric_targets: ${targets.length} rows`);
const byKey = {};
for (const t of targets) byKey[`${t.period}|${t.metric_key}`] = (byKey[`${t.period}|${t.metric_key}`] || 0) + 1;
console.log('by period|key:', Object.entries(byKey).map(([k, n]) => `${k} ${n}`).join(' · '));
for (const t of targets) console.log(`${t.period.padEnd(5)}  ${t.period_start}  ${t.metric_key.padEnd(24)}  goal ${String(t.goal ?? '—').padStart(6)}${t.unit ? ` ${t.unit}` : ''}  actual ${String(t.actual ?? '—').padStart(4)}  by ${first(t.updated_by)}${t.actual_by ? ` · actual by ${first(t.actual_by)}` : ''}  ${String(t.updated_at || '').slice(0, 10)}`);

const manual = await svc.from('sales_manual_metrics').select('metric_key', { count: 'exact', head: true }).eq('business_id', HL);
console.log(`\nsales_manual_metrics: ${manual.error ? `not there yet (${manual.error.code || manual.error.message})` : `${manual.count} rows`}`);
console.log('\nwrites: 0 · Claude 0 · Apollo 0 · restored: yes (nothing changed)');
process.exit(0);
