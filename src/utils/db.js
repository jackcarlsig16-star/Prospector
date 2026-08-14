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
      .select('data, last_touched_by, last_touched_at, account_kind')
      .eq('business_id', businessId)
      .order('updated_at', { ascending: true });
    if (error) throw error;
    // last_touched_by/at and account_kind are real columns, not part of the
    // data blob - merge them in so callers see one flat account object
    // either way (accounts-lists-and-activity-model-v1, influencer-accounts-v1).
    return (data || []).filter(r => r.data).map(r => ({ ...r.data, lastTouchedBy: r.last_touched_by || null, lastTouchedAt: r.last_touched_at || null, accountKind: r.account_kind || 'business' }));
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

// Chunked pure-insert for CSV import - unlike saveAccountsForBusiness (which
// replaces the whole account set for a business), this only adds new rows
// and never touches existing ones. Chunked so a large CSV doesn't attempt
// one massive insert (csv-account-import-v1). listIds is per-account now -
// lists are a many-to-many grouping lens, never ownership
// (accounts-lists-and-activity-model-v1) - each new account gets a row in
// account_lists per list it was imported into, plus last_touched_by/at
// stamped directly (cheaper than an insert-then-update round trip for a
// brand new row - recordAccountActivity is reserved for touches on an
// account that already exists).
const IMPORT_CHUNK_SIZE = 200;
export async function bulkCreateAccountsForBusiness(businessId, ownerEmail, memberEmail, accountObjects) {
  if (!businessId || !accountObjects?.length) return { inserted: 0, error: null };
  if (!isSupabaseEnabled()) return { inserted: 0, error: 'Supabase is not available.' };
  let inserted = 0;
  for (let i = 0; i < accountObjects.length; i += IMPORT_CHUNK_SIZE) {
    const chunk = accountObjects.slice(i, i + IMPORT_CHUNK_SIZE);
    const now = new Date().toISOString();
    const rows = chunk.map(a => ({
      id: String(a.id),
      owner_email: ownerEmail || '',
      business_id: businessId,
      last_touched_by: memberEmail || null,
      last_touched_at: now,
      data: a,
      updated_at: now,
    }));
    const { error } = await supabase.from('accounts').insert(rows);
    if (error) return { inserted, error: error.message };
    const linkRows = chunk.flatMap(a => (a.listIds || []).map(listId => ({ account_id: String(a.id), list_id: listId })));
    if (linkRows.length) {
      const { error: linkErr } = await supabase.from('account_lists').insert(linkRows);
      if (linkErr) return { inserted, error: linkErr.message };
    }
    inserted += chunk.length;
  }
  return { inserted, error: null };
}

