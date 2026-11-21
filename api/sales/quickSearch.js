import { normName } from './normName.js';
import { cleanText, hasPii } from './scrubText.js';
import { nameKey } from './peopleMerge.js';
import { todoDone } from './openTodos.js';
import { loadMembers } from './teamEmails/send.js';
import { isSnoozed } from '../../src/constants/todoSnooze.js';
import { PIPELINE_STATUSES } from '../../src/constants/partnerPipeline.js';

// app-shell-v2 S2 - the sales module's reader for the header's one field (GET /api/search): companies (the three
// record tables), people (the three person tables) and open to-dos, matched on names and text. ONE read set: seven
// limited ilike reads in parallel, then at most five small reads for what matched (scores, heat, steps, the companies
// to-dos link to, to-dos linked to a matched company). Names, titles and companies only - no address, no phone; 0
// Claude, 0 Apollo, nothing written. Each row carries the opener Scout already uses for that record.
export const PER_GROUP = 3, READ_LIMIT = 25;
const must = r => { if (r.error) throw new Error(r.error.message); return r.data || []; };
const pat = q => `%${String(q).replace(/[%_,()"'\\]/g, ' ').replace(/\s+/g, ' ').trim()}%`;
const sales = params => ({ page: 'sales', params });
const STATUS = Object.fromEntries(PIPELINE_STATUSES.map(s => [s.id, s.label]));
const words = v => String(v || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const clean = (v, n = 120) => cleanText(String(v || ''), n);
// A name that starts with the query ranks above one that only contains it; ties by score, then by name.
const rank = (q, name) => { const n = normName(name || ''), k = normName(q); return n === k ? 0 : n.startsWith(k) ? 1 : n.split(' ').some(w => w.startsWith(k)) ? 2 : 3; };

export async function quickSearch(sb, { businessId, q, today }) {
  const p = pat(q);
  const of = (table, cols) => sb.from(table).select(cols).eq('business_id', businessId);
  const [partners, employers, targets, prospects, contacts, people, todosByText, members] = await Promise.all([
    of('sales_goals', 'id, name, pipeline_status, owner_user_id').eq('goal_type', 'partnership').is('archived_at', null).ilike('name', p).limit(READ_LIMIT).then(must),
    of('sales_opportunities', 'id, organization, stage, owner_user_id').is('archived_at', null).ilike('organization', p).limit(READ_LIMIT).then(must),
    of('sales_targets', 'id, name, status, owner_user_id, employer_id').ilike('name', p).limit(READ_LIMIT).then(must),
    of('sales_prospect_state', 'contact_id, name, title, company').or(`name.ilike.${p},company.ilike.${p}`).limit(READ_LIMIT).then(must),
    of('partner_contacts', 'id, name, title, goal_id, apollo_contact_id').ilike('name', p).limit(READ_LIMIT).then(must),
    of('sales_people', 'id, name, title, company_name').is('archived_at', null).or(`name.ilike.${p},company_name.ilike.${p}`).limit(READ_LIMIT).then(must),
    of('sales_week_goals', 'id, text, due_date, owner_user_id, link_type, link_id, status, snooze_until, created_at').eq('kind', 'todo').eq('status', 'open').is('prospect_contact_id', null).ilike('text', p).limit(READ_LIMIT).then(must),
    loadMembers(sb, businessId),
  ]);
  const nameOf = new Map(members.map(m => [m.userId, m.firstName || null]));
  const owner = id => (id && nameOf.has(id) ? { id, name: nameOf.get(id) } : null);

  const companyRows = [
    ...partners.map(r => ({ type: 'partner', id: r.id, name: r.name, sub: `Partner · ${STATUS[r.pipeline_status] || words(r.pipeline_status || 'not_started')}`, owner: owner(r.owner_user_id) })),
    ...employers.map(r => ({ type: 'employer', id: r.id, name: r.organization, sub: `Employer · ${words(r.stage || 'target')}`, owner: owner(r.owner_user_id) })),
    ...targets.filter(r => !r.employer_id).map(r => ({ type: 'target', id: r.id, name: r.name, sub: 'Target', owner: owner(r.owner_user_id) })),
  ];
  const companyIds = companyRows.map(r => r.id);
  const goalIds = [...new Set(contacts.map(c => c.goal_id).filter(Boolean))];
  const [scores, todosByCompany, contactGoals] = await Promise.all([
    companyIds.length ? of('sales_company_scores', 'company_type, company_id, score, band').in('company_id', companyIds).then(must) : [],
    companyIds.length ? of('sales_week_goals', 'id, text, due_date, owner_user_id, link_type, link_id, status, snooze_until, created_at').eq('kind', 'todo').eq('status', 'open').is('prospect_contact_id', null).in('link_id', companyIds).limit(READ_LIMIT).then(must) : [],
    goalIds.length ? of('sales_goals', 'id, name').in('id', goalIds).then(must) : [],
  ]);
  const scoreOf = new Map(scores.map(s => [`${s.company_type}:${s.company_id}`, s]));
  const companies = companyRows.map(r => { const s = scoreOf.get(`${r.type}:${r.id}`); return { ...r, pill: s ? { label: s.band, value: s.score } : null }; })
    .sort((a, b) => rank(q, a.name) - rank(q, b.name) || (b.pill?.value ?? -1) - (a.pill?.value ?? -1) || a.name.localeCompare(b.name));

  // People: one row per person by the People table's own merge rule (the same Apollo contact, else name + company).
  const goalName = new Map(contactGoals.map(g => [g.id, g.name]));
  const raw = [
    ...prospects.map(r => ({ key: `prospect:${r.contact_id}`, apollo: r.contact_id, name: r.name, title: r.title, company: r.company })),
    ...contacts.map(r => ({ key: `contact:${r.id}`, apollo: r.apollo_contact_id || null, name: r.name, title: r.title, company: goalName.get(r.goal_id) || null })),
    ...people.map(r => ({ key: `person:${r.id}`, apollo: null, name: r.name, title: r.title, company: r.company_name })),
  ].filter(r => r.name);
  const merged = [], byApollo = new Map(), byName = new Map();
  for (const r of raw) {
    const k = nameKey(r.name, r.company);
    const hit = (r.apollo && byApollo.get(r.apollo)) || (k && byName.get(k));
    if (hit) { hit.keys.push(r.key); hit.title = hit.title || r.title; hit.company = hit.company || r.company; }
    else { const row = { ...r, keys: [r.key] }; merged.push(row); if (r.apollo) byApollo.set(r.apollo, row); if (k) byName.set(k, row); }
  }
  const keys = merged.flatMap(r => r.keys);
  const todoRows = [...new Map([...todosByText, ...todosByCompany].map(t => [t.id, t])).values()];
  const linkIds = { partner: [], employer: [], target: [] };
  for (const t of todoRows) if (linkIds[t.link_type] && t.link_id && !companyIds.includes(t.link_id)) linkIds[t.link_type].push(t.link_id);
  const [heat, steps, lp, le, lt] = await Promise.all([
    keys.length ? of('sales_person_activity', 'person_key, heat, heat_band').in('person_key', keys).then(must) : [],
    todoRows.length ? of('sales_week_goal_steps', 'goal_id, done').in('goal_id', todoRows.map(t => t.id)).then(must) : [],
    linkIds.partner.length ? of('sales_goals', 'id, name').in('id', linkIds.partner).then(must) : [],
    linkIds.employer.length ? of('sales_opportunities', 'id, organization').in('id', linkIds.employer).then(must) : [],
    linkIds.target.length ? of('sales_targets', 'id, name').in('id', linkIds.target).then(must) : [],
  ]);
  const heatOf = new Map(heat.map(h => [h.person_key, h]));
  const persons = merged.map(r => {
    const h = r.keys.map(k => heatOf.get(k)).filter(Boolean).sort((a, b) => (b.heat || 0) - (a.heat || 0))[0];
    return { ...r, pill: h?.heat_band && h.heat_band !== 'cold' ? { label: words(h.heat_band), value: h.heat } : null, byName: rank(q, r.name) < 3 || normName(r.name).includes(normName(q)) };
  }).sort((a, b) => (b.byName - a.byName) || rank(q, a.name) - rank(q, b.name) || (b.pill?.value ?? -1) - (a.pill?.value ?? -1) || a.name.localeCompare(b.name));

  const companyName = new Map([...companyRows.map(r => [`${r.type}:${r.id}`, r.name]), ...lp.map(r => [`partner:${r.id}`, r.name]), ...le.map(r => [`employer:${r.id}`, r.organization]), ...lt.map(r => [`target:${r.id}`, r.name])]);
  const todos = todoRows.map(t => ({ ...t, steps: steps.filter(s => s.goal_id === t.id) })).filter(t => !todoDone(t) && !isSnoozed(t, today))
    .sort((a, b) => ((a.due_date == null) - (b.due_date == null)) || String(a.due_date || '').localeCompare(String(b.due_date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));

  // A row whose name or text holds an address or phone shape is left out whole (never shown scrubbed).
  const group = (key, label, rows, item) => {
    const items = rows.filter(r => !hasPii(`${r.name || ''} ${r.text || ''} ${r.title || ''} ${r.company || ''}`)).map(item).filter(i => i.title && !hasPii(`${i.title} ${i.sub || ''}`));
    return { key, label, count: items.length, items: items.slice(0, PER_GROUP) };
  };
  return [
    group('companies', 'Companies', companies, r => ({ id: `${r.type}-${r.id}`, title: clean(r.name), sub: r.sub, pill: r.pill, owner: r.owner, open: sales({ tab: 'pipeline', view: 'companies', open: `${r.type}-${r.id}` }) })),
    group('people', 'People', persons, r => ({ id: r.key, title: clean(r.name), sub: [r.title, r.company].filter(Boolean).map(x => clean(x, 80)).join(' · ') || null, pill: r.pill, owner: null, open: sales({ tab: 'pipeline', view: 'people', open: `person:${r.key}` }) })),
    group('todos', 'To-dos', todos, t => ({ id: `todo:${t.id}`, title: clean(t.text, 140), sub: [companyName.get(`${t.link_type}:${t.link_id}`), nameOf.get(t.owner_user_id)].filter(Boolean).map(x => clean(x, 80)).join(' · ') || null, pill: null, owner: owner(t.owner_user_id), due: t.due_date || null, open: sales({ tab: 'actions', open: `todo:${t.id}` }) })),
  ];
}
