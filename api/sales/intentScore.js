import { normName } from './intakeMatch.js';

// intent-score-v1 S1 / S6 - one 0-100 intent score per company record from inputs the gatherer (Stage 2) assembles;
// nothing here reads or writes a table, so HumanKind can call scoreCompany with its own inputs + weights row.
// DEFAULT_WEIGHTS is the planner's CONFIRMED table (Oct 27, after Stage 0's calibration) and the seed of
// sales_settings.score_weights; a later retune is a settings change, never a code change.
//
// inputs (every field optional; a missing input scores 0 for its component, never NaN):
//   type 'partner' | 'employer' | 'target', id, name, stage (pipeline_status / stage / status), owner_team, employees,
//   category, last_touch_at, on_skip_list, duplicate_of (set by dedupeCompanies),
//   source: { kind, via_upside, named, campaign_replied }   named = Brad named / flagged the company (not the bulk list)
//   visit:  the latest web_visits row { visits_7d, unique_visitors_7d, top_paths: [{ path }], maybe_user, us_500,
//           apollo_intent, intent_score, last_visit | pulled_on } or null
//   people: [{ title, is_buyer }]   is_buyer resolved by the gatherer against sales_settings.buyer_titles
//   research: { created_at, result: { why_homelover, first_angle, titles, housing_perk, watch_outs } } or null
//   heat:   { replied, clicks, opens } (the company's hottest prospect) or null
//   override: visit_priority_override row { priority 1-4 | null, not_a_fit, set_at } or null
export const DEFAULT_WEIGHTS = {
  version: 1,
  thresholds: { P1: 60, P2: 40, P3: 15 },
  closed_ceiling: 10,
  override_days: 30,
  caps: { visits: 25, pages: 10, apollo_intent: 5, people: 15, fit: 15, research: 10, source: 12, engagement: 10, stage: 10, recency: 10 },
  visits: { visits_pts: 17, visits_full_at: 20, uniques_pts: 8, uniques_full_at: 5, decay_days: 14 },
  pages: { hot: 10, other: 5, home: 2 },
  apollo_intent: { high: 5, medium: 3, low: 1, score_divisor: 20 },
  people: { buyer: 6, other: 2 },
  fit: { us_500: 15, mid: 8, small: 0, unknown: 4, partner_category: 10, partner: 5 },
  research: { why_homelover: 4, first_angle: 3, titles: 3, housing_perk: -10, watch_outs: -5, unresearched: -3, fresh_days: 60 },
  source: { upside_list: 6, upside_named: 12, partner_referral: 12, person_referral: 10, inbound: 12, campaign_reply: 10, campaign_sent: 4, website: 6, homelover_outreach: 3, scout: 4, event: 4, unknown: 0 },
  engagement: { replied: 10, clicked: 6, opened: 3 },
  stage: { contacted: 2, first_email_sent: 2, in_sequence: 2, responded: 4, replied: 4, meeting: 8, meeting_set: 8 },
  stages: { closed_won: ['launched', 'live', 'contract', 'verbal'], pilot: ['proposal_pilot'], closed: ['lost', 'paused', 'rejected', 'on_hold'] },
  recency: { ok_days: 30, mid_days: 60, mid: -5, far: -10 },
};
export const COMPONENTS = ['visits', 'pages', 'apollo_intent', 'people', 'fit', 'research', 'source', 'engagement', 'stage', 'recency'];
// Legend / toggle order (S3, FIXED). source_label of a scored row is one of these.
export const SOURCE_ORDER = ['upside', 'partner_referral', 'person_referral', 'campaign', 'website', 'inbound', 'homelover_outreach', 'scout', 'other'];
export const UPSIDE_TEAMS = ['upside', 'both'];

