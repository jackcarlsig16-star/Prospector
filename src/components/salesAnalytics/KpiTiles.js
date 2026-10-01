import { SA, SA_TYPE } from './theme';
import { getMetric } from './metrics.registry';
import { rowsFor, snapshotDelta, lastValue, formatValue, weeklySeries } from './computeMetric';
import { activeSequenceTotals } from './sequenceRows';
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

function ProgressBar({ pct }) {
  return (
    <div style={{ height: 4, borderRadius: 2, background: SA.border, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: 4, background: SA.accent }} />
    </div>
  );
}

// design-v1 FIX (Jack, post-Stage-1 review): the tile's own VALUE must
// show now, from the latest sync, independent of whether week-over-week
// history exists yet - only the WoW delta is allowed to say "collecting".
// `noValue` is reserved for the real "nothing from any source" case (per
// Jack's "if a tile truly has no value from any source, say so").
function Tile({ label, value, scope, delta, deltaGood, color, sparkPoints, accent, noValue, progressPct, compareEnabled }) {
  return (
    <div style={{ flex: '1 1 200px', minWidth: 180, padding: '20px 20px 18px', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ ...SA_TYPE.label, color: SA.muted }}>{label}</div>
      {noValue ? (
        <>
          <div style={{ ...SA_TYPE.kpiValue, color: SA.faint, lineHeight: 1 }}>—</div>
          <div style={{ fontSize: 12, color: SA.faint }}>No value from any source yet</div>
        </>
      ) : (
        <>
          <div style={{ ...SA_TYPE.kpiValue, color: color || SA.text, lineHeight: 1 }}>{value}</div>
          {progressPct !== undefined && <ProgressBar pct={progressPct} />}
          {sparkPoints && sparkPoints.length >= 2 && <LineChart points={sparkPoints} width={140} height={24} color={accent} strokeWidth={1.25} />}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: SA.muted }}>
            <span>{scope}</span>
            <span style={{ color: delta === null ? SA.faint : (deltaGood ? SA.good : SA.bad) }}>
              {delta === null ? (compareEnabled ? 'Collecting history' : 'WoW —') : `${delta >= 0 ? '▲' : '▼'} ${formatValue(Math.abs(delta), 'number')}`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// design-v1 - the mockup's 5-tile set (Companies w/ target progress,
// Prospects, Delivered, Reply rate, Bounce rate status-colored), replacing
// the previous 6-tile set. All 5 metrics already exist in
// metrics.registry.js - a display-selection change, not new data.
//
// Delivered/Reply rate/Bounce rate are "active sequences, all-time" (same
// scope and same numbers as the Sequence Leaderboard's default summary
// strip - 871/13.0%/0.5%/14.9%, audit-confirmed), computed via
// activeSequenceTotals(allRows, entities): the real current value from
// the latest sync, independent of the page's period selector or of how
// many distinct sync days exist. Only the WoW delta needs 2+ distinct
// sync days (one on each side of the period boundary) and says
// "Collecting history" until then - never the value itself (Jack's
// correction after Stage 1: a null tile value when real data already
// exists was the bug, not the WoW-collecting state, which is correct).
export default function KpiTiles({ allRows, periodRows, prevPeriod, entities, compareEnabled, accent = SA.accent, widgetId = 'kpi_tiles' }) {
  const companiesMetric = getMetric('companies_in_cadence');
  const prospectsMetric = getMetric('prospects_in_cadence');
  const sequencesActiveMetric = getMetric('sequences_active');

  const companies = aggregateFor(companiesMetric, rowsFor(periodRows, 'companies_in_cadence'));
  const prospects = aggregateFor(prospectsMetric, rowsFor(periodRows, 'prospects_in_cadence'));
  const activeSequences = aggregateFor(sequencesActiveMetric, rowsFor(periodRows, 'sequences_active'));

  const current = activeSequenceTotals(allRows, entities);
  // "As of" comparison: the same active-sequence totals, recomputed from
  // only the rows that existed by the end of the previous period - not a
  // period-bounded sum (these tiles are all-time), a point-in-time replay.
  // With under 2 distinct sync days this returns {delivered: null, ...},
  // so the delta comes back null and the tile shows "Collecting history" -
  // exactly the real state today, not a special case for it.
  const prevAsOfRows = prevPeriod ? allRows.filter(r => r.metric_date <= prevPeriod.to) : [];
  const previous = compareEnabled && prevPeriod ? activeSequenceTotals(prevAsOfRows, entities) : null;

  const deliveredDelta = previous && current.delivered !== null && previous.delivered !== null ? current.delivered - previous.delivered : null;
  const replyRateDelta = previous && current.replyRate !== null && previous.replyRate !== null ? current.replyRate - previous.replyRate : null;
  const bounceRateDelta = previous && current.bounceRate !== null && previous.bounceRate !== null ? current.bounceRate - previous.bounceRate : null;

  const deltaFor = (metric, rows) => {
    if (!compareEnabled) return null;
    const prevVal = aggregateFor(metric, rows);
    const curVal = aggregateFor(metric, rowsFor(periodRows, metric.key));
    if (prevVal === null || curVal === null) return null;
    return curVal - prevVal;
  };
  const prevPeriodRowsFor = key => (prevPeriod ? allRows.filter(r => r.metric_date >= prevPeriod.from && r.metric_date <= prevPeriod.to && r.metric_key === key) : []);

  const companiesDelta = deltaFor(companiesMetric, prevPeriodRowsFor('companies_in_cadence'));
  const prospectsDelta = deltaFor(prospectsMetric, prevPeriodRowsFor('prospects_in_cadence'));

  const sparkFor = key => weeklySeries(rowsFor(allRows, key), getMetric(key).aggregate, laWeekStart);

  const handleExport = () => {
    exportWidgetCsv(widgetId, [
      { label: 'Companies in Cadence', value: companies, delta: companiesDelta, format: 'number' },
      { label: 'Prospects in Cadence', value: prospects, delta: prospectsDelta, format: 'number' },
      { label: 'Delivered', value: current.delivered, delta: deliveredDelta, format: 'number' },
      { label: 'Reply Rate', value: current.replyRate, delta: replyRateDelta, format: 'percent' },
      { label: 'Bounce Rate', value: current.bounceRate, delta: bounceRateDelta, format: 'percent' },
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
      <div className="sa-kpi-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <Tile
          label="Companies in cadence" noValue={companies === null} compareEnabled={compareEnabled}
          value={formatValue(companies, 'number')} scope={`of ${COMPANIES_TARGET} target`}
          progressPct={companies === null ? undefined : (companies / COMPANIES_TARGET) * 100}
          delta={companiesDelta} deltaGood={companiesDelta !== null && companiesDelta >= 0}
        />
        <Tile
          label="Prospects in cadence" noValue={prospects === null} compareEnabled={compareEnabled}
          value={formatValue(prospects, 'number')}
          scope={activeSequences !== null ? `across ${formatValue(activeSequences, 'number')} active sequences` : 'active sequences'}
          delta={prospectsDelta} deltaGood={prospectsDelta !== null && prospectsDelta >= 0}
          sparkPoints={sparkFor('prospects_in_cadence')} accent={accent}
        />
        <Tile
          label="Delivered" noValue={current.delivered === null} compareEnabled={compareEnabled}
          value={formatValue(current.delivered, 'number')} scope="active sequences · all-time"
          delta={deliveredDelta} deltaGood={deliveredDelta !== null && deliveredDelta >= 0}
          sparkPoints={sparkFor('unique_delivered')} accent={accent}
        />
        <Tile
          label="Reply rate" noValue={current.replyRate === null} compareEnabled={compareEnabled}
          value={formatValue(current.replyRate, 'percent')} scope="active sequences · all-time"
          delta={replyRateDelta} deltaGood={replyRateDelta !== null && replyRateDelta >= 0}
        />
        <Tile
          label="Bounce rate" noValue={current.bounceRate === null} compareEnabled={compareEnabled}
          value={formatValue(current.bounceRate, 'percent')} scope="goal under 2%"
          color={current.bounceRate === null ? undefined : bounceHealthColor(current.bounceRate)}
          delta={bounceRateDelta} deltaGood={bounceRateDelta !== null && bounceRateDelta <= 0}
        />
      </div>
    </div>
  );
}
