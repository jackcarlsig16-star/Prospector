import { createClient } from '@supabase/supabase-js';
import { fetchSiteContent } from '../assay.js';
import { MODELS } from '../../src/config/models.js';

// Same pattern as api/sfdc/sync-compliance.js
export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

const SITE_TEXT_TRUNCATE_CHARS = 6000;

async function callAnthropic({ system, messages, tools, max_tokens, supabase, businessId, callType }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not configured');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(90000), // every other Anthropic/external call in this app bounds its fetch - this one was the one gap
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODELS.STANDARD,
      max_tokens,
      thinking: { type: 'adaptive' },
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
      model: MODELS.STANDARD,
    });
    if (usageError) console.warn('[businesses] usage log failed:', usageError.message);
  }

  return data;
}

const LIGHT_SYSTEM_PROMPT = `You track recent changes for a company Jack does outreach on behalf of, based on its own site content and notes - not a prospect he's researching. Respond with ONLY a JSON object, no other text.

Return exactly this shape:
{
  "raw_synthesis": "2-4 short sentences on what appears new, changed, or worth knowing since the last check - new offerings, messaging shifts, notable site changes. This is quick context for an outreach conversation, not a strategic document. If nothing meaningfully new stands out, say so plainly rather than padding."
}`;

const FULL_SYSTEM_PROMPT = `You synthesize accumulated research and notes about a company into a structured business profile. Respond with ONLY a JSON object, no other text.

Return exactly this shape:
{
  "vision": "the company's stated or inferred vision/mission, 2-3 sentences",
  "positioning": "how the company positions itself in its market, 2-3 sentences",
  "icp": "the company's ideal customer profile, 2-3 sentences",
  "gtm_strategy": "the company's go-to-market strategy, 2-3 sentences",
  "competitors": "known or likely competitors, comma-separated or short list",
  "raw_synthesis": "a fuller markdown synthesis covering anything the fields above don't capture"
}

Base every field on the intel log provided - do not invent facts it doesn't support. Where the log is thin on a field, give a clearly-labeled best inference rather than leaving it empty.`;

// PROFILE GENERATION — pulls the full intel log and synthesizes it into
// business_profiles. Called from both the research pipeline and the manual
// intel-add path, so it looks up research_depth itself rather than trusting
// the caller to pass it - a light business getting a manual intel entry
// must still get the light resynthesis, not the full GTM writeup.
export async function generateProfile(supabase, businessId) {
  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('name, research_depth')
    .eq('id', businessId)
    .single();
  if (businessError) throw businessError;
  const isLight = business.research_depth === 'light';

  const { data: entries, error: entriesError } = await supabase
    .from('business_intel_entries')
    .select('content, source, created_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: true });
  if (entriesError) throw entriesError;

  // Light businesses only need "what's changed since last check" - the full
  // accumulated history isn't relevant to that and just burns input tokens.
  // Full-depth profiles genuinely need the complete log for an accurate GTM writeup.
  const relevantEntries = isLight ? (entries || []).slice(-2) : (entries || []);
  const intelLog = relevantEntries
    .map(e => `[${e.source}] ${e.content}`)
    .join('\n\n---\n\n') || '(no intel yet)';

  const data = await callAnthropic({
    max_tokens: isLight ? 1024 : 4096,
    system: isLight ? LIGHT_SYSTEM_PROMPT : FULL_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `INTEL LOG for ${business.name}, oldest to newest:\n\n${intelLog}` }],
    supabase,
    businessId,
    callType: isLight ? 'profile_light' : 'profile_full',
  });

  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('No text in profile generation response');
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in profile generation response');
  const parsed = JSON.parse(jsonMatch[0]);

  const { error: upsertError } = await supabase.from('business_profiles').upsert({
    business_id: businessId,
    vision: isLight ? null : (parsed.vision || null),
    positioning: isLight ? null : (parsed.positioning || null),
    icp: isLight ? null : (parsed.icp || null),
    gtm_strategy: isLight ? null : (parsed.gtm_strategy || null),
    competitors: isLight ? null : (parsed.competitors || null),
    raw_synthesis: parsed.raw_synthesis || null,
    model_version: MODELS.STANDARD,
    generated_at: new Date().toISOString(),
  }, { onConflict: 'business_id' });
  if (upsertError) throw upsertError;
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
      const webData = await callAnthropic({
        max_tokens: 4096,
        system: 'You are researching a company for a business intelligence profile. Use web search to find recent news, competitors, market position, and social presence. Respond with a concise plain-text synthesis of your findings - no preamble, no JSON.',
        messages: [{ role: 'user', content: `Company: ${business.name}\nWebsite: ${business.website_url}` }],
        tools: [{ type: 'web_search_20260209', name: 'web_search' }],
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
