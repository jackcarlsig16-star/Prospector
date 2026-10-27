// hkos-inbox-v1 (I1) - the signed-in founder's own HumanKind Gmail, read live. Every Gmail call uses the CALLER's
// tethered grant for purpose 'inbox' (tokenForMailbox - never the default-account helper, never another user's grant,
// no fallback). Reading writes nothing: no table, no event, no log. The only writes are link / track /
// ignore. Addresses never leave the server except inside a message's own text / html body, which the browser gets only
// from the owner's own mailbox and sanitizes before rendering. No send path, no mark-read, no label writes.
import { getSupabase, HkError, fail, me, text, domainOf, logEvent, replyRow, brandDetail, brandSummary, liveBrands, brandById, sponsorsNichesOf, canContact, TEAM_DOMAINS } from './hkShared.js';
import { roleAtLeast } from '../../src/constants/roles.js';
import { gmailClient, GmailError } from './gmailClient.js';
import { threadRow, messageView, latestInbound, senderOf, chipFor } from './inboxRules.js';
import { trackedThreads } from './warm.js';
import { labelReply, snippetOf } from './replyLabel.js';
import { createBrand } from './brandsRoutes.js';
import { header } from './gmailMime.js';
import { mailboxFor, tokenForMailbox } from '../lib/googleGrants.js';
import { callAnthropic } from '../businesses/shared.js';
import { laDateString } from '../sales/laDate.js';

export const PAGE_SIZE = 50;
export const BRANDS_SCAN_MAX = 200;
export const META_BATCH = 10;
export const CACHE_MS = 120_000;
const TABS = { inbox: ['INBOX'], brands: ['INBOX'], sent: ['SENT'], drafts: ['DRAFT'] };

// Per user + tab + q + page (and per opened thread), 120 s. Refresh and any link / track / ignore drop the user's entries.
const cache = new Map();
export const inboxCache = {
  get: (key, nowMs) => { const hit = cache.get(key); if (!hit) return null; if (nowMs - hit.at > CACHE_MS) { cache.delete(key); return null; } return hit; },
  set: (key, value, nowMs) => { cache.set(key, { at: nowMs, value }); },
  dropUser: (businessId, userId) => { for (const k of [...cache.keys()]) if (k.startsWith(`${businessId}:${userId}:`)) cache.delete(k); },
  clear: () => cache.clear(),
  size: () => cache.size,
};

const deps0 = d => ({ supabase: d.supabase || getSupabase(), gmail: d.gmail || gmailClient(), mailbox: d.mailbox || mailboxFor, tokenFor: d.tokenFor || tokenForMailbox, call: d.call || callAnthropic, now: d.now || (() => new Date()) });
// hkGate lets a viewer GET; an inbox needs a mailbox, so every route here is member+.
const member = req => { if (!(req.auth.isPlatformOwner || roleAtLeast(req.auth.roles.get(req.params.businessId), 'member'))) throw new HkError(403, 'Members only'); };

// The caller's token for purpose 'inbox', or null once tokenForMailbox has answered 409 { needs_mailbox | needs_reconnect }.
async function ownToken(req, res, d) { member(req); return d.tokenFor(req, res, req.params.businessId, 'inbox'); }
async function ownerEmail(d, businessId, uid) { const m = await d.mailbox(businessId, uid, 'inbox').catch(() => null); return m?.grant?.google_email || null; }

// Matching context, read fresh per request (no cache: a brand or a link made seconds ago must show).
async function matchContext(supabase, businessId, uid, ownerAddress) {
  const brands = await liveBrands(supabase, businessId);
  const byId = Object.fromEntries(brands.map(b => [b.id, b]));
  const tracked = new Map();
  const { data: touches } = await supabase.from('hk_touches').select('brand_id, gmail_thread_id, state').eq('business_id', businessId).neq('state', 'discarded').not('gmail_thread_id', 'is', null);
  for (const t of touches || []) if (t.gmail_thread_id && byId[t.brand_id]) tracked.set(t.gmail_thread_id, { brand_id: t.brand_id, brand_name: byId[t.brand_id].name, status: byId[t.brand_id].status, label: null });
  const { data: replies } = await supabase.from('hk_replies').select('id, brand_id, gmail_thread_id, label, handled, received_at').eq('business_id', businessId).not('gmail_thread_id', 'is', null).order('received_at');
  for (const r of replies || []) if (r.gmail_thread_id && byId[r.brand_id]) { const prev = tracked.get(r.gmail_thread_id); tracked.set(r.gmail_thread_id, { brand_id: r.brand_id, brand_name: byId[r.brand_id].name, status: byId[r.brand_id].status, label: r.label || null, unhandled_reply_id: r.handled ? prev?.unhandled_reply_id || null : r.id }); }
  const { data: ign } = await supabase.from('hk_ignored_senders').select('domain').eq('business_id', businessId).eq('user_id', uid);
  return { brands, byId, tracked, brandsByDomain: Object.fromEntries(brands.filter(b => b.domain).map(b => [b.domain, b])), teamDomains: TEAM_DOMAINS, ownerEmail: ownerAddress, ignored: new Set((ign || []).map(r => r.domain)) };
}

