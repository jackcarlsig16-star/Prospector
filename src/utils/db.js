// ── Prospector DB layer ─────────────────────────────────────────────────────────
// Tries Supabase first, falls back to localStorage on any error.
// Zero-risk: if REACT_APP_SUPABASE_URL is not set, supabase client is null
// and every function uses localStorage silently.

import { supabase, isSupabaseEnabled } from './supabase';

const TEAM_KEY     = 'prospector_team_users';
const FRONTIER_KEY = 'prospector_frontier';

// ── Team Users ────────────────────────────────────────────────────────────────

// Filter out users that have been locally tombstoned. Survives the
// race where the Supabase delete hasn't replicated yet — removals
// stay removed across refreshes regardless of network timing.
const filterTombstoned = (users) => {
  try {
    const removed = JSON.parse(localStorage.getItem('prospector_removed_user_ids') || '[]');
    if (!Array.isArray(removed) || !removed.length) return users;
    const set = new Set(removed);
    return users.filter(u => !set.has(u.id));
  } catch { return users; }
};

export async function getTeamUsers() {
  if (!isSupabaseEnabled()) {
    try { return filterTombstoned(JSON.parse(localStorage.getItem(TEAM_KEY) || '[]')); } catch { return []; }
  }
  try {
    const { data, error } = await supabase
      .from('team_users')
      .select('data')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return filterTombstoned((data || []).map(r => r.data).filter(Boolean));
  } catch(e) {
    console.warn('[db] getTeamUsers Supabase failed, using localStorage:', e.message);
    try { return filterTombstoned(JSON.parse(localStorage.getItem(TEAM_KEY) || '[]')); } catch { return []; }
  }
}

export async function saveTeamUsers(users) {
  // Always write localStorage as backup
  try { localStorage.setItem(TEAM_KEY, JSON.stringify(users)); } catch {}
  if (!isSupabaseEnabled()) return;
  try {
    if (users.length === 0) {
      await supabase.from('team_users').delete().neq('id', '___none___');
      return;
    }
    const rows = users.map(u => ({
      id:         u.id,
      email:      u.email || '',
      name:       u.name  || '',
      role:       u.role  || 'AE',
      status:     u.status || 'pending',
      data:       u,
      updated_at: new Date().toISOString(),
    }));
    const { error: upsertErr } = await supabase
      .from('team_users')
      .upsert(rows, { onConflict: 'id' });
    if (upsertErr) throw upsertErr;
    // Delete rows no longer in the list
    const ids = users.map(u => u.id).join(',');
    await supabase.from('team_users').delete().not('id', 'in', `(${ids})`);
  } catch(e) {
    console.warn('[db] saveTeamUsers Supabase failed:', e.message);
  }
}

// ── Frontier ──────────────────────────────────────────────────────────────────

export async function getFrontier() {
  if (!isSupabaseEnabled()) {
    try { return JSON.parse(localStorage.getItem(FRONTIER_KEY) || '[]'); } catch { return []; }
  }
  try {
    const { data, error } = await supabase
      .from('frontier')
      .select('data')
      .order('updated_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(r => r.data).filter(Boolean);
  } catch(e) {
    console.warn('[db] getFrontier Supabase failed, using localStorage:', e.message);
    try { return JSON.parse(localStorage.getItem(FRONTIER_KEY) || '[]'); } catch { return []; }
  }
}

export async function saveFrontier(frontier) {
  // Always write localStorage as backup
  try { localStorage.setItem(FRONTIER_KEY, JSON.stringify(frontier)); } catch {}
  if (!isSupabaseEnabled()) return;
  try {
    if (frontier.length === 0) {
      await supabase.from('frontier').delete().neq('id', '___none___');
      return;
    }
    const rows = frontier.map(f => ({
      id:         f.id,
      data:       f,
      updated_at: new Date().toISOString(),
    }));
    const { error: upsertErr } = await supabase
      .from('frontier')
      .upsert(rows, { onConflict: 'id' });
    if (upsertErr) throw upsertErr;
    // Delete rows no longer in the list
    const ids = frontier.map(f => f.id).join(',');
    await supabase.from('frontier').delete().not('id', 'in', `(${ids})`);
  } catch(e) {
    console.warn('[db] saveFrontier Supabase failed:', e.message);
  }
}

// ── Accounts ─────────────────────────────────────────────────────────────────

const ACCOUNTS_KEY = 'prospector_accounts';

export async function getAccounts(ownerEmails) {
  // Accept either a single email (legacy callers) or an array (Manager/Admin
  // multi-territory load). Normalize to array.
  const emails = Array.isArray(ownerEmails)
    ? ownerEmails.filter(Boolean)
    : (ownerEmails ? [ownerEmails] : []);
  if (!isSupabaseEnabled() || emails.length === 0) {
    try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || 'null') || null; } catch { return null; }
  }
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('data')
      .in('owner_email', emails)
      .order('updated_at', { ascending: true });
    if (error) throw error;
    const accs = (data || []).map(r => r.data).filter(Boolean);
    return accs.length > 0 ? accs : null;
  } catch(e) {
    console.warn('[db] getAccounts Supabase failed, using localStorage:', e.message);
    try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || 'null') || null; } catch { return null; }
  }
}

