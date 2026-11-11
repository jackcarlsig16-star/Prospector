// email-funnel-v1 Stage 0 - READ-ONLY (0 writes, 0 Claude, 0 Apollo). HomeLover only. One read each of
// sales_email_daily_counts (since Oct 26), sales_email_messages, sales_email_activity, sales_prospect_state,
// partner_contacts, sales_opportunities, sales_targets, sales_goals (partnerships), sales_people (web_visit),
// web_visits, visit_pull_runs, microsoft_events. Prints (a) delivered both ways by day, (b) the F1a company rate and
// F1b person rate for four windows with the names of the companies that both got email and visited, (c) human opens /
// clicks / replies / meetings by the existing rules, (d) how a message resolves to a company and how many fail, (e) the
// backfill's day coverage. Company names only - never an address, a phone or a contact id in the output.
// Usage: node scripts/verify/email-funnel-v1-stage0.mjs
import { createRequire } from 'module';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(ROOT + '/package.json');
require('dotenv').config({ path: ROOT + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { selectAllPages } = await import('../../api/lib/selectAllPages.js');
const { laDateString } = await import('../../api/sales/laDate.js');
const { isBotOpen, isAutomated, HEAT } = await import('../../api/sales/heatScore.js');
const { SCANNER_CLICK_WITHIN_SECONDS } = await import('../../api/sales/nextBestAction.js');
const { replyAt } = await import('../../api/sales/replyTime.js');
const { countExternalMeetings } = await import('../../api/sales/scorecardMath.js');
const { visitIndex, VISIT_TYPE } = await import('../../api/sales/visitJoin.js');
const { nameKey } = await import('../../api/sales/peopleMerge.js');
const { normName } = await import('../../api/sales/intakeMatch.js');
const { coveredDays } = await import('../../api/sales/visitTrend.js');

setTimeout(() => { console.log('CAP: 180 s'); process.exit(1); }, 180000).unref();
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const HL = (await svc.from('businesses').select('id').ilike('name', '%homelover%')).data[0].id;
const today = laDateString();
const DAY = 864e5;
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const wd = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const laDay = iso => (iso ? laDateString(new Date(iso)) : null);
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)} %` : '—');
const FROM = '2026-10-26', FIRST_VISIT_DAY = '2026-10-20';
const t0 = Date.now();
const all = (table, cols, build = q => q, order = 'id') => selectAllPages(() => build(svc.from(table).select(cols).eq('business_id', HL)).order(order));
const [allCounts, messages, events, prospects, partnerContacts, opps, targets, partners, people, visits, runs, calEvents, sequenced] = await Promise.all([
  all('sales_email_daily_counts', 'day, mailbox, sequence_id, step, delivered, opened, clicked, replied', q => q, 'day'),
  all('sales_email_messages', 'apollo_message_id, contact_id, delivered_at, replied, reply_class, replied_at, replied_seen_at, bounced', q => q, 'apollo_message_id'),
  all('sales_email_activity', 'id, apollo_message_id, contact_id, event, occurred_at, user_agent, tracking_service'),
  all('sales_prospect_state', 'contact_id, name, company, opportunity_id, goal_id', q => q, 'contact_id'),
  all('partner_contacts', 'id, apollo_contact_id, goal_id, name'),
  all('sales_opportunities', 'id, organization'),
  all('sales_targets', 'id, name'),
  all('sales_goals', 'id, name', q => q.eq('goal_type', 'partnership')),
  all('sales_people', 'id, name, title, company_name, company_type, opportunity_id, target_id, apollo_person_id, created_at, note', q => q.eq('source_kind', 'web_visit').is('archived_at', null)),
  all('web_visits', 'id, company_key, company_name, pulled_on, seen_from, seen_to, matched_type, matched_id, visits_7d'),
  all('visit_pull_runs', 'la_date, kind, status, window_start, window_end'),
  all('microsoft_events', 'id, graph_id, ical_uid, external_domains, start_at, is_cancelled, created_at_graph'),
  all('sales_sequenced_accounts', 'account_id, name, first_sequenced_at, sequence_id', q => q, 'account_id'),
]);
const counts = allCounts.filter(c => c.day >= FROM);
console.log(`email-funnel-v1 Stage 0 · read-only · HomeLover · today ${today} (${wd(today)}) · ${Date.now() - t0} ms`);
console.log(`rows: daily_counts ${allCounts.length} all time (${counts.length} since ${FROM}) · messages ${messages.length} · activity ${events.length} · prospects ${prospects.length} · partner contacts ${partnerContacts.length} · records ${opps.length} opp / ${targets.length} target / ${partners.length} partner · web_visit people ${people.length} · web_visits ${visits.length} · pull runs ${runs.length} · calendar events ${calEvents.length}`);

// ---- the message -> company join (d): contact -> sales_prospect_state -> opportunity (employer) / goal (partner) record,
// else the prospect's company text (a name, no record); a contact with no prospect row -> partner_contacts.apollo_contact_id
// -> its partner. The visit side keys records as VISIT_TYPE[type]:id (visitJoin.js) and names as normName (company_key).
const oppById = new Map(opps.map(o => [o.id, o])), goalById = new Map(partners.map(g => [g.id, g]));
const prospectBy = new Map(prospects.map(p => [p.contact_id, p]));
const pcBy = new Map(partnerContacts.filter(c => c.apollo_contact_id).map(c => [c.apollo_contact_id, c]));
function companyOf(contactId) {
  const p = prospectBy.get(contactId);
  if (p) {
    if (p.opportunity_id && oppById.has(p.opportunity_id)) return { via: 'prospect→opportunity', type: 'employer', id: p.opportunity_id, name: oppById.get(p.opportunity_id).organization };
    if (p.goal_id && goalById.has(p.goal_id)) return { via: 'prospect→partner', type: 'partner', id: p.goal_id, name: goalById.get(p.goal_id).name };
    if (p.company && normName(p.company)) return { via: 'prospect→company name (no record)', type: 'account', id: null, name: p.company };
    return { via: 'prospect row, no company', type: null, id: null, name: null };
  }
  const c = pcBy.get(contactId);
  if (c && c.goal_id && goalById.has(c.goal_id)) return { via: 'partner contact→partner', type: 'partner', id: c.goal_id, name: goalById.get(c.goal_id).name };
  return { via: 'no prospect row, no partner contact', type: null, id: null, name: null };
}
const companyKeyOf = c => (c.name ? (c.id ? `${VISIT_TYPE[c.type]}:${c.id}` : `name:${normName(c.name)}`) : null);

// ---- visit windows (R2): a row covers seen_from .. seen_to - 1 (seen_from alone when zero-length); a backfill row is
// matched the way visitTrend hides it. A company "visited in [from, to]" = any of its rows covers a day in the range.
const backfillKeys = new Set(runs.filter(r => r.kind === 'backfill' && r.status === 'ok' && r.window_start).map(r => `${r.la_date}|${r.window_start}|${r.window_end}`));
const isBackfill = v => backfillKeys.has(`${v.pulled_on}|${v.seen_from}|${v.seen_to}`);
const daysOf = v => (v.seen_from && v.seen_to ? coveredDays(v.seen_from, v.seen_to) : [v.pulled_on]);
const overlaps = (v, from, to) => daysOf(v).some(d => d >= from && d <= to);
const visitKeysOf = v => [v.company_key && `name:${v.company_key}`, v.matched_type && v.matched_id && `${v.matched_type}:${v.matched_id}`].filter(Boolean);
const visitsByKey = new Map();
for (const v of visits) for (const k of visitKeysOf(v)) { if (!visitsByKey.has(k)) visitsByKey.set(k, []); visitsByKey.get(k).push(v); }
const visitedIn = (c, from, to, { withBackfill = true } = {}) => {
  const keys = [companyKeyOf(c), c.id ? `name:${normName(c.name)}` : null].filter(Boolean);
  return keys.some(k => (visitsByKey.get(k) || []).some(v => (withBackfill || !isBackfill(v)) && overlaps(v, from, to)));
};

// ---- delivered, both ways (a)
const delivered = messages.filter(m => m.delivered_at).map(m => ({ ...m, day: laDay(m.delivered_at), company: companyOf(m.contact_id) }));
const byDayCounts = new Map(), byDayMsgs = new Map();
for (const c of counts) byDayCounts.set(c.day, (byDayCounts.get(c.day) || 0) + c.delivered);
for (const m of delivered) if (m.day >= FROM) byDayMsgs.set(m.day, (byDayMsgs.get(m.day) || 0) + 1);
console.log(`\n(a) delivered ${FROM} → ${today}, by LA day: day · daily_counts Σ delivered (Apollo, all mailboxes) · sales_email_messages rows (delivered_at) · gap`);
let sumC = 0, sumM = 0;
for (let d = FROM; d <= today; d = addDays(d, 1)) { const c = byDayCounts.get(d) || 0, m = byDayMsgs.get(d) || 0; sumC += c; sumM += m; if (c || m) console.log(`    ${d} ${wd(d)} · ${c} · ${m} · ${m - c >= 0 ? '+' : ''}${m - c}`); }
const since = delivered.filter(m => m.day >= FROM);
const mailboxes = [...new Set(counts.map(c => c.mailbox))];
const boxName = b => { const l = b.split('@')[0]; return `${l.charAt(0).toUpperCase()}${l.slice(1)}'s mailbox`; };
const perBox = mailboxes.map(b => `${boxName(b)} ${counts.filter(c => c.mailbox === b).reduce((n, c) => n + c.delivered, 0)}`);
console.log(`    TOTAL · daily_counts ${sumC} (${mailboxes.length} mailboxes: ${perBox.join(' · ')}) · messages ${sumM} · gap ${sumM - sumC >= 0 ? '+' : ''}${sumM - sumC} (${pct(Math.abs(sumM - sumC), sumC)} of Apollo's)`);
const allTime = allCounts.reduce((n, c) => n + c.delivered, 0), firstDay = allCounts.map(c => c.day).sort()[0];
console.log(`    ALL TIME · daily_counts Σ delivered ${allTime} since ${firstDay} (Jack's "4,209 since Oct 26" is this figure's shape, not the window's) · messages rows ever ${messages.length} (${delivered.length} with delivered_at, from ${delivered.map(m => m.day).sort()[0]})`);
console.log(`    distinct contacts reached ${new Set(since.map(m => m.contact_id)).size} · distinct company records reached ${new Set(since.map(m => m.company.id && companyKeyOf(m.company)).filter(Boolean)).size} · distinct companies incl. name-only ${new Set(since.map(m => companyKeyOf(m.company)).filter(Boolean)).size}`);
console.log(`    bounced rows in the same days ${since.filter(m => m.bounced).length} (delivered_at set and bounced = true - counted above)`);
const latestMsg = delivered.map(m => m.delivered_at).sort().pop();
console.log(`    newest delivered_at in sales_email_messages ${latestMsg} (LA ${laDay(latestMsg)}); newest daily_counts day ${[...byDayCounts.keys()].sort().pop()}`);

