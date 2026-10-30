// hkos-gmail-connect-v1 (G3, G4, G5, G7) - drafts into the tethered HumanKind mailbox, discard / re-lint / preview, the
// sync that logs sends and replies, reply labels, and the status route the shell reads. Every Gmail call goes through
// the caller's tethered grant (tokenForMailbox / accessTokenForGrant) - never googleTokenFor, never a fallback. The
// only Gmail writes are a draft create and a draft delete. Addresses: the contact's To is read from hk_contacts on the
// server; hk_replies.from_email is stored and never returned; the only address a response carries is the caller's own
// mailbox inside the Gmail URLs they open.
import { getSupabase, HkError, fail, isOwner, me, text, oneOf, logEvent, touchRow, replyRow, liveBrands, brandById, sponsorsNichesOf, canContact, TEAM_DOMAINS, selectIn, ownerParam, ownedBy } from './hkShared.js';
import { lintDraft, lintRejects } from './lint.js';
import { buildDraftMime, draftUrl, replySubject, header } from './gmailMime.js';
import { replyKind, signalWords, signalNow } from './signals.js';
import { gmailClient, toMeta, GmailError } from './gmailClient.js';
import { classify, nextDueAt, counts as runCounts } from './syncRules.js';
import { labelReply, snippetOf } from './replyLabel.js';
import { warmThreads } from './warm.js';
import { mailboxFor, tokenForMailbox, accessTokenForGrant, flagReconnect, RECONNECT, NeedsGoogle } from '../lib/googleGrants.js';
import { callAnthropic } from '../businesses/shared.js';
import { laDateString } from '../sales/laDate.js';
import { scrubAddresses } from '../sales/scrubText.js';

export const PAGELOAD_GUARD_MIN = 60;
export const RUNNING_STALE_MIN = 10;
const KINDS = new Set(['cold', 'bump', 'final', 'reply']);
const EMAIL_KINDS_AFTER = new Set(['bump', 'final', 'reply']);
const DRAFTABLE_STATUS = new Set(['candidate', 'claimed']);
const SETTINGS_DEFAULTS = { bump_after_days: 5, final_after_days: 14, max_email_touches: 3, subject_format: null, banned_phrases: [], members_stat: null, completions_stat: null };
const okUrl = (email, path) => `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#${path}`;

async function settingsOf(supabase, businessId) { const { data } = await supabase.from('hk_settings').select('*').eq('business_id', businessId).maybeSingle(); return { ...SETTINGS_DEFAULTS, ...(data || {}) }; }
async function signatureOf(supabase, businessId, userId) { const { data } = await supabase.from('hk_member_prefs').select('signature_text').eq('business_id', businessId).eq('user_id', userId).maybeSingle(); return data?.signature_text || null; }
async function touchesOf(supabase, businessId, brandId) { const { data, error } = await supabase.from('hk_touches').select('*').eq('business_id', businessId).eq('brand_id', brandId).order('created_at'); if (error) throw new Error(error.message); return data || []; }
async function touchById(supabase, businessId, id) { const { data, error } = await supabase.from('hk_touches').select('*').eq('business_id', businessId).eq('id', id).maybeSingle(); if (error) throw new Error(error.message); if (!data) throw new HkError(404, 'draft not found'); return data; }
export const deps0 = d => ({ supabase: d.supabase || getSupabase(), gmail: d.gmail || gmailClient(), mailbox: d.mailbox || mailboxFor, tokenFor: d.tokenFor || tokenForMailbox, tokenForGrant: d.tokenForGrant || accessTokenForGrant, flag: d.flag || flagReconnect, call: d.call || callAnthropic, now: d.now || (() => new Date()) });

