import { supabase, isSupabaseEnabled } from './supabase';
import { getBusinessProfileSummary } from './db';

// company-intel-extraction-v1 — assembles a business's own context (Company
// Intel, fit criteria, outreach rules, projects, campaigns) as a markdown
// string sized to paste into an external chat as a priming message.
// Deliberately does NOT touch outreach_doctrine (platform-scope, not
// business-scoped — ground-truth audit confirmed zero business_id
// filtering anywhere it's queried) or voiceExamples (per-AE, localStorage
// only, no server persistence at all — genuinely not business-level data).
// Reuses getBusinessProfileSummary (db.js) for assay_criteria/
// outreach_rules rather than re-querying business_profiles a second time
// for those two fields.

const PROFILE_FIELDS = [
  ['vision', 'Vision'],
  ['positioning', 'Positioning'],
  ['icp', 'ICP'],
  ['gtm_strategy', 'GTM Strategy'],
  ['competitors', 'Competitors'],
  ['raw_synthesis', 'Recent Changes'],
  ['industry', 'Industry'],
  ['core_problem', 'Core Problem'],
  ['sub_issues', 'Sub-Issues'],
  ['products', 'Products'],
  ['value_props', 'Value Props'],
  ['motto', 'Motto'],
  ['strategic_philosophy', 'Strategic Philosophy'],
];

const SOCIAL_LABELS = [
  ['linkedin', 'LinkedIn'],
  ['instagram', 'Instagram'],
  ['twitter', 'Twitter / X'],
  ['facebook', 'Facebook'],
];

function fieldLine(label, value) {
  if (Array.isArray(value)) {
    if (!value.length) return null;
    return `**${label}:**\n${value.map(v => `- ${v}`).join('\n')}`;
  }
  if (typeof value === 'string' && value.trim()) return `**${label}:** ${value.trim()}`;
  return null;
}

function projectBlock(p) {
  const lines = [
    fieldLine('Objective', p.objective),
    fieldLine('Target Type', p.target_type),
    fieldLine('Ask / Offer', p.ask_type),
    fieldLine('Hook', p.project_hook),
    fieldLine('Exclusions', p.exclusions),
    fieldLine('Strategy', p.strategy_synthesis),
  ].filter(Boolean);
  if (!lines.length) return null;
  return `### ${p.name}\n\n${lines.join('\n\n')}`;
}

function campaignBlock(c) {
  const lines = [
    fieldLine('Recipients', c.recipient_description),
    fieldLine('Doctrine', c.doctrine),
  ].filter(Boolean);
  if (!lines.length) return null;
  return `### ${c.name}\n\n${lines.join('\n\n')}`;
}

// businessId only. Self-contained on purpose — importable without pulling
// in any page component, callable from anywhere given just an id.
export async function buildBusinessContextMarkdown(businessId) {
  if (!isSupabaseEnabled() || !businessId) return '';

  const [businessRes, profileRes, projectsRes, campaignsRes, summary] = await Promise.all([
    supabase.from('businesses').select('name, tagline, website_url, social_links').eq('id', businessId).single(),
    supabase.from('business_profiles').select(PROFILE_FIELDS.map(([k]) => k).join(', ')).eq('business_id', businessId).maybeSingle(),
    supabase.from('projects').select('name, objective, target_type, ask_type, project_hook, exclusions, strategy_synthesis').eq('business_id', businessId),
    supabase.from('campaigns').select('name, recipient_description, doctrine').eq('business_id', businessId),
    getBusinessProfileSummary(businessId),
  ]);

  const business = businessRes.data;
  if (!business) return '';
  const profile = profileRes.data || {};
  const projects = projectsRes.data || [];
  const campaigns = campaignsRes.data || [];

  const parts = [];

  // Header — name, tagline, website on its own clearly-labeled line so a
  // receiving model recognizes it as something it can search.
  parts.push(`# ${business.name}`);
  if (business.tagline?.trim()) parts.push(business.tagline.trim());
  if (business.website_url?.trim()) parts.push(`**Website:** ${business.website_url.trim()}`);
  const socialLines = SOCIAL_LABELS
    .map(([k, label]) => (business.social_links?.[k]?.trim() ? `**${label}:** ${business.social_links[k].trim()}` : null))
    .filter(Boolean);
  if (socialLines.length) parts.push(socialLines.join('\n'));

  // Preamble — proposal, not decided; flag back rather than iterating
  // silently if the wording doesn't land once Jack sees real output.
  parts.push(
    `This is a structured export of ${business.name}'s business context from Prospector, for background when researching or drafting outreach involving this company. The website above can be searched for current public information.`
  );

  // Company Intel — omit the whole section if every field is empty.
  const intelLines = PROFILE_FIELDS.map(([key, label]) => fieldLine(label, profile[key])).filter(Boolean);
  if (intelLines.length) parts.push(`## Company Intel\n\n${intelLines.join('\n\n')}`);

  // Fit criteria — via getBusinessProfileSummary, not a second raw query.
  const criteria = summary?.assay_criteria;
  const criteriaLines = [
    fieldLine('Fit Signals', criteria?.fit_signals),
    fieldLine('Disqualifiers', criteria?.disqualifiers),
    fieldLine('Tier Guidance', criteria?.tier_guidance),
  ].filter(Boolean);
  if (criteriaLines.length) parts.push(`## Fit Criteria\n\n${criteriaLines.join('\n\n')}`);

  // Outreach rules — via the same summary call.
  const rules = summary?.outreach_rules;
  const rulesLines = [
    fieldLine('Tone', rules?.tone),
    fieldLine('Structure', rules?.structure),
    fieldLine('Key Points', rules?.key_points),
    fieldLine('Do', rules?.dos),
    fieldLine("Don't", rules?.donts),
    fieldLine('Example Language', rules?.example_snippets),
  ].filter(Boolean);
  if (rulesLines.length) parts.push(`## Outreach Rules\n\n${rulesLines.join('\n\n')}`);

  // Projects / Campaigns — no heading at all when there are none.
  const projectBlocks = projects.map(projectBlock).filter(Boolean);
  if (projectBlocks.length) parts.push(`## Projects\n\n${projectBlocks.join('\n\n')}`);

  const campaignBlocks = campaigns.map(campaignBlock).filter(Boolean);
  if (campaignBlocks.length) parts.push(`## Campaigns\n\n${campaignBlocks.join('\n\n')}`);

  return parts.join('\n\n');
}
