import { getSupabase } from '../goalsShared.js';
import { hasRole } from '../../lib/requireAuth.js';
import { getGrant, canSendTeamEmail } from '../../lib/microsoftGrants.js';
import { KINDS, RECONNECT_NOTE, MAX_RECIPIENTS, EMAIL_RE, loadSettings, loadMembers, senderOf, sendTeamEmail, liveRecipients, recipientCounts, allowedDomains, domainOf } from './send.js';
import { visitorEmailJob, hlJobs, schedulerLine, VISITOR_EMAIL_JOB } from './jobs.js';
import { schedulerState, laClock } from './scheduler.js';
import { pullRunsThisMonth } from './jobs.js';
import { composeAlert, lookalikesOf, ALERT_COLS } from './clientAlert.js';

// homelover-team-emails-v1 T2 (REV2) - Sales › Settings › Team emails. Reads: any member; every write: the owner.
// Only the owner's read carries the recipient addresses; everyone else sees counts. Activity rows
// (sales_team_email_changes) carry counts only, never an address; each change can be undone for UNDO_MS.
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lower = e => String(e || '').trim().toLowerCase();
export const UNDO_MS = 10e3;
export const EXPIRED_NOTE = 'Microsoft access for the sending mailbox expired - reconnect it; team emails are paused until then';
const ownerOnly = reply(403, { error: 'Only the owner can change team emails' });

export async function teamEmailState(supabase, businessId, userId, { isOwner = false, grantOf = getGrant, now = Date.now() } = {}) {
  const settings = await loadSettings(supabase, businessId);
  if (!settings) return reply(404, { error: 'Team emails are not set up for this workspace' });
  const members = await loadMembers(supabase, businessId);
  const sender = senderOf(settings, members);
  const grants = new Map(await Promise.all(members.map(async m => [m.userId, await grantOf(m.userId)])));
  const grant = sender ? grants.get(sender.userId) : null;
  const ready = canSendTeamEmail(grant);
  const sends = must(await supabase.from('sales_team_email_sends').select('id, kind, test, recipients, status, error, created_at').eq('business_id', businessId).order('created_at', { ascending: false }).limit(10));
  const lastReal = sends.find(s => !s.test && s.status !== 'skipped');
  // A needs_reconnect from before the sender last connected is history, not a live problem.
  const liveBlock = lastReal?.status === 'needs_reconnect' && !(grant?.connected_at && Date.parse(grant.connected_at) > Date.parse(lastReal.created_at));
  const banner = grant?.error ? EXPIRED_NOTE : !ready ? RECONNECT_NOTE : liveBlock ? EXPIRED_NOTE : null;
  const domains = allowedDomains(settings, grant);
  const live = await liveRecipients(supabase, businessId);
  const changes = must(await supabase.from('sales_team_email_changes').select('id, action, count_before, count_after, undone_at, at').eq('business_id', businessId).order('at', { ascending: false }).limit(10));
  const body = {
    sender: sender ? { user_id: sender.userId, first_name: sender.firstName } : null,
    senders: members.filter(m => canSendTeamEmail(grants.get(m.userId))).map(m => ({ user_id: m.userId, first_name: m.firstName })),
    visitor_on: settings.visitor_on, client_on: settings.client_on, ready, banner, is_owner: isOwner,
    // visitor-trend-v1 T4 / R4: the weekend switch (default OFF) and the measured cost of a pull run this LA month - the
    // Settings copy quotes these numbers, never a constant.
    // FIX email-simplify-v1 E2: the funnel tables switch (default OFF); absent while its migration has not run.
    ...(settings.funnel_tables_pending ? {} : { funnel_tables: !!settings.funnel_tables }),
    weekend_on: !!settings.weekend_on, pull_runs_month: await pullRunsThisMonth(supabase, businessId, now),
    domains, max: MAX_RECIPIENTS, counts: await recipientCounts(supabase, businessId, settings, grant), total: live.length,
    sends: sends.map(s => ({ id: s.id, at: s.created_at, kind: s.kind, test: s.test, recipients: s.recipients, status: s.status, error: s.error })),
    changes: changes.map(c => ({ ...c, undoable: !c.undone_at && c.action !== 'undo' && now - Date.parse(c.at) < UNDO_MS })),
    // FIX visitor-email-top10-v1 V3c: this server process's scheduler (Render runs it; a local server.js never does).
    scheduler: { on: !!schedulerState.boot_at, boot_at: schedulerState.boot_at, last_tick_at: schedulerState.last_tick_at, line: schedulerLine(hlJobs({})) },
  };
  if (isOwner) {
    const onList = new Set(live.map(r => lower(r.address)));
    const seen = new Set();
    body.recipients = live.map(r => ({ id: r.id, address: r.address, visitor_email: r.visitor_email, client_alert: r.client_alert, allowed: domains.includes(domainOf(r.address)) }));
    body.suggestions = members.filter(m => m.email && domains.includes(domainOf(m.email)) && !onList.has(m.email) && !seen.has(m.email) && seen.add(m.email)).map(m => ({ user_id: m.userId, first_name: m.firstName || 'Member' }));
  }
  return reply(200, body);
}

