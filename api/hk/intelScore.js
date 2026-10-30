// grow-inbox-intel-v1 REV3 - the pure scorers behind Briefing: B3 "Send these 10" (eligibility through can_contact,
// components, tie-breaks), B3a target categories, B2 importance for Needs-you rows, B6 per-brand email activity. No
// Claude, no Gmail, no writes. Weights / categories / sweep controls default here and are overridden by
// hk_settings.intel (merged, never replaced).
import { canContact, sheetOwnerOf, hintName } from './rules.js';

const DAY = 864e5;
export const INTEL_DEFAULTS = {
  weights: {
    // B3 (REVISABLE)
    draftable: 15, idea: 10, website: 10, researched: 5, local: 20, category: 20, fit_strong: 20, fit_possible: 10,
    heat_hot: 15, heat_warm: 8, targeted: 10, mine_untouched: 10, niche_overlap: -15, size_large: -5,
    // B2 (REVISABLE)
    b2_hot_label: 40, b2_question: 20, b2_decline: -20, b2_status: 25, b2_sponsor: 20, b2_fit_strong: 20, b2_fit_possible: 10,
    b2_heat_hot: 25, b2_heat_warm: 15, b2_warm: 10, b2_unread: 10, b2_wait_per_day: 2, b2_wait_cap: 15, b2_new_person: 5, b2_teammate: 5,
  },
  target_categories: ['National CPG', 'Wellness', 'gym/studio', 'cafe/restaurant', 'consumer brand'],
  sweep: { on: true, n: 10, cap_usd: 1.0, time: '06:30' },
  retry_days: 30,
};

export function intelSettings(intel) {
  const v = intel && typeof intel === 'object' ? intel : {};
  return {
    weights: { ...INTEL_DEFAULTS.weights, ...(v.weights || {}) },
    target_categories: Array.isArray(v.target_categories) ? v.target_categories : INTEL_DEFAULTS.target_categories,
    sweep: { ...INTEL_DEFAULTS.sweep, ...(v.sweep || {}) },
    retry_days: Number(v.retry_days) || INTEL_DEFAULTS.retry_days,
  };
}

// B3a - case-insensitive against hk_brands.category. "Chicago" is local, not a category (B3).
export const inTargetCategory = (brand, cats) => !!brand.category && cats.some(c => String(c).trim().toLowerCase() === String(brand.category).trim().toLowerCase());
export const isLocal = brand => brand.is_local === true || String(brand.category || '').trim().toLowerCase() === 'chicago';

const sentEmails = ts => ts.filter(t => t.channel === 'email' && t.state === 'sent');
// Who has talked to this brand (as warm.trackedThreads, from rows already in memory): sent touches + logged replies.
export function threadsOf(touches, replies) {
  const by = {}, sender = Object.fromEntries(touches.map(t => [t.id, t.sender_user_id]));
  for (const t of touches) if (t.state === 'sent') { const at = t.sent_at || t.drafted_at; if (!by[t.sender_user_id] || String(at) > String(by[t.sender_user_id])) by[t.sender_user_id] = at; }
  for (const r of replies) { const who = sender[r.touch_id] || 'unknown'; if (!by[who] || String(r.received_at) > String(by[who])) by[who] = r.received_at; }
  return Object.entries(by).map(([founder_user_id, last_at]) => ({ founder_user_id, last_at }));
}

// The intel row for a brand: its domain's, else its suggested domain's.
export const intelFor = (brand, intelByDomain) => (brand.domain && intelByDomain[brand.domain]) || (brand.domain_suggested && intelByDomain[brand.domain_suggested]) || null;

const mineUntouched = (brand, touches, ctx) => {
  const at = ctx.claimedAt?.[brand.id];
  if (brand.owner_user_id !== ctx.meId || brand.status !== 'claimed' || !at || ctx.now.getTime() - Date.parse(at) <= 7 * DAY) return false;
  return !sentEmails(touches).some(t => String(t.sent_at || '') >= String(at));
};

