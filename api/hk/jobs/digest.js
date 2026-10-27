// hkos-daily-check-v1 J4 - one digest payload, two renderings. buildDigest() turns the morning's rows into sections in
// the design's order (urgent, replies waiting, drafts to review, follow-ups with no draft, DM text ready, data warnings,
// stats stale, "done yesterday"); renderSlack() turns the payload into one Block Kit message. Pure. Names, domains, labels
// and summaries only: every entry is built from allow-listed fields and the whole payload must pass hasPii before it is
// stored or posted - a failure throws here so the runner counts it and never sends.
import { hasPii } from '../../sales/scrubText.js';
import { dayIn, statsStale } from './plan.js';

const DAY = 86400e3;
const SECTION_TITLES = { urgent: 'Urgent', replies: 'Replies waiting', drafts: 'Drafts to review', no_draft: 'Follow-ups with no draft', dm_ready: 'DM text ready' };
const REASON_TEXT = { lint: 'the draft failed the outreach rules', no_contact: 'no contact with an email yet', reconnect: 'reconnect Gmail to draft it', no_thread: 'no earlier sent email on this brand', gmail: 'Gmail did not accept the draft', no_mailbox: 'link a HumanKind Gmail on Connections first' };
const KIND_WORD = { cold: 'cold pitch', bump: 'bump', final: 'final nudge', dm_text: 'DM', reply: 'reply' };
const LABEL_WORD = { interested: 'interested', pricing: 'asked about pricing', referral: 'referral', decline: 'declined', auto_reply: 'auto-reply', prefers_email: 'prefers email', new_thread: 'new thread', other: 'replied' };

const ageDays = (iso, now) => Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY));
const yesterdayOf = (now, tz) => dayIn(new Date(now.getTime() - DAY), tz);

// { replies, touches, brands, members, noDraft, dmReady, warningsCount, settings, events, now }
//   replies: hk_replies rows (handled, urgent, snoozed_until, label, summary, brand_id, received_at) - from_email is ignored
//   touches: hk_touches rows (state drafted = waiting in Gmail; subject, kind, drafted_at, sender_user_id, brand_id)
//   noDraft: [{ brand_id, kind, reason, detail? }] from the runner (J1c failures); dmReady: [{ brand_id, touch_id }]
//   events:  hk_events rows (action, detail, created_at) for the footer
export function buildDigest({ replies = [], touches = [], brands = [], members = [], noDraft = [], dmReady = [], warningsCount = 0, settings = {}, events = [], now = new Date(), test = false } = {}) {
  const tz = settings.timezone || 'America/Chicago';
  const brandBy = Object.fromEntries(brands.map(b => [b.id, b]));
  const first = id => members.find(m => m.user_id === id)?.first_name || null;
  const brandOf = id => ({ brand_id: id, brand_name: brandBy[id]?.name || 'Unknown brand', domain: brandBy[id]?.domain || null, owner: first(brandBy[id]?.owner_user_id) });
  const open = replies.filter(r => !r.handled && !(r.snoozed_until && String(r.snoozed_until) > now.toISOString()));
  const urgent = open.filter(r => r.urgent).map(r => ({ ...brandOf(r.brand_id), reply_id: r.id, label: r.label || 'other', label_text: LABEL_WORD[r.label] || LABEL_WORD.other, summary: r.summary || null, received_at: r.received_at, pricing: r.label === 'pricing' }));
  const waiting = open.filter(r => !r.urgent).map(r => ({ ...brandOf(r.brand_id), reply_id: r.id, label: r.label || 'other', label_text: LABEL_WORD[r.label] || LABEL_WORD.other, summary: r.summary || null, received_at: r.received_at }));
  const drafts = touches.filter(t => t.state === 'drafted' && t.channel === 'email').map(t => ({ ...brandOf(t.brand_id), touch_id: t.id, kind: t.kind, kind_text: KIND_WORD[t.kind] || t.kind, subject: t.subject || null, created_by: t.created_by, sender: first(t.sender_user_id), age_days: ageDays(t.drafted_at || t.created_at, now) }));
  const no_draft = noDraft.map(x => ({ ...brandOf(x.brand_id), kind: x.kind, kind_text: KIND_WORD[x.kind] || x.kind, reason: x.reason, reason_text: REASON_TEXT[x.reason] || x.reason, detail: x.detail ? String(x.detail).slice(0, 120) : null }));
  const dm_ready = dmReady.map(x => ({ ...brandOf(x.brand_id), touch_id: x.touch_id || null }));
  const sortBy = (arr, k, desc = true) => [...arr].sort((a, b) => String(desc ? b[k] : a[k]).localeCompare(String(desc ? a[k] : b[k])));
  const yday = yesterdayOf(now, tz);
  const on = iso => iso && dayIn(new Date(iso), tz) === yday;
  const done = { sent: events.filter(e => e.action === 'touch_sent' && on(e.created_at)).length, replies_handled: events.filter(e => e.action === 'reply_handled' && on(e.created_at)).length, meetings: brands.filter(b => b.status === 'meeting' && on(b.updated_at)).length };
  const payload = {
    day: dayIn(now, tz), built_at: now.toISOString(), test,
    sections: { urgent: sortBy(urgent, 'received_at'), replies: sortBy(waiting, 'received_at'), drafts: sortBy(drafts, 'age_days'), no_draft, dm_ready },
    data_warnings: Number(warningsCount) || 0,
    stats_stale: statsStale(settings, now),
    done_yesterday: done,
    counts: { urgent: urgent.length, replies: waiting.length, drafts: drafts.length, no_draft: no_draft.length, dm_ready: dm_ready.length, data_warnings: Number(warningsCount) || 0 },
  };
  payload.empty = Object.values(payload.counts).every(n => n === 0) && !payload.stats_stale;
  if (hasPii(JSON.stringify(payload))) throw new Error('digest payload would carry an address or phone number');
  return payload;
}

