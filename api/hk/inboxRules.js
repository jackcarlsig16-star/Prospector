// hkos-inbox-v1 (I1) - the read-time matcher and the Gmail -> screen shapes for the caller's own inbox. Pure: no
// DB, no network. Nothing here keeps an address: a sender is a display name plus a domain, recipients are names (or
// "you"), and the only body fields that pass through untouched are a message's own text and html, which go to the
// mailbox owner alone. Bulk-sender and role-word heuristics are REVISABLE.
import { header, parseAddress } from './gmailMime.js';
import { cleanText } from '../sales/scrubText.js';

export const SNIPPET_MAX = 140;
export const CHIP_KINDS = ['tracked', 'matches', 'untracked', 'team', 'not_tracked'];
export const BULK_LOCAL_PARTS = /^(?:no-?reply|do-?not-?reply|notifications?|newsletters?)(?:[-+._].*)?$/i;
const ROLE_WORDS = ['co-founder', 'founder', 'ceo', 'owner', 'marketing', 'partnerships', 'team', 'support', 'sales', 'press', 'events', 'community', 'brand', 'studio', 'hello', 'info'];

const lastOf = arr => (arr && arr.length ? arr[arr.length - 1] : null);
const dateOf = msg => { const d = header(msg, 'Date'); const t = d ? Date.parse(d) : NaN; return !Number.isNaN(t) ? new Date(t).toISOString() : msg?.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null; };

// From: "Jane at Rumpl" <jane@rumpl.com> -> { name: 'Jane at Rumpl', domain: 'rumpl.com', local: 'jane' }. With no
// display name the domain stands in for the name; the local part is kept only for the bulk check and never returned.
export function senderOf(fromHeader) {
  const a = parseAddress(fromHeader);
  const local = a.email ? a.email.slice(0, a.email.lastIndexOf('@')) : null;
  return { name: cleanText(a.name || a.domain || 'Unknown', 120), domain: a.domain, local, email: a.email };
}

export function fromHint(name, domain) {
  const words = String(name || '').toLowerCase();
  const role = ROLE_WORDS.find(w => new RegExp(`(?:^|[^a-z])${w.replace('-', '\\-')}(?:$|[^a-z])`).test(words));
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : domain || null;
}

