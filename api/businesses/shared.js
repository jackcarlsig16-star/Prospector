import { createClient } from '@supabase/supabase-js';
import { fetchSiteContent } from '../lib/fetchSiteContent.js';
import { MODELS } from '../../src/config/models.js';

// Same pattern as api/sfdc/sync-compliance.js
export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// audit-triage-v1 follow-up — raised independently from assay.js's cap
// (10000), not copied blindly: this feeds a one-time-per-business deep
// profile synthesis (vision/positioning/ICP/gtm_strategy), persisted as a
// business_intel_entries row other features build on - not a per-account
// bulk-scale operation like Assay, so there's no "multiplied across 100
// accounts/hour" latency cost to weigh against a bigger cap here. Given
// that, it's allowed more headroom than Assay's quicker per-account check.
const SITE_TEXT_TRUNCATE_CHARS = 12000;

async function callAnthropic({ system, messages, tools, max_tokens, supabase, businessId, callType, model = MODELS.STANDARD, timeoutMs = 90000, thinking = true }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs), // every other Anthropic/external call in this app bounds its fetch - this one was the one gap. Per-call override (business-intel-smart-upload-v1) - confirmed live that the full-depth profile synthesis (8192 tokens, adaptive thinking, a real dense doc) can genuinely exceed the 90s default other/faster calls are fine with.
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens,
      // adaptive thinking isn't supported on the fast tier (confirmed live -
      // classifyIntake's MODELS.FAST call 500'd in production with "adaptive
      // thinking is not supported on this model"). It stays on for
      // STANDARD/REASONING synthesis calls, which is what it was added for -
      // except where a caller explicitly opts out (thinking: false) because
      // reasoning tokens would eat into a max_tokens budget that's meant
      // entirely for compact output (intel-generation-light-depth-truncation-fix-v1).
      ...(model !== MODELS.FAST && thinking ? { thinking: { type: 'adaptive' } } : {}),
      system,
      messages,
      ...(tools ? { tools } : {}),
    }),
  });

  const data = await response.json();
  if (data.type === 'error') throw new Error(data.error?.message || 'Anthropic API error');

  // Non-fatal: cost accounting must never take down a research run.
  if (supabase && data.usage) {
    const { error: usageError } = await supabase.from('business_anthropic_usage').insert({
      business_id: businessId || null,
      call_type: callType || 'unknown',
      input_tokens: data.usage.input_tokens ?? null,
      output_tokens: data.usage.output_tokens ?? null,
      model,
    });
    if (usageError) console.warn('[businesses] usage log failed:', usageError.message);
  }

  return data;
}

// industry/core_problem/products/motto/value_props are derivable straight
// from a company's own site content, so light depth still asks for them.
// sub_issues and strategic_philosophy need more interpretive synthesis
// than a light-depth pass is meant to do (same reasoning FULL_SYSTEM_PROMPT's
// positioning/icp/competitors already use to justify staying full-only) -
// generateProfile() nulls those two on the light path
// (business-intel-smart-upload-v1).
const LIGHT_SYSTEM_PROMPT = `You maintain a compact, current profile of a company Jack does outreach on behalf of, based on its own site content and notes - not a prospect he's researching. Respond with ONLY a JSON object, no other text.

Return exactly this shape:
{
  "vision": "the company's vision or mission as it currently reads from the notes provided, 1-2 sentences. If nothing meaningful is known yet, say so plainly rather than inventing one.",
  "current_strategy": "the company's current strategy or direction right now, 1-2 sentences, based only on the notes provided.",
  "recent_changes": "2-4 short sentences on what appears new, changed, or worth knowing since the last check - new offerings, messaging shifts, notable site changes. This is quick context for an outreach conversation, not a strategic document. If nothing meaningfully new stands out, say so plainly rather than padding.",
  "industry": "the company's industry/vertical in a few words",
  "core_problem": "the main problem this business solves for its customers, 1-2 sentences",
  "products": ["array of up to 6 of the company's actual named products/product lines, as they appear in the notes"],
  "value_props": ["array of 2-4 short value propositions the company itself emphasizes"],
  "motto": "a short tagline/motto if one appears in the notes, else null",
  "field_sources": { "<field name from above, e.g. \\"vision\\">": ["<the [id:...] tag(s) of the note(s) that field is actually grounded in>"] }
}

Base every field on the notes provided - do not invent facts they don't support. Keep this compact - this is a lightweight running profile, not a full strategic writeup. Every note in the log is prefixed with its own [id:...] tag - field_sources must cite the real ids of the notes each field actually drew on. A field with no real grounding should be left empty/null rather than given a made-up citation.`;

const FULL_SYSTEM_PROMPT = `You synthesize accumulated research and notes about a company into a structured business profile. Respond with ONLY a JSON object, no other text.

This is a well-defined extraction and synthesis task, not one requiring extensive open-ended exploration - reason efficiently and move directly to producing the JSON once you have enough grounding for each field, rather than deliberating at length.

Return exactly this shape:
{
  "vision": "the company's stated or inferred vision/mission, 2-3 sentences",
  "positioning": "how the company positions itself in its market, 2-3 sentences",
  "icp": "the company's ideal customer profile, 2-3 sentences",
  "gtm_strategy": "the company's go-to-market strategy, 2-3 sentences",
  "competitors": "known or likely competitors, comma-separated or short list",
  "raw_synthesis": "a fuller markdown synthesis covering anything the fields above don't capture - roughly 300-500 words even when the log is rich. This is supporting context, not a reproduction of the source documents - summarize and prioritize, don't transcribe",
  "industry": "the company's industry/vertical in a few words",
  "core_problem": "the main problem this business solves for its customers, 1-2 sentences",
  "sub_issues": ["array of 2-5 more specific sub-problems or pain points within the core problem, grounded in the intel log"],
  "products": ["array of up to 6 of the company's actual named products/product lines, most important or representative first"],
  "value_props": ["array of 2-4 value propositions the company itself emphasizes"],
  "motto": "a short tagline/motto if one appears in the log, else null",
  "strategic_philosophy": "1-3 sentences on any business-specific strategic doctrine or framing that shows up in the notes (e.g. an explicit prioritization approach, a stated operating philosophy) - leave this genuinely null if nothing like that appears rather than inventing generic strategy language",
  "field_sources": { "<field name from above, e.g. \\"vision\\">": ["<the [id:...] tag(s) of the log entries that field is actually grounded in>"] }
}

Base every field on the intel log provided - do not invent facts it doesn't support. Where the log is thin on a field, give a clearly-labeled best inference rather than leaving it empty - except strategic_philosophy, which should stay null rather than be padded with generic inference. Every entry in the log is prefixed with its own [id:...] tag - field_sources must cite the real ids of the entries each field actually drew on, not a guess. A field with no real grounding should be left empty/null rather than given a made-up citation.`;