// The draft builder the composer route and the daily-check job share (hkos-daily-check-v1 J1c). Validates, runs the
// verdict + lint, reads To from hk_contacts, threads a follow-up, saves the draft on the mailbox D.mailbox resolves for
// this user, writes the touch, patches the brand, logs the event. tokenFor() returns the token or null (the caller has
// already answered). createdBy 'user' | 'claude' | 'system'. -> { touch, draft, verdict, mailboxEmail } | null
export async function createDraftFor({ D, businessId, userId: uid, body, tokenFor, createdBy = 'user' }) {
  const { supabase, gmail, mailbox, now } = D;
    const channel = oneOf(body.channel || 'email', new Set(['email', 'ig_dm']), 'channel');
    const kind = oneOf(body.kind || 'cold', KINDS, 'kind');
    if (channel === 'ig_dm' && kind !== 'cold') throw new HkError(400, 'an Instagram DM is a cold touch');
    const subject = channel === 'email' ? text(body.subject, 200, 'subject', { required: true }) : null;
    const bodyMd = text(body.body_markdown, 6000, 'body', { required: true, multiline: true });
    const concept = text(body.challenge_concept, 500, 'challenge concept', { multiline: true });
    const brand = await brandById(supabase, businessId, body.brand_id);
    if (brand.archived_at) throw new HkError(409, 'that brand is archived');
    const settings = await settingsOf(supabase, businessId);
    const touches = await touchesOf(supabase, businessId, brand.id);
    const brands = await liveBrands(supabase, businessId);
    // 1 the verdict - with the warm check (tracked for both founders + one narrow search in the caller's mailbox)
    let token = null, m = null;
    if (channel === 'email') { m = await mailbox(businessId, uid, 'drafts'); token = await tokenFor(); if (!token) return null; }
    const threadsByFounder = await warmThreads({ supabase, businessId, brandId: brand.id, domain: brand.domain, callerUserId: uid, gmail: channel === 'email' ? gmail : null, token });
    const verdict = canContact({ brand, touches, threadsByFounder, senderUserId: uid, kind, sponsorsNiches: sponsorsNichesOf(brands), maxEmailTouches: settings.max_email_touches });
    if (!verdict.ok) throw new HkError(409, verdict.reason === 'warm' ? 'Another founder already has a thread with this brand' : `This brand is blocked: ${verdict.reason}`, { verdict });
    // 2 lint - never saved on a failure
    const problems = lintDraft(subject || '', bodyMd, channel === 'ig_dm' ? 'dm_text' : kind, settings);
    const rejects = lintRejects(problems);
    if (rejects.length) throw new HkError(422, 'The draft fails the outreach rules', { problems });
    let draft = null, contact = null, mailboxEmail = m?.grant?.google_email || null;
    if (channel === 'email') {
      // 3 To from hk_contacts, server-side; thread headers for a follow-up
      if (body.contact_id) { const { data } = await supabase.from('hk_contacts').select('*').eq('business_id', businessId).eq('brand_id', brand.id).eq('id', body.contact_id).maybeSingle(); contact = data || null; }
      else { const { data } = await supabase.from('hk_contacts').select('*').eq('business_id', businessId).eq('brand_id', brand.id); contact = (data || []).find(c => c.is_primary && c.email) || (data || []).find(c => c.email) || (data || [])[0] || null; }
      const omit = body.omit_recipient === true;
      if (!omit && !contact?.email) throw new HkError(409, 'This brand has no contact with an email yet. Add one under Contacts.', { needs_contact: true });
      let threadId = null, inReplyTo = null, references = null, subjectFinal = subject;
      if (EMAIL_KINDS_AFTER.has(kind)) {
        const original = body.reply_to_touch_id ? touches.find(t => t.id === body.reply_to_touch_id) : [...touches].reverse().find(t => t.state === 'sent' && t.gmail_thread_id);
        if (!original?.gmail_thread_id) throw new HkError(409, `A ${kind} needs an earlier sent email on this brand`, { needs_prior_touch: true });
        threadId = original.gmail_thread_id;
        if (original.gmail_message_id) { const msg = await gmail.getMessage(token, original.gmail_message_id).catch(() => null); inReplyTo = msg ? header(msg, 'Message-ID') : null; references = inReplyTo; }
        subjectFinal = replySubject(subject);
      }
      const mime = buildDraftMime({ to: omit ? null : contact.email, subject: subjectFinal, bodyMarkdown: bodyMd, signatureText: await signatureOf(supabase, businessId, uid), inReplyTo, references });
      draft = await gmail.createDraft(token, { raw: mime.raw, threadId });
    }
    // 4 the touch
    const { data: touch, error } = await supabase.from('hk_touches').insert({ business_id: businessId, brand_id: brand.id, contact_id: contact?.id || null, sender_user_id: uid, channel, kind, subject, body_text: bodyMd, body_html: draft ? buildDraftMime({ subject: subject || '', bodyMarkdown: bodyMd }).html : null, challenge_concept: concept, gmail_draft_id: draft?.id || null, gmail_thread_id: draft?.message?.threadId || null, gmail_message_id: draft?.message?.id || null, state: 'drafted', drafted_at: now().toISOString(), lint_passed: true, created_by: createdBy }).select().single();
    if (error) throw error;
    // 5 the brand: claim if unclaimed, status drafted from candidate / claimed
    const patch = { updated_at: now().toISOString() };
    if (!brand.owner_user_id) patch.owner_user_id = uid;
    if (DRAFTABLE_STATUS.has(brand.status)) patch.status = 'drafted';
    await supabase.from('hk_brands').update(patch).eq('id', brand.id);
    // 6 the event - no address, no body
    await logEvent(supabase, { businessId, actorUserId: uid, actorKind: createdBy === 'user' ? 'user' : createdBy, entityType: 'brand', entityId: brand.id, action: 'draft_created', detail: { touch_id: touch.id, kind, channel, subject: subject || null, claimed: !brand.owner_user_id, no_recipient: channel === 'email' && !contact?.email } });
    return { touch, draft, verdict, mailboxEmail };
}

