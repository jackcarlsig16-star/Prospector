import { useState, useEffect, useRef } from 'react';
import './../kitTheme';
import { ui } from '../kitTheme';
import { KIT_RADIUS, KIT_TYPE } from '../tokens';

// sales-ia-v2 D1 - the shared pieces behind the inline-SVG charts (no chart
// library: landmine). Every chart measures its own width, draws on kit CSS
// vars (dark on screen, light in print), keeps text in text tokens, puts a
// legend on any chart with two or more series and a <title> on every mark.

export const CHART_FONT = "500 11px 'Geist', ui-sans-serif, system-ui, sans-serif";
export const MARK = { bar: 24, gap: 2, line: 2, dot: 4, radius: 4 };

const CSS = `
.ui-chart { display:block; overflow:visible; }
.ui-chart text { font:${CHART_FONT}; fill:var(--ui-muted); font-variant-numeric:tabular-nums; }
.ui-chart .ui-chart__cat { fill:var(--ui-soft); }
.ui-chart .ui-chart__value { fill:var(--ui-text); }
.ui-chart .ui-chart__grid { stroke:var(--ui-border); stroke-width:1; shape-rendering:crispEdges; }
.ui-chart .ui-chart__axis { stroke:var(--ui-control); stroke-width:1; shape-rendering:crispEdges; }
.ui-chart .ui-chart__hit { fill:transparent; }
.ui-chart .ui-chart__hit:hover { fill:color-mix(in srgb, var(--ui-text) 6%, transparent); }
.ui-chart-card { display:flex; flex-direction:column; gap:10px; min-width:0; padding:16px 18px; background:var(--ui-surface); border:1px solid var(--ui-border); border-radius:${KIT_RADIUS.card}px; }
.ui-chart-card__title { margin:0; font:600 14px 'Geist', ui-sans-serif, system-ui, sans-serif; color:var(--ui-text); }
.ui-chart-card__caption { font:400 12px 'Geist', ui-sans-serif, system-ui, sans-serif; color:var(--ui-muted); }
.ui-chart-card__note { font:500 12px 'Geist', ui-sans-serif, system-ui, sans-serif; color:var(--ui-warn); }
.ui-chart-card__empty { font:400 13px 'Geist', ui-sans-serif, system-ui, sans-serif; color:var(--ui-muted); min-height:48px; display:flex; align-items:center; }
.ui-legend { display:flex; flex-wrap:wrap; gap:4px 14px; margin:0; padding:0; list-style:none; font:400 12px 'Geist', ui-sans-serif, system-ui, sans-serif; color:var(--ui-soft); }
.ui-legend li { display:inline-flex; align-items:center; gap:6px; white-space:nowrap; }
.ui-legend__swatch { width:10px; height:10px; border-radius:3px; flex:none; }
.ui-legend__swatch--line { width:14px; height:3px; border-radius:2px; }
`;
if (typeof document !== 'undefined' && !document.getElementById('ui-chart-css')) {
  const el = document.createElement('style');
  el.id = 'ui-chart-css';
  el.textContent = CSS;
  document.head.appendChild(el);
}

// Clean axis ticks from 0 to just past the data max: 0 / 1 / 2 or 0 / 500 / 1K.
// Counts never get a fractional step (a max of 1 reads 0 / 1, not 0 / 0.3 / 0.5).
export function niceTicks(max, count = 4, integer = true) {
  if (!(max > 0)) return [0, 1];
  const rough = max / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  let step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rough);
  if (integer) step = Math.max(1, Math.ceil(step));
  const ticks = [];
  for (let t = 0; t < max + step; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return ticks;
}
export const compact = n => (n == null ? '—' : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(Math.round(n * 10) / 10));
export const fmtNum = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));

// Which of n ordinal labels fit side by side in `width` px: every k-th.
export function labelStep(n, width, minPx = 44) {
  if (n <= 1) return 1;
  return Math.max(1, Math.ceil((n * minPx) / Math.max(width, 1)));
}

// The drawn width of a chart; a ResizeObserver keeps it current. jsdom has
// none, so tests draw at the fallback width.
export function useWidth(fallback = 600) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => { const w = el.getBoundingClientRect().width; if (w > 0) setWidth(Math.round(w)); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// series: [{ id, label, color, line? }] - shown whenever a chart has 2+ series.
export function Legend({ series, label = 'Series' }) {
  if (!series || series.length < 2) return null;
  return (
    <ul className="ui-legend" aria-label={label}>
      {series.map(s => <li key={s.id}><span aria-hidden="true" className={`ui-legend__swatch${s.line ? ' ui-legend__swatch--line' : ''}`} style={{ background: s.color }} />{s.label}</li>)}
    </ul>
  );
}

// The card around a chart: title, a caption that says what and when, an
// optional note (e.g. "History starts Oct 20"), the chart, and an empty line
// when there is nothing to draw. `id` lets a link jump to it.
export function ChartCard({ id, title, caption, note, empty, children, legend, className = '' }) {
  return (
    <section id={id} className={`ui-chart-card print-avoid-break ${className}`.trim()} aria-label={title} data-chart={id}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h3 className="ui-chart-card__title">{title}</h3>
        {caption && <span className="ui-chart-card__caption">{caption}</span>}
        {note && <span className="ui-chart-card__note" role="note">{note}</span>}
      </div>
      {empty ? <div className="ui-chart-card__empty">{empty}</div> : children}
      {!empty && legend}
    </section>
  );
}

// A number that stands on its own (waiting-on open / overdue).
export function StatTile({ label, value, tone, title }) {
  const color = tone === 'bad' ? ui.bad : tone === 'warn' ? ui.warn : ui.text;
  return (
    <div title={title} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 14px', background: ui.inset, border: `1px solid ${ui.border}`, borderRadius: KIT_RADIUS.control, minWidth: 110 }}>
      <span style={{ ...KIT_TYPE.label, color: ui.muted }}>{label}</span>
      <span style={{ fontFamily: KIT_TYPE.body.fontFamily, fontSize: 28, fontWeight: 600, lineHeight: 1.1, color }}>{fmtNum(value)}</span>
    </div>
  );
}