const PROJECT_STRATEGY_SYSTEM_PROMPT = `You track the strategy and direction of a specific project or initiative within a company Jack does outreach on behalf of, based solely on notes filed for that project. Respond with ONLY a JSON object, no other text.

Return exactly this shape:
{
  "strategy_synthesis": "2-4 short sentences on this project's current strategy, direction, and any notable recent developments, based only on the notes filed for it. If there isn't enough yet to say anything meaningful, say so plainly rather than padding."
}`;

// PROFILE GENERATION — pulls the full intel log and synthesizes it into
// business_profiles. Called from both the research pipeline and the manual
const INFLUENCER_SYSTEM_PROMPT = `You synthesize an Instagram influencer's bio text into a compact strategy-relevant assessment for a specific business considering working with them. Respond with ONLY a JSON object, no other text.

Return exactly this shape:
{
  "category": "the influencer's niche/category in a few words (e.g. 'fitness & wellness', 'home renovation', 'personal finance')",
  "content_type": "what kind of content they post, inferred from the bio (e.g. 'short-form video tips', 'lifestyle photography', 'product reviews')",
  "audience_read": "1-2 sentences on who their audience likely is, based on the bio",
  "fit_score": "integer 0-100 - how strong a fit this influencer is for THIS business specifically, given its profile below. 0 = no discernible fit, 100 = ideal fit. Be honest and differentiated - most real accounts should land well short of either extreme",
  "fit_signals": "array of 2-4 objects, each { \\"axis\\": short label, \\"note\\": one grounded sentence }. Choose whichever axes actually matter for THIS business and THIS influencer - e.g. audience overlap, geography, brand tone, category adjacency, price point - do not use a fixed template of axes across every assessment. Ground every note in specifics from the bio and business profile, not generic reasoning",
  "fit_rationale": "one sentence, evidence-based, stating the single biggest reason for the fit_score - reference something concrete from the bio and/or the business profile, not a generic statement"
}

Base every field on the bio text and business profile provided - do not invent facts either doesn't support. If the bio is too thin to say something meaningful, say so plainly in that field rather than padding. If the business profile below is thin or empty, say so in fit_rationale rather than guessing - a low-information fit_score should read as uncertain, not confidently wrong.`;

// assay-engine-generalization-v1 — distills a business profile into the
// compact scoring criteria clientAssay() reads on every call. Generated
// once (or on explicit Regenerate), not re-derived per-call, so the real
// LLM cost is paid once per business rather than on every reassay/CSV
// import/pool-scoring run.
const ASSAY_CRITERIA_SYSTEM_PROMPT = `You distill a business's profile into compact scoring criteria an automated account-scoring tool will use to evaluate prospect accounts for fit with this business. Respond with ONLY a JSON object, no other text.

Return exactly this shape:
{
  "fit_signals": "what makes a prospect account a strong fit for this business - concrete, specific traits, verticals, or behaviors to look for. 2-4 sentences.",
  "disqualifiers": "what makes a prospect account NOT a fit for this business - concrete disqualifying traits. 2-4 sentences.",
  "tier_guidance": "how to map fit strength onto scoring tiers (Gold = strong direct fit, Silver = solid indirect fit, Tin = weak/speculative fit, Slag = no fit or defunct) for THIS business specifically - what earns each tier. 2-4 sentences."
}

Base every field on the business profile provided - do not invent facts it doesn't support. If the profile is thin, give general-but-honest criteria rather than fabricating specifics, and let the thinness show in how general the criteria are rather than padding with invented detail.`;

// outreach-intelligence-v1 Section 1 — same cache-once pattern as
// ASSAY_CRITERIA_SYSTEM_PROMPT, but the input is a pasted outreach-training
// document rather than a derived business profile (a business's messaging
// rules aren't something company research infers on its own).
const OUTREACH_RULES_SYSTEM_PROMPT = `You distill a pasted outreach-training document into compact messaging rules an automated outreach-generation tool will use to write emails for this business. Respond with ONLY a JSON object, no other text.

Return exactly this shape:
{
  "tone": "the intended tone/voice for outreach from this business - concrete, not generic. 1-3 sentences.",
  "structure": "how messages should be structured - opener style, length, paragraph shape, CTA style. 1-3 sentences.",
  "key_points": "the recurring points/value props/hooks this business wants surfaced in outreach. 2-4 sentences.",
  "dos": "specific things to do - phrases, framings, or moves the document calls out as effective. 2-4 sentences.",
  "donts": "specific things to avoid - phrases, framings, or mistakes the document calls out. 2-4 sentences.",
  "example_snippets": "1-3 short verbatim or near-verbatim snippets from the document worth echoing directly, quoted."
}

Base every field on the pasted document - do not invent rules it doesn't support. If the document is thin on a given field, give a short honest answer rather than padding with invented detail.`;

