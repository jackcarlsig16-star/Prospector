// person-owner-v1 Stage 0 (b) - READ-ONLY backfill preview. Declared: sales_prospect_state, sales_people,
// partner_contacts, sales_opportunities, sales_goals, sales_targets and business_members paged, every workspace
// (~12 requests, under 2 MB, ~10 s; cap 60 s). 0 writes (the guard throws on one), 0 Claude, 0 Apollo. Counts only.
import { svc, HL, cap, footer } from './homelover-data-model-v1-lib.mjs';
cap(60);
const page = async (table, cols, order = 'id') => { const out = []; for (let i = 0; ; i += 1000) { const r = await svc.from(table).select(cols).order(order).range(i, i + 999); if (r.error) throw new Error(`${table}: ${r.error.message}`); out.push(...r.data); if (r.data.length < 1000) break; } return out; };
const [pros, people, contacts, opps, goals, targets, members] = await Promise.all([
  page('sales_prospect_state', 'business_id, contact_id, owner, opportunity_id, goal_id', 'contact_id'),
  page('sales_people', 'business_id, id, company_type, opportunity_id, target_id, archived_at'),
  page('partner_contacts', 'business_id, id, goal_id'),
  page('sales_opportunities', 'business_id, id, owner_user_id'), page('sales_goals', 'business_id, id, owner_user_id, goal_type'), page('sales_targets', 'business_id, id, owner_user_id'),
  page('business_members', 'business_id, user_id, name, role', 'business_id'),
]);
const own = rows => new Map(rows.map(r => [r.id, r.owner_user_id || null]));
const O = own(opps), G = own(goals), T = own(targets);
const first = n => String(n || '').trim().split(/\s+/)[0].toLowerCase();
const tally = (rows, f) => Object.entries(rows.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none';
for (const [label, keep] of [['HomeLover', r => r.business_id === HL], ['every workspace', () => true]]) {
  const m = members.filter(x => x.user_id && keep(x));
  const slug = (biz, s) => m.filter(x => x.business_id === biz && first(x.name) === s);
  const P = pros.filter(keep), S = people.filter(keep), C = contacts.filter(keep);
  console.log(`\n== ${label}`);
  console.log(`members with a user id ${m.length}; first names ${label === 'HomeLover' ? [...new Set(m.map(x => first(x.name)))].join(', ') : '(per workspace)'}; an enum name that matches 0 or 2+ members in its workspace: ${P.filter(p => ['jack', 'cyrus'].includes(p.owner) && slug(p.business_id, p.owner).length !== 1).length} prospects`);
  console.log(`sales_prospect_state ${P.length}: enum ${tally(P, p => p.owner ?? 'NULL')}`);
  const pBack = p => (['jack', 'cyrus'].includes(p.owner) ? (slug(p.business_id, p.owner).length === 1 ? `member (${p.owner})` : 'NULL (no single member for the name)') : (p.opportunity_id && O.get(p.opportunity_id)) || (p.goal_id && G.get(p.goal_id)) ? 'company owner' : `NULL (${p.opportunity_id || p.goal_id ? 'company has no owner' : 'no linked company'})`);
  console.log(`  backfill -> ${tally(P, pBack)}`);
  const sBack = s => ((s.opportunity_id && O.get(s.opportunity_id)) || (s.target_id && T.get(s.target_id)) ? 'company owner' : `NULL (${s.opportunity_id || s.target_id ? 'company has no owner' : 'no linked company'})`);
  console.log(`sales_people ${S.length} (archived ${S.filter(s => s.archived_at).length}): by company ${tally(S, s => (s.opportunity_id ? 'employer' : s.target_id ? 'target' : 'none'))}\n  backfill -> ${tally(S, sBack)}`);
  const cBack = c => (c.goal_id && G.get(c.goal_id) ? 'company owner' : `NULL (${c.goal_id ? 'partner has no owner' : 'no partner'})`);
  console.log(`partner_contacts ${C.length}\n  backfill -> ${tally(C, cBack)}`);
  if (label === 'HomeLover') { const name = id => first(m.find(x => x.user_id === id)?.name) || 'not a member'; const all = [...P.map(p => (['jack', 'cyrus'].includes(p.owner) ? p.owner : name((p.opportunity_id && O.get(p.opportunity_id)) || (p.goal_id && G.get(p.goal_id)) || null) || 'unassigned')), ...S.map(s => name((s.opportunity_id && O.get(s.opportunity_id)) || (s.target_id && T.get(s.target_id)) || null)), ...C.map(c => name((c.goal_id && G.get(c.goal_id)) || null))]; console.log(`all people after the backfill, by owner: ${tally(all, x => (x === 'not a member' ? 'unassigned' : x))}`); }
}
footer();