export async function updateTeamEmails(supabase, { businessId, userId, body = {}, isOwner, grantOf = getGrant }) {
  if (!isOwner) return ownerOnly;
  const keys = Object.keys(body);
  const bad = keys.filter(k => !['sender_user_id', 'visitor_on', 'client_on', 'weekend_on', 'funnel_tables'].includes(k));
  if (bad.length || !keys.length) return reply(400, { error: 'send sender_user_id, visitor_on, client_on, weekend_on and / or funnel_tables' });
  if ('funnel_tables' in body && (await loadSettings(supabase, businessId))?.funnel_tables_pending) return reply(503, { error: 'Run supabase/migrations/20261111_email_simplify_v1.sql first (funnel_tables is missing)', migration_pending: true });
  for (const k of ['visitor_on', 'client_on', 'weekend_on', 'funnel_tables']) if (k in body && typeof body[k] !== 'boolean') return reply(400, { error: `${k} must be true or false` });
  if ('sender_user_id' in body) {
    const id = body.sender_user_id;
    if (!UUID.test(id || '')) return reply(400, { error: 'sender_user_id must be a member' });
    const members = await loadMembers(supabase, businessId);
    if (!members.some(m => m.userId === id)) return reply(400, { error: 'sender_user_id must be a member' });
    if (!canSendTeamEmail(await grantOf(id))) return reply(409, { error: `That member's Microsoft connection can't send yet - ${RECONNECT_NOTE.toLowerCase()}` });
  }
  const rows = must(await supabase.from('sales_team_email_settings').update({ ...body, updated_by: userId, updated_at: new Date().toISOString() }).eq('business_id', businessId).select('business_id'));
  if (!rows.length) return reply(404, { error: 'Team emails are not set up for this workspace' });
  return teamEmailState(supabase, businessId, userId, { isOwner, grantOf });
}

const liveCount = async (supabase, businessId) => (await liveRecipients(supabase, businessId)).length;
const logChange = async (supabase, businessId, userId, row) =>
  must(await supabase.from('sales_team_email_changes').insert({ business_id: businessId, by_user: userId, at: new Date().toISOString(), ...row }).select('id'))[0].id;

async function domainsFor(supabase, businessId, grantOf) {
  const settings = await loadSettings(supabase, businessId);
  const sender = senderOf(settings, await loadMembers(supabase, businessId));
  return allowedDomains(settings, sender ? await grantOf(sender.userId) : null);
}
async function checkAddress(supabase, businessId, address, grantOf, { exceptId = null } = {}) {
  if (!EMAIL_RE.test(address)) return 'Enter an email address';
  const domains = await domainsFor(supabase, businessId, grantOf);
  if (!domains.length) return 'Connect the sending mailbox first - its domain decides who can get team emails';
  if (!domains.includes(domainOf(address))) return `Only addresses at ${domains.map(d => `@${d}`).join(' or ')} can get team emails`;
  const live = await liveRecipients(supabase, businessId);
  if (live.some(r => r.id !== exceptId && lower(r.address) === address)) return 'Already on the list';
  if (!exceptId && live.length >= MAX_RECIPIENTS) return `The list holds at most ${MAX_RECIPIENTS} addresses`;
  return null;
}
const flagsOf = body => ({ visitor_email: body.visitor_email !== false, client_alert: body.client_alert !== false });
const badFlags = body => ['visitor_email', 'client_alert'].some(k => k in body && typeof body[k] !== 'boolean');

