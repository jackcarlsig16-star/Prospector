// grow-inbox-intel-v1 REV3 B1 / B5 - the Briefing lane's one read and the brand page's reach line. 0 Claude calls,
// 0 Gmail calls: tiles from todayPayload + hk_touches / hk_replies, "Send these 10" (B3), "Waiting on them" (B6), the
// Signals panel (moved here from Today), and the research sweep's day. "Important now" (B2) is scored on the Needs-you
// rows the Inbox list already loads (inboxRoutes importance), never a second list call.
import { getSupabase, HkError, fail, me, brandById } from './hkShared.js';
import { primaryOf } from './rules.js';
import { researchEstimate } from './brandActions.js';
import { rankReach, reachOf, activityOf, intelFor, sheetSkipped, REACH_WORDS } from './intelScore.js';
import { loadIntel, firstNameOf } from './intelData.js';
import { sweepToday } from './researchSweep.js';
import { listSignalsRoute } from './signalsRoutes.js';
import { todayPayload } from './jobs/runner.js';
import { dayIn } from './jobs/plan.js';

const DAY = 864e5;
const SEND_N = 10, WAITING_N = 10;
const HOT_LABELS = new Set(['interested', 'pricing', 'referral']);
const CLOSED = new Set(['passed', 'skipped', 'sponsor', 'signed']);

// The research card line: "Chicago cycling studio · strong fit · idea: 30-day ride challenge".
export function researchLine(intel) {
  if (!intel?.intel) return null;
  const i = intel.intel, fit = i.fit?.sponsor_fit;
  return [i.company?.what_they_do || i.company?.category || null, fit ? `${fit.replace(/_/g, ' ')} fit` : null, i.fit?.challenge_idea ? `idea: ${i.fit.challenge_idea}` : null].filter(Boolean).join(' · ') || null;
}
// U4's expand: what they do, the idea, why it fits, industry (J6) and what the research cost.
const researchOf = intel => { const i = intel.intel || {}; return { line: researchLine(intel), fit: i.fit?.sponsor_fit || null, researched_at: intel.researched_at, what_they_do: i.company?.what_they_do || null, why: i.fit?.why || null, challenge_idea: i.fit?.challenge_idea || null, industry: i.company?.industry || null, hq_city: i.company?.hq_city || null, chicago_presence: i.company?.chicago_presence || null, cost_usd: intel.cost_usd ?? null }; };
const suggestionOf = b => (b.domain_suggested && !b.domain ? { domain: b.domain_suggested, confidence: b.domain_confidence || 'low', at: b.domain_suggested_at } : null);
// Send-these-10 rows are reachOf-eligible, so can_contact is already clear (verdictOk) and the brand is yours or nobody's.
export const cardOf = (r, data, meId) => {
  const intel = intelFor(r.brand, data.intelByDomain), b = r.brand;
  const primary = primaryOf({ brand: b, meId, replies: data.repliesBy[b.id] || [], touches: data.touchesBy[b.id] || [], researched: !!intel, hasEmail: (data.contactsBy[b.id] || []).some(c => c.has_email), verdictOk: true });
  return { id: b.id, name: b.name, domain: b.domain || null, category: b.category || null, city: b.city || null, status: b.status, owner_user_id: b.owner_user_id || null, owner_hint: b.owner_hint || null, heat_band: b.heat_band || 'cold', targeted_at: b.targeted_at || null,
    score: r.score, why: r.why, parts: r.parts.map(([k]) => k), score_parts: r.parts.map(([key, points]) => ({ key, words: REACH_WORDS[key], points })), primary, snoozed_until: b.snoozed_until || null, research: intel ? researchOf(intel) : null,
    suggestion: suggestionOf(b), research_attempted_at: b.research_attempted_at || null, command: `hk pitch ${b.domain || b.name}` };
};

const ownerIdOf = (req, data) => { const o = req.query?.owner; if (!o || o === 'me' || o === 'all') return me(req); if (!data.members.some(m => m.user_id === o)) throw new HkError(400, 'unknown owner'); return String(o); };
const ownerMatch = (owner, b, meId) => owner === 'all' || (owner === 'me' || !owner ? b.owner_user_id === meId : b.owner_user_id === owner);
const asRes = () => { const out = { code: 200, body: null }; const r = { status(c) { out.code = c; return r; }, json(b) { out.body = b; return r; } }; return [r, out]; };