// A To/Cc header can hold several addresses; each becomes a display name, "you" for the mailbox owner, or the domain.
export function splitAddresses(value) {
  const out = []; let cur = '', q = false, lt = 0;
  for (const ch of String(value || '')) {
    if (ch === '"') q = !q;
    else if (!q && ch === '<') lt++;
    else if (!q && ch === '>') lt = Math.max(0, lt - 1);
    if (ch === ',' && !q && lt === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}
export const recipientNames = (value, ownerEmail) => splitAddresses(value).map(parseAddress).map(a => (ownerEmail && a.email === String(ownerEmail).toLowerCase() ? 'you' : cleanText(a.name || a.domain || 'Unknown', 120)));

export const isBulk = (local, listUnsubscribe) => !!listUnsubscribe || (!!local && BULK_LOCAL_PARTS.test(local));

// One chip per thread: tracked (a touch or logged reply lives on this thread) > matches (sender domain is a live
// brand's) > team (our own domains, or the mailbox owner) > not_tracked (the caller ignored the domain, or a bulk
// sender) > untracked.
export function chipFor({ threadId, sender, listUnsubscribe = null, tracked, brandsByDomain, teamDomains, ownerEmail = null, ignored }) {
  const t = tracked.get(threadId);
  if (t) return { kind: 'tracked', brand_id: t.brand_id, brand_name: t.brand_name || null, status: t.status || null, label: t.label || null };
  const b = sender.domain ? brandsByDomain[sender.domain] : null;
  if (b) return { kind: 'matches', brand_id: b.id, brand_name: b.name, status: b.status || null };
  if ((sender.domain && teamDomains.includes(sender.domain)) || (ownerEmail && sender.email === String(ownerEmail).toLowerCase())) return { kind: 'team' };
  if (sender.domain && ignored.has(sender.domain)) return { kind: 'not_tracked', reason: 'ignored' };
  if (isBulk(sender.local, listUnsubscribe)) return { kind: 'not_tracked', reason: 'bulk' };
  return { kind: 'untracked' };
}

// A threads.get (metadata) resource -> one list row. The newest message gives sender, date and snippet; the subject
// comes from the first message so "Re:" chains read as one.
export function threadRow(thread, ctx) {
  const msgs = thread?.messages || [];
  const latest = lastOf(msgs) || {};
  const sender = senderOf(header(latest, 'From'));
  return {
    thread_id: thread.id,
    unread: msgs.some(m => (m.labelIds || []).includes('UNREAD')),
    from_name: sender.name,
    from_domain: sender.domain,
    from_hint: fromHint(sender.name, sender.domain),
    date: dateOf(latest),
    subject: cleanText(header(msgs[0] || latest, 'Subject') || '(no subject)', 200),
    snippet: cleanText(latest.snippet || '', SNIPPET_MAX),
    message_count: msgs.length,
    has_attachments: msgs.some(m => /^multipart\/mixed/i.test(m.payload?.mimeType || '')),
    chip: chipFor({ threadId: thread.id, sender, listUnsubscribe: header(latest, 'List-Unsubscribe'), ...ctx }),
  };
}

// Walk a full-format payload: the first text/plain and text/html bodies (base64url), plus named parts as attachments.
const decodeBody = data => (data ? Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '');
export function partsOf(payload) {
  const out = { text: null, html: null, attachments: [] };
  const walk = p => {
    if (!p) return;
    const mime = (p.mimeType || '').toLowerCase();
    if (p.filename) out.attachments.push({ name: cleanText(p.filename, 160), size: Number(p.body?.size) || 0 });
    else if (mime === 'text/plain' && out.text == null && p.body?.data) out.text = decodeBody(p.body.data);
    else if (mime === 'text/html' && out.html == null && p.body?.data) out.html = decodeBody(p.body.data);
    for (const c of p.parts || []) walk(c);
  };
  walk(payload);
  return out;
}

// One message in the reading pane. html is the raw part - the browser sanitizes it before it is rendered - and it is
// only ever read from the caller's own mailbox with the caller's own token.
export function messageView(msg, { ownerEmail = null } = {}) {
  const sender = senderOf(header(msg, 'From'));
  const parts = partsOf(msg.payload);
  return {
    id: msg.id,
    from_name: sender.name,
    from_domain: sender.domain,
    is_mine: !!ownerEmail && sender.email === String(ownerEmail).toLowerCase(),
    to_names: recipientNames(header(msg, 'To'), ownerEmail),
    cc_names: recipientNames(header(msg, 'Cc'), ownerEmail),
    date: dateOf(msg),
    subject: cleanText(header(msg, 'Subject') || '', 200),
    unread: (msg.labelIds || []).includes('UNREAD'),
    text: parts.text,
    html: parts.html,
    attachments: parts.attachments,
  };
}

// The latest message not sent by the mailbox owner - what a link records as the reply.
export function latestInbound(thread, ownerEmail) {
  const msgs = [...(thread?.messages || [])].reverse();
  return msgs.find(m => { const s = senderOf(header(m, 'From')); return !(ownerEmail && s.email === String(ownerEmail).toLowerCase()) && !(m.labelIds || []).includes('SENT') && !(m.labelIds || []).includes('DRAFT'); }) || null;
}

// The "@" rule for inbox responses: nothing but a message's own text / html body may carry one.
export const BODY_FIELDS = new Set(['text', 'html']);
export function stripBodies(v) {
  if (Array.isArray(v)) return v.map(stripBodies);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !BODY_FIELDS.has(k)).map(([k, x]) => [k, stripBodies(x)]));
  return v;
}
