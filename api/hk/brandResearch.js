// grow-inbox-intel-v1 REV3 R1 - research a BRAND (not an email): one STANDARD call, web_search <= 3, the same scrub,
// parse and 30-day hk_domain_intel cache as Analyze. With no domain the model first finds the brand's official website
// (never a marketplace / social / listing / news / directory page) and reports it with high | low confidence. The found
// website is stored as a SUGGESTION on the brand (domain_suggested*); research never writes hk_brands.domain - only a
// member's Use click does (useDomainRoute, duplicate-domain check, Activity row). Nothing found -> research_attempted_at.
import { MODELS, estimateCostUsd } from '../../src/config/models.js';
import { scrubAddresses } from '../sales/scrubText.js';
import { SEARCH_USD } from '../sales/partnerResearch.js';
import { getSupabase, HkError, fail, me, logEvent, brandById, liveBrands, brandDetail, normalizeDomain } from './hkShared.js';
import { parseIntel, textOf, cachedIntel, usedToday, ANALYZE_CALL_TYPE, ANALYZE_DAILY_CAP, ANALYZE_CACHE_DAYS, ANALYZE_MAX_SEARCHES } from './inboxAnalyze.js';
import { signalNow, signalWords, moveDomainSignals } from './signals.js';
import { callAnthropic } from '../businesses/shared.js';

export const SWEEP_CALL_TYPE = 'hk_research_sweep';
const MAX_TOKENS = 2000;
const DAY_MS = 864e5;
// Hosts that are never a brand's own website.
const NOT_A_SITE = /(^|\.)(amazon|etsy|faire|instagram|facebook|linkedin|tiktok|twitter|x|youtube|pinterest|yelp|google|crunchbase|wikipedia|shopify|walmart|target|ebay|linktr)\.[a-z.]+$/i;

export function websiteOf(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const d = normalizeDomain(raw.trim());
  return d && !NOT_A_SITE.test(d) ? d : null;
}

export function researchPrompt({ brand, pitch = {} }) {
  const facts = [pitch.members_stat && `Members: ${pitch.members_stat}`, pitch.completions_stat && `Challenge completions: ${pitch.completions_stat}`,
    pitch.market_line_local && `Local pitch: ${pitch.market_line_local}`, pitch.market_line_national && `National pitch: ${pitch.market_line_national}`].filter(Boolean);
  const find = brand.domain
    ? `Its website is ${brand.domain}: research that site first, then one recent source.`
    : 'First find the brand\'s OFFICIAL website - not a marketplace, social profile, Amazon / Etsy / Faire listing, news article or directory - then research that site. If you cannot find it with confidence, say so (website_domain null).';
  const system = [
    'You research a brand for HumanKind, a Chicago wellness app whose sponsors fund community challenges (gyms, studios, cafes, consumer brands).',
    `Use web_search at most ${ANALYZE_MAX_SEARCHES} times. ${find} Do not guess; use null or "unknown" when you cannot tell.`,
    facts.length ? `HumanKind facts: ${facts.join(' · ')}` : '',
    'Answer with ONE JSON object and nothing else, exactly this shape:',
    '{"website_domain":"brand.com or null","website_confidence":"high|low","company":{"name":"","website":"","what_they_do":"(<=200 chars)","industry":"(<=40 chars, e.g. Outdoor apparel)","hq_city":null,"chicago_presence":"yes|no|unknown","size_hint":null,',
    '"category":"gym/studio|cafe/restaurant|consumer brand|agency/vendor|media/press|nonprofit|university|other"},',
    '"fit":{"sponsor_fit":"strong|possible|weak|not_a_fit","why":"(<=240 chars)","challenge_idea":null},"next_step":"track_as_brand|no_action","reason":"(<=160 chars)"}',
    'Never include an email address or a phone number in the answer.',
  ].filter(Boolean).join('\n');
  const user = [`Brand name: ${scrubAddresses(brand.name || '')}`, brand.category ? `Category: ${scrubAddresses(brand.category)}` : '', brand.city ? `City: ${scrubAddresses(brand.city)}` : '', brand.segment ? `Segment: ${brand.segment}` : '', brand.domain ? `Website: ${brand.domain}` : '',
    brand.research_context ? `Context from the team: ${scrubAddresses(brand.research_context)}` : ''].filter(Boolean).join('\n');
  return { system, user };
}

// The website fields from the raw answer (parseIntel keeps the rest).
export function parseWebsite(text) {
  const raw = String(text || ''), a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  let j = {}; try { j = JSON.parse(raw.slice(a, b + 1)); } catch { j = {}; }
  const domain = websiteOf(j.website_domain);
  return { domain, confidence: domain ? (j.website_confidence === 'high' ? 'high' : 'low') : null };
}

export const freshIntel = (row, now) => !!row && now.getTime() - Date.parse(row.researched_at) < ANALYZE_CACHE_DAYS * DAY_MS;
export const attemptedRecently = (brand, now, retryDays = 30) => !!brand.research_attempted_at && now.getTime() - Date.parse(brand.research_attempted_at) < retryDays * DAY_MS;

