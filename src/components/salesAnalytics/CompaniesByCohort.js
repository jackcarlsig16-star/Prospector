import { SA, SA_TYPE } from './theme';
import { COHORTS } from './metrics.registry';
import { formatValue } from './computeMetric';
import { cohortColor, PARTNER_COLOR } from './palette';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';

// dashboard-v2 Stage 3 - stacked when a Partner company exists: each
// cohort bar splits into Direct (the cohort's own hue) and Partner (the
// one reserved Partner hue). Computed at READ time from GET
// /cohort-breakdown (Stage 2's route, itself computed from the latest
// accounts snapshot + current tags) - NOT from sales_metrics_daily's
// companies_in_cadence rows, which are Partner-blind (written at sync
// time, before any tag existed). This is what makes toggling a
// sequence's Partner status show up here the moment the breakdown is
// re-fetched, with no new sync required.
//
// design-v1 Stage 3 - plain single-color bars with no legend when there's
// no Partner company at all (the SPEC's fix for the old legend/bar-color
// mismatch bug: the legend's "Direct" swatch used to be a flat gray while
// the bar itself used the cohort's own hue for Direct - they never
// matched). The legend only appears, stacked-bar-accurate, once a real
// Partner exists to legend.
export default function CompaniesByCohort({ cohortBreakdown, widgetId = 'companies_by_cohort' }) {
  const rows = COHORTS
    .map(cohort => {
      const b = cohortBreakdown?.[cohort] || { direct: 0, partner: 0 };
      return { cohort, direct: b.direct, partner: b.partner, total: b.direct + b.partner };
    })
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total);

  if (!rows.length) {
    return (
      <p style={{ ...SA_TYPE.body, fontSize: 12, color: SA.muted, padding: '12px 0' }}>
        Collecting history — weekly changes appear after the first full week of daily syncs.
      </p>
    );
  }

  const hasAnyPartner = rows.some(r => r.partner > 0);
  const max = Math.max(...rows.map(r => r.total));

  const handleExport = () => {
    exportWidgetCsv(widgetId, rows, [
      { label: 'Cohort', key: 'cohort' },
      { label: 'Direct', value: r => formatValue(r.direct, 'number') },
      { label: 'Partner', value: r => formatValue(r.partner, 'number') },
      { label: 'Total', value: r => formatValue(r.total, 'number') },
    ]);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        {hasAnyPartner ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: SA.muted, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: SA.muted }}>Direct</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: PARTNER_COLOR, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: SA.muted }}>Partner</span>
            </span>
          </div>
        ) : <span />}
        <ExportButton onClick={handleExport} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(r => {
          const directPct = (r.direct / max) * 100;
          const partnerPct = (r.partner / max) * 100;
          return (
            <div key={r.cohort} style={{ display: 'grid', gridTemplateColumns: '100px minmax(0, 1fr) 40px', gap: 12, alignItems: 'center', fontSize: 13 }}>
              <span style={{ color: SA.muted }}>{r.cohort}</span>
              <span style={{ height: 8, background: SA.ground, borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                {hasAnyPartner ? (
                  <>
                    <span title={`Direct: ${r.direct}`} style={{ width: `${directPct}%`, height: '100%', background: cohortColor(r.cohort) }} />
                    <span title={`Partner: ${r.partner}`} style={{ width: `${partnerPct}%`, height: '100%', background: PARTNER_COLOR }} />
                  </>
                ) : (
                  <span style={{ width: `${directPct}%`, height: '100%', background: cohortColor(r.cohort) }} />
                )}
              </span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: SA.text }}>{formatValue(r.total, 'number')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
