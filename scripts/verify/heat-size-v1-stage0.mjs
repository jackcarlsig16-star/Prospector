// Ran at HEAD 5035b3e-era code, before heat-v2 Stage 1 removed huddleSignals - kept as the heat-size Stage 0 record; it no longer runs as is.
// heat-size-v1 Stage 0 - READ-ONLY (0 writes, 0 Claude, 0 Apollo). HomeLover only. Reads the same tables one
// GET goals/people/activity + one writePersonActivity read (sales_person_activity, the three contact tables, the three
// record tables, web_visits, sales_email_messages, sales_email_activity, sales_settings) - once. Prints counts and
// NAMES / COMPANIES ONLY (never an address or phone).
// (a) people whose company visited in 7 d and how many are cold today; (b) visits_7d / unique_visitors_7d distribution
// over matched companies; (c) band flips under H1+H2 at three candidate weight sets; (d) employees coverage by table/source.
// Usage: node scripts/verify/heat-size-v1-stage0.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { scoreProspect, huddleSignals, HEAT, HEAT_BANDS, isBotOpen } = await import('../../api/sales/heatScore.js');
const { SCANNER_CLICK_WITHIN_SECONDS } = await import('../../api/sales/nextBestAction.js');
const { peopleRows } = await import('../../api/sales/peopleActivityRoutes.js');
const { mergePeople } = await import('../../api/sales/peopleMerge.js');
const { normName } = await import('../../api/sales/intakeMatch.js');
const { laDateString } = await import('../../api/sales/laDate.js');
const { addDays } = await import('../../api/sales/goalsShared.js');

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
const NOW = Date.now(), TODAY = laDateString(new Date(NOW)), DAY = 864e5, SEVEN = addDays(TODAY, -6);
const all = (t, cols, build = x => x) => selectAllPages(() => build(svc.from(t).select(cols).eq('business_id', HL)).order('id'));
const t0 = Date.now();
const [prospects, salesPeople, partnerContacts, opportunities, targets, partners, visits, settings, activity, messages, events] = await Promise.all([
  selectAllPages(() => svc.from('sales_prospect_state').select('contact_id, name, title, company, opportunity_id, goal_id, status, owner, email').eq('business_id', HL).order('contact_id')),
  all('sales_people', 'id, company_type, opportunity_id, target_id, name, title, source_kind, visit_id, upload_id, archived_at, created_at, company_name'),
  all('partner_contacts', 'id, goal_id, name, title, email, apollo_contact_id, last_activity_at'),
  all('sales_opportunities', 'id, organization, stage, owner_user_id, archived_at, employees, employees_source'),
  all('sales_targets', 'id, name, status, owner_user_id, employees, employees_source'),
  all('sales_goals', 'id, name, pipeline_status, owner_user_id, archived_at, employees, employees_source', x => x.eq('goal_type', 'partnership')),
  all('web_visits', 'id, company_key, company_name, matched_type, matched_id, visits_7d, unique_visitors_7d, last_visit, seen_to, top_paths, pulled_on'),
  svc.from('sales_settings').select('buyer_titles').eq('business_id', HL).maybeSingle().then(r => r.data),
  selectAllPages(() => svc.from('sales_person_activity').select('person_key, contact_id, sent, heat, heat_band, computed_at').eq('business_id', HL).order('person_key')),
  selectAllPages(() => svc.from('sales_email_messages').select('apollo_message_id,contact_id,sequence_id,step,delivered_at,replied,reply_class,replied_seen_at,replied_at,num_opens,num_clicks,last_opened_at,last_clicked_at,bounced').eq('business_id', HL).order('apollo_message_id')),
  selectAllPages(() => svc.from('sales_email_activity').select('id,apollo_message_id,contact_id,step,event,occurred_at,user_agent,tracking_service').eq('business_id', HL).order('id')),
]);
const readMs = Date.now() - t0;
const rowsRead = prospects.length + salesPeople.length + partnerContacts.length + opportunities.length + targets.length + partners.length + visits.length + activity.length + messages.length + events.length;
console.log(`read ${rowsRead} rows in ${readMs} ms (prospects ${prospects.length}, sales_people ${salesPeople.length}, partner_contacts ${partnerContacts.length}, web_visits ${visits.length}, activity ${activity.length}, messages ${messages.length}, events ${events.length})`);