// businessId must already have a business_profiles row (same requirement as
// generateAssayCriteria) - the columns live there, and there's no sensible
// standalone "outreach rules" table shape without one.
export async function generateOutreachRules(supabase, businessId, pastedText) {
  const { data: profile, error: profileError } = await supabase.from('business_profiles').select('id').eq('business_id', businessId).maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new Error('No business profile found for this business yet — run company research first.');
  if (!pastedText || !pastedText.trim()) throw new Error('Paste an outreach-training document to distill rules from.');

  const data = await callAnthropic({
    max_tokens: 1024,
    system: OUTREACH_RULES_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: pastedText.slice(0, 8000) }],
    supabase,
    businessId,
    callType: 'outreach_rules',
  });
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text in outreach rules generation response');
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in outreach rules generation response');
  const parsed = JSON.parse(jsonMatch[0]);
  const outreach_rules = {
    tone: parsed.tone || '',
    structure: parsed.structure || '',
    key_points: parsed.key_points || '',
    dos: parsed.dos || '',
    donts: parsed.donts || '',
    example_snippets: parsed.example_snippets || '',
  };

  const { error: updateError } = await supabase.from('business_profiles').update({
    outreach_rules,
    outreach_rules_updated_at: new Date().toISOString(),
    outreach_rules_edited_manually: false,
  }).eq('business_id', businessId);
  if (updateError) throw updateError;

  return outreach_rules;
}

// vision/positioning/icp/gtm_strategy are the structured fields
// generateProfile() fills in, but a business on 'light' research depth (or
// one whose site research came back thin - confirmed live for both
// HomeLover and Master Magnetics as of influencer-card-v2's Phase 0 check)
// can have all four blank while raw_synthesis still holds real content.
// Fall back to it rather than handing the fit prompt an empty profile.
export function buildBusinessFitContext(profile) {
  if (!profile) return '(no business profile available yet)';
  const parts = [
    profile.vision && `Vision: ${profile.vision}`,
    profile.positioning && `Positioning: ${profile.positioning}`,
    profile.icp && `ICP: ${profile.icp}`,
    profile.gtm_strategy && `GTM strategy: ${profile.gtm_strategy}`,
    // business-intel-smart-upload-v1 - same single-row read, no added
    // model strain at score/fit-assessment time, shared by both callers
    // of this function (generateAssayCriteria, assessInfluencerAccount).
    profile.industry && `Industry: ${profile.industry}`,
    profile.core_problem && `Core problem solved: ${profile.core_problem}`,
    Array.isArray(profile.sub_issues) && profile.sub_issues.length > 0 && `Sub-issues: ${profile.sub_issues.join('; ')}`,
    Array.isArray(profile.products) && profile.products.length > 0 && `Products: ${profile.products.join(', ')}`,
    Array.isArray(profile.value_props) && profile.value_props.length > 0 && `Value props: ${profile.value_props.join('; ')}`,
    profile.motto && `Motto: "${profile.motto}"`,
    profile.strategic_philosophy && `Strategic philosophy: ${profile.strategic_philosophy}`,
  ].filter(Boolean);
  if (!parts.length && profile.raw_synthesis) return profile.raw_synthesis;
  return parts.length ? parts.join('\n') : '(no business profile available yet)';
}

// Synthesizes from a human-pasted bio, not a fetched one - Instagram profile
// fetching (even via Jina Reader with a real API key) is confirmed blocked
// by Instagram's own login wall, tested live with three real handles
// (influencer-accounts-v1, Phase 0). Same synthesis-engine shape as
// generateProfile() otherwise. Deliberately does NOT touch
// last_touched_by/last_touched_at - this is automated categorization of
// text Jack pasted, not a logged human contact with the influencer.
// businessId drives the fit_score/fit_signals/fit_rationale context
// (influencer-card-v2, Phase 2) - without it those fields would just be
// generic, which defeats the point of scoring fit per-business.
export async function assessInfluencerAccount(supabase, accountId, bioText, followerCount, businessId) {
  await supabase.from('account_influencer_details').update({ assessment_status: 'assessing' }).eq('account_id', accountId);
  try {
    let businessContext = '(no business profile available yet)';
    if (businessId) {
      const { data: profile } = await supabase.from('business_profiles').select('vision, positioning, icp, gtm_strategy, raw_synthesis, industry, core_problem, sub_issues, products, value_props, motto, strategic_philosophy').eq('business_id', businessId).maybeSingle();
      businessContext = buildBusinessFitContext(profile);
    }

    const data = await callAnthropic({
      // 800 wasn't enough once fit_score/fit_signals/fit_rationale were added
      // on top of the original 4 fields - confirmed live, this model runs
      // with adaptive thinking enabled (STANDARD tier) and was getting cut
      // off before ever emitting a text block (influencer-card-v2, Phase 5
      // finding: "No text in influencer assessment response" in production).
      max_tokens: 2048,
      system: INFLUENCER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `BUSINESS PROFILE (the business considering this influencer):\n${businessContext}\n\nINFLUENCER BIO:\n${bioText}` }],
      supabase,
      businessId,
      callType: 'influencer_assess',
    });
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text in influencer assessment response');
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in influencer assessment response');
    const parsed = JSON.parse(jsonMatch[0]);
    const { fit_score, fit_signals, fit_rationale, ...niche_assessment } = parsed;

    const { data: updated, error } = await supabase.from('account_influencer_details').update({
      bio_snapshot: bioText,
      niche_assessment,
      fit_score: Number.isFinite(fit_score) ? Math.max(0, Math.min(100, Math.round(fit_score))) : null,
      fit_signals: fit_signals || null,
      fit_rationale: fit_rationale || null,
      follower_count: Number.isFinite(followerCount) ? followerCount : null,
      assessment_status: 'ready',
      assessed_at: new Date().toISOString(),
    }).eq('account_id', accountId).select().single();
    if (error) throw error;
    return updated;
  } catch (e) {
    await supabase.from('account_influencer_details').update({ assessment_status: 'error' }).eq('account_id', accountId);
    throw e;
  }
}

// business-social-links-v1 - shared by generateProfile() and runResearch()'s
// web_research call so the two don't drift on formatting. Context/seed
// hints only, never a fetch target - Instagram scraping is a confirmed
// dead end (login wall, tested 3x already), LinkedIn direct fetch is
// deliberately out of scope for this pass too.
export function formatSocialLinksContext(socialLinks) {
  if (!socialLinks) return '';
  const entries = Object.entries(socialLinks).filter(([, v]) => v);
  if (!entries.length) return '';
  return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
}