// POST /drafts  { brand_id, contact_id?, channel 'email'|'ig_dm', kind, subject, body_markdown, challenge_concept?, reply_to_touch_id?, omit_recipient? }
export async function createDraftRoute(req, res, d = {}) {
  const D = deps0(d);
  const businessId = req.params.businessId, uid = me(req), body = req.body || {};
  try {
    const out = await createDraftFor({ D, businessId, userId: uid, body, tokenFor: () => D.tokenFor(req, res, businessId, 'drafts'), createdBy: body.created_by === 'claude' ? 'claude' : 'user' });
    if (!out) return;
    const { touch, draft, verdict, mailboxEmail } = out;
    res.status(201).json({ touch_id: touch.id, touch: touchRow(touch), gmail_draft_url: draft?.message?.id && mailboxEmail ? draftUrl(mailboxEmail, draft.message.id) : null, warnings: verdict.warnings });
  } catch (e) { fail(res, e, 'drafts/create'); }
}

// GET /drafts - every drafted touch; Open in Gmail only for the caller's own (their mailbox address lives in that URL).
export async function listDraftsRoute(req, res, d = {}) {
  const { supabase, mailbox, now } = deps0(d);
  const businessId = req.params.businessId, uid = me(req), q = req.query || {};
  try {
    // grow-nav-filters S5: owner (the brand's owner) · kind (channel) · lint · older_than days - all optional.
    const owner = ownerParam(q.owner), kind = oneOf(q.kind || null, new Set(['email', 'ig_dm']), 'kind'), lint = oneOf(q.lint || null, new Set(['failed', 'passed']), 'lint');
    const older = q.older_than == null || q.older_than === '' ? null : Number(q.older_than);
    if (older != null && (!Number.isInteger(older) || older < 0 || older > 365)) throw new HkError(400, 'older_than must be 0 to 365 days');
    const { data: all, error } = await supabase.from('hk_touches').select('*').eq('business_id', businessId).eq('state', 'drafted').order('drafted_at', { ascending: false });
    if (error) throw new Error(error.message);
    const brands = Object.fromEntries((await liveBrands(supabase, businessId)).map(b => [b.id, b]));
    const nowMs = now().getTime();
    const touches = (all || []).filter(t => ownedBy(owner, brands[t.brand_id]?.owner_user_id, uid) && (!kind || t.channel === kind) && (!lint || (lint === 'failed' ? t.lint_passed === false : t.lint_passed !== false))
      && (older == null || nowMs - Date.parse(t.drafted_at || t.created_at) > older * 86400e3));
    const cids = [...new Set((touches || []).map(t => t.contact_id).filter(Boolean))];
    const contacts = Object.fromEntries((await selectIn(() => supabase.from('hk_contacts').select('id, name').order('id'), 'id', cids)).map(c => [c.id, c.name]));
    const m = await mailbox(businessId, uid, 'drafts').catch(() => null);
    const own = m?.grant?.google_email || null;
    res.json({ drafts: (touches || []).map(t => ({ ...touchRow(t), brand_name: brands[t.brand_id]?.name || null, brand_owner_user_id: brands[t.brand_id]?.owner_user_id || null, brand_owner_hint: brands[t.brand_id]?.owner_hint || null, contact_name: contacts[t.contact_id] || null, age_days: Math.floor((nowMs - Date.parse(t.drafted_at || t.created_at)) / 86400e3), mine: t.sender_user_id === uid, gmail_draft_url: t.sender_user_id === uid && own && t.gmail_message_id ? draftUrl(own, t.gmail_message_id) : null })) });
  } catch (e) { fail(res, e, 'drafts/list'); }
}

// GET /drafts/:touchId - subject + body text, never To.
export async function previewDraftRoute(req, res, d = {}) {
  const { supabase } = deps0(d);
  try { const t = await touchById(supabase, req.params.businessId, req.params.touchId); res.json({ touch: { ...touchRow(t), body_text: t.body_text } }); } catch (e) { fail(res, e, 'drafts/preview'); }
}

