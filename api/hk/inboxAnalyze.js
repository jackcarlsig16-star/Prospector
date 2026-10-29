// hkos-inbox-v2 L5 - Analyze: one click = exactly one STANDARD Claude call with web search (max 3 searches) about the
// sender's company. The email goes to Claude with addresses and phones replaced and is never kept; only the derived
// intel is stored, one row per workspace + domain in hk_domain_intel. A domain researched in the last 30 days returns
// the saved card and asks before spending again; 25 calls per user per Chicago day; usage lands in
// business_anthropic_usage (callAnthropic, call_type hk_inbox_analyze), which is also what the cap counts.
import { MODELS, estimateCostUsd } from '../../src/config/models.js';
import { signalNow, signalWords } from './signals.js';
import { scrubAddresses, cleanText } from '../sales/scrubText.js';
import { SEARCH_USD } from '../sales/partnerResearch.js';
import { HkError } from './hkShared.js';
import { dayIn } from './jobs/plan.js';

export const ANALYZE_CALL_TYPE = 'hk_inbox_analyze';
export const ANALYZE_DAILY_CAP = 25; // REVISABLE
export const ANALYZE_CACHE_DAYS = 30; // REVISABLE
export const ANALYZE_MAX_SEARCHES = 3; // REVISABLE
export const BODY_MAX = 4000;
const MAX_TOKENS = 2000;
const DAY_MS = 86_400_000;

const CATEGORIES = ['gym/studio', 'cafe/restaurant', 'consumer brand', 'agency/vendor', 'media/press', 'nonprofit', 'university', 'other'];
const KINDS = ['sponsor_interest', 'partnership', 'vendor_pitch', 'press', 'customer', 'personal', 'spam_or_marketing', 'other'];
const FITS = ['strong', 'possible', 'weak', 'not_a_fit'];
const NEXT = ['track_as_brand', 'reply_in_gmail', 'ignore_sender', 'no_action'];

export function analyzePrompt({ domain, senderName, subject, body, pitch = {} }) {
  const facts = [pitch.members_stat && `Members: ${pitch.members_stat}`, pitch.completions_stat && `Challenge completions: ${pitch.completions_stat}`,
    pitch.market_line_local && `Local pitch: ${pitch.market_line_local}`, pitch.market_line_national && `National pitch: ${pitch.market_line_national}`].filter(Boolean);
  const system = [
    'You research the company behind an email for HumanKind, a Chicago wellness app whose sponsors fund community challenges (gyms, studios, cafes, consumer brands).',
    `Use web_search at most ${ANALYZE_MAX_SEARCHES} times: the sender's own site first, then one recent source. Do not guess; use null or "unknown" when you cannot tell.`,
    facts.length ? `HumanKind facts: ${facts.join(' · ')}` : '',
    'Answer with ONE JSON object and nothing else, exactly this shape:',
    '{"company":{"name":"","website":"","what_they_do":"(<=200 chars)","hq_city":null,"chicago_presence":"yes|no|unknown","size_hint":null,',
    `"category":"${CATEGORIES.join('|')}"},"email":{"kind":"${KINDS.join('|')}","summary":"(<=160 chars)","urgency":"high|normal|low"},`,
    `"fit":{"sponsor_fit":"${FITS.join('|')}","why":"(<=240 chars)","challenge_idea":null},"next_step":"${NEXT.join('|')}","reason":"(<=160 chars)"}`,
    'Never include an email address or a phone number in the answer.',
  ].filter(Boolean).join('\n');
  const user = [`Sender domain: ${domain}`, `Sender name: ${scrubAddresses(senderName || '')}`, `Subject: ${scrubAddresses(subject || '')}`, '', 'Email (plain text, first 4,000 characters):', scrubAddresses(String(body || '').slice(0, BODY_MAX))].join('\n');
  return { system, user };
}

const str = (v, max) => (typeof v === 'string' && v.trim() ? cleanText(v, max) : null);
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
// The model's answer -> the stored shape: enums held to their lists, strings capped and scrubbed of addresses / phones.
export function parseIntel(text) {
  const raw = String(text || '');
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) throw new HkError(502, 'Analyze came back without a result. Try again.');
  let j; try { j = JSON.parse(raw.slice(a, b + 1)); } catch { throw new HkError(502, 'Analyze came back without a result. Try again.'); }
  const c = j.company || {}, e = j.email || {}, f = j.fit || {};
  return {
    company: { name: str(c.name, 160), website: str(c.website, 200), what_they_do: str(c.what_they_do, 200), hq_city: str(c.hq_city, 80),
      chicago_presence: pick(c.chicago_presence, ['yes', 'no', 'unknown'], 'unknown'), size_hint: str(c.size_hint, 40), category: pick(c.category, CATEGORIES, 'other') },
    email: { kind: pick(e.kind, KINDS, 'other'), summary: str(e.summary, 160), urgency: pick(e.urgency, ['high', 'normal', 'low'], 'normal') },
    fit: { sponsor_fit: pick(f.sponsor_fit, FITS, 'weak'), why: str(f.why, 240), challenge_idea: str(f.challenge_idea, 160) },
    next_step: pick(j.next_step, NEXT, 'no_action'),
    reason: str(j.reason, 160),
  };
}

