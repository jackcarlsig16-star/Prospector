// top-targets-v1 Stage 0 - READ-ONLY numbers from the real HomeLover book. DECLARED before it runs:
//   Supabase  ~8 table reads through selectAllPages (sales_opportunities, sales_targets, sales_goals, sales_company_scores,
//             business_members, sales_settings; each < 1,000 rows, the firmographics column included -> under 3 MB),
//             0 writes (a non-GET throws). Apollo 0. Claude 0. Cap 60 s.
//   Prints company names and counts only - never a person, an address or a phone.
// The impact simulation adds a candidate impact component ON TOP of the stored score (sales_company_scores.score, the
// last recompute) - it does not recompute the other ten components and writes nothing.
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
delete process.env.ANTHROPIC_API_KEY;
setTimeout(() => { console.log('ABORT 60 s cap'); process.exit(2); }, 60000).unref();
const supaHost = new URL(process.env.SUPABASE_URL).host;
let gets = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method || 'GET').toUpperCase();
  if (url.host === supaHost && ['GET', 'HEAD'].includes(method)) { gets++; return realFetch(input, init); }
  throw new Error(`guard: refused ${method} ${url.host}${url.pathname}`);
};
const { createClient } = require('@supabase/supabase-js');
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { DEFAULT_WEIGHTS, bandFor } = await import('../../api/sales/intentScore.js');
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const HL = must(await svc.from('businesses').select('id').ilike('name', 'homelover'))[0].id;
const all = (t, cols, build = q => q) => selectAllPages(() => build(svc.from(t).select(cols).eq('business_id', HL)).order('id'));
const tally = (rows, f) => { const m = new Map(); for (const r of rows) { const k = f(r); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
const show = pairs => pairs.map(([k, n]) => `${k === null || k === undefined || k === '' ? '(empty)' : k} ${n}`).join(' · ') || 'none';
const set = v => v !== null && v !== undefined && v !== '';
const H = s => console.log(`\n== ${s}`);

const [opps, targets, goals, scores, members, settings] = await Promise.all([
  all('sales_opportunities', 'id, organization, org_type, cohort, tier, priority, priority_set_at, is_top, covered_lives, stage, archived_at, owner_user_id, owner_team, co_owner_name, source_kind, source_partner_id, employees, client_status, signed_date, fit_level, apollo_firmographics'),
  all('sales_targets', 'id, name, kind, status, suggested_category, owner_user_id, owner_team, co_owner_name, source_kind, source_partner_id, employees, fit_level, apollo_firmographics'),
  all('sales_goals', 'id, name, category, tier, priority, priority_set_at, hot, pipeline_status, archived_at, owner_user_id, owner_team, co_owner_name, source_kind, source_partner_id, employees, fit_level, apollo_firmographics', q => q.eq('goal_type', 'partnership')),
  selectAllPages(() => svc.from('sales_company_scores').select('company_type, company_id, score, band, components, source_kind, source_label, closed, flagged_out, duplicate_of, override, computed_at').eq('business_id', HL).order('company_id')),
  svc.from('business_members').select('user_id, role, name, profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', HL).not('user_id', 'is', null).order('created_at').then(must),
  svc.from('sales_settings').select('score_weights').eq('business_id', HL).maybeSingle().then(must),
]);
const firstName = id => String((members.find(m => m.user_id === id)?.profile?.display_name || members.find(m => m.user_id === id)?.name || '')).trim().split(/\s+/)[0] || null;
console.log(`rows read: employers ${opps.length} (archived ${opps.filter(o => o.archived_at).length}) · targets ${targets.length} · partners ${goals.length} (archived ${goals.filter(g => g.archived_at).length}) · scores ${scores.length} · members ${members.length} · score_weights in settings: ${settings?.score_weights ? `yes (caps ${JSON.stringify(settings.score_weights.caps || {})})` : 'no (code defaults)'}`);

H('(a) LEGACY FIELDS - employers (sales_opportunities)');
for (const col of ['cohort', 'tier', 'priority']) console.log(`${col}: set on ${opps.filter(o => set(o[col])).length} of ${opps.length} (live rows ${opps.filter(o => set(o[col]) && !o.archived_at).length}) · values: ${show(tally(opps.filter(o => set(o[col])), o => o[col]))}`);
console.log(`priority_set_at present on ${opps.filter(o => o.priority_set_at).length} employers (a hand-set priority with a date)`);
console.log(`is_top = true: ${opps.filter(o => o.is_top).length} (live ${opps.filter(o => o.is_top && !o.archived_at).length}) - ${opps.filter(o => o.is_top && !o.archived_at).map(o => o.organization).join('; ')}`);
console.log(`also on the table: org_type ${show(tally(opps, o => o.org_type))} · covered_lives set on ${opps.filter(o => set(o.covered_lives)).length}`);
H('(a) LEGACY FIELDS - partners (sales_goals, partnership)');
for (const col of ['category', 'tier', 'priority']) console.log(`${col}: set on ${goals.filter(g => set(g[col])).length} of ${goals.length} (live rows ${goals.filter(g => set(g[col]) && !g.archived_at).length}) · values: ${show(tally(goals.filter(g => set(g[col])), g => g[col]))}`);
console.log(`priority_set_at present on ${goals.filter(g => g.priority_set_at).length} partners`);
console.log(`tier x category (live): ${show(tally(goals.filter(g => !g.archived_at && set(g.tier)), g => `${g.tier} / ${g.category || '(no category)'}`))}`);

H('(e) PARTNER hot');
const hot = goals.filter(g => g.hot);
console.log(`hot = true: ${hot.length} of ${goals.length} partners (live ${hot.filter(g => !g.archived_at).length}) - ${hot.map(g => `${g.name}${g.archived_at ? ' [archived]' : ''} (${g.pipeline_status}${g.tier ? `, tier ${g.tier}` : ''})`).join('; ')}`);

// ---- the book the ranking covers: records with a stored score, not archived, not closed / flagged out / a duplicate
const rec = new Map();
for (const o of opps) rec.set(`employer:${o.id}`, { type: 'employer', name: o.organization, stage: o.stage, archived: !!o.archived_at, ...o });
for (const t of targets) rec.set(`target:${t.id}`, { type: 'target', name: t.name, stage: t.status, archived: false, ...t });
for (const g of goals) rec.set(`partner:${g.id}`, { type: 'partner', name: g.name, stage: g.pipeline_status, archived: !!g.archived_at, ...g });
const book = scores.map(s => ({ s, r: rec.get(`${s.company_type}:${s.company_id}`) })).filter(x => x.r && !x.r.archived);
const open = book.filter(x => !x.s.closed && !x.s.flagged_out && !x.s.duplicate_of);
H('(b) THE BOOK');
console.log(`scored records ${scores.length} · with a live record ${book.length} · open (not closed, not flagged out as won / pilot, not a duplicate) ${open.length}: ${show(tally(open, x => x.r.type))}`);
console.log(`left out: closed ${book.filter(x => x.s.closed).length} · flagged out (won / pilot) ${book.filter(x => x.s.flagged_out).length} · duplicates ${book.filter(x => x.s.duplicate_of).length} · hand-set priority active ${book.filter(x => x.s.override).length}`);
console.log(`bands today (open): ${show(tally(open, x => x.s.band).sort())} · last computed ${scores.map(s => s.computed_at).sort().pop()?.slice(0, 16)}`);

const sizeBand = e => (e == null ? 'unknown' : e >= 5000 ? '5,000+' : e >= 1000 ? '1,000-4,999' : e >= 200 ? '200-999' : '< 200');
const SIZE_ORDER = ['5,000+', '1,000-4,999', '200-999', '< 200', 'unknown'];
console.log(`\nheadcount band (open): ${SIZE_ORDER.map(b => `${b} ${open.filter(x => sizeBand(x.r.employees) === b).length}`).join(' · ')}`);
for (const t of ['employer', 'target', 'partner']) console.log(`  ${t}: ${SIZE_ORDER.map(b => `${b} ${open.filter(x => x.r.type === t && sizeBand(x.r.employees) === b).length}`).join(' · ')}`);
console.log(`the fit component already scores size: ${show(tally(open, x => x.s.components?.fit?.inputs?.why ?? '(no why)').slice(0, 8))}`);

const BRAD = x => ['upside', 'both'].includes(x.r.owner_team || '') || /brad/i.test(x.r.co_owner_name || '') || x.s.components?.source?.inputs?.via_upside === true;
const NAMED = x => x.s.components?.source?.inputs?.named === true;
const REFERRED = x => x.r.source_kind === 'partner_referral' || !!x.r.source_partner_id;
console.log(`\nstrategic-flag sources (open): named by Brad (source.named) ${open.filter(NAMED).length} · partner-referred (source_kind partner_referral or a source partner) ${open.filter(REFERRED).length} · Brad / Upside (owner_team upside|both, co-owner Brad, or via Upside) ${open.filter(BRAD).length} · any of the three ${open.filter(x => NAMED(x) || REFERRED(x) || BRAD(x)).length}`);
console.log(`"target segment" candidates on the records: employers org_type ${show(tally(opps.filter(o => !o.archived_at), o => o.org_type))} · targets kind ${show(tally(targets, t => t.kind))} · targets suggested_category ${show(tally(targets.filter(t => set(t.suggested_category)), t => t.suggested_category))} · fit_level (typed) ${show(tally(open, x => x.r.fit_level || '(none)'))}`);
console.log(`source_kind (open): ${show(tally(open, x => x.r.source_kind || '(none)'))}`);

const PROX = st => (/meeting|proposal|negotiat|verbal|contract/i.test(st || '') ? 'meeting' : /respond|replied|interested/i.test(st || '') ? 'responded' : /contact|email|sequence/i.test(st || '') ? 'contacted' : 'cold');
console.log(`\nstage (open), raw: ${show(tally(open, x => `${x.r.type}:${x.r.stage}`))}`);
console.log(`stage proximity (regex: meeting|proposal|negotiat|verbal|contract -> meeting; respond|replied|interested -> responded; contact|email|sequence -> contacted; else cold): ${['meeting', 'responded', 'contacted', 'cold'].map(p => `${p} ${open.filter(x => PROX(x.r.stage) === p).length}`).join(' · ')}`);
console.log(`the stage component already scores: ${show(tally(open.filter(x => x.s.components?.stage?.points), x => `${x.s.components.stage.inputs.stage} +${x.s.components.stage.points}`))}`);

const industry = r => { const f = r.apollo_firmographics || {}; return String(f.industry || f.industries?.[0] || '').trim().toLowerCase() || null; };
const clients = opps.filter(o => !o.archived_at && (set(o.client_status) || o.signed_date || DEFAULT_WEIGHTS.stages.closed_won.includes(o.stage)));
const clientIndustries = tally(clients.filter(industry), industry);
const adj = new Set(clientIndustries.map(([k]) => k));
console.log(`\nclients (client_status set, a signed date, or a won stage): ${clients.length} - ${clients.map(o => `${o.organization} [${o.client_status || o.stage}${industry(o) ? `, ${industry(o)}` : ', no industry'}]`).join('; ')}`);
console.log(`an industry on the record (apollo_firmographics.industry): ${open.filter(x => industry(x.r)).length} of ${open.length} open · client industries: ${show(clientIndustries)}`);
const ADJ = x => !!industry(x.r) && adj.has(industry(x.r));
console.log(`client-adjacency hits (open, same industry as a client): ${open.filter(ADJ).length} - by industry ${show(tally(open.filter(ADJ), x => industry(x.r)))}`);

console.log(`client_status on employers: ${show(tally(opps.filter(o => !o.archived_at), o => o.client_status || '(none)'))} · flagged out as won / pilot by the score: ${book.filter(x => x.s.flagged_out).map(x => `${x.r.name} [${x.r.type}:${x.r.stage}]`).join('; ')}`);
// The employer "cohort" field is an industry label typed at import - the only industry most employers carry.
const clientCohorts = new Set(clients.map(o => o.cohort).filter(set));
console.log(`adjacency through the employer cohort field instead: client cohorts ${[...clientCohorts].join(', ') || 'none'} · open employers in the same cohort ${open.filter(x => x.r.type === 'employer' && clientCohorts.has(x.r.cohort)).length} · open companies with a cohort ${open.filter(x => set(x.r.cohort)).length} of ${open.length} (targets and partners have no cohort column)`);
console.log(`hand-set priority (the score's override, 30 days): active on ${open.filter(x => x.s.override).length} open companies - ${open.filter(x => x.s.override).map(x => `${x.r.name} P${x.s.override.priority} (scored ${x.s.override.scored}, shown ${x.s.score})`).join('; ')}`);

// ---- three candidate impact sets, added to the stored score (the closed ceiling and an active hand-set priority keep the stored score)
const SETS = {
  'A size-led (cap 12)': { cap: 12, size: { '5,000+': 8, '1,000-4,999': 6, '200-999': 3, '< 200': 0, unknown: 1 }, strategic: { named: 3, referred: 3, brad: 2 }, stage: { meeting: 2, responded: 1, contacted: 0, cold: 0 }, adjacency: 1 },
  'B strategic-led (cap 12)': { cap: 12, size: { '5,000+': 4, '1,000-4,999': 3, '200-999': 1, '< 200': 0, unknown: 0 }, strategic: { named: 7, referred: 6, brad: 3 }, stage: { meeting: 2, responded: 1, contacted: 0, cold: 0 }, adjacency: 2 },
  'C balanced (cap 20)': { cap: 20, size: { '5,000+': 8, '1,000-4,999': 6, '200-999': 3, '< 200': 0, unknown: 1 }, strategic: { named: 6, referred: 5, brad: 3 }, stage: { meeting: 4, responded: 3, contacted: 1, cold: 0 }, adjacency: 2 },
};
const impact = (x, w) => {
  const strategic = Math.max(NAMED(x) ? w.strategic.named : 0, REFERRED(x) ? w.strategic.referred : 0, BRAD(x) ? w.strategic.brad : 0);
  return Math.min(w.cap, w.size[sizeBand(x.r.employees)] + strategic + w.stage[PROX(x.r.stage)] + (ADJ(x) ? w.adjacency : 0));
};
const th = settings?.score_weights?.thresholds || DEFAULT_WEIGHTS.thresholds;
const rank = list => [...list].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
const base = rank(open.map(x => ({ key: `${x.s.company_type}:${x.s.company_id}`, name: x.r.name, type: x.r.type, score: x.s.score })));
const basePos = new Map(base.map((r, i) => [r.key, i + 1]));
const why = x => [sizeBand(x.r.employees), NAMED(x) ? 'named' : REFERRED(x) ? 'referred' : BRAD(x) ? 'Brad' : null, PROX(x.r.stage) !== 'cold' ? PROX(x.r.stage) : null, ADJ(x) ? 'client industry' : null].filter(Boolean).join(', ');
H('(b) TOP 20 TODAY (the stored score, no impact)');
console.log(base.slice(0, 20).map((r, i) => `${i + 1}. ${r.name} [${r.type}] ${r.score}`).join('\n'));
for (const [label, w] of Object.entries(SETS)) {
  const sim = rank(open.map(x => ({ key: `${x.s.company_type}:${x.s.company_id}`, name: x.r.name, type: x.r.type, was: x.s.score, add: x.s.override ? 0 : impact(x, w), score: x.s.override ? x.s.score : Math.min(100, x.s.score + impact(x, w)), why: why(x) })));
  H(`(b) SET ${label}: size ${JSON.stringify(w.size)} · strategic ${JSON.stringify(w.strategic)} (the largest one) · stage ${JSON.stringify(w.stage)} · client industry +${w.adjacency}`);
  console.log(`bands: ${['P1', 'P2', 'P3', 'P4'].map(b => `${b} ${sim.filter(r => bandFor(r.score, th) === b).length} (today ${open.filter(x => x.s.band === b).length})`).join(' · ')} · impact points: mean ${(sim.reduce((n, r) => n + r.add, 0) / sim.length).toFixed(1)}, at the cap ${sim.filter(r => r.add === w.cap).length}, zero ${sim.filter(r => r.add === 0).length}`);
  const top = sim.slice(0, 20);
  console.log(top.map((r, i) => `${i + 1}. ${r.name} [${r.type}] ${r.was} + ${r.add} = ${r.score} (was #${basePos.get(r.key)}) · ${r.why}`).join('\n'));
  const baseTop = new Set(base.slice(0, 20).map(r => r.key));
  console.log(`enters the top 20: ${top.filter(r => !baseTop.has(r.key)).map(r => r.name).join('; ') || 'nobody'} · leaves: ${base.slice(0, 20).filter(r => !top.some(t => t.key === r.key)).map(r => r.name).join('; ') || 'nobody'}`);
}

H('(c) OWNERS (open companies, the stored band)');
const owners = [...members.map(m => m.user_id), null];
for (const id of owners) {
  const mine = open.filter(x => (x.r.owner_user_id || null) === id);
  console.log(`${id ? firstName(id) : 'Unassigned'}: ${mine.length} companies (${show(tally(mine, x => x.r.type))}) · ${['P1', 'P2', 'P3', 'P4'].map(b => `${b} ${mine.filter(x => x.s.band === b).length}`).join(' · ')}${id && mine.length ? ` · top 5: ${rank(mine.map(x => ({ name: x.r.name, score: x.s.score }))).slice(0, 5).map(r => `${r.name} ${r.score}`).join('; ')}` : ''}`);
}
const strangers = open.filter(x => x.r.owner_user_id && !members.some(m => m.user_id === x.r.owner_user_id)).length;
console.log(`owned by someone who is not a member: ${strangers} · every live record (scored or not): ${[...rec.values()].filter(r => !r.archived).length}, without a score row ${[...rec.entries()].filter(([k, r]) => !r.archived && !scores.some(s => `${s.company_type}:${s.company_id}` === k)).length}`);
console.log(`\nnetwork: Supabase GETs ${gets} · writes 0 · Apollo 0 · Claude 0`);
process.exit(0);
