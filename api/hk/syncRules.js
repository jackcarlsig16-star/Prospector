// hkos-gmail-connect-v1 (G5.3) - the pure classifier a sync runs over Gmail metadata. Input is metadata only (ids,
// labels, From / Date / Message-ID headers already parsed, a snippet); output says which touches were sent, which
// messages are replies, which untracked threads belong to a tracked brand, and how many were ignored. Nothing here
// stores anything, and an ignored message leaves no trace (G5.3d).
//   touches:  [{ id, brand_id, kind, gmail_thread_id, gmail_message_id (the draft's rfc822 Message-ID or null), gmail_draft_id, state }]
//   replies:  [{ gmail_message_id }] already stored
//   messages: [{ id, threadId, labelIds, messageIdHeader, from: { name, email, domain }, date, snippet }]
//   drafts:   [{ id }] the mailbox's current drafts (users.drafts.list)
//   brandsByDomain: { [domain]: brand_id }   ownDomains: ['humankindcollective.app', ...the mailbox's own domain]
const DAY = 86400e3;
export const NEW_THREAD_SCAN_MAX = 200;

export function nextDueAt(kind, sentAtIso, settings = {}) {
  const bump = settings.bump_after_days ?? 5, fin = settings.final_after_days ?? 14;
  const t = Date.parse(sentAtIso);
  if (kind === 'cold') return new Date(t + bump * DAY).toISOString();
  if (kind === 'bump') return new Date(t + Math.max(1, fin - bump) * DAY).toISOString();
  return null;
}
export const statusAfterSend = kind => ({ cold: 'sent', bump: 'bumped', final: 'final_sent', reply: null, dm_text: null, outside: null }[kind] ?? null);

export function classify({ touches = [], replies = [], messages = [], drafts = [], brandsByDomain = {}, ownDomains = [], historyEvents = null }) {
  const own = new Set(ownDomains.map(d => String(d).toLowerCase()));
  const draftIds = new Set(drafts.map(d => d.id));
  const known = new Set(replies.map(r => r.gmail_message_id).filter(Boolean));
  const byThread = {};
  for (const t of touches) if (t.gmail_thread_id && t.state !== 'discarded') (byThread[t.gmail_thread_id] ||= []).push(t);
  const seen = new Set();
  const out = { sent: [], replies: [], newThreads: [], ignored: 0, skippedNewThreadScan: false, historyEvents: historyEvents ?? messages.length };
  const scanNew = (historyEvents ?? messages.length) <= NEW_THREAD_SCAN_MAX;
  if (!scanNew) out.skippedNewThreadScan = true;
  for (const m of messages) {
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    const labels = m.labelIds || [];
    const inSent = labels.includes('SENT'), inInbox = labels.includes('INBOX');
    const tracked = byThread[m.threadId] || [];
    const fromDomain = (m.from?.domain || '').toLowerCase();
    if (tracked.length) {
      if (inSent) {
        // a: the draft left the Drafts folder as a real message - it must not be the draft's own id and the draft must be gone
        const touch = tracked.find(t => t.state === 'drafted' && t.gmail_message_id !== m.messageIdHeader && !(t.gmail_draft_id && draftIds.has(t.gmail_draft_id)))
          || tracked.find(t => t.state === 'drafted' && !t.gmail_message_id && !(t.gmail_draft_id && draftIds.has(t.gmail_draft_id)));
        if (touch && !out.sent.some(s => s.touch.id === touch.id)) { out.sent.push({ touch, message: m, sent_at: m.date, status: statusAfterSend(touch.kind) }); continue; }
        out.ignored++; continue;
      }
      if (fromDomain && !own.has(fromDomain) && !known.has(m.id)) {
        // b: a reply on a tracked thread
        const touch = tracked.find(t => t.state === 'sent') || tracked[0];
        out.replies.push({ touch, brand_id: touch.brand_id, message: m });
        known.add(m.id);
        continue;
      }
      out.ignored++; continue;
    }
    // c: a new thread from a tracked brand's domain, only on a small delta
    if (scanNew && inInbox && !inSent && fromDomain && !own.has(fromDomain) && brandsByDomain[fromDomain] && !known.has(m.id)) {
      out.newThreads.push({ brand_id: brandsByDomain[fromDomain], message: m });
      known.add(m.id);
      continue;
    }
    out.ignored++; // d
  }
  return out;
}

// Counts for hk_sync_runs - numbers only, never addresses.
export const counts = (c, extra = {}) => ({ history_events: c.historyEvents ?? 0, sent_detected: c.sent.length, replies: c.replies.length, new_threads: c.newThreads.length, skipped: c.ignored + (c.skippedNewThreadScan ? 1 : 0), labels_called: 0, ...extra });