async function inGroups(ids, size, fn) { const out = []; for (let i = 0; i < ids.length; i += size) out.push(...(await Promise.all(ids.slice(i, i + size).map(fn)))); return out; }

// GET /inbox/threads?tab=inbox|brands|sent|drafts&q=&pageToken=&refresh=1
export async function listThreadsRoute(req, res, d = {}) {
  const { supabase, gmail, now } = deps0(d);
  const businessId = req.params.businessId, uid = me(req), q = req.query || {};
  try {
    const tab = q.tab && TABS[q.tab] ? q.tab : 'inbox';
    const search = typeof q.q === 'string' ? q.q.trim().slice(0, 200) : '';
    const pageToken = typeof q.pageToken === 'string' && q.pageToken ? q.pageToken : null;
    const key = `${businessId}:${uid}:list:${tab}:${search}:${pageToken || ''}`;
    if (q.refresh === '1') inboxCache.dropUser(businessId, uid);
    const hit = inboxCache.get(key, now().getTime());
    if (hit) { member(req); return res.json({ ...hit.value, from_cache: true }); }
    const token = await ownToken(req, res, d); if (!token) return;
    const owner = await ownerEmail(deps0(d), businessId, uid);
    const ctx = await matchContext(supabase, businessId, uid, owner);
    const rows = []; let next = pageToken, scanned = 0, calls = 0, listCalls = 0;
    do {
      const page = await gmail.listThreads(token, { labelIds: TABS[tab], q: search || null, pageToken: next, maxResults: PAGE_SIZE }); listCalls++;
      const ids = (page?.threads || []).map(t => t.id);
      const threads = await inGroups(ids, META_BATCH, id => gmail.getThreadMeta(token, id).catch(e => { if (e instanceof GmailError && e.status === 404) return null; throw e; }));
      calls += ids.length; scanned += ids.length;
      for (const th of threads) if (th) { const row = threadRow(th, ctx); if (tab !== 'brands' || row.chip.kind === 'tracked' || row.chip.kind === 'matches') rows.push(row); }
      next = page?.nextPageToken || null;
    } while (tab === 'brands' && next && rows.length < PAGE_SIZE && scanned < BRANDS_SCAN_MAX);
    const value = { tab, threads: rows, next_page_token: next, unread: tab === 'inbox' && !pageToken ? rows.filter(r => r.unread).length : null, scanned, gmail_calls: listCalls + calls, fetched_at: now().toISOString() };
    inboxCache.set(key, value, now().getTime());
    res.json({ ...value, from_cache: false });
  } catch (e) { fail(res, e, 'inbox/list'); }
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

// GET /inbox/threads/:id - the caller's own thread, full. Nothing is written or logged.
export async function openThreadRoute(req, res, d = {}) {
  const { supabase, gmail, now } = deps0(d);
  const businessId = req.params.businessId, uid = me(req), id = String(req.params.id || '');
  try {
    const key = `${businessId}:${uid}:thread:${id}`;
    const hit = inboxCache.get(key, now().getTime());
    if (hit) { member(req); return res.json({ ...hit.value, from_cache: true }); }
    const token = await ownToken(req, res, d); if (!token) return;
    const owner = await ownerEmail(deps0(d), businessId, uid);
    let thread;
    try { thread = await gmail.getThreadFull(token, id); } catch (e) { if (e instanceof GmailError && e.status === 404) throw new HkError(404, 'that thread is not in your mailbox'); throw e; }
    const ctx = await matchContext(supabase, businessId, uid, owner);
    const messages = (thread?.messages || []).map(m => messageView(m, { ownerEmail: owner }));
    const inbound = latestInbound(thread, owner);
    const sender = senderOf(header(inbound || thread?.messages?.[thread.messages.length - 1] || {}, 'From'));
    const chip = chipFor({ threadId: id, sender, listUnsubscribe: inbound ? header(inbound, 'List-Unsubscribe') : null, ...ctx });
    const brand = chip.brand_id ? ctx.byId[chip.brand_id] : null;
    const t = ctx.tracked.get(id);
    const value = { thread_id: id, subject: messages[0]?.subject || '', messages, chip, brand: brand ? await brandPanel(supabase, businessId, uid, brand, ctx) : null, unhandled_reply_id: t?.unhandled_reply_id || null, sender: { name: sender.name, domain: sender.domain }, fetched_at: now().toISOString() };
    inboxCache.set(key, value, now().getTime());
    res.json({ ...value, from_cache: false });
  } catch (e) { fail(res, e, 'inbox/open'); }
}

// Records a thread for a brand exactly as the sync does: one hk_replies row for the latest inbound message, labeled by
// the FAST model when the brand has a sent email (under the shared 60/day cap), new_thread otherwise. One event, no content.
async function linkThread({ supabase, gmail, call, now }, { businessId, uid, brand, threadId, token, owner }) {
  const { data: existing } = await supabase.from('hk_replies').select('id, brand_id').eq('business_id', businessId).eq('gmail_thread_id', threadId);
  if (existing?.length) throw new HkError(409, 'that thread is already tracked', { already_tracked: existing[0].brand_id });
  const { data: touchHits } = await supabase.from('hk_touches').select('id, brand_id').eq('business_id', businessId).eq('gmail_thread_id', threadId).neq('state', 'discarded');
  if (touchHits?.length) throw new HkError(409, 'that thread is already tracked', { already_tracked: touchHits[0].brand_id });
  let thread;
  try { thread = await gmail.getThreadMeta(token, threadId); } catch (e) { if (e instanceof GmailError && e.status === 404) throw new HkError(404, 'that thread is not in your mailbox'); throw e; }
  const msg = latestInbound(thread, owner);
  if (!msg) throw new HkError(409, 'that thread has no message from the brand yet', { no_inbound: true });
  const sender = senderOf(header(msg, 'From'));
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
    const token = await ownToken(req, res, d); if (!token) return;
    const owner = await ownerEmail(D, businessId, uid);
    const row = await linkThread(D, { businessId, uid, brand, threadId, token, owner });
    res.status(201).json({ reply: replyRow(row), brand_id: brand.id });
  } catch (e) { fail(res, e, 'inbox/link'); }
}

