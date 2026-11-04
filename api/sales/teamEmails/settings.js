import { getSupabase } from '../goalsShared.js';
import { hasRole } from '../../lib/requireAuth.js';
import { getGrant, canSendTeamEmail } from '../../lib/microsoftGrants.js';
import { KINDS, RECONNECT_NOTE, loadSettings, loadMembers, senderOf, teamRecipients, sendTeamEmail } from './send.js';
import { visitorEmailJob } from './jobs.js';
import { composeAlert, lookalikesOf, ALERT_COLS } from './clientAlert.js';

// homelover-team-emails-v1 T2 - Settings › Team emails. Reads: any member. Workspace on / off: owner or admin.
// The sending mailbox: owner only. "Send me this": each member for themselves. Answers carry first names and counts,
// never an address.
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EXPIRED_NOTE = 'Microsoft access for the sending mailbox expired - reconnect it; team emails are paused until then';

export async function teamEmailState(supabase, businessId, userId, { grantOf = getGrant } = {}) {
  const settings = await loadSettings(supabase, businessId);
  if (!settings) return reply(404, { error: 'Team emails are not set up for this workspace' });
  const members = await loadMembers(supabase, businessId);
  const sender = senderOf(settings, members);
  const grants = new Map(await Promise.all(members.map(async m => [m.userId, await grantOf(m.userId)])));
  const grant = sender ? grants.get(sender.userId) : null;
  const ready = canSendTeamEmail(grant);
  const off = new Set(must(await supabase.from('sales_team_email_optouts').select('kind').eq('business_id', businessId).eq('user_id', userId)).map(r => r.kind));
  const recipients = {};
  for (const k of KINDS) recipients[k] = (await teamRecipients(supabase, businessId, k, { members })).map(p => p.firstName || 'A member');
  const sends = must(await supabase.from('sales_team_email_sends').select('id, kind, test, recipients, status, error, created_at').eq('business_id', businessId).order('created_at', { ascending: false }).limit(10));
  const lastReal = sends.find(s => !s.test && s.status !== 'skipped');
  const banner = grant?.error ? EXPIRED_NOTE : !ready ? RECONNECT_NOTE : lastReal?.status === 'needs_reconnect' ? EXPIRED_NOTE : null;
  return reply(200, {
    sender: sender ? { user_id: sender.userId, first_name: sender.firstName } : null,
    senders: members.filter(m => canSendTeamEmail(grants.get(m.userId))).map(m => ({ user_id: m.userId, first_name: m.firstName })),
    visitor_on: settings.visitor_on, client_on: settings.client_on, ready, banner,
    me: Object.fromEntries(KINDS.map(k => [k, !off.has(k)])), recipients,
    sends: sends.map(s => ({ id: s.id, at: s.created_at, kind: s.kind, test: s.test, recipients: s.recipients, status: s.status, error: s.error })),
  });
}

export async function updateTeamEmails(supabase, { businessId, userId, body = {}, isOwner, isAdmin, grantOf = getGrant }) {
  const keys = Object.keys(body);
  const bad = keys.filter(k => !['sender_user_id', 'visitor_on', 'client_on'].includes(k));
  if (bad.length || !keys.length) return reply(400, { error: 'send sender_user_id, visitor_on and / or client_on' });
  if ('sender_user_id' in body && !isOwner) return reply(403, { error: 'Only the owner can change the sending mailbox' });
  if (('visitor_on' in body || 'client_on' in body) && !isAdmin) return reply(403, { error: 'Only an owner or admin can turn team emails on or off' });
  for (const k of ['visitor_on', 'client_on']) if (k in body && typeof body[k] !== 'boolean') return reply(400, { error: `${k} must be true or false` });
  if ('sender_user_id' in body) {
    const id = body.sender_user_id;
    if (!UUID.test(id || '')) return reply(400, { error: 'sender_user_id must be a member' });
    const members = await loadMembers(supabase, businessId);
    if (!members.some(m => m.userId === id)) return reply(400, { error: 'sender_user_id must be a member' });
    if (!canSendTeamEmail(await grantOf(id))) return reply(409, { error: `That member's Microsoft connection can't send yet - ${RECONNECT_NOTE.toLowerCase()}` });
  }
  const rows = must(await supabase.from('sales_team_email_settings').update({ ...body, updated_by: userId, updated_at: new Date().toISOString() }).eq('business_id', businessId).select('business_id'));
  if (!rows.length) return reply(404, { error: 'Team emails are not set up for this workspace' });
  return teamEmailState(supabase, businessId, userId, { grantOf });
}

export async function setMine(supabase, { businessId, userId, body = {} }) {
  if (!KINDS.includes(body.kind) || typeof body.on !== 'boolean') return reply(400, { error: `send kind (${KINDS.join('|')}) and on (true / false)` });
  if (body.on) must(await supabase.from('sales_team_email_optouts').delete().eq('business_id', businessId).eq('user_id', userId).eq('kind', body.kind));
  else must(await supabase.from('sales_team_email_optouts').upsert({ business_id: businessId, user_id: userId, kind: body.kind }, { onConflict: 'business_id,user_id,kind' }));
  return reply(200, { kind: body.kind, on: body.on });
}

// "Send a test to me only": the visitor email from stored data (no pull), or a client's alert (opportunity_id) - never
// claims the real alert, so the team's copy still goes out (or stays unsent) on its own.
export async function sendTest(supabase, { businessId, userId, body = {}, deps }) {
  if (body.kind === 'visitor') {
    const r = await visitorEmailJob(supabase, businessId, { pull: null, deps, test: true, onlyUserId: userId });
    return reply(200, { status: r.status, recipients: r.recipients ?? 0, rows: r.rows ?? 0 });
  }
  if (body.kind === 'client') {
    if (!UUID.test(body.opportunity_id || '')) return reply(400, { error: 'opportunity_id must be a client' });
    const row = must(await supabase.from('sales_opportunities').select(ALERT_COLS).eq('business_id', businessId).eq('id', body.opportunity_id).is('archived_at', null).maybeSingle());
    if (!row?.client_status) return reply(404, { error: 'not a client in this workspace' });
    const mail = await composeAlert(supabase, businessId, row, await lookalikesOf(supabase, businessId, row.organization));
    const r = await sendTeamEmail(supabase, businessId, { kind: 'client', subject: mail.subject, html: mail.html, text: mail.text, refId: row.id, test: true, onlyUserId: userId }, deps);
    return reply(200, { status: r.status, recipients: r.recipients, lookalikes: mail.lookalikes });
  }
  return reply(400, { error: 'kind must be visitor or client' });
}

const run = fn => async (req, res) => {
  try { send(res, await fn(req)); }
  catch (e) { console.error('[team-emails]', e.message); res.status(500).json({ error: e.message }); }
};
const ctx = req => ({ supabase: getSupabase(), businessId: req.params.businessId, userId: req.auth.user.id });
export const teamEmailStateRoute = run(req => { const c = ctx(req); return teamEmailState(c.supabase, c.businessId, c.userId); });
export const updateTeamEmailsRoute = run(req => { const c = ctx(req); return updateTeamEmails(c.supabase, { ...c, body: req.body || {}, isOwner: hasRole(req, c.businessId, 'owner'), isAdmin: hasRole(req, c.businessId, 'admin') }); });
export const setMineRoute = run(req => { const c = ctx(req); return setMine(c.supabase, { ...c, body: req.body || {} }); });
export const sendTestRoute = run(req => { const c = ctx(req); return sendTest(c.supabase, { ...c, body: req.body || {} }); });
