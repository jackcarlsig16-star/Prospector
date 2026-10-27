// intent-score-v1 S3 - the pure half of the Priorities view (unit-tested): the Y-axis switch, ring / halo / hollow
// rules, legend dimming, paging and the filter <-> query mapping. The chart components draw from these; nothing
// here reads the network or the DOM.
export const Y_METRICS = [['intent', 'Intent'], ['size', 'Size'], ['activity', 'Activity']];
export const VIEWS = [['dots', 'Dots'], ['bars', 'Bars'], ['table', 'Table']];
export const SEGMENTS = [['all', 'All'], ['visitors', 'Web visitors'], ['partners', 'Partners'], ['employers', 'Employers'], ['targets', 'Targets']];
export const WINDOWS = [['', 'Any time'], ['7', 'Visited 7 d'], ['30', 'Visited 30 d'], ['90', 'Visited 90 d']];
export const BANDS = ['P1', 'P2', 'P3', 'P4'];
// Rings around the core, in this fixed order (named in the chart's key); radius grows with the points.
export const RING_ORDER = ['visits', 'people', 'fit', 'research', 'engagement'];
export const DEFAULT_CAPS = { visits: 25, pages: 10, apollo_intent: 5, people: 15, fit: 15, research: 10, source: 12, engagement: 10, stage: 10, recency: 10 };
export const PAGE_SIZE = 40;
export const TOP_LABELS = 5;
export const HALO = { bright: 7, faint: 30 }; // days since the last touch (REVISABLE, = the server's TOUCH_WINDOWS)
export const ACTIVITY_MAX_DAYS = 90;
export const EMPTY_FILTERS = { segment: 'all', owner: '', source: [], band: '', needs_touch: false, min: 0, window: '', q: '' };
export const LS_KEY = 'prospector_priorities_view'; // { view, y } - per-viewer convenience

export const activeFilterCount = f => ['owner', 'band', 'window', 'q'].filter(k => f[k]).length + (f.segment !== 'all' ? 1 : 0) + (f.source.length ? 1 : 0) + (f.needs_touch ? 1 : 0) + (f.min > 0 ? 1 : 0);
export const filterParams = f => ({ segment: f.segment !== 'all' ? f.segment : null, owner: f.owner || null, source: f.source.length ? f.source.join(',') : null, band: f.band || null, needs_touch: f.needs_touch ? '1' : null, min: f.min > 0 ? f.min : null, window: f.window || null, q: f.q || null });
export const filtersFromView = v => ({ ...EMPTY_FILTERS, ...(v || {}), source: Array.isArray(v?.source) ? v.source : v?.source ? String(v.source).split(',') : [], min: Number(v?.min) || 0, needs_touch: v?.needs_touch === true || v?.needs_touch === '1' });

// The value a row plots at for each Y metric; null = unknown (drawn on the baseline "unknown" row).
export function yValue(row, metric) {
  if (metric === 'size') return row.employees != null && Number(row.employees) > 0 ? Number(row.employees) : null;
  if (metric === 'activity') return row.days_since_touch == null ? null : Math.min(ACTIVITY_MAX_DAYS, row.days_since_touch);
  return row.score;
}

// to(v): a 0..1 height fraction (1 = top); ticks for the axis; unknown rows sit at 0 and are drawn hollow.
export function yScale(metric, rows = []) {
  if (metric === 'size') {
    const max = Math.max(4, ...rows.map(r => (yValue(r, 'size') ? Math.log10(yValue(r, 'size')) : 0)));
    const ticks = [1, 2, 3, 4, 5].filter(e => e <= Math.ceil(max)).map(e => ({ v: 10 ** e, label: e >= 3 ? `${10 ** (e - 3)}k` : String(10 ** e) }));
    return { metric, to: v => (v == null || v <= 1 ? 0 : Math.min(1, Math.log10(v) / max)), ticks, format: v => (v == null ? 'unknown' : Number(v).toLocaleString('en-US')), label: 'Employees (log)' };
  }
  if (metric === 'activity') {
    const ticks = [[0, 'today'], [7, '7 d'], [30, '30 d'], [ACTIVITY_MAX_DAYS, '90 d+']].map(([v, label]) => ({ v, label }));
    return { metric, to: v => (v == null ? 0 : 1 - Math.min(ACTIVITY_MAX_DAYS, v) / ACTIVITY_MAX_DAYS), ticks, format: v => (v == null ? 'never touched' : v === 0 ? 'today' : `${v} d ago`), label: 'Days since last touch' };
  }
  const ticks = [0, 25, 50, 75, 100].map(v => ({ v, label: String(v) }));
  return { metric: 'intent', to: v => Math.max(0, Math.min(1, (v || 0) / 100)), ticks, format: v => String(v ?? 0), label: 'Intent (0-100)' };
}

// [{ key, points, r }] for the rings a dot draws: core radius + up to `extra` px at the component's cap.
export function ringSpecs(components = {}, caps = DEFAULT_CAPS, { base = 5, extra = 14 } = {}) {
  return RING_ORDER.map((key, i) => {
    const points = Math.max(0, components[key]?.points || 0);
    const cap = caps[key] || DEFAULT_CAPS[key] || 10;
    return { key, points, r: points > 0 ? base + 2 + i * 1.5 + (points / cap) * extra : 0 };
  }).filter(r => r.r > 0);
}

export const haloLevel = row => (row.days_since_touch == null ? null : row.days_since_touch <= HALO.bright ? 'bright' : row.days_since_touch <= HALO.faint ? 'faint' : null);
// 'solid' (fresh research), 'decayed' (older than 60 d: toward hollow), 'hollow' (never researched).
export const hollowness = row => (row.researched === 'fresh' ? 'solid' : row.researched === 'decayed' ? 'decayed' : 'hollow');
// Legend toggle: an empty lit set means every source is lit; a lit set dims the others (never removes them).
export const isDimmed = (row, lit) => lit.size > 0 && !lit.has(row.source_label);
export function toggleLit(lit, source) { const n = new Set(lit); if (n.has(source)) n.delete(source); else n.add(source); return n; }

export function pageOf(rows, page, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  return { rows: rows.slice(p * size, (p + 1) * size), page: p, pages, from: rows.length ? p * size + 1 : 0, to: Math.min(rows.length, (p + 1) * size), total: rows.length };
}

export const rowLabel = (row, sourceLabels) => `${row.name} · ${row.score} · ${row.band} · ${sourceLabels[row.source_label] || row.source_label}`;
export const touchText = row => (row.days_since_touch == null ? 'Never touched' : `Last touch: ${row.days_since_touch === 0 ? 'today' : `${row.days_since_touch} day${row.days_since_touch === 1 ? '' : 's'} ago`}${row.last_touch_who || row.last_touch_channel ? ` (${[row.last_touch_who, row.last_touch_channel].filter(Boolean).join(', ')})` : ''}`);

export function readViewPrefs() {
  try { const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
export function writeViewPrefs(prefs) { try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ } }
