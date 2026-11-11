// todo-events-v1 Stage 1 - READ-ONLY: what the migration's two backfills will touch on HomeLover, computed the way
// the migration states them. Declared: sales_week_goals paged (all rows of the workspace, ~450), the three record
// tables' names, one count of the table per workspace; ~10 requests, under 1 MB, ~10 s; cap 60 s. 0 writes (the
// guard throws on one), 0 Claude, 0 Apollo. Writes one JSON (ids, record names, to-do text for the link rows) to the
// path given as argv[2] - outside the repo - and prints counts.
import fs from 'fs';
import { svc, HL, cap, footer } from './homelover-data-model-v1-lib.mjs';
cap(60);
const { openTodosFor } = await import('../../api/sales/openTodos.js');
const { normName } = await import('../../api/sales/intakeMatch.js');
const { hasPii } = await import('../../api/sales/scrubText.js');
const page = async (table, cols, f = q => q) => { const out = []; for (let i = 0; ; i += 1000) { const r = await f(svc.from(table).select(cols).eq('business_id', HL)).order('id').range(i, i + 999); if (r.error) throw new Error(r.error.message); out.push(...r.data); if (r.data.length < 1000) break; } return out; };
const all = await page('sales_week_goals', 'id, kind, status, text, link_type, link_id, source_note_id, carried_from_id, plan_id, prospect_contact_id, created_by, created_at, updated_at');
// R7, in the migration's order: call notes -> "Follow up:" -> "Contacted" done -> no creator -> manual
const origin = r => (r.source_note_id ? 'call_notes' : /^Follow up: /.test(r.text || '') ? 'scout' : (/^Contacted /.test(r.text || '') && r.status === 'done') ? 'panel' : !r.created_by ? 'system' : 'manual');
const tally = rows => Object.entries(rows.reduce((m, r) => (m[origin(r)] = (m[origin(r)] || 0) + 1, m), {})).sort().map(([k, n]) => `${k} ${n}`).join(' · ');
const todos = all.filter(r => r.kind === 'todo'), other = all.filter(r => r.kind !== 'todo');
console.log(`rows ${all.length} · kind=todo ${todos.length}: ${tally(todos)}`);
console.log(`other kinds ${other.length}: ${Object.entries(other.reduce((m, r) => (m[`${r.kind}:${origin(r)}`] = (m[`${r.kind}:${origin(r)}`] || 0) + 1, m), {})).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
const fu = todos.filter(r => /^Follow up: /.test(r.text || ''));
console.log(`"Follow up:" to-dos ${fu.length}: with source_note_id ${fu.filter(r => r.source_note_id).length} · flags (prospect_contact_id) ${fu.filter(r => r.prospect_contact_id).length} · no creator ${fu.filter(r => !r.created_by).length}`);
console.log(`flags ${todos.filter(r => r.prospect_contact_id).length}: with source_note_id ${todos.filter(r => r.prospect_contact_id && r.source_note_id).length} · "Contacted " rows ${todos.filter(r => /^Contacted /.test(r.text || '')).length} (done ${todos.filter(r => /^Contacted /.test(r.text || '') && r.status === 'done').length}, with a note ${todos.filter(r => /^Contacted /.test(r.text || '') && r.source_note_id).length}, no creator ${todos.filter(r => /^Contacted /.test(r.text || '') && !r.created_by).length}) · no creator ${todos.filter(r => !r.created_by).length} (with a note ${todos.filter(r => !r.created_by && r.source_note_id).length}) · carried ${todos.filter(r => r.carried_from_id).length} · plan ${todos.filter(r => r.plan_id).length}`);
const per = await svc.from('sales_week_goals').select('business_id').neq('business_id', HL).limit(1000);
console.log(`rows in other workspaces: ${per.data.length} (${new Set(per.data.map(r => r.business_id)).size} workspaces)`);

const { rows: open } = await openTodosFor(svc, HL);
const full = new Map(all.map(r => [r.id, r]));
const recs = [...(await page('sales_goals', 'id, name', q => q.eq('goal_type', 'partnership').is('archived_at', null))).map(r => ['partner', r.id, r.name]), ...(await page('sales_opportunities', 'id, organization', q => q.is('archived_at', null))).map(r => ['opportunity', r.id, r.organization]), ...(await page('sales_targets', 'id, name')).map(r => ['target', r.id, r.name])].map(([t, id, name]) => ({ t, id, name, n: normName(name) })).filter(x => x.n.length >= 4);
const linked = r => ['partner', 'opportunity', 'target'].includes(r.link_type) && recs.some(x => x.t === r.link_type && x.id === r.link_id);
const unl = open.filter(r => !linked(r));
const safe = s => (hasPii(s) ? '[text withheld: address or phone shape]' : s);
const out = { one: [], ambiguous: [], skipped_has_other_link: [] };
for (const r of unl) {
  const tx = ` ${normName(r.text)} `;
  const h = recs.filter(x => tx.includes(` ${x.n} `));
  if (!h.length) continue;
  const row = full.get(r.id);
  const item = { id: r.id, text: safe(String(r.text).slice(0, 140)), link_type: row.link_type, link_id: row.link_id, status: row.status, kind: row.kind, hits: h.map(x => ({ type: x.t, id: x.id, name: x.name })) };
  if (row.link_type || row.link_id) out.skipped_has_other_link.push(item);
  else if (h.length === 1) out.one.push(item);
  else out.ambiguous.push({ ...item, why: new Set(h.map(x => x.n)).size === 1 ? 'one company, two record kinds' : 'names two or more companies' });
}
console.log(`unlinked open to-dos ${unl.length}: exactly one record ${out.one.length} · ambiguous ${out.ambiguous.length} (${out.ambiguous.filter(a => a.why.startsWith('one')).length} two-kinds, ${out.ambiguous.filter(a => a.why.startsWith('names')).length} multi-name) · name a record but already carry a commitment / metric / company link ${out.skipped_has_other_link.length}`);
console.log(`open to-dos ${open.length} · linked to a record today ${open.filter(linked).length}`);
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
footer();
