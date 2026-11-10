// Ran at HEAD 9a6cc77, before heat-v2 Stage 1 removed huddleSignals - kept as the Stage 0 record; it no longer runs as is.
// heat-v2 Stage 0 - READ-ONLY (0 writes, 0 Claude, 0 Apollo). HomeLover only. One read of the tables the People route
// and the sales_person_activity writer read. Prints counts and NAMES / COMPANIES ONLY (never an address or phone).
// (a) today's stored band distribution + the hot people with reply age / last click / last visit; (b) three candidate
// fade schedules (H1: one schedule for every family, by the family's newest signal) applied to the real rows - who stays
// hot, who drops, the distribution; (c) replied_seen_at coverage; (d) the source enum values on rows with counts.
// Usage: node scripts/verify/heat-v2-stage0.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { scoreProspect, huddleSignals, visitSignal, HEAT, HEAT_BANDS } = await import('../../api/sales/heatScore.js');
const { SCANNER_CLICK_WITHIN_SECONDS } = await import('../../api/sales/nextBestAction.js');
const { peopleRows } = await import('../../api/sales/peopleActivityRoutes.js');
const { mergePeople, SOURCE_WORD } = await import('../../api/sales/peopleMerge.js');
const { visitIndex } = await import('../../api/sales/visitJoin.js');
const { replyAt } = await import('../../api/sales/replyTime.js');
const { laDateString } = await import('../../api/sales/laDate.js');

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
const NOW = Date.now(), DAY = 864e5;
const all = (t, cols, build = x => x) => selectAllPages(() => build(svc.from(t).select(cols).eq('business_id', HL)).order('id'));
const t0 = Date.now();
const [prospects, salesPeople, partnerContacts, opportunities, targets, partners, visits, activity, messages, events] = await Promise.all([
  selectAllPages(() => svc.from('sales_prospect_state').select('contact_id, name, title, company, opportunity_id, goal_id, status, owner').eq('business_id', HL).order('contact_id')),
  all('sales_people', 'id, company_type, opportunity_id, target_id, name, title, source_kind, visit_id, upload_id, archived_at, created_at, company_name'),
  all('partner_contacts', 'id, goal_id, name, title, apollo_contact_id, last_activity_at'),
  all('sales_opportunities', 'id, organization, stage, owner_user_id, archived_at, employees, employees_source'),
  all('sales_targets', 'id, name, status, owner_user_id, employees, employees_source'),
  all('sales_goals', 'id, name, pipeline_status, owner_user_id, archived_at, employees, employees_source', x => x.eq('goal_type', 'partnership')),
  all('web_visits', 'id, company_key, company_name, matched_type, matched_id, visits_7d, unique_visitors_7d, last_visit, seen_to, pulled_on'),
  selectAllPages(() => svc.from('sales_person_activity').select('person_key, contact_id, sent, opened_h, clicked, replied, last_sent_at, last_open_at, last_click_at, last_reply_at, heat, heat_band, computed_at').eq('business_id', HL).order('person_key')),
  selectAllPages(() => svc.from('sales_email_messages').select('apollo_message_id,contact_id,sequence_id,step,delivered_at,replied,reply_class,replied_seen_at,replied_at,num_opens,num_clicks,last_opened_at,last_clicked_at,bounced').eq('business_id', HL).order('apollo_message_id')),
  selectAllPages(() => svc.from('sales_email_activity').select('id,apollo_message_id,contact_id,step,event,occurred_at,user_agent,tracking_service').eq('business_id', HL).order('id')),
]);
const rowsRead = prospects.length + salesPeople.length + partnerContacts.length + opportunities.length + targets.length + partners.length + visits.length + activity.length + messages.length + events.length;
console.log(`read ${rowsRead} rows in ${Date.now() - t0} ms (prospects ${prospects.length}, sales_people ${salesPeople.length}, partner_contacts ${partnerContacts.length}, web_visits ${visits.length}, activity ${activity.length}, messages ${messages.length}, events ${events.length})`);
console.log(`stored activity computed_at: ${[...new Set(activity.map(a => a.computed_at))].sort().slice(-1)[0]}`);

