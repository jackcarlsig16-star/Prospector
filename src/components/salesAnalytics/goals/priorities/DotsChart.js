import { useState } from 'react';
import { SA } from '../../theme';
import { sourceColor, SOURCE_LABELS } from '../../palette';
import { numStyle } from '../goalsUi';
import { yValue, yScale, ringSpecs, haloLevel, hollowness, isDimmed, rowLabel, touchText, labelCandidates, labelText, placeLabels, RING_ORDER, TOP_LABELS, LABEL_MIN_CHARS } from './prioritiesModel';

// intent-score-v1 S3 DOTS - companies on X in rank order, Y = the selected metric. Each dot: a core in the source
// hue, one translucent ring per component (RING_ORDER) in the same hue with radius ∝ points, a grey rank line
// threading the dots, dashed band guides at the thresholds with the band counts at the right edge, an activity halo
// (bright <= 7 d, faint <= 30 d), hollow when unresearched. Switching Y moves each dot (CSS transform transition);
// colors, selection and the lit set never change with it. Hand-built SVG on kit tokens, no chart library.
// Names (FIX priorities-labels-v1): the selected dot, every P1 / P2 and the top 10 by the current Y carry their name
// beside the mark in the text color (mode 'all' = everyone the collision pass can fit); a phone has no hover, so the
// selected dot keeps its breakdown card open.
export const CHART_H = 360;
const M = { l: 44, r: 64, t: 30, b: 28 };
const ringKey = RING_ORDER.map(k => k[0].toUpperCase() + k.slice(1)).join(' · ');
const COMPONENT_LABEL = { visits: 'Visits', pages: 'Pages', apollo_intent: 'Apollo intent', people: 'People', fit: 'Fit', research: 'Research', source: 'Source', engagement: 'Engagement', stage: 'Stage', recency: 'Recency' };

// The breakdown card. Hover = a transient tooltip under the mark. FIX priorities-select-vs-open-v1: pinned = the
// selected mark's card, placed beside the dot on the side with room (above a bar), never over the mark; the name is a
// link that OPENS the company window and the quick menu renders inside (children). One card at a time; the PNG export
// skips it (data-html2canvas-ignore).
export const CARD_W = 300;
export function cardPlace({ x, y, W, kind = 'dot', pad = 16 }) {
  if (kind === 'bar') return { left: Math.max(0, Math.min(W - CARD_W, x - CARD_W / 2)), top: y - 12, transform: 'translateY(-100%)', side: 'above' };
  const right = x + pad + CARD_W <= W;
  return right ? { left: x + pad, top: Math.max(0, y - 24), side: 'right' } : { right: W - x + pad, top: Math.max(0, y - 24), side: 'left' };
}
export function Tooltip({ row, x, y, metric, pinned = false, place = null, onOpenName, children }) {
  const comps = Object.entries(row.components || {}).filter(([, c]) => c && c.points !== 0).sort((a, b) => Math.abs(b[1].points) - Math.abs(a[1].points));
  const pos = pinned && place ? { left: place.left, right: place.right, top: place.top, transform: place.transform, width: CARD_W } : { left: Math.max(0, x - 120), top: y + 14, width: 240 };
  const a11y = pinned ? { role: 'group', 'aria-label': `${row.name} - selected`, 'data-pinned-card': row.key, 'data-card-side': place?.side, 'data-html2canvas-ignore': 'true' } : { role: 'tooltip', 'data-dot-tooltip': true };
  return (
    <div {...a11y} style={{ position: 'absolute', ...pos, zIndex: pinned ? 7 : 5, pointerEvents: pinned ? 'auto' : 'none', background: SA.surface2, border: `1px solid ${pinned ? SA.accent : SA.border}`, borderRadius: 10, padding: '10px 12px', fontSize: 12, color: SA.text, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13 }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: sourceColor(row.source_label), flex: 'none' }} />
        {pinned && onOpenName
          ? <button type="button" className="ui-link" data-card-name title="Open the company window" onClick={onOpenName} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, fontSize: 13 }}>{row.name}</button>
          : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>}
      </div>
      <div style={{ ...numStyle, color: SA.muted, marginTop: 2 }}>Intent {row.score} · {row.band} · {SOURCE_LABELS[row.source_label] || row.source_label}{row.live ? ' · Live' : row.closed ? ' · Closed' : ''}</div>
      <div style={{ ...numStyle, color: SA.muted }}>{row.employees != null ? `${Number(row.employees).toLocaleString('en-US')} employees` : 'size unknown'} · {touchText(row)}</div>
      {metric !== 'intent' && <div style={{ color: SA.muted }}>{metric === 'size' ? 'Y = employees (log)' : 'Y = days since last touch'}</div>}
      {row.trend && row.band_changed && <div style={{ color: SA.muted }}>Since yesterday: {row.prev_band} → {row.band}</div>}
      <table style={{ marginTop: 6, borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {comps.map(([k, c]) => (
            <tr key={k}><td style={{ padding: '1px 0', color: SA.muted }}>{COMPONENT_LABEL[k] || k}</td><td style={{ ...numStyle, textAlign: 'right', padding: '1px 0', color: c.points < 0 ? SA.bad : SA.text }}>{c.points > 0 ? '+' : ''}{c.points}</td></tr>
          ))}
          {!comps.length && <tr><td style={{ color: SA.muted }}>No points yet</td></tr>}
        </tbody>
      </table>
      {hollowness(row) !== 'solid' && <div style={{ marginTop: 4, color: SA.muted }}>{hollowness(row) === 'hollow' ? 'Not researched yet' : 'Research older than 60 days'}</div>}
      {pinned && children && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}
// Click = select (a double-click's second click never toggles), double-click = open; Enter / Space select, then open
// when already selected; "o" opens.
export const markHandlers = (r, selected, onSelect, onOpen) => ({
  onClick: e => { if (e.detail > 1) return; onSelect && onSelect(r); },
  onDoubleClick: () => onOpen && onOpen(r),
  onKeyDown: e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (selected && onOpen) onOpen(r); else if (onSelect) onSelect(r); }
    else if (e.key === 'o' || e.key === 'O') { e.preventDefault(); onOpen && onOpen(r); }
  },
});