// ---- the People table's own join (peopleActivityRoutes.buildPeopleTable, with unique_visitors_7d kept)
const rows = peopleRows({ prospects, salesPeople, partnerContacts, opportunities: opportunities.filter(o => !o.archived_at), targets, partners });
const byKey = new Map(); for (const v of visits) { const c = byKey.get(v.company_key); if (!c || v.pulled_on > c.pulled_on) byKey.set(v.company_key, v); }
const byMatch = new Map([...byKey.values()].filter(v => v.matched_type && v.matched_id).map(v => [`${v.matched_type}:${v.matched_id}`, v]));
const MATCH = { employer: 'opportunity', target: 'target', partner: 'partner' };
const visitOf = c => (c ? (c.id && byMatch.get(`${MATCH[c.type]}:${c.id}`)) || byKey.get(normName(c.name)) || null : null);
const visited7 = v => !!v && Number(v.visits_7d) > 0 && (v.seen_to || v.pulled_on) >= SEVEN;
const act = new Map(); for (const a of activity) { act.set(a.person_key, a); if (a.contact_id) act.set(`c:${a.contact_id}`, a); }
const msgsBy = new Map(), evsBy = new Map();
for (const m of messages) { if (!msgsBy.has(m.contact_id)) msgsBy.set(m.contact_id, []); msgsBy.get(m.contact_id).push(m); }
for (const e of events) { if (!evsBy.has(e.contact_id)) evsBy.set(e.contact_id, []); evsBy.get(e.contact_id).push(e); }

const visitById = new Map(visits.map(v => [v.id, v]));
const spVisit = new Map(salesPeople.filter(p => p.visit_id).map(p => [String(p.id), p.visit_id]));
const people = mergePeople(rows).map(p => {
  const a = p.source_keys.map(k => act.get(k)).find(Boolean) || p.apollo_ids.map(id => act.get(`c:${id}`)).find(Boolean) || null;
  const v = visitOf(p.company);
  const msgs = p.apollo_ids.flatMap(id => msgsBy.get(id) || []), evs = p.apollo_ids.flatMap(id => evsBy.get(id) || []);
  const scored = scoreProspect(msgs, evs);
  const sig = huddleSignals(msgs, evs, scored, NOW, SCANNER_CLICK_WITHIN_SECONDS);
  const ownVisit = p.source_keys.map(k => k.startsWith('person:') ? visitById.get(spVisit.get(k.slice(7))) : null).find(Boolean) || null;
  return { key: p.key, name: p.name, company: p.company?.name || null, rec: p.company, identified: p.sources.includes('visitor'), ownVisit, stored: a, visit: v, visited7: visited7(v), msgs, evs, scored, band: msgs.length || evs.length ? sig.heat_band : null };
});
const withEmail = people.filter(p => p.msgs.length || p.evs.length);
const storedDiff = withEmail.filter(p => p.stored && (p.stored.heat !== p.scored.score || p.stored.heat_band !== p.band));
console.log(`\npeople (merged, the table's rows): ${people.length}; with email rows ${withEmail.length}; stored heat rows ${activity.length}; recomputed now != stored: ${storedDiff.length}`);

