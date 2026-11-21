import { createHash } from 'node:crypto';
import { getSupabase } from './goalsShared.js';
import { hasRole } from '../lib/requireAuth.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { laDateString } from './laDate.js';
import { loadMembers } from './teamEmails/send.js';

// email-by-member-v1 M1 - which sending mailbox belongs to which member, on the existing sales_mailbox_owners
// (business_id, mailbox_email, user_id). The list = every mailbox seen in sales_email_daily_counts + the members'
// Microsoft accounts + the rows already mapped, each as its DOMAIN, first-seen day and delivered count: the local
// part of an address never leaves the server, so a row is named by an opaque key the PUT sends back.
//   GET goals/mailbox-map (Viewer)   PUT goals/mailbox-map { key, user_id | null } (the owner)
// The same table decides whose Outlook account syncs into the workspace (graphSync), so a member's own connected
// account can only be mapped to that member and cannot be unmapped here.
const reply = (status, body) => ({ status, body });
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const mailboxKey = (businessId, mailbox) => createHash('sha256').update(`${businessId}|${mailbox}`).digest('hex').slice(0, 16);
const parts = a => { const i = a.lastIndexOf('@'); return { local: a.slice(0, i), domain: a.slice(i + 1) }; };

async function known(supabase, businessId) {
  const [counts, ownerRows, members] = await Promise.all([
    selectAllPages(() => supabase.from('sales_email_daily_counts').select('day, mailbox, sequence_id, step, delivered').eq('business_id', businessId).order('day').order('mailbox').order('sequence_id').order('step')),
    supabase.from('sales_mailbox_owners').select('mailbox_email, user_id').eq('business_id', businessId),
    loadMembers(supabase, businessId),
  ]);
  const owners = must(ownerRows);
  const ids = members.map(m => m.userId);
  const grants = ids.length ? must(await supabase.from('microsoft_grants').select('user_id, account_email, connected_at').in('user_id', ids)) : [];
  const by = new Map();
  const row = a => { if (!by.has(a)) by.set(a, { mailbox: a, first_seen: null, delivered: 0, user_id: null, account_of: null }); return by.get(a); };
  for (const c of counts) { const r = row(c.mailbox); r.first_seen ||= c.day; r.delivered += c.delivered || 0; }
  for (const g of grants) if (g.account_email) { const r = row(g.account_email.toLowerCase()); r.account_of = g.user_id; r.first_seen ||= g.connected_at ? laDateString(new Date(g.connected_at)) : null; }
  for (const o of owners) row(o.mailbox_email).user_id = o.user_id;
  const mapped = [...by.values()].filter(r => r.user_id);
  for (const r of by.values()) {
    const twin = mapped.find(x => x !== r && parts(x.mailbox).local === parts(r.mailbox).local);
    r.suggested_user_id = r.user_id ? null : r.account_of || twin?.user_id || null;
  }
  return { rows: [...by.values()], members };
}

const publicRow = (businessId, r) => ({ key: mailboxKey(businessId, r.mailbox), domain: parts(r.mailbox).domain, first_seen: r.first_seen, delivered: r.delivered, user_id: r.user_id, connected_account_of: r.account_of, suggested_user_id: r.suggested_user_id });

export async function listMailboxes(supabase, businessId) {
  const { rows, members } = await known(supabase, businessId);
  return reply(200, {
    mailboxes: rows.sort((a, b) => b.delivered - a.delivered || a.mailbox.localeCompare(b.mailbox)).map(r => publicRow(businessId, r)),
    members: members.filter(m => m.role !== 'viewer').map(m => ({ id: m.userId, name: m.firstName || 'a member', role: m.role })),
  });
}

export async function saveMailbox(supabase, { businessId, isOwner, body }) {
  if (!isOwner) return reply(403, { error: 'Only the workspace owner maps a mailbox to a member' });
  const unknown = Object.keys(body || {}).find(k => !['key', 'user_id'].includes(k));
  if (unknown) return reply(400, { error: `unknown field: ${unknown}` });
  const { key, user_id = null } = body || {};
  if (typeof key !== 'string' || !/^[0-9a-f]{16}$/.test(key)) return reply(400, { error: 'key is required' });
  if (user_id !== null && !UUID.test(String(user_id))) return reply(400, { error: 'user_id must be a member id or null' });
  const { rows, members } = await known(supabase, businessId);
  const row = rows.find(r => mailboxKey(businessId, r.mailbox) === key);
  if (!row) return reply(404, { error: 'That mailbox is not on the list' });
  if (user_id && !members.some(m => m.userId === user_id && m.role !== 'viewer')) return reply(400, { error: 'user_id must be a member of this workspace' });
  if (row.account_of && user_id !== row.account_of) return reply(409, { error: "That mailbox is a member's own connected account - it stays with that member", code: 'connected_account' });
  if (user_id) must(await supabase.from('sales_mailbox_owners').upsert({ business_id: businessId, mailbox_email: row.mailbox, user_id }, { onConflict: 'business_id,mailbox_email' }).select('user_id'));
  else must(await supabase.from('sales_mailbox_owners').delete().eq('business_id', businessId).eq('mailbox_email', row.mailbox).select('user_id'));
  return reply(200, { mailbox: publicRow(businessId, { ...row, user_id, suggested_user_id: null }) });
}

const run = fn => async (req, res) => {
  try { const r = await fn(req); res.status(r.status).json(r.body); }
  catch (e) { console.error('[mailbox-map]', e.message); res.status(500).json({ error: e.message }); }
};
export const listMailboxesRoute = run(req => listMailboxes(getSupabase(), req.params.businessId));
export const saveMailboxRoute = run(req => saveMailbox(getSupabase(), { businessId: req.params.businessId, isOwner: hasRole(req, req.params.businessId, 'owner'), body: req.body }));