const DAY = 864e5;
const PAGE_HOT = /\/(pricing|employer|partner|product|benefits|for-)/i;
const PAGE_USER = /^\/(auth|help|privacy|terms)(\/|$)/i;
const NO_PERK = /no housing perk found/i;
const WATCH_OUT = /acqui|wrong audience|not .*audience|sells to (consumers|individuals)/i;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const lg = (n, full) => Math.log(1 + Math.max(0, Number(n) || 0)) / Math.log(1 + full);
const daysSince = (iso, now) => { const t = iso ? Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso) : NaN; return Number.isFinite(t) ? (now - t) / DAY : Infinity; };
const n0 = x => (Number.isFinite(Number(x)) ? Number(x) : 0);

export function bandFor(score, thresholds = DEFAULT_WEIGHTS.thresholds) {
  return score >= thresholds.P1 ? 'P1' : score >= thresholds.P2 ? 'P2' : score >= thresholds.P3 ? 'P3' : 'P4';
}
export function bandRange(band, thresholds = DEFAULT_WEIGHTS.thresholds) {
  return { P1: [thresholds.P1, 100], P2: [thresholds.P2, thresholds.P1 - 1], P3: [thresholds.P3, thresholds.P2 - 1], P4: [0, thresholds.P3 - 1] }[band];
}

// Today's score against the last snapshot for the ▲ / ▼ marker. null = no earlier snapshot.
export function trendOf(score, previous) {
  if (previous == null) return null;
  return score > previous ? 'up' : score < previous ? 'down' : 'flat';
}

