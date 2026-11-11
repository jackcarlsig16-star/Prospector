// AUDIT homelover-data-model-v1 Parts A2 / A3 / C1 / C3 / D - READ-ONLY. Declared: one paged read each of ~30
// HomeLover tables (largest: sales_company_score_days for the last day only, sales_metrics_daily skipped), + one
// peopleActivity read; ~60 requests, ~6 MB, < 60 s; cap 180 s. Company names only where a drift example needs one.
import fs from 'fs';
import { svc, HL, cap, footer, ROOT } from './homelover-data-model-v1-lib.mjs';
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { normName } = await import('../../api/sales/intakeMatch.js');
const { laDateString } = await import('../../api/sales/laDate.js');
const { addDays, laMonday } = await import('../../api/sales/goalsShared.js');
const { salesReads } = await import('../../api/sales/scoutIntents.js');
cap(180);
const all = (t, cols, order = 'id', build = q => q) => selectAllPages(() => build(svc.from(t).select(cols).eq('business_id', HL)).order(order));
const today = laDateString(), DAY = 864e5;
const grp = (rows, f) => { const m = {}; for (const r of rows) { const k = f(r); m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '); };
const H = s => console.log(`\n=== ${s}`);
const P = s => console.log('  ' + s);
const ex = (rows, f, n = 2) => rows.slice(0, n).map(f).join(' ; ');
const [goals, opps, targets, people, pcs, pros, visits, scores, pact, wg, steps, pev, oev, sev, members, seqAcc, delivered, counts, fdays, msgs, sugg, runs, notes, intel, marks, fev, plans] = await Promise.all([
  all('sales_goals', 'id, name, company_domain, pipeline_status, status, owner_user_id, archived_at, employees, employees_source, apollo_firmographics, fit_level, source_kind, last_touch_at, snoozed_until, linked_opportunity_id, angle, watch_outs, do_not_say, target_titles, champion, notes, next_step, updated_at', 'id', q => q.eq('goal_type', 'partnership')),
  all('sales_opportunities', 'id, organization, domain, stage, owner, owner_user_id, archived_at, employees, employees_source, apollo_firmographics, apollo_account_id, apollo_org_id, fit_level, source_kind, client_status, objections, competitors, champion, notes, next_action, updated_at'),
  all('sales_targets', 'id, name, domain, status, kind, owner_user_id, employees, employees_source, apollo_firmographics, fit_level, source_kind, promoted_goal_id, visit_id, research_notes, evidence, updated_at'),
  all('sales_people', 'id, company_type, opportunity_id, target_id, company_name, company_domain, apollo_person_id, visit_id, archived_at'),
  all('partner_contacts', 'id, goal_id, apollo_contact_id, last_activity_at'),
  all('sales_prospect_state', 'contact_id, company, opportunity_id, goal_id, owner, status', 'contact_id'),
  all('web_visits', 'id, company_key, company_name, domain, apollo_org_id, matched_type, matched_id, visits_7d, pulled_on, seen_from, seen_to, last_visit'),
  all('sales_company_scores', 'company_type, company_id, score, band, components, source_kind, computed_at', 'company_id'),
  all('sales_person_activity', 'person_key, source_table, contact_id, heat, heat_band, computed_at', 'person_key'),
  all('sales_week_goals', 'id, kind, status, text, category, week_start, owner_user_id, due_date, link_type, link_id, prospect_contact_id, source_note_id, plan_id, carried_from_id, created_by, created_at, updated_at, completed_at, waiting_on'),
  all('sales_week_goal_steps', 'id, goal_id, done'),
  all('sales_partner_events', 'id, goal_id, event, from_status, to_status, at, touch_type, source, meta'),
  all('sales_opportunity_events', 'id, opportunity_id, event_type, from_stage, to_stage, changed_at'),
  all('sales_source_events', 'id, record_type, record_id, to_source, reason, at'),
  svc.from('business_members').select('user_id, name, role').eq('business_id', HL).then(r => r.data),
  all('sales_sequenced_accounts', 'account_id, name, employees', 'account_id'),
  all('sales_email_delivered', 'apollo_message_id, contact_id, account_id, delivered_day', 'apollo_message_id'),
  all('sales_email_daily_counts', 'day, delivered', 'day'),
  all('sales_funnel_days', '*', 'day'),
  all('sales_email_messages', 'apollo_message_id, contact_id, replied, reply_class, replied_at, delivered_at', 'apollo_message_id'),
  all('sales_suggestions', 'id, kind, ref_type, ref_id, status, decided_at'),
  all('research_runs', 'id, entity_type, entity_id, status, result, created_at'),
  all('sales_call_notes', 'id, call_date, text, extract, created_at'),
  all('business_intel_entries', 'id, source, content_type, content, project_id, created_at'),
  all('sales_stage_marks', 'id, record_type, record_id, stage'),
  all('sales_flow_events', 'id, record_type, record_id, kind, at, undone_at'),
  all('sales_week_plans', 'id, week_start, chosen_count, created_at'),
]);
const maxDay = (await svc.from('sales_company_score_days').select('day').eq('business_id', HL).order('day', { ascending: false }).limit(1)).data[0].day;
const scoreDays = await all('sales_company_score_days', 'company_type, company_id, day, score, band', 'company_id', q => q.eq('day', maxDay));
const heatMax = (await svc.from('sales_person_heat_days').select('day').eq('business_id', HL).order('day', { ascending: false }).limit(1)).data[0].day;
const heatDays = await all('sales_person_heat_days', 'person_key, day, heat, band', 'person_key', q => q.eq('day', heatMax));
const member = new Map(members.map(m => [m.user_id, (m.name || 'member').split(' ')[0]]));
const byId = rows => new Map(rows.map(r => [r.id, r]));
const G = byId(goals), O = byId(opps), T = byId(targets);
const REC = { partner: G, employer: O, opportunity: O, target: T };
const recName = (type, r) => (type === 'employer' || type === 'opportunity' ? r.organization : r.name);

H(`A2 - keys (today ${today}; records: ${goals.length} partners · ${opps.length} employers · ${targets.length} targets)`);
// (1) the same company in more than one record table
const nameIdx = new Map();
for (const [type, rows] of [['partner', goals], ['employer', opps], ['target', targets]]) for (const r of rows) { const k = normName(recName(type, r)); if (!k) continue; (nameIdx.get(k) || nameIdx.set(k, []).get(k)).push({ type, r }); }
const multi = [...nameIdx.entries()].filter(([, v]) => v.length > 1);
const cross = multi.filter(([, v]) => new Set(v.map(x => x.type)).size > 1);
const crossLive = cross.filter(([, v]) => v.filter(x => !(x.type === 'target' && ['accepted', 'rejected'].includes(x.r.status))).length > 1 && new Set(v.filter(x => !(x.type === 'target' && ['accepted', 'rejected'].includes(x.r.status))).map(x => x.type)).size > 1);
const sameTable = multi.filter(([, v]) => v.length > new Set(v.map(x => x.type)).size);
P(`normalised names held by 2+ records: ${multi.length} (across tables ${cross.length}, of which both sides still live - not an accepted/rejected target - ${crossLive.length}; twice in ONE table ${sameTable.length})`);
if (crossLive.length) P(`  e.g. ${ex(crossLive, ([k, v]) => `"${recName(v[0].type, v[0].r)}" = ${v.map(x => `${x.type}${x.type === 'target' ? ` (${x.r.status})` : ''}`).join(' + ')}`, 3)}`);
if (sameTable.length) P(`  twice in one table e.g. ${ex(sameTable, ([k, v]) => `"${recName(v[0].type, v[0].r)}" x${v.length} (${v.map(x => x.type).join(', ')})`, 3)}`);
const accepted = targets.filter(t => t.status === 'accepted');
P(`accepted targets ${accepted.length}: promoted_goal_id set ${accepted.filter(t => t.promoted_goal_id).length}; a record of the same name exists for ${accepted.filter(t => (nameIdx.get(normName(t.name)) || []).some(x => x.type !== 'target')).length} (an employer promotion leaves NO id on the target - the link back is the name)`);
// (2) domain coverage
const dom = d => String(d || '').toLowerCase().replace(/^www\./, '').trim() || null;
P(`domain filled: partners ${goals.filter(g => dom(g.company_domain)).length}/${goals.length} (company_domain) · employers ${opps.filter(o => dom(o.domain)).length}/${opps.length} (domain) · targets ${targets.filter(t => dom(t.domain)).length}/${targets.length} (domain)`);
P(`apollo ids on employers: apollo_account_id ${opps.filter(o => o.apollo_account_id).length}/${opps.length} · apollo_org_id ${opps.filter(o => o.apollo_org_id).length}/${opps.length}; partners / targets carry no apollo id column`);
// (3) visits -> records
const vKeys = new Map(); for (const v of visits) (vKeys.get(v.company_key) || vKeys.set(v.company_key, []).get(v.company_key)).push(v);
P(`web_visits ${visits.length} rows = ${vKeys.size} company_keys; company_key = normName(company_name) on ${visits.filter(v => normName(v.company_name) === v.company_key).length}/${visits.length}`);
const VT = { target: T, opportunity: O, partner: G };
const dangling = visits.filter(v => v.matched_type && !VT[v.matched_type]?.has(v.matched_id));
const unmatched = visits.filter(v => !v.matched_type);
const unKeys = [...new Set(unmatched.map(v => v.company_key))];
const nameReach = unKeys.filter(k => nameIdx.has(k));
const domIdx = new Map(); for (const [type, rows, col] of [['partner', goals, 'company_domain'], ['employer', opps, 'domain'], ['target', targets, 'domain']]) for (const r of rows) { const d = dom(r[col]); if (d) (domIdx.get(d) || domIdx.set(d, []).get(d)).push({ type, r }); }
const domReach = [...new Set(unmatched.filter(v => dom(v.domain) && domIdx.has(dom(v.domain)) && !nameIdx.has(v.company_key)).map(v => v.company_key))];
P(`matched rows ${visits.length - unmatched.length} (${grp(visits.filter(v => v.matched_type), v => v.matched_type)}) · matched id not found in its table ${dangling.length} · unmatched rows ${unmatched.length} = ${unKeys.length} companies`);
P(`unmatched companies reachable by NAME (a record has the same normalised name) ${nameReach.length}; by DOMAIN only ${domReach.length}`);
if (nameReach.length) P(`  e.g. ${ex(nameReach, k => { const x = nameIdx.get(k)[0]; return `"${recName(x.type, x.r)}" is a ${x.type}${x.type === 'target' ? ` (${x.r.status})` : ''}${x.r.archived_at ? ' (archived)' : ''}, its visit row is unmatched`; }, 3)}`);
const mixed = [...vKeys.entries()].filter(([, v]) => v.some(x => x.matched_type) && v.some(x => !x.matched_type));
const twoTargets = [...vKeys.entries()].filter(([, v]) => new Set(v.filter(x => x.matched_type).map(x => `${x.matched_type}:${x.matched_id}`)).size > 1);
P(`one company_key, some pulls matched and some not: ${mixed.length}; one company_key matched to 2+ different records across pulls: ${twoTargets.length}${twoTargets.length ? ` (e.g. ${ex(twoTargets, ([k, v]) => `"${v[0].company_name}" -> ${[...new Set(v.filter(x => x.matched_type).map(x => x.matched_type))].join(' + ')}`, 2)})` : ''}`);
const matchedNameDiff = visits.filter(v => v.matched_type && VT[v.matched_type]?.has(v.matched_id) && normName(recName(v.matched_type, VT[v.matched_type].get(v.matched_id))) !== v.company_key);
P(`matched by id but the record's normalised name differs from company_key: ${new Set(matchedNameDiff.map(v => v.company_key)).size} companies (the name path would miss these)`);
// (4) people -> company
P(`sales_people ${people.length}: opportunity_id ${people.filter(p => p.opportunity_id).length} · target_id ${people.filter(p => p.target_id).length} · neither ${people.filter(p => !p.opportunity_id && !p.target_id).length} (of those with company_name ${people.filter(p => !p.opportunity_id && !p.target_id && p.company_name).length}); linked id missing ${people.filter(p => (p.opportunity_id && !O.has(p.opportunity_id)) || (p.target_id && !T.has(p.target_id))).length}; linked to an accepted/rejected target ${people.filter(p => p.target_id && ['accepted', 'rejected'].includes(T.get(p.target_id)?.status)).length}`);
const prosNo = pros.filter(p => !p.opportunity_id && !p.goal_id);
const prosNameHit = prosNo.filter(p => p.company && nameIdx.has(normName(p.company)));
P(`sales_prospect_state ${pros.length}: opportunity_id ${pros.filter(p => p.opportunity_id).length} · goal_id ${pros.filter(p => p.goal_id).length} · no record ${prosNo.length} (company text on ${prosNo.filter(p => p.company).length}); of the unlinked, a record of the same normalised name exists for ${prosNameHit.length}${prosNameHit.length ? ` (e.g. ${ex(prosNameHit, p => { const x = nameIdx.get(normName(p.company))[0]; return `a prospect at "${p.company}" -> ${x.type}${x.type === 'target' ? ` (${x.r.status})` : ''}`; }, 3)})` : ''}`);
P(`partner_contacts ${pcs.length}: goal_id missing in sales_goals ${pcs.filter(c => !G.has(c.goal_id)).length} · apollo_contact_id set ${pcs.filter(c => c.apollo_contact_id).length} · also a sales_prospect_state row (same Apollo contact id) ${pcs.filter(c => c.apollo_contact_id && pros.some(p => p.contact_id === c.apollo_contact_id)).length}`);
const pa = await salesReads.peopleActivity(svc, HL, { window: 'all' });
const prow = pa.body.rows;
P(`People route (the union): ${prow.length} people · company with a record ${prow.filter(p => p.company?.id).length} · company NAME only (no record) ${prow.filter(p => p.company && !p.company.id).length} · no company ${prow.filter(p => !p.company).length} · by source ${grp(prow, p => p.source)}`);
P(`sales_person_activity ${pact.length}: by key prefix ${grp(pact, a => a.person_key.split(':')[0])}; People-route people with NO activity row ${prow.filter(p => !pact.some(a => a.person_key === p.key)).length} (of which partner contacts ${prow.filter(p => String(p.key).startsWith('contact:') && !pact.some(a => a.person_key === p.key)).length}); activity rows whose person is gone ${pact.filter(a => !prow.some(p => p.key === a.person_key)).length}`);
// (5) scores -> records
const sOrph = scores.filter(s => !REC[s.company_type]?.has(s.company_id));
const scored = new Set(scores.map(s => `${s.company_type}:${s.company_id}`));
P(`sales_company_scores ${scores.length}: record gone ${sOrph.length}; records with no score row: partners ${goals.filter(g => !scored.has(`partner:${g.id}`)).length} · employers ${opps.filter(o => !scored.has(`employer:${o.id}`)).length} (archived ${opps.filter(o => o.archived_at).length}) · targets ${targets.filter(t => !scored.has(`target:${t.id}`)).length} (accepted/rejected ${targets.filter(t => ['accepted', 'rejected'].includes(t.status)).length})`);
// (6) email -> company
const acc = new Map(opps.filter(o => o.apollo_account_id).map(o => [o.apollo_account_id, o]));
const dAcc = [...new Set(delivered.map(d => d.account_id).filter(Boolean))];
const prosBy = new Map(pros.map(p => [p.contact_id, p]));
P(`sales_email_delivered ${delivered.length}: account_id set ${delivered.filter(d => d.account_id).length} = ${dAcc.length} accounts, an employer carries that apollo_account_id for ${dAcc.filter(a => acc.has(a)).length}; contact has a prospect row ${delivered.filter(d => prosBy.has(d.contact_id)).length}, with a record link ${delivered.filter(d => { const p = prosBy.get(d.contact_id); return p && (p.opportunity_id || p.goal_id); }).length}`);
P(`sales_sequenced_accounts ${seqAcc.length}: account_id = an employer's apollo_account_id ${seqAcc.filter(a => acc.has(a.account_id)).length}; normalised name = a record name ${seqAcc.filter(a => nameIdx.has(normName(a.name))).length}`);
// (7) the type vocabulary
P(`type words for the same employer row: web_visits.matched_type "opportunity" · sales_week_goals.link_type "opportunity" · sales_company_scores.company_type "employer" · sales_people.company_type "employer" · sales_source_events.record_type "employer" · research_runs.entity_type "employer" · panelKey "employer-<id>"`);
const linkTab = { partner: G, opportunity: O, target: T, company: new Map(seqAcc.map(a => [a.account_id, a])) };
const linked = wg.filter(w => linkTab[w.link_type]);
P(`sales_week_goals with a company link ${linked.length}: link_id not found ${linked.filter(w => !linkTab[w.link_type].has(w.link_id)).length} (${grp(linked.filter(w => !linkTab[w.link_type].has(w.link_id)), w => w.link_type) || 'none'})`);

H('A3 - redundancy: copies compared (drift = the copies differ today)');
const meta = s => s.components?.meta || {};
// a. employees
const recOf = s => REC[s.company_type]?.get(s.company_id);
const live = scores.filter(recOf);
const empDiff = live.filter(s => (meta(s).employees ?? null) !== (recOf(s).employees ?? null));
P(`a. employees: record column vs score components.meta.employees - differ on ${empDiff.length}/${live.length}${empDiff.length ? ` (e.g. ${ex(empDiff, s => `${recName(s.company_type, recOf(s))}: record ${recOf(s).employees ?? '∅'} vs score meta ${meta(s).employees ?? '∅'}, score computed ${String(s.computed_at).slice(0, 16)}, record updated ${String(recOf(s).updated_at).slice(0, 16)}`)})` : ''}`);
const firm = r => r.apollo_firmographics && (r.apollo_firmographics.estimated_num_employees ?? r.apollo_firmographics.employees ?? null);
const firmKeys = [...goals, ...opps, ...targets].map(r => r.apollo_firmographics).find(Boolean);
P(`   apollo_firmographics keys: ${firmKeys ? Object.keys(firmKeys).join(', ') : 'none stored'}; rows with firmographics: partners ${goals.filter(g => g.apollo_firmographics).length} · employers ${opps.filter(o => o.apollo_firmographics).length} · targets ${targets.filter(t => t.apollo_firmographics).length}`);
const allRecs = [...goals.map(r => ['partner', r]), ...opps.map(r => ['employer', r]), ...targets.map(r => ['target', r])];
const firmDiff = allRecs.filter(([, r]) => firm(r) != null && r.employees != null && Number(firm(r)) !== Number(r.employees));
P(`   record.employees vs its own apollo_firmographics headcount: differ on ${firmDiff.length} of ${allRecs.filter(([, r]) => firm(r) != null && r.employees != null).length} that hold both (by employees_source: ${grp(firmDiff, ([, r]) => r.employees_source || '∅') || '-'})`);
const pairEmp = cross.map(([, v]) => v).filter(v => new Set(v.map(x => x.r.employees ?? '∅')).size > 1);
P(`   the same company in two record tables (${cross.length} names) with different employees: ${pairEmp.length}${pairEmp.length ? ` (e.g. ${ex(pairEmp, v => `${recName(v[0].type, v[0].r)}: ${v.map(x => `${x.type} ${x.r.employees ?? '∅'}`).join(' vs ')}`)})` : ''}`);
const seqEmp = seqAcc.filter(a => a.employees != null && acc.has(a.account_id) && acc.get(a.account_id).employees != null && Number(a.employees) !== Number(acc.get(a.account_id).employees));
P(`   sales_sequenced_accounts.employees set on ${seqAcc.filter(a => a.employees != null).length}; vs the employer with the same apollo_account_id: differ ${seqEmp.length} of ${seqAcc.filter(a => a.employees != null && acc.has(a.account_id) && acc.get(a.account_id).employees != null).length} comparable`);
// b. heat
const hd = new Map(heatDays.map(h => [h.person_key, h]));
const liveHeat = new Map(prow.map(p => [p.key, p]));
P(`b. heat: sales_person_activity ${pact.length} rows vs sales_person_heat_days on ${heatMax} (${heatDays.length} rows): heat differs ${pact.filter(a => hd.has(a.person_key) && hd.get(a.person_key).heat !== a.heat).length} · band differs ${pact.filter(a => hd.has(a.person_key) && hd.get(a.person_key).band !== a.heat_band).length} · no day row ${pact.filter(a => !hd.has(a.person_key)).length}`);
const lhDiff = pact.filter(a => liveHeat.has(a.person_key) && (liveHeat.get(a.person_key).heat ?? null) !== (a.heat ?? null));
P(`   stored heat vs the People route's heat now: differ ${lhDiff.length}/${pact.filter(a => liveHeat.has(a.person_key)).length} (the route ${lhDiff.length ? 'RE-DERIVES' : 'returns the stored number or re-derives to the same value'}; stored computed_at ${String(pact[0]?.computed_at).slice(0, 16)})${lhDiff.length ? ` e.g. stored ${lhDiff[0].heat} vs route ${liveHeat.get(lhDiff[0].person_key).heat}` : ''}`);
// c. score
const sd = new Map(scoreDays.map(d => [`${d.company_type}:${d.company_id}`, d]));
P(`c. intent score: sales_company_scores ${scores.length} vs sales_company_score_days on ${maxDay} (${scoreDays.length} rows): score differs ${scores.filter(s => sd.has(`${s.company_type}:${s.company_id}`) && sd.get(`${s.company_type}:${s.company_id}`).score !== s.score).length} · band differs ${scores.filter(s => sd.has(`${s.company_type}:${s.company_id}`) && sd.get(`${s.company_type}:${s.company_id}`).band !== s.band).length} · no day row ${scores.filter(s => !sd.has(`${s.company_type}:${s.company_id}`)).length}; computed_at spread ${[...new Set(scores.map(s => String(s.computed_at).slice(0, 13)))].sort().join(', ')}`);
// d. owner
const ownerTxt = opps.filter(o => o.owner);
const first = s => String(s || '').trim().split(/\s+/)[0].toLowerCase();
P(`d. owner (employers): owner text set ${ownerTxt.length} · owner_user_id set ${opps.filter(o => o.owner_user_id).length} · text without id ${ownerTxt.filter(o => !o.owner_user_id).length} · id without text ${opps.filter(o => o.owner_user_id && !o.owner).length} · both but a different person ${ownerTxt.filter(o => o.owner_user_id && first(member.get(o.owner_user_id)) !== first(o.owner)).length}; spellings of the text: ${grp(ownerTxt, o => o.owner)}`);
const ownMeta = live.filter(s => (meta(s).owner_user_id ?? null) !== (recOf(s).owner_user_id ?? null));
P(`   record.owner_user_id vs score meta.owner_user_id: differ ${ownMeta.length}/${live.length}${ownMeta.length ? ` (e.g. ${ex(ownMeta, s => `${recName(s.company_type, recOf(s))}: record ${member.get(recOf(s).owner_user_id) || '∅'} vs meta ${member.get(meta(s).owner_user_id) || '∅'}`)})` : ''}`);
const lastAssign = new Map(); for (const e of pev.filter(e => e.event === 'assign').sort((a, b) => String(a.at).localeCompare(String(b.at)))) lastAssign.set(e.goal_id, e);
P(`   partners: owner_user_id set ${goals.filter(g => g.owner_user_id).length}/${goals.length}; with an assign event ${[...lastAssign.keys()].filter(id => G.has(id)).length}; owner set but NO assign event ${goals.filter(g => g.owner_user_id && !lastAssign.has(g.id)).length} (set by import / PATCH - no history)`);
const huddle = pros.filter(p => p.opportunity_id && O.get(p.opportunity_id)?.owner_user_id);
P(`   Huddle owner enum on prospects (${grp(pros, p => p.owner)}) vs the linked employer's owner_user_id: ${huddle.length} comparable, different person ${huddle.filter(p => first(member.get(O.get(p.opportunity_id).owner_user_id)) !== first(p.owner)).length}`);
// e. stage
const lastStatus = new Map(); for (const e of pev.filter(e => e.to_status).sort((a, b) => String(a.at).localeCompare(String(b.at)))) lastStatus.set(e.goal_id, e);
const stDiff = goals.filter(g => lastStatus.has(g.id) && lastStatus.get(g.id).to_status !== g.pipeline_status);
P(`e. stage (partners): ${goals.filter(g => lastStatus.has(g.id)).length} have an event with to_status; latest to_status != pipeline_status on ${stDiff.length}${stDiff.length ? ` (e.g. ${ex(stDiff, g => `${g.name}: record ${g.pipeline_status} vs last event ${lastStatus.get(g.id).event} -> ${lastStatus.get(g.id).to_status} at ${String(lastStatus.get(g.id).at).slice(0, 10)}`)})` : ''}; partners past not_started with NO status event ${goals.filter(g => g.pipeline_status !== 'not_started' && !lastStatus.has(g.id)).length}`);
const lastStage = new Map(); for (const e of oev.filter(e => e.to_stage).sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)))) lastStage.set(e.opportunity_id, e);
const oDiff = opps.filter(o => lastStage.has(o.id) && lastStage.get(o.id).to_stage !== o.stage);
P(`   stage (employers): latest event to_stage != stage on ${oDiff.length}/${opps.filter(o => lastStage.has(o.id)).length}${oDiff.length ? ` (e.g. ${ex(oDiff, o => `${o.organization}: record ${o.stage} vs event ${lastStage.get(o.id).to_stage}`)})` : ''}; employers with no event at all ${opps.filter(o => !oev.some(e => e.opportunity_id === o.id)).length}`);
const stMeta = live.filter(s => { const r = recOf(s); const st = s.company_type === 'partner' ? r.pipeline_status : s.company_type === 'employer' ? r.stage : r.status; return meta(s).stage != null && meta(s).stage !== st; });
P(`   record stage vs score meta.stage: differ ${stMeta.length}/${live.length}${stMeta.length ? ` (e.g. ${ex(stMeta, s => { const r = recOf(s); return `${recName(s.company_type, r)}: record ${s.company_type === 'partner' ? r.pipeline_status : s.company_type === 'employer' ? r.stage : r.status} vs meta ${meta(s).stage}`; })})` : ''}`);
P(`   sales_stage_marks ${marks.length} row(s); sales_flow_events ${fev.length} row(s) (${grp(fev, e => `${e.record_type} ${e.kind}`)})`);
// f. visits
const latestVisit = new Map(); for (const v of visits.filter(v => v.matched_type).sort((a, b) => String(a.pulled_on).localeCompare(String(b.pulled_on)) || String(a.seen_to).localeCompare(String(b.seen_to)))) latestVisit.set(`${v.matched_type === 'opportunity' ? 'employer' : v.matched_type}:${v.matched_id}`, v);
const vMeta = live.filter(s => latestVisit.has(`${s.company_type}:${s.company_id}`) && (meta(s).visits_7d ?? 0) !== (latestVisit.get(`${s.company_type}:${s.company_id}`).visits_7d ?? 0));
P(`f. visits_7d: score meta.visits_7d vs the record's latest web_visits row: differ ${vMeta.length}/${live.filter(s => latestVisit.has(`${s.company_type}:${s.company_id}`)).length}${vMeta.length ? ` (e.g. ${ex(vMeta, s => `${recName(s.company_type, recOf(s))}: meta ${meta(s).visits_7d} vs latest pull ${latestVisit.get(`${s.company_type}:${s.company_id}`).visits_7d} (pulled ${latestVisit.get(`${s.company_type}:${s.company_id}`).pulled_on})`)})` : ''}; a company has ${(visits.length / vKeys.size).toFixed(1)} web_visits rows on average (one per pull window), each with its own visits_7d`);
// g. last touch
const lastTouch = new Map(); for (const e of pev.filter(e => e.event === 'touch').sort((a, b) => String(a.at).localeCompare(String(b.at)))) lastTouch.set(e.goal_id, e);
const ltDiff = goals.filter(g => lastTouch.has(g.id) && String(g.last_touch_at || '').slice(0, 10) !== String(lastTouch.get(g.id).at).slice(0, 10));
P(`g. last touch (partners): last_touch_at set ${goals.filter(g => g.last_touch_at).length}; has a touch event ${[...lastTouch.keys()].filter(id => G.has(id)).length}; column day != latest touch event day ${ltDiff.length}${ltDiff.length ? ` (e.g. ${ex(ltDiff, g => `${g.name}: column ${String(g.last_touch_at || '∅').slice(0, 10)} vs event ${String(lastTouch.get(g.id).at).slice(0, 10)}`)})` : ''}; column set with NO touch event ${goals.filter(g => g.last_touch_at && !lastTouch.has(g.id)).length}; employers / targets have no last_touch column (derived at read)`);
// h. source
const lastSrc = new Map(); for (const e of sev.sort((a, b) => String(a.at).localeCompare(String(b.at)))) lastSrc.set(`${e.record_type}:${e.record_id}`, e);
const kindOf = e => (e.to_source && typeof e.to_source === 'object' ? e.to_source.source_kind ?? e.to_source.kind ?? null : e.to_source);
const srcDiff = allRecs.filter(([t, r]) => lastSrc.has(`${t}:${r.id}`) && (kindOf(lastSrc.get(`${t}:${r.id}`)) ?? null) !== (r.source_kind ?? null));
P(`h. source: record.source_kind vs the latest sales_source_events.to_source: differ ${srcDiff.length}/${allRecs.filter(([t, r]) => lastSrc.has(`${t}:${r.id}`)).length} (to_source keys: ${Object.keys(sev[0]?.to_source || {}).join(', ')})${srcDiff.length ? ` e.g. ${ex(srcDiff, ([t, r]) => `${recName(t, r)}: record ${r.source_kind ?? '∅'} vs event ${kindOf(lastSrc.get(`${t}:${r.id}`)) ?? '∅'}`)}` : ''}; records with no source event ${allRecs.filter(([t, r]) => !lastSrc.has(`${t}:${r.id}`)).length}`);
const srcScore = live.filter(s => (s.source_kind ?? null) !== (recOf(s).source_kind ?? null));
P(`   record.source_kind vs sales_company_scores.source_kind: differ ${srcScore.length}/${live.length}${srcScore.length ? ` (e.g. ${ex(srcScore, s => `${recName(s.company_type, recOf(s))}: record ${recOf(s).source_kind ?? '∅'} vs score ${s.source_kind ?? '∅'}`)})` : ''}`);
// i. email counts
const byDayC = {}; for (const c of counts) byDayC[c.day] = (byDayC[c.day] || 0) + (c.delivered || 0);
const byDayD = {}; for (const d of delivered) byDayD[d.delivered_day] = (byDayD[d.delivered_day] || 0) + 1;
const fdCol = fdays[0] ? Object.keys(fdays[0]) : [];
const days = Object.keys(byDayD).sort();
const cd = days.filter(d => (byDayC[d] || 0) !== byDayD[d]);
P(`i. delivered per day, three stored copies: sales_email_daily_counts (${counts.length} rows, ${Object.keys(byDayC).length} days from ${Object.keys(byDayC).sort()[0]}) vs sales_email_delivered (${delivered.length} rows, ${days.length} days ${days[0]} -> ${days[days.length - 1]}): days that differ ${cd.length}${cd.length ? ` (${cd.map(d => `${d}: counts ${byDayC[d] || 0} vs rows ${byDayD[d]}`).slice(0, 4).join(' ; ')})` : ''}`);
const fdDiff = fdays.filter(f => f.delivered != null && byDayD[f.day] != null && f.delivered !== byDayD[f.day]);
P(`   sales_funnel_days (${fdays.length} rows; columns ${fdCol.join(', ')}): delivered != the rows of that day on ${fdDiff.length}${fdDiff.length ? ` (${fdDiff.map(f => `${f.day}: ${f.delivered} vs ${byDayD[f.day]}`).slice(0, 4).join(' ; ')})` : ''}; sales_email_messages ${msgs.length} rows is engaged-only (not a count of delivered)`);

