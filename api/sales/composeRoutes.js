import { getSupabase, laStartOfDayMs } from './goalsShared.js';
import { callAnthropic } from '../businesses/shared.js';
import { MODELS, estimateCostUsd } from '../../src/config/models.js';
import { laDateString } from './laDate.js';
import { cleanText, scrubAddresses } from './scrubText.js';
import { companyBrief, BRIEF_TYPES } from './companyBrief.js';
import { lintDraft, mergeRules } from './composeLint.js';

// intent-score-v1 S7 Write email - AI-first, never sends. ONE STANDARD call per draft (callType intent_compose, the
// usage row carries the cost) with the Brief as the only intel, the workspace's compose_prompt as the soft layer
// (voice, structure hook -> why them -> proof -> ask, tone) and the HARD rules enforced by composeLint on the draft
// the model returns and on any pasted draft. Daily cap per workspace (compose_rules.daily_cap, default 30, REVISABLE).
export const COMPOSE_DAILY_CAP = 30;
// Costs shown on the buttons are observed means, never constants (planner, Oct 27): Write email = the running mean of
// this workspace's intent_compose rows (null until the first); Research = the mean of its last 10 research_runs costs
// once 3 exist, else null ("cost: n/a yet").
export const RESEARCH_COST_MIN_RUNS = 3;
export const COST_SAMPLE = 10;
export const COMPOSE_MAX_TOKENS = 1200;
export const DEFAULT_COMPOSE_PROMPT = `You write short, plain first emails for a HomeLover account executive to a company the team wants to reach.
Voice: direct, warm, specific, no hype, no jargon, no exclamation marks. Short sentences. Hyphens only, never dashes.
Structure, in order: a one-line hook that comes from the Brief (something true about THEM), one or two lines on why
HomeLover fits them (from the Brief's research lines), one proof line only if a proof point is given, then the ask:
a 15-minute call, with two concrete time options left as placeholders like [Tue 10am] [Thu 2pm].
Never invent a fact, a number, a name or a title that is not in the Brief. No pricing. Sign off with the sender's first name alone on the last line.`;
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const firstName = n => String(n || '').trim().split(/\s+/)[0] || null;

export function composeSystem({ prompt, rules, signOff }) {
  return `${prompt}\n\nHARD RULES (checked by code; a draft that breaks one is rejected):\n- Every factual claim must trace to a Brief line; return each claim with the ref it came from.\n- Numbers only from the Brief or these proof points: ${rules.proof_points.length ? rules.proof_points.join(' | ') : '(none - use no numbers except the ${rules.ask_minutes}-minute ask)'}.\n- Never these phrases: ${rules.banned_claims.join(', ')}.\n- No pricing. Hyphens, never em or en dashes. At most ${rules.max_words} words in the body.\n- The last line of the body is exactly "${signOff || 'the sender first name'}".\n- No email address or phone number anywhere.\n\nReturn ONLY a JSON object: { "subject": string, "body": string, "why_this_company": string (one line), "claims": [{ "claim": string, "brief_ref": "B3" }] }.`;
}

export function parseDraft(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) throw Object.assign(new Error('The model returned no draft - try again'), { status: 502 });
  let j;
  try { j = JSON.parse(m[0]); } catch { throw Object.assign(new Error('The model returned an unreadable draft - try again'), { status: 502 }); }
  return {
    subject: cleanText(String(j.subject || ''), 200), body: scrubAddresses(String(j.body || '')).replace(/\r/g, '').split('\n').map(l => l.trim()).join('\n').trim().slice(0, 4000), why: cleanText(String(j.why_this_company || ''), 400),
    claims: (Array.isArray(j.claims) ? j.claims : []).slice(0, 40).map(c => ({ claim: cleanText(String(c?.claim || ''), 300), brief_ref: Array.isArray(c?.brief_ref) ? c.brief_ref.map(String).join(', ') : typeof c?.brief_ref === 'string' ? c.brief_ref.trim() : null })),
  };
}

export async function composeUsedToday(supabase, businessId, now = Date.now()) {
  const since = new Date(laStartOfDayMs(laDateString(new Date(now)))).toISOString();
  const r = await supabase.from('business_anthropic_usage').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('call_type', 'intent_compose').gte('created_at', since);
  if (r.error) throw new Error(r.error.message);
  return r.count ?? 0;
}

async function settingsFor(supabase, businessId) {
  const s = must(await supabase.from('sales_settings').select('*').eq('business_id', businessId).maybeSingle()) || {};
  const rules = mergeRules(s.compose_rules);
  return { prompt: typeof s.compose_prompt === 'string' && s.compose_prompt.trim() ? s.compose_prompt : DEFAULT_COMPOSE_PROMPT, rules, cap: Number.isInteger(s.compose_rules?.daily_cap) ? s.compose_rules.daily_cap : COMPOSE_DAILY_CAP, custom_prompt: !!(typeof s.compose_prompt === 'string' && s.compose_prompt.trim()) };
}