// POST { address } or { member_user_id } (+ visitor_email / client_alert, both default on).
export async function addRecipient(supabase, { businessId, userId, body = {}, isOwner, grantOf = getGrant }) {
  if (!isOwner) return ownerOnly;
  if (badFlags(body)) return reply(400, { error: 'visitor_email and client_alert must be true or false' });
  let address = lower(body.address);
  if (body.member_user_id) {
    const m = (await loadMembers(supabase, businessId)).find(x => x.userId === body.member_user_id);
    if (!m?.email) return reply(400, { error: 'member_user_id must be a member' });
    address = m.email;
  }
  const problem = await checkAddress(supabase, businessId, address, grantOf);
  if (problem) return reply(400, { error: problem });
  const before = await liveCount(supabase, businessId);
  const id = must(await supabase.from('sales_team_email_recipients').insert({ business_id: businessId, address, ...flagsOf(body), added_by: userId, added_at: new Date().toISOString() }).select('id'))[0].id;
  const change = await logChange(supabase, businessId, userId, { action: 'add', recipient_id: id, count_before: before, count_after: before + 1 });
  console.log(`[team-emails] recipients ${before} -> ${before + 1}`);
  return reply(200, { id, change_id: change, count: before + 1 });
}

// PATCH { visitor_email?, client_alert?, address? } - a new address archives the old row and adds a new one.
export async function editRecipient(supabase, { businessId, userId, id, body = {}, isOwner, grantOf = getGrant }) {
  if (!isOwner) return ownerOnly;
  if (!UUID.test(id || '')) return reply(400, { error: 'unknown recipient' });
  if (badFlags(body) || !Object.keys(body).length || Object.keys(body).some(k => !['address', 'visitor_email', 'client_alert'].includes(k))) return reply(400, { error: 'send address, visitor_email and / or client_alert' });
  const row = must(await supabase.from('sales_team_email_recipients').select('id, address, visitor_email, client_alert').eq('business_id', businessId).eq('id', id).is('archived_at', null).maybeSingle());
  if (!row) return reply(404, { error: 'unknown recipient' });
  const count = await liveCount(supabase, businessId);
  const prior = { visitor_email: row.visitor_email, client_alert: row.client_alert };
  const flags = { visitor_email: 'visitor_email' in body ? body.visitor_email : row.visitor_email, client_alert: 'client_alert' in body ? body.client_alert : row.client_alert };
  const address = 'address' in body ? lower(body.address) : row.address;
  if (address !== row.address) {
    const problem = await checkAddress(supabase, businessId, address, grantOf, { exceptId: row.id });
    if (problem) return reply(400, { error: problem });
    must(await supabase.from('sales_team_email_recipients').update({ archived_at: new Date().toISOString() }).eq('id', row.id).select('id'));
    const nid = must(await supabase.from('sales_team_email_recipients').insert({ business_id: businessId, address, ...flags, added_by: userId, added_at: new Date().toISOString() }).select('id'))[0].id;
    const change = await logChange(supabase, businessId, userId, { action: 'edit', recipient_id: nid, replaced_id: row.id, count_before: count, count_after: count });
    return reply(200, { id: nid, change_id: change, count });
  }
  must(await supabase.from('sales_team_email_recipients').update(flags).eq('id', row.id).select('id'));
  const change = await logChange(supabase, businessId, userId, { action: 'edit', recipient_id: row.id, prior, count_before: count, count_after: count });
  return reply(200, { id: row.id, change_id: change, count });
}

export async function removeRecipient(supabase, { businessId, userId, id, isOwner }) {
  if (!isOwner) return ownerOnly;
  if (!UUID.test(id || '')) return reply(400, { error: 'unknown recipient' });
  const before = await liveCount(supabase, businessId);
  const rows = must(await supabase.from('sales_team_email_recipients').update({ archived_at: new Date().toISOString() }).eq('business_id', businessId).eq('id', id).is('archived_at', null).select('id'));
  if (!rows.length) return reply(404, { error: 'unknown recipient' });
  const change = await logChange(supabase, businessId, userId, { action: 'remove', recipient_id: id, count_before: before, count_after: before - 1 });
  console.log(`[team-emails] recipients ${before} -> ${before - 1}`);
  return reply(200, { change_id: change, count: before - 1 });
}

