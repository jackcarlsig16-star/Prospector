import { C, mono } from '../../constants/colors';
import { getMetric } from './metrics.registry';
import { rowsFor, snapshotDelta, lastValue, formatValue, weeklySeries } from './computeMetric';
import { laWeekStart } from './periods';
import LineChart from './LineChart';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';

const TILE_KEYS = [
  'companies_in_cadence', 'prospects_in_cadence', 'sequences_active',
  'unique_delivered', 'unique_opened', 'unique_replied',
];

function aggregateFor(metric, rows) {
  return metric.aggregate === 'snapshot_delta' ? snapshotDelta(rows) : lastValue(rows);
}

// Visual pattern mirrored from BusinessIntelKpiStrip.js (A4e) - card with
// an accent top border, mono uppercase label, same padding/radius.
export default function KpiTiles({ allRows, periodRows, prevPeriodRows, compareEnabled, accent = C.gold, widgetId = 'kpi_tiles' }) {
  const tiles = TILE_KEYS.map(key => {
    const metric = getMetric(key);
    if (!metric) return null;
    const rows = rowsFor(periodRows, key);
    const value = aggregateFor(metric, rows);
    if (value === null) return null;

    let delta = null;
    if (compareEnabled) {
      const prevRows = rowsFor(prevPeriodRows, key);
      const prevValue = aggregateFor(metric, prevRows);
      if (prevValue !== null) delta = value - prevValue;
    }

    const sparkRows = rowsFor(allRows, key);
    const sparkPoints = weeklySeries(sparkRows, metric.aggregate, laWeekStart);

    return { metric, value, delta, sparkPoints };
  }).filter(Boolean);

  if (!tiles.length) {
    return (
      <p style={{ ...mono, fontSize: 12, color: C.dim, padding: '12px 0' }}>
        Collecting history — weekly changes appear after the first full week of daily syncs.
      </p>
    );
  }

  const handleExport = () => {
    exportWidgetCsv(widgetId, tiles, [
      { label: 'Metric', value: t => t.metric.label },
      { label: 'Value', value: t => formatValue(t.value, t.metric.format) },
      { label: 'Delta', value: t => (t.delta === null ? '' : formatValue(t.delta, t.metric.format)) },
    ]);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <ExportButton onClick={handleExport} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {tiles.map(({ metric, value, delta, sparkPoints }) => {
        const deltaGood = delta !== null && (metric.goodDirection === 'up' ? delta >= 0 : delta <= 0);
        return (
          <div key={metric.key} style={{ flex: '1 1 160px', minWidth: 150, padding: '12px 14px', background: C.card, border: `1px solid ${C.brd}`, borderTop: `2px solid ${accent}`, borderRadius: 8 }}>
            <p style={{ ...mono, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>{metric.label}</p>
            <p style={{ ...mono, fontSize: 22, fontWeight: 700, color: C.txt, margin: '0 0 4px' }}>{formatValue(value, metric.format)}</p>
            {delta !== null && (
              <p style={{ ...mono, fontSize: 11, color: deltaGood ? C.green : C.red, margin: '0 0 6px' }}>
                {delta >= 0 ? '▲' : '▼'} {formatValue(Math.abs(delta), metric.format)}
              </p>
            )}
            {sparkPoints.length >= 2 && (
              <LineChart points={sparkPoints} width={140} height={28} color={accent} strokeWidth={1.25} />
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
