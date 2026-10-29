// hkos-inbox-v1 (I1) / hkos-inbox-v2 - the signed-in founder's own HumanKind Gmail, read live. Every Gmail call uses the CALLER's
// tethered grant for purpose 'inbox' (tokenForMailbox - never the default-account helper, never another user's grant,
// no fallback). Reading writes nothing: no table, no event, no log. The only writes are link / track /
// ignore. Addresses never leave the server except inside a message's own text / html body, which the browser gets only
// from the owner's own mailbox and sanitizes before rendering. No send path, no mark-read, no label writes.
import { getSupabase, HkError, fail, me, domainOf, logEvent, replyRow, brandDetail, brandSummary, liveBrands, brandById, sponsorsNichesOf, canContact, TEAM_DOMAINS } from './hkShared.js';
import { roleAtLeast } from '../../src/constants/roles.js';
import { gmailClient, GmailError, GMAIL_UNITS } from './gmailClient.js';
import { threadRow, messageView, latestInbound, chipFor, originOf, partsOf, isBrandChip, brandQueries, newestFirst, unitsOf, prefillFromIntel, LANES } from './inboxRules.js';
import { noteInboxList } from './gmailActivity.js';
import { analyzeSender, cachedIntel } from './inboxAnalyze.js';
import { header } from './gmailMime.js';
import { trackedThreads } from './warm.js';
import { labelReply, snippetOf } from './replyLabel.js';
import { createBrand } from './brandsRoutes.js';
import { mailboxFor, tokenForMailbox } from '../lib/googleGrants.js';
import { callAnthropic } from '../businesses/shared.js';
import { laDateString } from '../sales/laDate.js';

export const PAGE_SIZE = 25; // REVISABLE (spec Q1; v1 was 50 threads)
export const META_BATCH = 10;
export const CACHE_MS = 120_000;
const LABELS = { inbox: ['INBOX'], brands: ['INBOX'], sent: ['SENT'], drafts: ['DRAFT'] };

// Per user + tab + q + page (and per opened thread), 120 s. Refresh and any link / track / ignore drop the user's entries.
const cache = new Map();
export const inboxCache = {
  get: (key, nowMs) => { const hit = cache.get(key); if (!hit) return null; if (nowMs - hit.at > CACHE_MS) { cache.delete(key); return null; } return hit; },
  set: (key, value, nowMs) => { cache.set(key, { at: nowMs, value }); },
  // Link / track / ignore change the matching, not Gmail: list and thread entries go, message / thread metadata stays.
  dropUser: (businessId, userId, { all = false } = {}) => { for (const k of [...cache.keys()]) if (k.startsWith(`${businessId}:${userId}:`) && (all || !k.includes(':meta:'))) cache.delete(k); },
  clear: () => cache.clear(),
  size: () => cache.size,
};


const deps0 = d => ({ supabase: d.supabase || getSupabase(), gmail: d.gmail || gmailClient(), mailbox: d.mailbox || mailboxFor, tokenFor: d.tokenFor || tokenForMailbox, call: d.call || callAnthropic, now: d.now || (() => new Date()), sleep: d.sleep || (ms => new Promise(r => setTimeout(r, ms))) });
// hkGate lets a viewer GET; an inbox needs a mailbox, so every route here is member+.
const member = req => { if (!(req.auth.isPlatformOwner || roleAtLeast(req.auth.roles.get(req.params.businessId), 'member'))) throw new HkError(403, 'Members only'); };

// The caller's token for purpose 'inbox', or null once tokenForMailbox has answered 409 { needs_mailbox | needs_reconnect }.
// Both take the RESOLVED deps (deps0(d)); server.js calls every handler with (req, res) only, so the raw d is {}.
async function ownToken(req, res, D) { member(req); return D.tokenFor(req, res, req.params.businessId, 'inbox'); }
async function ownerEmail(D, businessId, uid) { const m = await D.mailbox(businessId, uid, 'inbox').catch(() => null); return m?.grant?.google_email || null; }

