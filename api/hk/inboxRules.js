// hkos-inbox-v1 (I1) - the read-time matcher and the Gmail -> screen shapes for the caller's own inbox. Pure: no
// DB, no network. Nothing here keeps an address: a sender is a display name plus a domain, recipients are names (or
// "you"), and the only body fields that pass through untouched are a message's own text and html, which go to the
// mailbox owner alone. Bulk-sender and role-word heuristics are REVISABLE.
import { header, parseAddress, decodeEntities } from './gmailMime.js';
import { cleanText } from '../sales/scrubText.js';

export const SNIPPET_MAX = 140;
export const CHIP_KINDS = ['tracked', 'matches', 'untracked', 'team', 'not_tracked'];
export const BULK_LOCAL_PARTS = /^(?:no-?reply|do-?not-?reply|notifications?|newsletters?)(?:[-+._].*)?$/i;
const ROLE_WORDS = ['co-founder', 'founder', 'ceo', 'owner', 'marketing', 'partnerships', 'team', 'support', 'sales', 'press', 'events', 'community', 'brand', 'studio', 'hello', 'info'];

// The inbox's "@" rule is literal: after the address scrub, a bare @ ("Jane @ Acme", "@handle") reads as "at".
export const noAt = s => String(s == null ? '' : s).replace(/\s*@\s*/g, ' at ').replace(/\s{2,}/g, ' ').trim();
// hkos-inbox-v2 L3: Gmail hands subjects, snippets and names over HTML-escaped ("you&#39;re"); decoded before the scrub.
const clean = (v, max) => noAt(cleanText(decodeEntities(v), max));

const lastOf = arr => (arr && arr.length ? arr[arr.length - 1] : null);
const dateOf = msg => { const d = header(msg, 'Date'); const t = d ? Date.parse(d) : NaN; return !Number.isNaN(t) ? new Date(t).toISOString() : msg?.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null; };

