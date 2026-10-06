// sales-hot-prospects-v1 Stage 4b - the ONE place Next Best Action rules
// live (REVISABLE). Rule-based from reply_class + signals, first match wins.
// Jack's list (2026-10-01) plus his approved additions: willing_to_meet ->
// Book meeting, and replies Apollo didn't classify (or none_of_the_above)
// -> Reply today, since Apollo stops the sequence on a reply. Close comes
// first: an unsubscribe outranks any earlier positive reply.

// Clicks this soon after delivery are treated as link scanners, not people
// (observed scanner clicks landed 19-120s after delivery). REVISABLE.
export const SCANNER_CLICK_WITHIN_SECONDS = 120;

export const NBA_RULES = [
  { id: 'close', label: 'Close', when: s => s.replyClasses.some(c => ['not_interested', 'unsubscribe'].includes(c)), reason: s => `Replied ${s.replyClasses.find(c => ['not_interested', 'unsubscribe'].includes(c)).replace(/_/g, ' ')}` },
  { id: 'book_meeting', label: 'Book meeting', when: s => s.replyClasses.includes('willing_to_meet'), reason: () => 'Replied willing to meet' },
  { id: 'reply_today', label: 'Reply today', when: s => s.replyClasses.includes('follow_up_question'), reason: () => 'Replied with a follow-up question' },
  { id: 'contact_referral', label: 'Contact referral', when: s => s.replyClasses.includes('person_referral'), reason: () => 'Replied with a referral to someone else' },
  { id: 'snooze', label: 'Snooze until return', when: s => s.replyClasses.includes('out_of_office'), reason: () => 'Out-of-office reply (Apollo gives no return date)' },
  { id: 'find_contact', label: 'Find right contact', when: s => s.replyClasses.includes('already_left_company_or_not_right_person'), reason: () => 'Replied: left the company or not the right person' },
  { id: 'reply_today', label: 'Reply today', when: s => s.replied, reason: () => 'Replied (not classified by Apollo)' },
  { id: 'follow_up_clicked', label: 'Follow up — clicked', when: s => s.humanClicks > 0, reason: s => `${s.humanClicks} click${s.humanClicks > 1 ? 's' : ''} more than ${SCANNER_CLICK_WITHIN_SECONDS / 60} min after delivery, no reply` },
  { id: 'linkedin_touch', label: 'LinkedIn touch', when: s => s.opens >= 3 && !s.possibleBotOpen, reason: s => `Opened ×${s.opens}, no reply` },
  { id: 'let_run', label: 'Let sequence run', when: () => true, reason: () => 'No reply, no real clicks, fewer than 3 real opens' },
];

// messages / events: this contact's sales_email_messages and
// sales_email_activity rows; scored: scoreProspect()'s result.
export function nextBestAction(messages, events, scored) {
  const replied = messages.filter(m => m.replied);
  const deliveredById = new Map(messages.map(m => [m.apollo_message_id, m.delivered_at]));
  // A click with no known delivery time can't be cleared as human, so it doesn't count.
  const humanClicks = events.filter(e => {
    const delivered = e.event === 'click' && deliveredById.get(e.apollo_message_id);
    return delivered && (new Date(e.occurred_at) - new Date(delivered)) / 1000 > SCANNER_CLICK_WITHIN_SECONDS;
  }).length;
  const signals = {
    replied: replied.length > 0,
    replyClasses: replied.map(m => m.reply_class || 'none_of_the_above'),
    opens: scored.badges.opens,
    possibleBotOpen: scored.badges.possible_bot_open,
    humanClicks,
  };
  const rank = NBA_RULES.findIndex(r => r.when(signals));
  const rule = NBA_RULES[rank];
  // rank = position in NBA_RULES: the Huddle orders "Needs action today" by it.
  return { id: rule.id, label: rule.label, reason: rule.reason(signals), rank };
}