// ---- windows
const yesterday = addDays(today, -1);
const WINDOWS = [['since Oct 26', FROM, today], ['last 30 d', addDays(today, -29), today], ['last 7 d', addDays(today, -6), today], ['yesterday', yesterday, yesterday]];
const deliveredById = new Map(messages.map(m => [m.apollo_message_id, m.delivered_at]));
const msgContact = new Map(messages.map(m => [m.apollo_message_id, m.contact_id]));
const humanOpen = e => e.event === 'open' && !isBotOpen(e, deliveredById.get(e.apollo_message_id));
const humanClick = e => e.event === 'click' && !isAutomated(e, deliveredById.get(e.apollo_message_id), SCANNER_CLICK_WITHIN_SECONDS);
// midnight LA of day d as ms (LA is UTC-7 or UTC-8)
const laMs = d => { for (const off of [7, 8]) { const ms = Date.parse(`${d}T00:00:00Z`) + off * 3600e3; if (laDateString(new Date(ms)) === d && laDateString(new Date(ms - 1)) !== d) return ms; } return Date.parse(`${d}T08:00:00Z`); };
const peopleKey = p => nameKey(p.name, p.company_name || (p.opportunity_id && oppById.get(p.opportunity_id)?.organization) || (p.target_id && targets.find(t => t.id === p.target_id)?.name) || '');
const peopleByApollo = new Map(people.filter(p => p.apollo_person_id).map(p => [p.apollo_person_id, p]));
const peopleByName = new Map(people.map(p => [peopleKey(p), p]).filter(([k]) => k));
const identifiedDay = p => laDay(p.created_at);