// POST /drafts/lint { subject, body_markdown, kind, channel } - the composer's Run lint: rules only, nothing saved, no Gmail.
export async function lintPreviewRoute(req, res, d = {}) {
  const { supabase } = deps0(d);
  try {
    const b = req.body || {};
    const channel = oneOf(b.channel || 'email', new Set(['email', 'ig_dm']), 'channel');
    const kind = oneOf(b.kind || 'cold', KINDS, 'kind');
    const problems = lintDraft(String(b.subject || ''), String(b.body_markdown || ''), channel === 'ig_dm' ? 'dm_text' : kind, await settingsOf(supabase, req.params.businessId));
    res.json({ problems, lint_passed: !lintRejects(problems).length });
  } catch (e) { fail(res, e, 'drafts/lint-preview'); }
}

// POST /drafts/:touchId/lint - re-run the rules on the stored text (no Gmail).
export async function relintDraftRoute(req, res, d = {}) {
  const { supabase } = deps0(d);
  const businessId = req.params.businessId;
  try {
    const t = await touchById(supabase, businessId, req.params.touchId);
    const problems = lintDraft(t.subject || '', t.body_text || '', t.kind, await settingsOf(supabase, businessId));
    const passed = !lintRejects(problems).length;
    await supabase.from('hk_touches').update({ lint_passed: passed }).eq('id', t.id);
    res.json({ problems, lint_passed: passed });
  } catch (e) { fail(res, e, 'drafts/lint'); }
}

// DELETE /drafts/:touchId - the draft in Gmail (DELETE /drafts/<id>, never a send), the touch discarded, the brand back
// to claimed when nothing else is live. The touch's sender or an owner-role member.
export async function discardDraftRoute(req, res, d = {}) {
  const { supabase, gmail, tokenFor, now } = deps0(d);
  const businessId = req.params.businessId, uid = me(req);
  try {
    const t = await touchById(supabase, businessId, req.params.touchId);
    if (t.state !== 'drafted') throw new HkError(409, `that touch is ${t.state}, not a draft`);
    if (t.sender_user_id !== uid && !isOwner(req)) throw new HkError(403, 'only the sender or an owner-role member can discard this draft');
    if (t.gmail_draft_id && t.channel === 'email') {
      const token = await tokenFor(req, res, businessId, 'drafts'); if (!token) return;
      try { await gmail.deleteDraft(token, t.gmail_draft_id); } catch (e) { if (!(e instanceof GmailError && e.status === 404)) throw e; }
    }
    await supabase.from('hk_touches').update({ state: 'discarded' }).eq('id', t.id);
    const brand = await brandById(supabase, businessId, t.brand_id);
    const others = (await touchesOf(supabase, businessId, brand.id)).filter(x => x.id !== t.id && x.state !== 'discarded');
    if (brand.status === 'drafted' && !others.length) await supabase.from('hk_brands').update({ status: 'claimed', updated_at: now().toISOString() }).eq('id', brand.id);
    await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'brand', entityId: brand.id, action: 'draft_discarded', detail: { touch_id: t.id, kind: t.kind, channel: t.channel } });
    res.json({ ok: true });
  } catch (e) { fail(res, e, 'drafts/discard'); }
}

// Pageload guard (G5.1): skip when a good run finished under PAGELOAD_GUARD_MIN ago or any run started < 10 min ago.
export function pageloadSkip(runs, nowMs) {
  const recent = runs.filter(r => nowMs - Date.parse(r.started_at) < PAGELOAD_GUARD_MIN * 60e3);
  if (recent.some(r => ['ok', 'partial'].includes(r.status) && r.finished_at)) return `synced under ${PAGELOAD_GUARD_MIN} min ago`;
  if (runs.some(r => !r.finished_at && nowMs - Date.parse(r.started_at) < RUNNING_STALE_MIN * 60e3)) return 'a sync started in the last 10 min';
  return null;
}