export async function saveAccountsToDb(ownerEmail, accounts) {
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); } catch {}
  if (!isSupabaseEnabled() || !ownerEmail) return;
  try {
    if (accounts.length === 0) {
      await supabase.from('accounts').delete().eq('owner_email', ownerEmail);
      return;
    }
    const rows = accounts.map(a => ({
      id: String(a.id),
      owner_email: ownerEmail,
      data: a,
      updated_at: new Date().toISOString(),
    }));
    const { error: upsertErr } = await supabase
      .from('accounts')
      .upsert(rows, { onConflict: 'id' });
    if (upsertErr) throw upsertErr;
    // Delete rows for this owner no longer in the list
    const ids = accounts.map(a => String(a.id)).join(',');
    await supabase.from('accounts').delete()
      .eq('owner_email', ownerEmail)
      .not('id', 'in', `(${ids})`);
  } catch(e) {
    console.warn('[db] saveAccounts Supabase failed:', e.message);
  }
}

// ── Business-scoped accounts (business-workspace-v1) ───────────────────────────
// Separate from the global owner_email-keyed accounts above - each business's
// account list is independent, keyed by business_id instead of owner_email.
// A brand-new business genuinely has zero accounts; there is no seeding or
// shared default list.

const bizAccountsKey = businessId => `prospector_accounts_biz_${businessId}`;

export async function getAccountsForBusiness(businessId) {
  if (!businessId) return [];
  if (!isSupabaseEnabled()) {
    try { return JSON.parse(localStorage.getItem(bizAccountsKey(businessId)) || '[]'); } catch { return []; }
  }
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('data')
      .eq('business_id', businessId)
      .order('updated_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(r => r.data).filter(Boolean);
  } catch(e) {
    console.warn('[db] getAccountsForBusiness Supabase failed, using localStorage:', e.message);
    try { return JSON.parse(localStorage.getItem(bizAccountsKey(businessId)) || '[]'); } catch { return []; }
  }
}

export async function saveAccountsForBusiness(businessId, ownerEmail, accounts) {
  if (!businessId) return;
  try { localStorage.setItem(bizAccountsKey(businessId), JSON.stringify(accounts)); } catch {}
  if (!isSupabaseEnabled()) return;
  try {
    if (accounts.length === 0) {
      await supabase.from('accounts').delete().eq('business_id', businessId);
      return;
    }
    const rows = accounts.map(a => ({
      id: String(a.id),
      owner_email: ownerEmail || '',
      business_id: businessId,
      data: a,
      updated_at: new Date().toISOString(),
    }));
    const { error: upsertErr } = await supabase
      .from('accounts')
      .upsert(rows, { onConflict: 'id' });
    if (upsertErr) throw upsertErr;
    const ids = accounts.map(a => String(a.id)).join(',');
    await supabase.from('accounts').delete()
      .eq('business_id', businessId)
      .not('id', 'in', `(${ids})`);
  } catch(e) {
    console.warn('[db] saveAccountsForBusiness Supabase failed:', e.message);
  }
}

