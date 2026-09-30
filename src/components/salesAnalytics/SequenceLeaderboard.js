import { C, mono } from '../../constants/colors';
import { COHORTS } from './metrics.registry';
import { rowsFor, snapshotDelta, formatValue } from './computeMetric';

const BOUNCE_FLAG_THRESHOLD = 0.03; // PROPOSED value (SPEC)

// Grouped by cohort, using the dim_type='cohort' rollup rows Stage 2
// already computes server-side. NOT a true per-sequence ranked list - the
// metrics API (Stage 2) only exposes dim_value=<sequence id> (an opaque
// Apollo id) at the per-sequence level, with no name/cohort lookup route.
// A real per-sequence leaderboard needs a small new route reading the
// latest sales_raw_snapshots row for entity='sequences' (which does carry
// real names) - flagged in the Stage 3 report, not added here without
// sign-off.
export default function SequenceLeaderboard({ periodRows }) {
  const rows = COHORTS.map(cohort => {
    const delivered = snapshotDelta(rowsFor(periodRows, 'unique_delivered', 'cohort', cohort));
    const bounced = snapshotDelta(rowsFor(periodRows, 'unique_bounced', 'cohort', cohort));
    const opened = snapshotDelta(rowsFor(periodRows, 'unique_opened', 'cohort', cohort));
    const replied = snapshotDelta(rowsFor(periodRows, 'unique_replied', 'cohort', cohort));
    if (delivered === null) return null;
    const bounceRate = delivered > 0 && bounced !== null ? bounced / delivered : null;
    return { cohort, delivered, opened, replied, bounced, bounceRate };
  }).filter(Boolean).sort((a, b) => b.delivered - a.delivered);

  if (!rows.length) {
    return (
      <p style={{ ...mono, fontSize: 12, color: C.dim, padding: '12px 0' }}>
        Collecting history — weekly changes appear after the first full week of daily syncs.
      </p>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', ...mono, fontSize: 12 }}>
        <thead>
          <tr>
            {['Cohort', 'Delivered', 'Opened', 'Replied', 'Bounced', 'Bounce %'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: C.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.brd}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const flagged = r.bounceRate !== null && r.bounceRate > BOUNCE_FLAG_THRESHOLD;
            return (
              <tr key={r.cohort}>
                <td style={{ padding: '7px 10px', color: C.txt, borderBottom: `1px solid ${C.brd}` }}>{r.cohort}</td>
                <td style={{ padding: '7px 10px', color: C.txt, borderBottom: `1px solid ${C.brd}` }}>{formatValue(r.delivered, 'number')}</td>
                <td style={{ padding: '7px 10px', color: C.txt, borderBottom: `1px solid ${C.brd}` }}>{formatValue(r.opened, 'number')}</td>
                <td style={{ padding: '7px 10px', color: C.txt, borderBottom: `1px solid ${C.brd}` }}>{formatValue(r.replied, 'number')}</td>
                <td style={{ padding: '7px 10px', color: C.txt, borderBottom: `1px solid ${C.brd}` }}>{formatValue(r.bounced, 'number')}</td>
                <td style={{ padding: '7px 10px', color: flagged ? C.red : C.txt, borderBottom: `1px solid ${C.brd}` }}>
                  {formatValue(r.bounceRate, 'percent')} {flagged && '⚠'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