// Matching context, read fresh per request (no cache: a brand or a link made seconds ago must show).
async function matchContext(supabase, businessId, uid, ownerAddress) {
  const brands = await liveBrands(supabase, businessId);
  const byId = Object.fromEntries(brands.map(b => [b.id, b]));
  const tracked = new Map();
  const { data: touches } = await supabase.from('hk_touches').select('brand_id, gmail_thread_id, state').eq('business_id', businessId).neq('state', 'discarded').not('gmail_thread_id', 'is', null);
  for (const t of touches || []) if (t.gmail_thread_id && byId[t.brand_id]) tracked.set(t.gmail_thread_id, { brand_id: t.brand_id, brand_name: byId[t.brand_id].name, status: byId[t.brand_id].status, label: null });
  const { data: replies } = await supabase.from('hk_replies').select('id, brand_id, gmail_thread_id, from_domain, label, handled, received_at').eq('business_id', businessId).not('gmail_thread_id', 'is', null).order('received_at');
  for (const r of replies || []) if (r.gmail_thread_id && byId[r.brand_id]) { const prev = tracked.get(r.gmail_thread_id); tracked.set(r.gmail_thread_id, { brand_id: r.brand_id, brand_name: byId[r.brand_id].name, status: byId[r.brand_id].status, label: r.label || null, unhandled_reply_id: r.handled ? prev?.unhandled_reply_id || null : r.id }); }
  const { data: ign } = await supabase.from('hk_ignored_senders').select('domain').eq('business_id', businessId).eq('user_id', uid);
  const replyDomains = [...new Set((replies || []).filter(r => byId[r.brand_id] && r.from_domain).map(r => r.from_domain))];
  return { brands, byId, tracked, replyDomains, brandsByDomain: Object.fromEntries(brands.filter(b => b.domain).map(b => [b.domain, b])), teamDomains: TEAM_DOMAINS, ownerEmail: ownerAddress, ignored: new Set((ign || []).map(r => r.domain)) };
}

async function inGroups(ids, size, fn) { const out = []; for (let i = 0; i < ids.length; i += size) out.push(...(await Promise.all(ids.slice(i, i + size).map(fn)))); return out; }

// hkos-inbox-v2 Q3 - Google's per-user-per-minute quota. A 429, or a 403 whose reason is a rate / quota limit, is retried
// once after BACKOFF_MS; a second miss serves the last good list (or thread) with a plain line and asks the browser to
// retry in RETRY_AFTER_MS. Google's own error text never reaches the browser - any other Gmail failure is one plain line.
export const BACKOFF_MS = 1500; // REVISABLE
export const RETRY_AFTER_MS = 60_000;
export const BUSY_LIST = 'Gmail is busy, showing your last list. Retrying in a moment.';
export const BUSY_THREAD = 'Gmail is busy, showing this thread as you last opened it. Retrying in a moment.';
export const BUSY_NONE = 'Gmail is busy. Retrying in a moment.';
export const GMAIL_DOWN = 'Gmail did not answer. Try again in a moment.';
export const isQuota = e => e instanceof GmailError && (e.status === 429 || (e.status === 403 && /rate ?limit|quota|RESOURCE_EXHAUSTED/i.test(`${e.reason || ''} ${e.message || ''}`)));
class GmailBusy extends Error { constructor() { super('gmail busy'); } }
async function gcall(D, fn) {
  try { return await fn(); } catch (e) {
    if (!isQuota(e)) throw e;
    await D.sleep(BACKOFF_MS);
    try { return await fn(); } catch (e2) { throw isQuota(e2) ? new GmailBusy() : e2; }
  }
}
// The last good response per list / thread key, kept past the 120 s cache (and past a refresh) only to stand in while
// Gmail is busy. Bounded; oldest out first.
const lastGood = new Map();
const LAST_GOOD_MAX = 300;
const keepGood = (key, value) => { lastGood.delete(key); lastGood.set(key, value); if (lastGood.size > LAST_GOOD_MAX) lastGood.delete(lastGood.keys().next().value); };
export const clearLastGood = () => lastGood.clear();
function gmailFail(res, e, tag, busyLine, key) {
  if (e instanceof GmailBusy) {
    const stale = key ? lastGood.get(key) : null;
    return stale ? res.json({ ...stale, from_cache: true, busy: true, notice: busyLine, retry_after_ms: RETRY_AFTER_MS }) : res.status(503).json({ error: BUSY_NONE, busy: true, retry_after_ms: RETRY_AFTER_MS });
  }
  if (e instanceof GmailError) { console.error(`[hk/${tag}] gmail ${e.status}${e.reason ? ` ${e.reason}` : ''}`); return res.status(502).json({ error: GMAIL_DOWN }); }
  return fail(res, e, tag);
}

