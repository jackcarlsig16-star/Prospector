import { replyAt, replyExact } from './replyTime.js';
import { laDateString } from './laDate.js';
import { SCANNER_CLICK_WITHIN_SECONDS } from './nextBestAction.js';

// sales-hot-prospects-v1 - the ONE place heat weights live (REVISABLE).
// Starting values from the SPEC, adjusted by Jack's Stage 1 decisions
// (2026-10-01): replies split by reply_class, opens scored from Apollo's
// num_opens, bot opens judged by timing + user agent + tracking service.
export const HEAT = {
  replyPoints: {
    willing_to_meet: 100,
    follow_up_question: 100,
    person_referral: 100,
    none_of_the_above: 100,
    out_of_office: 20,
    already_left_company_or_not_right_person: 20,
  },
  replyPointsUnclassified: 100,
  excludedReplyClasses: ['not_interested', 'unsubscribe'],
  clickPerDay: 40,
  openEach: 5,
  openMax: 15,
  // heat-v2 R1 (planner, 2026-11-09; inbox/2026-11-09-2335-heat-v2-stage0-rulings.txt): ONE fade schedule for every
  // signal family, by the family's newest signal - ×1 through fadeFresh days, ×fadeMid through fadeOld days, then
  // ×fadeFloor. Replies fade too (on replied_at / replied_seen_at, else delivered_at). Recalibrate once
  // sales_person_heat_days holds two weeks of history.
  fadeFresh: 7,
  fadeMid: 0.5,
  fadeOld: 30,
  fadeFloor: 0.25,
  botOpenWithinSeconds: 60,
  botUserAgents: [/generic linux/i],
  // Gmail's image proxy (Apollo labels its agent "Gmail") fetches images only when the recipient opens the message,
  // so a fast open there is a person, not a scanner: the timing rule doesn't apply (FIX people-apollo-visibility-v1 F1).
  humanUserAgents: [/^gmail$/i],
  // heat-size-v1 Stage 0 rulings R1-R3 (planner, 2026-11-09; inbox/2026-11-09-1605-heat-size-v1-stage0-rulings.txt):
  // a company on the site in the last visitDays adds visitBase + visitPerVisitor × min(unique visitors, visitVisitorsMax)
  // (set B: ceiling 23, under hotScore - a visit ranks people inside a band, a base >= warmScore would park every
  // identified visitor at Warm). A person identified <= visitDays ago counts as one visit by one person on their
  // created_at.
  visitBase: 8,
  visitPerVisitor: 3,
  visitVisitorsMax: 5,
  visitDays: 7,
};

// heat-v2 H2: the band is the number's bracket, nothing else (rulings R2).
export const HEAT_BANDS = { hotScore: 40, warmScore: 10 };
export const bandOf = score => (score >= HEAT_BANDS.hotScore ? 'hot' : score >= HEAT_BANDS.warmScore ? 'warm' : 'cold');

// The visit a person's heat reads, from their company's latest web_visits row and (R2) their own identification date.
// -> { kind: 'company' | 'identified', visits, people, at } | null. The company row counts while its pull window reaches
// into the last visitDays (seen_to, the same rule as the People table's "Company visits" column).
export function visitSignal({ visit = null, identifiedAt = null, now = Date.now() } = {}) {
  const since = laDateString(new Date(now - (HEAT.visitDays - 1) * 864e5));
  if (visit && Number(visit.visits_7d) > 0 && String(visit.seen_to || visit.pulled_on || '') >= since) {
    return { kind: 'company', visits: Number(visit.visits_7d), people: Number(visit.unique_visitors_7d ?? 0), at: visit.last_visit || visit.seen_to || visit.pulled_on };
  }
  if (identifiedAt && now - Date.parse(identifiedAt) <= HEAT.visitDays * 864e5) return { kind: 'identified', visits: 1, people: 1, at: identifiedAt };
  return null;
}

export function isBotOpen(ev, deliveredAt) {
  if (ev.tracking_service) return true;
  if (ev.user_agent && HEAT.botUserAgents.some(re => re.test(ev.user_agent))) return true;
  if (!deliveredAt) return false;
  if (ev.user_agent && HEAT.humanUserAgents.some(re => re.test(ev.user_agent))) return false;
  return (new Date(ev.occurred_at) - new Date(deliveredAt)) / 1000 <= HEAT.botOpenWithinSeconds;
}

// One open/click: did a person do it? Opens use isBotOpen; a click is a
// link scanner when it lands within scannerSeconds of delivery, or when the
// delivery time is unknown (it can't be cleared - same as nextBestAction.js).
export function isAutomated(ev, deliveredAt, scannerSeconds = SCANNER_CLICK_WITHIN_SECONDS) {
  if (ev.event === 'open') return isBotOpen(ev, deliveredAt);
  if (ev.event === 'click') return !deliveredAt || (Date.parse(ev.occurred_at) - Date.parse(deliveredAt)) / 1000 <= scannerSeconds;
  return false;
}

const ageDays = (at, now) => (now - Date.parse(at)) / 864e5;
export const fadeAt = age => (age <= HEAT.fadeFresh ? 1 : age <= HEAT.fadeOld ? HEAT.fadeMid : HEAT.fadeFloor);
const newest = xs => { const v = xs.filter(Boolean).sort(); return v.length ? v[v.length - 1] : null; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// One family's line (H3): the base points, then "× fade (age d)" only when the family has faded, then the faded points.
function family(label, base, at, now) {
  if (!base) return null;
  const age = at ? ageDays(at, now) : 0;
  const fade = at ? fadeAt(age) : 1;
  const pts = base * fade;
  const why = fade < 1 ? `${label} · ${base} × ${fade} (${Math.floor(age)} d) +${Math.round(pts)}` : `${label} +${base}`;
  return { base, fade, pts, at, why };
}

// messages: this contact's sales_email_messages rows; events: its sales_email_activity rows; visit: visitSignal()'s
// result (null = no visit). heat-v2 H1-H3: heat = Σ over families (reply · click · open · visit) of points × fade(age of
// the family's newest signal); band = bandOf(heat). Returns everything the card needs to say *why* - the UI never
// computes a score itself. A not_interested / unsubscribe reply forces 0 (the person said no).
export function scoreProspect(messages, events, visit = null, now = Date.now(), scannerSeconds = SCANNER_CLICK_WITHIN_SECONDS) {
  const deliveredById = new Map(messages.map(m => [m.apollo_message_id, m.delivered_at]));
  const stepById = new Map(messages.map(m => [m.apollo_message_id, m.step]));
  const replied = messages.filter(m => m.replied);
  const excludedReplyClass = replied.map(m => m.reply_class).find(c => HEAT.excludedReplyClasses.includes(c)) || null;
  const counted = replied.filter(m => !HEAT.excludedReplyClasses.includes(m.reply_class));

  let replyBase = 0, replyClass = null;
  for (const m of counted) {
    const pts = m.reply_class ? (HEAT.replyPoints[m.reply_class] ?? HEAT.replyPointsUnclassified) : HEAT.replyPointsUnclassified;
    if (pts > replyBase) { replyBase = pts; replyClass = m.reply_class; }
  }
  const replySeenAt = newest(counted.map(replyAt));
  const replyAtUsed = replySeenAt || newest(counted.map(m => m.delivered_at));

  const humanClicks = events.filter(e => e.event === 'click' && !isAutomated(e, deliveredById.get(e.apollo_message_id), scannerSeconds));
  const clickDays = new Set(humanClicks.map(e => laDateString(new Date(e.occurred_at)))).size;
  const clickAt = newest(humanClicks.map(e => e.occurred_at));

  const opens = messages.reduce((n, m) => n + (m.num_opens || 0), 0);
  const openEvents = events.filter(e => e.event === 'open');
  const realOpens = openEvents.filter(e => !isBotOpen(e, deliveredById.get(e.apollo_message_id)));
  const possibleBotOpen = opens > 0 && !replyBase && !humanClicks.length && openEvents.length > 0 && !realOpens.length;
  const openBase = possibleBotOpen ? 0 : Math.min(HEAT.openMax, opens * HEAT.openEach);
  const openAt = newest([...realOpens.map(e => e.occurred_at), ...messages.map(m => m.last_opened_at)]);

  const visitBase = visit ? HEAT.visitBase + HEAT.visitPerVisitor * Math.min(visit.people, HEAT.visitVisitorsMax) : 0;
  const visitLabel = !visit ? null
    : visit.kind === 'company' ? `Company on the site · ${plural(visit.visits, 'visit')} · ${visit.people === 1 ? '1 person' : `${visit.people} people`} (${HEAT.visitDays} d)`
    : `Identified on the site ${Math.max(0, Math.floor(ageDays(visit.at, now)))} d ago`;

  const families = {
    reply: family(`Replied${replyClass ? ` (${replyClass.replace(/_/g, ' ')})` : ''}`, replyBase, replyAtUsed, now),
    click: family(`Clicked on ${plural(clickDays, 'day')}`, clickDays * HEAT.clickPerDay, clickAt, now),
    open: family(`Opened ×${opens}`, openBase, openAt, now),
    visit: family(visitLabel, visitBase, visit?.at || null, now),
  };
  const why = [];
  let score = 0;
  if (excludedReplyClass) why.push('Not interested (reply)');
  else {
    for (const f of Object.values(families)) if (f) { why.push(f.why); score += f.pts; }
    if (possibleBotOpen) why.push('Opens look automated (scanner timing/agent) +0');
  }
  score = Math.round(score);
  const points = Object.fromEntries(Object.entries(families).map(([k, f]) => [k, f && !excludedReplyClass ? Math.round(f.pts) : 0]));

  // The row's "last signal" (kind · step · at · count): the latest reply, else the latest human click or real open.
  let last = null;
  if (replied.length) {
    const m = [...replied].sort((a, b) => (b.step || 0) - (a.step || 0))[0];
    const latestReply = [...replied].filter(replyAt).sort((a, b) => replyAt(a).localeCompare(replyAt(b))).pop() || null;
    last = { kind: 'reply', step: m.step ?? null, reply_class: m.reply_class || null, at: latestReply ? replyAt(latestReply) : null, exact: !!latestReply && replyExact(latestReply) };
  } else {
    const latest = [...humanClicks, ...realOpens].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
    if (latest) {
      const count = latest.event === 'open' ? realOpens.filter(e => e.apollo_message_id === latest.apollo_message_id).length : null;
      last = { kind: latest.event, step: stepById.get(latest.apollo_message_id) ?? null, at: latest.occurred_at, count };
    }
  }

  return {
    score,
    band: bandOf(score),
    why,
    points,
    badges: { replied: replyBase > 0, reply_class: replyClass, click_days: clickDays, opens, possible_bot_open: possibleBotOpen, visit: visit ? { kind: visit.kind, visits: visit.visits, people: visit.people, fade: families.visit.fade } : null },
    last_signal: last,
    last_signal_at: newest([replyAtUsed, clickAt, openAt]),
    last_visit_at: visit ? visit.at : null,
    excluded_reply_class: excludedReplyClass,
  };
}
