import { laDateString } from './laDate.js';
import { weekStartOf } from './emailCounts.js';

// sales-goals-v1 REV4 - "companies sequenced in week N". A company enters a
// sequence when its first step-1 email goes out; Apollo's message records
// carry account_id, so this is built from messages the email-counts step
// already fetches (0 extra calls). Headcount isn't on any 0-credit Apollo
// endpoint, so employees is typed in by a member and never written here.

// Messages from the "sent" stats only (delivered / bounced / spam_blocked) -
// opened/clicked/replied are subsets of delivered.
export function firstTouches(messages) {
  const byAccount = new Map();
  for (const m of messages) {
    if (!m.account_id || !m.completed_at || m.campaign_position !== 1) continue;
    const prev = byAccount.get(m.account_id);
    if (prev && prev.first_sequenced_at <= m.completed_at) continue;
    byAccount.set(m.account_id, {
      account_id: m.account_id,
      first_sequenced_at: m.completed_at,
      sequence_id: m.emailer_campaign_id || null,
      mailbox_email: (m.from_email || '').toLowerCase() || null,
    });
  }
  return [...byAccount.values()];
}

// Inserts new companies; for known ones, only moves first_sequenced_at
// earlier and fills a missing name. Never touches employees*.
export async function recordSequencedAccounts({ supabase, businessId, touches, accountNames }) {
  if (!touches.length) return { inserted: 0, updated: 0 };
  const existing = new Map();
  for (let i = 0; i < touches.length; i += 200) {
    const ids = touches.slice(i, i + 200).map(t => t.account_id);
    const { data, error } = await supabase.from('sales_sequenced_accounts')
      .select('account_id, first_sequenced_at, name').eq('business_id', businessId).in('account_id', ids);
    if (error) throw new Error(`sequenced accounts: read failed: ${error.message}`);
    for (const r of data) existing.set(r.account_id, r);
  }
  const now = new Date().toISOString();
  const nameOf = id => (accountNames && accountNames.get(id)) || null;
  const weekOf = iso => weekStartOf(laDateString(new Date(iso)));

  const inserts = touches.filter(t => !existing.has(t.account_id)).map(t => ({
    business_id: businessId, ...t, name: nameOf(t.account_id), week_start: weekOf(t.first_sequenced_at), updated_at: now,
  }));
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await supabase.from('sales_sequenced_accounts').insert(inserts.slice(i, i + 500));
    if (error) throw new Error(`sequenced accounts: insert failed: ${error.message}`);
  }

  let updated = 0;
  for (const t of touches.filter(t => existing.has(t.account_id))) {
    const prev = existing.get(t.account_id);
    const earlier = new Date(t.first_sequenced_at) < new Date(prev.first_sequenced_at);
    const name = !prev.name && nameOf(t.account_id);
    if (!earlier && !name) continue;
    const patch = { updated_at: now };
    if (earlier) Object.assign(patch, { first_sequenced_at: t.first_sequenced_at, week_start: weekOf(t.first_sequenced_at), sequence_id: t.sequence_id, mailbox_email: t.mailbox_email });
    if (name) patch.name = name;
    const { error } = await supabase.from('sales_sequenced_accounts').update(patch).eq('business_id', businessId).eq('account_id', t.account_id);
    if (error) throw new Error(`sequenced accounts: update failed: ${error.message}`);
    updated++;
  }
  return { inserted: inserts.length, updated };
}
