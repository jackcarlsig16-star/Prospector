import { replyAt, replyExact } from './replyTime.js';
import { laDateString } from './laDate.js';

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
  // Applied once to click/open points when the newest timed signal is older
  // than this. Reply points never decay - Apollo gives no reply timestamp.
  decayAfterDays: 3,
  decayFactor: 0.5,
  botOpenWithinSeconds: 60,
  botUserAgents: [/generic linux/i],
  // Gmail's image proxy (Apollo labels its agent "Gmail") fetches images only when the recipient opens the message,
  // so a fast open there is a person, not a scanner: the timing rule doesn't apply (FIX people-apollo-visibility-v1 F1).
  humanUserAgents: [/^gmail$/i],
  // heat-size-v1 Stage 0 rulings R1-R3 (planner, 2026-11-09; inbox/2026-11-09-1605-heat-size-v1-stage0-rulings.txt):
  // a company on the site in the last visitDays adds visitBase + visitPerVisitor × min(unique visitors, visitVisitorsMax)
  // (set B: ceiling 23, under hotScore - a visit ranks people inside a band, a base >= warmScore would park every
  // identified visitor at Warm). A person identified <= visitDays ago counts as one visit by one person on their
  // created_at. Visit points decay on their own clock (last_visit / created_at) and never un-decay clicks or opens.
  visitBase: 8,
  visitPerVisitor: 3,
  visitVisitorsMax: 5,
  visitDays: 7,
};

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

// messages: this contact's sales_email_messages rows; events: its
// sales_email_activity rows; visit: visitSignal()'s result (null = no visit,
// the Huddle-era score to the digit). Returns everything the card needs to
// say *why* it's hot - the UI never computes a score itself.
export function scoreProspect(messages, events, visit = null, now = Date.now()) {
  const deliveredById = new Map(messages.map(m => [m.apollo_message_id, m.delivered_at]));
  const why = [];
  let replyPts = 0;
  let replyClass = null;
  let excludedReplyClass = null;

  for (const m of messages.filter(x => x.replied)) {
    if (HEAT.excludedReplyClasses.includes(m.reply_class)) { excludedReplyClass = m.reply_class; continue; }
    const pts = m.reply_class ? (HEAT.replyPoints[m.reply_class] ?? HEAT.replyPointsUnclassified) : HEAT.replyPointsUnclassified;
    if (pts > replyPts) { replyPts = pts; replyClass = m.reply_class; }
  }
  if (replyPts) why.push(`Replied${replyClass ? ` (${replyClass.replace(/_/g, ' ')})` : ''} +${replyPts}`);

  const clicks = events.filter(e => e.event === 'click');
  const clickDays = new Set(clicks.map(e => laDateString(new Date(e.occurred_at)))).size;
  const clickPts = clickDays * HEAT.clickPerDay;
  if (clickPts) why.push(`Clicked on ${clickDays} day${clickDays > 1 ? 's' : ''} +${clickPts}`);

  const opens = messages.reduce((n, m) => n + (m.num_opens || 0), 0);
  const openEvents = events.filter(e => e.event === 'open');
  const possibleBotOpen = opens > 0 && !replyPts && !clicks.length
    && openEvents.length > 0 && openEvents.every(e => isBotOpen(e, deliveredById.get(e.apollo_message_id)));
  const openPts = possibleBotOpen ? 0 : Math.min(HEAT.openMax, opens * HEAT.openEach);
  if (openPts) why.push(`Opened ×${opens} +${openPts}`);
  if (possibleBotOpen) why.push('Opens look automated (scanner timing/agent) +0');

  const timed = [
    ...events.map(e => e.occurred_at),
    ...messages.flatMap(m => [m.last_opened_at, m.last_clicked_at]),
  ].filter(Boolean).sort();
  const lastSignalAt = timed.length ? timed[timed.length - 1] : null;

  let decayed = false;
  if (lastSignalAt && (now - new Date(lastSignalAt)) / 864e5 > HEAT.decayAfterDays && (clickPts || openPts)) {
    decayed = true;
    why.push(`No new signal in ${HEAT.decayAfterDays}+ days: clicks/opens ×${HEAT.decayFactor}`);
  }

  const visitPtsRaw = visit ? HEAT.visitBase + HEAT.visitPerVisitor * Math.min(visit.people, HEAT.visitVisitorsMax) : 0;
  const visitDecayed = !!visit && (now - Date.parse(visit.at)) / 864e5 > HEAT.decayAfterDays;
  if (visit) {
    why.push(visit.kind === 'company'
      ? `Company on the site · ${visit.visits} visit${visit.visits === 1 ? '' : 's'} · ${visit.people} ${visit.people === 1 ? 'person' : 'people'} (${HEAT.visitDays} d) +${visitPtsRaw}`
      : `Identified on the site ${Math.max(0, Math.floor((now - Date.parse(visit.at)) / 864e5))} d ago +${visitPtsRaw}`);
    if (visitDecayed) why.push(`No new visit in ${HEAT.decayAfterDays}+ days: visit ×${HEAT.decayFactor}`);
  }
  const score = Math.round(replyPts + (clickPts + openPts) * (decayed ? HEAT.decayFactor : 1) + visitPtsRaw * (visitDecayed ? HEAT.decayFactor : 1));

  return {
    score,
    why,
    badges: { replied: replyPts > 0, reply_class: replyClass, click_days: clickDays, opens, possible_bot_open: possibleBotOpen, visit: visit ? { kind: visit.kind, visits: visit.visits, people: visit.people, decayed: visitDecayed } : null },
    last_signal_at: lastSignalAt,
    last_visit_at: visit ? visit.at : null,
    excluded_reply_class: excludedReplyClass,
  };
}