console.log(`\n(b) F1a COMPANY rate = companies that got email in the window AND have a visit window overlapping it ÷ companies emailed (record key, else normalised name = company_key); F1b PERSON rate = people emailed whose identified-visitor row merges (same Apollo id, else name + company; identified in the window) ÷ distinct contacts emailed`);
for (const [label, from, to] of WINDOWS) {
  const inW = delivered.filter(m => m.day >= from && m.day <= to);
  const companies = new Map();
  for (const m of inW) { const k = companyKeyOf(m.company); if (k && !companies.has(k)) companies.set(k, m.company); }
  const visited = [...companies.values()].filter(c => visitedIn(c, from, to));
  const visitedNoBackfill = [...companies.values()].filter(c => visitedIn(c, from, to, { withBackfill: false }));
  const contacts = new Set(inW.map(m => m.contact_id));
  const identified = [...contacts].map(id => { const p = prospectBy.get(id); const hit = peopleByApollo.get(id) || (p && peopleByName.get(nameKey(p.name, p.company || companyOf(id).name))); return hit && identifiedDay(hit) >= from && identifiedDay(hit) <= to ? hit : null; }).filter(Boolean);
  const anyTime = [...contacts].map(id => { const p = prospectBy.get(id); return peopleByApollo.get(id) || (p && peopleByName.get(nameKey(p.name, p.company || companyOf(id).name))) || null; }).filter(Boolean);
  console.log(`  ${label} (${from} → ${to}): delivered ${inW.length} · companies emailed ${companies.size} (${[...companies.values()].filter(c => c.id).length} with a record) · visited ${visited.length} = ${pct(visited.length, companies.size)}${visitedNoBackfill.length !== visited.length ? ` (${visitedNoBackfill.length} = ${pct(visitedNoBackfill.length, companies.size)} without backfill rows)` : ''} · people emailed ${contacts.size} · identified on site in the window ${identified.length} = ${pct(identified.length, contacts.size)} (merged any time: ${anyTime.length})`);
  const names = visited.map(c => `${c.name}${c.id ? '' : ' (name only)'}`).sort((a, b) => a.localeCompare(b));
  console.log(`      visited: ${names.length ? names.join(' · ') : '—'}`);
  if (identified.length) console.log(`      identified: ${identified.map(p => `${p.name}${p.title ? ` (${p.title})` : ''} @ ${p.company_name || oppById.get(p.opportunity_id)?.organization || targets.find(t => t.id === p.target_id)?.name || '?'}`).join(' · ')}`);
}