// One mailbox's sync, shared by the route and the gmail-sync-all job (hkos-daily-check-v1 J1). m = the resolved
// mailbox ({ grant, tether, state ok }). Writes hk_gmail_sync_state + an hk_sync_runs row, logs sends / replies, labels
// replies (daily cap). -> { status: 'running' } | { status: 'needs_reconnect', run_id } | { status: 'ok', run, history_id };
// any other failure is written to the run row and rethrown.
export async function runMailboxSync({ D, businessId, userId: uid, m, trigger }) {
  const { supabase, gmail, tokenForGrant, flag, call, now } = D;
  const nowIso = () => now().toISOString();
    const { data: state0 } = await supabase.from('hk_gmail_sync_state').select('*').eq('business_id', businessId).eq('user_id', uid).maybeSingle();
    if (state0?.status === 'running' && now().getTime() - Date.parse(state0.updated_at) < RUNNING_STALE_MIN * 60e3) return { status: 'running' };
    await supabase.from('hk_gmail_sync_state').upsert({ business_id: businessId, user_id: uid, grant_id: m.grant.id, status: 'running', updated_at: nowIso() }, { onConflict: 'business_id,user_id' });
    const { data: run } = await supabase.from('hk_sync_runs').insert({ business_id: businessId, user_id: uid, trigger, started_at: nowIso(), status: 'ok' }).select().single();
    const finish = async (status, countsObj, error = null, stateExtra = {}) => {
      await supabase.from('hk_sync_runs').update({ finished_at: nowIso(), status, counts: countsObj || {}, error: error ? scrubAddresses(String(error)).slice(0, 200) : null }).eq('id', run.id);
      await supabase.from('hk_gmail_sync_state').update({ status: stateExtra.status || (status === 'error' ? 'error' : 'ok'), last_error: error ? scrubAddresses(String(error)).slice(0, 200) : null, updated_at: nowIso(), ...stateExtra.fields }).eq('business_id', businessId).eq('user_id', uid);
    };
    let token;
    try { token = await tokenForGrant(m.grant, 'gmail'); }
    catch (e) { await finish('error', {}, 'Gmail needs reconnect', { status: 'needs_reconnect' }); return { status: 'needs_reconnect', run_id: run.id }; }
    try {
      const { data: tracked } = await supabase.from('hk_touches').select('*').eq('business_id', businessId).eq('sender_user_id', uid).neq('state', 'discarded').not('gmail_thread_id', 'is', null);
      const touches = tracked || [];
      const messages = []; let historyEvents = 0, full = false, scanned = 0;
      if (state0?.history_id) {
        try {
          const h = await gmail.listHistory(token, state0.history_id);
          historyEvents = h.history.length;
          const ids = new Map();
          for (const ev of h.history) for (const a of ev.messagesAdded || []) { const msg = a.message; if (msg && (msg.labelIds || []).some(l => l === 'SENT' || l === 'INBOX')) ids.set(msg.id, msg); }
          for (const id of [...ids.keys()].slice(0, 300)) { const msg = await gmail.getMessage(token, id); messages.push(toMeta(msg)); scanned++; }
        } catch (e) { if (e instanceof GmailError && e.status === 404) full = true; else throw e; }
      } else full = true;
      if (full) {
        for (const threadId of [...new Set(touches.map(t => t.gmail_thread_id))].slice(0, 100)) { const th = await gmail.getThread(token, threadId).catch(e => { if (e instanceof GmailError && e.status === 404) return null; throw e; }); for (const msg of th?.messages || []) { messages.push(toMeta(msg)); scanned++; } }
      }
      const drafts = await gmail.listDrafts(token);
      const profile = await gmail.getProfile(token);
      const brands = await liveBrands(supabase, businessId);
      const brandsByDomain = Object.fromEntries(brands.filter(b => b.domain).map(b => [b.domain, b.id]));
      const { data: known } = await supabase.from('hk_replies').select('gmail_message_id').eq('business_id', businessId);
      const ownDomains = [...TEAM_DOMAINS, (m.grant.google_email || '').split('@')[1]].filter(Boolean);
      const c = classify({ touches, replies: known || [], messages, drafts, brandsByDomain, ownDomains, historyEvents: state0?.history_id ? historyEvents : messages.length });
      const settings = await settingsOf(supabase, businessId);
      const byId = Object.fromEntries(brands.map(b => [b.id, b]));
      for (const s of c.sent) {
        await supabase.from('hk_touches').update({ state: 'sent', sent_at: s.sent_at, gmail_message_id: s.message.id }).eq('id', s.touch.id);
        const b = byId[s.touch.brand_id];
        if (b) { const patch = { last_touch_at: s.sent_at, next_due_at: nextDueAt(s.touch.kind, s.sent_at, settings), updated_at: nowIso() }; if (s.status && ['candidate', 'claimed', 'drafted', 'sent', 'bumped'].includes(b.status)) patch.status = s.status; await supabase.from('hk_brands').update(patch).eq('id', b.id); }
        await logEvent(supabase, { businessId, actorUserId: uid, actorKind: 'system', entityType: 'brand', entityId: s.touch.brand_id, action: 'touch_sent', detail: { touch_id: s.touch.id, kind: s.touch.kind } });
      }
      const today = laDateString(now());
      const { data: labeledToday } = await supabase.from('hk_events').select('id, detail, created_at').eq('business_id', businessId).eq('action', 'reply_logged');
      let labelsToday = (labeledToday || []).filter(e => e.detail?.labeled && laDateString(new Date(e.created_at)) === today).length, labelsCalled = 0;
      const storeReply = async ({ brand_id, touch, message }, { label = null, summary = null, urgent = false, labeled = false }) => {
        const { data: row, error } = await supabase.from('hk_replies').insert({ business_id: businessId, brand_id, touch_id: touch?.id || null, gmail_message_id: message.id, gmail_thread_id: message.threadId, from_name: message.from?.name || null, from_domain: message.from?.domain || null, from_email: message.from?.email || null, received_at: message.date, label, summary: summary || snippetOf(message.snippet), urgent, handled: false }).select().single();
        if (error) { if (error.code === '23505') return null; throw error; }
        await logEvent(supabase, { businessId, actorUserId: uid, actorKind: 'system', entityType: 'brand', entityId: brand_id, action: 'reply_logged', detail: { reply_id: row.id, label, urgent, labeled, touch_id: touch?.id || null } });
        const kind = replyKind(label);
        if (kind) await signalNow(supabase, { businessId, kind, brandId: brand_id, ownerUserId: byId[brand_id]?.owner_user_id, occurredAt: message.date, source: 'sync', refType: 'reply', refId: row.id, detail: `${byId[brand_id]?.name || 'A brand'} ${signalWords(kind)}` }, new Date(nowIso()));
        return row;
      };
      for (const r of c.replies) {
        const b = byId[r.brand_id];
        const lab = await labelReply({ call, supabase, businessId, userId: uid, brandName: b?.name, subject: r.message.subject, snippet: r.message.snippet, labelsToday });
        if (lab.labeled) { labelsToday++; labelsCalled++; }
        const row = await storeReply(r, lab);
        if (row && b && ['drafted', 'sent', 'bumped', 'final_sent', 'claimed'].includes(b.status)) await supabase.from('hk_brands').update({ status: 'replied', next_due_at: null, updated_at: nowIso() }).eq('id', b.id);
      }
      for (const n of c.newThreads) await storeReply({ brand_id: n.brand_id, touch: null, message: n.message }, { label: 'new_thread', summary: snippetOf(n.message.snippet), urgent: false, labeled: false });
      const countsObj = runCounts(c, { labels_called: labelsCalled, messages_scanned: scanned, full_scan: full });
      await finish('ok', countsObj, null, { fields: { history_id: profile?.historyId ? String(profile.historyId) : state0?.history_id || null, last_synced_at: nowIso(), ...(full ? { last_full_scan_at: nowIso() } : {}) } });
      return { status: 'ok', run: { id: run.id, trigger, status: 'ok', counts: countsObj, started_at: run.started_at, finished_at: nowIso() }, history_id: profile?.historyId ? String(profile.historyId) : null };
    } catch (e) {
      if ((e instanceof GmailError && e.status === 401) || (e instanceof NeedsGoogle)) { await flag(m.grant.id); await finish('error', {}, 'Gmail needs reconnect', { status: 'needs_reconnect' }); return { status: 'needs_reconnect', run_id: run.id }; }
      await finish('error', {}, e.message);
      throw e;
    }
}

