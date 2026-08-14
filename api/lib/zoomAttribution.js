// zoom-meet-auto-ingest-v1, Step 2 - business/account attribution.
//
// Zoom's payload carries only host_email, which is identical across every
// business (confirmed live: all 3 businesses share owner_email
// jackcarlsig16@gmail.com) - useless for disambiguation. Real participant
// emails only come from a separate Reports API call
// (getZoomMeetingParticipants), made after receiving the webhook.
//
// Tier 1: a participant's email domain matches a business's own website_url
// directly (e.g. a business team member on the call) -> resolves the
// business; account is still resolved by call-log.js's own normal
// within-business matching.
//
// Tier 2: a participant's email domain matches an account's own domain,
// searched across ALL businesses (not pre-scoped, since the business isn't
// known yet) -> resolves business AND account in the same step. When this
// fires, call-log-v1's own account-matching pass is skipped entirely
// (confirmed design) rather than re-derived.
//
// Neither tier resolving to exactly one match -> event holds unattributed
// for manual assignment (Step 5). This is expected, not a failure mode to
// paper over - business_intel_entries.business_id is NOT NULL, so there's
// nowhere else for an ambiguous event to go.
import { normalizeDomain } from '../businesses/call-log.js';

export async function resolveZoomAttribution(supabase, participants) {
  const emails = (participants || []).map(p => (p.email || '').toLowerCase().trim()).filter(Boolean);
  const domains = [...new Set(emails.map(e => e.split('@')[1]).filter(Boolean))];
  if (!domains.length) return { businessId: null, accountId: null, matchReason: 'no_participant_emails' };

  const { data: businesses, error: bizErr } = await supabase.from('businesses').select('id, website_url');
  if (bizErr) throw bizErr;
  const matchedBusinesses = new Set();
  for (const b of businesses || []) {
    const d = normalizeDomain(b.website_url);
    if (d && domains.includes(d)) matchedBusinesses.add(b.id);
  }
  if (matchedBusinesses.size === 1) {
    return { businessId: [...matchedBusinesses][0], accountId: null, matchReason: 'tier1_business_domain_match' };
  }
  if (matchedBusinesses.size > 1) {
    return { businessId: null, accountId: null, matchReason: 'tier1_multiple_business_matches' };
  }

  const { data: accounts, error: accErr } = await supabase.from('accounts').select('id, business_id, data').eq('account_kind', 'business');
  if (accErr) throw accErr;
  const matchedAccountIds = new Set();
  for (const a of accounts || []) {
    const d = normalizeDomain(a.data?.web);
    if (d && domains.includes(d)) matchedAccountIds.add(a.id);
  }
  if (matchedAccountIds.size === 1) {
    const accountId = [...matchedAccountIds][0];
    const account = (accounts || []).find(a => a.id === accountId);
    return { businessId: account.business_id, accountId, matchReason: 'tier2_account_domain_match' };
  }
  if (matchedAccountIds.size > 1) {
    return { businessId: null, accountId: null, matchReason: 'tier2_multiple_account_matches' };
  }

  return { businessId: null, accountId: null, matchReason: 'no_match' };
}
