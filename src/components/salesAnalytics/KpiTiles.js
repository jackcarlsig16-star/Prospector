import { SA, SA_TYPE } from './theme';
import { getMetric } from './metrics.registry';
import { rowsFor, snapshotDelta, lastValue, ratio, bounceDenominatorRate, formatValue, weeklySeries } from './computeMetric';
import { bounceHealthColor } from './palette';
import { laWeekStart } from './periods';
import LineChart from './LineChart';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';

// SPEC default (also the Target Organizations default in the not-yet-built
// sales-analytics-scorecard-v1) - REVISABLE until that SPEC's targets
// table ships and this reads a real stored value instead.
const COMPANIES_TARGET = 200;

function aggregateFor(metric, rows) {
  return metric.aggregate === 'snapshot_delta' ? snapshotDelta(rows) : lastValue(rows);
}

// Bypasses metrics.registry's bounce_rate ratioOf (bounced/delivered) on
// purpose - that's the pre-dashboard-v2 formula. Every other bounce % in
// this feature (leaderboard, donuts, CSV, PDF) uses bounceDenominatorRate
// (bounced/(delivered+bounced), confirmed to match Apollo's own
// bounce_rate field - audit F8); this tile stays consistent with that
// instead of silently reintroducing the inflated one. Not touching the
// registry's ratioOf value here - that's a computation fix, out of scope
// for a visual-only SPEC.
function bounceRateFor(rows) {
  const delivered = rowsFor(rows, 'unique_delivered');
  const bounced = rowsFor(rows, 'unique_bounced');
  return bounceDenominatorRate(bounced, delivered, bounced, snapshotDelta);
}

function replyRateFor(rows) {
  return ratio(rowsFor(rows, 'unique_replied'), rowsFor(rows, 'unique_delivered'), snapshotDelta);
}

function ProgressBar({ pct }) {
  return (
    <div style={{ height: 4, borderRadius: 2, background: SA.border, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: 4, background: SA.accent }} />
    </div>
  );
}

