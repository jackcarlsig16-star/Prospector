import { mono } from '../../constants/colors';
import { CARD } from './tokens';

const fmt = n => n.toLocaleString('en-US');

// assay-employee-count-metric-v1 — employeeCount is an extraction field, so
// absent means "no source stated one", not "zero" and not "small". The empty
// state says that in words rather than showing a dash a reader could mistake
// for a real low number.
export default function CompanyMetrics({ acc }) {
  const count = typeof acc?.employeeCount === 'number' ? acc.employeeCount : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ ...mono, fontSize: 9, fontWeight: 700, color: CARD.textMuted, textTransform: 'uppercase', letterSpacing: '0.09em' }}>
        Company Metrics
      </span>
      <span style={{ width: 1, height: 12, background: CARD.borderStrong }} />
      <span style={{ ...mono, fontSize: 10, color: CARD.textMuted }}>Employees</span>
      {count === null ? (
        <span style={{ ...mono, fontSize: 10, color: CARD.textMuted, fontStyle: 'italic' }}>not found</span>
      ) : (
        <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: CARD.textPrimary }}>{fmt(count)}</span>
      )}
    </div>
  );
}
