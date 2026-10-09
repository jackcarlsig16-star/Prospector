// microsoft-connect-v1 Stage 2 - the Outlook read layer. Graph delta queries
// over Sent Items, Inbox and the calendar, per signed-in person; metadata
// only (no body is ever selected), external counterparts only, capped per
// run, every run written to microsoft_sync_runs as counts.
import { getServiceSupabase } from '../lib/authUser.js';
import { accessTokenFor, getGrant } from '../lib/microsoftGrants.js';
import { runDailyOutlookMoves } from '../sales/partnerOutlookTouches.js';
import { businessFeatureOn } from '../lib/outlookFeatures.js';
import { runOutlookReplyTimes } from '../sales/outlookReplyTimes.js';

export const GRAPH_URL = () => process.env.MICROSOFT_GRAPH_URL || 'https://graph.microsoft.com/v1.0';
export const BACKFILL_DAYS = 90;
export const CALENDAR_BACK_DAYS = 30;
export const CALENDAR_FORWARD_DAYS = 60;
export const PAGE_SIZE = 50;
export const CAPS = { sentitems: 500, inbox: 500, calendar: 200 };
export const FOLDERS = ['sentitems', 'inbox', 'calendar'];
export const PIGGYBACK_MIN_MS = 60 * 60e3;
// Jack, 2026-10-08: own domains = every sales_mailbox_owners address plus
// these two, so the .ai -> .io move changes nothing here.
export const OWN_DOMAINS = ['homelover.ai', 'homelover.io'];
export const CONSUMER_DOMAINS = ['gmail.com', 'googlemail.com', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com'];
const CONSUMER_PREFIXES = ['yahoo.', 'hotmail.'];
const MESSAGE_SELECT = 'id,internetMessageId,conversationId,subject,sentDateTime,receivedDateTime,from,toRecipients,ccRecipients,isDraft';

export const domainOf = email => { const at = String(email || '').toLowerCase().lastIndexOf('@'); return at > 0 ? email.toLowerCase().slice(at + 1).trim() : ''; };
export const isConsumerDomain = d => CONSUMER_DOMAINS.includes(d) || CONSUMER_PREFIXES.some(p => d.startsWith(p));

export function ownership(ownerAddresses) {
  const addresses = new Set(ownerAddresses.map(a => a.toLowerCase()));
  const domains = new Set([...OWN_DOMAINS, ...ownerAddresses.map(domainOf).filter(Boolean)]);
  return { isOwn: email => addresses.has(String(email || '').toLowerCase()) || domains.has(domainOf(email)) };
}

const address = r => String(r?.emailAddress?.address || '').toLowerCase().trim();
const displayName = r => { const n = String(r?.emailAddress?.name || '').trim(); return n && n.toLowerCase() !== address(r) ? n.slice(0, 120) : ''; };

// Keeps the external side of a message, or says why it's skipped. The folder
// decides the direction: what sits in Sent Items was sent by this mailbox.
// Names ride in the same order as the emails; a name that is just the
// address again is stored as ''.
function externals(participants, own) {
  const byEmail = new Map();
  for (const r of participants) { const e = address(r); if (e.includes('@') && !own.isOwn(e) && !byEmail.has(e)) byEmail.set(e, displayName(r)); }
  const emails = [...byEmail.keys()];
  if (!emails.length) return { skip: 'internal' };
  const domains = [...new Set(emails.map(domainOf))];
  if (domains.every(isConsumerDomain)) return { skip: 'personal' };
  return { emails, names: emails.map(e => byEmail.get(e)), domains };
}

export function classifyMessage(m, { folder, own }) {
  if (m.isDraft) return { skip: 'draft' };
  const ext = externals([m.from, ...(m.toRecipients || []), ...(m.ccRecipients || [])], own);
  if (ext.skip) return ext;
  const direction = folder === 'sentitems' ? 'sent' : 'received';
  return { row: {
    graph_id: m.id, internet_message_id: m.internetMessageId || null, conversation_id: m.conversationId || null, direction,
    external_emails: ext.emails, external_names: ext.names, external_domains: ext.domains, subject: subjectOf(m.subject),
    occurred_at: direction === 'sent' ? (m.sentDateTime || m.receivedDateTime) : (m.receivedDateTime || m.sentDateTime),
  } };
}

// Graph gives event times as a naive dateTime in the Prefer'd zone (UTC here).
const utc = t => new Date(String(t?.dateTime || '').slice(0, 23) + 'Z').toISOString();
const subjectOf = s => (s == null ? null : String(s).slice(0, 500));

export function classifyEvent(e, { own }) {
  const ext = externals([e.organizer, ...(e.attendees || [])], own);
  if (ext.skip) return ext;
  return { row: {
    graph_id: e.id, ical_uid: e.iCalUId || null, organizer_email: address(e.organizer) || null,
    external_emails: ext.emails, external_names: ext.names, external_domains: ext.domains, subject: subjectOf(e.subject),
    start_at: utc(e.start), end_at: utc(e.end), is_cancelled: !!e.isCancelled,
    // Stage 4b: when the meeting was put on the calendar ("booked").
    created_at_graph: e.createdDateTime ? new Date(e.createdDateTime).toISOString() : null,
  } };
}

export function startUrl(folder, now = new Date()) {
  const base = GRAPH_URL();
  if (folder === 'calendar') {
    const from = new Date(now.getTime() - CALENDAR_BACK_DAYS * 864e5).toISOString();
    const to = new Date(now.getTime() + CALENDAR_FORWARD_DAYS * 864e5).toISOString();
    return `${base}/me/calendarView/delta?startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}`;
  }
  const since = new Date(now.getTime() - BACKFILL_DAYS * 864e5).toISOString();
  // Page size comes from the Prefer header only: a $top on the initial delta
  // request made Graph end the round after one page (prod, 2026-10-08: 50
  // seen per folder, then a deltaLink).
  return `${base}/me/mailFolders/${folder}/messages/delta?$select=${MESSAGE_SELECT}&$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}`;
}

// supabase-js throws (not returns) on a dropped socket; one retry covers the
// keep-alive resets seen mid-run, a second failure is a real outage.
async function upsertRows(supabase, table, rows) {
  for (let attempt = 0; ; attempt++) {
    try {
      const { error } = await supabase.from(table).upsert(rows, { onConflict: 'user_id,graph_id' });
      if (error) throw new Error(error.message);
      return;
    } catch (err) {
      if (attempt > 0 || !/fetch failed/i.test(String(err.message || err))) throw err;
    }
  }
}

async function getPage(url, token, fetchImpl) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Prefer: `odata.maxpagesize=${PAGE_SIZE}, outlook.timezone="UTC"` } });
    if (r.status === 429 && attempt < 3) { await new Promise(res => setTimeout(res, Number(r.headers.get('retry-after') || 2) * 1000)); continue; }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Microsoft Graph ${r.status}: ${data.error?.code || 'request failed'}`);
    return data;
  }
}

// One folder, one run row. Reads from the stored delta/next link (or the
// backfill start), classifies each item, upserts the kept rows, and stores
// where to resume: the nextLink when capped, the deltaLink when finished.
export async function syncFolder({ supabase, userId, businessId, mailbox, folder, token, own, dryRun = false, trigger, now = new Date(), fetchImpl = fetch }) {
  const t0 = Date.now();
  const counts = { pages: 0, seen: 0, stored: 0, skipped_draft: 0, skipped_internal: 0, skipped_personal: 0, capped: false };
  const { data: run, error: runErr } = await supabase.from('microsoft_sync_runs')
    .insert({ business_id: businessId, user_id: userId, folder, trigger, dry_run: dryRun }).select('id').single();
  if (runErr) throw new Error(runErr.message);
  const finish = async patch => {
    await supabase.from('microsoft_sync_runs').update({ ...counts, ...patch, duration_ms: Date.now() - t0, finished_at: new Date().toISOString() }).eq('id', run.id);
    console.log(`[microsoft/sync] user=${userId} folder=${folder} trigger=${trigger}${dryRun ? ' dry' : ''} pages=${counts.pages} seen=${counts.seen} stored=${counts.stored} skipped draft=${counts.skipped_draft} internal=${counts.skipped_internal} personal=${counts.skipped_personal} capped=${counts.capped ? 'yes' : 'no'}${patch.error ? ' error=' + patch.error : ''} ${Date.now() - t0}ms`);
    return { folder, ...counts, error: patch.error || null };
  };
  try {
    const { data: state } = await supabase.from('microsoft_sync_state').select('delta_link, account_email, backfill_from').eq('user_id', userId).eq('folder', folder).maybeSingle();
    // A reconnect to another account must not continue the old mailbox's delta.
    const resume = state && state.account_email === mailbox ? state.delta_link : null;
    const backfillFrom = resume ? state.backfill_from : new Date(now.getTime() - (folder === 'calendar' ? CALENDAR_BACK_DAYS : BACKFILL_DAYS) * 864e5).toISOString();
    let url = resume || startUrl(folder, now), deltaLink = null, nextLink = null;
    const table = folder === 'calendar' ? 'microsoft_events' : 'microsoft_messages';
    const classify = folder === 'calendar' ? e => classifyEvent(e, { own }) : m => classifyMessage(m, { folder, own });
    while (url) {
      const page = await getPage(url, token, fetchImpl);
      counts.pages++;
      const rows = [];
      for (const item of page.value || []) {
        counts.seen++;
        if (item['@removed']) continue;
        const c = classify(item);
        if (c.skip) counts[`skipped_${c.skip}`]++;
        else rows.push({ business_id: businessId, user_id: userId, mailbox_email: mailbox, synced_at: new Date().toISOString(), ...c.row });
      }
      if (rows.length && !dryRun) await upsertRows(supabase, table, rows);
      counts.stored += dryRun ? 0 : rows.length;
      nextLink = page['@odata.nextLink'] || null;
      deltaLink = page['@odata.deltaLink'] || null;
      url = nextLink;
      if (url && counts.seen >= CAPS[folder]) { counts.capped = true; break; }
    }
    if (!dryRun) {
      const { error } = await supabase.from('microsoft_sync_state').upsert({
        user_id: userId, folder, account_email: mailbox, delta_link: counts.capped ? nextLink : deltaLink,
        backfill_from: backfillFrom, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,folder' });
      if (error) throw new Error(error.message);
    }
    return finish({});
  } catch (err) {
    return finish({ error: String(err.message || err).slice(0, 500) });
  }
}

// Which workspace this person's mailbox belongs to, and whose addresses count
// as our own there. The grant is per user; the mailbox owner map is the only
// link from an address to a workspace, so an unmapped mailbox is refused.
export async function resolveMailbox(supabase, userId, businessId) {
  const grant = await getGrant(userId);
  if (!grant) return { refused: 'needs_microsoft', message: 'Connect Microsoft to use this' };
  if (grant.error) return { refused: 'needs_microsoft', message: grant.error };
  const { data: owners, error } = await supabase.from('sales_mailbox_owners').select('business_id, mailbox_email, user_id');
  if (error) throw new Error(error.message);
  const mine = owners.filter(o => o.mailbox_email === grant.account_email && (!businessId || o.business_id === businessId));
  if (!mine.length) return { refused: 'mailbox_not_mapped', message: `${grant.account_email} isn't mapped to a workspace mailbox - ask an admin to add it` };
  const biz = mine[0].business_id;
  return { mailbox: grant.account_email, businessId: biz, own: ownership(owners.filter(o => o.business_id === biz).map(o => o.mailbox_email)) };
}

