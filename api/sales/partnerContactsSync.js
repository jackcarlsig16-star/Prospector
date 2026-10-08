import { apolloRequest, CallCapError } from './apolloClient.js';
import { isBotOpen } from './heatScore.js';
import { laDateString } from './laDate.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { matchApolloAccounts, confirmedDomains } from '../../src/constants/partnerDomains.js';

// partner-360-v1 Stage 3 - the people Apollo knows at a partner, read-only.
// One POST /contacts/search per partner whose CONFIRMED domain is an Apollo
// account (account_ids filter - echoed in breadcrumbs AND every contact
// carried that account_id, probed live 2026-10-07). emailer_messages/search
// is deliberately not used: it echoes contact_ids in breadcrumbs but ignores
// the filter (100 messages across 100 other contacts came back), so message
// history comes only from rows the activity step already stored.
export const PARTNER_CONTACTS_MAX_CALLS = 20;
const PER_PAGE = 100;
const MAX_PAGES_PER_PARTNER = 2;

// Named columns only - the raw contact also carries phone fields, which are
// never read (Apollo phone reveals cost credits; Jack, 2026-10-01).
export function contactRow(businessId, goalId, c) {
  const name = (c.name || [c.first_name, c.last_name].filter(Boolean).join(' ')).trim().replace(/\s+/g, ' ').slice(0, 120);
  const email = typeof c.email === 'string' && c.email.includes('@') ? c.email.trim().toLowerCase().slice(0, 254) : null;
  const linkedin = typeof c.linkedin_url === 'string' && /^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(c.linkedin_url) ? c.linkedin_url : null;
  if (!name) return null;
  return {
    business_id: businessId, goal_id: goalId, apollo_contact_id: c.id, name,
    title: typeof c.title === 'string' && c.title.trim() ? c.title.trim().slice(0, 160) : null,
    email, linkedin_url: linkedin, source: 'apollo', updated_at: new Date().toISOString(),
  };
}

// The newest thing we have stored about this contact: a reply beats a click
// beats a human open beats a delivery on the same instant. Reply has no
// timestamp from Apollo, so it's dated at the message's delivery.
const RANK = { reply: 4, click: 3, open: 2, bounce: 1, sent: 0 };
export function lastActivity(messages = [], events = []) {
  const deliveredById = new Map(messages.map(m => [m.apollo_message_id, m.delivered_at]));
  const candidates = [];
  for (const m of messages) {
    if (!m.delivered_at) continue;
    candidates.push({ at: m.delivered_at, type: m.bounced ? 'bounce' : 'sent' });
    if (m.replied) candidates.push({ at: m.delivered_at, type: 'reply' });
  }
  for (const e of events) {
    if (e.event === 'open' && isBotOpen(e, deliveredById.get(e.apollo_message_id))) continue;
    if (e.event === 'open' || e.event === 'click') candidates.push({ at: e.occurred_at, type: e.event });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || RANK[b.type] - RANK[a.type]);
  return { last_activity_at: candidates[0].at, last_activity_type: candidates[0].type };
}

// A run already synced partner people today (LA) if a non-error run today
// carries a partner_contacts block. The 36h lookback mirrors sync.js.
export async function ranToday(supabase, businessId) {
  const { data, error } = await supabase.from('sales_sync_runs').select('started_at, status, counts')
    .eq('business_id', businessId).gte('started_at', new Date(Date.now() - 36 * 3600 * 1000).toISOString());
  if (error) throw new Error(`partner contacts: read runs failed: ${error.message}`);
  const today = laDateString();
  return (data || []).some(r => r.status !== 'error' && r.counts?.partner_contacts && laDateString(new Date(r.started_at)) === today);
}