// One threads.get (metadata) per thread per 120 s - link and track read the whole thread's headers.
async function threadMeta(D, businessId, uid, token, id) {
  const key = `${businessId}:${uid}:meta:t:${id}`;
  const hit = inboxCache.get(key, D.now().getTime());
  if (hit) return hit.value;
  const th = await gcall(D, () => D.gmail.getThreadMeta(token, id));
  inboxCache.set(key, th, D.now().getTime());
  return th;
}
// hkos-inbox-v2 Q1 - a list row costs one messages.get (metadata, the six headers the row needs) on the thread's newest
// message, per 120 s: 20 units instead of a 40-unit threads.get.
async function messageMeta(D, businessId, uid, token, id, counts) {
  const key = `${businessId}:${uid}:meta:m:${id}`;
  const hit = inboxCache.get(key, D.now().getTime());
  if (hit) return hit.value;
  counts['messages.get'] += 1;
  const m = await gcall(D, () => D.gmail.getMessageMeta(token, id)).catch(e => { if (e instanceof GmailError && e.status === 404) return null; throw e; });
  if (m) inboxCache.set(key, m, D.now().getTime());
  return m;
}
// messages.list returns newest first, one entry per message: the first entry per thread is that thread's newest message.
const newestPerThread = msgs => { const seen = new Set(); return msgs.filter(m => (seen.has(m.threadId) ? false : seen.add(m.threadId))); };

async function rowsFor(D, { businessId, uid, token, ctx, msgs, counts }) {
  const metas = await inGroups(msgs.map(m => m.id), META_BATCH, id => messageMeta(D, businessId, uid, token, id, counts));
  return metas.filter(Boolean).map(m => ({ ...threadRow({ id: m.threadId, messages: [m] }, ctx), message_count: null }));
}

// "Analyzed · Strong fit" on a row whose sender domain has intel (one DB read per page, no Gmail).
async function withIntel(supabase, businessId, rows) {
  const domains = [...new Set(rows.map(r => r.from_domain).filter(Boolean))];
  if (!domains.length) return rows;
  const { data } = await supabase.from('hk_domain_intel').select('domain, intel').eq('business_id', businessId).in('domain', domains);
  const fit = Object.fromEntries((data || []).map(d => [d.domain, d.intel?.fit?.sponsor_fit || null]));
  return rows.map(r => (r.from_domain && r.from_domain in fit ? { ...r, intel_fit: fit[r.from_domain] } : r));
}

