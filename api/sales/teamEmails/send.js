import { accessTokenFor, getGrant, canSendTeamEmail, NeedsMicrosoft } from '../../lib/microsoftGrants.js';
import { GRAPH_URL } from '../../microsoft/graphSync.js';
import { cleanText } from '../scrubText.js';

// homelover-team-emails-v1 T1 - the ONE send path in Prospector (Jack's narrow exception to "never sends from Outlook"):
// internal emails to the workspace's own members. Recipients are resolved here from business_members; no caller can
// name one - sendTeamEmail refuses any option that isn't in ALLOWED, and a resolved address that isn't a member throws.
export const KINDS = ['visitor', 'client'];
export const RECONNECT_NOTE = 'Reconnect to allow team emails';
const ALLOWED = new Set(['kind', 'subject', 'html', 'text', 'slot', 'refId', 'test', 'onlyUserId']);
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const lower = e => String(e || '').trim().toLowerCase();
const firstName = p => String(p?.display_name || '').trim().split(/\s+/)[0] || null;

export async function loadSettings(supabase, businessId) {
  return must(await supabase.from('sales_team_email_settings').select('business_id, sender_user_id, visitor_on, client_on, client_alert_since, updated_at').eq('business_id', businessId).maybeSingle());
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

// Distinct addresses (one person with two sign-ins on one address gets one email), minus anyone who turned this kind
// off on any of their sign-ins. onlyUserId = "Send a test to me only".
export async function teamRecipients(supabase, businessId, kind, { members = null, onlyUserId = null } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`kind must be ${KINDS.join('|')}`);
  const all = members || await loadMembers(supabase, businessId);
  const off = new Set(must(await supabase.from('sales_team_email_optouts').select('user_id').eq('business_id', businessId).eq('kind', kind)).map(r => r.user_id));
  const byEmail = new Map();
  for (const m of all) {
    if (!m.email) continue;
    const p = byEmail.get(m.email) || { email: m.email, userIds: [], firstName: m.firstName };
    p.userIds.push(m.userId);
    byEmail.set(m.email, p);
  }
  let people = [...byEmail.values()];
  if (onlyUserId) {
    if (!all.some(m => m.userId === onlyUserId)) throw new Error('only a member can get a test');
    return people.filter(p => p.userIds.includes(onlyUserId));
  }
  people = people.filter(p => !p.userIds.some(id => off.has(id)));
  return people;
}

export function assertMembers(addresses, members) {
  const ok = new Set(members.map(m => m.email).filter(Boolean));
  for (const a of addresses) if (!ok.has(lower(a))) throw new Error('refused: a recipient is not a member of this workspace');
}

const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}(?=.)/g, '$&\r\n');
const header = s => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
// One multipart/alternative message (plain text + HTML); Graph's JSON sendMail carries only one body.
export function mime({ to, subject, html, text, boundary = `tm_${Date.now().toString(36)}` }) {
  return [
    `To: ${to.join(', ')}`, `Subject: ${header(subject)}`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(html),
    `--${boundary}--`, '',
  ].join('\r\n');
}

const DEPS = { fetch: (...a) => fetch(...a), getGrant, accessTokenFor };

// -> { status: sent | failed | needs_reconnect | skipped, recipients (a count), send_id, error? }. Every attempt is one
// sales_team_email_sends row; a failure is never retried here (the scheduler's slot is already spent - no retry storm).
export async function sendTeamEmail(supabase, businessId, opts, deps = DEPS) {
  const extra = Object.keys(opts || {}).filter(k => !ALLOWED.has(k));
  if (extra.length) throw new Error(`sendTeamEmail takes no ${extra.join(', ')} - recipients come from the workspace's members`);
  const { kind, subject, html, text, slot = null, refId = null, test = false, onlyUserId = null } = opts;
  if (!KINDS.includes(kind)) throw new Error(`kind must be ${KINDS.join('|')}`);
  if (!subject || !html || !text) throw new Error('subject, html and text are required');
  const [settings, members] = await Promise.all([loadSettings(supabase, businessId), loadMembers(supabase, businessId)]);
  const sender = senderOf(settings, members);
  const log = async (status, n, error = null) => {
    const row = must(await supabase.from('sales_team_email_sends').insert({
      business_id: businessId, kind, slot, ref_id: refId, test, sender_user_id: sender?.userId || null, recipients: n, status,
      subject: cleanText(subject, 200), error: error ? cleanText(error, 300) : null,
    }).select('id'))[0];
    console.log(`[team-email] ${kind}${test ? ' (test)' : ''} ${status} · ${n} recipient${n === 1 ? '' : 's'}`);
    return { status, recipients: n, send_id: row.id, ...(error ? { error } : {}) };
  };
  if (!sender) return log('skipped', 0, 'no owner to send from');
  const people = await teamRecipients(supabase, businessId, kind, { members, onlyUserId });
  if (!people.length) return log('skipped', 0, 'nobody has this email on');
  const to = people.map(p => p.email);
  assertMembers(to, members);
  const grant = await deps.getGrant(sender.userId);
  if (!canSendTeamEmail(grant)) return log('needs_reconnect', 0, grant?.error ? grant.error : RECONNECT_NOTE);
  let token;
  try { token = await deps.accessTokenFor(sender.userId); }
  catch (e) { if (e instanceof NeedsMicrosoft) return log('needs_reconnect', 0, e.message); throw e; }
  const r = await deps.fetch(`${GRAPH_URL()}/me/sendMail`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: Buffer.from(mime({ to, subject, html, text }), 'utf8').toString('base64'),
  });
  if (r.status === 202 || r.ok) return log('sent', to.length);
  const body = await r.json().catch(() => null);
  const code = body?.error?.code || `HTTP ${r.status}`;
  return log(r.status === 401 || r.status === 403 ? 'needs_reconnect' : 'failed', 0, r.status === 403 ? `${RECONNECT_NOTE} (${code})` : code);
}