// ---- (a)
const visitedPeople = people.filter(p => p.visited7);
const bandOf = p => p.stored?.heat_band || (p.band ?? 'none');
const tally = xs => xs.reduce((o, p) => { const b = bandOf(p); o[b] = (o[b] || 0) + 1; return o; }, {});
console.log(`\n(a) people whose company visited in 7 d (visits_7d > 0, seen_to >= ${SEVEN}): ${visitedPeople.length} across ${new Set(visitedPeople.map(p => p.company)).size} companies`);
console.log(`    band today (stored sales_person_activity, 'none' = no email rows at all): ${JSON.stringify(tally(visitedPeople))}`);
console.log(`    cold today: ${visitedPeople.filter(p => bandOf(p) === 'cold').length}; no heat at all (no email rows): ${visitedPeople.filter(p => bandOf(p) === 'none').length}; identified visitors among them: ${visitedPeople.filter(p => p.identified).length}`);
const idv = people.filter(p => p.identified);
console.log(`    identified visitors in all: ${idv.length}; of those, company row visited in 7 d: ${idv.filter(p => p.visited7).length}; band today ${JSON.stringify(tally(idv))}`);
console.log(`    by company (visited, people with a band): ` + [...visitedPeople.reduce((m, p) => { const k = p.company; if (!m.has(k)) m.set(k, { n: 0, cold: 0, none: 0, v: p.visit }); const o = m.get(k); o.n++; if (bandOf(p) === 'cold') o.cold++; if (bandOf(p) === 'none') o.none++; return m; }, new Map()).entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15).map(([k, o]) => `${k} ${o.n} (cold ${o.cold}, none ${o.none}; ${o.v.visits_7d} visits · ${o.v.unique_visitors_7d ?? '?'} ppl)`).join(' | '));

// ---- (b)
const latest = [...byKey.values()];
const matched = latest.filter(v => v.matched_type && v.matched_id);
const recent = matched.filter(visited7);
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : null; };
const dist = (label, xs) => console.log(`    ${label}: n ${xs.length} · p50 ${pct(xs, 0.5)} · p75 ${pct(xs, 0.75)} · p90 ${pct(xs, 0.9)} · p95 ${pct(xs, 0.95)} · max ${Math.max(...xs)} · mean ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)}`);
console.log(`\n(b) web_visits latest row per company_key: ${latest.length}; matched to a record: ${matched.length}; matched + visited in 7 d: ${recent.length}`);
dist('visits_7d (matched, visited 7 d)', recent.map(v => Number(v.visits_7d)));
dist('unique_visitors_7d (matched, visited 7 d)', recent.map(v => Number(v.unique_visitors_7d ?? 0)));
dist('visits_7d (all matched rows)', matched.map(v => Number(v.visits_7d || 0)));
const uvHist = recent.reduce((o, v) => { const u = Math.min(Number(v.unique_visitors_7d ?? 0), 6); o[u >= 6 ? '6+' : u] = (o[u >= 6 ? '6+' : u] || 0) + 1; return o; }, {});
console.log(`    unique_visitors_7d histogram (visited 7 d): ${JSON.stringify(uvHist)}; last_visit age days: ${JSON.stringify(recent.reduce((o, v) => { const d = v.last_visit ? Math.floor((NOW - Date.parse(v.last_visit)) / DAY) : 'null'; o[d] = (o[d] || 0) + 1; return o; }, {}))}`);
console.log(`    unmatched latest rows visited 7 d (no record -> no person; out of heat by construction): ${latest.filter(v => !(v.matched_type && v.matched_id) && visited7(v)).length}`);

