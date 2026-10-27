import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { hasRole } from '../lib/requireAuth.js';
import { laDateString } from './laDate.js';
import { cleanText } from './scrubText.js';
import { DEFAULT_WEIGHTS, SOURCE_ORDER, trendOf, COMPONENTS } from './intentScore.js';
import { recomputeScores, mergeWeights, isStale, NEEDS_TOUCH_MIN, TOUCH_WINDOWS } from './intentScoreRun.js';
import { sourceLabelOf } from './companyBrief.js';
import { breakdownLines } from './intentScore.js';

// intent-score-v1 Stage 2 - GET goals/scores (the ranked rows + components under the S3 filters, with yesterday's band
// for the ▲ / ▼ markers), POST goals/scores/recompute (owner / admin, optional one company), GET goals/scores/export.csv.
// Rows come from sales_company_scores alone (components.meta carries the record facts); nothing here reads a person's
// address, and the CSV has none by construction (the test checks for "@").
export const SEGMENTS = ['all', 'visitors', 'partners', 'employers', 'targets'];
export const WINDOWS = [7, 30, 90];
const DAY = 864e5;
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const reply = (status, body) => ({ status, body });
const send = (res, r) => res.status(r.status).json(r.body);
const daysSince = (iso, now) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / DAY)) : null);

export function parseFilters(q = {}) {
  const f = {
    segment: SEGMENTS.includes(q.segment) ? q.segment : 'all',
    owner: typeof q.owner === 'string' ? q.owner : '',
    source: typeof q.source === 'string' && q.source ? q.source.split(',').filter(s => SOURCE_ORDER.includes(s)) : [],
    band: ['P1', 'P2', 'P3', 'P4'].includes(q.band) ? q.band : '',
    needs_touch: q.needs_touch === '1' || q.needs_touch === 'true',
    min: Number.isFinite(Number(q.min)) ? Math.max(0, Math.min(100, Math.round(Number(q.min)))) : 0,
    window: WINDOWS.includes(Number(q.window)) ? Number(q.window) : null,
    q: typeof q.q === 'string' ? q.q.trim().toLowerCase().slice(0, 80) : '',
  };
  return f;
}

export const needsTouch = (r, now) => r.score >= NEEDS_TOUCH_MIN && !r.closed && (r.last_touch_at == null || now - Date.parse(r.last_touch_at) > TOUCH_WINDOWS.needs * DAY);

export function filterScoreRows(rows, f, now = Date.now()) {
  return rows.filter(r => {
    if (f.segment === 'visitors' && !r.last_visit) return false;
    if (f.segment === 'partners' && r.type !== 'partner') return false;
    if (f.segment === 'employers' && r.type !== 'employer') return false;
    if (f.segment === 'targets' && r.type !== 'target') return false;
    if (f.owner === 'unassigned' ? r.owner_user_id : f.owner && r.owner_user_id !== f.owner) return false;
    if (f.source.length && !f.source.includes(r.source_label)) return false;
    if (f.band && r.band !== f.band) return false;
    if (f.needs_touch && !needsTouch(r, now)) return false;
    if (f.min && r.score < f.min) return false;
    if (f.window && !(r.last_visit && now - Date.parse(`${String(r.last_visit).slice(0, 10)}T12:00:00Z`) <= f.window * DAY)) return false;
    if (f.q && !String(r.name || '').toLowerCase().includes(f.q)) return false;
    return true;
  });
}

