// call-log-v1, Phase 2 — ingestion endpoint for call transcripts. Built so
// Zoom's webhook (Stage 4, later) can POST here directly, same as the
// manual-entry UI (Phase 3) does now - no caller-specific coupling.
//
// No outbound third-party call happens in this endpoint (matching/filing is
// all internal, against Supabase and the existing Anthropic classifier), so
// external-api-foundation-v1's callExternalApi doesn't apply here - it's for
// wrapping real outbound HTTP calls to new external services, which this
// isn't. Structural pattern still follows hunter/find.js: param/shape
// validation -> the actual work -> explicit status branches -> typed
// response.
export const config = { maxDuration: 30 };
import { getSupabase, classifyIntake, fileCompanyIntel, fileProjectIntel, recordAccountActivity } from './shared.js';

const VALID_PLATFORMS = ['zoom', 'google_meet', 'manual'];

function normalizeDomain(web) {
  if (!web) return null;
  return web.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim() || null;
}

// Matching logic, in order per spec. Exact email match against known
// contact emails is step one - but confirmed live (call-log-v1 Phase 0
// audit): no contacts/account_contacts table exists anywhere in this
// schema, so there is nothing to match participant emails against yet.
// Falls straight through to domain match, the only real signal available
// today. Revisit this function first if a contacts model ever gets built.
async function matchAccountByParticipants(supabase, businessId, participants) {
  const emails = (participants || []).map(p => (p.email || '').toLowerCase().trim()).filter(Boolean);
  if (!emails.length) return { accountId: null, reason: 'no_participant_emails' };

  const domains = [...new Set(emails.map(e => e.split('@')[1]).filter(Boolean))];
  if (!domains.length) return { accountId: null, reason: 'no_participant_emails' };

  const { data: accounts, error } = await supabase.from('accounts').select('id, data')
    .eq('business_id', businessId).eq('account_kind', 'business');
  if (error) throw error;

  const matched = new Set();
  for (const account of accounts || []) {
    const accountDomain = normalizeDomain(account.data?.web);
    if (accountDomain && domains.includes(accountDomain)) matched.add(account.id);
  }

  if (matched.size === 1) return { accountId: [...matched][0], reason: 'domain_match' };
  if (matched.size === 0) return { accountId: null, reason: 'no_match' };
  return { accountId: null, reason: 'multiple_matches' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id: businessId } = req.params;
  const { transcript, call_platform, call_date, call_duration_seconds, call_participants, created_by } = req.body || {};

  if (!transcript?.trim()) return res.status(400).json({ error: 'transcript is required' });
  const platform = call_platform || 'manual';
  if (!VALID_PLATFORMS.includes(platform)) {
    return res.status(400).json({ error: `call_platform must be one of ${VALID_PLATFORMS.join(', ')}` });
  }
  if (call_participants !== undefined && call_participants !== null && !Array.isArray(call_participants)) {
    return res.status(400).json({ error: 'call_participants must be an array of { name, email }' });
  }
  if (call_duration_seconds !== undefined && call_duration_seconds !== null && !Number.isFinite(call_duration_seconds)) {
    return res.status(400).json({ error: 'call_duration_seconds must be a number' });
  }

  const supabase = getSupabase();
  if (!supabase) return res.status(500).json({ error: 'Supabase is not configured' });

  try {
    const { data: business, error: businessError } = await supabase.from('businesses').select('id').eq('id', businessId).maybeSingle();
    if (businessError) throw businessError;
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const { accountId, reason: matchReason } = await matchAccountByParticipants(supabase, businessId, call_participants);

    const { data: entry, error: insertError } = await supabase.from('business_intel_entries').insert({
      business_id: businessId,
      source: 'call',
      source_type: 'call',
      content: transcript.trim(),
      call_platform: platform,
      call_date: call_date || new Date().toISOString(),
      call_duration_seconds: call_duration_seconds ?? null,
      call_participants: call_participants || null,
      account_id: accountId,
      created_by: created_by || null,
    }).select().single();
    if (insertError) throw insertError;

    // business_intel_entries has no fileAccountNote() primitive (confirmed
    // live, Phase 0: recordAccountActivity() is the only account-touch
    // mechanism, and it writes into accounts.data.handoffNotes directly -
    // zero dependency on this table). The insert above and this call are
    // two independent writes to two independent tables; neither implies
    // the other.
    let accountName = null;
    if (accountId) {
      const participantNames = (call_participants || []).map(p => p.name).filter(Boolean).join(', ');
      const durationNote = call_duration_seconds ? `${Math.round(call_duration_seconds / 60)} min` : null;
      const noteParts = [`Call logged via ${platform}`, durationNote, participantNames && `with ${participantNames}`].filter(Boolean);
      accountName = await recordAccountActivity(supabase, accountId, created_by, 'call_log', noteParts.join(' — '));
    }

    // Same classifyIntake() Smart Intake already uses. Only its company/
    // project outcomes apply here - existing_account/new_account/
    // influencer/ambiguous are skipped: account attribution for a call is
    // already handled above via participant matching, a stronger signal
    // than an LLM guessing an account from transcript prose. Acting on both
    // would double-log the same call onto the same account. Non-fatal: the
    // call-log row above is already filed either way.
    let classification = null;
    try {
      const result = await classifyIntake(supabase, businessId, transcript.trim());
      classification = result.classification;
      if (classification === 'existing_project' && result.project_id) {
        const { data: project } = await supabase.from('projects').select('id').eq('id', result.project_id).eq('business_id', businessId).maybeSingle();
        if (project) await fileProjectIntel(supabase, project.id, transcript.trim(), created_by);
      } else if (classification === 'company_intel') {
        await fileCompanyIntel(supabase, businessId, transcript.trim(), created_by);
      }
    } catch (e) {
      console.warn('[call-log] classifyIntake/company-project filing failed (non-fatal):', e.message);
    }

    return res.status(200).json({ entry, matched: !!accountId, accountId, accountName, matchReason, classification });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
