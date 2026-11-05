import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { DEFAULT_WEIGHTS } from './intentScore.js';
import { fitSettings, effectiveFit } from './fitLevel.js';
import { FIT_AXIS_IDS, US_FOOTPRINT_WORD } from '../../src/constants/fitLevels.js';

// homelover-flow-v1 F3 - "Fit at a glance": six axes, each 0-100, computed from the score components the recompute
// already stores (sales_company_scores.components, ruling F-a) plus the record's US footprint. No new Claude or
// Apollo call. An axis with no data is null (the panel draws "—" at the centre with a dotted spoke, never a fake 0):
// Industry without fresh research, Size without a headcount, US footprint until research or a person says.
// Fit score = the weighted mean of the axes that have data (weights REVISABLE in sales_settings.fit_settings).
export const US_FOOTPRINT_VALUE = { mostly_us: 100, mixed: 50, mostly_outside_us: 10 };
const pct = (points, cap) => (cap > 0 ? Math.round(Math.max(0, Math.min(1, points / cap)) * 100) : 0);
const SOURCE_WHY = { upside: 'Upside referral', partner_referral: 'partner referral', person_referral: 'person referral', campaign: 'campaign', website: 'website visit', inbound: 'inbound', homelover_outreach: 'our outreach', scout: 'Scout', event: 'event', other: 'no known path' };

// components: the stored { visits, pages, apollo_intent, people, fit, research, source } ({ points, inputs } each);
// caps: weights.caps; usFootprint: the record column or the research value or null.
export function axesFrom({ components = {}, caps = DEFAULT_WEIGHTS.caps, usFootprint = null } = {}) {
  const c = k => components[k] || { points: 0, inputs: {} };
  const visits = c('visits'), pages = c('pages'), apollo = c('apollo_intent'), people = c('people'), fit = c('fit'), research = c('research'), source = c('source');
  const intentCap = caps.visits + caps.pages + caps.apollo_intent;
  const vi = visits.inputs || {}, pi = pages.inputs || {}, ai = apollo.inputs || {};
  const intentWhy = [`${vi.visits_7d ?? 0} visits · ${vi.unique_visitors_7d ?? 0} people in 7 d${vi.decayed ? ' (older)' : ''}`, pi.paths?.length ? pi.paths.slice(0, 2).join(', ') : null, ai.intent ? `Apollo intent ${ai.intent}` : null].filter(Boolean).join(' · ');
  const ri = research.inputs || {};
  const industry = ri.researched && !ri.decayed
    ? { value: pct(research.points + caps.research, 2 * caps.research), why: [`research: ${research.points > 0 ? 'why HomeLover fits' : 'weak fit'}`, ri.competing_perk ? 'competing housing perk' : 'no perk found', ri.watch_out ? 'watch-out' : null].filter(Boolean).join(' · ') }
    : { value: null, why: ri.researched ? 'research older than 60 d - refresh' : 'not researched yet' };
  const fi = fit.inputs || {};
  const size = fi.employees != null || fi.us_500
    ? { value: pct(fit.points, caps.fit), why: `${fi.employees != null ? `${fi.employees.toLocaleString('en-US')} employees` : 'US 500+'} (${fi.why})` }
    : { value: null, why: 'headcount unknown' };
  const us = usFootprint && US_FOOTPRINT_VALUE[usFootprint] != null
    ? { value: US_FOOTPRINT_VALUE[usFootprint], why: US_FOOTPRINT_WORD[usFootprint] }
    : { value: null, why: 'US footprint not in research yet' };
  const pe = people.inputs || {};
  const si = source.inputs || {};
  return {
    intent: { value: pct(visits.points + pages.points + apollo.points, intentCap), why: intentWhy },
    industry, size, us_footprint: us,
    buyers: { value: pct(people.points, caps.people), why: pe.people ? `${pe.buyers ?? 0} buyer title${pe.buyers === 1 ? '' : 's'} · ${pe.people} people known` : 'no people known yet' },
    warm_path: { value: pct(source.points, caps.source), why: si.via_upside ? (si.named ? 'Brad named them' : 'Upside list') : SOURCE_WHY[si.label] || SOURCE_WHY.other },
  };
}

