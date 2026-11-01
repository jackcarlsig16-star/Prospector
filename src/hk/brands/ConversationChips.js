import React from 'react';
import { Icon } from '../HkMarks';

// grow-mailbox-link-v1 L6 - "Last contact <n> ago · <who>" and "Waiting on us" / "Waiting on them <n> d", from the
// brand's linked Gmail threads. conv: { last_at, who, waiting_on, waiting_days } | null. Every color carries its word.
const ago = (iso, now = Date.now()) => {
  const d = Math.floor((now - Date.parse(iso)) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} d ago`;
};
export const daysWord = n => (n == null ? '' : n <= 0 ? 'today' : `${n} d`);

// The Brand page builds conv from its thread views (newest first): who = "You" for your own mailbox.
export function convOfThreads(threads = []) {
  if (!threads.length) return null;
  // Who is waiting follows the newest thread you may see in full only - an older thread's state is history.
  const newest = threads[0], vis = threads.find(t => t.shared);
  const w = vis && vis.waiting_on && vis.waiting_on !== 'none' ? vis.waiting_on : null;
  return { last_at: newest.last_at, who: newest.own ? 'You' : newest.who || 'A teammate', waiting_on: w, waiting_days: w ? vis.waiting_days ?? null : null };
}

export default function ConversationChips({ conv }) {
  if (!conv?.last_at) return null;
  return (
    <span className="hk-labels" data-hk-conversation>
      <span className="hk-label hk-label--line" data-hk-last-contact><Icon name="mail" size={13} /> <span className="hk-label__k">Last contact</span> {ago(conv.last_at)}{conv.who ? ` · ${conv.who}` : ''}</span>
      {conv.waiting_on === 'us' && <span className="hk-label hk-label--orange" data-hk-waiting="us">Waiting on us{conv.waiting_days ? ` · ${daysWord(conv.waiting_days)}` : ''}</span>}
      {conv.waiting_on === 'them' && <span className="hk-label hk-label--grey" data-hk-waiting="them">Waiting on them{conv.waiting_days ? ` · ${daysWord(conv.waiting_days)}` : ''}</span>}
    </span>
  );
}