// ---- (b2) the other company denominator Prospector already holds: sales_sequenced_accounts = one row per Apollo account
// at its FIRST step-1 delivery (sequencedAccounts.firstTouches, written by the weekly count fetch - 0 extra calls; later
// steps and later contacts at a known company are not recorded, so this is "companies first sequenced in the window").
console.log(`\n(b2) alternative F1a denominator - sales_sequenced_accounts (${sequenced.length} companies, first step-1 touch; names from Apollo's account): companies FIRST sequenced in the window, visited = a visit window overlapping [first touch day, window end]`);
for (const [label, from, to] of WINDOWS) {
  const inW = sequenced.filter(a => { const d = laDay(a.first_sequenced_at); return d >= from && d <= to; });
  const asCompany = a => ({ type: 'account', id: null, name: a.name || '' });
  const visited = inW.filter(a => a.name && visitedIn(asCompany(a), laDay(a.first_sequenced_at), to));
  const visitedAnyInWindow = inW.filter(a => a.name && visitedIn(asCompany(a), from, to));
  console.log(`  ${label}: first sequenced ${inW.length} (${inW.filter(a => !a.name).length} without a name) · visited on/after their first touch ${visited.length} = ${pct(visited.length, inW.length)} · visited anywhere in the window ${visitedAnyInWindow.length} = ${pct(visitedAnyInWindow.length, inW.length)}`);
  console.log(`      visited on/after first touch: ${visited.length ? visited.map(a => a.name).sort((x, y) => x.localeCompare(y)).join(' · ') : '—'} · anywhere in the window: ${visitedAnyInWindow.length ? visitedAnyInWindow.map(a => `${a.name} (first touch ${laDay(a.first_sequenced_at)})`).sort().join(' · ') : '—'}`);
}
const seqNamesVisitedEver = sequenced.filter(a => a.name && visitsByKey.has(`name:${normName(a.name)}`));
console.log(`    all time: ${seqNamesVisitedEver.length} of ${sequenced.length} sequenced companies have a web_visits row by normalised name at any time (${pct(seqNamesVisitedEver.length, sequenced.length)}); since Oct 26: ${sequenced.filter(a => laDay(a.first_sequenced_at) >= FROM).length} first-sequenced`);