// intel-add path, so it looks up research_depth itself rather than trusting
// the caller to pass it - a light business getting a manual intel entry
// must still get the light resynthesis, not the full GTM writeup.
export async function generateProfile(supabase, businessId) {
  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('name, research_depth, social_links')
    .eq('id', businessId)
    .single();
  if (businessError) throw businessError;
  const isLight = business.research_depth === 'light';

  // project_id IS NULL - company-level synthesis must never pull in
  // project-scoped notes (smart-intake-and-intelligence-v1). Full history
  // for both depths now: light needs enough context to keep "vision" and
  // "current_strategy" stable across resyntheses, not just the latest 2
  // entries - "lightweight" now means compact prompt/output, not a starved
  // context window.
  const { data: entries, error: entriesError } = await supabase
    .from('business_intel_entries')
    .select('id, content, source, created_at')
    .eq('business_id', businessId)
    .is('project_id', null)
    .order('created_at', { ascending: true });
  if (entriesError) throw entriesError;

  // [id:...] tags let the model cite real entry ids in field_sources below -
  // business-intel-smart-upload-v1's field-level traceability.
  const intelLog = (entries || [])
    .map(e => `[id:${e.id}] [${e.source}] ${e.content}`)
    .join('\n\n---\n\n') || '(no intel yet)';

  // business-intel-smart-upload-v1 grew the output schema from 6 fields to
  // 13 plus a field_sources citation map covering all of them, and adaptive
  // thinking shares this same token budget. Confirmed live, twice, against
  // real dense pasted docs: first at 4096 (truncated - "No JSON in profile
  // generation response"), then again at 8192 on a denser document.
  // raw_synthesis had no length cap in the prompt then either - now capped
  // at ~300-500 words, with this number as headroom on top of that fix, not
  // instead of it. Real usage since (business_anthropic_usage, all real
  // calls): 1846, 4096(capped/failed), 5857, 8192(capped/failed), 5718,
  // 4447, 9796 output tokens as the input log has grown from 6k to 22k
  // tokens - the largest real output so far (9796) was already 82% of the
  // prior 12000 cap. Fixed, not dynamic: input size (and therefore output
  // size) keeps climbing under the current full-log-resend architecture
  // regardless of what cap is set here, and that's the thing the
  // delta-synthesis design (business-intel-smart-upload-v1 Step 3) is
  // meant to actually fix - a dynamic formula here would mostly become
  // dead code once that ships. 20000 gives >2x headroom over the largest
  // real output seen, comfortably inside Sonnet's real output ceiling.
  // intel-generation-light-depth-truncation-fix-v1 - light's 2048 cap was
  // hit exactly (truncated, "No JSON in profile generation response") by
  // real production calls on both HomeLover and HumanKind as their intel
  // logs grew (business_anthropic_usage: real successful outputs already
  // sitting at 1786-2043, three real calls capped/failed at exactly 2048).
  // Two fixes together: adaptive thinking was silently sharing this budget
  // with the actual JSON output (light doesn't need reasoning tokens for a
  // compact fixed-shape summary), and the cap itself hadn't been revisited
  // since 1024->2048 while full-depth's has been raised three times for the
  // same underlying reason. 8192 matches full-depth's own first-stage cap
  // for a comparably-structured JSON synthesis call - real >4x headroom
  // over every real light-depth output seen to date. Fixed, not dynamic,
  // for the same reason full-depth's 20000 stayed fixed (see comment above
  // FULL_SYSTEM_PROMPT's callAnthropic call): a growth-scaled formula here
  // would mostly become dead code once delta-synthesis (business-intel-
  // smart-upload-v1 Step 3) ships and stops resending the full log.
  const socialContext = formatSocialLinksContext(business.social_links);
  const data = await callAnthropic({
    max_tokens: isLight ? 8192 : 20000,
    timeoutMs: isLight ? 90000 : 180000,
    thinking: !isLight,
    system: isLight ? LIGHT_SYSTEM_PROMPT : FULL_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `INTEL LOG for ${business.name}, oldest to newest:\n\n${intelLog}${socialContext ? `\n\nKnown social profiles (context/reference only, not fetched - factor into vision/positioning/etc where relevant): ${socialContext}` : ''}` }],
    supabase,
    businessId,
    callType: isLight ? 'profile_light' : 'profile_full',
  });

  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text in profile generation response');
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in profile generation response');
  const parsed = JSON.parse(jsonMatch[0]);
  const candidateSources = parsed.field_sources || {};

  // Light and full ask for different JSON field names but share the same
  // business_profiles columns - light's current_strategy/recent_changes map
  // onto the same gtm_strategy/raw_synthesis columns full's own field names
  // already target, so both depths render through the same ProfileBlock UI.
  const candidateValues = {
    vision: parsed.vision || null,
    positioning: isLight ? null : (parsed.positioning || null),
    icp: isLight ? null : (parsed.icp || null),
    gtm_strategy: isLight ? (parsed.current_strategy || null) : (parsed.gtm_strategy || null),
    competitors: isLight ? null : (parsed.competitors || null),
    raw_synthesis: isLight ? (parsed.recent_changes || null) : (parsed.raw_synthesis || null),
    industry: parsed.industry || null,
    core_problem: parsed.core_problem || null,
    sub_issues: isLight ? null : (parsed.sub_issues || null),
    products: parsed.products || null,
    value_props: parsed.value_props || null,
    motto: parsed.motto || null,
    strategic_philosophy: isLight ? null : (parsed.strategic_philosophy || null),
  };
  // Only the 7 new fields get manual-edit protection in this SPEC - the
  // original six (vision/positioning/icp/gtm_strategy/competitors/
  // raw_synthesis) don't have *_edited_manually columns and are always
  // overwritten by the next resynthesis, unchanged from today's behavior
  // (business-intel-smart-upload-v1 - explicitly out of scope to retrofit).
  const EDITABLE_FIELDS = ['industry', 'core_problem', 'sub_issues', 'products', 'value_props', 'motto', 'strategic_philosophy'];

  const { data: current } = await supabase.from('business_profiles').select('*').eq('business_id', businessId).maybeSingle();

  const update = { business_id: businessId, model_version: MODELS.STANDARD, generated_at: new Date().toISOString() };
  const nextFieldSources = { ...(current?.field_sources || {}) };
  const nextConflicts = { ...(current?.field_conflicts || {}) };

  for (const [field, candidateValue] of Object.entries(candidateValues)) {
    const currentValue = current?.[field] ?? null;
    const valueUnchanged = JSON.stringify(candidateValue) === JSON.stringify(currentValue);

    if (EDITABLE_FIELDS.includes(field) && current?.[`${field}_edited_manually`]) {
      // Protected - never silently overwrite a manual edit. If the fresh
      // synthesis actually disagrees with what the user kept, record it as
      // a pending conflict for the UI (Section 5) to surface; if it now
      // agrees, clear any stale conflict record.
      if (valueUnchanged) delete nextConflicts[field];
      else nextConflicts[field] = { candidate_value: candidateValue, candidate_sources: candidateSources[field] || [], detected_at: new Date().toISOString() };
      continue;
    }

    update[field] = candidateValue;
    if (!valueUnchanged) {
      // Diff-check on write: only a field whose VALUE actually changed gets
      // a new citation set. An unchanged field keeps whatever field_sources
      // it already had, instead of getting a possibly-different citation
      // just because this run happened to phrase it differently - this is
      // the whole fix for citation flicker (business-intel-smart-upload-v1).
      nextFieldSources[field] = candidateSources[field] || [];
      delete nextConflicts[field];
    }
  }

  update.field_sources = nextFieldSources;
  update.field_conflicts = nextConflicts;

  const { error: upsertError } = await supabase.from('business_profiles').upsert(update, { onConflict: 'business_id' });
  if (upsertError) throw upsertError;
}

