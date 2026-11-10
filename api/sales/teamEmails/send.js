import { accessTokenFor, getGrant, canSendTeamEmail, NeedsMicrosoft } from '../../lib/microsoftGrants.js';
import { GRAPH_URL } from '../../microsoft/graphSync.js';
import { cleanText } from '../scrubText.js';
import { laClock } from './scheduler.js';
import { laInstant } from './visitorEmail.js';

// homelover-team-emails-v1 T1 (REV2) - the ONE send path in Prospector (Jack's narrow exception to "never sends from
// Outlook"): two internal emails, to the owner-edited recipient list only, at the sending mailbox's own domain only.
// No caller can name an address - sendTeamEmail refuses any option that isn't in ALLOWED; addresses are read here,
// filtered by domain, capped, and only their COUNT ever leaves this module (logs, rows, replies).
export const KINDS = ['visitor', 'client'];
export const RECONNECT_NOTE = 'Reconnect to allow team emails';
export const MAX_RECIPIENTS = 25;
const FLAG = { visitor: 'visitor_email', client: 'client_alert' };
const ALLOWED = new Set(['kind', 'subject', 'html', 'text', 'slot', 'refId', 'test']);
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const lower = e => String(e || '').trim().toLowerCase();
const firstName = p => String(p?.display_name || '').trim().split(/\s+/)[0] || null;
export const domainOf = a => { const s = lower(a); const i = s.lastIndexOf('@'); return i > 0 ? s.slice(i + 1) : null; };
export const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

export async function loadSettings(supabase, businessId) {
  return must(await supabase.from('sales_team_email_settings').select('business_id, sender_user_id, visitor_on, client_on, client_alert_since, allowed_domains, weekend_on, updated_at').eq('business_id', businessId).maybeSingle());
}

// Every member with a user id: { userId, role, email (profile first, else the invite), firstName }.
export async function loadMembers(supabase, businessId) {
  const rows = must(await supabase.from('business_members').select('user_id, role, email, created_at').eq('business_id', businessId).not('user_id', 'is', null).order('created_at'));
  const ids = rows.map(r => r.user_id);
  const profiles = ids.length ? must(await supabase.from('profiles').select('id, email, display_name').in('id', ids)) : [];
  const byId = new Map(profiles.map(p => [p.id, p]));
  return rows.map(r => ({ userId: r.user_id, role: r.role, email: lower(byId.get(r.user_id)?.email || r.email), firstName: firstName(byId.get(r.user_id)) }));
}

// The sending member: the setting, else the owner. Only a member can send.
export function senderOf(settings, members) {
  const pick = settings?.sender_user_id ? members.find(m => m.userId === settings.sender_user_id) : null;
  return pick || members.find(m => m.role === 'owner') || null;
}

// The domains a recipient may be at: the settings' list, else the sending mailbox's own domain (from its grant).
export const allowedDomains = (settings, grant) => (settings?.allowed_domains?.length ? settings.allowed_domains.map(lower) : [domainOf(grant?.account_email)].filter(Boolean));

export async function liveRecipients(supabase, businessId) {
  return must(await supabase.from('sales_team_email_recipients').select('id, address, visitor_email, client_alert, added_at').eq('business_id', businessId).is('archived_at', null).order('added_at'));
}

// -> { to, dropped (outside the domains), capped (over MAX_RECIPIENTS) }. to never leaves send.js.
async function resolve(supabase, businessId, kind, domains) {
  const ok = new Set(domains);
  const seen = new Set();
  let dropped = 0;
  for (const r of await liveRecipients(supabase, businessId)) {
    if (!r[FLAG[kind]]) continue;
    const a = lower(r.address);
    if (!EMAIL_RE.test(a) || !ok.has(domainOf(a))) { dropped++; continue; }
    seen.add(a);
  }
  const all = [...seen];
  return { to: all.slice(0, MAX_RECIPIENTS), dropped, capped: Math.max(0, all.length - MAX_RECIPIENTS) };
}

// Counts for the Settings screen (no addresses): how many get each email right now.
export async function recipientCounts(supabase, businessId, settings, grant) {
  const domains = allowedDomains(settings, grant);
  const out = {};
  for (const k of KINDS) { const r = await resolve(supabase, businessId, k, domains); out[k] = { count: r.to.length, dropped: r.dropped, capped: r.capped }; }
  return out;
}

function assertAllowed(addresses, domains) {
  const ok = new Set(domains);
  if (addresses.length > MAX_RECIPIENTS) throw new Error(`refused: more than ${MAX_RECIPIENTS} recipients`);
  for (const a of addresses) if (!ok.has(domainOf(a))) throw new Error('refused: a recipient is outside the allowed domain');
}