// -> { status: 'cached' | 'researched' | 'not_found', domain, intel?, confidence?, cost_usd, web_searches }
// callType ANALYZE_CALL_TYPE (a click, under the shared 25/day per-user cap) or SWEEP_CALL_TYPE (M2, capped by the sweep).
// website (U8 "Use a different website"): research that site instead; the result becomes the brand's SUGGESTION, never
// hk_brands.domain.
export async function researchBrand({ D, businessId, uid = null, brand: saved0, callType = ANALYZE_CALL_TYPE, confirm = false, website = null }) {
  const now = D.now();
  const brand = website ? { ...saved0, domain: website } : saved0;
  const known = brand.domain || brand.domain_suggested || null;
  const saved = await cachedIntel(D.supabase, businessId, known);
  if (freshIntel(saved, now) && !confirm) return { status: 'cached', domain: known, intel: saved.intel, cost_usd: 0, web_searches: 0, researched_at: saved.researched_at, needs_confirm: true };
  if (callType === ANALYZE_CALL_TYPE && (await usedToday(D.supabase, businessId, uid, now)) >= ANALYZE_DAILY_CAP) throw new HkError(429, `Daily research limit reached (${ANALYZE_DAILY_CAP}). It resets at midnight Chicago time.`);
  const { data: pitch } = await D.supabase.from('hk_settings').select('members_stat, completions_stat, market_line_local, market_line_national').eq('business_id', businessId).maybeSingle();
  const { system, user } = researchPrompt({ brand, pitch: pitch || {} });
  const model = MODELS.STANDARD;
  const data = await D.call({
    system, messages: [{ role: 'user', content: user }],
    tools: [{ type: 'web_search_20260209', name: 'web_search', allowed_callers: ['direct'], max_uses: ANALYZE_MAX_SEARCHES }],
    max_tokens: MAX_TOKENS, thinking: false, model, timeoutMs: 120000,
    supabase: D.supabase, businessId, userId: uid, callType,
  });
  if (data?.stop_reason === 'max_tokens') throw new HkError(502, 'Research was cut off. Try again.');
  const text = textOf(data);
  const searches = data?.usage?.server_tool_use?.web_search_requests ?? 0;
  const cost = Math.round(((estimateCostUsd(model, data?.usage) ?? 0) + searches * SEARCH_USD) * 1e6) / 1e6;
  const site = brand.domain ? { domain: brand.domain, confidence: 'high' } : parseWebsite(text);
  if (!site.domain) {
    if (!brand.id) return { status: 'not_found', domain: null, cost_usd: cost, web_searches: searches };
    const { error } = await D.supabase.from('hk_brands').update({ research_attempted_at: now.toISOString() }).eq('id', brand.id).eq('business_id', businessId);
    if (error) throw new Error(error.message);
    return { status: 'not_found', domain: null, cost_usd: cost, web_searches: searches };
  }
  const intel = parseIntel(text);
  const at = now.toISOString();
  const { error } = await D.supabase.from('hk_domain_intel').upsert({ business_id: businessId, domain: site.domain, intel, model, cost_usd: cost, researched_by: uid, researched_at: at }, { onConflict: 'business_id,domain' });
  if (error) throw new Error(error.message);
  const suggest = brand.id && (website ? website !== saved0.domain : !brand.domain);
  if (suggest) {
    const { error: e2 } = await D.supabase.from('hk_brands').update({ domain_suggested: site.domain, domain_suggested_at: at, domain_confidence: site.confidence }).eq('id', brand.id).eq('business_id', businessId);
    if (e2) throw new Error(e2.message);
  }
  const kind = intel.fit?.sponsor_fit === 'strong' ? 'research_strong_fit' : intel.fit?.sponsor_fit === 'possible' ? 'research_possible' : null;
  if (kind) await signalNow(D.supabase, { businessId, kind, brandId: brand.id || null, domain: brand.id ? null : site.domain, ownerUserId: brand.owner_user_id, occurredAt: at, source: 'research', refType: 'domain_intel', refId: `${site.domain}:${at}`, detail: `${brand.name} ${signalWords(kind)}` }, now);
  return { status: 'researched', domain: site.domain, confidence: site.confidence, suggested: !!suggest, intel, cost_usd: cost, web_searches: searches, researched_at: at };
}

const deps = d => ({ supabase: d.supabase || getSupabase(), call: d.call || callAnthropic, now: d.now || (() => new Date()) });

// POST /brands/:id/research { click: true, confirm?, website? } - Research on a card or the brand page (member; hkGate).
// website = "Use a different website": that site is researched and offered as a suggestion.
export async function researchBrandRoute(req, res, d = {}) {
  const D = deps(d), businessId = req.params.businessId;
  try {
    if (req.body?.click !== true) throw new HkError(400, 'Research runs only from a click');
    const brand = await brandById(D.supabase, businessId, req.params.id);
    if (brand.archived_at) throw new HkError(409, 'that brand is archived');
    let website = null;
    if (req.body.website != null) { website = websiteOf(String(req.body.website)); if (!website) throw new HkError(400, "That isn't a brand's own website"); }
    res.json(await researchBrand({ D, businessId, uid: me(req), brand, confirm: req.body.confirm === true, website }));
  } catch (e) { fail(res, e, 'brands/research'); }
}