// ---- (c) H1 + H2 at candidate weights (REVISABLE - the planner picks)
// idDecay: an identified visitor's base decays on THEIR OWN visit row's last_visit (else it never decays - the
// company row is older than 7 d by definition, so the base would hold forever).
const SETS = JSON.parse(process.argv[2] || 'null') || [
  { name: 'A light', visitBase: 5, visitPerVisitor: 2, visitVisitorsMax: 5, idDecay: true },
  { name: 'B medium', visitBase: 8, visitPerVisitor: 3, visitVisitorsMax: 5, idDecay: true },
  { name: 'C strong', visitBase: 10, visitPerVisitor: 4, visitVisitorsMax: 5, idDecay: true },
  { name: 'C no-idDecay', visitBase: 10, visitPerVisitor: 4, visitVisitorsMax: 5, idDecay: false },
];
const idOld = people.filter(p => p.identified && !p.visited7);
console.log(`\n    identified visitors whose company row is NOT visited in 7 d: ${idOld.length}; own visit row found ${idOld.filter(p => p.ownVisit).length}; own last_visit older than 3 d: ${idOld.filter(p => p.ownVisit?.last_visit && (NOW - Date.parse(p.ownVisit.last_visit)) / DAY > 3).length}, older than 30 d: ${idOld.filter(p => p.ownVisit?.last_visit && (NOW - Date.parse(p.ownVisit.last_visit)) / DAY > 30).length}`);
function rescore(p, w) {
  const { msgs, evs, scored } = p;
  const v = p.visit;
  const companyVisited = p.visited7;
  const visitPtsRaw = companyVisited ? w.visitBase + w.visitPerVisitor * Math.min(Number(v.unique_visitors_7d ?? 0), w.visitVisitorsMax) : p.identified ? w.visitBase : 0;
  // decay: the same 3-day rule, last_visit joins the timed signals (combined lastSignal; clicks/opens/visits decay together)
  const lastVisit = companyVisited && v.last_visit ? new Date(v.last_visit).toISOString() : !companyVisited && p.identified && w.idDecay && p.ownVisit?.last_visit ? new Date(p.ownVisit.last_visit).toISOString() : null;
  const timed = [scored.last_signal_at, lastVisit].filter(Boolean).sort();
  const lastSignal = timed.length ? timed[timed.length - 1] : null;
  const clickOpen = scored.score - (scored.badges.replied ? Math.max(...msgs.filter(m => m.replied).map(m => (HEAT.replyPoints[m.reply_class] ?? HEAT.replyPointsUnclassified))) : 0);
  // scored.score already applied its own decay to clicks/opens; undo it to re-decay on the combined signal
  const emailDecayed = scored.why.some(l => /No new signal/.test(l));
  const replyPts = scored.score - clickOpen;
  const clickOpenRaw = emailDecayed ? clickOpen / HEAT.decayFactor : clickOpen;
  const decayed = lastSignal && (NOW - Date.parse(lastSignal)) / DAY > HEAT.decayAfterDays && (clickOpenRaw || visitPtsRaw);
  const score = Math.round(replyPts + (clickOpenRaw + visitPtsRaw) * (decayed ? HEAT.decayFactor : 1));
  // H2
  const deliveredById = new Map(msgs.map(m => [m.apollo_message_id, m.delivered_at]));
  const recentE = e => NOW - Date.parse(e.occurred_at) <= HEAT_BANDS.recentDays * DAY;
  const humanClick = evs.some(e => { const d = e.event === 'click' && deliveredById.get(e.apollo_message_id); return d && (Date.parse(e.occurred_at) - Date.parse(d)) / 1000 > SCANNER_CLICK_WITHIN_SECONDS && recentE(e); });
  const realOpen = evs.some(e => e.event === 'open' && !isBotOpen(e, deliveredById.get(e.apollo_message_id)) && recentE(e));
  const sent = msgs.filter(m => m.delivered_at).length;
  const replied = msgs.some(m => m.replied);
  const visitHot = companyVisited && (sent >= 1 || p.identified);
  let band;
  if (replied) band = p.band; // reply rule unchanged
  else if (score >= HEAT_BANDS.hotScore || humanClick || visitHot) band = 'hot';
  else if (score >= HEAT_BANDS.warmScore || realOpen) band = 'warm';
  else band = 'cold';
  if (!replied && band === 'hot' && !sent && !p.identified && !humanClick) band = 'warm'; // a browse alone is Warm at most
  return { score, band, visitPts: Math.round(visitPtsRaw * (decayed ? HEAT.decayFactor : 1)), decayed: !!decayed };
}
console.log(`\n(c) band flips under H1 + H2 (baseline = recomputed now with heatScore.js; people with no email rows and no visit stay 'none')`);
const scope = people.filter(p => p.msgs.length || p.evs.length || p.visited7 || p.identified);
for (const w of SETS) {
  const res = scope.map(p => ({ p, before: p.band ?? 'cold', after: rescore(p, w) }));
  const flips = res.filter(r => r.after.band !== r.before);
  const up = flips.filter(r => ['cold', 'warm', 'hot'].indexOf(r.after.band) > ['cold', 'warm', 'hot'].indexOf(r.before));
  const by = flips.reduce((o, r) => { const k = `${r.before}->${r.after.band}`; o[k] = (o[k] || 0) + 1; return o; }, {});
  const maxVisit = Math.max(0, ...res.map(r => r.after.visitPts));
  const visitOnlyHot = res.filter(r => r.after.band === 'hot' && !r.p.msgs.length && !r.p.evs.length).length;
  const bands = res.reduce((o, r) => { o[r.after.band] = (o[r.after.band] || 0) + 1; return o; }, {});
  const idWarm = res.filter(r => r.p.identified && !r.p.visited7 && r.after.band !== 'cold').length;
  console.log(`  ${w.name} base ${w.visitBase} + ${w.visitPerVisitor}/visitor (max ${w.visitVisitorsMax} -> ceiling ${w.visitBase + w.visitPerVisitor * w.visitVisitorsMax}${w.idDecay ? '' : ', no idDecay'}): flips ${flips.length} of ${scope.length} (${JSON.stringify(by)}; up ${up.length}, down ${flips.length - up.length}); bands after ${JSON.stringify(bands)}; hot with zero email rows ${visitOnlyHot}; old identified visitors (company not visited 7 d) above cold ${idWarm}; max visit pts seen ${maxVisit}`);
  console.log(`     e.g. ` + flips.slice(0, 8).map(r => `${r.p.name} (${r.p.company}) ${r.before}->${r.after.band} ${r.p.scored.score}->${r.after.score}${r.p.identified ? ' [identified]' : ''}`).join(' · '));
}
// H2 alone (no points): who becomes Hot from the visit rule only
const h2 = scope.filter(p => !p.msgs.some(m => m.replied) && p.band !== 'hot' && p.visited7 && (p.msgs.some(m => m.delivered_at) || p.identified));
console.log(`  H2 rule alone (visit 7 d + sent >= 1 or identified) lifts to Hot: ${h2.length} (${JSON.stringify(tally(h2))}): ` + h2.slice(0, 10).map(p => `${p.name} (${p.company})`).join(' · '));
const browseOnly = scope.filter(p => p.visited7 && !p.identified && !p.msgs.some(m => m.delivered_at));
console.log(`  browse-only people (company visited, 0 sent, not identified - Warm at most): ${browseOnly.length}`);

// ---- (d) employees coverage by table / source
const cov = (label, xs) => { const by = xs.reduce((o, r) => { const k = r.employees == null ? 'unknown' : (r.employees_source || 'null-source'); o[k] = (o[k] || 0) + 1; return o; }, {}); console.log(`    ${label}: ${xs.length} live · known ${xs.filter(r => r.employees != null).length} · ${JSON.stringify(by)}`); };
console.log(`\n(d) employees coverage (live records)`);
cov('partners (sales_goals partnership, not archived)', partners.filter(p => !p.archived_at));
cov('employers (sales_opportunities, not archived)', opportunities.filter(o => !o.archived_at));
cov('targets (sales_targets, status != rejected)', targets.filter(t => t.status !== 'rejected'));
const emptyIds = new Set([...partners.filter(p => !p.archived_at && p.employees == null).map(p => `partner:${p.id}`), ...opportunities.filter(o => !o.archived_at && o.employees == null).map(o => `employer:${o.id}`), ...targets.filter(t => t.status !== 'rejected' && t.employees == null).map(t => `target:${t.id}`)]);
const peopleCoUnknown = people.filter(p => p.rec?.id && emptyIds.has(`${p.rec.type}:${p.rec.id}`)).length;
console.log(`    people rows whose company has no headcount: ${peopleCoUnknown} of ${people.length} (no company record at all - account / parked name only: ${people.filter(p => !p.rec?.id).length})`);
console.log(`    Norton: ` + [...partners, ...opportunities, ...targets].filter(r => /norton/i.test(r.name || r.organization || '')).map(r => `${r.name || r.organization} employees=${r.employees} source=${r.employees_source}`).join(' | ') || 'no record');
console.log(`\ndone in ${Date.now() - t0} ms · 0 writes · 0 Claude · 0 Apollo`);