// ASSAY CRITERIA — assay-engine-generalization-v1. Reuses buildBusinessFitContext's
// existing raw_synthesis-fallback (a business on 'light' research depth can have
// vision/positioning/icp/gtm_strategy all blank) at criteria-generation time, not
// at every clientAssay() call. Requires a business_profiles row to already exist —
// run company research (generateProfile) first; this doesn't create one.
export async function generateAssayCriteria(supabase, businessId) {
  const { data: business, error: businessError } = await supabase.from('businesses').select('name').eq('id', businessId).single();
  if (businessError) throw businessError;

  const { data: profile, error: profileError } = await supabase.from('business_profiles').select('vision, positioning, icp, gtm_strategy, raw_synthesis, industry, core_problem, sub_issues, products, value_props, motto, strategic_philosophy').eq('business_id', businessId).maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new Error('No business profile found for this business yet — run company research first.');

  const businessContext = buildBusinessFitContext(profile);

  const data = await callAnthropic({
    max_tokens: 1024,
    system: ASSAY_CRITERIA_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `BUSINESS: ${business.name}\n\nBUSINESS PROFILE:\n${businessContext}` }],
    supabase,
    businessId,
    callType: 'assay_criteria',
  });
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text in assay criteria generation response');
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in assay criteria generation response');
  const parsed = JSON.parse(jsonMatch[0]);
  const assay_criteria = {
    fit_signals: parsed.fit_signals || '',
    disqualifiers: parsed.disqualifiers || '',
    tier_guidance: parsed.tier_guidance || '',
  };

  const { error: updateError } = await supabase.from('business_profiles').update({
    assay_criteria,
    assay_criteria_updated_at: new Date().toISOString(),
    assay_criteria_edited_manually: false,
  }).eq('business_id', businessId);
  if (updateError) throw updateError;

  return assay_criteria;
}

// outreach-intelligence-v1 Section 0a — server-side bulk generation must
// never trust a client-supplied voice profile; it pulls the running user's
// own profile fresh from voice_profiles by email instead.
export async function getVoiceProfileForUser(supabase, userEmail) {
  if (!userEmail) return null;
  const { data, error } = await supabase.from('voice_profiles').select('profile').eq('user_email', userEmail.toLowerCase()).maybeSingle();
  if (error || !data) return null;
  return data.profile;
}

// PROJECT STRATEGY — mirrors generateProfile but scoped strictly to a single
// project's own intel entries (project_id match), never the company-wide
// log. Compact by design - a project doesn't need the full profile shape,
// just a direction/strategy summary (smart-intake-and-intelligence-v1).
export async function generateProjectStrategy(supabase, projectId) {
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('name, business_id')
    .eq('id', projectId)
    .single();
  if (projectError) throw projectError;

  const { data: entries, error: entriesError } = await supabase
    .from('business_intel_entries')
    .select('content, source, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (entriesError) throw entriesError;

  if (!entries || entries.length === 0) return;

  const intelLog = entries.map(e => `[${e.source}] ${e.content}`).join('\n\n---\n\n');

  const data = await callAnthropic({
    max_tokens: 512,
    system: PROJECT_STRATEGY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `NOTES for project "${project.name}", oldest to newest:\n\n${intelLog}` }],
    supabase,
    businessId: project.business_id,
    callType: 'project_strategy',
  });

  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text in project strategy response');
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in project strategy response');
  const parsed = JSON.parse(jsonMatch[0]);

  const { error: updateError } = await supabase.from('projects').update({
    strategy_synthesis: parsed.strategy_synthesis || null,
    strategy_generated_at: new Date().toISOString(),
  }).eq('id', projectId);
  if (updateError) throw updateError;
}

// FILING PRIMITIVES — the three ways a piece of text ends up attached to
// this app's data, each usable standalone. Originally inlined separately in
// api/businesses/intel.js (manual add), intake.js (auto-file), and
// intake-confirm.js (confirmed new project/redirect) - extracted so all
// three (and any future caller, e.g. a bulk-import mode) share one path
// instead of drifting independently (smart-intake-and-intelligence-v1,
// modular-tools discipline).