// Collecting-history state (fewer than 2 synced days means snapshot_delta/
// ratio metrics can't compute yet - computeMetric.js's own documented
// behavior) renders the tile slot with an honest note instead of hiding
// it. All 5 mockup tiles always keep their slot, matching the DECIDED
// layout ("KPI row: 5 tiles") and this SPEC's own "empty states are short
// and human" rule - the same wording EmailTrendChart already uses below.
function Tile({ label, value, scope, delta, deltaGood, color, sparkPoints, accent, collecting, progressPct }) {
  return (
    <div style={{ flex: '1 1 200px', minWidth: 180, padding: '20px 20px 18px', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ ...SA_TYPE.label, color: SA.muted }}>{label}</div>
      {collecting ? (
        <>
          <div style={{ ...SA_TYPE.kpiValue, color: SA.faint, lineHeight: 1 }}>—</div>
          <div style={{ fontSize: 12, color: SA.faint }}>Collecting history — appears after 2+ daily syncs</div>
        </>
      ) : (
        <>
          <div style={{ ...SA_TYPE.kpiValue, color: color || SA.text, lineHeight: 1 }}>{value}</div>
          {progressPct !== undefined && <ProgressBar pct={progressPct} />}
          {sparkPoints && sparkPoints.length >= 2 && <LineChart points={sparkPoints} width={140} height={24} color={accent} strokeWidth={1.25} />}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: SA.muted }}>
            <span>{scope}</span>
            <span style={{ color: delta === null ? SA.faint : (deltaGood ? SA.good : SA.bad) }}>
              {delta === null ? 'WoW —' : `${delta >= 0 ? '▲' : '▼'} ${formatValue(Math.abs(delta), 'number')}`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// design-v1 - the mockup's 5-tile set (Companies w/ target progress,
// Prospects, Delivered, Reply rate, Bounce rate status-colored), replacing
// the previous 6-tile set (which showed Active Sequences/Opened/Replied
// instead of the two rate tiles). All 5 metrics already exist in
// metrics.registry.js - this is a display-selection change, not new data.
export default function KpiTiles({ allRows, periodRows, prevPeriodRows, compareEnabled, accent = SA.accent, widgetId = 'kpi_tiles' }) {
  const companiesMetric = getMetric('companies_in_cadence');
  const prospectsMetric = getMetric('prospects_in_cadence');
  const deliveredMetric = getMetric('unique_delivered');
  const sequencesActiveMetric = getMetric('sequences_active');

  const companies = aggregateFor(companiesMetric, rowsFor(periodRows, 'companies_in_cadence'));
  const prospects = aggregateFor(prospectsMetric, rowsFor(periodRows, 'prospects_in_cadence'));
  const delivered = aggregateFor(deliveredMetric, rowsFor(periodRows, 'unique_delivered'));
  const activeSequences = aggregateFor(sequencesActiveMetric, rowsFor(periodRows, 'sequences_active'));
  const replyRate = replyRateFor(periodRows);
  const bounceRate = bounceRateFor(periodRows);

  const deltaFor = (metricOrFn, rows, isRateFn) => {
    if (!compareEnabled) return null;
    const prevVal = isRateFn ? isRateFn(prevPeriodRows) : aggregateFor(metricOrFn, rowsFor(prevPeriodRows, metricOrFn.key));
    const curVal = isRateFn ? isRateFn(periodRows) : aggregateFor(metricOrFn, rows);
    if (prevVal === null || curVal === null) return null;
    return curVal - prevVal;
  };

  const sparkFor = key => weeklySeries(rowsFor(allRows, key), getMetric(key).aggregate, laWeekStart);

  const companiesDelta = deltaFor(companiesMetric, rowsFor(periodRows, 'companies_in_cadence'));
  const prospectsDelta = deltaFor(prospectsMetric, rowsFor(periodRows, 'prospects_in_cadence'));
  const deliveredDelta = deltaFor(deliveredMetric, rowsFor(periodRows, 'unique_delivered'));
  const replyRateDelta = deltaFor(null, null, replyRateFor);
  const bounceRateDelta = deltaFor(null, null, bounceRateFor);

  const handleExport = () => {
    exportWidgetCsv(widgetId, [
      { label: 'Companies in Cadence', value: companies, delta: companiesDelta, format: 'number' },
      { label: 'Prospects in Cadence', value: prospects, delta: prospectsDelta, format: 'number' },
      { label: 'Delivered', value: delivered, delta: deliveredDelta, format: 'number' },
      { label: 'Reply Rate', value: replyRate, delta: replyRateDelta, format: 'percent' },
      { label: 'Bounce Rate', value: bounceRate, delta: bounceRateDelta, format: 'percent' },
    ], [
      { label: 'Metric', value: r => r.label },
      { label: 'Value', value: r => formatValue(r.value, r.format) },
      { label: 'Delta', value: r => (r.delta === null ? '' : formatValue(r.delta, r.format)) },
    ]);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <ExportButton onClick={handleExport} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <Tile
          label="Companies in cadence" collecting={companies === null}
          value={formatValue(companies, 'number')} scope={`of ${COMPANIES_TARGET} target`}
          progressPct={companies === null ? undefined : (companies / COMPANIES_TARGET) * 100}
          delta={companiesDelta} deltaGood={companiesDelta !== null && companiesDelta >= 0}
        />
        <Tile
          label="Prospects in cadence" collecting={prospects === null}
          value={formatValue(prospects, 'number')}
          scope={activeSequences !== null ? `across ${formatValue(activeSequences, 'number')} active sequences` : 'active sequences'}
          delta={prospectsDelta} deltaGood={prospectsDelta !== null && prospectsDelta >= 0}
          sparkPoints={sparkFor('prospects_in_cadence')} accent={accent}
        />
        <Tile
          label="Delivered" collecting={delivered === null}
          value={formatValue(delivered, 'number')} scope="active sequences · all-time"
          delta={deliveredDelta} deltaGood={deliveredDelta !== null && deliveredDelta >= 0}
          sparkPoints={sparkFor('unique_delivered')} accent={accent}
        />
        <Tile
          label="Reply rate" collecting={replyRate === null}
          value={formatValue(replyRate, 'percent')} scope="active sequences · all-time"
          delta={replyRateDelta} deltaGood={replyRateDelta !== null && replyRateDelta >= 0}
        />
        <Tile
          label="Bounce rate" collecting={bounceRate === null}
          value={formatValue(bounceRate, 'percent')} scope="goal under 2%"
          color={bounceRate === null ? undefined : bounceHealthColor(bounceRate)}
          delta={bounceRateDelta} deltaGood={bounceRateDelta !== null && bounceRateDelta <= 0}
        />
      </div>
    </div>
  );
}
