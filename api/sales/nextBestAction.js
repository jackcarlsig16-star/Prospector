// sales-hot-prospects-v1 Stage 4b - the ONE place Next Best Action rules
// live (REVISABLE). Rule-based from reply_class + signals, first match wins.
// Jack's list (2026-10-01) plus his approved additions: willing_to_meet ->
// Book meeting, and replies Apollo didn't classify (or none_of_the_above)
// -> Reply today, since Apollo stops the sequence on a reply. Close comes
// first: an unsubscribe outranks any earlier positive reply.
export const NBA_RULES = [
  { id: 'close', label: 'Close', when: s => s.replyClasses.some(c => ['not_interested', 'unsubscribe'].includes(c)), reason: s => `Replied ${s.replyClasses.find(c => ['not_interested', 'unsubscribe'].includes(c)).replace(/_/g, ' ')}` },
  { id: 'book_meeting', label: 'Book meeting', when: s => s.replyClasses.includes('willing_to_meet'), reason: () => 'Replied willing to meet' },
  { id: 'reply_today', label: 'Reply today', when: s => s.replyClasses.includes('follow_up_question'), reason: () => 'Replied with a follow-up question' },
  { id: 'contact_referral', label: 'Contact referral', when: s => s.replyClasses.includes('person_referral'), reason: () => 'Replied with a referral to someone else' },
  { id: 'snooze', label: 'Snooze until return', when: s => s.replyClasses.includes('out_of_office'), reason: () => 'Out-of-office reply (Apollo gives no return date)' },
  { id: 'find_contact', label: 'Find right contact', when: s => s.replyClasses.includes('already_left_company_or_not_right_person'), reason: () => 'Replied: left the company or not the right person' },
  { id: 'reply_today', label: 'Reply today', when: s => s.replied, reason: () => 'Replied (not classified by Apollo)' },
  { id: 'linkedin_touch', label: 'LinkedIn touch', when: s => s.opens >= 3 && !s.possibleBotOpen, reason: s => `Opened ×${s.opens}, no reply` },
  { id: 'let_run', label: 'Let sequence run', when: () => true, reason: () => 'No reply and fewer than 3 real opens' },
];

// messages: this contact's sales_email_messages rows; scored: scoreProspect()'s result.
export function nextBestAction(messages, scored) {
  const replied = messages.filter(m => m.replied);
  const signals = {
    replied: replied.length > 0,
    replyClasses: replied.map(m => m.reply_class || 'none_of_the_above'),
    opens: scored.badges.opens,
    possibleBotOpen: scored.badges.possible_bot_open,
  };
  const rule = NBA_RULES.find(r => r.when(signals));
  return { id: rule.id, label: rule.label, reason: rule.reason(signals) };
}
