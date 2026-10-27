import { useState } from 'react';
import { SA } from '../../theme';
import { sourceColor, SOURCE_LABELS } from '../../palette';
import { numStyle } from '../goalsUi';
import { yValue, yScale, isDimmed, rowLabel, hollowness, TOP_LABELS } from './prioritiesModel';
import { Tooltip, CHART_H } from './DotsChart';

// intent-score-v1 S3 ALTERNATE - the same rows as thin bars (4 px rounded tops anchored to the baseline, 2 px gaps),
// the same legend / selection / hover / filters; the bar color is the source, never the rank.
const M = { l: 44, r: 64, t: 30, b: 28 };
const topPath = (x, y0, y1, w, rad) => { const r = Math.min(rad, w / 2, Math.max(0, y0 - y1)); return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`; };

export default function BarsChart({ rows, lit, y = 'intent', thresholds, caps, counts = {}, selectedKey, onSelect, showTrend = false, width = 960 }) {
  const [hover, setHover] = useState(null);
  const n = rows.length;
  const W = Math.max(320, width), plotW = W - M.l - M.r, plotH = CHART_H - M.t - M.b;
  const scale = yScale(y, rows);
  const slot = n ? plotW / n : plotW;
  const bw = Math.max(2, slot - 2);
  const x0 = i => M.l + slot * i + 1;
  const cy = v => M.t + plotH * (1 - scale.to(v));
  const base = M.t + plotH;
  const guides = y === 'intent' && thresholds ? [['P1', thresholds.P1], ['P2', thresholds.P2], ['P3', thresholds.P3]] : [];
  return (
    <div data-bars-chart style={{ position: 'relative', width: '100%' }}>
      <svg width="100%" height={CHART_H} viewBox={`0 0 ${W} ${CHART_H}`} role="img" aria-label={`Companies ranked by intent as bars, Y axis ${scale.label}`} style={{ display: 'block', overflow: 'visible', fontFamily: 'inherit' }}>
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
        {rows.map((r, i) => {
          const v = yValue(r, y), top = v == null ? base - 3 : cy(v), color = sourceColor(r.source_label), dim = isDimmed(r, lit), selected = r.key === selectedKey;
          const x = x0(i);
          return (
            <g key={r.key} data-bar={r.key} data-source={r.source_label} data-dimmed={dim ? 'true' : undefined} data-selected={selected ? 'true' : undefined}
              role="button" tabIndex={0} aria-label={rowLabel(r, SOURCE_LABELS)} aria-pressed={selected}
              onClick={() => onSelect && onSelect(r)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect && onSelect(r); } }}
              onMouseEnter={() => setHover({ row: r, x: x + bw / 2, y: top })} onMouseLeave={() => setHover(null)} onFocus={() => setHover({ row: r, x: x + bw / 2, y: top })} onBlur={() => setHover(null)}
              style={{ opacity: dim ? 0.4 : 1, cursor: 'pointer', outline: 'none' }}>
              <path d={topPath(x, base, top, bw, 4)} fill={color} opacity={hollowness(r) === 'hollow' ? 0.55 : 1} style={{ transition: 'd 400ms' }} />
              {v == null && <path d={topPath(x, base, top, bw, 4)} fill="none" stroke={color} strokeDasharray="2 2" />}
              {selected && <rect x={x - 2} y={top - 2} width={bw + 4} height={base - top + 2} fill="none" stroke={SA.accent} strokeWidth={2} rx={4} data-selection-ring />}
              {i < TOP_LABELS && <text x={x + bw / 2} y={top - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={SA.text} style={numStyle} data-direct-label>{r.score}</text>}
              {showTrend && r.band_changed && r.trend && r.trend !== 'flat' && <text x={x + bw / 2} y={base + 14} textAnchor="middle" fontSize={10} fill={r.trend === 'up' ? SA.good : SA.bad} data-trend={r.trend}>{r.trend === 'up' ? '▲' : '▼'}</text>}
              <rect x={x - 1} y={M.t} width={bw + 2} height={plotH} fill="transparent" />
            </g>
          );
        })}
        {!n && <text x={W / 2} y={CHART_H / 2} textAnchor="middle" fontSize={13} fill={SA.muted}>No companies under these filters</text>}
      </svg>
      {hover && <Tooltip row={hover.row} x={hover.x} y={hover.y} metric={y} />}
    </div>
  );
}
