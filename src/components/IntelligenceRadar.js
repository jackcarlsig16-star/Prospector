import { useState, useMemo } from 'react';
import { T } from '../constants/tokens';
import { mono } from '../constants/colors';
import { scoreAccount, extractDomain } from '../utils/radarScoring';

const AXIS_ORDER = ['need', 'authority', 'budget', 'urgency', 'engagement', 'relationship'];
const AXIS_LABEL = {
  need:         'Need',
  authority:    'Authority',
  budget:       'Budget',
  urgency:      'Urgency',
  engagement:   'Engagement',
  relationship: 'Relationship',
};
const AXIS_HINT = {
  authority:    'MEDPICC: Economic Buyer or Champion',
  budget:       'ACV, products attached, or MEDPICC Metrics',
  urgency:      'Stage, timeline, or MEDPICC Decision Process',
  need:         'MEDPICC Identify Pain or call painPoints',
  engagement:   'Recent touch, Gmail thread, or call activity',
  relationship: 'Log calls, identify personas, or champion',
};

const readFrontier = () => {
  try { return JSON.parse(localStorage.getItem('prospector_frontier') || '[]'); } catch { return []; }
};
const readThreadCache = () => {
  try { return JSON.parse(localStorage.getItem('prospector_threads_cache') || '{}'); } catch { return {}; }
};