export default function DotsChart({ rows, lit, y = 'intent', thresholds, caps, counts = {}, selectedKey, onSelect, onOpen, menu = null, showTrend = false, width = 960, anchors = {}, names = 'on', phone = false }) {
  const [hover, setHover] = useState(null);
  const n = rows.length;
  const W = Math.max(320, width), plotW = W - M.l - M.r, plotH = CHART_H - M.t - M.b;
  const scale = yScale(y, rows);
  const slot = n ? plotW / n : plotW;
  const base = Math.max(4, Math.min(9, slot * 0.3));
  const cx = i => M.l + slot * (i + 0.5);
  const cy = v => M.t + plotH * (1 - scale.to(v));
  const pts = rows.map((r, i) => ({ r, x: cx(i), y: cy(yValue(r, y)), unknown: yValue(r, y) == null }));
  const guides = y === 'intent' && thresholds ? [['P1', thresholds.P1], ['P2', thresholds.P2], ['P3', thresholds.P3]] : [];
  const litList = [...lit];
  const byKey = new Map(pts.map(p => [p.r.key, p]));
  const maxChars = Math.max(LABEL_MIN_CHARS, Math.min(24, Math.floor((slot * 3) / 6.3)));
  const scoreY = p => p.y - (base + (haloLevel(p.r) ? 20 : 8));
  const obstacles = pts.flatMap((p, i) => [{ x0: p.x - base - 2, x1: p.x + base + 2, y0: p.y - base - 2, y1: p.y + base + 2 }, ...(i < TOP_LABELS ? [{ x0: p.x - 8, x1: p.x + 8, y0: scoreY(p) - 10, y1: scoreY(p) + 2 }] : [])]);
  const labels = placeLabels(
    labelCandidates(rows, { mode: names, selectedKey, phone, y }).map(r => { const p = byKey.get(r.key); return { key: r.key, text: labelText(r.name, maxChars), x: p.x, y: p.y, pad: base + 7 }; }),
    { minX: M.l, maxX: W - M.r, minY: M.t - 12, maxY: CHART_H - M.b + 12, obstacles },
  );
  const pinned = pts.find(p => p.r.key === selectedKey) || null;
  return (
    <div data-dots-chart style={{ position: 'relative', width: '100%' }}>
      <svg width="100%" height={CHART_H} viewBox={`0 0 ${W} ${CHART_H}`} role="group" aria-label={`Companies ranked by intent, Y axis ${scale.label}`} style={{ display: 'block', overflow: 'visible', fontFamily: 'inherit' }}>
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
        {y === 'intent' && <text x={W - M.r + 8} y={cy(0) + 4} fontSize={11} fill={SA.muted} style={numStyle}>P4 · {counts.P4 ?? 0}</text>}
        <line x1={M.l} x2={W - M.r} y1={M.t + plotH} y2={M.t + plotH} stroke={SA.borderStrong} strokeWidth={1} />
        {litList.map(s => pts.filter(p => p.r.source_label === s).map(p => (
          <line key={`${s}-${p.r.key}`} data-thread={s} x1={anchors[s] ?? M.l} y1={0} x2={p.x} y2={p.y} stroke={sourceColor(s)} strokeWidth={1} opacity={0.18} style={{ transition: 'x2 400ms, y2 400ms' }} />
        )))}
        {n > 1 && <polyline data-rank-line points={pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} fill="none" stroke={SA.track} strokeWidth={1} />}
        {pts.map((p, i) => {
          const r = p.r, color = sourceColor(r.source_label), dim = isDimmed(r, lit), hollow = hollowness(r), halo = haloLevel(r), selected = r.key === selectedKey;
          const rings = hollow === 'hollow' ? [] : ringSpecs(r.components, caps, { base });
          return (
            <g key={r.key} data-dot={r.key} data-source={r.source_label} data-dimmed={dim ? 'true' : undefined} data-hollow={hollow} data-halo={halo || undefined} data-selected={selected ? 'true' : undefined}
              role="button" tabIndex={0} aria-label={rowLabel(r, SOURCE_LABELS)} aria-pressed={selected}
              {...markHandlers(r, selected, onSelect, onOpen)}
              onMouseEnter={() => setHover({ row: r, x: p.x, y: p.y })} onMouseLeave={() => setHover(null)} onFocus={() => setHover({ row: r, x: p.x, y: p.y })} onBlur={() => setHover(null)}
              style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition: 'transform 400ms ease, opacity 200ms', opacity: dim ? 0.4 : 1, cursor: 'pointer', outline: 'none' }}>
              {halo && <circle r={base + 16} fill="none" stroke={SA.text} strokeWidth={halo === 'bright' ? 2 : 1} opacity={halo === 'bright' ? 0.85 : 0.3} data-halo-ring />}
              {rings.map(rg => <circle key={rg.key} data-ring={rg.key} r={rg.r} fill="none" stroke={color} strokeWidth={1.5} opacity={hollow === 'decayed' ? 0.12 : 0.24} />)}
              <circle r={base + 1.5} fill={SA.inset} />
              {hollow === 'hollow'
                ? <circle data-core r={base} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray={p.unknown ? '2 2' : undefined} />
                : <circle data-core r={base} fill={color} opacity={hollow === 'decayed' ? 0.5 : 1} stroke={p.unknown ? color : 'none'} strokeDasharray={p.unknown ? '2 2' : undefined} />}
              {selected && <circle r={base + 5} fill="none" stroke={SA.accent} strokeWidth={2} data-selection-ring />}
              {i < TOP_LABELS && <text y={-(base + (halo ? 20 : 8))} textAnchor="middle" fontSize={11} fontWeight={600} fill={SA.text} style={numStyle} data-direct-label>{r.score}</text>}
              {showTrend && r.band_changed && r.trend && r.trend !== 'flat' && <text y={base + 14} textAnchor="middle" fontSize={10} fill={r.trend === 'up' ? SA.good : SA.bad} data-trend={r.trend}>{r.trend === 'up' ? '▲' : '▼'}</text>}
              <circle r={Math.max(12, base + 6)} fill="transparent" />
            </g>
          );
        })}
        <g data-name-labels aria-hidden="true" style={{ pointerEvents: 'none' }}>
          {labels.map(l => <text key={l.key} data-name-label={l.key} x={0} y={0} textAnchor={l.anchor} dominantBaseline="central" fontSize={11} fontWeight={500} fill={SA.text} style={{ transform: `translate(${l.x}px, ${l.y}px)`, transition: 'transform 400ms ease', paintOrder: 'stroke', stroke: SA.inset, strokeWidth: 3, strokeLinejoin: 'round' }}>{l.text}</text>)}
        </g>
        {!n && <text x={W / 2} y={CHART_H / 2} textAnchor="middle" fontSize={13} fill={SA.muted}>No companies under these filters</text>}
      </svg>
      {names === 'all' && n > 0 && <div data-names-count style={{ fontSize: 11, color: SA.muted, padding: '0 0 0 44px' }}>{labels.length} of {n} named - see Table for all</div>}
      <div aria-hidden="true" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: SA.muted, padding: '0 0 0 44px' }}>
        <span>Rank 1 → {n}</span>
        <span>Rings: {ringKey} · outer ring = touched (bright ≤ 7 d, faint ≤ 30 d) · hollow = not researched</span>
      </div>
      {hover && !pinned && <Tooltip row={hover.row} x={hover.x} y={hover.y} metric={y} />}
      {pinned && <Tooltip row={pinned.r} x={pinned.x} y={pinned.y} metric={y} pinned place={cardPlace({ x: pinned.x, y: pinned.y, W, pad: base + 14 })} onOpenName={() => onOpen && onOpen(pinned.r)}>{menu}</Tooltip>}
    </div>
  );
}