// ---- (c) the funnel steps by the existing rules
console.log(`\n(c) human opens (heatScore.isBotOpen) · human clicks (heatScore.isAutomated, ${SCANNER_CLICK_WITHIN_SECONDS} s scanner rule) · replies (replyTime.replyAt; excluded classes ${HEAT.excludedReplyClasses.join(', ')} out) · meetings (scorecardMath.countExternalMeetings over microsoft_events)`);
console.log(`    two readings each: EVENTS IN THE WINDOW (whatever the message's delivery day) · COHORT = messages delivered in the window that ever got one`);
for (const [label, from, to] of WINDOWS) {
  const inW = delivered.filter(m => m.day >= from && m.day <= to), ids = new Set(inW.map(m => m.apollo_message_id));
  const evIn = events.filter(e => { const d = laDay(e.occurred_at); return d >= from && d <= to; });
  const hoEv = evIn.filter(humanOpen), hcEv = evIn.filter(humanClick);
  const botEv = evIn.filter(e => e.event === 'open' && !humanOpen(e)), scanEv = evIn.filter(e => e.event === 'click' && !humanClick(e));
  const cohortOpen = new Set(events.filter(e => ids.has(e.apollo_message_id) && humanOpen(e)).map(e => e.apollo_message_id));
  const cohortClick = new Set(events.filter(e => ids.has(e.apollo_message_id) && humanClick(e)).map(e => e.apollo_message_id));
  const repliesIn = messages.filter(m => m.replied && replyAt(m) && laDay(replyAt(m)) >= from && laDay(replyAt(m)) <= to);
  const cohortReplies = inW.filter(m => m.replied);
  const countedIn = repliesIn.filter(m => !HEAT.excludedReplyClasses.includes(m.reply_class)), countedCohort = cohortReplies.filter(m => !HEAT.excludedReplyClasses.includes(m.reply_class));
  const classes = Object.entries(repliesIn.reduce((o, m) => { const k = m.reply_class || 'unclassified'; o[k] = (o[k] || 0) + 1; return o; }, {})).map(([k, n]) => `${k} ${n}`).join(', ');
  const meetings = countExternalMeetings({ events: calEvents, weekStartMs: laMs(from), weekEndMs: laMs(addDays(to, 1)) }).booked;
  const apollo = allCounts.filter(c => c.day >= from && c.day <= to).reduce((o, c) => { o.delivered += c.delivered; o.opened += c.opened; o.clicked += c.clicked; o.replied += c.replied; return o; }, { delivered: 0, opened: 0, clicked: 0, replied: 0 });
  console.log(`  ${label}: delivered ${inW.length} (Apollo ${apollo.delivered})`);
  console.log(`      human opens: ${hoEv.length} events in window (${new Set(hoEv.map(e => e.apollo_message_id)).size} messages, ${new Set(hoEv.map(e => msgContact.get(e.apollo_message_id) || e.contact_id)).size} people; bot ${botEv.length} out) · cohort ${cohortOpen.size} of ${inW.length} = ${pct(cohortOpen.size, inW.length)} · Apollo opened ${apollo.opened}`);
  console.log(`      human clicks: ${hcEv.length} events (${new Set(hcEv.map(e => e.apollo_message_id)).size} messages; scanner ${scanEv.length} out) · cohort ${cohortClick.size} = ${pct(cohortClick.size, inW.length)} · Apollo clicked ${apollo.clicked}`);
  console.log(`      replies: ${repliesIn.length} arrived in window [${classes || '—'}] → ${countedIn.length} counted · cohort ${cohortReplies.length} replied → ${countedCohort.length} counted = ${pct(countedCohort.length, inW.length)} · Apollo replied ${apollo.replied}`);
  console.log(`      meetings booked (external, by Graph created time): ${meetings}`);
}