H('C1 - the to-do population');
const stepBy = new Map(); for (const s of steps) (stepBy.get(s.goal_id) || stepBy.set(s.goal_id, []).get(s.goal_id)).push(s);
const todos = wg.filter(w => w.kind === 'todo');
const openAll = todos.filter(w => w.status === 'open');
const flags = openAll.filter(w => w.prospect_contact_id);
const allStepsDone = openAll.filter(w => !w.prospect_contact_id && stepBy.get(w.id)?.length && stepBy.get(w.id).every(s => s.done));
const open = openAll.filter(w => !w.prospect_contact_id && !(stepBy.get(w.id)?.length && stepBy.get(w.id).every(s => s.done)));
P(`sales_week_goals ${wg.length}: ${grp(wg, w => `${w.kind} ${w.status}`)}; statuses seen on to-dos: ${grp(todos, w => w.status)}`);
P(`open to-dos ${openAll.length} = ${open.length} on the Actions list + ${flags.length} open flags + ${allStepsDone.length} with every step done (hidden by openTodos.js:11)`);
const origin = w => (w.category?.startsWith('From calls') || w.source_note_id ? 'call notes / intake' : w.category === 'Huddle follow-ups' ? 'flag' : w.category === 'Signals' ? 'signal accept' : w.category === 'Tidy' ? 'tidy accept' : w.category === 'Nudge' ? 'waiting nudge' : w.category === 'Apollo' ? 'Apollo check' : w.plan_id ? 'week plan' : w.carried_from_id ? 'carry-over' : w.category ? `seed sheet (${'category'})` : !w.created_by ? 'import (no creator)' : w.link_type && linkTab[w.link_type] ? 'manual / panel / Scout, linked' : 'manual / quick capture, no link');
P(`by origin: ${grp(open, origin)}`);
P(`   Scout "+ Task" (text starts "Follow up:") ${open.filter(w => /^Follow up:/i.test(w.text || '')).length} open, ${todos.filter(w => /^Follow up:/i.test(w.text || '')).length} ever; "Contacted …" born-done rows ${todos.filter(w => /^Contacted /i.test(w.text || '')).length}`);
P(`by owner: ${grp(open, w => (w.owner_user_id ? member.get(w.owner_user_id) || 'former member' : 'unassigned'))}`);
const sunday = addDays(laMonday(today), 6);
P(`by due: ${grp(open, w => (!w.due_date ? 'no date' : w.due_date < today ? 'overdue' : w.due_date === today ? 'today' : w.due_date <= sunday ? 'this week' : 'later'))}`);
const od = open.filter(w => w.due_date && w.due_date < today).map(w => Math.round((Date.parse(today) - Date.parse(w.due_date)) / DAY));
P(`overdue age: ${grp(od.map(d => ({ d })), x => (x.d <= 3 ? '1-3 d' : x.d <= 7 ? '4-7 d' : x.d <= 14 ? '8-14 d' : x.d <= 30 ? '15-30 d' : '> 30 d'))} · median ${od.sort((a, b) => a - b)[Math.floor(od.length / 2)] ?? '—'} d`);
const age = w => Math.floor((Date.now() - Date.parse(w.created_at)) / DAY);
P(`by age (created): ${grp(open, w => (age(w) <= 7 ? '0-7 d' : age(w) <= 14 ? '8-14 d' : age(w) <= 30 ? '15-30 d' : '> 30 d'))} · oldest ${Math.max(...open.map(age))} d`);
const thisMon = laMonday(today);
P(`by week_start: this week (${thisMon}) ${open.filter(w => w.week_start === thisMon).length} · earlier weeks ${open.filter(w => w.week_start < thisMon).length} · ${grp(open.filter(w => w.week_start < thisMon), w => w.week_start)}`);
const untouched = w => Math.abs(Date.parse(w.updated_at) - Date.parse(w.created_at)) < 5000 && !(stepBy.get(w.id) || []).some(s => s.done);
const auto = open.filter(w => ['call notes / intake', 'signal accept', 'tidy accept', 'Apollo check', 'import (no creator)', 'waiting nudge'].includes(origin(w)));
P(`auto-created (call notes / intake, signal, tidy, Apollo check, nudge, import) ${auto.length}; never touched since (updated_at = created_at, no step ticked) ${auto.filter(untouched).length}; of ALL open, never touched ${open.filter(untouched).length}`);
const linkRec = w => (w.link_type === 'partner' ? G.get(w.link_id) : w.link_type === 'opportunity' ? O.get(w.link_id) : w.link_type === 'target' ? T.get(w.link_id) : null);
const lk = open.filter(w => linkRec(w));
P(`company link: ${grp(open, w => w.link_type || 'none')}; resolvable to a record ${lk.length}`);
P(`   linked to: archived ${lk.filter(w => linkRec(w).archived_at).length} · deprioritized (fit) ${lk.filter(w => linkRec(w).fit_level === 'deprioritized').length} · paused partner ${lk.filter(w => linkRec(w).pipeline_status === 'paused').length} · client ${lk.filter(w => linkRec(w).client_status).length} · rejected target ${lk.filter(w => linkRec(w).status === 'rejected').length} · accepted (promoted) target ${lk.filter(w => w.link_type === 'target' && linkRec(w).status === 'accepted').length} · on_hold employer ${lk.filter(w => linkRec(w).stage === 'on_hold').length}`);
P(`waiting rows open ${wg.filter(w => w.kind === 'waiting' && w.status === 'open').length} (overdue ${wg.filter(w => w.kind === 'waiting' && w.status === 'open' && w.due_date && w.due_date < today).length}) · commitments ${wg.filter(w => w.kind === 'commitment').length} (planned ${wg.filter(w => w.kind === 'commitment' && w.plan_id).length}; latest week ${wg.filter(w => w.kind === 'commitment').map(w => w.week_start).sort().pop()})`);