// ---- the People table's own rows
const rows = peopleRows({ prospects, salesPeople, partnerContacts, opportunities: opportunities.filter(o => !o.archived_at), targets, partners });
const visitOf = visitIndex(visits);
const act = new Map(); for (const a of activity) { act.set(a.person_key, a); if (a.contact_id) act.set(`c:${a.contact_id}`, a); }
const msgsBy = new Map(), evsBy = new Map();
for (const m of messages) { if (!msgsBy.has(m.contact_id)) msgsBy.set(m.contact_id, []); msgsBy.get(m.contact_id).push(m); }
for (const e of events) { if (!evsBy.has(e.contact_id)) evsBy.set(e.contact_id, []); evsBy.get(e.contact_id).push(e); }
const spById = new Map(salesPeople.map(p => [String(p.id), p]));
const ago = iso => (iso ? Math.floor((NOW - Date.parse(iso)) / DAY) : null);
const d = n => (n == null ? '—' : `${n} d`);

const people = mergePeople(rows).map(p => {
  const stored = p.source_keys.map(k => act.get(k)).find(Boolean) || p.apollo_ids.map(id => act.get(`c:${id}`)).find(Boolean) || null;
  const msgs = p.apollo_ids.flatMap(id => msgsBy.get(id) || []), evs = p.apollo_ids.flatMap(id => evsBy.get(id) || []);
  const sp = p.source_keys.map(k => (k.startsWith('person:') ? spById.get(k.slice(7)) : null)).find(Boolean) || null;
  const identifiedAt = sp && sp.source_kind === 'web_visit' ? sp.created_at || null : null;
  const visit = visitSignal({ visit: visitOf(p.company), identifiedAt, now: NOW });
  const scored = scoreProspect(msgs, evs, visit, NOW);
  const sig = huddleSignals(msgs, evs, scored, NOW, SCANNER_CLICK_WITHIN_SECONDS);
  const deliveredById = new Map(msgs.map(m => [m.apollo_message_id, m.delivered_at]));
  // Families, unfaded, by the same rules scoreProspect uses today; each with its newest signal.
  let replyPts = 0, replyClass = null, excluded = false;
  const replied = msgs.filter(m => m.replied);
  for (const m of replied) {
    if (HEAT.excludedReplyClasses.includes(m.reply_class)) { excluded = true; continue; }
    const pts = m.reply_class ? (HEAT.replyPoints[m.reply_class] ?? HEAT.replyPointsUnclassified) : HEAT.replyPointsUnclassified;
    if (pts > replyPts) { replyPts = pts; replyClass = m.reply_class; }
  }
  const counted = replied.filter(m => !HEAT.excludedReplyClasses.includes(m.reply_class));
  const replySeen = counted.map(replyAt).filter(Boolean).sort().pop() || null;
  const replyDelivered = counted.map(m => m.delivered_at).filter(Boolean).sort().pop() || null;
  const replyAtUsed = replySeen || replyDelivered;
  const clicks = evs.filter(e => e.event === 'click');
  const clickDays = new Set(clicks.map(e => laDateString(new Date(e.occurred_at)))).size;
  const clickPts = clickDays * HEAT.clickPerDay;
  const clickAt = [...clicks.map(e => e.occurred_at), ...msgs.map(m => m.last_clicked_at)].filter(Boolean).sort().pop() || null;
  const humanClickAt = clicks.filter(e => { const dl = deliveredById.get(e.apollo_message_id); return dl && (Date.parse(e.occurred_at) - Date.parse(dl)) / 1000 > SCANNER_CLICK_WITHIN_SECONDS; }).map(e => e.occurred_at).sort().pop() || null;
  const openPts = scored.badges.possible_bot_open ? 0 : Math.min(HEAT.openMax, scored.badges.opens * HEAT.openEach);
  const openAt = [...evs.filter(e => e.event === 'open').map(e => e.occurred_at), ...msgs.map(m => m.last_opened_at)].filter(Boolean).sort().pop() || null;
  const visitPts = visit ? HEAT.visitBase + HEAT.visitPerVisitor * Math.min(visit.people, HEAT.visitVisitorsMax) : 0;
  const fam = {
    reply: { pts: replyPts, at: replyAtUsed, seen: !!replySeen },
    click: { pts: clickPts, at: clickAt },
    open: { pts: openPts, at: openAt },
    visit: { pts: visitPts, at: visit ? visit.at : null },
  };
  return { key: p.key, name: p.name, company: p.company?.name || null, sources: p.sources, stored, msgs, evs, scored, sig, fam, excluded, replyClass, humanClickAt, hasSignal: !!(msgs.length || evs.length || visit) };
});
const withSignal = people.filter(p => p.hasSignal);
const noStored = withSignal.filter(p => !p.stored).length;
console.log(`\npeople (merged, the table's rows): ${people.length}; with any signal (email rows or a visit) ${withSignal.length}; stored heat rows ${activity.length}; signal but no stored row ${noStored}`);

