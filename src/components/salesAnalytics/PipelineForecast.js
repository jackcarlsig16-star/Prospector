import { SA, SA_TYPE } from './theme';
import { effectiveProbability } from './pipelineStages';
import { formatValue } from './computeMetric';
import { laDateString } from './periods';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';

// sales-pipeline-v1 Stage 3 - computed entirely client-side from the
// already-fetched opportunities list (zero Apollo calls, no new endpoint
// needed - the SPEC's own Stage 2 route list doesn't include a forecast
// route, only list/create/update/archive/import/movement). Buckets:
// 0-30, 31-60, 61-90 days from today, by expected_close. "Weighted" =
// covered_lives x probability and est_value x probability (DECIDED).
const BUCKET_DEFS = [
  { label: '0–30 days', min: 0, max: 30 },
  { label: '31–60 days', min: 31, max: 60 },
  { label: '61–90 days', min: 61, max: 90 },
];

function daysFromToday(dateStr, today) {
  const a = new Date(today + 'T12:00:00Z').getTime();
  const b = new Date(dateStr + 'T12:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

export default function PipelineForecast({ opportunities, widgetId = 'pipeline_forecast' }) {
  const today = laDateString();
  const active = opportunities.filter(o => o.stage !== 'lost' && o.expected_close);

  const buckets = BUCKET_DEFS.map(def => {
    const rows = active.filter(o => {
      const days = daysFromToday(o.expected_close, today);
      return days >= def.min && days <= def.max;
    });
    const totals = rows.reduce((acc, o) => {
      const p = effectiveProbability(o);
      acc.count += 1;
      acc.coveredLives += o.covered_lives || 0;
      acc.weightedLives += (o.covered_lives || 0) * p;
      acc.weightedValue += (o.est_value || 0) * p;
      return acc;
    }, { count: 0, coveredLives: 0, weightedLives: 0, weightedValue: 0 });
    return { ...def, rows, totals };
  });

  const handleExport = () => {
    const flat = buckets.flatMap(b => b.rows.map(o => ({ bucket: b.label, ...o, weightedLives: (o.covered_lives || 0) * effectiveProbability(o), weightedValue: (o.est_value || 0) * effectiveProbability(o) })));
    exportWidgetCsv(widgetId, flat, [
      { label: 'Bucket', key: 'bucket' },
      { label: 'Organization', key: 'organization' },
      { label: 'Expected Close', key: 'expected_close' },
      { label: 'Covered Lives', value: r => formatValue(r.covered_lives, 'number') },
      { label: 'Probability', value: r => formatValue(effectiveProbability(r), 'percent') },
      { label: 'Weighted Lives', value: r => formatValue(Math.round(r.weightedLives), 'number') },
      { label: 'Weighted Value', value: r => formatValue(Math.round(r.weightedValue), 'number') },
    ]);
  };

  return (
    <div>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <ExportButton onClick={handleExport} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
      {buckets.map(b => (
        <div key={b.label} style={{ padding: '14px 16px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 10 }}>
          <div style={{ ...SA_TYPE.label, fontSize: 10, color: SA.muted, marginBottom: 8 }}>{b.label}</div>
          <div style={{ ...SA_TYPE.body, fontSize: 24, fontWeight: 600, color: SA.text, fontVariantNumeric: 'tabular-nums', marginBottom: 6 }}>{b.totals.count}</div>
          <div style={{ fontSize: 12, color: SA.muted, marginBottom: 2 }}>{formatValue(b.totals.coveredLives, 'number')} covered lives</div>
          <div style={{ fontSize: 12, color: SA.muted, marginBottom: 2 }}>{formatValue(Math.round(b.totals.weightedLives), 'number')} weighted lives</div>
          <div style={{ fontSize: 12, color: SA.muted, marginBottom: 10 }}>${formatValue(Math.round(b.totals.weightedValue), 'number')} weighted value</div>
          {b.rows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, borderTop: `1px solid ${SA.border}`, paddingTop: 8 }}>
              {b.rows.map(o => (
                <div key={o.id} style={{ fontSize: 11, color: SA.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.organization}>{o.organization}</div>
              ))}
            </div>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}