// Cheap deterministic fallback, no model call - used whenever the caller
// doesn't already have a content_type from classifyIntake()'s own
// (already-paid-for) model call, e.g. the "Add Intel" textarea on
// BusinessDetailPage.js and intake-confirm.js's ambiguous-then-confirmed
// path, both of which reach fileCompanyIntel() without a fresh
// classification (business-intel-smart-upload-v1).
// "pricing" is a legacy category from a previous system - not something
// worth engineering real detection for right now, so it's left out of this
// heuristic entirely rather than tightened. The old bare "$[\d,]+" check
// false-matched on any document citing a dollar figure at all (a budget
// ask, a market-size stat), which is most real documents, not just pricing
// sheets. Re-add a real detector if pricing classification becomes
// something this app actually needs (business-intel-smart-upload-v1
// follow-up). classifyIntake()'s model-driven content_type (Smart Intake)
// still offers "pricing" as an option - only this deterministic fallback
// drops it.
function detectContentType(text) {
  const t = text.toLowerCase();
  if (/competitor|vs\.|versus|alternative to|battlecard|battle card/.test(t)) return 'competitive';
  if (/flyer|campaign|ad copy|social post|press release|marketing asset|brochure/.test(t)) return 'marketing_asset';
  if (/strategy|roadmap|vision|mission|\bokrs?\b|board deck|strategic plan|doctrine/.test(t)) return 'strategy_doc';
  return 'other';
}

export async function fileCompanyIntel(supabase, businessId, text, createdBy, contentType) {
  const { error } = await supabase.from('business_intel_entries')
    .insert({ business_id: businessId, project_id: null, source: 'manual', content: text, created_by: createdBy || null, content_type: contentType || detectContentType(text) });
  if (error) throw error;
  await generateProfile(supabase, businessId);
  const { data: profile, error: profileError } = await supabase.from('business_profiles').select('*').eq('business_id', businessId).maybeSingle();
  if (profileError) throw profileError;
  return profile;
}

export async function fileProjectIntel(supabase, projectId, text, createdBy) {
  const { data: project, error: projectError } = await supabase.from('projects').select('business_id').eq('id', projectId).single();
  if (projectError) throw projectError;
  const { error } = await supabase.from('business_intel_entries')
    .insert({ business_id: project.business_id, project_id: projectId, source: 'manual', content: text, created_by: createdBy || null });
  if (error) throw error;
  await generateProjectStrategy(supabase, projectId);
  const { data: updated, error: updatedError } = await supabase.from('projects').select('*').eq('id', projectId).single();
  if (updatedError) throw updatedError;
  return updated;
}

// Server-side twin of db.js's recordAccountActivity (client-side) - the
// same logic, but this runtime (Node, service key) can't share a literal
// module with the browser runtime, so this app has one canonical version
// per side rather than one call site reimplementing it per feature
// (accounts-lists-and-activity-model-v1). Appends a stamped note to the
// account's running handoffNotes log and updates the last_touched_by/at
// cache - called for every write that touches an existing account
// (smart intake account notes, CSV re-import matches, future call log).
export async function recordAccountActivity(supabase, accountId, memberEmail, type, note) {
  const { data: account, error: accountError } = await supabase.from('accounts').select('*').eq('id', accountId).single();
  if (accountError) throw accountError;
  const existingNotes = account.data?.handoffNotes || '';
  const stamp = `[${type} · ${new Date().toLocaleDateString()}] ${note}`;
  const nextNotes = existingNotes ? `${existingNotes}\n\n${stamp}` : stamp;
  const { error } = await supabase.from('accounts')
    .update({
      data: { ...account.data, handoffNotes: nextNotes },
      last_touched_by: memberEmail || null,
      last_touched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId);
  if (error) throw error;
  return account.data?.name || '';
}

const INTAKE_SYSTEM_PROMPT = `You classify a piece of free-text context Jack just typed about a business, and route it to the right place. Respond with ONLY a JSON object, no other text.

Return exactly this shape:
{
  "classification": "company_intel" | "existing_project" | "new_project" | "existing_account" | "new_account" | "ambiguous",
  "project_id": "the matching project's id if classification is existing_project, else null",
  "inferred_project_name": "a short inferred name if classification is new_project, else null",
  "account_id": "the matching account's id if classification is existing_account, else null",
  "new_account_names": ["array of company/account names mentioned if classification is new_account, else empty array"],
  "related_project_id": "if classification is new_account and the text also clearly references one of the existing projects listed, that project's id, else null",
  "content_type": "strategy_doc" | "marketing_asset" | "pricing" | "competitive" | "other"
}

Rules:
- Only use "existing_project" or "existing_account" if the text clearly refers to one of the exact projects/accounts listed below - do not guess a fuzzy match.
- Use "new_project" only if the text reads as a genuinely new initiative/effort worth tracking on its own, not just a one-off note.
- Use "new_account" if the text mentions one or more companies/accounts not in the existing list - list every distinct one you find in new_account_names.
- Use "company_intel" for general company-level notes that don't fit a specific project or account.
- Use "ambiguous" only if you genuinely cannot tell what this belongs to - a human will be asked to pick the destination, so prefer a real classification when there's a reasonable read and only fall back to "ambiguous" for text that's genuinely too thin or unclear to route (e.g. a single word, or text with no discernible subject).
- content_type is a best-guess document-kind tag, independent of classification - set it regardless of what classification you picked (it's only actually stored when the text ends up filed as company intel, but always attempt a real guess rather than defaulting to "other"). "strategy_doc" = vision/roadmap/positioning/doctrine, "marketing_asset" = campaign/ad/social/press copy, "pricing" = pricing/cost/discount structure, "competitive" = competitor comparisons/battlecards, "other" = anything that doesn't fit those four.`;

// Deterministic pre-check, not an AI judgment call - a raw scraped Instagram
// profile block (or a bare instagram.com URL) is structurally distinctive
// enough that a regex catches it more reliably than hoping the classifier
// prompt happens to recognize it, and skips burning a model call entirely
// when it does match. This is exactly the shape that got misfiled as
// company_intel before this existed (smart-intake-classification-confirm-v1,
// Phase 0 finding: aldknudsen43 test paste).
function detectInstagramProfileBlock(text) {
  const urlMatch = text.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
  const looksLikeScrapedProfile = /\d[\d,]*\s*followers/i.test(text) && /\d[\d,]*\s*following/i.test(text) && /\bposts\b/i.test(text);
  if (!urlMatch && !looksLikeScrapedProfile) return null;
  const atMatch = text.match(/@([a-zA-Z0-9._]+)/);
  const handle = urlMatch?.[1] || atMatch?.[1] || null;
  return { handle, bioText: text };
}

// SMART INTAKE — classifies free text against this business's current
// projects/accounts (id+name only, kept light) so the caller can route it.
// Read-only: makes no writes itself, callers decide what to file based on
// the classification (smart-intake-and-intelligence-v1). influencer is
// detected before ever calling the model - see detectInstagramProfileBlock.
export async function classifyIntake(supabase, businessId, text) {
  const instagramMatch = detectInstagramProfileBlock(text);
  if (instagramMatch) {
    return { classification: 'influencer', handle: instagramMatch.handle, bio_text: instagramMatch.bioText };
  }

  const [{ data: projects }, { data: accounts }] = await Promise.all([
    supabase.from('projects').select('id, name').eq('business_id', businessId),
    supabase.from('accounts').select('id, data').eq('business_id', businessId),
  ]);
  const projectList = (projects || []).map(p => `${p.id}: ${p.name}`).join('\n') || '(none yet)';
  const accountList = (accounts || []).map(a => `${a.id}: ${a.data?.name || '(unnamed)'}`).join('\n') || '(none yet)';

  const data = await callAnthropic({
    model: MODELS.FAST,
    max_tokens: 500,
    system: INTAKE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `EXISTING PROJECTS:\n${projectList}\n\nEXISTING ACCOUNTS:\n${accountList}\n\nTEXT TO CLASSIFY:\n${text}` }],
    supabase,
    businessId,
    callType: 'intake_classify',
  });

  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text in intake classification response');
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in intake classification response');
  return JSON.parse(jsonMatch[0]);
}