export async function undoChange(supabase, { businessId, userId, id, isOwner, now = Date.now() }) {
  if (!isOwner) return ownerOnly;
  if (!UUID.test(id || '')) return reply(400, { error: 'unknown change' });
  const c = must(await supabase.from('sales_team_email_changes').select('id, action, recipient_id, replaced_id, prior, undone_at, at').eq('business_id', businessId).eq('id', id).maybeSingle());
  if (!c || c.action === 'undo') return reply(404, { error: 'unknown change' });
  if (c.undone_at) return reply(409, { error: 'Already undone' });
  if (now - Date.parse(c.at) >= UNDO_MS) return reply(409, { error: 'Too late to undo - change it back by hand' });
  const before = await liveCount(supabase, businessId);
  const R = () => supabase.from('sales_team_email_recipients');
  const stamp = new Date(now).toISOString();
  if (c.action === 'add') must(await R().update({ archived_at: stamp }).eq('id', c.recipient_id).select('id'));
  else if (c.action === 'remove') {
    const row = must(await R().select('address').eq('id', c.recipient_id).maybeSingle());
    if ((await liveRecipients(supabase, businessId)).some(r => lower(r.address) === lower(row?.address))) return reply(409, { error: 'That address is back on the list already' });
    must(await R().update({ archived_at: null }).eq('id', c.recipient_id).select('id'));
  } else if (c.replaced_id) {
    must(await R().update({ archived_at: stamp }).eq('id', c.recipient_id).select('id'));
    must(await R().update({ archived_at: null }).eq('id', c.replaced_id).select('id'));
  } else must(await R().update(c.prior).eq('id', c.recipient_id).select('id'));
  const after = await liveCount(supabase, businessId);
  must(await supabase.from('sales_team_email_changes').update({ undone_at: stamp }).eq('id', c.id).select('id'));
  await logChange(supabase, businessId, userId, { action: 'undo', recipient_id: c.recipient_id, count_before: before, count_after: after });
  return reply(200, { count: after });
}

// "Send a test to me only": to the sending mailbox itself, never the list. The visitor email from stored data (no
// pull), or a client's alert (opportunity_id) - never claims the real alert, so the team's copy is unaffected.
export async function sendTest(supabase, { businessId, body = {}, isOwner, deps }) {
  if (!isOwner) return ownerOnly;
  if (body.kind === 'visitor') {
    const r = await visitorEmailJob(supabase, businessId, { pull: null, deps, test: true });
    return reply(200, { status: r.status, recipients: r.recipients ?? 0, rows: r.rows ?? 0, new_rows: r.new_rows ?? 0, strip: r.strip ?? 0, funnel: r.funnel ?? 0, subject: r.subject ?? null });
  }
  if (body.kind === 'client') {
    if (!UUID.test(body.opportunity_id || '')) return reply(400, { error: 'opportunity_id must be a client' });
    const row = must(await supabase.from('sales_opportunities').select(ALERT_COLS).eq('business_id', businessId).eq('id', body.opportunity_id).is('archived_at', null).maybeSingle());
    if (!row?.client_status) return reply(404, { error: 'not a client in this workspace' });
    const mail = await composeAlert(supabase, businessId, row, await lookalikesOf(supabase, businessId, row.organization));
    const r = await sendTeamEmail(supabase, businessId, { kind: 'client', subject: mail.subject, html: mail.html, text: mail.text, refId: row.id, test: true }, deps);
    return reply(200, { status: r.status, recipients: r.recipients, lookalikes: mail.lookalikes });
  }
  return reply(400, { error: `kind must be ${KINDS.join(' or ')}` });
}