// POST /sync?trigger=manual|pageload - the CALLER's tethered mailbox only.
export async function syncRoute(req, res, d = {}) {
  const D = deps0(d);
  const { supabase, mailbox, now } = D;
  const businessId = req.params.businessId, uid = me(req);
  const trigger = req.query?.trigger === 'pageload' ? 'pageload' : req.query?.trigger === 'test' ? 'test' : 'manual';
  try {
    const m = await mailbox(businessId, uid, 'drafts');
    if (!m) return res.status(409).json({ error: 'Link your HumanKind Gmail on Connections first', needs_mailbox: 'drafts' });
    if (m.state === RECONNECT) return res.status(409).json({ error: 'Reconnect your HumanKind Gmail', needs_reconnect: m.grant.id, email: m.grant.google_email });
    const { data: runs } = await supabase.from('hk_sync_runs').select('trigger, status, started_at, finished_at').eq('business_id', businessId).eq('user_id', uid).order('started_at', { ascending: false }).limit(20);
    if (trigger === 'pageload') { const skip = pageloadSkip(runs || [], now().getTime()); if (skip) return res.json({ skipped: skip }); }
    const out = await runMailboxSync({ D, businessId, userId: uid, m, trigger });
    if (out.status === 'running') return res.status(409).json({ error: 'A sync is already running', running: true });
    if (out.status === 'needs_reconnect') return res.status(409).json({ error: 'Reconnect your HumanKind Gmail', needs_reconnect: m.grant.id, email: m.grant.google_email, run_id: out.run_id });
    res.json({ run: out.run, history_id: out.history_id });
  } catch (e) { fail(res, e, 'sync'); }
}