// sales-huddle-v2 REV1 - Hot / Warm / Cold bands and the row's one-line
// "last signal" context. PROPOSED / REVISABLE (spec): Hot = score >= 40 or a
// human click in 7 days; Warm = score >= 10 or a real open in 7 days; else
// Cold. Replies (Jack, Stage 2): Hot for 7 days from replied_seen_at (when
// the sync first saw the reply - Apollo gives no reply time), then Warm
// unless a recent human click keeps them Hot. A reply with no seen time
// (rows from before that column existed) stays Hot.
// A click is human when it lands more than scannerSeconds after delivery
// (same rule as nextBestAction.js).
// heat-size-v1 H2 (rulings R2): a company visit (scored.badges.visit) is Hot only when the person also has an email
// sent, or is the identified visitor; a contact whose employer merely browsed is Warm at most.
export const HEAT_BANDS = { hotScore: 40, warmScore: 10, recentDays: 7 };

export function huddleSignals(messages, events, scored, now = Date.now(), scannerSeconds = 120) {
  const deliveredById = new Map(messages.map(m => [m.apollo_message_id, m.delivered_at]));
  const stepById = new Map(messages.map(m => [m.apollo_message_id, m.step]));
  const recent = e => now - Date.parse(e.occurred_at) <= HEAT_BANDS.recentDays * 864e5;
  const humanClicks = events.filter(e => {
    const d = e.event === 'click' && deliveredById.get(e.apollo_message_id);
    return d && (Date.parse(e.occurred_at) - Date.parse(d)) / 1000 > scannerSeconds;
  });
  const realOpens = events.filter(e => e.event === 'open' && !isBotOpen(e, deliveredById.get(e.apollo_message_id)));
  const replied = messages.filter(m => m.replied);

  const latestReply = [...replied].filter(replyAt).sort((a, b) => replyAt(a).localeCompare(replyAt(b))).pop() || null;
  const replySeenAt = latestReply ? replyAt(latestReply) : null;
  const replyHot = replied.length > 0 && (!replySeenAt || now - Date.parse(replySeenAt) <= HEAT_BANDS.recentDays * 864e5);
  const visit = scored.badges?.visit || null;
  const sent = messages.some(m => m.delivered_at);
  const visitHot = !!visit && (sent || visit.kind === 'identified');
  const browseOnly = !!visit && !sent && visit.kind !== 'identified';
  let band = replied.length
    ? (replyHot || humanClicks.some(recent) ? 'hot' : 'warm')
    : scored.score >= HEAT_BANDS.hotScore || humanClicks.some(recent) || visitHot ? 'hot'
    : scored.score >= HEAT_BANDS.warmScore || realOpens.some(recent) ? 'warm' : 'cold';
  if (browseOnly && band === 'hot') band = 'warm';

  let last = null;
  if (replied.length) {
    const m = [...replied].sort((a, b) => (b.step || 0) - (a.step || 0))[0];
    last = { kind: 'reply', step: m.step ?? null, reply_class: m.reply_class || null, at: replySeenAt, exact: !!latestReply && replyExact(latestReply) };
  } else {
    const latest = [...humanClicks, ...realOpens].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
    if (latest) {
      const step = stepById.get(latest.apollo_message_id) ?? null;
      const count = latest.event === 'open' ? realOpens.filter(e => e.apollo_message_id === latest.apollo_message_id).length : null;
      last = { kind: latest.event, step, at: latest.occurred_at, count };
    }
  }
  return { heat_band: band, last_human_signal: last, bot_opens: events.filter(e => e.event === 'open').length - realOpens.length };
}

// One open/click: did a person do it? Opens use isBotOpen; a click is a
// link scanner when it lands within scannerSeconds of delivery, or when the
// delivery time is unknown (it can't be cleared - same as nextBestAction.js).
export function isAutomated(ev, deliveredAt, scannerSeconds = 120) {
  if (ev.event === 'open') return isBotOpen(ev, deliveredAt);
  if (ev.event === 'click') return !deliveredAt || (Date.parse(ev.occurred_at) - Date.parse(deliveredAt)) / 1000 <= scannerSeconds;
  return false;
}
