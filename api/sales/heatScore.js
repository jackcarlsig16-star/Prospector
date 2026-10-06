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
};

export function isBotOpen(ev, deliveredAt) {
  if (ev.tracking_service) return true;
  if (ev.user_agent && HEAT.botUserAgents.some(re => re.test(ev.user_agent))) return true;
  if (!deliveredAt) return false;
  return (new Date(ev.occurred_at) - new Date(deliveredAt)) / 1000 <= HEAT.botOpenWithinSeconds;
}

// messages: this contact's sales_email_messages rows; events: its
// sales_email_activity rows. Returns everything the card needs to say
// *why* it's hot - the UI never computes a score itself.
export function scoreProspect(messages, events) {
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
  if (lastSignalAt && (Date.now() - new Date(lastSignalAt)) / 864e5 > HEAT.decayAfterDays && (clickPts || openPts)) {
    decayed = true;
    why.push(`No new signal in ${HEAT.decayAfterDays}+ days: clicks/opens ×${HEAT.decayFactor}`);
  }
  const score = Math.round(replyPts + (clickPts + openPts) * (decayed ? HEAT.decayFactor : 1));

  return {
    score,
    why,
    badges: { replied: replyPts > 0, reply_class: replyClass, click_days: clickDays, opens, possible_bot_open: possibleBotOpen },
    last_signal_at: lastSignalAt,
    excluded_reply_class: excludedReplyClass,
  };
}

// sales-huddle-v2 REV1 - Hot / Warm / Cold bands and the row's one-line
// "last signal" context. PROPOSED / REVISABLE (spec): Hot = score >= 40 or a
// reply or a human click in 7 days; Warm = score >= 10 or a real open in 7
// days; else Cold. Replies have no timestamp (Apollo), so any reply counts.
// A click is human when it lands more than scannerSeconds after delivery
// (same rule as nextBestAction.js).
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

  const band = scored.score >= HEAT_BANDS.hotScore || replied.length || humanClicks.some(recent) ? 'hot'
    : scored.score >= HEAT_BANDS.warmScore || realOpens.some(recent) ? 'warm' : 'cold';

  let last = null;
  if (replied.length) {
    const m = [...replied].sort((a, b) => (b.step || 0) - (a.step || 0))[0];
    last = { kind: 'reply', step: m.step ?? null, reply_class: m.reply_class || null, at: null };
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