function visitsPts(v, w, age) {
  if (!v || age > w.visits.decay_days) return { points: 0, inputs: { visits_7d: n0(v?.visits_7d), unique_visitors_7d: n0(v?.unique_visitors_7d), age_days: Number.isFinite(age) ? Math.round(age) : null, decayed: !!v } };
  const pts = w.visits.visits_pts * lg(v.visits_7d, w.visits.visits_full_at) + w.visits.uniques_pts * lg(v.unique_visitors_7d, w.visits.uniques_full_at);
  return { points: clamp(Math.round(pts), 0, w.caps.visits), inputs: { visits_7d: n0(v.visits_7d), unique_visitors_7d: n0(v.unique_visitors_7d), age_days: Math.round(age), decayed: false } };
}
function pagesPts(v, w) {
  const paths = (Array.isArray(v?.top_paths) ? v.top_paths : []).map(p => (typeof p === 'string' ? p : p?.path)).filter(Boolean);
  const userOnly = paths.length > 0 && paths.every(p => PAGE_USER.test(p));
  const points = !v || v.maybe_user || userOnly || !paths.length ? 0 : paths.some(p => PAGE_HOT.test(p)) ? w.pages.hot : paths.some(p => p !== '/') ? w.pages.other : w.pages.home;
  return { points: clamp(points, 0, w.caps.pages), inputs: { paths: paths.slice(0, 3), maybe_user: !!v?.maybe_user || userOnly } };
}
function intentPts(v, w) {
  if (!v) return { points: 0, inputs: { intent: null, intent_score: null } };
  const label = String(v.apollo_intent || '').toLowerCase();
  const points = v.intent_score != null && Number.isFinite(Number(v.intent_score)) ? Math.round(Number(v.intent_score) / w.apollo_intent.score_divisor) : w.apollo_intent[label] || 0;
  return { points: clamp(points, 0, w.caps.apollo_intent), inputs: { intent: v.apollo_intent || null, intent_score: v.intent_score ?? null } };
}
function peoplePts(people, w) {
  const list = Array.isArray(people) ? people : [];
  const buyers = list.filter(p => p?.is_buyer);
  const points = buyers.length * w.people.buyer + (list.length - buyers.length) * w.people.other;
  return { points: clamp(points, 0, w.caps.people), inputs: { people: list.length, buyers: buyers.length, titles: buyers.map(p => p.title).filter(Boolean).slice(0, 3) } };
}
function fitPts(c, v, w) {
  const emp = Number.isFinite(Number(c.employees)) && c.employees != null ? Number(c.employees) : null;
  let points, why;
  if (c.on_skip_list) { points = 0; why = 'skip list'; }
  else if (v?.us_500 || (emp != null && emp >= 500)) { points = w.fit.us_500; why = 'US 500+'; }
  else if (emp != null && emp >= 200) { points = w.fit.mid; why = '200-499'; }
  else if (emp != null) { points = w.fit.small; why = 'under 200'; }
  else if (c.type === 'partner') { points = c.category ? w.fit.partner_category : w.fit.partner; why = c.category ? `partner · ${c.category}` : 'partner'; }
  else { points = w.fit.unknown; why = 'headcount unknown'; }
  return { points: clamp(points, 0, w.caps.fit), inputs: { employees: emp, us_500: !!v?.us_500, why } };
}
function researchPts(r, w, now) {
  const age = daysSince(r?.created_at, now);
  if (!r || age > w.research.fresh_days) return { points: w.research.unresearched, inputs: { researched: !!r, decayed: !!r, age_days: Number.isFinite(age) ? Math.round(age) : null } };
  const x = r.result || {};
  const perk = !!x.housing_perk && !NO_PERK.test(String(x.housing_perk));
  const watch = WATCH_OUT.test(String(x.watch_outs || ''));
  const pts = (x.why_homelover ? w.research.why_homelover : 0) + (x.first_angle ? w.research.first_angle : 0) + (x.titles ? w.research.titles : 0) + (perk ? w.research.housing_perk : 0) + (watch ? w.research.watch_outs : 0);
  return { points: clamp(pts, -w.caps.research, w.caps.research), inputs: { researched: true, decayed: false, age_days: Math.round(age), competing_perk: perk, watch_out: watch } };
}
function sourcePts(c, heat, w) {
  const s = c.source || {};
  const kind = s.kind || 'unknown';
  const viaUpside = kind === 'partner_referral' && (!!s.via_upside || UPSIDE_TEAMS.includes(c.owner_team || ''));
  const replied = !!(s.campaign_replied || heat?.replied);
  const points = viaUpside ? (s.named ? w.source.upside_named : w.source.upside_list)
    : kind === 'campaign' ? (replied ? w.source.campaign_reply : w.source.campaign_sent)
    : w.source[kind] || 0;
  const label = viaUpside ? 'upside' : SOURCE_ORDER.includes(kind) ? kind : 'other';
  return { points: clamp(points, 0, w.caps.source), inputs: { kind, label, via_upside: viaUpside, named: viaUpside && !!s.named, campaign_replied: kind === 'campaign' && replied } };
}
function engagementPts(heat, w) {
  if (!heat) return { points: 0, inputs: { replied: false, clicks: 0, opens: 0 } };
  const points = heat.replied ? w.engagement.replied : n0(heat.clicks) > 0 ? w.engagement.clicked : n0(heat.opens) > 0 ? w.engagement.opened : 0;
  return { points: clamp(points, 0, w.caps.engagement), inputs: { replied: !!heat.replied, clicks: n0(heat.clicks), opens: n0(heat.opens) } };
}
function recencyPts(c, visitAge, w, now) {
  const last = Math.min(daysSince(c.last_touch_at, now), visitAge);
  const points = last <= w.recency.ok_days ? 0 : last <= w.recency.mid_days ? w.recency.mid : w.recency.far;
  return { points: clamp(points, -w.caps.recency, 0), inputs: { days_since_touch: Number.isFinite(last) ? Math.round(last) : null } };
}