// One API row from a stored score row (+ the earlier snapshot for the trend).
export function publicRow(s, prev, now = Date.now()) {
  const { meta = {}, ...components } = s.components || {};
  const comp = Object.fromEntries(COMPONENTS.map(k => [k, components[k] || { points: 0, inputs: {} }]));
  const upside = meta.owner_team === 'upside' || meta.owner_team === 'both';
  return {
    type: s.company_type, id: s.company_id, key: `${s.company_type}-${s.company_id}`, name: meta.name || null,
    score: s.score, band: s.band, components: comp, source_kind: s.source_kind, source_label: s.source_label, source_partner_id: s.source_partner_id || null,
    owner_user_id: meta.owner_user_id || null, owner: meta.owner || null, owner_team: meta.owner_team || null, co_owner_name: meta.co_owner_name || null,
    no_double_touch: !!meta.no_double_touch, upside_owned: upside, touch_locked: upside && !!meta.no_double_touch,
    closed: !!s.closed, live: !!s.flagged_out, duplicate_of: s.duplicate_of || null, override: s.override || null,
    stage: meta.stage || null, kind: meta.kind || null, employees: meta.employees ?? null,
    visits_7d: meta.visits_7d ?? null, unique_visitors_7d: meta.unique_visitors_7d ?? null, last_visit: meta.last_visit || null, people: meta.people ?? 0,
    last_touch_at: meta.last_touch_at || null, last_touch_who: meta.last_touch_who || null, last_touch_channel: meta.last_touch_channel || null, days_since_touch: daysSince(meta.last_touch_at, now),
    researched: meta.researched || 'none', research_at: meta.research_at || null, computed_at: s.computed_at,
    prev_score: prev?.score ?? null, prev_band: prev?.band ?? null, trend: trendOf(s.score, prev?.score ?? null), band_changed: !!prev && prev.band !== s.band,
  };
}

async function previousSnapshot(supabase, businessId, today) {
  const last = must(await supabase.from('sales_company_score_days').select('day').eq('business_id', businessId).lt('day', today).order('day', { ascending: false }).limit(1));
  if (!last.length) return new Map();
  const rows = await selectAllPages(() => supabase.from('sales_company_score_days').select('company_type, company_id, score, band').eq('business_id', businessId).eq('day', last[0].day).order('company_id'));
  return new Map(rows.map(r => [`${r.company_type}-${r.company_id}`, r]));
}

export async function loadScoreRows(supabase, businessId, { now = Date.now() } = {}) {
  const today = laDateString(new Date(now));
  const [stored, prev, settings] = await Promise.all([
    selectAllPages(() => supabase.from('sales_company_scores').select('*').eq('business_id', businessId).order('score', { ascending: false }).order('company_id')),
    previousSnapshot(supabase, businessId, today),
    supabase.from('sales_settings').select('*').eq('business_id', businessId).maybeSingle().then(r => r.data || null),
  ]);
  const rows = stored.map(s => publicRow(s, prev.get(`${s.company_type}-${s.company_id}`) || null, now));
  const computedAt = stored.reduce((a, s) => (s.computed_at > (a || '') ? s.computed_at : a), null);
  return { rows, computedAt, weights: mergeWeights(settings?.score_weights), hasPrev: prev.size > 0, today };
}

// Rank order inside a band: longest untouched first (S3), then score.
export const rankSort = (a, b) => b.score - a.score || (b.days_since_touch ?? 1e9) - (a.days_since_touch ?? 1e9) || String(a.name).localeCompare(String(b.name));