// -> { score, used, of } - the weighted mean over axes with a value; null score when none has data.
export function fitScoreOf(axes, weights) {
  const w = weights || Object.fromEntries(FIT_AXIS_IDS.map(k => [k, 1]));
  let sum = 0, wsum = 0, used = 0;
  for (const k of FIT_AXIS_IDS) {
    const v = axes?.[k]?.value;
    if (v == null || !(w[k] > 0)) continue;
    sum += v * w[k]; wsum += w[k]; used++;
  }
  return { score: wsum > 0 ? Math.round(sum / wsum) : null, used, of: FIT_AXIS_IDS.length };
}

// The "Your clients (avg)" overlay: per axis, the mean over the clients that have that axis; n = clients.
export function clientsOverlay(axesList) {
  const list = (axesList || []).filter(Boolean);
  const axes = Object.fromEntries(FIT_AXIS_IDS.map(k => {
    const vals = list.map(a => a[k]?.value).filter(v => v != null);
    return [k, vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null];
  }));
  return { n: list.length, axes };
}

// Everything the recompute stores per company (components.axes + meta.fit): the axes, the fit score and the level.
export function fitBlock({ components, caps, usFootprint, record, settings }) {
  const { thresholds, weights } = fitSettings(settings);
  const axes = axesFrom({ components, caps, usFootprint });
  const score = fitScoreOf(axes, weights);
  const fit = effectiveFit(record, score.score, thresholds);
  return { axes, fit: { ...fit, score: score.score, used: score.used, of: score.of, hand_level: record?.fit_level || null, us_footprint: usFootprint || null } };
}

const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const TYPES = ['partner', 'employer', 'target'];

// GET goals/fit/:type/:id -> { axes: [{ id, value, why }], score, used, of, level, source, reason, thresholds,
// overlay: { n, axes } (hidden by the panel when n = 0) }. 404 until the first recompute.
export async function fitOf(supabase, businessId, { type, id }) {
  if (!TYPES.includes(type)) return reply(400, { error: 'type must be partner|employer|target' });
  const [row, settings] = await Promise.all([
    supabase.from('sales_company_scores').select('components').eq('business_id', businessId).eq('company_type', type).eq('company_id', id).maybeSingle().then(must),
    supabase.from('sales_settings').select('fit_settings').eq('business_id', businessId).maybeSingle().then(r => r.data || null),
  ]);
  if (!row) return reply(404, { error: 'No score yet - recompute' });
  const { axes = {}, meta = {} } = row.components || {};
  const fit = meta.fit || {};
  const overlay = await clientsOverlayOf(supabase, businessId);
  return reply(200, {
    axes: FIT_AXIS_IDS.map(k => ({ id: k, value: axes[k]?.value ?? null, why: axes[k]?.why || null })),
    score: fit.score ?? null, used: fit.used ?? 0, of: FIT_AXIS_IDS.length, level: fit.level || null, source: fit.source || null, reason: fit.reason || null, note: fit.note || null,
    hand_level: fit.hand_level || null, us_footprint: fit.us_footprint || null, thresholds: fitSettings(settings?.fit_settings).thresholds, overlay,
  });
}

// The mean axes over the workspace's clients (employers with a client_status, homelover-clients-v1).
export async function clientsOverlayOf(supabase, businessId) {
  const clients = await selectAllPages(() => supabase.from('sales_opportunities').select('id').eq('business_id', businessId).not('client_status', 'is', null).is('archived_at', null).order('id'));
  if (!clients.length) return { n: 0, axes: Object.fromEntries(FIT_AXIS_IDS.map(k => [k, null])) };
  const rows = await selectAllPages(() => supabase.from('sales_company_scores').select('company_id, components').eq('business_id', businessId).eq('company_type', 'employer').in('company_id', clients.map(c => c.id)).order('company_id'));
  const out = clientsOverlay(rows.map(r => r.components?.axes || null));
  return { ...out, n: clients.length };
}

export async function fitOfRoute(req, res) {
  try { const r = await fitOf(getSupabase(), req.params.businessId, { type: req.params.type, id: req.params.id }); res.status(r.status).json(r.body); }
  catch (e) { res.status(500).json({ error: e.message }); }
}