async function latestAccounts(supabase, businessId) {
  const { data, error } = await supabase.from('sales_raw_snapshots').select('payload')
    .eq('business_id', businessId).eq('entity', 'accounts').order('captured_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`partner contacts: read snapshot failed: ${error.message}`);
  return Array.isArray(data?.payload) ? data.payload : [];
}

// Partners whose confirmed domain is an Apollo account's domain (name-only
// matches are not synced - the spec keys People on confirmed domains).
export function partnersToSync(goals, rowsByGoal, accounts) {
  const out = [];
  for (const g of goals) {
    const { byDomain } = matchApolloAccounts({ name: g.name, domains: confirmedDomains(rowsByGoal[g.id]) }, accounts);
    if (byDomain[0]) out.push({ goal: g, account: byDomain[0] });
  }
  return out;
}

async function fetchContacts(ctx, accountId) {
  const contacts = [];
  for (let page = 1; page <= MAX_PAGES_PER_PARTNER; page++) {
    const json = await apolloRequest({ method: 'POST', path: '/contacts/search', body: { account_ids: [accountId], page, per_page: PER_PAGE }, ctx });
    const echoed = (json.breadcrumbs || []).some(b => b.signal_field_name === 'account_ids' && [].concat(b.value).includes(accountId));
    const batch = (json.contacts || []).filter(c => c && c.id);
    if (!echoed || batch.some(c => c.account_id && c.account_id !== accountId)) return { contacts: null, reason: 'account_ids filter not applied' };
    contacts.push(...batch);
    const totalPages = json.pagination?.total_pages || 1;
    if (page >= totalPages || batch.length < PER_PAGE) return { contacts, truncated: false };
  }
  return { contacts, truncated: true };
}

// Upsert by hand: the (goal_id, apollo_contact_id) unique index is partial,
// which PostgREST's on_conflict can't name. A manual/outlook row with the
// same email becomes the Apollo row (it's the same person).
async function storeContacts(supabase, businessId, goalId, rows) {
  const { data: existing, error } = await supabase.from('partner_contacts').select('id, apollo_contact_id, email, source, title, linkedin_url')
    .eq('business_id', businessId).eq('goal_id', goalId);
  if (error) throw new Error(`partner contacts: read failed: ${error.message}`);
  const byApollo = new Map(existing.filter(r => r.apollo_contact_id).map(r => [r.apollo_contact_id, r]));
  const byEmail = new Map(existing.filter(r => r.email).map(r => [r.email.toLowerCase(), r]));
  let inserted = 0, updated = 0;
  for (const row of rows) {
    const prev = byApollo.get(row.apollo_contact_id) || (row.email && byEmail.get(row.email));
    if (prev) {
      const { business_id, goal_id, ...patch } = row;
      const { error: uErr } = await supabase.from('partner_contacts').update(patch).eq('id', prev.id);
      if (uErr) throw new Error(`partner contacts: update failed: ${uErr.message}`);
      updated++;
    } else {
      const { error: iErr } = await supabase.from('partner_contacts').insert(row);
      if (iErr) throw new Error(`partner contacts: insert failed: ${iErr.message}`);
      inserted++;
    }
  }
  return { inserted, updated };
}

// Zero Apollo calls: what the activity step already stored for these
// contact ids, written onto the partner_contacts rows.
async function applyStoredActivity(supabase, businessId, contactIds) {
  if (!contactIds.length) return 0;
  const [messages, events] = await Promise.all([
    selectAllPages(() => supabase.from('sales_email_messages').select('apollo_message_id, contact_id, delivered_at, replied, bounced').eq('business_id', businessId).in('contact_id', contactIds).order('apollo_message_id')),
    selectAllPages(() => supabase.from('sales_email_activity').select('apollo_message_id, contact_id, event, occurred_at, user_agent, tracking_service').eq('business_id', businessId).in('contact_id', contactIds).order('id')),
  ]);
  const group = (rows, key) => { const m = new Map(); for (const r of rows) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); } return m; };
  const mByContact = group(messages, 'contact_id'), eByContact = group(events, 'contact_id');
  let written = 0;
  for (const id of contactIds) {
    const last = lastActivity(mByContact.get(id) || [], eByContact.get(id) || []);
    if (!last) continue;
    const { error } = await supabase.from('partner_contacts').update(last).eq('business_id', businessId).eq('apollo_contact_id', id);
    if (error) throw new Error(`partner contacts: activity update failed: ${error.message}`);
    written++;
  }
  return written;
}

// accounts: this run's accounts snapshot when the adapter ran, else the
// latest stored one. Returns the counts block sync.js stores on the run.
export async function syncPartnerContacts({ ctx, supabase, businessId, accounts }) {
  const missing = [];
  const [goals, domainRows, accs] = await Promise.all([
    selectAllPages(() => supabase.from('sales_goals').select('id, name').eq('business_id', businessId).eq('goal_type', 'partnership').is('archived_at', null).order('id')),
    selectAllPages(() => supabase.from('partner_domains').select('goal_id, domain, confirmed').eq('business_id', businessId).eq('confirmed', true).order('id')),
    accounts ? Promise.resolve(accounts) : latestAccounts(supabase, businessId),
  ]);
  const rowsByGoal = {};
  for (const r of domainRows) (rowsByGoal[r.goal_id] ||= []).push(r);
  const targets = partnersToSync(goals, rowsByGoal, accs);
  const counts = { partners_matched: targets.length, partners_synced: 0, contacts_seen: 0, inserted: 0, updated: 0, activity_written: 0, calls: 0, skipped: [] };
  let capHit = false;
  for (const { goal, account } of targets) {
    let result;
    try { result = await fetchContacts(ctx, account.id); }
    catch (err) {
      if (err instanceof CallCapError) { capHit = true; break; }
      missing.push(`partner people: ${goal.name} fetch failed: ${err.message}`);
      continue;
    }
    if (!result.contacts) { counts.skipped.push(goal.name); missing.push(`partner people: ${goal.name} skipped - ${result.reason}, nothing stored`); continue; }
    if (result.truncated) missing.push(`partner people: ${goal.name} has more than ${PER_PAGE * MAX_PAGES_PER_PARTNER} contacts - first ${PER_PAGE * MAX_PAGES_PER_PARTNER} stored`);
    const rows = result.contacts.map(c => contactRow(businessId, goal.id, c)).filter(Boolean);
    const stored = await storeContacts(supabase, businessId, goal.id, rows);
    counts.activity_written += await applyStoredActivity(supabase, businessId, rows.map(r => r.apollo_contact_id));
    counts.partners_synced++; counts.contacts_seen += rows.length; counts.inserted += stored.inserted; counts.updated += stored.updated;
  }
  if (capHit) missing.push(`partner people: call cap (${ctx.callCounter.max}) hit - ${targets.length - counts.partners_synced - counts.skipped.length} partners carried to the next run`);
  counts.calls = ctx.callCounter.count;
  counts.cap_hit = capHit;
  return { counts, missing };
}