// ---- (a) today
const tally = (xs, f) => xs.reduce((o, p) => { const b = f(p); o[b] = (o[b] || 0) + 1; return o; }, {});
const stored = withSignal.filter(p => p.stored);
console.log(`\n(a) TODAY - stored sales_person_activity (what the table shows): ${JSON.stringify(tally(stored, p => p.stored.heat_band))}`);
console.log(`    recomputed now with the current rules: ${JSON.stringify(tally(withSignal, p => p.sig.heat_band))} (stored != recomputed: ${stored.filter(p => p.stored.heat !== p.scored.score || p.stored.heat_band !== p.sig.heat_band).length})`);
const warmAboveHot = (() => { const hot = stored.filter(p => p.stored.heat_band === 'hot').map(p => p.stored.heat); const warm = stored.filter(p => p.stored.heat_band === 'warm').map(p => p.stored.heat); return { lowestHot: Math.min(...hot), highestWarm: Math.max(...warm), warmAboveLowestHot: warm.filter(h => h > Math.min(...hot)).length }; })();
console.log(`    lowest hot ${warmAboveHot.lowestHot} · highest warm ${warmAboveHot.highestWarm} · warm rows above the lowest hot: ${warmAboveHot.warmAboveLowestHot}`);
const hotToday = stored.filter(p => p.stored.heat_band === 'hot').sort((a, b) => b.stored.heat - a.stored.heat);
console.log(`    hot today (${hotToday.length}) - heat · reply age (seen | delivered-only) · last click (any / human) · last open · last visit · bracket today:`);
for (const p of hotToday) {
  const f = p.fam;
  console.log(`      ${p.stored.heat.toString().padStart(3)}  ${p.name}${p.company ? ` (${p.company})` : ''} · reply ${f.reply.pts ? `${d(ago(f.reply.at))}${f.reply.seen ? '' : ' delivered-only'}${p.replyClass ? ` ${p.replyClass}` : ' unclassified'}` : 'none'} · click ${d(ago(f.click.at))} / ${d(ago(p.humanClickAt))} · open ${d(ago(f.open.at))} · visit ${d(ago(f.visit.at))} · bracket ${p.scored.score >= 40 ? 'hot' : p.scored.score >= 10 ? 'warm' : 'cold'}`);
}
const warmHigh = stored.filter(p => p.stored.heat_band === 'warm' && p.stored.heat >= HEAT_BANDS.hotScore).sort((a, b) => b.stored.heat - a.stored.heat);
console.log(`    warm today with heat >= ${HEAT_BANDS.hotScore} (${warmHigh.length}):`);
for (const p of warmHigh) console.log(`      ${p.stored.heat.toString().padStart(3)}  ${p.name}${p.company ? ` (${p.company})` : ''} · reply ${p.fam.reply.pts ? `${d(ago(p.fam.reply.at))}${p.fam.reply.seen ? '' : ' delivered-only'}` : 'none'} · click ${d(ago(p.fam.click.at))} · open ${d(ago(p.fam.open.at))} · visit ${d(ago(p.fam.visit.at))}`);