export default function IntelligenceRadar({ acc, size = 'compact' }) {
  const frontierEntry = useMemo(() => {
    if (!acc) return null;
    const frontier = readFrontier();
    return frontier.find(f =>
      f?.outbound?.sourceAccountId === acc.id ||
      (f?.name && acc?.name && f.name.toLowerCase() === acc.name.toLowerCase())
    ) || null;
  }, [acc]);

  const threadCache = useMemo(readThreadCache, [acc?.id]);
  const { axes, overall } = useMemo(
    () => scoreAccount(acc, frontierEntry, threadCache),
    [acc, frontierEntry, threadCache]
  );
  const [expandedAxis, setExpandedAxis] = useState(null);

  if (!acc) return null;

  const isFull = size === 'full';
  const isPresetCompact = size === 'compact';
  const isNumeric = typeof size === 'number';

  // viewBox dims per spec: full ≥ 380x360, compact = 280x260; numeric scales from compact aspect
  const SVG_W = isFull ? 500 : isPresetCompact ? 280 : size;
  const SVG_H = isFull ? 460 : isPresetCompact ? 260 : Math.round(size * 260 / 280);

  const cx = SVG_W / 2;
  const cy = SVG_H / 2;
  // 40px clearance from viewBox edges for the outer ring
  const R = Math.min(SVG_W, SVG_H) / 2 - 40;

  const axisAngle = i => -Math.PI / 2 + i * (Math.PI / 3);
  const RING_VALUES = [20, 40, 60, 80, 100];

  const scoreFont = isFull ? 12 : 10;
  const nameFont  = isFull ? 13 : 11;
  const overallFont = isFull ? 28 : isPresetCompact ? 20 : 16;

  const polygonPoints = AXIS_ORDER.map((key, i) => {
    const a = axisAngle(i);
    const score = axes[key]?.score || 0;
    const r = (score / 100) * R;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });

  const confTally = { scored: 0, partial: 0, empty: 0 };
  AXIS_ORDER.forEach(k => { confTally[axes[k]?.confidence || 'empty']++; });
  const allEmpty = confTally.empty === 6;
  const mostlyPartial = confTally.scored < 3 && !allEmpty;
  const strokeDasharray = allEmpty ? '4 4' : 'none';
  const fillOpacity = allEmpty ? 0 : (mostlyPartial ? 0.15 : 0.30);

  const fillColor = T.neon;
  const ringColor = '#1a2a1a';
  const axisColor = '#2a3a2a';
  const labelColor = '#7a8a7a';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ overflow: 'visible' }}>
        {RING_VALUES.map(v => {
          const r = (v / 100) * R;
          const pts = AXIS_ORDER.map((_, i) => {
            const a = axisAngle(i);
            return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
          }).join(' ');
          return <polygon key={v} points={pts} fill="none" stroke={ringColor} strokeWidth={1} />;
        })}

        {AXIS_ORDER.map((_, i) => {
          const a = axisAngle(i);
          return (
            <line
              key={i}
              x1={cx} y1={cy}
              x2={cx + Math.cos(a) * R} y2={cy + Math.sin(a) * R}
              stroke={axisColor} strokeWidth={1}
            />
          );
        })}

        <polygon
          points={polygonPoints.map(p => p.join(',')).join(' ')}
          fill={fillColor}
          fillOpacity={fillOpacity}
          stroke={fillColor}
          strokeWidth={2}
          strokeDasharray={strokeDasharray}
        />

        {polygonPoints.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={3} fill={fillColor} />
        ))}

        {AXIS_ORDER.map((k, i) => {
          const a = axisAngle(i);
          const cosA = Math.cos(a);
          const sinA = Math.sin(a);
          const anchor = Math.abs(cosA) < 0.1 ? 'middle' : (cosA > 0 ? 'start' : 'end');
          const sx = cx + cosA * (R + 14);
          const sy = cy + sinA * (R + 14);
          const nx = cx + cosA * (R + 26);
          const ny = cy + sinA * (R + 26);
          return (
            <g key={k}>
              <text
                x={sx} y={sy}
                fill={T.neon}
                fontSize={scoreFont}
                fontFamily="ui-monospace,monospace"
                textAnchor={anchor}
                dominantBaseline="middle"
              >
                {axes[k]?.score}
              </text>
              <text
                x={nx} y={ny}
                fill={labelColor}
                fontSize={nameFont}
                fontFamily="ui-monospace,monospace"
                textAnchor={anchor}
                dominantBaseline="middle"
              >
                {AXIS_LABEL[k]}
              </text>
            </g>
          );
        })}

        <text
          x={cx} y={cy}
          fill={T.neon}
          fontSize={overallFont}
          fontWeight={600}
          fontFamily="ui-monospace,monospace"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {overall}
        </text>
      </svg>

      {isFull && (
        <div style={{ width: SVG_W, marginTop: 6 }}>
          {AXIS_ORDER.map(k => {
            const ax = axes[k] || { score: 0, confidence: 'empty', signals: [] };
            const isOpen = expandedAxis === k;
            const confColor =
              ax.confidence === 'scored'  ? T.neon  :
              ax.confidence === 'partial' ? T.amber :
              '#555';
            const domain = extractDomain(acc);
            return (
              <div key={k} style={{ borderTop: '1px solid #1a2a1a' }}>
                <div
                  onClick={() => setExpandedAxis(isOpen ? null : k)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', cursor: 'pointer' }}
                >
                  <span style={{ ...mono, fontSize: 12, color: '#c8d8c8', minWidth: 110 }}>{AXIS_LABEL[k]}</span>
                  <span style={{ ...mono, fontSize: 12, color: T.neon, minWidth: 36 }}>{ax.score}</span>
                  <span style={{ ...mono, fontSize: 10, color: confColor, textTransform: 'uppercase', letterSpacing: '0.06em', minWidth: 60 }}>
                    {ax.confidence}
                  </span>
                  <span style={{ ...mono, fontSize: 11, color: '#8a9a8a', marginLeft: 'auto' }}>{isOpen ? '▾' : '▸'}</span>
                </div>
                {isOpen && (
                  <div style={{ padding: '0 12px 10px 122px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {ax.signals.length ? (
                      ax.signals.map((s, i) => (
                        <span key={i} style={{ ...mono, fontSize: 10, padding: '2px 7px', background: `${T.neon}18`, border: `1px solid ${T.neon}44`, color: T.neon, borderRadius: 3 }}>
                          {s}
                        </span>
                      ))
                    ) : (
                      <span style={{ ...mono, fontSize: 11, color: '#7a8a7a', fontStyle: 'italic' }}>
                        No data — fill in {AXIS_HINT[k]}{k === 'engagement' && !domain ? ' (acc.web missing)' : ''}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
