// grow-mailbox-link-v1 L6 / L7 - the reads and writes on hk_brand_threads. A thread is shown to its mailbox owner in full;
// to the rest of the team in full only while that member's "Share my deal status" is on, otherwise existence + founder +
// date only (the warm rule). The Gmail thread id (Open in Gmail) goes to the mailbox owner only. Nothing here returns a
// subject, body, snippet or address - the table holds none.
import { getSupabase, HkError, fail, me, logEvent, brandById, memberFirstNames } from './hkShared.js';
import { deps0 } from './gmailRoutes.js';
import { GMAIL_UNITS } from './gmailClient.js';
import { messagesOf, threadFacts } from './threadLinks.js';
import { backfillMailbox, memberBackfill } from './threadBackfill.js';
import { readThreads } from './threadRead.js';

const DAY = 864e5;
const deps = d => ({ ...deps0(d), defer: d.defer || (fn => setTimeout(fn, 0)) });
const ageDays = (iso, now) => (iso ? Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY)) : null);

export async function sharingOf(supabase, businessId) {
  const { data, error } = await supabase.from('hk_member_prefs').select('user_id, share_deal_status').eq('business_id', businessId);
  if (error) throw new Error(error.message);
  return new Map((data || []).map(r => [r.user_id, r.share_deal_status !== false]));
}
export const sharedWith = (row, meId, sharing) => row.member_user_id === meId || sharing.get(row.member_user_id) !== false;

// One row as the caller may see it.
export function threadView(row, { meId, sharing, firstName = () => null, now = new Date() }) {
  const own = row.member_user_id === meId;
  const base = { id: row.id, brand_id: row.brand_id, member_user_id: row.member_user_id, who: firstName(row.member_user_id), own, last_at: row.last_at, matched_by: row.matched_by, link_state: row.link_state, needs_confirm: row.matched_by === 'name' || row.matched_by === 'suggested_domain' };
  if (!sharedWith(row, meId, sharing)) return { ...base, shared: false };
  return {
    ...base, shared: true, first_at: row.first_at, message_count: row.message_count, last_ours_at: row.last_ours_at, last_theirs_at: row.last_theirs_at,
    waiting_on: row.waiting_on, waiting_days: row.waiting_on === 'us' ? ageDays(row.last_theirs_at, now) : row.waiting_on === 'them' ? ageDays(row.last_ours_at, now) : null,
    deal_stage: row.deal_stage, deal_month: row.deal_month, deal_amount_usd: row.deal_amount_usd == null ? null : Number(row.deal_amount_usd), our_question_open: !!row.our_question_open,
    summary: row.summary, read_at: row.read_at, ...(own ? { gmail_thread_id: row.gmail_thread_id } : {}),
  };
}

// GET /brands/:id/threads -> { threads } (linked only, newest first)
export async function brandThreadsRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId;
  try {
    await brandById(supabase, businessId, req.params.id);
    const { data, error } = await supabase.from('hk_brand_threads').select('*').eq('business_id', businessId).eq('brand_id', req.params.id).eq('link_state', 'linked').order('last_at', { ascending: false });
    if (error) throw new Error(error.message);
    const [sharing, firstName] = await Promise.all([sharingOf(supabase, businessId), memberFirstNames(supabase, businessId)]);
    res.json({ threads: (data || []).map(r => threadView(r, { meId: me(req), sharing, firstName, now: now() })) });
  } catch (e) { fail(res, e, 'brands/threads'); }
}

// GET /review/email-links -> { links } - name-only matches waiting for a person, and suggested-domain links (shown until
// the brand's domain is saved).
export async function emailLinksRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId;
  try {
    const { data, error } = await supabase.from('hk_brand_threads').select('*').eq('business_id', businessId).in('link_state', ['review', 'linked']).order('last_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data || []).filter(r => r.link_state === 'review' || r.matched_by === 'suggested_domain');
    const { data: brands } = await supabase.from('hk_brands').select('id, name').eq('business_id', businessId).in('id', [...new Set(rows.map(r => r.brand_id))]);
    const nameOf = Object.fromEntries((brands || []).map(b => [b.id, b.name]));
    const [sharing, firstName] = await Promise.all([sharingOf(supabase, businessId), memberFirstNames(supabase, businessId)]);
    res.json({ links: rows.map(r => ({ ...threadView(r, { meId: me(req), sharing, firstName, now: now() }), brand_name: nameOf[r.brand_id] || null })) });
  } catch (e) { fail(res, e, 'review/email-links'); }
}