const ACCOUNT_FIELDS = ['name', 'web', 'vert', 'stage', 'linkedin', 'sfdc'];

const IMPORT_MAPPING_SYSTEM_PROMPT = `You map CSV columns from an account-list import onto a fixed set of known account fields, and (if the file has a per-row ownership/assignment column) match its values to a business's existing lists. Respond with ONLY a JSON object, no other text.

Known account fields you can map a column to: ${ACCOUNT_FIELDS.join(', ')} ("name" is company/account name - always try hardest to find this one; "web" is website/URL; "vert" is industry/vertical; "stage" is deal/pipeline stage; "linkedin" is a LinkedIn URL; "sfdc" is a Salesforce ID/link).

Return exactly this shape:
{
  "fieldMapping": { "<csv column header>": "<one of: ${ACCOUNT_FIELDS.join('|')}|ignore>" },
  "ownershipColumn": "<the csv column header that indicates who owns/is assigned each row, or null if none>",
  "valueToListId": { "<a distinct raw value seen in the ownership column>": "<the matching list's id from the list provided below>" },
  "unmatchedValues": ["<any distinct ownership-column values that don't confidently match any existing list>"]
}

Rules:
- Map every CSV column that reasonably corresponds to a known account field. Columns that don't map to anything go to "ignore" (or omit them).
- Only set ownershipColumn if a column clearly indicates who owns/is assigned/is the rep for each row (e.g. "Owner", "Rep", "Assigned To", "AE") - not if it's just a generic status field.
- If ownershipColumn is set, match its distinct values against the existing lists by name (fuzzy - e.g. "Jack", "jack@company.com", "J. Carlson" should all match a list literally named "Jack"). Only include a value in valueToListId if you're genuinely confident which list it means - anything else goes in unmatchedValues instead of guessing.
- If there's no clear ownership column, leave ownershipColumn null and both value maps empty - the caller will offer a single-list picker instead.`;

// IMPORT MAPPING — proposes a CSV column -> account field mapping, plus an
// optional per-row ownership-column -> list mapping, from just the headers
// and a small sample of rows (never the whole file). Read-only, makes no
// writes - the caller shows this as an editable proposal before any commit
// (csv-account-import-v1).
export async function classifyImportMapping(supabase, businessId, headers, sampleRows) {
  const { data: lists } = await supabase.from('lists').select('id, name').eq('business_id', businessId);
  const listText = (lists || []).map(l => `${l.id}: ${l.name}`).join('\n') || '(no lists yet on this business)';
  const sampleText = sampleRows.map((r, i) => `Row ${i + 1}: ${JSON.stringify(r)}`).join('\n');

  const data = await callAnthropic({
    model: MODELS.FAST,
    max_tokens: 800,
    system: IMPORT_MAPPING_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `CSV COLUMNS:\n${headers.join(', ')}\n\nSAMPLE ROWS:\n${sampleText}\n\nEXISTING LISTS ON THIS BUSINESS:\n${listText}` }],
    supabase,
    businessId,
    callType: 'import_mapping_classify',
  });

  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text in import mapping response');
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in import mapping response');
  return JSON.parse(jsonMatch[0]);
}

