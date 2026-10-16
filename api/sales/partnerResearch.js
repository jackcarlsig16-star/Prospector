import { callAnthropic } from '../businesses/shared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { MODELS, estimateCostUsd } from '../../src/config/models.js';
import { getSupabase } from './goalsShared.js';
import { cleanText } from './scrubText.js';
import { laDateString } from './laDate.js';
import { normalizeDomain } from '../../src/constants/partnerDomains.js';

// partner-add-research-v1 REV3 Stage 2 - one Claude call with web_search per
// run, stored as a research_runs row. The run writes NOTHING to the partner:
// every field waits for a click (Confirm site / Use / Set category) in the
// card. Routes start the run and answer at once (202); the card polls GET.
// Queue runs (Stage 4) reuse startRun + completeRun with created_by null.
// The model never gets or returns people: the prompt forbids names, emails
// and phones and cleanText strips any address or number that slips through.

export const RERUN_CAP_PER_DAY = 5; // REVISABLE (spec): runs per partner per LA day, any trigger
export const MAX_SEARCHES = 3; // REVISABLE (spec, D5)
// Anthropic web search is billed per search on top of tokens ($10 / 1,000,
// list price checked 2026-10-16). research_runs.cost_usd includes it so the
// Stage 4 daily $ cap sees the real spend; business_anthropic_usage (written
// by callAnthropic) stays tokens-only like every other call.
export const SEARCH_USD = 0.01;
// A 'running' row older than this never finished (process restart mid-call).
export const STALE_RUNNING_MS = 10 * 60e3;
const MAX_TOKENS = 4096;
const CONFIDENCE = ['high', 'medium', 'low'];
export const TEXT_FIELDS = { summary: 500, mission: 240, positioning: 320, size: 160, hq_city: 80, recent_news: 320, housing_perk: 200, why_homelover: 320, first_angle: 220, watch_outs: 220, titles: 240 };
const err = (status, message) => Object.assign(new Error(message), { status });

export function researchSystem(business, categories) {
  const who = `${business.name}${business.tagline ? ` (${business.tagline})` : ''}${business.website_url ? `, ${business.website_url}` : ''}`;
  return [
    `You research one company as a possible channel partner for ${who}: a company that could offer ${business.name} to the employers, members or clients it already reaches.`,
    `Use web_search at most ${MAX_SEARCHES} times: first the company's own site (About, Careers, Partners pages), then one recent news or press source. Read what you find; do not guess.`,
    'Reply with ONE JSON object and nothing else - no prose before or after, no markdown fence:',
    '{"website": "https://...", "domain": "company.com", "website_confidence": "high|medium|low", "source_urls": ["https://..."], "summary": "", "mission": "", "positioning": "", "size": "", "hq_city": "", "recent_news": "", "housing_perk": "", "suggested_category": null, "why_homelover": "", "first_angle": "", "watch_outs": "", "titles": ""}',
    'Field rules:',
    '- website / domain: the official site. website_confidence high only when the site itself names the company; low when you could not find it (then website and domain are null).',
    '- source_urls: up to 3 real pages you opened.',
    '- summary: at most 60 words - what they do and who they serve.',
    '- mission: their own mission or tagline, quoted verbatim from their site, one sentence; "" if none found.',
    '- positioning: at most 40 words - how they describe themselves, notable awards or claims.',
    '- size: employees or a range, plus customers / members / clients if stated, each marked "est." when estimated, and where it comes from.',
    '- hq_city: city and state or country.',
    '- recent_news: at most 40 words from the last 12 months with the month (acquisitions, funding, launches, leadership); "none found" otherwise.',
    `- housing_perk: any mortgage, home-buying or housing benefit they already offer or resell, in one line; otherwise exactly "no housing perk found".`,
    `- suggested_category: exactly one string from CATEGORIES, or null when none fits.`,
    `- why_homelover: at most 40 words - why ${business.name} would matter to this company, in the company's own terms (their mission, their members, their catalog).`,
    '- first_angle: at most 25 words - the idea for an opening line that ties their words to a housing benefit.',
    '- watch_outs: at most 25 words - what makes this a poor or slow fit (competing perk, acquisition in progress, sells to the wrong audience).',
    '- titles: 2 to 4 job titles to approach first, comma separated.',
    'Never include any person\'s name, email address or phone number anywhere in the reply. Write in plain English, no bullet characters.',
    `CATEGORIES: ${JSON.stringify(categories)}`,
  ].join('\n');
}