// POST /review/email-links/:id { decision: link | not_this_brand }. A person's Link makes it a manual link (auto-actions
// may use it); Not this brand is kept so the matcher never adds it again.
export async function decideEmailLinkRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, decision = req.body?.decision;
  try {
    if (!['link', 'not_this_brand'].includes(decision)) throw new HkError(400, 'decision must be link or not_this_brand');
    const { data: row, error } = await supabase.from('hk_brand_threads').select('*').eq('business_id', businessId).eq('id', req.params.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new HkError(404, 'link not found');
    const patch = decision === 'link' ? { link_state: 'linked', matched_by: 'manual' } : { link_state: 'not_this_brand' };
    const { error: e1 } = await supabase.from('hk_brand_threads').update({ ...patch, updated_at: now().toISOString() }).eq('id', row.id);
    if (e1) throw new Error(e1.message);
    await logEvent(supabase, { businessId, actorUserId: me(req), entityType: 'brand', entityId: row.brand_id, action: decision === 'link' ? 'thread.linked' : 'thread.not_this_brand', detail: { was: row.matched_by } });
    res.json({ ok: true, id: row.id, ...patch });
  } catch (e) { fail(res, e, 'review/email-links/decide'); }
}

// POST /threads/link { gmail_thread_id, brand_id } - L7 "Link to brand…" from the Inbox, on the caller's OWN mailbox
// (one threads.get metadata, 40 units, for the facts).
export async function linkThreadRoute(req, res, d = {}) {
  const D = deps(d), businessId = req.params.businessId, uid = me(req);
  try {
    const threadId = req.body?.gmail_thread_id;
    if (typeof threadId !== 'string' || !/^[0-9a-f]{6,40}$/i.test(threadId)) throw new HkError(400, 'gmail_thread_id is required');
    const brand = await brandById(D.supabase, businessId, req.body?.brand_id);
    const token = await D.tokenFor(req, res, businessId, 'inbox');
    if (!token) return;
    const m = await D.mailbox(businessId, uid, 'inbox');
    const ownEmails = [m?.grant?.google_email].filter(Boolean);
    const msgs = messagesOf(await D.gmail.getThreadPeople(token, threadId)).filter(x => !x.bulk);
    if (!msgs.length) throw new HkError(409, 'This thread is bulk mail (a newsletter or promotion) - bulk mail never links to a brand');
    const facts = threadFacts(msgs, { ownEmails, ownDomains: ownEmails.map(e => e.split('@')[1]) });
    const row = { business_id: businessId, brand_id: brand.id, member_user_id: uid, gmail_thread_id: threadId, matched_by: 'manual', link_state: 'linked', ...facts, updated_at: D.now().toISOString() };
    const { data, error } = await D.supabase.from('hk_brand_threads').upsert(row, { onConflict: 'business_id,member_user_id,gmail_thread_id' }).select().single();
    if (error) throw new Error(error.message);
    await logEvent(D.supabase, { businessId, actorUserId: uid, entityType: 'brand', entityId: brand.id, action: 'thread.linked', detail: { was: 'manual' } });
    const [sharing, firstName] = await Promise.all([sharingOf(D.supabase, businessId), memberFirstNames(D.supabase, businessId)]);
    res.json({ thread: threadView(data, { meId: uid, sharing, firstName, now: D.now() }), gmail_units: GMAIL_UNITS['threads.get'] });
  } catch (e) { fail(res, e, 'threads/link'); }
}

// POST /jobs/thread-backfill - the caller's own mailbox, in the background (Stage 3 starts the workspace's first one).
export async function startBackfillRoute(req, res, d = {}) {
  const D = deps(d), businessId = req.params.businessId, uid = me(req);
  try {
    const prior = await memberBackfill(D.supabase, businessId, uid);
    if (prior.done) return res.json({ started: false, reason: 'done', linked: prior.linked, units: prior.units });
    D.defer(() => backfillMailbox({ businessId, memberId: uid, trigger: 'manual', startedBy: uid, d }).catch(e => console.error('[hk/thread-backfill]', e.message)));
    res.status(202).json({ started: true, linked_so_far: prior.linked, units_so_far: prior.units });
  } catch (e) { fail(res, e, 'jobs/thread-backfill'); }
}

// POST /jobs/thread-read - "Read deal emails now": the same capped job, in the background.
export async function startReadRoute(req, res, d = {}) {
  const D = deps(d), businessId = req.params.businessId, uid = me(req);
  try {
    D.defer(() => readThreads({ businessId, trigger: 'manual', startedBy: uid, d }).catch(e => console.error('[hk/thread-read]', e.message)));
    res.status(202).json({ started: true });
  } catch (e) { fail(res, e, 'jobs/thread-read'); }
}
