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
    // business_id IS NULL - without this, business-scoped accounts sharing
    // this owner_email (any account on a business this user owns) load into
    // the legacy Territory view too, undifferentiated from real legacy data
    // (territory-business-scope-fix-v1, confirmed live: both real accounts
    // on this DB under jackcarlsig16@gmail.com were business-scoped leaks,
    // not genuine legacy rows).
    const { data, error } = await supabase
      .from('accounts')
      .select('data')
      .in('owner_email', emails)
      .is('business_id', null)
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
  invalidateAccountsCache();
  try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); } catch {}
  if (!isSupabaseEnabled() || !ownerEmail) return;
  try {
    // business_id IS NULL on every delete below - this is the write-side
    // half of the same fix as getAccounts() above. Without it, this
    // function's delete-not-in-set (and the empty-array full-delete) would
    // treat any business-scoped account sharing this owner_email as "not in
    // the current legacy set" and silently wipe it from Supabase on a
    // routine Territory autosave (territory-business-scope-fix-v1) - a real
    // risk, not hypothetical: this was the actual mechanism that could have
    // deleted The Coconut Cult / @aldknudsen43 the next time Territory's
    // in-memory list dropped them for any reason.
    if (accounts.length === 0) {
      await supabase.from('accounts').delete().eq('owner_email', ownerEmail).is('business_id', null);
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
      .is('business_id', null)
      .not('id', 'in', `(${ids})`);
  } catch(e) {
    console.warn('[db] saveAccounts Supabase failed:', e.message);
  }
}

// assay-safety-and-intel-visibility-v1 — targeted single-row write for
// re-assay, which used to rely entirely on the generic saveAccountsToDb
// effect (full-array upsert) as its only path to Supabase. That effect is
// fire-and-forget and untracked from the caller's side, so a re-assay result
// could silently fail to persist with no signal to the user. This gives
// re-assay a real, awaitable write it can confirm and surface errors from.
// Does not replace the generic autosave (still fires via setAccounts as
// before, for every other flow that depends on it) - additive, not a
// narrowing of saveAccountsToDb's own behavior.
export async function updateAccountRow(accountId, data) {
  invalidateAccountsCache();
  if (!isSupabaseEnabled()) return { error: null };
  try {
    const { error } = await supabase
      .from('accounts')
      .update({ data, updated_at: new Date().toISOString() })
      .eq('id', String(accountId));
    if (error) return { error: error.message };
    return { error: null };
  } catch (e) {
    return { error: e.message };
  }
}