// GET /inbox/threads?tab=inbox|brands|sent|drafts&q=&pageToken=&refresh=1
// inbox = one page of the newest INBOX messages, each row carrying its lane (Needs you / Other) + lane counts for the
// page; brands = Q2's chunked from:(...) searches, newest 25, no scan; sent / drafts by label. gmail_units = this load.
export async function listThreadsRoute(req, res, d = {}) {
  const D = deps0(d), { supabase, now } = D;
  const businessId = req.params.businessId, uid = me(req), q = req.query || {};
  const tab = q.tab && LABELS[q.tab] ? q.tab : 'inbox';
  const search = typeof q.q === 'string' ? q.q.trim().slice(0, 200) : '';
  const pageToken = typeof q.pageToken === 'string' && q.pageToken ? q.pageToken : null;
  const limit = q.limit ? Math.min(PAGE_SIZE, Math.max(5, Number(q.limit) || PAGE_SIZE)) : PAGE_SIZE;
  const key = `${businessId}:${uid}:list:${tab}:${search}:${pageToken || ''}:${limit}`;
  try {
    if (q.refresh === '1') inboxCache.dropUser(businessId, uid, { all: true });
    const hit = inboxCache.get(key, now().getTime());
    if (hit) { member(req); return res.json({ ...hit.value, from_cache: true }); }
    const token = await ownToken(req, res, D); if (!token) return;
    noteInboxList(businessId, uid, now().getTime());
    const owner = await ownerEmail(D, businessId, uid);
    const ctx = await matchContext(supabase, businessId, uid, owner);
    const counts = { 'messages.list': 0, 'messages.get': 0 };
    let rows, next = null, more = false;
    if (tab === 'brands') {
      const queries = brandQueries([...Object.keys(ctx.brandsByDomain), ...ctx.replyDomains].filter(dm => !TEAM_DOMAINS.includes(dm)), { search });
      const pages = [];
      for (const qq of queries) { counts['messages.list'] += 1; pages.push(await gcall(D, () => D.gmail.listMessages(token, { labelIds: LABELS.brands, q: qq, maxResults: limit }))); }
      const all = newestPerThread(pages.flatMap(p => p?.messages || []).sort(newestFirst));
      more = all.length > limit || pages.some(p => p?.nextPageToken);
      rows = (await rowsFor(D, { businessId, uid, token, ctx, msgs: all.slice(0, limit), counts })).filter(r => isBrandChip(r.chip));
    } else {
      counts['messages.list'] += 1;
      const page = await gcall(D, () => D.gmail.listMessages(token, { labelIds: LABELS[tab], q: search || null, pageToken, maxResults: limit }));
      rows = await rowsFor(D, { businessId, uid, token, ctx, msgs: newestPerThread(page?.messages || []), counts });
      next = page?.nextPageToken || null;
    }
    rows = await withIntel(supabase, businessId, rows);
    const laneCounts = tab === 'inbox' ? Object.fromEntries(LANES.map(l => [l, l === 'brands' ? rows.filter(r => isBrandChip(r.chip)).length : rows.filter(r => r.lane === l).length])) : null;
    const value = { tab, threads: rows, next_page_token: next, more, lane_counts: laneCounts, unread: tab === 'inbox' && !pageToken ? rows.filter(r => r.unread).length : null,
      gmail_calls: counts['messages.list'] + counts['messages.get'], gmail_units: unitsOf(counts, GMAIL_UNITS), fetched_at: now().toISOString() };
    inboxCache.set(key, value, now().getTime());
    keepGood(key, value);
    res.json({ ...value, from_cache: false });
  } catch (e) { gmailFail(res, e, 'inbox/list', BUSY_LIST, key); }
}

// The right-hand panel for a matched brand: summary + touch count + the caller's verdict + the last reply label.
async function brandPanel(supabase, businessId, uid, brand, ctx) {
  const { data: touches } = await supabase.from('hk_touches').select('*').eq('business_id', businessId).eq('brand_id', brand.id);
  const live = (touches || []).filter(t => t.state !== 'discarded');
  const { data: replies } = await supabase.from('hk_replies').select('id, label, handled, received_at').eq('business_id', businessId).eq('brand_id', brand.id).order('received_at', { ascending: false }).limit(1);
  const { data: settings } = await supabase.from('hk_settings').select('max_email_touches').eq('business_id', businessId).maybeSingle();
  const verdict = canContact({ brand, touches: live, threadsByFounder: await trackedThreads(supabase, businessId, brand.id), senderUserId: uid, kind: 'cold', sponsorsNiches: sponsorsNichesOf(ctx.brands), maxEmailTouches: settings?.max_email_touches || 3 });
  return { ...brandSummary(brand), challenge_idea: brand.challenge_idea || null, touch_count: live.length, last_reply_label: replies?.[0]?.label || null, verdict };
}

// The sender a thread is about: the newest inbound message's original sender (group relays resolved).
const threadSender = (thread, owner) => {
  const inbound = latestInbound(thread, owner);
  return { inbound, ...originOf(inbound || thread?.messages?.[thread.messages.length - 1] || {}, { teamDomains: TEAM_DOMAINS }) };
};
const intelView = (row, sender, now) => (row ? { intel: row.intel, cost_usd: row.cost_usd, researched_at: row.researched_at, prefill: prefillFromIntel(row.intel, { senderName: sender.name, domain: sender.domain, date: now.toISOString().slice(0, 10) }) } : null);