// generation-engine-consolidation-v1 Stage 5 - genuinely new capability, no
// precedent in this codebase (confirmed by the prior audit): a free-text
// human instruction translated into a uniform field:value override applied
// to every row of an import, e.g. "assign all these as Partners" ->
// relationship_type: "Partner" for every row. Deliberately narrow scope,
// matching the concrete ask: one directive -> one set of overrides for the
// whole import, not a per-row-conditional classifier (e.g. "mark the ones
// with a .edu email as Nonprofit" is out of scope - would need a fundamentally
// different, per-row-aware design). Values duplicated here rather than
// imported - RELATIONSHIP_TYPES/DEAL_STAGES live in BusinessStateControls.js
// (a React component) and INDUSTRIES (constants/industries.js) transitively
// imports extension-less relative paths (colors.js -> tokens.js) that don't
// resolve under this file's plain-Node ESM runtime, unlike config/models.js
// above (a leaf file, no further imports) - confirmed by a real failing
// import during this build, not assumed. Keep these three lists in sync with
// their real source files by hand, same convention ACCOUNT_FIELDS above
// already follows against CsvImportModal.js's own copy.
const DIRECTIVE_FIELD_VALUES = {
  relationship_type: ['Prospect/Lead', 'Client', 'Partner', 'Competitor'],
  vert: [
    'Consumer / Retail', 'E-commerce', 'Wellness & Health', 'Real Estate', 'Financial Services',
    'Manufacturing / Industrial', 'Food & Beverage', 'Hospitality', 'Media & Entertainment',
    'Technology / Software', 'Professional Services', 'Nonprofit / Association', 'Education',
    'Government / Public Sector', 'Other',
  ],
  stage: ['Prospecting', 'Engaged', 'Needs Follow-up', 'Active Deal', 'Qualified', 'Closed Won', 'Closed Lost'],
};

const DIRECTIVE_SYSTEM_PROMPT = `You translate a short human instruction into a uniform field override to apply to every row of a CSV account import. Respond with ONLY a JSON object, no other text.

Valid fields and their exact allowed values (the value in your response must match one of these exactly, verbatim):
- relationship_type: ${DIRECTIVE_FIELD_VALUES.relationship_type.join(', ')}
- vert (industry): ${DIRECTIVE_FIELD_VALUES.vert.join(', ')}
- stage: ${DIRECTIVE_FIELD_VALUES.stage.join(', ')}

Return exactly this shape:
{ "fieldOverrides": { "<field>": "<exact value from the list above>" } }

Rules:
- Only include a field if the instruction actually implies a value for it. Omit anything not mentioned.
- The value must be an exact match from the allowed list above - if the instruction implies something close but not an exact match (e.g. "mark these as vendors" with no "Vendor" value available), omit that field rather than guessing the closest one.
- If the instruction doesn't map to any of these fields at all, respond { "fieldOverrides": {} }.
- This override applies uniformly to every row - it does not vary per row.`;

// Directive-driven overrides win over inferred column mapping - an explicit
// human instruction is a stronger signal than a heuristic column-name guess.
// The caller applies DIRECTIVE_FIELD_VALUES overrides on top of
// classifyImportMapping's per-row fields, not the other way around.
export async function classifyImportDirective(supabase, businessId, directive) {
  if (!directive || !directive.trim()) return { fieldOverrides: {} };

  const data = await callAnthropic({
    model: MODELS.FAST,
    max_tokens: 200,
    system: DIRECTIVE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: directive.trim() }],
    supabase,
    businessId,
    callType: 'import_directive_classify',
  });

  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text in directive classification response');
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in directive classification response');
  const raw = JSON.parse(jsonMatch[0])?.fieldOverrides || {};

  // Validated server-side, not trusted blind - only keep fields/values that
  // are real, exact matches against the allowed lists above.
  const fieldOverrides = {};
  Object.entries(raw).forEach(([field, value]) => {
    if (DIRECTIVE_FIELD_VALUES[field]?.includes(value)) fieldOverrides[field] = value;
  });
  return { fieldOverrides };
}

// Full research pipeline: site fetch -> web search -> profile generation.
// Never throws - always resolves research_status to 'ready' or 'error' so
// nothing gets stuck on 'researching'. Runs after the HTTP response has
// already been sent (this is a persistent Express process via server.js,
// not serverless, so background work here reliably completes).
export async function runResearch(supabase, business) {
  try {
    await supabase.from('businesses').update({ research_status: 'researching' }).eq('id', business.id);

    const { content: siteText } = await fetchSiteContent(business.website_url);
    const truncated = (siteText || 'Site unreachable after multiple fetch attempts').slice(0, SITE_TEXT_TRUNCATE_CHARS);

    const { error: siteEntryError } = await supabase.from('business_intel_entries').insert({
      business_id: business.id,
      source: 'research_site',
      content: truncated,
    });
    if (siteEntryError) throw siteEntryError;

    // Light (own-company) businesses skip web_search entirely - no call, no
    // retry, nothing. Prospects (full) keep the existing pipeline unchanged,
    // web_search hang included - that's a separate, tracked issue.
    if (business.research_depth !== 'light') {
      const socialSeedContext = formatSocialLinksContext(business.social_links);
      const webData = await callAnthropic({
        max_tokens: 4096,
        system: 'You are researching a company for a business intelligence profile. Use web search to find recent news, competitors, market position, and social presence. Respond with a concise plain-text synthesis of your findings - no preamble, no JSON.',
        messages: [{ role: 'user', content: `Company: ${business.name}\nWebsite: ${business.website_url}${socialSeedContext ? `\nKnown social profiles (use as search anchors, not a fetch target): ${socialSeedContext}` : ''}` }],
        tools: [{ type: 'web_search_20260209', name: 'web_search', allowed_callers: ['direct'] }],
        supabase,
        businessId: business.id,
        callType: 'web_search',
      });
      const webFindings = (webData.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n\n') || 'No web findings available.';

      const { error: webEntryError } = await supabase.from('business_intel_entries').insert({
        business_id: business.id,
        source: 'research_web',
        content: webFindings,
      });
      if (webEntryError) throw webEntryError;
    }

    await generateProfile(supabase, business.id);

    await supabase.from('businesses').update({ research_status: 'ready', research_error: null }).eq('id', business.id);
  } catch (e) {
    console.error('[businesses] research failed:', e);
    await supabase.from('businesses').update({ research_status: 'error', research_error: String(e.message || e).slice(0, 500) }).eq('id', business.id);
  }
}
