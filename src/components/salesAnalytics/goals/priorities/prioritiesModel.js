// intent-score-v1 S3 - the pure half of the Priorities view (unit-tested): the Y-axis switch, ring / halo / hollow
// rules, legend dimming, paging, the filter <-> query mapping, the name-label rule and its collision pass. The chart
// components draw from these; nothing here reads the network or the DOM.
export const Y_METRICS = [['intent', 'Intent'], ['size', 'Size'], ['activity', 'Activity']];
export const VIEWS = [['dots', 'Dots'], ['bars', 'Bars'], ['table', 'Table']];
export const SEGMENTS = [['all', 'All'], ['visitors', 'Web visitors'], ['partners', 'Partners'], ['employers', 'Employers'], ['targets', 'Targets']];
export const WINDOWS = [['', 'Any time'], ['7', 'Visited 7 d'], ['30', 'Visited 30 d'], ['90', 'Visited 90 d']];
export const BANDS = ['P1', 'P2', 'P3', 'P4'];
// priorities-v2 D6 - the word inside each band zone, display only (never stored).
export const BAND_WORDS = { P1: 'Act now', P2: 'Warm', P3: 'Watch', P4: 'Backlog' };
// priorities-v2 C - the chart's height presets (only CHART_H changes).
export const HEIGHTS = [['compact', 'Compact', 360], ['standard', 'Standard', 560], ['tall', 'Tall', 800]];
export const heightPx = id => (HEIGHTS.find(([k]) => k === id) || HEIGHTS[1])[2];
// Rings around the core, in this fixed order (named in the chart's key); radius grows with the points.
export const RING_ORDER = ['visits', 'people', 'fit', 'research', 'engagement'];
export const DEFAULT_CAPS = { visits: 25, pages: 10, apollo_intent: 5, people: 15, fit: 15, research: 10, source: 12, engagement: 10, stage: 10, recency: 10 };
export const PAGE_SIZE = 40;
export const TOP_LABELS = 10;
export const HALO = { bright: 7, faint: 30 }; // days since the last touch (REVISABLE, = the server's TOUCH_WINDOWS)
export const ACTIVITY_MAX_DAYS = 90;
export const EMPTY_FILTERS = { segment: 'all', owner: '', source: [], band: '', needs_touch: false, min: 0, window: '', q: '' };
export const LS_KEY = 'prospector_priorities_view'; // { view, y, height, rings, names } - per-viewer convenience
export const NAME_MODES = [['on', 'On'], ['all', 'All'], ['off', 'Off']];
export const LABEL_TOP = 10;
export const LABEL_MIN_CHARS = 14;

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

// The viewer's chart prefs, normalized: view null = dots (table on a phone), height 'standard', rings off, names 'on'.
export function readPrefs() {
  let v = {};
  try { const x = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (x && typeof x === 'object') v = x; } catch { /* malformed: defaults */ }
  return {
    view: VIEWS.some(([id]) => id === v.view) ? v.view : null,
    y: Y_METRICS.some(([id]) => id === v.y) ? v.y : 'intent',
    height: HEIGHTS.some(([id]) => id === v.height) ? v.height : 'standard',
    rings: v.rings === true,
    names: NAME_MODES.some(([id]) => id === v.names) ? v.names : 'on',
  };
}
export function writePrefs(prefs) { try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ } }

export const labelText = (name, max = LABEL_MIN_CHARS) => { const n = String(name || ''); const m = Math.max(LABEL_MIN_CHARS, max); return n.length <= m ? n : `${n.slice(0, m - 1).trimEnd()}…`; };

// Which rows carry a name, in priority order: the selected row first, then every P1 (and P2 off the phone), then the
// top LABEL_TOP by the current Y metric, then - mode 'all' - everyone else in rank order. 'off' = the selected row only.
export function labelCandidates(rows, { mode = 'on', selectedKey = null, phone = false, y = 'intent' } = {}) {
  if (mode === 'off') return rows.filter(r => r.key === selectedKey);
  const scale = yScale(y, rows);
  const bands = phone ? ['P1'] : ['P1', 'P2'];
  const top = new Set(phone ? [] : [...rows].sort((a, b) => scale.to(yValue(b, y)) - scale.to(yValue(a, y))).slice(0, LABEL_TOP).map(r => r.key));
  const pick = rows.filter(r => r.key !== selectedKey && (bands.includes(r.band) || top.has(r.key)));
  const rest = mode === 'all' ? rows.filter(r => r.key !== selectedKey && !pick.includes(r)) : [];
  return [...rows.filter(r => r.key === selectedKey), ...pick, ...rest];
}

// The collision pass. items (priority order): { key, text, x, y, pad, anchor? } - the mark's center and how far the
// label starts from it. A label tries its own y, then up / down in `step` px up to maxSteps; at each y it tries the
// right side then the left (left first when the right would leave maxX; anchor 'middle' = centered on x, then to the
// right, then to the left - the bars' labels above the top), and is dropped when nothing is free - the Table always
// has the name. obstacles: boxes ({ x0, x1, y0, y1 }) labels must also avoid (the marks themselves).
export function placeLabels(items, { charW = 6.3, lineH = 12, step = 12, maxSteps = 3, minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity, obstacles = [] } = {}) {
  const taken = [...obstacles];
  const hits = b => taken.some(p => b.x0 < p.x1 && p.x0 < b.x1 && b.y0 < p.y1 && p.y0 < b.y1);
  const placed = [];
  for (const it of items) {
    const w = it.text.length * charW;
    const right = { x0: it.x + it.pad, x: it.x + it.pad, anchor: 'start' };
    const left = { x0: it.x - it.pad - w, x: it.x - it.pad, anchor: 'end' };
    const sides = it.anchor === 'middle'
      ? [{ x0: it.x - w / 2, x: it.x, anchor: 'middle' }, right, left]
      : it.x + it.pad + w <= maxX || it.x - it.pad - w < minX ? [right, left] : [left, right];
    const fits = sd => sd.x0 >= minX && sd.x0 + w <= maxX;
    const open = sides.filter(fits).length ? sides.filter(fits) : [sides[0]];
    let done = null;
    for (let s = 0; s <= maxSteps && !done; s++) {
      for (const dir of s === 0 ? [0] : [-1, 1]) {
        const yc = it.y + dir * s * step;
        if (yc - lineH / 2 < minY || yc + lineH / 2 > maxY) continue;
        for (const sd of open) {
          const box = { x0: sd.x0, x1: sd.x0 + w, y0: yc - lineH / 2, y1: yc + lineH / 2 };
          if (hits(box)) continue;
          done = { key: it.key, text: it.text, x: sd.x, y: yc, anchor: sd.anchor, shifted: dir * s * step, box };
          break;
        }
        if (done) break;
      }
    }
    if (done) { placed.push(done); taken.push(done.box); }
  }
  return placed;
}

// brad-attribution-v1 F5 - the hover's chain: the reached funnel stages as icon + date ("↪ Oct 22 · ◎ Oct 24 · ✉ Oct 26").
export const CHAIN_ICONS = [['referred', '↪', 'Referred'], ['visited', '◎', 'Visited'], ['replied', '✉', 'Replied'], ['meeting', '◆', 'Meeting'], ['pilot', '★', 'Pilot'], ['lost', '✕', 'Lost']];
const chainDay = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const shortChain = c => (!c ? '' : CHAIN_ICONS.filter(([s]) => c[s]).map(([s, icon]) => `${icon} ${chainDay(c[s])}`).join(' · '));