const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}(?=.)/g, '$&\r\n');
const header = s => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
// One multipart/alternative message (plain text + HTML); Graph's JSON sendMail carries only one body.
function mime({ to, subject, html, text, boundary = `tm_${Date.now().toString(36)}` }) {
  return [
    `To: ${to.join(', ')}`, `Subject: ${header(subject)}`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(html),
    `--${boundary}--`, '',
  ].join('\r\n');
}

const DEPS = { fetch: (...a) => fetch(...a), getGrant, accessTokenFor };

// Rulings Nov 4 (3): a blocked sender (expired grant, no Mail.Send, Graph 401 / 403) leaves at most one needs_reconnect
// row per LA day per sender - the row is the Activity line and what the banner reads.
async function blockedToday(supabase, businessId, senderId, now) {
  const since = new Date(laInstant(laClock(now).date, '00:00')).toISOString();
  return must(await supabase.from('sales_team_email_sends').select('id').eq('business_id', businessId).eq('sender_user_id', senderId).eq('status', 'needs_reconnect').gte('created_at', since).limit(1))[0] || null;
}

// -> { status: sent | failed | needs_reconnect | skipped, recipients (a count), send_id, grant_at, error? }. Every attempt
// is one sales_team_email_sends row (a repeat needs_reconnect the same day reuses that day's row); a failure is never
// retried here. grant_at = the sender grant's connected_at, so a held client alert can wait for a reconnect.
export async function sendTeamEmail(supabase, businessId, opts, deps = DEPS) {
  const extra = Object.keys(opts || {}).filter(k => !ALLOWED.has(k));
  if (extra.length) throw new Error(`sendTeamEmail takes no ${extra.join(', ')} - recipients come from the workspace's list`);
  const { kind, subject, html, text, slot = null, refId = null, test = false } = opts;
  if (!KINDS.includes(kind)) throw new Error(`kind must be ${KINDS.join('|')}`);
  if (!subject || !html || !text) throw new Error('subject, html and text are required');
  const now = deps.now ? deps.now() : Date.now();
  const [settings, members] = await Promise.all([loadSettings(supabase, businessId), loadMembers(supabase, businessId)]);
  const sender = senderOf(settings, members);
  let grantAt = null;
  const log = async (status, n, error = null) => {
    const prior = status === 'needs_reconnect' ? await blockedToday(supabase, businessId, sender.userId, now) : null;
    const row = prior || must(await supabase.from('sales_team_email_sends').insert({
      business_id: businessId, kind, slot, ref_id: refId, test, sender_user_id: sender?.userId || null, recipients: n, status,
      subject: cleanText(subject, 200), error: error ? cleanText(error, 300) : null, created_at: new Date(now).toISOString(),
    }).select('id'))[0];
    console.log(`[team-email] ${kind}${test ? ' (test)' : ''} ${status} · ${n} recipient${n === 1 ? '' : 's'}${error ? ` · ${cleanText(error, 120)}` : ''}${prior ? ' (already logged today)' : ''}`);
    return { status, recipients: n, send_id: row.id, grant_at: grantAt, ...(error ? { error } : {}) };
  };
  if (!sender) return log('skipped', 0, 'no owner to send from');
  const grant = await deps.getGrant(sender.userId);
  grantAt = grant?.connected_at || null;
  if (!canSendTeamEmail(grant)) return log('needs_reconnect', 0, grant?.error ? grant.error : RECONNECT_NOTE);
  const domains = allowedDomains(settings, grant);
  // "Send a test to me only": the sending mailbox itself, never the list.
  const r = test ? { to: [lower(grant.account_email)].filter(a => EMAIL_RE.test(a)), dropped: 0, capped: 0 } : await resolve(supabase, businessId, kind, domains);
  const notes = [r.dropped ? `dropped: outside domain (${r.dropped})` : null, r.capped ? `capped: ${r.capped} over ${MAX_RECIPIENTS}` : null].filter(Boolean).join(' · ') || null;
  if (!r.to.length) return log('skipped', 0, ['no recipients', notes].filter(Boolean).join(' · '));
  if (!test) assertAllowed(r.to, domains);
  let token;
  try { token = await deps.accessTokenFor(sender.userId); }
  catch (e) { if (e instanceof NeedsMicrosoft) return log('needs_reconnect', 0, e.message); throw e; }
  const res = await deps.fetch(`${GRAPH_URL()}/me/sendMail`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: Buffer.from(mime({ to: r.to, subject, html, text }), 'utf8').toString('base64'),
  });
  if (res.status === 202 || res.ok) return log('sent', r.to.length, notes);
  const body = await res.json().catch(() => null);
  const code = body?.error?.code || `HTTP ${res.status}`;
  return log(res.status === 401 || res.status === 403 ? 'needs_reconnect' : 'failed', 0, res.status === 403 ? `${RECONNECT_NOTE} (${code})` : code);
}