// GET /inbox/threads/:id - the caller's own thread, full, plus the reader's intel card inputs (L4). Nothing written.
export async function openThreadRoute(req, res, d = {}) {
  const D = deps0(d), { supabase, now } = D;
  const businessId = req.params.businessId, uid = me(req), id = String(req.params.id || '');
  const key = `${businessId}:${uid}:thread:${id}`;
  try {
    if (req.query?.refresh === '1') inboxCache.dropUser(businessId, uid, { all: true });
    const hit = inboxCache.get(key, now().getTime());
    if (hit) { member(req); return res.json({ ...hit.value, from_cache: true }); }
    const token = await ownToken(req, res, D); if (!token) return;
    const owner = await ownerEmail(D, businessId, uid);
    let thread;
    try { thread = await gcall(D, () => D.gmail.getThreadFull(token, id)); } catch (e) { if (e instanceof GmailError && (e.status === 404 || e.status === 400)) throw new HkError(404, 'that thread is not in your mailbox'); throw e; }
    const ctx = await matchContext(supabase, businessId, uid, owner);
    const messages = (thread?.messages || []).map(m => messageView(m, { ownerEmail: owner }));
    const { inbound, sender, relayed, teamNotice, listUnsubscribe } = threadSender(thread, owner);
    const chip = chipFor({ threadId: id, sender, listUnsubscribe, ...ctx });
    const brand = chip.brand_id ? ctx.byId[chip.brand_id] : null;
    const t = ctx.tracked.get(id);
    const value = { thread_id: id, subject: messages[0]?.subject || '', messages, chip, relayed, team_notice: teamNotice, has_inbound: !!inbound,
      brand: brand ? await brandPanel(supabase, businessId, uid, brand, ctx) : null, unhandled_reply_id: t?.unhandled_reply_id || null,
      sender: { name: sender.name, domain: sender.domain }, intel: intelView(await cachedIntel(supabase, businessId, sender.domain), sender, now()), fetched_at: now().toISOString() };
    inboxCache.set(key, value, now().getTime());
    keepGood(key, value);
    res.json({ ...value, from_cache: false });
  } catch (e) { gmailFail(res, e, 'inbox/open', BUSY_THREAD, key); }
}