// GET /replies?handled=&label=&owner=&from=&to= - replyRow strips from_email; Open in Gmail only for the caller's own mailbox.
export async function listRepliesRoute(req, res, d = {}) {
  const { supabase, mailbox, now } = deps0(d);
  const businessId = req.params.businessId, uid = me(req), q = req.query || {};
  try {
    const { data, error } = await supabase.from('hk_replies').select('*').eq('business_id', businessId).order('received_at', { ascending: false });
    if (error) throw new Error(error.message);
    let rows = data || [];
    const handled = q.handled === 'all' ? null : q.handled === 'true';
    if (handled !== null) rows = rows.filter(r => !!r.handled === handled);
    if (q.label) rows = rows.filter(r => r.label === q.label);
    if (q.from) rows = rows.filter(r => r.received_at >= String(q.from));
    if (q.to) rows = rows.filter(r => r.received_at <= String(q.to));
    // grow-nav-filters S5: snoozed=hide (Open) | only (Snoozed); absent = as before.
    const snoozed = oneOf(q.snoozed || null, new Set(['hide', 'only']), 'snoozed'), nowIso = now().toISOString();
    if (snoozed) rows = rows.filter(r => (!!r.snoozed_until && String(r.snoozed_until) > nowIso) === (snoozed === 'only'));
    const brands = Object.fromEntries((await liveBrands(supabase, businessId)).map(b => [b.id, b]));
    if (q.owner === 'me') rows = rows.filter(r => brands[r.brand_id]?.owner_user_id === uid); else if (q.owner && q.owner !== 'all') rows = rows.filter(r => brands[r.brand_id]?.owner_user_id === q.owner);
    const tids = [...new Set(rows.map(r => r.touch_id).filter(Boolean))];
    const touches = Object.fromEntries((await selectIn(() => supabase.from('hk_touches').select('id, sender_user_id, kind, subject').order('id'), 'id', tids)).map(t => [t.id, t]));
    const m = await mailbox(businessId, uid, 'drafts').catch(() => null);
    const own = m?.grant?.google_email || null;
    res.json({ replies: rows.map(r => { const t = touches[r.touch_id]; const mine = t ? t.sender_user_id === uid : false; return { ...replyRow(r), urgent: !!r.urgent, brand_name: brands[r.brand_id]?.name || null, brand_owner_user_id: brands[r.brand_id]?.owner_user_id || null, brand_owner_hint: brands[r.brand_id]?.owner_hint || null, brand_status: brands[r.brand_id]?.status || null, sender_user_id: t?.sender_user_id || null, touch_kind: t?.kind || null, mine, open_url: mine && own && r.gmail_message_id ? okUrl(own, `all/${encodeURIComponent(r.gmail_message_id)}`) : null }; }) });
  } catch (e) { fail(res, e, 'replies/list'); }
}

// PATCH /replies/:id  { label?, handled?, snoozed_until? } - overrides are logged.
export async function patchReplyRoute(req, res, d = {}) {
  const { supabase, now } = deps0(d);
  const businessId = req.params.businessId, uid = me(req), body = req.body || {};
  try {
    const { data: r, error } = await supabase.from('hk_replies').select('*').eq('business_id', businessId).eq('id', req.params.id).maybeSingle();
    if (error) throw new Error(error.message); if (!r) throw new HkError(404, 'reply not found');
    const patch = {}; const events = [];
    if ('label' in body) { const label = oneOf(body.label, new Set(['interested', 'pricing', 'referral', 'decline', 'auto_reply', 'prefers_email', 'new_thread', 'other']), 'label'); if (label !== r.label) { patch.label = label; patch.label_overridden_by = uid; patch.urgent = label === 'pricing' || label === 'interested'; events.push(['reply_label_override', { reply_id: r.id, from: r.label, to: label }]); } }
    if ('handled' in body) { const h = body.handled === true; patch.handled = h; patch.handled_by = h ? uid : null; patch.handled_at = h ? now().toISOString() : null; events.push([h ? 'reply_handled' : 'reply_reopened', { reply_id: r.id }]); }
    if ('snoozed_until' in body) { const v = body.snoozed_until; if (v !== null && Number.isNaN(Date.parse(v))) throw new HkError(400, 'snoozed_until must be a date'); patch.snoozed_until = v; events.push(['reply_snoozed', { reply_id: r.id, until: v }]); }
    if (!Object.keys(patch).length) return res.json({ reply: replyRow(r), changed: [] });
    const { data: row, error: e2 } = await supabase.from('hk_replies').update(patch).eq('id', r.id).select().single();
    if (e2) throw e2;
    for (const [action, detail] of events) await logEvent(supabase, { businessId, actorUserId: uid, entityType: 'brand', entityId: r.brand_id, action, detail });
    res.json({ reply: replyRow(row), changed: Object.keys(patch) });
  } catch (e) { fail(res, e, 'replies/patch'); }
}

