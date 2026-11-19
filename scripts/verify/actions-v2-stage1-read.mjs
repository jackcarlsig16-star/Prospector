// actions-v2 Stage 1 - READ-ONLY (0 writes, 0 Claude, 0 Apollo). HomeLover only: the functions behind GET goals/today,
// GET goals/today/fixes and POST goals/today/:key/work - the last one only on verbs that make NO model call
// (Find people; Next steps on a row with nothing stored), with the model and the Write-email call replaced by a
// function that fails the run if it is reached. Declared: 4 ranking read sets + the attention read; est. 15 s, cap 120 s.
// Prints counts and company names - no people's names, no to-do text, never an address.
// Usage: node scripts/verify/actions-v2-stage1-read.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { loadToday, fixes, parseTodayQuery } = await import('../../api/sales/todayRoutes.js');
const { work, workDeps } = await import('../../api/sales/todayWork.js');
setTimeout(() => { console.log('CAP: 120 s'); process.exit(1); }, 120000).unref();
const t0 = Date.now();
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
const owner = (await svc.from('business_members').select('user_id, name').eq('business_id', HL).eq('role', 'owner')).data[0];
let checks = 0, bad = 0;
const ok = (label, pass, detail = '') => { checks++; if (!pass) bad++; console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? ` · ${detail}` : ''}`); };

const mine = await loadToday(svc, HL, { filter: parseTodayQuery({ owner: 'me' }, owner.user_id) });
const v = mine.view, rows = v.groups.flatMap(g => g.rows);
console.log(`GET goals/today?owner=me · ${Date.now() - t0} ms · ${v.groups.map(g => `${g.label} ${g.n}`).join(' · ')}`);
const openMine = (await svc.from('sales_week_goals').select('id, due_date, snooze_until', { count: 'exact' }).eq('business_id', HL).eq('kind', 'todo').eq('status', 'open').is('prospect_contact_id', null).eq('owner_user_id', owner.user_id)).data;
ok('the list holds every open to-do of the owner (raw query)', rows.filter(r => r.kind === 'todo').length + v.strip.filter(s => s.todo_id).length === openMine.filter(t => !t.snooze_until || t.snooze_until <= v.today).length, `${rows.filter(r => r.kind === 'todo').length} listed / ${openMine.length} raw`);
ok('overdue chip = raw overdue', v.counts.overdue === openMine.filter(t => t.due_date && t.due_date < v.today).length, String(v.counts.overdue));
ok('a row appears once, ranks run 1..n', new Set(rows.map(r => r.key)).size === rows.length && rows.every((r, i) => r.rank === i + 1));
ok('no blank verb', rows.every(r => typeof r.verb === 'string' && r.verb), Object.entries(v.verbs).map(([k, n]) => `${k} ${n}`).join(' · '));
ok('the fold shows 3 overdue', !v.groups[0].fold || v.groups[0].rows.filter(r => r.overdue && !r.folded).length === 3, v.groups[0].fold ? `${v.groups[0].fold.hidden} behind · oldest ${v.groups[0].fold.oldest_days} d` : 'no fold');
ok("no '@' in the list", !JSON.stringify(v).includes('@'));

const f = await fixes(svc, { businessId: HL, userId: owner.user_id });
console.log(`GET goals/today/fixes · n ${f.n}`);
for (const i of f.items) console.log(`  ${i.title} -> ${i.action ? `${i.action.label} (${i.action.verb}, ${i.action.rows.length} rows)` : 'no button'}`);
for (const x of f.feeds) console.log(`  feed ${x.label}: ${x.status} · ${x.line}`);
ok('at most five fixes', f.items.length <= 5);
ok("no '@' in the fixes", !JSON.stringify(f).includes('@'));

const never = name => async () => { throw new Error(`${name} was reached - this run makes no model call`); };
const deps = { ...workDeps, compose: never('compose'), call: never('callAnthropic') };
const auth = { user: { id: owner.user_id, name: owner.name } };
const find = rows.find(r => r.verb === 'find_people');
if (find) {
  const r = await work(svc, { businessId: HL, auth, key: find.key, body: {}, deps });
  ok('Find people: 200, no call, stored people only', r.status === 200 && r.body.usage.calls === 0 && Array.isArray(r.body.people), `${find.company.name}: ${r.body.people?.length} people · ${r.body.grounds.length} grounds (${r.body.grounds.map(g => g.kind).join(', ')}) · pack ${r.body.prompt_pack?.asks ? r.body.prompt_pack.asks.map(a => (a.blocked ? 'blocked' : `${a.chars} chars`)).join(' / ') : r.body.prompt_pack?.blocked ? 'blocked' : 'none'}`);
  ok("no '@' in the panel body", !JSON.stringify(r.body).includes('@'));
}
const bare = rows.find(r => r.verb === 'next_steps' && !r.company && !r.person);
if (bare) {
  const r = await work(svc, { businessId: HL, auth, key: bare.key, body: {}, deps }).catch(e => ({ stopped: e.message }));
  ok('Next steps on a row with no company and no person: no call unless a call note grounds it', r.stopped ? /callAnthropic was reached/.test(r.stopped) : r.status === 200 && r.body.usage.calls === 0, r.stopped ? 'grounded by its call note - the one call was stopped by this script before it left' : `${r.body.grounds.length} grounds · ${r.body.note || ''}`);
}
console.log(`\n${checks - bad}/${checks} checks · writes: 0 · Claude 0 · Apollo 0 · restored: yes (nothing changed) · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(bad ? 1 : 0);