export function subscribeToAccounts(ownerEmail, onChange) {
  if (!isSupabaseEnabled() || !ownerEmail) return () => {};
  const channel = supabase
    .channel(`accounts_rt_${ownerEmail}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts', filter: `owner_email=eq.${ownerEmail}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ── Real-time subscriptions ───────────────────────────────────────────────────

export function subscribeToTeamUsers(onChange) {
  if (!isSupabaseEnabled()) return () => {};
  const channel = supabase
    .channel('team_users_rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_users' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export function subscribeToFrontier(onChange) {
  if (!isSupabaseEnabled()) return () => {};
  const channel = supabase
    .channel('frontier_rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'frontier' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ── Compliance ────────────────────────────────────────────────────────────────

export async function getAllComplianceFromDb() {
  if (!isSupabaseEnabled()) return null;
  try {
    const { data, error } = await supabase
      .from('plospect_compliance')
      .select('acc_id, type, steps, last_sfdc_sync');
    if (error) throw error;
    if (!data?.length) return null;
    const map = {};
    for (const row of data) {
      map[row.acc_id] = { type: row.type, steps: row.steps || [], lastSfdcSync: row.last_sfdc_sync };
    }
    return map;
  } catch (e) {
    console.warn('[db] getAllComplianceFromDb failed:', e.message);
    return null;
  }
}

// ── Approved Users (auto-approve allowlist) ──────────────────────────────────
// Backed by the `approved_users` Supabase table (see migrations/001_approved_users.sql).
// Falls back to the hardcoded WHITELISTED_EMAILS in invites.js when Supabase is
// unavailable or the table hasn't been created/seeded yet.

import { WHITELISTED_EMAILS } from './invites';

let _autoApproveCache = null;
let _autoApproveCacheAt = 0;
const AUTO_APPROVE_TTL_MS = 5 * 60 * 1000;

export async function getAutoApproveEmails({ force = false } = {}) {
  const now = Date.now();
  if (!force && _autoApproveCache && now - _autoApproveCacheAt < AUTO_APPROVE_TTL_MS) {
    return _autoApproveCache;
  }
  const fallback = new Set(WHITELISTED_EMAILS.map(e => e.toLowerCase()));
  if (!isSupabaseEnabled()) {
    _autoApproveCache = fallback;
    _autoApproveCacheAt = now;
    return fallback;
  }
  try {
    const { data, error } = await supabase
      .from('approved_users')
      .select('email')
      .eq('auto_approve', true);
    if (error) throw error;
    const set = new Set((data || []).map(r => (r.email || '').toLowerCase()).filter(Boolean));
    // Merge with hardcoded fallback so a wiped table doesn't lock out seed accounts.
    fallback.forEach(e => set.add(e));
    _autoApproveCache = set;
    _autoApproveCacheAt = now;
    return set;
  } catch (e) {
    console.warn('[db] getAutoApproveEmails Supabase failed, using fallback:', e.message);
    _autoApproveCache = fallback;
    _autoApproveCacheAt = now;
    return fallback;
  }
}

export async function isAutoApproved(email) {
  if (!email) return false;
  const set = await getAutoApproveEmails();
  return set.has(email.toLowerCase());
}

// ── User Approval ─────────────────────────────────────────────────────────────

export async function getUserApprovalStatus(userId) {
  if (!isSupabaseEnabled() || !userId) return 'approved';
  try {
    const { data } = await supabase
      .from('team_users')
      .select('status')
      .eq('id', userId)
      .maybeSingle();
    return data?.status || null;
  } catch { return null; }
}

export async function registerUser({ id, name, email, role, status, location }) {
  if (!isSupabaseEnabled() || !id) return;
  try {
    await supabase.from('team_users').upsert({
      id,
      name: name || '',
      email: email || '',
      role: role || 'AE',
      status: status || 'pending',
      location: location || null,
      data: { id, name, email, role, status, location },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
  } catch (e) {
    console.warn('[db] registerUser failed:', e.message);
  }
}

export async function patchUser(userId, patch) {
  if (!isSupabaseEnabled() || !userId) return;
  try {
    await supabase.from('team_users')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', userId);
  } catch (e) {
    console.warn('[db] patchUser failed:', e.message);
  }
}

export async function approveUser(userId) {
  if (!isSupabaseEnabled() || !userId) return;
  try {
    await supabase.from('team_users')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', userId);
  } catch (e) {
    console.warn('[db] approveUser failed:', e.message);
  }
}

export async function getPendingUsers() {
  if (!isSupabaseEnabled()) return [];
  try {
    const { data } = await supabase
      .from('team_users')
      .select('id, name, email, role, status, updated_at')
      .eq('status', 'pending');
    return data || [];
  } catch { return []; }
}

// ── BDR Assignments ───────────────────────────────────────────────────────────

export async function getBdrAssignments(bdrEmail) {
  if (!isSupabaseEnabled() || !bdrEmail) return [];
  try {
    const { data } = await supabase
      .from('bdr_assignments')
      .select('ae_email')
      .eq('bdr_email', bdrEmail.toLowerCase());
    return (data || []).map(r => r.ae_email);
  } catch { return []; }
}

export async function upsertBdrAssignment(bdrEmail, aeEmail) {
  if (!isSupabaseEnabled() || !bdrEmail || !aeEmail) return;
  try {
    await supabase.from('bdr_assignments').upsert({
      bdr_email: bdrEmail.toLowerCase(),
      ae_email:  aeEmail.toLowerCase(),
    }, { onConflict: 'bdr_email,ae_email' });
  } catch (e) {
    console.warn('[db] upsertBdrAssignment failed:', e.message);
  }
}

export async function removeBdrAssignment(bdrEmail, aeEmail) {
  if (!isSupabaseEnabled()) return;
  try {
    await supabase.from('bdr_assignments')
      .delete()
      .eq('bdr_email', bdrEmail.toLowerCase())
      .eq('ae_email', aeEmail.toLowerCase());
  } catch (e) {
    console.warn('[db] removeBdrAssignment failed:', e.message);
  }
}

// ── Handoff Intel ─────────────────────────────────────────────────────────────

export async function getHandoffIntels() {
  if (!isSupabaseEnabled()) return [];
  try {
    const { data, error } = await supabase.from('handoff_intel').select('*').order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('[db] getHandoffIntels failed:', e.message);
    return [];
  }
}

export async function updateHandoffStatus(eventId, patch) {
  if (!isSupabaseEnabled() || !eventId) return;
  try {
    const { error } = await supabase.from('handoff_intel')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('event_id', eventId);
    if (error) throw error;
  } catch (e) {
    console.warn('[db] updateHandoffStatus failed:', e.message);
  }
}

export async function saveHandoffIntel({ eventId, company, meetingDate, intel, source }) {
  if (!isSupabaseEnabled() || !eventId) return;
  try {
    await supabase.from('handoff_intel').upsert({
      event_id:     eventId,
      company:      company || '',
      meeting_date: meetingDate || null,
      intel:        intel || '',
      source:       source || 'BDR',
      updated_at:   new Date().toISOString(),
    }, { onConflict: 'event_id' });
  } catch (e) {
    console.warn('[db] saveHandoffIntel failed:', e.message);
  }
}

export async function saveComplianceToDb(accId, data, accName) {
  if (!isSupabaseEnabled()) return;
  try {
    await supabase.from('plospect_compliance').upsert({
      acc_id: String(accId),
      acc_name: accName || String(accId),
      type: data.type || 'standard',
      steps: data.steps || [],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'acc_id' });
  } catch (e) {
    console.warn('[db] saveComplianceToDb failed:', e.message);
  }
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function getProjectsForUser(email) {
  if (!isSupabaseEnabled() || !email) return [];
  try {
    const { data, error } = await supabase
      .from('project_members')
      .select('role, projects(*)')
      .eq('user_email', email.toLowerCase());
    if (error) throw error;
    return (data || []).filter(r => r.projects).map(r => ({ ...r.projects, role: r.role }));
  } catch (e) {
    console.warn('[db] getProjectsForUser failed:', e.message);
    return [];
  }
}

export async function createProject({ name, color, ownerEmail, businessId }) {
  if (!isSupabaseEnabled() || !ownerEmail) return { error: 'Supabase is not available.' };
  try {
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({ name, color, owner_email: ownerEmail.toLowerCase(), business_id: businessId || null })
      .select()
      .single();
    if (projectError) throw projectError;

    const { error: memberError } = await supabase
      .from('project_members')
      .insert({
        project_id: project.id,
        user_email: ownerEmail.toLowerCase(),
        role: 'owner',
        accepted_at: new Date().toISOString(),
      });
    if (memberError) throw memberError;

    return { project };
  } catch (e) {
    console.warn('[db] createProject failed:', e.message);
    return { error: e.message };
  }
}

// ── Businesses ────────────────────────────────────────────────────────────────
// Standalone layer - separate from projects/project_members/prospects. Does not
// touch or depend on any of that. Creation, intel entries, and profile
// generation go through /api/businesses/* server routes (they call the
// Anthropic API), not direct Supabase writes here - see api/businesses/.

export async function getBusinessesForUser(email) {
  if (!isSupabaseEnabled() || !email) return [];
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('owner_email', email.toLowerCase())
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('[db] getBusinessesForUser failed:', e.message);
    return [];
  }
}

// ── Member sessions (business-lists-and-permissions-v1) ────────────────────────
// Joining members (via /join/:code) aren't Jack - they get their own email-keyed
// identity, separate from the legacy owner_email/user model above. A member's
// businesses are the union of what they own outright (same owner_email path as
// Jack) and what they've joined as a permissioned member.

export async function getBusinessesForMember(email) {
  if (!isSupabaseEnabled() || !email) return [];
  const lower = email.toLowerCase();
  try {
    const [ownedRes, memberRowsRes] = await Promise.all([
      supabase.from('businesses').select('*').eq('owner_email', lower),
      supabase.from('business_members').select('business_id').eq('email', lower),
    ]);
    if (ownedRes.error) throw ownedRes.error;
    if (memberRowsRes.error) throw memberRowsRes.error;

    const memberBusinessIds = (memberRowsRes.data || []).map(r => r.business_id);
    let joined = [];
    if (memberBusinessIds.length) {
      const { data, error } = await supabase.from('businesses').select('*').in('id', memberBusinessIds);
      if (error) throw error;
      joined = data || [];
    }

    const byId = new Map();
    [...(ownedRes.data || []), ...joined].forEach(b => byId.set(b.id, b));
    return [...byId.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } catch (e) {
    console.warn('[db] getBusinessesForMember failed:', e.message);
    return [];
  }
}

// ── Lists + member permissions (business-lists-and-permissions-v1) ─────────────
// Owner-only settings screen: create/rename/delete lists, grant/revoke
// per-member-per-list view/edit. Direct Supabase writes from the browser -
// same permissive-RLS posture as every other CRUD path in this app
// (ProjectsSection/createProject etc.), no server route needed.

export async function getListsForBusiness(businessId) {
  if (!isSupabaseEnabled() || !businessId) return [];
  try {
    const { data, error } = await supabase.from('lists').select('*').eq('business_id', businessId).order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('[db] getListsForBusiness failed:', e.message);
    return [];
  }
}

export async function createList(businessId, name) {
  try {
    const { data, error } = await supabase.from('lists').insert({ business_id: businessId, name: name.trim() }).select().single();
    if (error) throw error;
    return { list: data };
  } catch (e) {
    console.warn('[db] createList failed:', e.message);
    return { error: e.message };
  }
}

export async function renameList(listId, name) {
  try {
    const { error } = await supabase.from('lists').update({ name: name.trim() }).eq('id', listId);
    if (error) throw error;
    return { error: null };
  } catch (e) {
    console.warn('[db] renameList failed:', e.message);
    return { error: e.message };
  }
}

export async function deleteList(listId) {
  try {
    const { error } = await supabase.from('lists').delete().eq('id', listId);
    if (error) throw error;
    return { error: null };
  } catch (e) {
    console.warn('[db] deleteList failed:', e.message);
    return { error: e.message };
  }
}

export async function getMembersForBusiness(businessId) {
  if (!isSupabaseEnabled() || !businessId) return [];
  try {
    const { data, error } = await supabase.from('business_members').select('*').eq('business_id', businessId).order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('[db] getMembersForBusiness failed:', e.message);
    return [];
  }
}

export async function getPermissionsForMembers(memberIds) {
  if (!isSupabaseEnabled() || !memberIds?.length) return [];
  try {
    const { data, error } = await supabase.from('member_list_permissions').select('*').in('member_id', memberIds);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('[db] getPermissionsForMembers failed:', e.message);
    return [];
  }
}

// level: 'none' | 'view' | 'edit'. 'none' deletes the row - absence of a row
// already means no access, so this keeps the table minimal (no dead false/false rows).
export async function setMemberListPermission(memberId, listId, level) {
  try {
    if (level === 'none') {
      const { error } = await supabase.from('member_list_permissions').delete().eq('member_id', memberId).eq('list_id', listId);
      if (error) throw error;
      return { error: null };
    }
    const { error } = await supabase.from('member_list_permissions').upsert(
      { member_id: memberId, list_id: listId, can_view: true, can_edit: level === 'edit' },
      { onConflict: 'member_id,list_id' }
    );
    if (error) throw error;
    return { error: null };
  } catch (e) {
    console.warn('[db] setMemberListPermission failed:', e.message);
    return { error: e.message };
  }
}
