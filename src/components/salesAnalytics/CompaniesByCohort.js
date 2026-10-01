import { C, mono } from '../../constants/colors';
import { COHORTS } from './metrics.registry';
import { formatValue } from './computeMetric';
import { cohortColor, PARTNER_COLOR } from './palette';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';

// dashboard-v2 Stage 3 - now stacked: each cohort bar splits into Direct
// (the cohort's own hue) and Partner (the one reserved Partner hue).
// Computed at READ time from GET /cohort-breakdown (Stage 2's route,
// itself computed from the latest accounts snapshot + current tags) - NOT
// from sales_metrics_daily's companies_in_cadence rows, which are
// Partner-blind (written at sync time, before any tag existed). This is
// what makes toggling a sequence's Partner status show up here the moment
// the breakdown is re-fetched, with no new sync required.
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
      <p style={{ ...mono, fontSize: 12, color: C.dim, padding: '12px 0' }}>
        Collecting history — weekly changes appear after the first full week of daily syncs.
      </p>
    );
  }

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: C.mut, flexShrink: 0 }} />
            <span style={{ ...mono, fontSize: 10, color: C.dim }}>Direct</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: PARTNER_COLOR, flexShrink: 0 }} />
            <span style={{ ...mono, fontSize: 10, color: C.dim }}>Partner</span>
          </span>
        </div>
        <ExportButton onClick={handleExport} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => {
          const directPct = (r.direct / max) * 100;
          const partnerPct = (r.partner / max) * 100;
          return (
            <div key={r.cohort} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ ...mono, fontSize: 11, color: C.mut, width: 90, flexShrink: 0 }}>{r.cohort}</span>
              <div style={{ flex: 1, height: 14, background: C.bg, borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                <div
                  title={`Direct: ${r.direct}`}
                  style={{ width: `${directPct}%`, height: '100%', background: cohortColor(r.cohort) }}
                />
                <div
                  title={`Partner: ${r.partner}`}
                  style={{ width: `${partnerPct}%`, height: '100%', background: PARTNER_COLOR }}
                />
              </div>
              <span style={{ ...mono, fontSize: 12, color: C.txt, width: 36, textAlign: 'right', flexShrink: 0 }}>{formatValue(r.total, 'number')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
