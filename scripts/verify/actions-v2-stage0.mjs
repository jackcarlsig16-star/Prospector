// actions-v2 Stage 0 - READ-ONLY (0 writes, 0 Claude, 0 Apollo). HomeLover only.
// Declared scope: the ranking's own read set ONCE (openTodosFor, listScores, peopleActivity, web_visits), plus one
// paged read each of sales_week_goals (commitment + waiting rows), sales_call_notes (id, call_date only),
// business_members, sales_settings and today's intent_compose usage count. Estimated 25 s; hard cap 120 s.
// Prints counts and column names - no to-do text, no names of people, never an address.
// Usage: node scripts/verify/actions-v2-stage0.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { laDateString } = await import('../../api/sales/laDate.js');
const { laMonday, openTodosFor } = await import('../../api/sales/openTodos.js');
const { listScores } = await import('../../api/sales/scoresRoutes.js');
const { peopleActivity } = await import('../../api/sales/peopleActivityRoutes.js');
const { composeUsedToday, COMPOSE_DAILY_CAP } = await import('../../api/sales/composeRoutes.js');
const { buildToday, nbaOf, badgeCount, VERBS } = await import('../../api/sales/todayRank.js');

setTimeout(() => { console.log('CAP: 120 s'); process.exit(1); }, 120000).unref();
const t0 = Date.now();
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
const today = laDateString(), week = laMonday(today);
const all = (table, cols, build = x => x) => selectAllPages(() => build(svc.from(table).select(cols).eq('business_id', HL)).order('id'));
const tally = (rows, f) => { const m = {}; for (const r of rows) { const k = String(f(r)); m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'; };

const [open, scores, people, visits, others, notes, memberRows, settings, used] = await Promise.all([
  openTodosFor(svc, HL, null, { today }),
  listScores(svc, HL, {}).then(r => r.body.rows),
  peopleActivity(svc, HL, { window: 'all', snoozed: 'all' }).then(r => r.body.rows),
  all('web_visits', 'id, company_key, company_name, matched_type, matched_id, visits_7d, last_visit, seen_to, top_paths, pulled_on'),
  all('sales_week_goals', '*', x => x.in('kind', ['commitment', 'waiting'])),
  all('sales_call_notes', 'id, call_date'),
  svc.from('business_members').select('user_id, name, role').eq('business_id', HL).not('user_id', 'is', null).then(r => r.data || []),
  svc.from('sales_settings').select('compose_rules').eq('business_id', HL).maybeSingle().then(r => r.data || {}),
  composeUsedToday(svc, HL),
]);
const members = memberRows.map(m => ({ id: m.user_id, name: m.name }));
const ownerId = memberRows.find(m => m.role === 'owner')?.user_id || null;
const commitments = others.filter(r => r.kind === 'commitment'), waiting = others.filter(r => r.kind === 'waiting' && r.status === 'open');
const five = commitments.filter(c => c.week_start === week);
console.log(`today ${today} · week ${week} · read ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`rows read: open to-dos ${open.rows.length} of ${open.total} (snoozed ${open.snoozed}) · scores ${scores.length} · people ${people.length} · web_visits ${visits.length} · commitments ${commitments.length} · open waiting ${waiting.length} · call notes ${notes.length} · members ${members.length}`);

const args = { todos: open.rows, waiting, five, scores, people, visits, members, today, snoozed: open.snoozed };
const team = buildToday({ ...args, filter: {} });
const mine = buildToday({ ...args, filter: { owner: ownerId } });
const rowsOf = t => t.groups.flatMap(g => g.rows);

console.log('\n(a) the verb picker on today\'s rows');
for (const [label, t] of [['team', team], ["the owner's", mine]]) {
  const rows = rowsOf(t);
  console.log(`${label}: ${rows.length} rows (to-dos ${rows.filter(r => r.kind === 'todo').length} · virtual replies ${rows.filter(r => r.kind === 'reply').length} · waiting ${rows.filter(r => r.kind === 'waiting').length})`);
  console.log(`  verbs: ${Object.entries(t.verbs).map(([v, n]) => `${VERBS[v]} ${n}`).join(' · ')} · blank ${rows.filter(r => !VERBS[r.verb]).length}`);
  console.log(`  groups: ${t.groups.map(g => `${g.label} ${g.n}`).join(' · ')}`);
  const due = t.groups[0];
  console.log(`  group 1: due today ${due.rows.filter(r => !r.overdue).length} · overdue ${due.rows.filter(r => r.overdue).length}${due.fold ? ` · behind the fold ${due.fold.hidden} · oldest ${due.fold.oldest_days} d late` : ' · no fold'}`);
  console.log(`  counts: mine ${t.counts.mine} · team ${t.counts.team} · overdue ${t.counts.overdue} · undated ${t.counts.undated} · snoozed ${t.counts.snoozed} · badge (groups 1 + 2) ${badgeCount(t)}`);
  console.log(`  sources: ${Object.entries(t.counts.sources).map(([s, n]) => `${s} ${n}`).join(' · ')}`);
}
console.log(`stored origin on the open to-dos: ${tally(open.rows, r => r.origin)}`);
console.log(`link_type on the open to-dos: ${tally(open.rows, r => r.link_type)} · with person_key ${open.rows.filter(r => r.person_key).length} (found in People: ${open.rows.filter(r => r.person_key && people.some(p => p.key === r.person_key)).length})`);
const late = open.rows.filter(r => r.due_date && r.due_date < today).map(r => Math.round((Date.parse(today) - Date.parse(r.due_date)) / 864e5)).sort((a, b) => a - b);
console.log(`overdue open to-dos: ${late.length} · median ${late.length ? late[Math.floor(late.length / 2)] : 0} d · oldest ${late[late.length - 1] || 0} d · untouched 30+ days in Everything else (team): ${team.groups[4].rows.filter(r => r.kind === 'todo' && r.updated_at && Date.now() - Date.parse(r.updated_at) > 30 * 864e5).length}`);

console.log("\n(b) grounds available on the owner's to-do rows (the \"based on\" coverage)");
const own = rowsOf(mine).filter(r => r.kind === 'todo');
const personOf = new Map(people.map(p => [p.key, p]));
const noteTodo = new Set(open.rows.filter(r => r.source_note_id).map(r => r.id));
const g = {
  'a company record': own.filter(r => r.company?.id).length,
  'a score row (stage, band)': own.filter(r => r.company?.score != null).length,
  'a visit in 7 days': own.filter(r => r.company?.visits_7d > 0).length,
  'a pin': own.filter(r => r.company?.pinned).length,
  'a person': own.filter(r => r.person).length,
  'person email activity': own.filter(r => r.person && nbaOf(personOf.get(r.person.key))).length,
  'a heat band': own.filter(r => r.person?.heat_band).length,
  'came from a call note': own.filter(r => noteTodo.has(r.id)).length,
};
console.log(`rows ${own.length} · ${Object.entries(g).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
console.log(`no ground at all (no record, no person, no note): ${own.filter(r => !r.company?.id && !r.person && !noteTodo.has(r.id)).length}`);
console.log(`NBA rule over every person with email activity (${people.filter(p => nbaOf(p)).length} of ${people.length}): ${tally(people.filter(p => nbaOf(p)), p => nbaOf(p).id)}`);
console.log(`sales_call_notes columns hold no company id (title, call_date, text): notes reach a company only through a to-do's source_note_id or a target's`);

console.log('\n(c) the Write-email call and its cap');
console.log(`cap ${Number.isInteger(settings.compose_rules?.daily_cap) ? settings.compose_rules.daily_cap : COMPOSE_DAILY_CAP} per day (workspace${Number.isInteger(settings.compose_rules?.daily_cap) ? ' setting' : ' default'}) · used today ${used} · call_type intent_compose`);

console.log('\n(e) commitments, waiting rows, virtual replies');
console.log(`commitment rows ${commitments.length}: this week ${five.length} · by week ${tally(commitments, c => c.week_start)}`);
console.log(`  status ${tally(commitments, c => c.status)} · with plan_id ${commitments.filter(c => c.plan_id).length} · with carried_from_id ${commitments.filter(c => c.carried_from_id).length} · with link_type ${commitments.filter(c => c.link_type).length} · last created ${commitments.map(c => c.created_at).sort().pop()?.slice(0, 10)}`);
console.log(`  columns: ${Object.keys(commitments[0] || {}).join(', ')}`);
console.log(`to-dos linked to a commitment: ${open.rows.filter(r => r.link_type === 'commitment').length} open`);
console.log(`open waiting rows ${waiting.length}: linked ${tally(waiting, w => w.link_type)} · dated ${waiting.filter(w => w.due_date).length} · overdue ${waiting.filter(w => w.due_date && w.due_date < today).length} · with an owner ${waiting.filter(w => w.owner_user_id).length}`);
const replied = people.filter(p => p.emails?.replied > 0);
const answered = new Set(open.rows.map(r => r.person_key).filter(Boolean));
console.log(`people who replied ${replied.length}: with an open to-do on that person ${replied.filter(p => answered.has(p.key)).length} · VIRTUAL rows ${replied.filter(p => !answered.has(p.key)).length}`);
console.log(`  the virtual rows: reply class ${tally(replied.filter(p => !answered.has(p.key)), p => p.last_email?.reply_class || 'unclassified')} · with a company record ${replied.filter(p => !answered.has(p.key) && p.company?.id).length} · with an owner ${replied.filter(p => !answered.has(p.key) && p.owner_user_id).length} · person status ${tally(replied.filter(p => !answered.has(p.key)), p => p.status)}`);

console.log(`\nwrites: 0 · Claude 0 · Apollo 0 · restored: yes (nothing changed) · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(0);