H('C2 - use evidence, last 30 days');
const d30 = new Date(Date.now() - 30 * DAY).toISOString();
const done30 = todos.filter(w => w.status === 'done' && w.completed_at && w.completed_at >= d30);
P(`to-dos done (completed_at in 30 d) ${done30.length} (all time ${todos.filter(w => w.status === 'done').length}); by week: ${grp(done30, w => laMonday(laDateString(new Date(w.completed_at))))}; created in 30 d ${todos.filter(w => w.created_at >= d30).length}`);
P(`dropped ${todos.filter(w => w.status === 'dropped').length} · edited after creation (updated_at > created_at + 5 s) among open ${open.filter(w => !untouched(w)).length}`);
P(`sales_week_plans ${plans.length} rows (${plans.map(p => `${p.week_start}: ${p.chosen_count} chosen, saved ${String(p.created_at).slice(0, 10)}`).join(' ; ')}); to-dos / commitments carrying plan_id ${wg.filter(w => w.plan_id).length}`);
P(`sales_suggestions decided: ${grp(sugg.filter(s => s.status !== 'proposed'), s => `${s.kind} ${s.status}`) || 'none'} · proposed ${sugg.filter(s => s.status === 'proposed').length} (${grp(sugg.filter(s => s.status === 'proposed'), s => s.kind)})`);
P(`partner events in 30 d: ${grp(pev.filter(e => e.at >= d30), e => `${e.event}${e.source !== 'manual' ? ` (${e.source})` : ''}`)}; employer stage changes in 30 d ${oev.filter(e => e.event_type === 'stage_change' && e.changed_at >= d30).length}`);