// Links an already-existing (deduped) account to one or more additional
// lists, without creating a second account row - "adding via a list either
// Strips @ / URL wrapper down to a bare handle so "https://instagram.com/nasa/",
// "@nasa", and "nasa" all dedupe to the same key (influencer-accounts-v1).
export function normalizeInstagramHandle(raw) {
  if (!raw) return '';
  let h = raw.trim();
  const urlMatch = h.match(/instagram\.com\/([^/?#]+)/i);
  if (urlMatch) h = urlMatch[1];
  return h.replace(/^@/, '').toLowerCase().trim();
}

// Creates an account (account_kind='influencer') + its 1:1 detail row.
// Dedup keys on instagram_handle, not name/website - a separate mode from
// the business-account exact-match dedup in normAccount.js, since a handle
// is the real identity here (influencer-accounts-v1, Phase 0 audit finding
// that the existing dedup logic needed a second mode, not a rewrite).
export async function findExistingInfluencerByHandle(businessId, handle) {
  const norm = normalizeInstagramHandle(handle);
  if (!norm || !businessId) return null;
  const { data, error } = await supabase.from('account_influencer_details').select('account_id, instagram_handle');
  if (error) { console.warn('[db] findExistingInfluencerByHandle failed:', error.message); return null; }
  const match = (data || []).find(d => normalizeInstagramHandle(d.instagram_handle) === norm);
  if (!match) return null;
  const { data: acc } = await supabase.from('accounts').select('id, data').eq('id', match.account_id).eq('business_id', businessId).maybeSingle();
  return acc ? { id: acc.id, name: acc.data?.name } : null;
}

export async function createInfluencerAccount(businessId, ownerEmail, handle, listIds = []) {
  const norm = normalizeInstagramHandle(handle);
  const id = `influencer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const accountData = { id, name: `@${norm}`, addedSource: 'influencer_add', addedAt: now };
  const { error: accErr } = await supabase.from('accounts').insert({
    id, owner_email: ownerEmail || '', business_id: businessId, account_kind: 'influencer', data: accountData, updated_at: now,
  });
  if (accErr) return { error: accErr.message };
  const { error: detErr } = await supabase.from('account_influencer_details').insert({
    account_id: id, instagram_handle: norm, instagram_url: `https://instagram.com/${norm}/`, assessment_status: 'pending',
  });
  if (detErr) return { error: detErr.message };
  if (listIds.length) await linkAccountToLists(id, listIds);
  return { account: accountData };
}

export async function getInfluencerDetails(accountIds) {
  if (!accountIds?.length || !isSupabaseEnabled()) return {};
  const { data, error } = await supabase.from('account_influencer_details').select('*').in('account_id', accountIds);
  if (error) { console.warn('[db] getInfluencerDetails failed:', error.message); return {}; }
  const map = {};
  (data || []).forEach(d => { map[d.account_id] = d; });
  return map;
}

// creates it, or links the existing deduped account to that list"
// (accounts-lists-and-activity-model-v1). Ignores lists it's already on.
export async function linkAccountToLists(accountId, listIds) {
  if (!accountId || !listIds?.length) return { error: null };
  const rows = listIds.map(listId => ({ account_id: accountId, list_id: listId }));
  const { error } = await supabase.from('account_lists').upsert(rows, { onConflict: 'account_id,list_id', ignoreDuplicates: true });
  return { error: error?.message || null };
}

export async function getListIdsForAccount(accountId) {
  if (!accountId || !isSupabaseEnabled()) return [];
  const { data, error } = await supabase.from('account_lists').select('list_id').eq('account_id', accountId);
  if (error) { console.warn('[db] getListIdsForAccount failed:', error.message); return []; }
  return (data || []).map(r => r.list_id);
}

// Every account_lists row for a business's accounts in one query, keyed by
// account_id -> [list_id, ...] - avoids N+1 queries when rendering a list
// filter over many accounts.
export async function getAccountListMapForBusiness(businessId) {
  if (!businessId || !isSupabaseEnabled()) return {};
  const { data: accs, error: accErr } = await supabase.from('accounts').select('id').eq('business_id', businessId);
  if (accErr || !accs?.length) return {};
  const ids = accs.map(a => a.id);
  const { data, error } = await supabase.from('account_lists').select('account_id, list_id').in('account_id', ids);
  if (error) { console.warn('[db] getAccountListMapForBusiness failed:', error.message); return {}; }
  const map = {};
  (data || []).forEach(r => { (map[r.account_id] = map[r.account_id] || []).push(r.list_id); });
  return map;
}

export async function removeAccountFromList(accountId, listId) {
  if (!accountId || !listId) return { error: null };
  const { error } = await supabase.from('account_lists').delete().eq('account_id', accountId).eq('list_id', listId);
  return { error: error?.message || null };
}

// Client-side twin of shared.js's recordAccountActivity (server-side) - see
// that function's comment for why this app has one per runtime instead of
// one shared module (accounts-lists-and-activity-model-v1).
export async function recordAccountActivity(accountId, memberEmail, type, note) {
  const { data: account, error: fetchErr } = await supabase.from('accounts').select('data').eq('id', accountId).single();
  if (fetchErr) return { error: fetchErr.message };
  const existingNotes = account.data?.handoffNotes || '';
  const stamp = `[${type} · ${new Date().toLocaleDateString()}] ${note}`;
  const nextNotes = existingNotes ? `${existingNotes}\n\n${stamp}` : stamp;
  const now = new Date().toISOString();
  const { error } = await supabase.from('accounts')
    .update({ data: { ...account.data, handoffNotes: nextNotes }, last_touched_by: memberEmail || null, last_touched_at: now, updated_at: now })
    .eq('id', accountId);
  return { error: error?.message || null };
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

// Routes through projects.owner_email directly, same pattern as
// getBusinessesForUser - project_members (the old multi-user membership
// table) has been broken (PGRST205, not in schema cache) since early
// August and is abandoned, not fixed. A real project-membership feature
// is a planned follow-up using the business_members/permissions pattern
// instead (smart-intake-and-intelligence-v1).
export async function getProjectsForUser(email) {
  if (!isSupabaseEnabled() || !email) return [];
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('owner_email', email.toLowerCase())
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('[db] getProjectsForUser failed:', e.message);
    return [];
  }
}

export async function createProject({ name, color, ownerEmail, businessId, listId }) {
  if (!isSupabaseEnabled() || !ownerEmail) return { error: 'Supabase is not available.' };
  try {
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({ name, color, owner_email: ownerEmail.toLowerCase(), business_id: businessId || null, list_id: listId || null })
      .select()
      .single();
    if (projectError) throw projectError;
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

export async function getAccountCountForList(listId) {
  if (!listId || !isSupabaseEnabled()) return 0;
  const { count, error } = await supabase.from('account_lists').select('*', { count: 'exact', head: true }).eq('list_id', listId);
  if (error) { console.warn('[db] getAccountCountForList failed:', error.message); return 0; }
  return count || 0;
}

// Safe by construction, not by app-level care: account_lists.list_id and
// member_list_permissions.list_id both cascade ON DELETE from lists (id) -
// deleting a list only ever removes its own row, its account_lists links,
// and its member_list_permissions rows. Accounts themselves have no FK to
// lists at all anymore (join table, not ownership) so they're structurally
// unreachable by this delete (accounts-lists-and-activity-model-v1, Phase 7).
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