// ---- (d) the join
console.log(`\n(d) message → company, delivered ${FROM} → ${today} (${since.length} messages):`);
const via = since.reduce((o, m) => { o[m.company.via] = (o[m.company.via] || 0) + 1; return o; }, {});
for (const [k, n] of Object.entries(via).sort((a, b) => b[1] - a[1])) console.log(`    ${n} · ${k}`);
const nameOnly = [...new Map(since.filter(m => m.company.name && !m.company.id).map(m => [normName(m.company.name), m.company.name])).entries()];
const nameOnlyWithVisit = nameOnly.filter(([k]) => visitsByKey.has(`name:${k}`));
console.log(`    name-only companies ${nameOnly.length}; of those ${nameOnlyWithVisit.length} have a web_visits company_key equal to their normalised name (so the name path can match a visit)${nameOnlyWithVisit.length ? `: ${nameOnlyWithVisit.map(([, n]) => n).sort().join(' · ')}` : ''}`);
const unresolved = since.filter(m => !m.company.name);
console.log(`    FAIL the join (no company at all): ${unresolved.length} messages, ${new Set(unresolved.map(m => m.contact_id)).size} contacts`);
const recordsEmailed = new Set(since.filter(m => m.company.id).map(m => companyKeyOf(m.company)));
const recordsWithAnyVisit = [...recordsEmailed].filter(k => visitsByKey.has(k) || visitsByKey.has(`name:${normName(since.find(m => companyKeyOf(m.company) === k).company.name)}`));
console.log(`    records emailed ${recordsEmailed.size} · with a web_visits row at any time (by record match or name) ${recordsWithAnyVisit.length}`);
const matchedByRecord = [...recordsEmailed].filter(k => visitsByKey.has(k)).length, matchedByNameOnly = recordsWithAnyVisit.length - matchedByRecord;
console.log(`    of those: matched by the visit's matched_type/id ${matchedByRecord} · by normalised name only ${matchedByNameOnly}`);

// ---- (e) backfill feasibility (F3): per LA day since the first web_visits day, does the email side have a row and does a
// non-backfill pull window cover the day?
console.log(`\n(e) backfill per day ${FIRST_VISIT_DAY} → ${today}: email side = sales_email_daily_counts rows for the day (+ messages rows); visit side = non-backfill web_visits windows covering the day (R2), multi-day windows named`);
const countDays = new Set(allCounts.map(c => c.day));
const allByDay = new Map(); for (const c of allCounts) allByDay.set(c.day, (allByDay.get(c.day) || 0) + c.delivered);
const liveVisits = visits.filter(v => !isBackfill(v));
const windowsByKey = new Map();
for (const v of liveVisits) { const k = `${v.seen_from || v.pulled_on}|${v.seen_to || v.pulled_on}`; if (!windowsByKey.has(k)) windowsByKey.set(k, { days: daysOf(v), n: 0 }); windowsByKey.get(k).n++; }
let both = 0, emailOnly = 0, visitOnly = 0, neither = 0;
for (let d = FIRST_VISIT_DAY; d <= today; d = addDays(d, 1)) {
  const e = countDays.has(d), ws = [...windowsByKey.values()].filter(w => w.days.includes(d));
  const flag = e && ws.length ? 'both' : e ? 'email only' : ws.length ? 'visit only' : 'neither';
  if (flag === 'both') both++; else if (flag === 'email only') emailOnly++; else if (flag === 'visit only') visitOnly++; else neither++;
  console.log(`    ${d} ${wd(d)} · ${flag} · email ${e ? `${allByDay.get(d)} delivered` : '—'} · visit windows ${ws.length ? ws.map(w => `${w.days.length} d (${w.n} cos)`).join(', ') : '—'}`);
}
console.log(`    days both ${both} · email only ${emailOnly} · visit only ${visitOnly} · neither ${neither}; backfill rows hidden ${visits.length - liveVisits.length}; multi-day live windows ${[...windowsByKey.values()].filter(w => w.days.length > 1).length} of ${windowsByKey.size}`);
console.log(`\n0 writes · 0 Claude · 0 Apollo · ${Date.now() - t0} ms`);