export function researchUser(partner) {
  const known = [partner.company_domain && `known domain: ${partner.company_domain}`, partner.category && `category in our list: ${partner.category}`, partner.partner_role && `role we think they play: ${partner.partner_role}`, partner.sources && `sources we noted: ${cleanText(partner.sources, 300)}`].filter(Boolean);
  return `COMPANY: ${partner.name}${known.length ? `\n${known.join('\n')}` : ''}`;
}

const url = v => (typeof v === 'string' && /^https?:\/\/[^\s@]+$/i.test(v.trim()) ? v.trim().slice(0, 300) : null);

// The stored result: every text field scrubbed and capped, URLs real, the
// category one of ours or null, the domain normalized from domain or website.
export function parseResearch(text, categories) {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let raw;
  try { raw = JSON.parse(json); } catch { throw new Error('Could not read the AI reply'); }
  if (!raw || typeof raw !== 'object') throw new Error('Could not read the AI reply');
  const website = url(raw.website);
  const domain = normalizeDomain(raw.domain) || normalizeDomain(website);
  const out = {
    website: domain ? website : null, domain,
    website_confidence: domain && CONFIDENCE.includes(raw.website_confidence) ? raw.website_confidence : 'low',
    source_urls: [...new Set((Array.isArray(raw.source_urls) ? raw.source_urls : []).map(url).filter(Boolean))].slice(0, 3),
    suggested_category: categories.includes(raw.suggested_category) ? raw.suggested_category : null,
  };
  for (const [k, max] of Object.entries(TEXT_FIELDS)) out[k] = cleanText(raw[k], max) || null;
  return out;
}

export async function runsToday(supabase, businessId, entityType, entityId, now = Date.now()) {
  const { data, error } = await supabase.from('research_runs').select('created_at')
    .eq('business_id', businessId).eq('entity_type', entityType).eq('entity_id', entityId).gte('created_at', new Date(now - 36 * 3600e3).toISOString());
  if (error) throw new Error(error.message);
  const today = laDateString(new Date(now));
  return (data || []).filter(r => laDateString(new Date(r.created_at)) === today).length;
}

async function partnerContext(supabase, businessId, entityId) {
  const [partner, business, partners] = await Promise.all([
    supabase.from('sales_goals').select('id, name, category, partner_role, sources, company_domain').eq('business_id', businessId).eq('id', entityId).eq('goal_type', 'partnership').maybeSingle(),
    supabase.from('businesses').select('name, website_url, tagline').eq('id', businessId).maybeSingle(),
    selectAllPages(() => supabase.from('sales_goals').select('id, category').eq('business_id', businessId).eq('goal_type', 'partnership').order('id')),
  ]);
  for (const r of [partner, business]) if (r.error) throw new Error(r.error.message);
  if (!partner.data) throw err(404, 'partner not found');
  return { partner: partner.data, business: business.data || { name: 'this business' }, categories: [...new Set(partners.map(p => p.category).filter(Boolean))].sort() };
}

// Checks the cap, writes the 'running' row. Throws 404 / 429.
export async function startRun(supabase, { businessId, entityId, trigger, userId = null, now = Date.now() }) {
  const ctx = await partnerContext(supabase, businessId, entityId);
  if (await runsToday(supabase, businessId, 'partner', entityId, now) >= RERUN_CAP_PER_DAY) throw err(429, `Research cap reached (${RERUN_CAP_PER_DAY} per partner per day)`);
  const { data, error } = await supabase.from('research_runs')
    .insert({ business_id: businessId, entity_type: 'partner', entity_id: entityId, trigger, status: 'running', model: MODELS.STANDARD, created_by: userId }).select().single();
  if (error) throw new Error(error.message);
  return { ...ctx, run: data };
}

