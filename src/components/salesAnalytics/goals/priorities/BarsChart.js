import { useState } from 'react';
import { SA } from '../../theme';
import { sourceColor, SOURCE_LABELS } from '../../palette';
import { numStyle } from '../goalsUi';
import { yValue, yScale, isDimmed, rowLabel, hollowness, labelCandidates, labelText, placeLabels, LABEL_MIN_CHARS } from './prioritiesModel';
import { Tooltip, CHART_H, cardPlace, markHandlers } from './DotsChart';

// intent-score-v1 S3 ALTERNATE - the same rows as thin bars (4 px rounded tops anchored to the baseline, 2 px gaps),
// the same legend / selection / hover / filters; the bar color is the source, never the rank. Names follow the dots'
// rule (FIX priorities-labels-v1): inside the bar when the name fits, else above it through the collision pass.
const M = { l: 44, r: 64, t: 30, b: 28 };
const topPath = (x, y0, y1, w, rad) => { const r = Math.min(rad, w / 2, Math.max(0, y0 - y1)); return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`; };

export default function BarsChart({ rows, lit, y = 'intent', thresholds, caps, counts = {}, selectedKey, onSelect, onOpen, menu = null, showTrend = false, width = 960, names = 'on', phone = false, height = CHART_H }) {
  const [hover, setHover] = useState(null);
  const n = rows.length;
  const W = Math.max(320, width), plotW = W - M.l - M.r, plotH = height - M.t - M.b;
  const scale = yScale(y, rows);
  const slot = n ? plotW / n : plotW;
  const bw = Math.max(2, slot - 2);
  const x0 = i => M.l + slot * i + 1;
  const cy = v => M.t + plotH * (1 - scale.to(v));
  const base = M.t + plotH;
  const guides = y === 'intent' && thresholds ? [['P1', thresholds.P1], ['P2', thresholds.P2], ['P3', thresholds.P3]] : [];
  const geom = rows.map((r, i) => { const v = yValue(r, y); return { r, v, x: x0(i), top: v == null ? base - 3 : cy(v) }; });
  const byKey = new Map(geom.map(g => [g.r.key, g]));
  const maxChars = Math.max(LABEL_MIN_CHARS, Math.min(24, Math.floor((slot * 3) / 6.3)));
  const inside = [], above = [];
  for (const r of labelCandidates(rows, { mode: names, selectedKey, phone, y })) {
    const g = byKey.get(r.key), text = labelText(r.name, maxChars);
    if (bw >= text.length * 6.3 + 6 && base - g.top >= 18) inside.push({ key: r.key, text, x: g.x + bw / 2, y: g.top + 10 });
    else above.push({ key: r.key, text, x: g.x + bw / 2, y: g.top - 8, pad: 0, anchor: 'middle' });
  }
  const labels = placeLabels(above, { minX: M.l, maxX: W - M.r, minY: M.t - 12, maxY: base, obstacles: geom.map(g => ({ x0: g.x, x1: g.x + bw, y0: g.top, y1: base })) });
  const pinned = byKey.get(selectedKey) || null;
  return (
    <div data-bars-chart style={{ position: 'relative', width: '100%' }}>
      <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} role="group" aria-label={`Companies ranked by intent as bars, Y axis ${scale.label}`} style={{ display: 'block', overflow: 'visible', fontFamily: 'inherit' }}>
        {scale.ticks.map(t => (
          <g key={t.v}>
            <line x1={M.l} x2={W - M.r} y1={cy(t.v)} y2={cy(t.v)} stroke={SA.track} strokeWidth={1} />
            <text x={M.l - 8} y={cy(t.v) + 4} textAnchor="end" fontSize={11} fill={SA.muted} style={numStyle}>{t.label}</text>
          </g>
        ))}
        <text x={M.l - 8} y={M.t - 12} textAnchor="end" fontSize={11} fill={SA.muted}>{scale.label}</text>
        {guides.map(([band, v]) => (
          <g key={band} data-band-guide={band}>
            <line x1={M.l} x2={W - M.r} y1={cy(v)} y2={cy(v)} stroke={SA.borderStrong} strokeWidth={1} strokeDasharray="4 4" />
            <text x={W - M.r + 8} y={cy(v) + 4} fontSize={11} fill={SA.muted} style={numStyle}>{band} · {counts[band] ?? 0}</text>
          </g>
        ))}
        <line x1={M.l} x2={W - M.r} y1={base} y2={base} stroke={SA.borderStrong} strokeWidth={1} />
        {geom.map(({ r, v, x, top }) => {
          const color = sourceColor(r.source_label), dim = isDimmed(r, lit), selected = r.key === selectedKey;
          return (
            <g key={r.key} data-bar={r.key} data-source={r.source_label} data-dimmed={dim ? 'true' : undefined} data-selected={selected ? 'true' : undefined}
              role="button" tabIndex={0} aria-label={rowLabel(r, SOURCE_LABELS)} aria-pressed={selected}
              {...markHandlers(r, selected, onSelect, onOpen)}
              onMouseEnter={() => setHover({ row: r, x: x + bw / 2, y: top })} onMouseLeave={() => setHover(null)} onFocus={() => setHover({ row: r, x: x + bw / 2, y: top })} onBlur={() => setHover(null)}
              style={{ opacity: dim ? 0.4 : 1, cursor: 'pointer', outline: 'none' }}>
              <path d={topPath(x, base, top, bw, 4)} fill={color} opacity={hollowness(r) === 'hollow' ? 0.55 : 1} style={{ transition: 'd 400ms' }} />
              {v == null && <path d={topPath(x, base, top, bw, 4)} fill="none" stroke={color} strokeDasharray="2 2" />}
              {selected && <rect x={x - 2} y={top - 2} width={bw + 4} height={base - top + 2} fill="none" stroke={SA.accent} strokeWidth={2} rx={4} data-selection-ring />}
              {showTrend && r.band_changed && r.trend && r.trend !== 'flat' && <text x={x + bw / 2} y={base + 14} textAnchor="middle" fontSize={10} fill={r.trend === 'up' ? SA.good : SA.bad} data-trend={r.trend}>{r.trend === 'up' ? '▲' : '▼'}</text>}
              <rect x={x - 1} y={M.t} width={bw + 2} height={plotH} fill="transparent" />
            </g>
          );
        })}
        <g data-name-labels aria-hidden="true" style={{ pointerEvents: 'none' }}>
          {inside.map(l => <text key={l.key} data-name-label={l.key} data-label-inside x={l.x} y={l.y} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600} fill={SA.inset}>{l.text}</text>)}
          {labels.map(l => <text key={l.key} data-name-label={l.key} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={500} fill={SA.text} style={{ paintOrder: 'stroke', stroke: SA.inset, strokeWidth: 3, strokeLinejoin: 'round' }}>{l.text}</text>)}
        </g>
        {!n && <text x={W / 2} y={height / 2} textAnchor="middle" fontSize={13} fill={SA.muted}>No companies under these filters</text>}
      </svg>
      {names === 'all' && n > 0 && <div data-names-count style={{ fontSize: 11, color: SA.muted, padding: '0 0 0 44px' }}>{inside.length + labels.length} of {n} named - see Table for all</div>}
      {hover && !pinned && <Tooltip row={hover.row} x={hover.x} y={hover.y} metric={y} />}
      {pinned && <Tooltip row={pinned.r} x={pinned.x + bw / 2} y={pinned.top} metric={y} pinned place={cardPlace({ x: pinned.x + bw / 2, y: pinned.top, W, kind: 'bar' })} onOpenName={() => onOpen && onOpen(pinned.r)}>{menu}</Tooltip>}
    </div>
  );
}