// GET /gmail/status - the caller's mailbox state, their last run, and the nav badges.
export async function gmailStatusRoute(req, res, d = {}) {
  const { supabase, mailbox, now } = deps0(d);
  const businessId = req.params.businessId, uid = me(req);
  try {
    const m = await mailbox(businessId, uid, 'drafts').catch(() => null);
    const { data: runs } = await supabase.from('hk_sync_runs').select('id, trigger, status, started_at, finished_at, counts, error').eq('business_id', businessId).eq('user_id', uid).order('started_at', { ascending: false }).limit(1);
    const { data: state } = await supabase.from('hk_gmail_sync_state').select('status, last_synced_at, history_id').eq('business_id', businessId).eq('user_id', uid).maybeSingle();
    // grow-nav-filters S4: ?owner=me|all|<id> counts queued drafts and OPEN (unsnoozed) replies on that owner's brands;
    // without it the badges are workspace-wide, as before.
    const owner = ownerParam(req.query?.owner);
    let { data: drafts } = await supabase.from('hk_touches').select(owner ? 'id, brand_id' : 'id').eq('business_id', businessId).eq('state', 'drafted');
    let { data: unhandled } = await supabase.from('hk_replies').select(owner ? 'id, brand_id, snoozed_until' : 'id').eq('business_id', businessId).eq('handled', false);
    if (owner) {
      const ownerOf = Object.fromEntries((await liveBrands(supabase, businessId)).map(b => [b.id, b.owner_user_id]));
      const nowIso = now().toISOString();
      drafts = (drafts || []).filter(t => ownedBy(owner, ownerOf[t.brand_id], uid));
      unhandled = (unhandled || []).filter(r => ownedBy(owner, ownerOf[r.brand_id], uid) && !(r.snoozed_until && String(r.snoozed_until) > nowIso));
    }
    const { data: trackedTouches } = await supabase.from('hk_touches').select('gmail_thread_id').eq('business_id', businessId).neq('state', 'discarded').not('gmail_thread_id', 'is', null);
    const { data: trackedReplies } = await supabase.from('hk_replies').select('gmail_thread_id').eq('business_id', businessId);
    const tracked = new Set([...(trackedTouches || []), ...(trackedReplies || [])].map(r => r.gmail_thread_id).filter(Boolean)).size;
    const { data: prefs } = await supabase.from('hk_member_prefs').select('signature_text').eq('business_id', businessId).eq('user_id', uid).maybeSingle();
    res.json({ mailbox: m ? { linked: true, state: m.state, email: m.grant.google_email, purposes: m.tether.purposes } : { linked: false, state: null, email: null, purposes: [] }, last_run: runs?.[0] || null, sync_state: state || null, badges: { drafts: (drafts || []).length, replies: (unhandled || []).length, tracked, ...(owner ? { owner } : {}) }, signature_text: prefs?.signature_text || null });
  } catch (e) { fail(res, e, 'gmail/status'); }
}

// PATCH /gmail/signature { signature_text } - the caller's own plain-text sign-off (<= 400, no address or phone).
export async function patchSignatureRoute(req, res, d = {}) {
  const { supabase, now } = deps0(d);
  const businessId = req.params.businessId, uid = me(req);
  try {
    const sig = text(req.body?.signature_text, 400, 'signature', { multiline: true });
    const { error } = await supabase.from('hk_member_prefs').upsert({ business_id: businessId, user_id: uid, signature_text: sig, updated_at: now().toISOString() }, { onConflict: 'business_id,user_id' });
    if (error) throw error;
    res.json({ signature_text: sig });
  } catch (e) { fail(res, e, 'gmail/signature'); }
}