// ---- (b) schedules
const SCHEDULES = [
  { id: 'S1 gentle', fadeFresh: 7, fadeMid: 0.5, fadeOld: 30, fadeFloor: 0.25 },
  { id: 'S2 middle', fadeFresh: 3, fadeMid: 0.5, fadeOld: 14, fadeFloor: 0.25 },
  { id: 'S3 steep', fadeFresh: 3, fadeMid: 0.5, fadeOld: 10, fadeFloor: 0.1 },
];
const fade = (s, at) => { if (!at) return 1; const age = (NOW - Date.parse(at)) / DAY; return age <= s.fadeFresh ? 1 : age <= s.fadeOld ? s.fadeMid : s.fadeFloor; };
const heatUnder = (s, p) => (p.excluded && !p.fam.reply.pts ? 0 : Math.round(Object.values(p.fam).reduce((n, f) => n + f.pts * fade(s, f.at), 0)));
const bandOf = h => (h >= HEAT_BANDS.hotScore ? 'hot' : h >= HEAT_BANDS.warmScore ? 'warm' : 'cold');
const todayHotKeys = new Set(hotToday.map(p => p.key));
console.log(`\n(b) ONE SCALE (H1 fade per family by its newest signal, H2 band = bracket 40 / 10) on ${withSignal.length} people with a signal`);
console.log(`    B0 = today's points with today's fade (reply never fades, clicks/opens x0.5 after 3 d) but band = bracket only:`);
const b0 = withSignal.map(p => ({ p, h: p.scored.score }));
console.log(`      ${JSON.stringify(tally(b0, x => bandOf(x.h)))} · of today's ${hotToday.length} hot: stay hot ${b0.filter(x => todayHotKeys.has(x.p.key) && bandOf(x.h) === 'hot').length}, drop ${b0.filter(x => todayHotKeys.has(x.p.key) && bandOf(x.h) !== 'hot').map(x => `${x.p.name} ${x.h}`).join(', ') || 'none'}; newly hot ${b0.filter(x => !todayHotKeys.has(x.p.key) && bandOf(x.h) === 'hot').map(x => `${x.p.name} ${x.h}`).join(', ') || 'none'}`);
for (const s of SCHEDULES) {
  const scored = withSignal.map(p => ({ p, h: heatUnder(s, p) }));
  const dist = tally(scored, x => bandOf(x.h));
  const stay = scored.filter(x => todayHotKeys.has(x.p.key) && bandOf(x.h) === 'hot');
  const drop = scored.filter(x => todayHotKeys.has(x.p.key) && bandOf(x.h) !== 'hot');
  const newly = scored.filter(x => !todayHotKeys.has(x.p.key) && bandOf(x.h) === 'hot');
  const hs = scored.map(x => x.h).sort((a, b) => b - a);
  console.log(`    ${s.id}: x1.0 for 0-${s.fadeFresh} d, x${s.fadeMid} to ${s.fadeOld} d, then x${s.fadeFloor}`);
  console.log(`      ${JSON.stringify(dist)} · max ${hs[0]} · top 5 ${hs.slice(0, 5).join(' ')} · of today's ${hotToday.length} hot: stay ${stay.length}, drop ${drop.length}; newly hot ${newly.length}`);
  console.log(`      stay: ${stay.sort((a, b) => b.h - a.h).map(x => `${x.p.name} ${x.h}`).join(', ') || 'none'}`);
  console.log(`      drop: ${drop.sort((a, b) => b.h - a.h).map(x => `${x.p.name} ${x.h} ${bandOf(x.h)}`).join(', ') || 'none'}`);
  console.log(`      newly hot: ${newly.sort((a, b) => b.h - a.h).map(x => `${x.p.name} ${x.h}`).join(', ') || 'none'}`);
}
console.log(`    the hot-today people under each schedule (today · B0 · S1 · S2 · S3):`);
for (const p of hotToday) console.log(`      ${p.name}: ${p.stored.heat} · ${p.scored.score} · ${SCHEDULES.map(s => heatUnder(s, p)).join(' · ')}`);
console.log(`    the >= 40 warm-today people under each schedule (today · B0 · S1 · S2 · S3):`);
for (const p of warmHigh) console.log(`      ${p.name}: ${p.stored.heat} · ${p.scored.score} · ${SCHEDULES.map(s => heatUnder(s, p)).join(' · ')}`);
const ageHist = (f, xs) => { const h = { '0-3': 0, '4-7': 0, '8-14': 0, '15-30': 0, '31+': 0, none: 0 }; for (const p of xs) { const a = ago(p.fam[f].at); if (a == null) h.none++; else h[a <= 3 ? '0-3' : a <= 7 ? '4-7' : a <= 14 ? '8-14' : a <= 30 ? '15-30' : '31+']++; } return h; };
for (const f of ['reply', 'click', 'open', 'visit']) { const xs = withSignal.filter(p => p.fam[f].pts > 0); console.log(`    ${f} family: ${xs.length} people with points; age of newest signal ${JSON.stringify(ageHist(f, xs))}`); }