// account-taxonomy-and-creation-upgrade-v1 Stage 4 - targeted single-column
// update, same shape as updateAccountRow but for the real relationship_type
// column instead of the data blob. Deliberately not folded into the bulk
// saveAccountsForBusiness() upsert (which omits account_kind for the same
// reason) - a routine "save all accounts" shouldn't silently reset a value
// nobody touched.
export async function updateAccountRelationshipType(accountId, relationshipType) {
  invalidateAccountsCache();
  if (!isSupabaseEnabled()) return { error: null };
  try {
    const { error } = await supabase
      .from('accounts')
      .update({ relationship_type: relationshipType, updated_at: new Date().toISOString() })
      .eq('id', String(accountId));
    if (error) return { error: error.message };
    return { error: null };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Business-scoped accounts (business-workspace-v1) ───────────────────────────
// Separate from the global owner_email-keyed accounts above - each business's
// account list is independent, keyed by business_id instead of owner_email.
// A brand-new business genuinely has zero accounts; there is no seeding or
// shared default list.

const bizAccountsKey = businessId => `prospector_accounts_biz_${businessId}`;

// getaccounts-for-business-cascade-dedupe-v1 — real measured problem: three
// components mount together on a business page and each independently calls
// this helper for the same business_id. Traced on HomeLover's Command Center:
// 4 byte-identical fetches of the same 62 rows, 170,481 bytes each, inside
// 675ms (SmartIntakeBox.js:190 + BusinessCommandCenterTab.js:43 once each,
// PersistentScout.js:106 twice - its own cacheRef only populates after the
// await, so two rapid effect fires both miss it).
//
// The cached value is the PROMISE, not the resolved array, which is what
// collapses a concurrent burst into one request. The short TTL then covers
// the non-overlapping tail of that same burst without holding data long
// enough to go stale - deliberately not a long-lived cache, because accounts
// are also created server-side (api/businesses/intake-confirm.js:52) where a
// client-side invalidation hook could never fire.
const accountsCache = new Map();
const ACCOUNTS_CACHE_TTL_MS = 10000;

// Cleared by every account-mutating write below. Takes no argument on
// purpose: several of those writes are keyed by accountId with no business_id
// in scope, and clearing all of it just costs one refetch.
export function invalidateAccountsCache() {
  accountsCache.clear();
}

export async function getAccountsForBusiness(businessId) {
  if (!businessId) return [];
  const hit = accountsCache.get(businessId);
  if (hit && Date.now() - hit.at < ACCOUNTS_CACHE_TTL_MS) return hit.promise;
  const promise = fetchAccountsForBusiness(businessId);
  accountsCache.set(businessId, { at: Date.now(), promise });
  promise.catch(() => accountsCache.delete(businessId));
  return promise;
}

async function fetchAccountsForBusiness(businessId) {
  if (!isSupabaseEnabled()) {
    try { return JSON.parse(localStorage.getItem(bizAccountsKey(businessId)) || '[]'); } catch { return []; }
  }
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('data, last_touched_by, last_touched_at, account_kind, relationship_type')
      .eq('business_id', businessId)
      .order('updated_at', { ascending: true });
    if (error) throw error;
    // last_touched_by/at, account_kind, and relationship_type are real
    // columns, not part of the data blob - merge them in so callers see one
    // flat account object either way (accounts-lists-and-activity-model-v1,
    // influencer-accounts-v1, account-taxonomy-and-creation-upgrade-v1).
    return (data || []).filter(r => r.data).map(r => ({ ...r.data, lastTouchedBy: r.last_touched_by || null, lastTouchedAt: r.last_touched_at || null, accountKind: r.account_kind || 'business', relationshipType: r.relationship_type || 'Prospect/Lead' }));
  } catch(e) {
    console.warn('[db] getAccountsForBusiness Supabase failed, using localStorage:', e.message);
    try { return JSON.parse(localStorage.getItem(bizAccountsKey(businessId)) || '[]'); } catch { return []; }
  }
}

export async function saveAccountsForBusiness(businessId, ownerEmail, accounts) {
  invalidateAccountsCache();
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
  invalidateAccountsCache();
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
      // generation-engine-consolidation-v1 Stage 5 - relationship_type is a
      // real, dedicated column (never read from data.relationshipType, see
      // getAccountsForBusiness below), so a CSV-import directive setting it
      // has to land here at insert time, not just inside the data blob. Safe
      // to set unconditionally on insert (unlike saveAccountsForBusiness's
      // bulk upsert, which deliberately omits it to avoid resetting an
      // existing value nobody touched) - these are brand-new rows, nothing
      // to reset.
      ...(a.relationshipType ? { relationship_type: a.relationshipType } : {}),
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
  invalidateAccountsCache();
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

// account-business-details-v1 — mirrors getInfluencerDetails exactly.
export async function getBusinessDetails(accountIds) {
  if (!accountIds?.length || !isSupabaseEnabled()) return {};
  const { data, error } = await supabase.from('account_business_details').select('*').in('account_id', accountIds);
  if (error) { console.warn('[db] getBusinessDetails failed:', error.message); return {}; }
  const map = {};
  (data || []).forEach(d => { map[d.account_id] = d; });
  return map;
}

// account-business-details-v1 — the narrow-scope write path (single +
// bulk re-assay in AccountsPage.js only, per Jack's Option 3 decision).
// Upsert, not insert - a re-assay on an already-assessed account replaces
// its one current snapshot, no history kept (deliberately deferred).
export async function upsertAccountBusinessDetails(accountId, patch) {
  if (!isSupabaseEnabled() || !accountId) return { error: null };
  const row = { account_id: accountId, assessment_status: 'assessed', last_assayed_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...patch };
  const { data, error } = await supabase.from('account_business_details').upsert(row, { onConflict: 'account_id' }).select().single();
  if (error) { console.warn('[db] upsertAccountBusinessDetails failed:', error.message); return { error: error.message }; }
  return { detail: data };
}

// Relationship fields (stage/temperature/priority/next_action/decline_reason/
// tags) live on account_influencer_details, not accounts.data - a separate
// write path from the generic onUpdate()/persist() flow business accounts
// use (influencer-card-v2, Phase 3-4). Only a stage change is a real logged
// action; temperature/priority/next_action/tags are lower-stakes manual
// triage fields that don't warrant an activity-log entry on every edit.
// outreach-intelligence-v1 Section 0a — voice profiles were localStorage-only
// (keyed by display name), invisible to any server-side flow. Dual-write:
// this runs alongside the existing localStorage write, never replaces it.
export async function saveVoiceProfile(userEmail, profile) {
  if (!isSupabaseEnabled() || !userEmail) return { error: null };
  const row = {
    user_email: userEmail.toLowerCase(),
    profile,
    learned_at: profile.learnedAt || null,
    email_count: profile.emailCount || null,
    teach_count: profile.teachCount || 0,
  };
  const { error } = await supabase.from('voice_profiles').upsert(row, { onConflict: 'user_email' });
  return { error: error?.message || null };
}

export async function getVoiceProfileForEmail(userEmail) {
  if (!isSupabaseEnabled() || !userEmail) return null;
  const { data, error } = await supabase.from('voice_profiles').select('profile').eq('user_email', userEmail.toLowerCase()).maybeSingle();
  if (error || !data) return null;
  return data.profile;
}

// project-guidance-and-creation-flow-v1 — structured guidance fields
// (objective/target_type/ask_type/project_hook/exclusions/outreach_example),
// same "person types it, stays until changed" posture as the outreach_prompt
// field this replaces - no generate/regenerate, no auto-overwrite risk.
// intake-confirm-proxy-timeout-v1 — single-project read, for polling
// strategy_sync_status while a background resynthesis is in flight
// (SmartIntakeBox's internal_meeting confirm). No existing "get one
// project" helper - every other project read in this file returns a list.
export async function getProject(projectId) {
  if (!isSupabaseEnabled() || !projectId) return null;
  const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).maybeSingle();
  if (error) return null;
  return data;
}

// project-timestamp-staleness-fix-v1 — updated_at is set explicitly here (and
// on every other real projects content write) because nothing maintains it
// automatically: there is no Postgres trigger anywhere in supabase/migrations,
// so the column only ever held its insert-time default and read as
// "created_at" forever. Matches updateCampaign's existing convention.
export async function updateProjectGuidance(projectId, patch) {
  if (!isSupabaseEnabled() || !projectId) return { error: null };
  const { data, error } = await supabase.from('projects').update({ ...patch, guidance_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', projectId).select().single();
  if (error) return { error: error.message };
  return { project: data };
}

export async function updateInfluencerRelationship(accountId, memberEmail, patch) {
  const { data: updated, error } = await supabase.from('account_influencer_details').update(patch).eq('account_id', accountId).select().single();
  if (error) return { error: error.message };
  if (patch.relationship_stage) {
    await recordAccountActivity(accountId, memberEmail, 'relationship_stage', `Relationship stage → ${patch.relationship_stage.replace(/_/g, ' ')}`);
  }
  return { detail: updated };
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
// outreach-intelligence-v1 Section 4 — resolves "accounts in this project"
// via project.list_id -> account_lists -> accounts. accounts.project_id
// exists in the schema but is never written by any application code
// (confirmed live, grep across src/ and api/) - not a usable path.
export async function getAccountsForProjectList(businessId, listId) {
  if (!businessId || !listId || !isSupabaseEnabled()) return [];
  const { data: links, error: linkError } = await supabase.from('account_lists').select('account_id').eq('list_id', listId);
  if (linkError || !links?.length) return [];
  const ids = links.map(l => l.account_id);
  const { data, error } = await supabase.from('accounts').select('id, data, last_touched_by, last_touched_at, account_kind, relationship_type').eq('business_id', businessId).in('id', ids);
  if (error) return [];
  return (data || []).filter(r => r.data).map(r => ({ ...r.data, id: r.id, lastTouchedBy: r.last_touched_by || null, lastTouchedAt: r.last_touched_at || null, accountKind: r.account_kind || 'business', relationshipType: r.relationship_type || 'Prospect/Lead' }));
}

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

// Client-side twin of shared.js's recordAccountActivity (server-side) - see
// that function's comment for why this app has one per runtime instead of
// one shared module (accounts-lists-and-activity-model-v1).
export async function recordAccountActivity(accountId, memberEmail, type, note) {
  invalidateAccountsCache();
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

// ── Real-time subscriptions ───────────────────────────────────────────────────
// The three subscribeTo* functions below are deliberately unwired groundwork for
// future multi-user support — inert by design, NOT dead code. They have zero
// callers today and that is expected; do not remove them on zero-caller grep
// evidence alone. A dead-code scan has already flagged them once.

export function subscribeToAccounts(ownerEmail, onChange) {
  if (!isSupabaseEnabled() || !ownerEmail) return () => {};
  const channel = supabase
    .channel(`accounts_rt_${ownerEmail}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts', filter: `owner_email=eq.${ownerEmail}` }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}

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

export async function setProjectListId(projectId, listId) {
  try {
    const { data, error } = await supabase.from('projects').update({ list_id: listId, updated_at: new Date().toISOString() }).eq('id', projectId).select().single();
    if (error) throw error;
    return { project: data };
  } catch (e) {
    console.warn('[db] setProjectListId failed:', e.message);
    return { error: e.message };
  }
}

export async function createProject({ name, color, ownerEmail, businessId, listId, objective, targetType, askType, projectHook, exclusions }) {
  if (!isSupabaseEnabled() || !ownerEmail) return { error: 'Supabase is not available.' };
  try {
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({
        name, color, owner_email: ownerEmail.toLowerCase(), business_id: businessId || null, list_id: listId || null,
        objective: objective || null, target_type: targetType || null, ask_type: askType || null,
        project_hook: projectHook || null, exclusions: exclusions || null,
        guidance_updated_at: objective ? new Date().toISOString() : null,
      })
      .select()
      .single();
    if (projectError) throw projectError;
    return { project };
  } catch (e) {
    console.warn('[db] createProject failed:', e.message);
    return { error: e.message };
  }
}

// campaign-layer-v1 — a Campaign is a nested pitch angle under a Project.
// Plain field writes, no server route, mirroring createProject()'s direct-
// client-to-Supabase pattern exactly (confirmed via live audit: Project
// create/update has no server route at all — only the AI-calling
// outreach-examples endpoints do). businessId is required on campaigns
// (not nullable, unlike projects.business_id) since a Campaign only ever
// exists nested under a business-scoped Project.
export async function createCampaign({ projectId, businessId, listId, name, recipientDescription, doctrine }) {
  if (!isSupabaseEnabled() || !projectId || !businessId) return { error: 'Supabase is not available.' };
  try {
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .insert({
        project_id: projectId, business_id: businessId, list_id: listId || null,
        name, recipient_description: recipientDescription || null, doctrine: doctrine || null,
      })
      .select()
      .single();
    if (campaignError) throw campaignError;
    return { campaign };
  } catch (e) {
    console.warn('[db] createCampaign failed:', e.message);
    return { error: e.message };
  }
}

export async function updateCampaign(campaignId, patch) {
  if (!isSupabaseEnabled() || !campaignId) return { error: null };
  const { data, error } = await supabase.from('campaigns').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', campaignId).select().single();
  if (error) return { error: error.message };
  return { campaign: data };
}

export async function setCampaignListId(campaignId, listId) {
  try {
    const { data, error } = await supabase.from('campaigns').update({ list_id: listId }).eq('id', campaignId).select().single();
    if (error) throw error;
    return { campaign: data };
  } catch (e) {
    console.warn('[db] setCampaignListId failed:', e.message);
    return { error: e.message };
  }
}

export async function getCampaignsForProjects(projectIds) {
  if (!isSupabaseEnabled() || !projectIds?.length) return [];
  try {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('[db] getCampaignsForProjects failed:', e.message);
    return [];
  }
}

// intake-field-extraction-and-bulk-split-v1 — single-campaign read,
// mirrors getProject() above exactly, for polling field_extraction_status
// while a background extraction is in flight.
export async function getCampaign(campaignId) {
  if (!isSupabaseEnabled() || !campaignId) return null;
  const { data, error } = await supabase.from('campaigns').select('*').eq('id', campaignId).maybeSingle();
  if (error) return null;
  return data;
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

// ── Outreach Doctrine (outreach-intelligence-doctrine-v1) ──────────────────────
// Platform-scope (no business_id) - one shared set of rows every business's
// generation reads, not per-business like outreach_rules. Returns every row,
// active and inactive, so the admin tab can show deactivated history -
// callers filter to active themselves (api/email.js does .eq('active', true)
// server-side instead, since it only ever wants the live set).

export async function getOutreachDoctrine() {
  if (!isSupabaseEnabled()) return [];
  try {
    const { data, error } = await supabase.from('outreach_doctrine').select('*').order('category').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('[db] getOutreachDoctrine failed:', e.message);
    return [];
  }
}

export async function createOutreachDoctrineRule({ category, ruleText, isHardConstraint, sourceAttribution, createdBy, aiAssisted }) {
  if (!isSupabaseEnabled()) return { rule: null, error: 'Supabase is not available.' };
  try {
    const { data, error } = await supabase.from('outreach_doctrine').insert({
      category, rule_text: ruleText, is_hard_constraint: !!isHardConstraint,
      source_attribution: sourceAttribution || null, created_by: createdBy || null,
      ai_assisted: !!aiAssisted,
    }).select().maybeSingle();
    if (error) throw error;
    return { rule: data, error: null };
  } catch (e) {
    return { rule: null, error: e.message };
  }
}

// Same targeted-update shape as updateAccountRelationshipType - only the
// fields actually passed get touched, updated_at stamped either way.
export async function updateOutreachDoctrineRule(id, patch) {
  if (!isSupabaseEnabled()) return { rule: null, error: 'Supabase is not available.' };
  try {
    const { data, error } = await supabase.from('outreach_doctrine').update({
      ...patch, updated_at: new Date().toISOString(),
    }).eq('id', id).select().maybeSingle();
    if (error) throw error;
    return { rule: data, error: null };
  } catch (e) {
    return { rule: null, error: e.message };
  }
}

// generation-modal-advanced-inputs-v1 — same columns, same table, same
// filter as api/email.js's server-side read (api/email.js:124-129) - not a
// parallel derivation, just making that same real read reachable client-
// side so EmailModal.js's Advanced panel can show what generation actually
// composes with. Fetched lazily (only when Advanced is opened), not on
// every modal open - business_profiles isn't otherwise loaded here.
export async function getBusinessProfileSummary(businessId) {
  if (!isSupabaseEnabled() || !businessId) return null;
  try {
    const { data, error } = await supabase.from('business_profiles').select('assay_criteria, outreach_rules').eq('business_id', businessId).maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (e) {
    console.warn('[db] getBusinessProfileSummary failed:', e.message);
    return null;
  }
}