// GET /brands/:id/research-input - "View last research input": what the next research sends about this brand (the
// user part of the prompt: name, category, city, website, the team's context). No address, no call.
export async function researchInputRoute(req, res, d = {}) {
  const D = deps(d);
  try {
    const brand = await brandById(D.supabase, req.params.businessId, req.params.id);
    res.json({ input: researchPrompt({ brand }).user, context: brand.research_context || null });
  } catch (e) { fail(res, e, 'brands/research-input'); }
}

// POST /brands/:id/use-domain - copy the suggested website to hk_brands.domain (member click, Activity row). Refused when
// the brand already has a domain or another live brand is on that domain.
export async function useDomainRoute(req, res, d = {}) {
  const D = deps(d), businessId = req.params.businessId;
  try {
    const brand = await brandById(D.supabase, businessId, req.params.id);
    if (!brand.domain_suggested) throw new HkError(409, 'no suggested website on this brand');
    if (brand.domain) throw new HkError(409, `${brand.name} already has a website (${brand.domain})`);
    const other = (await liveBrands(D.supabase, businessId)).find(b => b.id !== brand.id && b.domain === brand.domain_suggested);
    if (other) throw new HkError(409, `Already on ${other.name}`, { brand_id: other.id });
    const { data, error } = await D.supabase.from('hk_brands').update({ domain: brand.domain_suggested, updated_at: D.now().toISOString() }).eq('id', brand.id).eq('business_id', businessId).select().single();
    if (error) throw new Error(error.message);
    await moveDomainSignals(D.supabase, businessId, data.domain, brand.id);
    await logEvent(D.supabase, { businessId, actorUserId: me(req), entityType: 'brand', entityId: brand.id, action: 'brand.domain_used', detail: { name: brand.name, domain: data.domain, confidence: brand.domain_confidence } });
    res.json({ brand: brandDetail(data) });
  } catch (e) { fail(res, e, 'brands/use-domain'); }
}

// POST /brands/:id/wrong-site { undo? } - a member says the suggested website is wrong: the suggestion is cleared and
// research_attempted_at = now keeps the sweep off the brand for 30 days. hk_brands.domain is never touched. The Activity
// row's detail holds the cleared values; { undo: true } puts them back from the latest row, only while the brand is
// exactly as the rejection left it and within WRONG_SITE_UNDO_MS (the client offers Undo for 10 s).
export const WRONG_SITE_UNDO_MS = 60000;
export async function wrongSiteRoute(req, res, d = {}) {
  const D = deps(d), businessId = req.params.businessId;
  try {
    const brand = await brandById(D.supabase, businessId, req.params.id);
    const at = D.now().toISOString();
    const write = async patch => {
      const { data, error } = await D.supabase.from('hk_brands').update({ ...patch, updated_at: at }).eq('id', brand.id).eq('business_id', businessId).select().single();
      if (error) throw new Error(error.message);
      return data;
    };
    if (req.body?.undo === true) {
      const { data: rows, error } = await D.supabase.from('hk_events').select('detail, created_at').eq('business_id', businessId).eq('entity_id', brand.id).eq('action', 'brand.domain_rejected').order('created_at', { ascending: false }).limit(1);
      if (error) throw new Error(error.message);
      const last = rows?.[0];
      if (!last || D.now().getTime() - Date.parse(last.created_at) > WRONG_SITE_UNDO_MS) throw new HkError(409, 'Too late to undo; research the brand again instead');
      if (brand.domain || brand.domain_suggested || Date.parse(brand.research_attempted_at) !== Date.parse(last.detail.rejected_at)) throw new HkError(409, `${brand.name} changed since; nothing undone`);
      const x = last.detail, name = brand.name;
      const data = await write({ domain_suggested: x.domain, domain_suggested_at: x.suggested_at, domain_confidence: x.confidence, research_attempted_at: x.attempted_before });
      await logEvent(D.supabase, { businessId, actorUserId: me(req), entityType: 'brand', entityId: brand.id, action: 'brand.domain_restored', detail: { name, domain: x.domain } });
      return res.json({ brand: brandDetail(data) });
    }
    if (!brand.domain_suggested) throw new HkError(409, 'no suggested website on this brand');
    if (brand.domain) throw new HkError(409, `${brand.name} already has a website (${brand.domain})`);
    const detail = { name: brand.name, domain: brand.domain_suggested, suggested_at: brand.domain_suggested_at || null, confidence: brand.domain_confidence || null, attempted_before: brand.research_attempted_at || null, rejected_at: at };
    const data = await write({ domain_suggested: null, domain_suggested_at: null, domain_confidence: null, research_attempted_at: at });
    await logEvent(D.supabase, { businessId, actorUserId: me(req), entityType: 'brand', entityId: brand.id, action: 'brand.domain_rejected', detail });
    res.json({ brand: brandDetail(data) });
  } catch (e) { fail(res, e, 'brands/wrong-site'); }
}