// POST /inbox/threads/:id/analyze { click: true, confirm? } - L5. Refused without the click flag; one Claude call
// unless the domain has intel from the last 30 days (then the saved card + needs_confirm, 0 calls).
export async function analyzeRoute(req, res, d = {}) {
  const D = deps0(d);
  const businessId = req.params.businessId, uid = me(req), id = String(req.params.id || ''), body = req.body || {};
  try {
    member(req);
    if (body.click !== true) throw new HkError(400, 'Analyze runs only from a click');
    const token = await ownToken(req, res, D); if (!token) return;
    const owner = await ownerEmail(D, businessId, uid);
    let thread;
    try { thread = await gcall(D, () => D.gmail.getThreadFull(token, id)); } catch (e) { if (e instanceof GmailError && (e.status === 404 || e.status === 400)) throw new HkError(404, 'that thread is not in your mailbox'); throw e; }
    const { inbound, sender } = threadSender(thread, owner);
    if (!inbound) throw new HkError(409, 'that thread has no message from anyone else yet');
    if (!sender.domain) throw new HkError(409, 'no sender domain to research');
    if (TEAM_DOMAINS.includes(sender.domain)) throw new HkError(409, 'that is your own team');
    const parts = partsOf(inbound.payload);
    const text = parts.text || String(parts.html || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const out = await analyzeSender({ D, businessId, uid, domain: sender.domain, senderName: sender.name, subject: header(inbound, 'Subject') || '', body: text, confirm: body.confirm === true });
    inboxCache.dropUser(businessId, uid);
    res.json({ ...out, prefill: prefillFromIntel(out.intel, { senderName: sender.name, domain: sender.domain, date: D.now().toISOString().slice(0, 10) }) });
  } catch (e) { gmailFail(res, e, 'inbox/analyze', BUSY_NONE, null); }
}

// Records a thread for a brand exactly as the sync does: one hk_replies row for the latest inbound message, labeled by
// the FAST model when the brand has a sent email (under the shared 60/day cap), new_thread otherwise. One event, no content.
async function linkThread(D, { businessId, uid, brand, threadId, token, owner }) {
  const { supabase, call, now } = D;
  const { data: existing } = await supabase.from('hk_replies').select('id, brand_id').eq('business_id', businessId).eq('gmail_thread_id', threadId);
  if (existing?.length) throw new HkError(409, 'that thread is already tracked', { already_tracked: existing[0].brand_id });
  const { data: touchHits } = await supabase.from('hk_touches').select('id, brand_id').eq('business_id', businessId).eq('gmail_thread_id', threadId).neq('state', 'discarded');
  if (touchHits?.length) throw new HkError(409, 'that thread is already tracked', { already_tracked: touchHits[0].brand_id });
  let thread;
  try { thread = await threadMeta(D, businessId, uid, token, threadId); } catch (e) { if (e instanceof GmailError && (e.status === 404 || e.status === 400)) throw new HkError(404, 'that thread is not in your mailbox'); throw e; }
  const msg = latestInbound(thread, owner);
  if (!msg) throw new HkError(409, 'that thread has no message from the brand yet', { no_inbound: true });
  const { sender } = originOf(msg, { teamDomains: TEAM_DOMAINS });
  const dateHeader = header(msg, 'Date'); const parsed = dateHeader ? Date.parse(dateHeader) : NaN;
  const receivedAt = !Number.isNaN(parsed) ? new Date(parsed).toISOString() : msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : now().toISOString();
  const { data: sentTouches } = await supabase.from('hk_touches').select('id, sent_at').eq('business_id', businessId).eq('brand_id', brand.id).eq('state', 'sent').order('sent_at', { ascending: false }).limit(1);
  const touch = sentTouches?.[0] || null;
  let lab = { label: 'new_thread', summary: snippetOf(msg.snippet || ''), urgent: false, labeled: false };
  if (touch) {
    const { data: labeledToday } = await supabase.from('hk_events').select('id, detail, created_at').eq('business_id', businessId).eq('action', 'reply_logged');
    const today = laDateString(now());
    const labelsToday = (labeledToday || []).filter(e => e.detail?.labeled && laDateString(new Date(e.created_at)) === today).length;
    lab = await labelReply({ call, supabase, businessId, userId: uid, brandName: brand.name, subject: header(msg, 'Subject'), snippet: msg.snippet || '', labelsToday });
  }
  const { data: row, error } = await supabase.from('hk_replies').insert({ business_id: businessId, brand_id: brand.id, touch_id: touch?.id || null, gmail_message_id: msg.id, gmail_thread_id: threadId, from_name: sender.name, from_domain: sender.domain, from_email: sender.email, received_at: receivedAt, label: lab.label, summary: lab.summary || snippetOf(msg.snippet || ''), urgent: !!lab.urgent, handled: false }).select().single();
  if (error) { if (error.code === '23505') throw new HkError(409, 'that message is already tracked', { already_tracked: brand.id }); throw error; }
  await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'brand', entityId: brand.id, action: 'inbox_linked', detail: { thread_id: threadId, reply_id: row.id, label: lab.label, labeled: !!lab.labeled, touch_id: touch?.id || null } });
  inboxCache.dropUser(businessId, uid);
  return row;
}

// POST /inbox/threads/:id/link { brand_id }
export async function linkThreadRoute(req, res, d = {}) {
  const D = deps0(d);
  const businessId = req.params.businessId, uid = me(req), threadId = String(req.params.id || '');
  try {
    const brand = await brandById(D.supabase, businessId, req.body?.brand_id);
    if (brand.archived_at) throw new HkError(409, 'that brand is archived');
    const token = await ownToken(req, res, D); if (!token) return;
    const owner = await ownerEmail(D, businessId, uid);
    const row = await linkThread(D, { businessId, uid, brand, threadId, token, owner });
    res.status(201).json({ reply: replyRow(row), brand_id: brand.id });
  } catch (e) { gmailFail(res, e, 'inbox/link', BUSY_NONE, null); }
}

