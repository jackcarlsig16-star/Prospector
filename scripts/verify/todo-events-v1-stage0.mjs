// todo-events-v1 Stage 0 (b) - READ-ONLY counts on HomeLover's to-dos. Declared: sales_week_goals paged (all rows of
// the workspace, ~450), its steps for the open ones, the three record tables' names; ~15 requests, under 1 MB, ~10 s;
// cap 60 s. 0 writes (the guard throws on one), 0 Claude, 0 Apollo. Prints counts only - no to-do text, no name.
import { svc, HL, cap, footer } from './homelover-data-model-v1-lib.mjs';
cap(60);
const { openTodosFor, todoCounts } = await import('../../api/sales/openTodos.js');
const { normName } = await import('../../api/sales/intakeMatch.js');
const { laDateString } = await import('../../api/sales/laDate.js');
const today = laDateString(new Date());
const page = async (table, cols, f = q => q) => { const out = []; for (let i = 0; ; i += 1000) { const r = await f(svc.from(table).select(cols).eq('business_id', HL)).order('id').range(i, i + 999); if (r.error) throw new Error(r.error.message); out.push(...r.data); if (r.data.length < 1000) break; } return out; };
const all = await page('sales_week_goals', 'id, kind, status, text, due_date, owner_user_id, link_type, link_id, source_note_id, carried_from_id, plan_id, prospect_contact_id, category, created_by, created_at, updated_at');
const { rows: open, total } = await openTodosFor(svc, HL);
const c = todoCounts(open, today);
console.log(`sales_week_goals rows ${all.length}: ${Object.entries(all.reduce((m, r) => (m[`${r.kind}/${r.status}`] = (m[`${r.kind}/${r.status}`] || 0) + 1, m), {})).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
console.log(`open to-dos (the one definition, openTodos.js) ${total}: overdue ${c.overdue} · no date ${c.nodate} · linked partner/opportunity/target ${open.filter(r => ['partner', 'opportunity', 'target'].includes(r.link_type) && r.link_id).length} · no link_type ${open.filter(r => !r.link_type).length}`);
const origin = r => (r.prospect_contact_id ? 'flag (prospect_contact_id)' : r.source_note_id ? 'call_notes (source_note_id)' : r.carried_from_id ? 'carry_over (carried_from_id)' : r.plan_id ? 'plan (plan_id)' : /^Follow up: /.test(r.text || '') ? 'scout ("Follow up:" prefix)' : /^Contacted /.test(r.text || '') ? 'panel ("Contacted" done to-do)' : !r.created_by ? 'no created_by (seed / import)' : 'manual (the rest)');
const tally = rows => Object.entries(rows.reduce((m, r) => (m[origin(r)] = (m[origin(r)] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ');
const todos = all.filter(r => r.kind === 'todo');
console.log(`origin heuristic, every kind=todo row (${todos.length}): ${tally(todos)}`);
console.log(`origin heuristic, open to-dos (${open.length}): ${tally(open)}`);
console.log(`"Follow up:" prefix rows: ${todos.filter(r => /^Follow up: /.test(r.text || '')).length} ever · ${open.filter(r => /^Follow up: /.test(r.text || '')).length} open; kinds other than todo: ${all.filter(r => r.kind !== 'todo').length} (commitment / waiting share the table)`);
const recs = [...(await page('sales_goals', 'id, name', q => q.eq('goal_type', 'partnership').is('archived_at', null))).map(r => ['partner', r.id, r.name]), ...(await page('sales_opportunities', 'id, organization', q => q.is('archived_at', null))).map(r => ['opportunity', r.id, r.organization]), ...(await page('sales_targets', 'id, name')).map(r => ['target', r.id, r.name])].map(([t, id, n]) => ({ t, id, n: normName(n) })).filter(x => x.n.length >= 4);
const linked = r => ['partner', 'opportunity', 'target'].includes(r.link_type) && recs.some(x => x.t === r.link_type && x.id === r.link_id);
const unl = open.filter(r => !linked(r));
const hits = unl.map(r => { const tx = ` ${normName(r.text)} `; return recs.filter(x => tx.includes(` ${x.n} `)); });
const names = h => new Set(h.map(x => x.n)).size;
console.log(`unlinked open to-dos ${unl.length}: text names a record ${hits.filter(h => h.length).length} - exactly one record ${hits.filter(h => h.length === 1).length} · one NAME on two record kinds ${hits.filter(h => h.length > 1 && names(h) === 1).length} · two or more different names ${hits.filter(h => names(h) > 1).length}`);
console.log(`unlinked that already carry a non-record link (commitment / metric / company): ${unl.filter(r => r.link_type).length}`);
footer();