// meFirstName: the caller's first name (rankReach passes it; else read from ctx.members).
// ctx: { meId, meFirstName?, members?, claimedAt (brand id -> latest brand.claimed time), touchesBy, repliesBy, contactsBy (brand_id -> [{ has_email }]), intelByDomain, sponsorsNiches, settings, now }
// -> null when not eligible, else { brand, score, parts: [[key, points]], why: [words], verdict }
export function reachOf(brand, ctx) {
  const { meId, settings } = ctx, W = settings.weights;
  if (brand.archived_at || brand.relationship !== 'prospect' || !['candidate', 'claimed'].includes(brand.status)) return null;
  if (brand.owner_user_id && brand.owner_user_id !== meId) return null;
  if (sheetOwnerOf(brand, myFirstName(ctx))) return null;
  if (brand.snoozed_until && Date.parse(brand.snoozed_until) > ctx.now.getTime()) return null;
  const touches = ctx.touchesBy[brand.id] || [], replies = ctx.repliesBy[brand.id] || [];
  if (sentEmails(touches).length >= 3) return null;
  const verdict = canContact({ brand, touches, threadsByFounder: threadsOf(touches, replies), senderUserId: meId, kind: 'cold', sponsorsNiches: ctx.sponsorsNiches });
  if (!verdict.ok) return null;
  const intel = intelFor(brand, ctx.intelByDomain), fit = intel?.intel?.fit?.sponsor_fit || null;
  if (fit === 'not_a_fit') return null;
  const contacts = ctx.contactsBy[brand.id] || [];
  const hit = {
    draftable: contacts.some(c => c.has_email), idea: !!(brand.challenge_idea && String(brand.challenge_idea).trim()), website: !!brand.domain, researched: !!intel,
    local: isLocal(brand), category: inTargetCategory(brand, settings.target_categories), fit_strong: fit === 'strong', fit_possible: fit === 'possible',
    heat_hot: brand.heat_band === 'hot', heat_warm: brand.heat_band === 'warm', targeted: !!brand.targeted_at,
    // Claimed by you > 7 days ago (the latest brand.claimed event - never updated_at, which any edit moves) and no
    // email sent since that claim.
    mine_untouched: mineUntouched(brand, touches, ctx),
    niche_overlap: verdict.warnings.some(w => w.code === 'niche_overlap'), size_large: /large|enterprise/i.test(brand.size_band || ''),
  };
  const parts = Object.keys(hit).filter(k => hit[k]).map(k => [k, W[k] || 0]);
  const score = parts.reduce((n, [, p]) => n + p, 0);
  const why = parts.filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => REACH_WORDS[k]);
  return { brand, score, parts, why, has_contact: contacts.length > 0, intel };
}
export const myFirstName = ctx => (ctx.meFirstName !== undefined ? ctx.meFirstName : ctx.members?.find(m => m.user_id === ctx.meId)?.first_name || null);
// grow-sheet-owner-respect F2 - brands left out of your list because the sheet lists them as someone else's, per name.
export const sheetSkipped = (brands, ctx) => {
  const by = {};
  for (const b of brands) { const h = !b.archived_at && b.relationship === 'prospect' ? sheetOwnerOf(b, myFirstName(ctx)) : null; if (h) by[h.toLowerCase()] = (by[h.toLowerCase()] || 0) + 1; }
  return Object.entries(by).map(([hint, n]) => ({ hint: hintName(hint), n })).sort((a, b) => b.n - a.n);
};
export const REACH_WORDS = { draftable: 'has a contact to email', idea: 'has a challenge idea', website: 'has a website', researched: 'researched', local: 'Chicago local', category: 'a target category', fit_strong: 'strong fit', fit_possible: 'possible fit', heat_hot: 'Hot right now', heat_warm: 'Warm right now', targeted: 'on your Targets', mine_untouched: 'claimed by you, untouched 7+ days', niche_overlap: 'niche overlaps a sponsor', size_large: 'large company' };

// B3 ties: the sheet owner hint is the caller's first name (from business_members) -> challenge idea -> any contact -> A-Z.
export function rankReach(brands, ctx, { meFirstName = null, limit = 10 } = {}) {
  const me = String(meFirstName || '').trim().toLowerCase();
  const hint = r => (me && String(r.brand.owner_hint || '').trim().toLowerCase() === me ? 1 : 0);
  const withName = meFirstName != null ? { ...ctx, meFirstName } : ctx;
  return brands.map(b => reachOf(b, withName)).filter(Boolean)
    .sort((a, b) => b.score - a.score || hint(b) - hint(a) || Number(!!b.brand.challenge_idea) - Number(!!a.brand.challenge_idea) || Number(b.has_contact) - Number(a.has_contact) || String(a.brand.name).localeCompare(String(b.brand.name)))
    .slice(0, limit ?? undefined);
}

const HOT_LABELS = new Set(['interested', 'pricing', 'referral']);
// B2 - one Needs-you row (inbox list shape). ctx: { byId (brand rows), warmBrands (Set of brand ids with history), settings, now }
export function importanceOf(row, ctx) {
  const W = ctx.settings.weights, chip = row.chip || {}, brand = chip.brand_id ? ctx.byId[chip.brand_id] : null;
  const parts = [];
  const add = (k, p, on) => { if (on && p) parts.push([k, p]); };
  add('hot_label', W.b2_hot_label, HOT_LABELS.has(chip.label));
  add('question', W.b2_question, !row.latest_from_us && /\?/.test(row.snippet || ''));
  add('decline', W.b2_decline, chip.label === 'decline');
  add('status', W.b2_status, ['replied', 'meeting'].includes(brand?.status));
  add('sponsor', W.b2_sponsor, ['sponsor', 'founding_partner'].includes(brand?.relationship));
  add('fit_strong', W.b2_fit_strong, row.intel_fit === 'strong');
  add('fit_possible', W.b2_fit_possible, row.intel_fit === 'possible');
  add('heat_hot', W.b2_heat_hot, brand?.heat_band === 'hot');
  add('heat_warm', W.b2_heat_warm, brand?.heat_band === 'warm');
  add('warm', W.b2_warm, !!brand && ctx.warmBrands.has(brand.id));
  add('unread', W.b2_unread, !!row.unread);
  const days = row.date ? Math.floor((ctx.now.getTime() - Date.parse(row.date)) / DAY) : 0;
  add('waiting', Math.min(W.b2_wait_cap, Math.max(0, days) * W.b2_wait_per_day), row.lane === 'needs_you' && !row.latest_from_us && days > 0);
  add('new_person', W.b2_new_person, chip.kind === 'untracked');
  add('teammate', W.b2_teammate, chip.kind === 'team');
  const score = parts.reduce((n, [, p]) => n + p, 0);
  const top = parts.filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1])[0];
  return { score, why: top ? IMPORTANCE_WORDS[top[0]](chip, days) : null, parts: parts.map(([k]) => k) };
}
const LABEL_WORDS = { interested: 'interested', pricing: 'pricing question', referral: 'referral' };
export const IMPORTANCE_WORDS = {
  hot_label: c => `Replied: ${LABEL_WORDS[c.label]}`, question: () => 'Asks a question', decline: () => 'Declined', status: () => 'Brand in conversation',
  sponsor: () => 'A sponsor', fit_strong: () => 'Strong fit', fit_possible: () => 'Possible fit', heat_hot: () => 'Hot brand', heat_warm: () => 'Warm brand',
  warm: () => 'We have talked before', unread: () => 'Unread', waiting: (c, d) => `Waiting ${d} d`, new_person: () => 'New person', teammate: () => 'From your team',
};

// B6 - one brand's email activity from hk_touches + hk_replies (0 Gmail calls).
export function activityOf(touches, replies, { now = new Date(), maxEmailTouches = 3 } = {}) {
  const sent = sentEmails(touches).concat(touches.filter(t => t.channel !== 'email' && t.state === 'sent')).sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)));
  const inbound = [...replies].sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
  const lastOut = sent[0] || null, lastIn = inbound[0] || null;
  const threads = new Set([...touches.map(t => t.gmail_thread_id), ...replies.map(r => r.gmail_thread_id)].filter(Boolean));
  const waiting = lastOut && (!lastIn || String(lastIn.received_at) < String(lastOut.sent_at)) ? Math.floor((now.getTime() - Date.parse(lastOut.sent_at)) / DAY) : null;
  return {
    last_inbound: lastIn ? { at: lastIn.received_at, label: lastIn.label || null } : null,
    last_outbound: lastOut ? { at: lastOut.sent_at, kind: lastOut.kind || null, channel: lastOut.channel } : null,
    thread_count: threads.size, touches_used: sentEmails(touches).length, max_email_touches: maxEmailTouches,
    waiting_days: waiting, open_reply: !!lastIn && !lastIn.handled,
  };
}