export function scoreCompany(inputs, weights = DEFAULT_WEIGHTS, { now = Date.now() } = {}) {
  const c = inputs || {};
  const w = weights || DEFAULT_WEIGHTS;
  const v = c.visit || null;
  const visitAge = daysSince(v?.last_visit || v?.pulled_on, now);
  const stage = c.stage || null;
  const closedWon = w.stages.closed_won.includes(stage), pilot = w.stages.pilot.includes(stage), lost = w.stages.closed.includes(stage);
  const notAFit = !!c.override?.not_a_fit;
  const components = {
    visits: visitsPts(v, w, visitAge),
    pages: pagesPts(v, w),
    apollo_intent: intentPts(v, w),
    people: peoplePts(c.people, w),
    fit: fitPts(c, v, w),
    research: researchPts(c.research, w, now),
    source: sourcePts(c, c.heat, w),
    engagement: engagementPts(c.heat, w),
    stage: { points: lost ? 0 : clamp(w.stage[stage] || 0, 0, w.caps.stage), inputs: { stage } },
    recency: recencyPts(c, visitAge, w, now),
  };
  let score = clamp(Math.round(COMPONENTS.reduce((sum, k) => sum + components[k].points, 0)), 0, 100);
  const closed = lost || notAFit;
  if (closed) score = Math.min(score, w.closed_ceiling);
  let override = null;
  const handSet = c.override?.priority;
  if (!notAFit && handSet >= 1 && handSet <= 4) {
    const setAt = Date.parse(c.override.set_at || '');
    const expiresAt = Number.isFinite(setAt) ? setAt + w.override_days * DAY : NaN;
    if (Number.isFinite(expiresAt) && now < expiresAt) {
      const [lo, hi] = bandRange(`P${handSet}`, w.thresholds);
      override = { priority: handSet, expires_at: new Date(expiresAt).toISOString(), scored: score };
      score = clamp(score, lo, hi);
    }
  }
  return {
    score, band: bandFor(score, w.thresholds), components,
    closed, closed_reason: notAFit ? 'not_a_fit' : lost ? stage : null,
    flagged_out: closedWon || pilot, flag_reason: closedWon ? 'closed_won' : pilot ? 'pilot' : null,
    override, upside_owned: UPSIDE_TEAMS.includes(c.owner_team || ''),
    source_kind: components.source.inputs.kind, source_label: components.source.inputs.label,
    duplicate_of: c.duplicate_of || null,
  };
}

// An employer and a target with the same normalized name: score the employer, mark the target duplicate_of it
// (planner, Oct 27). Partners never pair. Returns the same rows with duplicate_of set; order unchanged.
export function dedupeCompanies(rows) {
  const employers = new Map();
  for (const r of rows) if (r.type === 'employer' && r.name) employers.set(normName(r.name), r);
  return rows.map(r => {
    if (r.type !== 'target' || !r.name) return r;
    const e = employers.get(normName(r.name));
    return e ? { ...r, duplicate_of: `employer:${e.id}` } : r;
  });
}

// S4 - one line per non-zero component, biggest first: "+12 Brad referral", "+14 visits (6 in 7 d, 3 people)".
export function breakdownLines(scored) {
  const { components: cp } = scored;
  const text = {
    visits: i => `visits (${i.visits_7d} in 7 d, ${i.unique_visitors_7d} people${i.decayed ? ', decayed' : ''})`,
    pages: i => `pages (${i.paths.join(', ') || (i.maybe_user ? 'user pages only' : 'none')})`,
    apollo_intent: i => `Apollo intent${i.intent ? ` ${i.intent}` : ''}`,
    people: i => `people (${i.titles.join(', ') || `${i.people} identified`})`,
    fit: i => `fit (${i.why})`,
    research: i => (i.researched && !i.decayed ? `research${i.competing_perk ? ' (competing housing perk)' : ''}${i.watch_out ? ' (watch-out)' : ''}` : i.researched ? 'research decayed (> 60 d)' : 'not researched'),
    source: i => (i.via_upside ? (i.named ? 'Brad referral (named)' : 'Upside list') : i.kind === 'campaign' ? (i.campaign_replied ? 'campaign reply' : 'campaign sent') : i.kind.replace(/_/g, ' ')),
    engagement: i => (i.replied ? 'replied' : i.clicks ? 'clicked' : 'opened'),
    stage: i => `stage ${String(i.stage).replace(/_/g, ' ')}`,
    recency: i => `no touch in ${i.days_since_touch == null ? '60+' : i.days_since_touch} d`,
  };
  return COMPONENTS.filter(k => cp[k].points !== 0).sort((a, b) => Math.abs(cp[b].points) - Math.abs(cp[a].points))
    .map(k => `${cp[k].points > 0 ? '+' : ''}${cp[k].points} ${text[k](cp[k].inputs)}`);
}
