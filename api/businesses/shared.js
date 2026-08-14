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

async function callAnthropic({ system, messages, tools, max_tokens, supabase, businessId, callType, model = MODELS.STANDARD }) {
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
      model,
      max_tokens,
      // adaptive thinking isn't supported on the fast tier (confirmed live -
      // classifyIntake's MODELS.FAST call 500'd in production with "adaptive
      // thinking is not supported on this model"). It stays on for
      // STANDARD/REASONING synthesis calls, which is what it was added for.
      ...(model !== MODELS.FAST ? { thinking: { type: 'adaptive' } } : {}),
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

const LIGHT_SYSTEM_PROMPT = `You maintain a compact, current profile of a company Jack does outreach on behalf of, based on its own site content and notes - not a prospect he's researching. Respond with ONLY a JSON object, no other text.

Return exactly this shape:
{
  "vision": "the company's vision or mission as it currently reads from the notes provided, 1-2 sentences. If nothing meaningful is known yet, say so plainly rather than inventing one.",
  "current_strategy": "the company's current strategy or direction right now, 1-2 sentences, based only on the notes provided.",
  "recent_changes": "2-4 short sentences on what appears new, changed, or worth knowing since the last check - new offerings, messaging shifts, notable site changes. This is quick context for an outreach conversation, not a strategic document. If nothing meaningfully new stands out, say so plainly rather than padding."
}

Base every field on the notes provided - do not invent facts they don't support. Keep this compact - this is a lightweight running profile, not a full strategic writeup.`;

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

const PROJECT_STRATEGY_SYSTEM_PROMPT = `You track the strategy and direction of a specific project or initiative within a company Jack does outreach on behalf of, based solely on notes filed for that project. Respond with ONLY a JSON object, no other text.

Return exactly this shape:
{
  "strategy_synthesis": "2-4 short sentences on this project's current strategy, direction, and any notable recent developments, based only on the notes filed for it. If there isn't enough yet to say anything meaningful, say so plainly rather than padding."
}`;

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

  // project_id IS NULL - company-level synthesis must never pull in
  // project-scoped notes (smart-intake-and-intelligence-v1). Full history
  // for both depths now: light needs enough context to keep "vision" and
  // "current_strategy" stable across resyntheses, not just the latest 2
  // entries - "lightweight" now means compact prompt/output, not a starved
  // context window.
  const { data: entries, error: entriesError } = await supabase
    .from('business_intel_entries')
    .select('content, source, created_at')
    .eq('business_id', businessId)
    .is('project_id', null)
    .order('created_at', { ascending: true });
  if (entriesError) throw entriesError;

  const intelLog = (entries || [])
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

  // Light and full ask for different JSON field names but share the same
  // business_profiles columns - light's current_strategy/recent_changes map
  // onto the same gtm_strategy/raw_synthesis columns full's own field names
  // already target, so both depths render through the same ProfileBlock UI.
  const { error: upsertError } = await supabase.from('business_profiles').upsert({
    business_id: businessId,
    vision: parsed.vision || null,
    positioning: isLight ? null : (parsed.positioning || null),
    icp: isLight ? null : (parsed.icp || null),
    gtm_strategy: isLight ? (parsed.current_strategy || null) : (parsed.gtm_strategy || null),
    competitors: isLight ? null : (parsed.competitors || null),
    raw_synthesis: isLight ? (parsed.recent_changes || null) : (parsed.raw_synthesis || null),
    model_version: MODELS.STANDARD,
    generated_at: new Date().toISOString(),
  }, { onConflict: 'business_id' });
  if (upsertError) throw upsertError;
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

export async function fileCompanyIntel(supabase, businessId, text, createdBy) {
  const { error } = await supabase.from('business_intel_entries')
    .insert({ business_id: businessId, project_id: null, source: 'manual', content: text, created_by: createdBy || null });
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

export async function fileAccountNote(supabase, accountId, text) {
  const { data: account, error: accountError } = await supabase.from('accounts').select('*').eq('id', accountId).single();
  if (accountError) throw accountError;
  const existingNotes = account.data?.handoffNotes || '';
  const nextNotes = existingNotes ? `${existingNotes}\n\n[${new Date().toLocaleDateString()}] ${text}` : text;
  const { error } = await supabase.from('accounts')
    .update({ data: { ...account.data, handoffNotes: nextNotes }, updated_at: new Date().toISOString() })
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
  "related_project_id": "if classification is new_account and the text also clearly references one of the existing projects listed, that project's id, else null"
}

Rules:
- Only use "existing_project" or "existing_account" if the text clearly refers to one of the exact projects/accounts listed below - do not guess a fuzzy match.
- Use "new_project" only if the text reads as a genuinely new initiative/effort worth tracking on its own, not just a one-off note.
- Use "new_account" if the text mentions one or more companies/accounts not in the existing list - list every distinct one you find in new_account_names.
- Use "company_intel" for general company-level notes that don't fit a specific project or account.
- Use "ambiguous" only if you genuinely cannot tell what this belongs to - it will be filed as company-level intel as a safe fallback, so prefer a real classification when there's a reasonable read.`;

// SMART INTAKE — classifies free text against this business's current
// projects/accounts (id+name only, kept light) so the caller can route it.
// Read-only: makes no writes itself, callers decide what to file based on
// the classification (smart-intake-and-intelligence-v1).
export async function classifyIntake(supabase, businessId, text) {
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
