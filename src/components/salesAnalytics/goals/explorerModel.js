import { LAYERS, LAYER_IDS, SHOWS, BY, SPLITS, HEIGHTS, HOME_LAYERS } from '../../../constants/explorerLayers';

// dashboard-v3 Stage 3 - the Explorer's pure pieces: per-viewer prefs, the chart's scales and geometry, the CSV.
// localStorage prospector_explorer_<context> - a per-viewer convenience (layers, show, by, split, height), never shared.
const key = context => `prospector_explorer_${context}`;
export const DEFAULTS = { layers: HOME_LAYERS, show: 'lines', by: 'week', split: 'team', height: 'standard' };
export function cleanState(s, defaults = DEFAULTS) {
  const layers = (Array.isArray(s?.layers) ? s.layers : []).filter(l => LAYER_IDS.includes(l));
  const pick = (list, v, d) => (list.some(([id]) => id === v) ? v : d);
  return { layers: layers.length ? [...new Set(layers)] : defaults.layers, show: pick(SHOWS, s?.show, defaults.show), by: pick(BY, s?.by, defaults.by), split: pick(SPLITS, s?.split, defaults.split), height: pick(HEIGHTS, s?.height, defaults.height) };
}
export function readPrefs(context, defaults = DEFAULTS) {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(key(context)) || 'null'); } catch { v = null; }
  return cleanState(v && typeof v === 'object' ? v : {}, defaults);
}
export function writePrefs(context, state) { try { localStorage.setItem(key(context), JSON.stringify(state)); } catch { /* private mode */ } }

export const fmtValue = (kind, v) => (v == null ? '—' : kind === 'rate' ? `${(v * 100).toFixed(1)}%` : Number(v).toLocaleString('en-US'));
export const heightPx = id => (HEIGHTS.find(([k]) => k === id) || HEIGHTS[1])[2];
export const chipGlyph = layer => (LAYERS[layer].kind === 'count' ? 'square' : 'dash');

// A round axis maximum (1 · 1.2 · 1.5 · 2 · 2.5 · 3 · 4 · 5 · 6 · 8 · 10 steps) so the four gridlines read cleanly and the
// tallest column still fills most of the plot.
export function niceMax(max) {
  if (!(max > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}
export const ticks = (max, n = 4) => Array.from({ length: n + 1 }, (_, i) => (max * i) / n);

// Scales: counts on the left (max over count series), rates on the right (max over rate series, at least 1 %).
export function scales(series) {
  const counts = series.filter(s => s.kind === 'count'), rates = series.filter(s => s.kind === 'rate');
  const maxOf = list => Math.max(0, ...list.flatMap(s => s.values.filter(v => v != null)));
  return { hasCounts: counts.length > 0, hasRates: rates.length > 0, maxCount: niceMax(maxOf(counts)), maxRate: Math.max(0.01, niceMax(maxOf(rates))) };
}

export const GEOM = { W: 1340, padL: 44, padR: 48, padT: 10, padB: 26, maxColumn: 37 };
export function geometry(n, H, g = GEOM) {
  const plotW = g.W - g.padL - g.padR, plotH = H - g.padT - g.padB;
  const slot = n ? plotW / n : plotW;
  return { ...g, H, plotW, plotH, slot, x0: g.padL, y0: g.padT + plotH, center: i => g.padL + i * slot + slot / 2, yCount: (v, max) => g.padT + plotH - (v / max) * plotH, yRate: (v, max) => g.padT + plotH - (v / max) * plotH };
}
// Which bucket index a pointer x (in SVG units) falls on; null outside the plot.
export const bucketAt = (x, geom, n) => { const i = Math.floor((x - geom.padL) / geom.slot); return i >= 0 && i < n ? i : null; };
// Day mode: a label every k buckets so ~9 read along the axis.
export const labelEvery = n => Math.max(1, Math.ceil(n / 9));

export function csvOf(data) {
  const columns = [{ key: 'bucket', label: data.by === 'day' ? 'Day' : 'Week of' }, ...data.series.map((s, i) => ({ key: `s${i}`, label: s.label }))];
  const rows = data.labels.map((l, i) => ({ bucket: l.key, ...Object.fromEntries(data.series.map((s, k) => [`s${k}`, s.values[i] == null ? '' : s.kind === 'rate' ? (s.values[i] * 100).toFixed(2) : s.values[i]])) }));
  return { rows, columns };
}