// From: "Jane at Rumpl" <jane@rumpl.com> -> { name: 'Jane at Rumpl', domain: 'rumpl.com', local: 'jane' }. With no
// display name the domain stands in for the name; the local part is kept only for the bulk check and never returned.
export function senderOf(fromHeader) {
  const a = parseAddress(fromHeader);
  const local = a.email ? a.email.slice(0, a.email.lastIndexOf('@')) : null;
  return { name: clean(a.name || a.domain || 'Unknown', 120), domain: a.domain, local, email: a.email };
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
export const recipientNames = (value, ownerEmail) => splitAddresses(value).map(parseAddress).map(a => (ownerEmail && a.email === String(ownerEmail).toLowerCase() ? 'you' : clean(a.name || a.domain || 'Unknown', 120)));

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

// hkos-inbox-v2 ruling 2 - who a message is really from. A team-domain From is RELAYED when the group rewrote it
// ("'Grace Miller' via Support Group" <support@team>) or carries an outside X-Original-Sender / Reply-To: the outside
// address is the sender for the lane, the chip and the intel, and the group's own List-Unsubscribe is not a bulk sign.
// A team-domain From that is not relayed is a NOTICE when automated (no-reply local part, a +tagged group address, or
// List-Unsubscribe - digests, moderation); otherwise it is a teammate writing directly.
const VIA = /\s+via\s+[^<>]+$/i;
export function originOf(msg, { teamDomains = [] } = {}) {
  const raw = parseAddress(header(msg, 'From'));
  const fromTeam = !!raw.domain && teamDomains.includes(raw.domain);
  const outside = name => { const a = parseAddress(header(msg, name) || ''); return a.email && a.domain && !teamDomains.includes(a.domain) ? a : null; };
  const orig = fromTeam ? outside('X-Original-Sender') || outside('Reply-To') : null;
  const viaName = fromTeam && raw.name && VIA.test(raw.name) ? raw.name.replace(VIA, '').replace(/^['"\s]+|['"\s]+$/g, '') : null;
  if (orig || viaName) {
    const a = orig || {};
    const local = a.email ? a.email.slice(0, a.email.lastIndexOf('@')) : null;
    const name = viaName || a.name || a.domain || 'Unknown';
    return { sender: { name: clean(name, 120), domain: a.domain || null, local, email: a.email || null }, relayed: true, teamNotice: false, listUnsubscribe: null };
  }
  const sender = senderOf(header(msg, 'From'));
  const listUnsubscribe = header(msg, 'List-Unsubscribe');
  const teamNotice = fromTeam && (isBulk(sender.local, listUnsubscribe) || (!!sender.local && sender.local.includes('+')));
  return { sender, relayed: false, teamNotice, listUnsubscribe };
}

// hkos-inbox-v2 L1 - the lane of an INBOX row. Needs you: brand mail, a teammate writing directly, and a person (not
// bulk, not ignored) whose newest message Gmail did not file under Promotions / Updates / Social / Forums - relayed group
// mail is a person even though Gmail files it under Forums. Everything else is Other. Brands is its own query (tracked
// + matches); a brand row on the Inbox page also sits in Needs you.
export const MARKETING_CATEGORIES = ['CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'];
export const LANES = ['needs_you', 'brands', 'other'];
export function laneOf({ chip, labelIds = [], relayed = false, teamNotice = false }) {
  if (chip.kind === 'tracked' || chip.kind === 'matches') return 'needs_you';
  if (chip.kind === 'team') return teamNotice ? 'other' : 'needs_you';
  if (chip.kind === 'not_tracked') return 'other';
  return !relayed && labelIds.some(l => MARKETING_CATEGORIES.includes(l)) ? 'other' : 'needs_you';
}
export const isBrandChip = chip => chip.kind === 'tracked' || chip.kind === 'matches';

// hkos-inbox-v2 Q2 - the Brands lane's Gmail searches: "from:(a.com OR b.com ...)" over every brand domain plus the
// domains tracked replies came from, chunked so no query passes maxLen characters (Gmail has no published cap;
// REVISABLE). One messages.list per chunk instead of scanning the inbox.
export const BRANDS_QUERY_MAX = 1200; // REVISABLE
export function brandQueries(domains, { search = '', maxLen = BRANDS_QUERY_MAX } = {}) {
  const prefix = search ? `(${search}) ` : '';
  const list = [...new Set((domains || []).map(d => String(d || '').trim().toLowerCase()).filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))].sort();
  const out = []; let cur = [];
  const q = ds => `${prefix}from:(${ds.join(' OR ')})`;
  for (const d of list) {
    if (cur.length && q([...cur, d]).length > maxLen) { out.push(q(cur)); cur = []; }
    cur.push(d);
  }
  if (cur.length) out.push(q(cur));
  return out;
}
// Merging the chunks: each chunk's list is newest first, so taking them in turns (one from each, again and again) puts
// every chunk's newest messages in before anyone's older ones; the metadata of the picked messages then orders them by
// internalDate (message ids are not time-ordered - Jack, Oct 28). max bounds the metadata gets (units) per Brands load.
export const BRANDS_META_MAX = 75; // REVISABLE: 3 chunks x 25
export function inTurns(lists, max) {
  const out = [], seen = new Set();
  for (let i = 0; out.length < max && lists.some(l => i < l.length); i++) {
    for (const l of lists) { const m = l[i]; if (m && !seen.has(m.threadId) && out.length < max) { seen.add(m.threadId); out.push(m); } }
  }
  return out;
}
export const byInternalDate = (a, b) => Number(b.internalDate || 0) - Number(a.internalDate || 0);

// hkos-inbox-v2 Q1 - Gmail quota units for one list page load.
export const unitsOf = (counts, units) => Object.entries(counts).reduce((n, [k, c]) => n + (units[k] || 0) * c, 0);

// hkos-inbox-v2 L5 / Track as brand - the brand form from an Analyze result: name, domain, category, challenge idea, the
// HQ city, is_local when Chicago presence is yes, the size hint, and one dated research note.
export function prefillFromIntel(intel, { senderName = '', domain = null, date }) {
  const c = intel?.company || {}, e = intel?.email || {}, f = intel?.fit || {};
  const bits = [c.what_they_do, e.kind && `Email: ${e.kind.replace(/_/g, ' ')}`, f.sponsor_fit && `Sponsor fit: ${f.sponsor_fit.replace(/_/g, ' ')}${f.why ? ` - ${f.why}` : ''}`, intel?.next_step && `Next: ${intel.next_step.replace(/_/g, ' ')}${intel.reason ? ` - ${intel.reason}` : ''}`].filter(Boolean);
  return {
    name: c.name || (senderName && senderName !== domain ? senderName : ''),
    domain: domain || '',
    category: c.category || '',
    challenge_idea: f.challenge_idea || '',
    city: c.hq_city || '',
    is_local: c.chicago_presence === 'yes',
    size_band: c.size_hint || '',
    notes: `Analyzed ${date}: ${bits.join(' · ')}`.slice(0, 4000),
  };
}

// A threads.get (metadata) resource -> one list row. The newest message gives sender, date and snippet; the subject
// comes from the first message so "Re:" chains read as one.
export function threadRow(thread, ctx) {
  const msgs = thread?.messages || [];
  const latest = lastOf(msgs) || {};
  const { sender, relayed, teamNotice, listUnsubscribe } = originOf(latest, ctx);
  const chip = chipFor({ threadId: thread.id, sender, listUnsubscribe, ...ctx });
  return {
    thread_id: thread.id,
    unread: msgs.some(m => (m.labelIds || []).includes('UNREAD')),
    from_name: sender.name,
    from_domain: sender.domain,
    from_hint: fromHint(sender.name, sender.domain),
    date: dateOf(latest),
    subject: clean(header(msgs[0] || latest, 'Subject') || '(no subject)', 200),
    snippet: clean(latest.snippet || '', SNIPPET_MAX),
    message_count: msgs.length,
    has_attachments: msgs.some(m => /^multipart\/mixed/i.test(m.payload?.mimeType || '')),
    chip,
    relayed,
    lane: laneOf({ chip, labelIds: latest.labelIds || [], relayed, teamNotice }),
  };
}

// Walk a full-format payload: the first text/plain and text/html bodies (base64url), plus named parts as attachments.
const decodeBody = data => (data ? Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') : '');
export function partsOf(payload) {
  const out = { text: null, html: null, attachments: [] };
  const walk = p => {
    if (!p) return;
    const mime = (p.mimeType || '').toLowerCase();
    if (p.filename) out.attachments.push({ name: clean(p.filename, 160), size: Number(p.body?.size) || 0 });
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
    subject: clean(header(msg, 'Subject') || '', 200),
    unread: (msg.labelIds || []).includes('UNREAD'),
    text: parts.text == null ? null : decodeEntities(parts.text),
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