// POST /inbox/track { name, domain, thread_id, claim?, force_duplicate? } - Add brand under the brands rules, then link.
export async function trackRoute(req, res, d = {}) {
  const D = deps0(d);
  const businessId = req.params.businessId, uid = me(req), body = req.body || {};
  try {
    const threadId = text(body.thread_id, 64, 'thread_id', { required: true });
    const token = await ownToken(req, res, d); if (!token) return;
    const owner = await ownerEmail(D, businessId, uid);
    const { data: existing } = await D.supabase.from('hk_replies').select('brand_id').eq('business_id', businessId).eq('gmail_thread_id', threadId);
    if (existing?.length) throw new HkError(409, 'that thread is already tracked', { already_tracked: existing[0].brand_id });
    let thread;
    try { thread = await D.gmail.getThreadMeta(token, threadId); } catch (e) { if (e instanceof GmailError && e.status === 404) throw new HkError(404, 'that thread is not in your mailbox'); throw e; }
    if (!latestInbound(thread, owner)) throw new HkError(409, 'that thread has no message from the brand yet', { no_inbound: true });
    const { data: brand, verdict } = await createBrand(D.supabase, { businessId, userId: uid, body: { name: body.name, domain: body.domain ? domainOf(body.domain) : null, claim: body.claim === true, force_duplicate: body.force_duplicate === true, source: 'user_supplied' }, now: D.now });
    const row = await linkThread(D, { businessId, uid, brand, threadId, token, owner });
    res.status(201).json({ brand: brandDetail(brand), verdict, reply: replyRow(row) });
  } catch (e) { fail(res, e, 'inbox/track'); }
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