const textOf = data => (data?.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');

// Today's Analyze calls by this user (Chicago day), from the usage log.
async function usedToday(supabase, businessId, uid, now) {
  const { data, error } = await supabase.from('business_anthropic_usage').select('created_at').eq('business_id', businessId).eq('user_id', uid).eq('call_type', ANALYZE_CALL_TYPE).gte('created_at', new Date(now.getTime() - 2 * DAY_MS).toISOString());
  if (error) throw new Error(error.message);
  const today = dayIn(now);
  return (data || []).filter(r => dayIn(new Date(r.created_at)) === today).length;
}

export async function cachedIntel(supabase, businessId, domain) {
  if (!domain) return null;
  const { data, error } = await supabase.from('hk_domain_intel').select('domain, intel, model, cost_usd, researched_at').eq('business_id', businessId).eq('domain', domain).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

// confirm = the caller already saw the cached card and asked to spend again.
export async function analyzeSender({ D, businessId, uid, domain, senderName, subject, body, confirm = false }) {
  const now = D.now();
  const saved = await cachedIntel(D.supabase, businessId, domain);
  if (saved && now.getTime() - Date.parse(saved.researched_at) < ANALYZE_CACHE_DAYS * DAY_MS && !confirm) return { ...saved, cached: true, needs_confirm: true };
  if ((await usedToday(D.supabase, businessId, uid, now)) >= ANALYZE_DAILY_CAP) throw new HkError(429, `Daily Analyze limit reached (${ANALYZE_DAILY_CAP}). It resets at midnight Chicago time.`);
  const { data: settings } = await D.supabase.from('hk_settings').select('members_stat, completions_stat, market_line_local, market_line_national').eq('business_id', businessId).maybeSingle();
  const { system, user } = analyzePrompt({ domain, senderName, subject, body, pitch: settings || {} });
  const model = MODELS.STANDARD;
  const data = await D.call({
    system, messages: [{ role: 'user', content: user }],
    tools: [{ type: 'web_search_20260209', name: 'web_search', allowed_callers: ['direct'], max_uses: ANALYZE_MAX_SEARCHES }],
    max_tokens: MAX_TOKENS, thinking: false, model, timeoutMs: 120000,
    supabase: D.supabase, businessId, userId: uid, callType: ANALYZE_CALL_TYPE,
  });
  if (data?.stop_reason === 'max_tokens') throw new HkError(502, 'Analyze was cut off. Try again.');
  const intel = parseIntel(textOf(data));
  const searches = data?.usage?.server_tool_use?.web_search_requests ?? 0;
  const cost = Math.round(((estimateCostUsd(model, data?.usage) ?? 0) + searches * SEARCH_USD) * 1e6) / 1e6;
  const row = { business_id: businessId, domain, intel, model, cost_usd: cost, researched_by: uid, researched_at: now.toISOString() };
  const { error } = await D.supabase.from('hk_domain_intel').upsert(row, { onConflict: 'business_id,domain' });
  if (error) throw new Error(error.message);
  const kind = intel.fit?.sponsor_fit === 'strong' ? 'research_strong_fit' : intel.fit?.sponsor_fit === 'possible' ? 'research_possible' : null;
  if (kind) {
    const { data: b } = await D.supabase.from('hk_brands').select('id, name, owner_user_id').eq('business_id', businessId).eq('domain', domain).is('archived_at', null).limit(1).maybeSingle();
    await signalNow(D.supabase, { businessId, kind, brandId: b?.id || null, domain: b ? null : domain, ownerUserId: b?.owner_user_id, occurredAt: row.researched_at, source: 'research', refType: 'domain_intel', refId: `${domain}:${row.researched_at}`, detail: `${b?.name || domain} ${signalWords(kind)}` }, now);
  }
  return { domain, intel, model, cost_usd: cost, researched_at: row.researched_at, cached: false, web_searches: searches };
}