const meanCost = (rows, min) => { const v = rows.map(r => Number(r.cost_usd)).filter(Number.isFinite); return v.length >= min ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1e4) / 1e4 : null; };
export async function observedCosts(supabase, businessId) {
  const [research, compose] = await Promise.all([
    supabase.from('research_runs').select('cost_usd').eq('business_id', businessId).eq('status', 'done').not('cost_usd', 'is', null).order('created_at', { ascending: false }).limit(COST_SAMPLE).then(must),
    supabase.from('business_anthropic_usage').select('cost_usd').eq('business_id', businessId).eq('call_type', 'intent_compose').not('cost_usd', 'is', null).order('created_at', { ascending: false }).limit(COST_SAMPLE).then(must),
  ]);
  return { research_cost_usd: meanCost(research, RESEARCH_COST_MIN_RUNS), cost_estimate_usd: meanCost(compose, 1) };
}
export async function composeStatus(supabase, businessId, { now = Date.now() } = {}) {
  const [used, s, costs] = await Promise.all([composeUsedToday(supabase, businessId, now), settingsFor(supabase, businessId), observedCosts(supabase, businessId)]);
  return reply(200, { used, max: s.cap, ...costs, custom_prompt: s.custom_prompt, rules: s.rules });
}

export async function composeEmail(supabase, { businessId, userId, userName, type, id, now = Date.now(), call = callAnthropic }) {
  if (!BRIEF_TYPES.includes(type)) return reply(400, { error: `type must be one of ${BRIEF_TYPES.join('|')}` });
  try {
    const s = await settingsFor(supabase, businessId);
    const used = await composeUsedToday(supabase, businessId, now);
    if (used >= s.cap) return reply(429, { error: `Write email cap reached (${s.cap} per day for this workspace)`, used, max: s.cap });
    const b = await companyBrief(supabase, { businessId, type, id, now });
    if (b.status !== 200) return b;
    const brief = b.body;
    const signOff = firstName(userName);
    const data = await call({
      system: composeSystem({ prompt: s.prompt, rules: s.rules, signOff }),
      messages: [{ role: 'user', content: `${brief.markdown}\n\nWrite the first email to ${brief.company.name}.` }],
      max_tokens: COMPOSE_MAX_TOKENS, model: MODELS.STANDARD, thinking: false, timeoutMs: 60000,
      supabase, businessId, userId, callType: 'intent_compose',
    });
    if (data.stop_reason === 'max_tokens') return reply(502, { error: 'The draft was cut off - try again' });
    const text = (data.content || []).filter(x => x.type === 'text').map(x => x.text).join('');
    const draft = parseDraft(text);
    const lint = lintDraft({ subject: draft.subject, body: draft.body, claims: draft.claims, refs: brief.lines, rules: s.rules, signOff });
    const cost = estimateCostUsd(data.usage?.model || MODELS.STANDARD, data.usage) ?? null;
    return reply(200, { draft: { subject: draft.subject, body: draft.body, why: draft.why }, claims: draft.claims, lint, cost_usd: cost != null ? Math.round(cost * 1e4) / 1e4 : null, cap: { used: used + 1, max: s.cap }, brief: { company: brief.company, lines: brief.lines, upside_owned: brief.upside_owned, no_double_touch: brief.no_double_touch }, sign_off: signOff });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}

// POST goals/compose/lint { type?, id?, subject, body, claims? } - the same rules on a pasted or edited draft.
export async function lintPasted(supabase, { businessId, userName, type = null, id = null, body = {}, now = Date.now() }) {
  if (typeof body.body !== 'string' || typeof (body.subject ?? '') !== 'string') return reply(400, { error: 'subject and body must be text' });
  try {
    const s = await settingsFor(supabase, businessId);
    let refs = [];
    if (type && id) {
      if (!BRIEF_TYPES.includes(type)) return reply(400, { error: `type must be one of ${BRIEF_TYPES.join('|')}` });
      const b = await companyBrief(supabase, { businessId, type, id, now });
      if (b.status !== 200) return b;
      refs = b.body.lines;
    }
    const lint = lintDraft({ subject: body.subject || '', body: body.body, claims: Array.isArray(body.claims) ? body.claims : [], refs, rules: s.rules, signOff: firstName(userName) });
    return reply(200, { lint, refs: refs.length });
  } catch (e) { return reply(e.status || 500, { error: e.message }); }
}

export async function composeRoute(req, res) {
  send(res, await composeEmail(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, userName: req.auth.user.name, type: req.params.type, id: req.params.id }));
}
export async function composeLintRoute(req, res) {
  const { type = null, id = null, ...body } = req.body || {};
  send(res, await lintPasted(getSupabase(), { businessId: req.params.businessId, userName: req.auth.user.name, type, id, body }));
}
export async function composeStatusRoute(req, res) {
  try { send(res, await composeStatus(getSupabase(), req.params.businessId)); } catch (e) { res.status(500).json({ error: e.message }); }
}