H('C3 - ranking inputs reachable per open to-do');
const scoreOf = w => scores.find(s => s.company_id === w.link_id && s.company_type === (w.link_type === 'opportunity' ? 'employer' : w.link_type));
const withScore = lk.filter(scoreOf);
P(`open to-dos ${open.length}: company link resolvable ${lk.length} (${Math.round(100 * lk.length / open.length)} %) · no usable company link ${open.length - lk.length} (link_type null ${open.filter(w => !w.link_type).length} · commitment/metric ${open.filter(w => ['commitment', 'metric'].includes(w.link_type)).length} · sequenced-account "company" ${open.filter(w => w.link_type === 'company').length} · dangling ${open.filter(w => ['partner', 'opportunity', 'target'].includes(w.link_type) && !linkRec(w)).length})`);
P(`linked to-dos with a score row ${withScore.length}: ${grp(withScore, w => scoreOf(w).band)}; company visited in 7 d (score meta.visits_7d > 0) ${withScore.filter(w => (meta(scoreOf(w)).visits_7d || 0) > 0).length}`);
const names = allRecs.map(([t, r]) => ({ t, r, n: normName(recName(t, r)) })).filter(x => x.n.length >= 4);
const unl = open.filter(w => !linkRec(w));
const mention = unl.filter(w => { const tx = ` ${normName(w.text)} `; return names.some(x => tx.includes(` ${x.n} `)); });
P(`unlinked open to-dos whose TEXT names a record (whole normalised name, 4+ chars): ${mention.length}/${unl.length} - a backfill could link these`);
const replied = msgs.filter(m => m.replied && m.reply_class !== 'out_of_office');
const owed = replied.filter(m => { const p = prosBy.get(m.contact_id); const rec = p?.opportunity_id || p?.goal_id; return !openAll.some(w => w.prospect_contact_id === m.contact_id || (rec && w.link_id === rec)); });
P(`reply owed: replied messages (not out-of-office) ${replied.length}; with no open to-do on the person or the linked record ${owed.length}; prospect status of those: ${grp(owed, m => prosBy.get(m.contact_id)?.status || 'no prospect row')}`);
P(`person heat per to-do: only flags carry a person (prospect_contact_id): open flags ${flags.length}; no other to-do names a person by id`);