// The call itself; the row ends 'done' with the result or 'error' with the
// message, never stays 'running'. call is swapped for a fixture in tests.
export async function completeRun(supabase, { run, partner, business, categories, userId = null, call = callAnthropic }) {
  const patch = {};
  try {
    const data = await call({
      system: researchSystem(business, categories), messages: [{ role: 'user', content: researchUser(partner) }],
      tools: [{ type: 'web_search_20260209', name: 'web_search', allowed_callers: ['direct'], max_uses: MAX_SEARCHES }],
      max_tokens: MAX_TOKENS, thinking: false, model: run.model, timeoutMs: 150000,
      supabase, businessId: run.business_id, userId, callType: 'partner_research',
    });
    if (data.stop_reason === 'max_tokens') throw new Error('The reply was cut off - re-run');
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const result = parseResearch(text, categories);
    result.web_searches = data.usage?.server_tool_use?.web_search_requests ?? 0;
    const cost = (estimateCostUsd(run.model, data.usage) ?? 0) + result.web_searches * SEARCH_USD;
    Object.assign(patch, { status: 'done', result, input_tokens: data.usage?.input_tokens ?? null, output_tokens: data.usage?.output_tokens ?? null, cost_usd: Math.round(cost * 1e6) / 1e6 });
  } catch (e) {
    Object.assign(patch, { status: 'error', error: String(e.message || e).slice(0, 1000) });
  }
  const { data, error } = await supabase.from('research_runs').update(patch).eq('id', run.id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

// Start + finish in one await (tests, Stage 4 queue).
export async function research(supabase, opts) {
  const s = await startRun(supabase, opts);
  return completeRun(supabase, { ...s, userId: opts.userId, call: opts.call });
}

// Start now, finish in the background; the caller gets the 'running' row.
export async function kickResearch(supabase, opts) {
  const s = await startRun(supabase, opts);
  completeRun(supabase, { ...s, userId: opts.userId, call: opts.call }).catch(e => console.error('[partner research]', e.message));
  return s.run;
}

// Newest first, at most 3; a 'running' row past STALE_RUNNING_MS is closed
// as an error here so the card and the caps never wait on a dead run.
export async function listRuns(supabase, businessId, entityType, entityId, now = Date.now()) {
  const { data, error } = await supabase.from('research_runs').select('*')
    .eq('business_id', businessId).eq('entity_type', entityType).eq('entity_id', entityId).order('created_at', { ascending: false }).limit(3);
  if (error) throw new Error(error.message);
  const runs = [];
  for (const r of data) {
    if (r.status === 'running' && now - Date.parse(r.created_at) > STALE_RUNNING_MS) {
      const { data: closed, error: cErr } = await supabase.from('research_runs').update({ status: 'error', error: 'Research did not finish - re-run' }).eq('id', r.id).select().single();
      if (cErr) throw new Error(cErr.message);
      runs.push(closed);
    } else runs.push(r);
  }
  return runs;
}

// GET /goals/partners/:id/research -> { runs, today, cap }
export async function listResearchRoute(req, res, supabase = getSupabase()) {
  const businessId = req.params.businessId;
  try {
    const { data: partner, error } = await supabase.from('sales_goals').select('id').eq('business_id', businessId).eq('id', req.params.id).eq('goal_type', 'partnership').maybeSingle();
    if (error) throw new Error(error.message);
    if (!partner) return res.status(404).json({ error: 'partner not found' });
    const [runs, today] = await Promise.all([listRuns(supabase, businessId, 'partner', partner.id), runsToday(supabase, businessId, 'partner', partner.id)]);
    res.json({ runs, today, cap: RERUN_CAP_PER_DAY });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}

// POST /goals/partners/:id/research -> 202 { run } (status running); 429 at the cap.
export async function runResearchRoute(req, res, supabase = getSupabase(), call) {
  try {
    const run = await kickResearch(supabase, { businessId: req.params.businessId, entityId: req.params.id, trigger: 'manual', userId: req.auth.user.id, call });
    res.status(202).json({ run });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}