// POST /inbox/track { name, domain, thread_id, claim?, force_duplicate? } - Add brand under the brands rules, then link.
export async function trackRoute(req, res, d = {}) {
  const D = deps0(d);
  const businessId = req.params.businessId, uid = me(req), body = req.body || {};
  try {
    // Gmail thread ids are hex and often digit-heavy, so they skip the free-text (phone) guard.
    const threadId = typeof body.thread_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(body.thread_id) ? body.thread_id : null;
    if (!threadId) throw new HkError(400, 'thread_id is required');
    const token = await ownToken(req, res, D); if (!token) return;
    const owner = await ownerEmail(D, businessId, uid);
    const { data: existing } = await D.supabase.from('hk_replies').select('brand_id').eq('business_id', businessId).eq('gmail_thread_id', threadId);
    if (existing?.length) throw new HkError(409, 'that thread is already tracked', { already_tracked: existing[0].brand_id });
    let thread;
    try { thread = await threadMeta(D, businessId, uid, token, threadId); } catch (e) { if (e instanceof GmailError && (e.status === 404 || e.status === 400)) throw new HkError(404, 'that thread is not in your mailbox'); throw e; }
    if (!latestInbound(thread, owner)) throw new HkError(409, 'that thread has no message from the brand yet', { no_inbound: true });
    const { data: brand, verdict } = await createBrand(D.supabase, { businessId, userId: uid, body: { ...body, domain: body.domain ? domainOf(body.domain) : null, claim: body.claim === true, force_duplicate: body.force_duplicate === true, source: 'user_supplied' }, now: D.now });
    const row = await linkThread(D, { businessId, uid, brand, threadId, token, owner });
    res.status(201).json({ brand: brandDetail(brand), verdict, reply: replyRow(row) });
  } catch (e) { gmailFail(res, e, 'inbox/track', BUSY_NONE, null); }
}

// GET /inbox/ignore - the caller's own ignored domains.
export async function listIgnoredRoute(req, res, d = {}) {
  const { supabase } = deps0(d);
  try {
    member(req);
    const { data, error } = await supabase.from('hk_ignored_senders').select('domain, created_at').eq('business_id', req.params.businessId).eq('user_id', me(req)).order('created_at');
    if (error) throw new Error(error.message);
    res.json({ domains: data || [] });
  } catch (e) { fail(res, e, 'inbox/ignored'); }
}

// POST /inbox/ignore { domain } - for the caller only; a repeat is a no-op.
export async function ignoreRoute(req, res, d = {}) {
  const { supabase } = deps0(d);
  const businessId = req.params.businessId, uid = me(req);
  try {
    member(req);
    const domain = domainOf(req.body?.domain); if (!domain) throw new HkError(400, 'domain is required');
    const { data: hit } = await supabase.from('hk_ignored_senders').select('id').eq('business_id', businessId).eq('user_id', uid).eq('domain', domain);
    if (!hit?.length) {
      const { error } = await supabase.from('hk_ignored_senders').insert({ business_id: businessId, user_id: uid, domain });
      if (error && error.code !== '23505') throw error;
      await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'sender', entityId: null, action: 'sender_ignored', detail: { domain } });
    }
    inboxCache.dropUser(businessId, uid);
    res.json({ domain, ignored: true });
  } catch (e) { fail(res, e, 'inbox/ignore'); }
}

// DELETE /inbox/ignore/:domain
export async function unignoreRoute(req, res, d = {}) {
  const { supabase } = deps0(d);
  const businessId = req.params.businessId, uid = me(req);
  try {
    member(req);
    const domain = domainOf(req.params.domain); if (!domain) throw new HkError(400, 'domain is required');
    const { data: hit } = await supabase.from('hk_ignored_senders').select('id').eq('business_id', businessId).eq('user_id', uid).eq('domain', domain);
    if (hit?.length) {
      await supabase.from('hk_ignored_senders').delete().eq('business_id', businessId).eq('user_id', uid).eq('domain', domain);
      await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'sender', entityId: null, action: 'sender_unignored', detail: { domain } });
    }
    inboxCache.dropUser(businessId, uid);
    res.json({ domain, ignored: false });
  } catch (e) { fail(res, e, 'inbox/unignore'); }
}