const who = e => (e.owner ? ` (${e.owner})` : '');
const line = (section, e) => {
  switch (section) {
    case 'urgent': return `• *${e.brand_name}*${who(e)} - ${e.label_text}${e.summary ? `: ${e.summary}` : ''}${e.pricing ? ' - do not quote pricing in the reply' : ''}`;
    case 'replies': return `• *${e.brand_name}*${who(e)} - ${e.label_text}${e.summary ? `: ${e.summary}` : ''}`;
    case 'drafts': return `• *${e.brand_name}*${who(e)} - ${e.kind_text} waiting in Gmail${e.age_days ? `, ${e.age_days} d` : ''}`;
    case 'no_draft': return `• *${e.brand_name}*${who(e)} - ${e.kind_text} due, ${e.reason_text}`;
    case 'dm_ready': return `• *${e.brand_name}*${who(e)} - DM text ready to copy`;
    default: return `• ${e.brand_name}`;
  }
};
const SLACK_MAX_LINES = 15;

// payload -> { text, blocks } (Block Kit). Throws on PII so the runner never posts it.
export function renderSlack(payload) {
  const blocks = [{ type: 'header', text: { type: 'plain_text', text: `HumanKind morning check${payload.test ? ' (TEST)' : ''} - ${payload.day}`, emoji: false } }];
  const textLines = [];
  for (const [key, title] of Object.entries(SECTION_TITLES)) {
    const rows = payload.sections[key] || [];
    if (!rows.length) continue;
    const shown = rows.slice(0, SLACK_MAX_LINES).map(e => line(key, e));
    if (rows.length > SLACK_MAX_LINES) shown.push(`• and ${rows.length - SLACK_MAX_LINES} more`);
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${title} (${rows.length})*\n${shown.join('\n')}` } });
    textLines.push(`${title}: ${rows.length}`);
  }
  const extras = [];
  if (payload.data_warnings) extras.push(`Data warnings: ${payload.data_warnings} (Review)`);
  if (payload.stats_stale) extras.push('Stats need a fresh confirmation (Settings > Pitch)');
  if (extras.length) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: extras.join('\n') } });
  if (payload.empty) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: 'Nothing needs you right now.' } });
  const d = payload.done_yesterday || { sent: 0, replies_handled: 0, meetings: 0 };
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Done yesterday: ${d.sent} sent · ${d.replies_handled} replies handled · ${d.meetings} meetings` }] });
  const out = { text: `HumanKind morning check - ${payload.day}: ${textLines.join(', ') || 'nothing needs you'}`, blocks };
  if (hasPii(JSON.stringify(out))) throw new Error('Slack digest would carry an address or phone number');
  return out;
}
