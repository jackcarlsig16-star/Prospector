import { C, mono } from '../../constants/colors';
import { COHORTS } from './metrics.registry';
import { rowsFor, lastValue, formatValue } from './computeMetric';

// companies_in_cadence is a point-in-time gauge (aggregate: 'last'), not a
// period total - a company is either in cadence right now or it isn't.
// Hand-rolled CSS bars (A4b: no chart library) rather than inline SVG -
// a plain width-percentage bar is just as "hand-rolled" as SVG for a
// simple horizontal comparison and needs no extra rendering code.
export default function CompaniesByCohort({ allRows, accent = C.gold }) {
  const rows = COHORTS
    .map(cohort => ({ cohort, value: lastValue(rowsFor(allRows, 'companies_in_cadence', 'cohort', cohort)) }))
    .filter(r => r.value !== null && r.value > 0)
    .sort((a, b) => b.value - a.value);

  if (!rows.length) {
    return (
      <p style={{ ...mono, fontSize: 12, color: C.dim, padding: '12px 0' }}>
        Collecting history — weekly changes appear after the first full week of daily syncs.
      </p>
    );
  }

  const max = Math.max(...rows.map(r => r.value));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(r => (
        <div key={r.cohort} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ ...mono, fontSize: 11, color: C.mut, width: 90, flexShrink: 0 }}>{r.cohort}</span>
          <div style={{ flex: 1, height: 14, background: C.bg, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: accent, borderRadius: 3 }} />
          </div>
          <span style={{ ...mono, fontSize: 12, color: C.txt, width: 36, textAlign: 'right', flexShrink: 0 }}>{formatValue(r.value, 'number')}</span>
        </div>
      ))}
    </div>
  );
}
