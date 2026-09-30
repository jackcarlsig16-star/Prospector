import { apolloRequest, CallCapError } from './apolloClient.js';

const CACHE_MAX_AGE_DAYS = 7; // PROPOSED (SPEC)
const MAX_LOOKUPS_PER_RUN = 10;

// dashboard-v2 Stage 2 - resolves each active sequence's real sending
// mailbox once and caches it in sales_sequence_tags.sender_email, so
// steady-state syncs make 0 of these calls. The real field
// (contact_campaign_statuses[].send_email_from_email_address) only exists
// per-contact, not on the sequence object (audit F3) - one contacts/search
// call per sequence, per_page 1, is the cheapest way to read it.
//
// A CallCapError from apolloRequest is NOT caught here - it propagates up
// to sync.js's per-adapter try/catch, same as every other Apollo call in a
// run, so hitting the cap mid-lookup stops the whole run consistently
// rather than silently truncating just this step.
export async function resolveSenders({ ctx, businessId, activeSequenceIds, supabase }) {
  const { data: existing, error: readErr } = await supabase
    .from('sales_sequence_tags')
    .select('sequence_id, sender_email, sender_checked_at')
    .eq('business_id', businessId)
    .in('sequence_id', activeSequenceIds.length ? activeSequenceIds : ['__none__']);
  if (readErr) throw new Error(`senderLookup: failed to read cache: ${readErr.message}`);

  const byId = new Map((existing || []).map(r => [r.sequence_id, r]));
  const cutoffMs = Date.now() - CACHE_MAX_AGE_DAYS * 24 * 3600 * 1000;

  const needsLookup = activeSequenceIds
    .filter(id => {
      const row = byId.get(id);
      if (!row || !row.sender_email) return true;
      if (!row.sender_checked_at) return true;
      return new Date(row.sender_checked_at).getTime() < cutoffMs;
    })
    .slice(0, MAX_LOOKUPS_PER_RUN);

  let lookupCalls = 0;
  let resolved = 0;
  const unresolved = [];

  for (const sequenceId of needsLookup) {
    lookupCalls += 1;
    let json;
    try {
      json = await apolloRequest({
        method: 'POST',
        path: '/contacts/search',
        body: { page: 1, per_page: 1, emailer_campaign_ids: [sequenceId] },
        ctx,
      });
    } catch (err) {
      if (err instanceof CallCapError) throw err;
      unresolved.push(sequenceId);
      continue;
    }

    const breadcrumbs = json.breadcrumbs || [];
    const confirmed = breadcrumbs.some(
      b => b.signal_field_name === 'emailer_campaign_ids' && b.value === sequenceId
    );
    if (!confirmed) {
      unresolved.push(sequenceId);
      continue;
    }

    const contact = (json.contacts || [])[0];
    const status = contact
      ? (contact.contact_campaign_statuses || []).find(s => s.emailer_campaign_id === sequenceId)
      : null;
    const senderEmail = status ? status.send_email_from_email_address : null;
    if (!senderEmail) {
      unresolved.push(sequenceId);
      continue;
    }

    const { error: upsertErr } = await supabase.from('sales_sequence_tags').upsert(
      {
        business_id: businessId,
        sequence_id: sequenceId,
        sender_email: senderEmail,
        sender_checked_at: new Date().toISOString(),
      },
      { onConflict: 'business_id,sequence_id' }
    );
    if (upsertErr) {
      unresolved.push(sequenceId);
      continue;
    }
    resolved += 1;
  }

  return { lookupCalls, resolved, unresolved };
}
