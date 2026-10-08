import { WORKFLOW_STEPS, TOUCH_STATUSES, stepOf, isTouched } from '../../../../constants/partnerPipeline';
import { todoStatus } from '../TodoList';

// partner-360-v1 - one timeline for a partner (pure, unit-tested): its
// events, plus the to-dos linked to it, with the noise marked so the
// drop-down can hide it behind "Show all activity (n)".

export const stageName = s => (s === 'paused' ? 'Paused' : s ? WORKFLOW_STEPS[stepOf(s)].label : '—');
export const TOUCH_VERB = { email: 'Emailed', call: 'Called', linkedin: 'LinkedIn message to', meeting: 'Met with', event: 'Event with', other: 'Touched base with' };
// For "Last touch: Call · Oct 2" and People's "Called Oct 2".
export const TOUCH_NOUN = { email: 'Email', call: 'Call', linkedin: 'LinkedIn', meeting: 'Meeting', event: 'Event', other: 'Touch' };
export const ACTIVITY_PAST = { email: 'Emailed', call: 'Called', linkedin: 'LinkedIn', meeting: 'Met', event: 'Event', other: 'Touched', sent: 'Sent', open: 'Opened', click: 'Clicked', reply: 'Replied', bounce: 'Bounced', unsub: 'Unsubscribed' };
export const SOURCE_LABEL = { apollo: 'from Apollo', outlook: 'from Outlook' };

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'email', label: 'Emails' },
  { id: 'meeting', label: 'Calls & meetings' },
  { id: 'note', label: 'Notes & tasks' },
];

const EMAIL_STAGES = ['first_email_sent', 'in_sequence', 'replied'];

export function eventText(e, lookup) {
  switch (e.event) {
    case 'status': return `${stageName(e.from_status)} → ${stageName(e.to_status)}`;
    case 'deprioritize': return `Paused (from ${stageName(e.from_status)})`;
    case 'assign': return `Assigned to ${e.meta?.to_owner ? lookup(e.meta.to_owner).first : 'nobody'}`;
    case 'hot': return e.meta?.hot ? 'Marked hot' : 'No longer hot';
    case 'snooze': return `Snoozed until ${e.meta?.until || '—'}`;
    case 'note': return `Note: ${e.note}`;
    case 'undo': return `Undid the ${e.meta?.undid_event || 'last'} change`;
    case 'touch': {
      const who = (e.contact_names || []).length ? ` ${e.contact_names.join(', ')}` : (e.touch_type === 'email' || e.touch_type === 'call' ? ' the partner' : '');
      return `${TOUCH_VERB[e.touch_type] || 'Touched'}${who}${e.to_status ? ` → ${stageName(e.to_status)}` : ''}`;
    }
    default: return e.event;
  }
}

function kindOf(e) {
  if (e.event === 'touch') return e.touch_type === 'email' ? 'email' : 'meeting';
  if (e.event === 'status') return EMAIL_STAGES.includes(e.to_status) ? 'email' : e.to_status === 'meeting_set' ? 'meeting' : 'stage';
  if (e.event === 'note') return 'note';
  return 'other';
}

// Noise: undo rows and what they undid; a hot-on later switched off (both
// rows). Everything else is the story.
export function buildTimeline({ events = [], tasks = [], lookup }) {
  const undone = new Set(events.filter(e => e.event === 'undo').map(e => e.meta?.undid).filter(Boolean));
  const noise = new Set([...undone, ...events.filter(e => e.event === 'undo').map(e => e.id)]);
  let openHot = null;
  for (const e of [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (e.event !== 'hot' || undone.has(e.id)) continue;
    if (e.meta?.hot) openHot = e;
    else if (openHot) { noise.add(openHot.id); noise.add(e.id); openHot = null; }
  }
  const items = events.map(e => ({
    id: e.id, at: e.at, kind: kindOf(e), text: eventText(e, lookup), sub: e.event === 'touch' ? e.note : null,
    by: e.by_user ? lookup(e.by_user).first : 'automatic', source: SOURCE_LABEL[e.source] || null,
    noise: noise.has(e.id), undone: undone.has(e.id),
  }));
  for (const t of tasks) {
    items.push({
      id: `task:${t.id}`, at: t.created_at || `${t.week_start}T12:00:00Z`, kind: 'note', text: `Task: ${t.text}`, sub: null,
      by: lookup(t.created_by || t.owner_user_id).first, source: null, noise: false, undone: false, done: todoStatus(t) === 'done',
    });
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || String(b.id).localeCompare(String(a.id)));
}

export const inFilter = (item, filter) => filter === 'all' || item.kind === filter;

// The latest real contact: a logged touch, or a stage move into a contact
// stage. last_touch_at is the fallback for partners with no history.
export function lastTouch(partner, events = [], lookup) {
  const undone = new Set(events.filter(e => e.event === 'undo').map(e => e.meta?.undid).filter(Boolean));
  const hit = events
    .filter(e => !undone.has(e.id) && e.event !== 'undo' && (e.event === 'touch' || (e.event === 'status' && TOUCH_STATUSES.includes(e.to_status))))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (hit) {
    return { at: hit.at, by: hit.by_user ? lookup(hit.by_user).first : null, source: SOURCE_LABEL[hit.source] || null,
      what: hit.event === 'touch' ? TOUCH_NOUN[hit.touch_type] : stageName(hit.to_status) };
  }
  if (partner.last_touch_at) return { at: partner.last_touch_at, by: null, what: null, source: null };
  return isTouched(partner) ? { at: null, undated: true } : null;
}
