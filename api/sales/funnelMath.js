import { isBotOpen, isAutomated, HEAT } from './heatScore.js';
import { SCANNER_CLICK_WITHIN_SECONDS } from './nextBestAction.js';
import { replyAt } from './replyTime.js';
import { countExternalMeetings } from './scorecardMath.js';
import { VISIT_TYPE } from './visitJoin.js';
import { nameKey } from './peopleMerge.js';
import { normName } from './intakeMatch.js';
import { coveredDays } from './visitTrend.js';
import { laDateString } from './laDate.js';
import { addDays, laMonday, laStartOfDayMs } from './goalsShared.js';

// email-funnel-v1 Stage 1 - the ONE funnel computation (F2, rulings R1-R4), pure over rows the route loads. The route,
// the email builder, the day writer and Scout all read this - never a second formula.
// R1 denominator = sales_email_delivered (one row per delivered message, written by the weekly counts fetch), never
//    sales_email_messages (engaged-only). A message's company: its account_id -> an opportunity's apollo_account_id,
//    else its contact's prospect row -> opportunity / partner, else the account's or prospect's company NAME matched to a
//    record by normalised name, else the name alone ("without a record"). A message with no company at all is counted in
//    `companies_unresolved` and in no rate.
// R2 F1a company rate = companies emailed in the window with a visit in the window ÷ companies emailed; F1b person rate =
//    people emailed in the window identified on the site in the window (same Apollo id, else name + company) ÷ people
//    emailed. A visit's day = its pull window's LAST covered day (R4: a 3-day window attributes to its last day with
//    window_days = 3); a backfill pull is hidden the way the trend hides it.
// R3 opens / clicks / replies = COHORT: of the messages delivered in the window, those with a human open (isBotOpen), a
//    human click (the 120-s scanner rule), a counted reply (excluded classes out) so far. Meetings = external meetings
//    booked in the window (the Scorecard's rule) - they cannot tie to a message.
export const FUNNEL_SINCE = '2026-10-26';
export const VISITS_SINCE = '2026-10-20';
export const WINDOW_KEYS = ['yesterday', '7d', '30d', 'this_week', 'last_week', 'since'];
export const STEPS = ['delivered', 'human_opens', 'human_clicks', 'companies_visited', 'people_identified', 'replies', 'meetings'];
export const STEP_WORD = { delivered: 'delivered', human_opens: 'human opens', human_clicks: 'clicks', companies_visited: 'companies visited', people_identified: 'people identified', replies: 'replies', meetings: 'meetings' };
export const WORDING = {
  company: 'Company rate: of the companies we delivered email to in the window, the share with a website visit in the same window. A company is its Pipeline record, else its name.',
  person: 'Person rate: of the people we delivered email to in the window, the share Apollo later identified on the site as the same person (the same Apollo contact, else the same name at the same company).',
  cohort: 'of emails sent that day/week, so far',
  since: `The funnel starts ${new Date(`${FUNNEL_SINCE}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}, the first day website visits were tracked.`,
};
const laDay = iso => (iso ? laDateString(new Date(iso)) : null);
const share = (n, d) => (d ? n / d : null);
const rate = (n, d) => ({ n, d, rate: share(n, d) });

export function windowRange(key, today) {
  const mon = laMonday(today);
  if (key === 'yesterday') return { from: addDays(today, -1), to: addDays(today, -1) };
  if (key === '7d') return { from: addDays(today, -6), to: today };
  if (key === '30d') return { from: addDays(today, -29), to: today };
  if (key === 'this_week') return { from: mon, to: today };
  if (key === 'last_week') return { from: addDays(mon, -7), to: addDays(mon, -1) };
  if (key === 'since') return { from: FUNNEL_SINCE, to: today };
  return null;
}

// rows: { delivered, messages, events, prospects, partnerContacts, opportunities, targets, partners, sequenced, people,
// visits, runs, calEvents } - every table business-scoped. -> an index the window / day functions read.
export function funnelContext(rows) {
  const { delivered = [], messages = [], events = [], prospects = [], partnerContacts = [], opportunities = [], targets = [], partners = [], sequenced = [], people = [], visits = [], runs = [], calEvents = [] } = rows;
  const oppById = new Map(opportunities.map(o => [o.id, o])), goalById = new Map(partners.map(g => [g.id, g]));
  const oppByAccount = new Map(opportunities.filter(o => o.apollo_account_id).map(o => [o.apollo_account_id, o]));
  const byName = new Map();
  for (const t of targets) if (t.name) byName.set(normName(t.name), { type: 'target', id: t.id, name: t.name });
  for (const g of partners) if (g.name) byName.set(normName(g.name), { type: 'partner', id: g.id, name: g.name });
  for (const o of opportunities) if (o.organization) byName.set(normName(o.organization), { type: 'employer', id: o.id, name: o.organization });
  const prospectBy = new Map(prospects.map(p => [p.contact_id, p]));
  const pcBy = new Map(partnerContacts.filter(c => c.apollo_contact_id).map(c => [c.apollo_contact_id, c]));
  const accountName = new Map(sequenced.filter(a => a.name).map(a => [a.account_id, a.name]));
  const companyOf = d => {
    const o = d.account_id && oppByAccount.get(d.account_id);
    if (o) return { type: 'employer', id: o.id, name: o.organization };
    const p = prospectBy.get(d.contact_id);
    if (p?.opportunity_id && oppById.has(p.opportunity_id)) { const r = oppById.get(p.opportunity_id); return { type: 'employer', id: r.id, name: r.organization }; }
    if (p?.goal_id && goalById.has(p.goal_id)) { const r = goalById.get(p.goal_id); return { type: 'partner', id: r.id, name: r.name }; }
    const c = pcBy.get(d.contact_id);
    if (c?.goal_id && goalById.has(c.goal_id)) { const r = goalById.get(c.goal_id); return { type: 'partner', id: r.id, name: r.name }; }
    const name = (d.account_id && accountName.get(d.account_id)) || p?.company || null;
    if (!name || !normName(name)) return null;
    return byName.get(normName(name)) || { type: null, id: null, name };
  };
  const keyOf = c => (c.id ? `${VISIT_TYPE[c.type]}:${c.id}` : `name:${normName(c.name)}`);
  // Visits: the live rows (backfill hidden), each on its attributed day with its window's length.
  const backfill = new Set(runs.filter(r => r.kind === 'backfill' && r.status === 'ok' && r.window_start).map(r => `${r.la_date}|${r.window_start}|${r.window_end}`));
  const visitDays = new Map(), windowDaysOf = new Map();
  for (const v of visits) {
    if (backfill.has(`${v.pulled_on}|${v.seen_from}|${v.seen_to}`)) continue;
    const days = v.seen_from && v.seen_to ? coveredDays(v.seen_from, v.seen_to) : [v.pulled_on];
    const day = days[days.length - 1];
    windowDaysOf.set(day, Math.max(windowDaysOf.get(day) || 1, days.length));
    for (const k of [`name:${v.company_key}`, v.matched_type && v.matched_id ? `${v.matched_type}:${v.matched_id}` : null]) { if (!k) continue; if (!visitDays.has(k)) visitDays.set(k, new Set()); visitDays.get(k).add(day); }
  }
  const visitedIn = (c, from, to) => [keyOf(c), c.id ? `name:${normName(c.name)}` : null].some(k => k && [...(visitDays.get(k) || [])].some(d => d >= from && d <= to));
  // Identified visitors by Apollo id and by name + company (peopleMerge's rule), on their identification day.
  const personCompany = p => p.company_name || (p.opportunity_id && oppById.get(p.opportunity_id)?.organization) || (p.target_id && targets.find(t => t.id === p.target_id)?.name) || '';
  const peopleByApollo = new Map(), peopleByName = new Map();
  for (const p of people) { const day = laDay(p.created_at); if (!day) continue; if (p.apollo_person_id) peopleByApollo.set(p.apollo_person_id, day); const k = nameKey(p.name, personCompany(p)); if (k && !peopleByName.has(k)) peopleByName.set(k, day); }
  const identifiedDay = (contactId, company) => { if (peopleByApollo.has(contactId)) return peopleByApollo.get(contactId); const p = prospectBy.get(contactId); const k = p && nameKey(p.name, company?.name || p.company); return (k && peopleByName.get(k)) || null; };
  // Opens / clicks per message, judged once against the message's delivery instant.
  const deliveredAt = new Map(delivered.map(d => [d.apollo_message_id, d.delivered_at]));
  for (const m of messages) if (m.delivered_at && !deliveredAt.has(m.apollo_message_id)) deliveredAt.set(m.apollo_message_id, m.delivered_at);
  const humanOpen = new Set(), humanClick = new Set();
  for (const e of events) {
    if (e.event !== 'open' && e.event !== 'click') continue;
    const at = deliveredAt.get(e.apollo_message_id);
    if (e.event === 'open' ? !isBotOpen(e, at) : !isAutomated(e, at, SCANNER_CLICK_WITHIN_SECONDS)) (e.event === 'open' ? humanOpen : humanClick).add(e.apollo_message_id);
  }
  const replied = new Map(messages.filter(m => m.replied).map(m => [m.apollo_message_id, m]));
  const rows2 = delivered.map(d => { const c = companyOf(d); return { ...d, company: c, key: c ? keyOf(c) : null }; });
  return { delivered: rows2, humanOpen, humanClick, replied, visitedIn, identifiedDay, windowDaysOf, calEvents, visitDaysAll: visitDays };
}

export function funnelWindow(ctx, from, to) {
  const inW = ctx.delivered.filter(d => d.delivered_day >= from && d.delivered_day <= to);
  const contacts = new Set(inW.map(d => d.contact_id));
  const companies = new Map();
  for (const d of inW) if (d.key && !companies.has(d.key)) companies.set(d.key, d.company);
  const visited = [...companies.values()].filter(c => ctx.visitedIn(c, from, to));
  const identified = [...contacts].filter(id => { const d = ctx.identifiedDay(id, inW.find(x => x.contact_id === id)?.company || null); return d && d >= from && d <= to; });
  const repliedRows = inW.map(d => ctx.replied.get(d.apollo_message_id)).filter(Boolean);
  const counted = repliedRows.filter(m => !HEAT.excludedReplyClasses.includes(m.reply_class));
  const byClass = {};
  for (const m of repliedRows) { const k = m.reply_class || 'unclassified'; byClass[k] = (byClass[k] || 0) + 1; }
  const meetings = countExternalMeetings({ events: ctx.calEvents, weekStartMs: laStartOfDayMs(from), weekEndMs: laStartOfDayMs(addDays(to, 1)) }).booked;
  const steps = {
    delivered: inW.length,
    human_opens: inW.filter(d => ctx.humanOpen.has(d.apollo_message_id)).length,
    human_clicks: inW.filter(d => ctx.humanClick.has(d.apollo_message_id)).length,
    companies_visited: visited.length,
    people_identified: identified.length,
    replies: counted.length,
    meetings,
  };
  return {
    from, to, ...steps,
    people_emailed: contacts.size, companies_emailed: companies.size, companies_no_record: [...companies.values()].filter(c => !c.id).length,
    companies_unresolved: inW.filter(d => !d.key).length,
    shares: Object.fromEntries(STEPS.filter(s => s !== 'delivered').map(s => [s, share(steps[s], steps.delivered)])),
    company_rate: rate(visited.length, companies.size), person_rate: rate(identified.length, contacts.size),
    companies_visited_names: visited.map(c => c.name).sort((a, b) => a.localeCompare(b)),
    replies_by_class: byClass, replies_excluded: repliedRows.length - counted.length,
  };
}

// One sales_funnel_days row (F3 + R4): the day as a one-day window, which sides the day has, the longest visit window
// that ends on it.
export function funnelDay(ctx, day) {
  const w = funnelWindow(ctx, day, day);
  const email = w.delivered > 0, visits = [...ctx.visitDaysAll.values()].some(days => days.has(day));
  return {
    day, delivered: w.delivered, people_emailed: w.people_emailed, companies_emailed: w.companies_emailed, companies_no_record: w.companies_no_record,
    human_opens: w.human_opens, human_clicks: w.human_clicks, companies_visited: w.companies_visited, people_identified: w.people_identified, replies: w.replies, meetings: w.meetings,
    sides_present: email && visits ? 'both' : email ? 'email' : visits ? 'visits' : 'none', window_days: ctx.windowDaysOf.get(day) || 1,
  };
}

// F4 table 2's arrow: the trailing 30 days' company rate against the 30 before, from the day rows - absent until 60 days
// of email-side rows exist.
export function trend30(series, today) {
  const cut = addDays(today, -29), start = addDays(today, -59);
  const emailDays = series.filter(r => r.day >= start && r.day <= today && (r.sides_present === 'email' || r.sides_present === 'both'));
  if (new Set(emailDays.map(r => r.day)).size < 60) return null;
  const rateOf = rs => { const d = rs.reduce((n, r) => n + r.companies_emailed, 0); return d ? rs.reduce((n, r) => n + r.companies_visited, 0) / d : null; };
  const now = rateOf(series.filter(r => r.day >= cut && r.day <= today)), prior = rateOf(series.filter(r => r.day >= start && r.day < cut));
  if (now == null || prior == null) return null;
  return { now, prior, arrow: now > prior ? '▲' : now < prior ? '▼' : '—' };
}
