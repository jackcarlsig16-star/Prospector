// FIX visitor-people-filing-v1 (ruling 3 of Nov 13) - the targets the OLD people filer created on the Nov 12 06:30 pull.
// DECLARED before it runs:
//   scope    the sales_targets rows of HomeLover with source 'web_visit', no visit row of their own (visit_id null) and
//            created on 2026-11-12 (UTC) - expected 77; the run aborts if it finds another number.
//   default  READ-ONLY plan: ~12 Supabase GETs, 0 writes (a non-GET throws), 0 Apollo, 0 Claude, cap 60 s.
//   --apply  the plan, then ONE batch: each target to archive goes through rejectTarget (the existing "not a fit" writer:
//            status 'rejected' + decided_at - sales_targets has no archived_at; never a delete; its Undo puts it back).
//            At most 77 status updates, ~3 Supabase calls each, cap 4 min. A manifest of every row's prior status /
//            decided_at / updated_at is written under audits/ BEFORE the first write; people rows are not changed
//            (a rejected target still matches its company by name, so a later pull files nobody twice).
//   KEEP     (listed, not archived) any target with: a web_visits row (company key, or a row matched to it), a
//            headcount >= 500, a buyer title among its people, or any touch (status not 'researching', an owner, a
//            to-do, a research run, a signal, a source event other than its create, a typed headcount, edited notes).
//   Names only - never an address or phone.
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
delete process.env.ANTHROPIC_API_KEY;
const APPLY = process.argv.includes('--apply');
const EXPECTED = 77;
setTimeout(() => { console.log(`ABORT ${APPLY ? '4 min' : '60 s'} cap`); process.exit(2); }, APPLY ? 240000 : 60000).unref();
const supaHost = new URL(process.env.SUPABASE_URL).host;
const net = { gets: 0, writes: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  if (url.host === supaHost && ['GET', 'HEAD'].includes(method)) { net.gets++; return realFetch(input, init); }
  if (url.host === supaHost && APPLY) { net.writes++; return realFetch(input, init); }
  throw new Error(`guard: refused ${method} ${url.host}${url.pathname}`);
};
const { createClient } = require('@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { normName } = await import('../../api/sales/intakeMatch.js');
const { hasBuyerTitle, RECORD_MIN_EMPLOYEES } = await import('../../api/sales/visitorRecords.js');
const { rejectTarget } = await import('../../api/sales/targetsRoutes.js');
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const noAt = s => String(s ?? '').replace(/\S*@\S*/g, '[address]');
const HL = must(await svc.from('businesses').select('id').ilike('name', 'homelover'))[0].id;

const targets = must(await svc.from('sales_targets').select('id, name, status, owner_user_id, employees, employees_source, evidence, research_notes, decided_at, created_at, updated_at')
  .eq('business_id', HL).eq('source', 'web_visit').is('visit_id', null).gte('created_at', '2026-11-12T00:00:00Z').lt('created_at', '2026-11-13T00:00:00Z').order('created_at'));
console.log(`== scope: ${targets.length} targets (expected ${EXPECTED}) · created ${targets[0]?.created_at.slice(0, 19)} … ${targets[targets.length - 1]?.created_at.slice(0, 19)} UTC`);
if (targets.length !== EXPECTED) { console.log('ABORT: the scope is not the declared 77'); process.exit(1); }
const ids = targets.map(t => t.id);
const [visits, people, todos, runs, signals, events, settings] = await Promise.all([
  selectAllPages(() => svc.from('web_visits').select('id, company_key, matched_type, matched_id, us_500, visits_7d, last_visit, pulled_on').eq('business_id', HL).order('id')),
  selectAllPages(() => svc.from('sales_people').select('id, target_id, name, title, archived_at').eq('business_id', HL).in('target_id', ids).order('id')),
  selectAllPages(() => svc.from('sales_week_goals').select('id, link_id, status').eq('business_id', HL).eq('link_type', 'target').in('link_id', ids).order('id')),
  selectAllPages(() => svc.from('research_runs').select('id, entity_id').eq('business_id', HL).eq('entity_type', 'target').in('entity_id', ids).order('id')),
  selectAllPages(() => svc.from('sales_signals').select('id, target_id').eq('business_id', HL).in('target_id', ids).order('id')),
  selectAllPages(() => svc.from('sales_source_events').select('id, record_id, reason').eq('business_id', HL).eq('record_type', 'target').in('record_id', ids).order('id')),
  svc.from('sales_settings').select('buyer_titles').eq('business_id', HL).maybeSingle().then(must),
]);
const visitKeys = new Set(visits.map(v => v.company_key)), visitMatched = new Set(visits.filter(v => v.matched_type === 'target').map(v => v.matched_id));
const latest = new Map();
for (const v of visits) for (const k of [v.company_key, v.matched_type === 'target' ? v.matched_id : null]) if (k && (!latest.has(k) || v.pulled_on > latest.get(k).pulled_on)) latest.set(k, v);
const by = (rows, key) => rows.reduce((m, r) => m.set(r[key], [...(m.get(r[key]) || []), r]), new Map());
const peopleOf = by(people.filter(p => !p.archived_at), 'target_id'), todosOf = by(todos, 'link_id'), runsOf = by(runs, 'entity_id'), signalsOf = by(signals, 'target_id'), eventsOf = by(events.filter(e => e.reason !== 'create'), 'record_id');
const plan = targets.map(t => {
  const keep = [];
  if (visitKeys.has(normName(t.name)) || visitMatched.has(t.id)) keep.push('a web_visits row');
  if (t.employees != null && t.employees >= RECORD_MIN_EMPLOYEES) keep.push(`headcount ${t.employees}`);
  const ppl = peopleOf.get(t.id) || [];
  if (hasBuyerTitle(ppl, settings?.buyer_titles || [])) keep.push(`buyer title (${ppl.filter(p => hasBuyerTitle([p], settings.buyer_titles)).map(p => noAt(p.title)).join(', ')})`);
  const touch = [];
  if (t.status !== 'researching') touch.push(`status ${t.status}`);
  if (t.owner_user_id) touch.push('an owner');
  if (todosOf.has(t.id)) touch.push(`${todosOf.get(t.id).length} to-do`);
  if (runsOf.has(t.id)) touch.push(`${runsOf.get(t.id).length} research run`);
  if (signalsOf.has(t.id)) touch.push('a signal');
  if (eventsOf.has(t.id)) touch.push('a source change');
  if (t.employees_source === 'manual') touch.push('a typed headcount');
  if (!/^\(\d+\/\d+\) Identified visitor/.test(t.research_notes || '') || !/^Identified visitor/.test(t.evidence || '')) touch.push('edited notes');
  if (touch.length) keep.push(`touch: ${touch.join(', ')}`);
  const v = latest.get(t.id) || latest.get(normName(t.name)) || null;
  const passes = !!v && (v.us_500 === true || hasBuyerTitle(ppl, settings?.buyer_titles || []));
  return { id: t.id, name: t.name, employees: t.employees, people: ppl.length, keep, visit: v, passes, prior: { status: t.status, decided_at: t.decided_at, updated_at: t.updated_at } };
});
const kept = plan.filter(p => p.keep.length), archive = plan.filter(p => !p.keep.length);
console.log(`\n== KEEP ${kept.length} (not archived)`);
for (const p of kept) console.log(`  ${noAt(p.name)} - ${p.keep.join(' · ')}${p.visit ? ` (latest row ${p.visit.pulled_on}, ${p.visit.visits_7d ?? 0} visits 7 d, US 500+ ${p.visit.us_500 ? 'yes' : 'no'})` : ''}`);
const onlyVisit = kept.filter(p => p.keep.length === 1 && p.keep[0] === 'a web_visits row');
console.log(`\n== of the ${kept.length} kept: ${kept.filter(p => p.passes).length} would be created by the NEW rule (visit row + US 500+ or a buyer title) · ${kept.filter(p => !p.passes).length} would not · kept ONLY because a web_visits row exists: ${onlyVisit.length} (of those, US 500+ on the row: ${onlyVisit.filter(p => p.visit?.us_500).length}; headcount unknown: ${onlyVisit.filter(p => p.employees == null).length}; headcount under 500: ${onlyVisit.filter(p => p.employees != null).length})`);
console.log(`   visit rows first pulled before the target existed: ${kept.filter(p => p.visit && visits.some(v => (v.company_key === normName(p.name) || v.matched_id === p.id) && v.pulled_on < '2026-11-12')).length} of ${kept.filter(p => p.visit).length}`);
console.log(`\n== ARCHIVE ${archive.length} (no visit row, no headcount >= 500, no buyer title, no touch) · their people stay filed: ${archive.reduce((n, p) => n + p.people, 0)}`);
console.log(`  ${archive.map(p => `${noAt(p.name)}${p.employees == null ? '' : ` [${p.employees}]`}`).join('; ')}`);

if (APPLY) {
  const owners = must(await svc.from('profiles').select('id').eq('is_platform_owner', true));
  if (owners.length !== 1) throw new Error('expected exactly one platform owner profile');
  const file = path.join(ROOT, 'audits', `visitor-people-filing-v1-nov12-archive-apply-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ business_id: HL, at: new Date().toISOString(), how: 'rejectTarget (status rejected + decided_at); undo = POST prospect-targets/:id/reject { undo: true }, or set status / decided_at back to prior', archived: archive.map(p => ({ id: p.id, name: p.name, prior: p.prior })), kept: kept.map(p => ({ id: p.id, name: p.name, why: p.keep })) }, null, 2));
  console.log(`\nmanifest written first: ${file}`);
  let done = 0; const failed = [];
  for (const p of archive) {
    const r = await rejectTarget(svc, { businessId: HL, targetId: p.id, body: {}, userId: owners[0].id });
    if (r.status === 200 && r.body.target?.status === 'rejected' && !(r.body.dropped || []).length) done++; else failed.push(`${noAt(p.name)}: ${r.status} ${noAt(r.body?.error || '')}`);
  }
  console.log(`== APPLIED: ${done} of ${archive.length} archived${failed.length ? ` · FAILED ${failed.length}: ${failed.join('; ')}` : ''}`);
  const after = must(await svc.from('sales_targets').select('id, status').in('id', ids));
  const statusOf = new Map(after.map(t => [t.id, t.status]));
  console.log(`read back: archived rows now rejected ${archive.filter(p => statusOf.get(p.id) === 'rejected').length} of ${archive.length} · kept rows unchanged ${kept.filter(p => statusOf.get(p.id) === p.prior.status).length} of ${kept.length} · rows deleted ${ids.length - after.length}`);
}
console.log(`\nnetwork: Supabase GETs ${net.gets} · writes ${net.writes} · Apollo 0 · Claude 0`);
process.exit(0);