// GET /briefing?owner=me|all|<user id>
export async function briefingRoute(req, res, { supabase = getSupabase(), now = () => new Date(), today = todayPayload } = {}) {
  const businessId = req.params.businessId;
  try {
    const at = now(), data = await loadIntel(supabase, businessId, at), owner = req.query?.owner || 'me';
    const meId = ownerIdOf(req, data);
    const send = rankReach(data.brands, { ...data, meId, now: at }, { meFirstName: firstNameOf(data, meId), limit: SEND_N }).map(r => cardOf(r, data, meId));
    const max = data.settingsRow.max_email_touches || 3;
    const waiting = data.brands.filter(b => ownerMatch(owner, b, me(req)) && !CLOSED.has(b.status))
      .map(b => ({ b, a: activityOf(data.touchesBy[b.id] || [], data.repliesBy[b.id] || [], { now: at, maxEmailTouches: max }) }))
      .filter(x => x.a.waiting_days != null).sort((x, y) => y.a.waiting_days - x.a.waiting_days).slice(0, WAITING_N)
      .map(({ b, a }) => ({ id: b.id, name: b.name, owner_user_id: b.owner_user_id || null, waiting_days: a.waiting_days, last_outbound: a.last_outbound, touches_used: a.touches_used, max_email_touches: max, next_due_at: b.next_due_at || null, heat_band: b.heat_band || 'cold' }));
    const t = await today({ businessId, d: { supabase, now } });
    const counts = t.digest?.counts || {};
    const ownedHere = new Set(data.brands.filter(b => ownerMatch(owner, b, me(req)) || !b.owner_user_id).map(b => b.id));
    const weekAgo = at.getTime() - 7 * DAY;
    const sentWeek = data.touches.filter(x => x.channel === 'email' && x.state === 'sent' && x.sent_at && Date.parse(x.sent_at) >= weekAgo && ownedHere.has(x.brand_id)).length;
    const repliesWeek = data.replies.filter(r => r.received_at && Date.parse(r.received_at) >= weekAgo && ownedHere.has(r.brand_id) && r.label !== 'auto_reply').length;
    const day = dayIn(at, data.settingsRow.timezone || 'America/Chicago'), sweep = await sweepToday(supabase, businessId, day);
    const tiles = {
      replies_waiting: (counts.urgent || 0) + (counts.replies || 0),
      hot: data.replies.filter(r => !r.handled && HOT_LABELS.has(r.label) && ownedHere.has(r.brand_id)).length,
      drafts: counts.drafts || 0,
      followups_due: data.brands.filter(b => b.next_due_at && Date.parse(b.next_due_at) <= at.getTime() && !CLOSED.has(b.status) && ownerMatch(owner, b, me(req))).length,
      dms_due: counts.dm_ready || 0,
      sent_week: sentWeek,
      reply_rate_week: sentWeek >= 5 ? Math.round((repliesWeek / sentWeek) * 100) : null,
      researched_today: { n: sweep.calls, cap: data.settings.sweep.n },
    };
    const [r, out] = asRes();
    await listSignalsRoute(req, r, { supabase });
    res.json({ owner, tiles, send, waiting, signals: out.code === 200 ? out.body : null, eligible: rankReach(data.brands, { ...data, meId, now: at }, { meFirstName: firstNameOf(data, meId), limit: null }).length,
      sheet_skipped: sheetSkipped(data.brands, { ...data, meId }), research_estimate: await researchEstimate(supabase, businessId),
      research: { on: data.settings.sweep.on, n: data.settings.sweep.n, cap_usd: data.settings.sweep.cap_usd, time: data.settings.sweep.time, today_calls: sweep.calls, today_spend: sweep.spend, last_run: sweep.last }, weights: data.settings.weights, target_categories: data.settings.target_categories });
  } catch (e) { fail(res, e, 'briefing'); }
}

// GET /brands/:id/reach - B5's "Reach-out score n · why", the brand's activity (B6), research + website suggestion.
export async function reachRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId;
  try {
    const at = now();
    const brand = await brandById(supabase, businessId, req.params.id);
    const data = await loadIntel(supabase, businessId, at);
    const live = data.brands.find(b => b.id === brand.id) || brand;
    const r = reachOf(live, { ...data, meId: me(req), now: at });
    const intel = intelFor(live, data.intelByDomain);
    res.json({ eligible: !!r, score: r ? r.score : null, why: r ? r.why : [], parts: r ? r.parts.map(([k]) => k) : [],
      activity: activityOf(data.touchesBy[brand.id] || [], data.repliesBy[brand.id] || [], { now: at, maxEmailTouches: data.settingsRow.max_email_touches || 3 }),
      research: intel ? { line: researchLine(intel), fit: intel.intel?.fit?.sponsor_fit || null, researched_at: intel.researched_at, domain: intel.domain } : null,
      suggestion: suggestionOf(live), research_attempted_at: live.research_attempted_at || null });
  } catch (e) { fail(res, e, 'brands/reach'); }
}