// FIX visitor-email-top10-v1 V3b - "Send now" (Needs attention, owner / admin) and "Send to team now" (Settings, owner):
// today's visitor email to the list from the stored data (no pull), through the same job. { check: true } only answers
// whether today's went out. Once it has, a plain call is refused (409); { again: true } (owner only - the explicit second
// confirm) sends a second copy. The day's slot row records it: detail.manual = { by, name, at, status, recipients, again }
// beside the scheduled fields, so the Needs attention line can say "Sent Thu 10:30 (manual, Jack)".
export async function sendNow(supabase, { businessId, userId = null, isAdmin, isOwner = false, check = false, again = false, deps, now = Date.now(), job = visitorEmailJob }) {
  if (!isAdmin) return reply(403, { error: 'Only an owner or admin can send the visitor email now' });
  if (again && !isOwner) return reply(403, { error: 'Only the owner can send a second copy' });
  const slot = `${laClock(now).date} 07:00`;
  const row = must(await supabase.from('sales_job_slots').select('status, detail, finished_at').eq('job', VISITOR_EMAIL_JOB).eq('scope', businessId).eq('slot', slot).maybeSingle());
  const sentAlready = row?.status === 'ok' && row.detail?.status === 'sent';
  const already = sentAlready ? { sent_at: row.detail.manual?.status === 'sent' ? row.detail.manual.at : row.finished_at, recipients: row.detail.manual?.status === 'sent' ? row.detail.manual.recipients : row.detail.recipients, manual: row.detail.manual || null } : null;
  if (check) return reply(200, { sent_today: sentAlready, ...(already || {}) });
  if (sentAlready && !again) return reply(409, { error: `Today's visitor email already went out to ${already.recipients} recipient${already.recipients === 1 ? '' : 's'}`, ...already });
  const name = userId ? (await loadMembers(supabase, businessId)).find(m => m.userId === userId)?.firstName || null : null;
  const r = await job(supabase, businessId, { now, pull: null, deps });
  const error = r.error || r.reason || null;
  const manual = { by: userId, name, at: new Date(now).toISOString(), status: r.status, recipients: r.recipients ?? 0, again: !!again, ...(error ? { error } : {}) };
  const detail = sentAlready
    ? { ...row.detail, manual }
    : { status: r.status, recipients: r.recipients ?? 0, rows: r.rows ?? 0, overall: r.overall ?? 0, via: 'send_now', manual, ...(error ? { error } : {}) };
  must(await supabase.from('sales_job_slots').upsert({ job: VISITOR_EMAIL_JOB, scope: businessId, slot, status: sentAlready || r.status === 'sent' ? 'ok' : 'error', detail, finished_at: new Date(now).toISOString() }, { onConflict: 'job,scope,slot' }).select('job'));
  return reply(200, { status: r.status, recipients: r.recipients ?? 0, rows: r.rows ?? 0, overall: r.overall ?? 0, again: !!again, ...(error ? { error } : {}) });
}

const run = fn => async (req, res) => {
  try { send(res, await fn(req)); }
  catch (e) { console.error('[team-emails]', e.message); res.status(500).json({ error: e.message }); }
};
const ctx = req => ({ supabase: getSupabase(), businessId: req.params.businessId, userId: req.auth.user.id, isOwner: hasRole(req, req.params.businessId, 'owner') });
export const teamEmailStateRoute = run(req => { const c = ctx(req); return teamEmailState(c.supabase, c.businessId, c.userId, { isOwner: c.isOwner }); });
export const updateTeamEmailsRoute = run(req => updateTeamEmails(ctx(req).supabase, { ...ctx(req), body: req.body || {} }));
export const addRecipientRoute = run(req => addRecipient(ctx(req).supabase, { ...ctx(req), body: req.body || {} }));
export const editRecipientRoute = run(req => editRecipient(ctx(req).supabase, { ...ctx(req), id: req.params.id, body: req.body || {} }));
export const removeRecipientRoute = run(req => removeRecipient(ctx(req).supabase, { ...ctx(req), id: req.params.id }));
export const undoChangeRoute = run(req => undoChange(ctx(req).supabase, { ...ctx(req), id: req.params.id }));
export const sendTestRoute = run(req => sendTest(ctx(req).supabase, { ...ctx(req), body: req.body || {} }));
export const sendNowRoute = run(req => sendNow(ctx(req).supabase, { ...ctx(req), isAdmin: hasRole(req, req.params.businessId, 'admin'), check: req.body?.check === true, again: req.body?.again === true }));