export async function lastRunAt(supabase, userId) {
  const { data } = await supabase.from('microsoft_sync_runs').select('started_at').eq('user_id', userId).eq('dry_run', false).order('started_at', { ascending: false }).limit(1).maybeSingle();
  return data ? Date.parse(data.started_at) : null;
}

// All three folders for one person. Piggyback runs (after Sync now) skip when
// a real run started within the hour; manual and dry runs always go.
export async function runOutlookSync({ userId, businessId, trigger = 'manual', dryRun = false, now = new Date(), fetchImpl = fetch }) {
  const supabase = getServiceSupabase();
  const target = await resolveMailbox(supabase, userId, businessId);
  if (target.refused) return target;
  if (trigger === 'piggyback') {
    const last = await lastRunAt(supabase, userId);
    if (last && now.getTime() - last < PIGGYBACK_MIN_MS) return { refused: 'too_soon', message: 'Outlook synced within the hour' };
  }
  const token = await accessTokenFor(userId);
  const folders = [];
  for (const folder of FOLDERS) {
    folders.push(await syncFolder({ supabase, userId, businessId: target.businessId, mailbox: target.mailbox, folder, token, own: target.own, dryRun, trigger: dryRun ? 'dry_run' : trigger, now, fetchImpl }));
  }
  // Stage 3: the daily step rides on every real sync. Its own failure lands
  // on its run row and in the response, never on the folder syncs.
  let moves = null, replyTimes = null;
  if (!dryRun) {
    try { moves = await runDailyOutlookMoves(supabase, target.businessId, { userId, trigger, now }); }
    catch (err) { moves = { error: String(err.message || err).slice(0, 500) }; console.error('[outlook/moves]', moves.error); }
    // Stage 4a: exact reply times for sequenced prospects, only where the
    // workspace switched it on; its failure stays here too.
    try { if (await businessFeatureOn(supabase, target.businessId, 'outlook_reply_times')) replyTimes = await runOutlookReplyTimes(supabase, target.businessId); }
    catch (err) { replyTimes = { error: String(err.message || err).slice(0, 500) }; console.error('[outlook/reply-times]', replyTimes.error); }
  }
  return { businessId: target.businessId, mailbox: target.mailbox, dry_run: dryRun, folders, moves, reply_times: replyTimes };
}