H('D - company-context seeds (counts)');
const res = k => runs.filter(r => r.status === 'done' && r.result && String(r.result[k] ?? '').trim() && !(k === 'housing_perk' && /no housing perk found/i.test(String(r.result[k])))).length;
P(`research_runs ${runs.length} done (${grp(runs, r => r.entity_type)}): result keys ${Object.keys(runs[0]?.result || {}).join(', ')}`);
P(`   non-empty: why_homelover ${res('why_homelover')} · first_angle ${res('first_angle')} · housing_perk (a perk found) ${res('housing_perk')} · watch_outs ${res('watch_outs')} · sells_to ${res('sells_to')} · positioning ${res('positioning')} · titles ${res('titles')}; companies researched ${new Set(runs.map(r => r.entity_id)).size}; latest ${runs.map(r => r.created_at).sort().pop()?.slice(0, 16)}`);
const nn = (rows, c) => rows.filter(r => String(r[c] ?? '').trim() && !(Array.isArray(r[c]) && !r[c].length)).length;
P(`partners (${goals.length}): angle ${nn(goals, 'angle')} · watch_outs ${nn(goals, 'watch_outs')} · do_not_say ${nn(goals, 'do_not_say')} · target_titles ${nn(goals, 'target_titles')} · champion ${nn(goals, 'champion')} · notes ${nn(goals, 'notes')}`);
P(`employers (${opps.length}): objections ${nn(opps, 'objections')} · competitors ${nn(opps, 'competitors')} · champion ${nn(opps, 'champion')} · notes ${nn(opps, 'notes')}; targets (${targets.length}): research_notes ${nn(targets, 'research_notes')} · evidence ${nn(targets, 'evidence')}`);
P(`sales_call_notes ${notes.length}: ${notes.reduce((n, x) => n + (x.text || '').length, 0)} chars total · median ${notes.map(x => (x.text || '').length).sort((a, b) => a - b)[Math.floor(notes.length / 2)]} chars · longer than 600 chars ${notes.filter(x => (x.text || '').length > 600).length} · extract set ${notes.filter(x => x.extract).length} (keys ${[...new Set(notes.flatMap(x => Object.keys(x.extract || {})))].join(', ')}) · ${notes.map(x => x.call_date).sort()[0]} -> ${notes.map(x => x.call_date).sort().pop()}`);
const exn = k => notes.reduce((n, x) => n + (Array.isArray(x.extract?.[k]) ? x.extract[k].length : x.extract?.[k] ? 1 : 0), 0);
P(`   extract items: ${[...new Set(notes.flatMap(x => Object.keys(x.extract || {})))].map(k => `${k} ${exn(k)}`).join(' · ')}`);
P(`business_intel_entries ${intel.length}: ${grp(intel, i => `${i.source}/${i.content_type || '∅'}`)} · ${intel.reduce((n, i) => n + (i.content || '').length, 0)} chars · company-level (project_id null) ${intel.filter(i => !i.project_id).length} · newest ${intel.map(i => i.created_at).sort().pop()?.slice(0, 10)}`);
P(`reply classes on sales_email_messages: ${grp(msgs.filter(m => m.reply_class), m => m.reply_class)} (class only - no reply text column)`);
fs.writeFileSync(ROOT + '/scripts/verify/_hdm/facts-done.txt', new Date().toISOString());
footer();
