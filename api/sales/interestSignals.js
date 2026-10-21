import { isAutomated } from './heatScore.js';

// company-panel-v2 L3 - what a person did with our emails, strongest first:
// reply > click > 2+ human opens (bot opens and scanner clicks excluded the way
// Huddle does it). Pure: the rows come in, nothing is read here. Shared by the
// company panel (Interest band, People pills, Signals & visits) and Tidy's
// interest_follow_up rule, so a "signal" means the same thing in both.
export const INTEREST_DAYS = 14;
export const TIMELINE_DAYS = 30;
const SCANNER_CLICK_WITHIN_SECONDS = 120; // huddleLive's value
export const STRENGTH = { reply: 3, click: 2, opens: 1, visit: 0 };
export const replyAt = m => m.replied_at || m.replied_seen_at || m.delivered_at || null;

// messages: sales_email_messages rows; events: sales_email_activity rows (open |
// click | reply). Returns Map(contact_id -> { strongest, clicks, replies, opens })
// where every item is { id, kind, step, at, message_id } and strongest is
// { kind: 'reply' | 'click' | 'opens', count, step, at, id } or null.
export function personSignals({ messages, events, now = Date.now(), days = INTEREST_DAYS }) {
  const since = new Date(now - days * 864e5).toISOString();
  const by = (rows, key) => { const m = new Map(); for (const r of rows) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); } return m; };
  const msgsBy = by(messages, 'contact_id'), evBy = by(events, 'contact_id');
  const out = new Map();
  for (const contactId of new Set([...msgsBy.keys(), ...evBy.keys()])) {
    const msgs = msgsBy.get(contactId) || [];
    const deliveredById = new Map(msgs.map(m => [m.apollo_message_id, m.delivered_at]));
    const stepById = new Map(msgs.map(m => [m.apollo_message_id, m.step]));
    const item = e => ({ id: e.id, kind: e.event, step: e.step ?? stepById.get(e.apollo_message_id) ?? null, at: e.occurred_at, message_id: e.apollo_message_id });
    const evs = (evBy.get(contactId) || []).filter(e => e.occurred_at >= since);
    const real = evs.filter(e => e.event === 'reply' || !isAutomated(e, deliveredById.get(e.apollo_message_id), SCANNER_CLICK_WITHIN_SECONDS));
    const newest = rows => [...rows].sort((a, b) => b.at.localeCompare(a.at))[0];
    const replies = real.filter(e => e.event === 'reply').map(item);
    // A reply Apollo reported on the message but never as a timed event still counts (no id to key on).
    for (const m of msgs) if (m.replied && !replies.some(r => r.message_id === m.apollo_message_id)) { const at = replyAt(m); if (at && at >= since) replies.push({ id: null, kind: 'reply', step: m.step ?? null, at, message_id: m.apollo_message_id }); }
    const clicks = real.filter(e => e.event === 'click').map(item);
    const opens = real.filter(e => e.event === 'open').map(item);
    let strongest = null;
    if (replies.length) { const r = newest(replies); strongest = { kind: 'reply', count: replies.length, step: r.step, at: r.at, id: r.id }; }
    else if (clicks.length) { const c = newest(clicks); strongest = { kind: 'click', count: clicks.length, step: c.step, at: c.at, id: c.id }; }
    else if (opens.length >= 2) { const o = newest(opens); strongest = { kind: 'opens', count: opens.length, step: o.step, at: o.at, id: o.id }; }
    out.set(contactId, { strongest, replies, clicks, opens });
  }
  return out;
}

// Interest items sort by strength, then newest.
export const byStrength = (a, b) => (STRENGTH[b.kind] - STRENGTH[a.kind]) || (b.at || '').localeCompare(a.at || '');

export const signalVerb = s => (s.kind === 'reply' ? 'replied' : s.kind === 'click' ? 'clicked' : s.kind === 'opens' ? `opened ×${s.count}` : 'visited');
export const signalText = s => `${signalVerb(s)}${s.step != null ? ` Step ${s.step}` : ''}`;