// ---- (c) replied_seen_at coverage
const repliedMsgs = messages.filter(m => m.replied);
const cov = { replied_messages: repliedMsgs.length, with_replied_seen_at: repliedMsgs.filter(m => m.replied_seen_at).length, with_replied_at: repliedMsgs.filter(m => m.replied_at).length, neither: repliedMsgs.filter(m => !m.replied_seen_at && !m.replied_at).length, excluded_class: repliedMsgs.filter(m => HEAT.excludedReplyClasses.includes(m.reply_class)).length, unclassified: repliedMsgs.filter(m => !m.reply_class).length };
const repliedPeople = withSignal.filter(p => p.msgs.some(m => m.replied));
console.log(`\n(c) replied_seen_at coverage: ${JSON.stringify(cov)}`);
console.log(`    people with a reply ${repliedPeople.length}; whose newest counted reply has a seen time ${repliedPeople.filter(p => p.fam.reply.seen).length}; delivered-only ${repliedPeople.filter(p => p.fam.reply.pts && !p.fam.reply.seen).map(p => `${p.name} (${d(ago(p.fam.reply.at))})`).join(', ') || 'none'}; excluded-only (not_interested / unsubscribe) ${repliedPeople.filter(p => p.excluded && !p.fam.reply.pts).length}`);
const replyClasses = tally(repliedMsgs, m => m.reply_class || 'null');
console.log(`    reply_class on replied messages: ${JSON.stringify(replyClasses)}`);

// ---- (d) source enum
console.log(`\n(d) source enum - raw sales_people.source_kind (live rows): ${JSON.stringify(tally(salesPeople.filter(p => !p.archived_at), p => p.source_kind || 'null'))}; with visit_id ${salesPeople.filter(p => !p.archived_at && p.visit_id).length}, with upload_id ${salesPeople.filter(p => !p.archived_at && p.upload_id).length}`);
console.log(`    the table's row source (peopleRows -> SOURCE_WORD, first source): ${JSON.stringify(tally(people, p => SOURCE_WORD[p.sources[0]]))}`);
console.log(`    all sources on a row (a person can carry several): ${JSON.stringify(tally(people.flatMap(p => p.sources.map(s => ({ s }))), x => SOURCE_WORD[x.s]))}; multi-source rows ${people.filter(p => p.sources.length > 1).length} ${JSON.stringify(tally(people.filter(p => p.sources.length > 1), p => p.sources.map(s => SOURCE_WORD[s]).join(' + ')))}`);
console.log(`    SOURCE_WORD keys: ${JSON.stringify(SOURCE_WORD)}`);
console.log(`\nwrites 0 · Claude 0 · Apollo 0 · restored: yes (nothing changed)`);