export async function listScores(supabase, businessId, query = {}, { now = Date.now() } = {}) {
  const f = parseFilters(query);
  const { rows: all, computedAt, weights, hasPrev, today } = await loadScoreRows(supabase, businessId, { now });
  const ranked = all.filter(r => !r.live && !r.duplicate_of).sort(rankSort);
  const rows = filterScoreRows(ranked, f, now);
  const live = filterScoreRows(all.filter(r => r.live && !r.duplicate_of), f, now).sort(rankSort);
  const counts = { companies: all.length, ranked: ranked.length, shown: rows.length, live: live.length, duplicates: all.filter(r => r.duplicate_of).length, closed: ranked.filter(r => r.closed).length, needs_touch: ranked.filter(r => needsTouch(r, now)).length, band_changed: ranked.filter(r => r.band_changed).length };
  for (const b of ['P1', 'P2', 'P3', 'P4']) counts[b] = rows.filter(r => r.band === b).length;
  const sources = Object.fromEntries(SOURCE_ORDER.map(k => [k, ranked.filter(r => r.source_label === k).length]));
  const owners = [...new Map(ranked.filter(r => r.owner_user_id).map(r => [r.owner_user_id, r.owner])).entries()].map(([id, name]) => ({ user_id: id, name }));
  return reply(200, { rows: rows.map(r => ({ ...r, rank: ranked.indexOf(r) + 1 })), live, counts, sources, owners, filters: f, computed_at: computedAt, stale: isStale(computedAt, now), today, has_previous: hasPrev, thresholds: weights.thresholds, caps: weights.caps, needs_touch_rule: { min: NEEDS_TOUCH_MIN, days: TOUCH_WINDOWS.needs }, source_order: SOURCE_ORDER });
}
export async function listScoresRoute(req, res) {
  try { send(res, await listScores(getSupabase(), req.params.businessId, req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

// POST goals/scores/recompute { type?, id? } -> counts. Owner / admin only (S2 "Recompute now"); a Member may recompute
// ONE company from its window (S4 "Recompute").
export async function recomputeRoute(req, res) {
  const { type = null, id = null } = req.body || {};
  const one = type || id;
  if (one && !(['partner', 'employer', 'target'].includes(type) && typeof id === 'string' && id)) return res.status(400).json({ error: 'type must be partner|employer|target with an id' });
  if (!one && !hasRole(req, req.params.businessId, 'admin')) return res.status(403).json({ error: 'Only an owner or admin can recompute every score' });
  try {
    const r = await recomputeScores(getSupabase(), { businessId: req.params.businessId, trigger: 'manual', only: one ? { type, id } : null });
    res.status(200).json({ ran: true, counts: r.counts, computed_at: r.computed_at, ...(one ? { row: r.rows[0] ? { score: r.rows[0].score, band: r.rows[0].band } : null } : {}) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}

// GET goals/scores/:type/:id -> the one row + its breakdown lines (S4 Facts); 404 until the first recompute.
export async function scoreOf(supabase, businessId, { type, id, now = Date.now() }) {
  if (!['partner', 'employer', 'target'].includes(type)) return reply(400, { error: 'type must be partner|employer|target' });
  const s = must(await supabase.from('sales_company_scores').select('*').eq('business_id', businessId).eq('company_type', type).eq('company_id', id).maybeSingle());
  if (!s) return reply(404, { error: 'No score yet - recompute' });
  const today = laDateString(new Date(now));
  const prev = (await previousSnapshot(supabase, businessId, today)).get(`${type}-${id}`) || null;
  const row = publicRow(s, prev, now);
  return reply(200, { row, lines: breakdownLines({ components: row.components }), thresholds: DEFAULT_WEIGHTS.thresholds });
}
export async function scoreOfRoute(req, res) {
  try { send(res, await scoreOf(getSupabase(), req.params.businessId, { type: req.params.type, id: req.params.id })); }
  catch (e) { res.status(500).json({ error: e.message }); }
}

// S5 saved views: sales_settings.saved_views = [{ id, name, filters, y, view, created_by, created_at }] (<= 30).
export const SAVED_VIEWS_MAX = 30;
const VIEW_KEYS = ['segment', 'owner', 'source', 'band', 'needs_touch', 'min', 'window', 'q'];
export async function listViews(supabase, businessId) {
  const s = must(await supabase.from('sales_settings').select('saved_views').eq('business_id', businessId).maybeSingle());
  return reply(200, { views: Array.isArray(s?.saved_views) ? s.saved_views : [] });
}
export async function saveView(supabase, { businessId, userId, body = {}, now = Date.now() }) {
  const name = cleanText(String(body.name || ''), 60);
  if (!name) return reply(400, { error: 'name is required (up to 60 characters)' });
  const filters = Object.fromEntries(VIEW_KEYS.filter(k => body.filters && body.filters[k] != null && body.filters[k] !== '').map(k => [k, Array.isArray(body.filters[k]) ? body.filters[k].map(String).slice(0, 9) : typeof body.filters[k] === 'boolean' ? body.filters[k] : cleanText(String(body.filters[k]), 80)]));
  const y = ['intent', 'size', 'activity'].includes(body.y) ? body.y : 'intent';
  const view = ['dots', 'bars', 'table'].includes(body.view) ? body.view : 'dots';
  const cur = (await listViews(supabase, businessId)).body.views;
  if (cur.length >= SAVED_VIEWS_MAX && !cur.some(v => v.name === name)) return reply(409, { error: `At most ${SAVED_VIEWS_MAX} saved views - delete one first` });
  const entry = { id: cur.find(v => v.name === name)?.id || `v_${Math.random().toString(36).slice(2, 10)}`, name, filters, y, view, created_by: userId, created_at: new Date(now).toISOString() };
  const views = [...cur.filter(v => v.name !== name), entry];
  must(await supabase.from('sales_settings').upsert({ business_id: businessId, saved_views: views, updated_at: new Date(now).toISOString() }, { onConflict: 'business_id' }).select('business_id'));
  return reply(201, { view: entry, views });
}
export async function deleteView(supabase, { businessId, id, now = Date.now() }) {
  const cur = (await listViews(supabase, businessId)).body.views;
  if (!cur.some(v => v.id === id)) return reply(404, { error: 'view not found' });
  const views = cur.filter(v => v.id !== id);
  must(await supabase.from('sales_settings').update({ saved_views: views, updated_at: new Date(now).toISOString() }).eq('business_id', businessId).select('business_id'));
  return reply(200, { views });
}
export async function listViewsRoute(req, res) { try { send(res, await listViews(getSupabase(), req.params.businessId)); } catch (e) { res.status(500).json({ error: e.message }); } }
export async function saveViewRoute(req, res) { try { send(res, await saveView(getSupabase(), { businessId: req.params.businessId, userId: req.auth.user.id, body: req.body })); } catch (e) { res.status(500).json({ error: e.message }); } }
export async function deleteViewRoute(req, res) { try { send(res, await deleteView(getSupabase(), { businessId: req.params.businessId, id: req.params.id })); } catch (e) { res.status(500).json({ error: e.message }); } }

// CSV: the table's columns, same filters; closed-won / pilot rows under "Live"; quoted; nothing with an "@".
export const CSV_COLUMNS = ['Company', 'Type', 'Score', 'Band', 'Status', 'Source', 'Owner', 'Visits 7d', 'People', 'Last touch', 'Employees', 'Stage', 'Researched', 'Change'];
const cell = v => { const s = cleanText(String(v ?? ''), 200).replace(/"/g, '""'); return /[",\n]/.test(s) ? `"${s}"` : s; };
export function scoresCsv(rows, live = []) {
  const line = r => [r.name, r.type, r.score, r.band, r.live ? 'Live' : r.closed ? 'Closed' : '', sourceLabelOf(r.source_label), r.owner || 'Unassigned', r.visits_7d ?? '', r.people ?? 0,
    r.last_touch_at ? String(r.last_touch_at).slice(0, 10) : '', r.employees ?? '', r.stage || '', r.researched, r.trend === 'up' ? 'up' : r.trend === 'down' ? 'down' : ''].map(cell).join(',');
  return [CSV_COLUMNS.join(','), ...rows.map(line), ...live.map(line)].join('\n') + '\n';
}
export async function exportScoresRoute(req, res) {
  try {
    const r = await listScores(getSupabase(), req.params.businessId, req.query);
    if (r.status !== 200) return send(res, r);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="priorities-${r.body.today}.csv"`);
    res.send(scoresCsv(r.body.rows, r.body.live));
  } catch (e) { res.status(500).json({ error: e.message }); }
}
