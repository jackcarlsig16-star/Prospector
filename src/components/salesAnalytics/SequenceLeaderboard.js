import { useState } from 'react';
import { C, mono } from '../../constants/colors';
import { rowsFor, lastValue, ratio, formatValue } from './computeMetric';

const BOUNCE_FLAG_THRESHOLD = 0.03; // existing PROPOSED value (SPEC)
const SORT_COLUMNS = [
  { key: 'name', label: 'Sequence' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'openRate', label: 'Open %' },
  { key: 'replyRate', label: 'Reply %' },
  { key: 'bounceRate', label: 'Bounce %' },
];

// sales-analytics-core-names-fix-v1 Part B - a true per-sequence leaderboard
// (was a cohort-level rollup, flagged as a gap at core-v1 Stage 3). Renders
// from the LATEST snapshot only (lastValue, not a period snapshot_delta) -
// per-sequence unique_* counters are already lifetime totals, so a single
// snapshot is a valid current view; "collecting history" no longer applies
// here (it still applies to the trend/delta widgets, which do need >=2
// days). entities.sequences comes from GET /entities (reads the latest raw
// snapshot server-side); allRows still comes from GET /metrics. A sequence
// id present in one but not the other (e.g. renamed/removed since the
// latest raw snapshot) is never hidden - shown as "Unknown (<last 6
// chars>)" per the FIX's explicit rule.
export default function SequenceLeaderboard({ allRows, entities }) {
  const [showInactive, setShowInactive] = useState(false);
  const [sortKey, setSortKey] = useState('delivered');
  const [sortDesc, setSortDesc] = useState(true);

  const entityById = new Map((entities?.sequences || []).map(s => [s.id, s]));
  const idsFromMetrics = new Set(
    allRows.filter(r => r.dim_type === 'sequence' && r.metric_key.startsWith('unique_')).map(r => r.dim_value)
  );
  const allIds = new Set([...entityById.keys(), ...idsFromMetrics]);

  const rows = [...allIds].map(id => {
    const entity = entityById.get(id);
    const name = entity ? entity.name : `Unknown (${id.slice(-6)})`;
    const cohort = entity ? (entity.cohort || 'Other') : 'Unknown';
    const active = entity ? entity.active : undefined;

    const deliveredRows = rowsFor(allRows, 'unique_delivered', 'sequence', id);
    const openedRows = rowsFor(allRows, 'unique_opened', 'sequence', id);
    const repliedRows = rowsFor(allRows, 'unique_replied', 'sequence', id);
    const bouncedRows = rowsFor(allRows, 'unique_bounced', 'sequence', id);

    const delivered = lastValue(deliveredRows);
    const openRate = ratio(openedRows, deliveredRows, lastValue);
    const replyRate = ratio(repliedRows, deliveredRows, lastValue);
    const bounceRate = ratio(bouncedRows, deliveredRows, lastValue);

    return { id, name, cohort, active, delivered, openRate, replyRate, bounceRate };
  }).filter(r => r.delivered !== null || r.active !== undefined); // drop pure ghosts (no data, no entity)

  const visible = rows.filter(r => showInactive || r.active !== false);

  const byCohort = new Map();
  for (const r of visible) {
    if (!byCohort.has(r.cohort)) byCohort.set(r.cohort, []);
    byCohort.get(r.cohort).push(r);
  }
  const cohortOrder = [...byCohort.keys()].sort();
  for (const cohort of cohortOrder) {
    byCohort.get(cohort).sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'name') return sortDesc ? String(bv).localeCompare(av) : String(av).localeCompare(bv);
      const an = av === null || av === undefined ? -Infinity : av;
      const bn = bv === null || bv === undefined ? -Infinity : bv;
      return sortDesc ? bn - an : an - bn;
    });
  }

  const toggleSort = key => {
    if (sortKey === key) setSortDesc(d => !d);
    else { setSortKey(key); setSortDesc(true); }
  };

  if (!rows.length) {
    return <p style={{ ...mono, fontSize: 12, color: C.dim, padding: '12px 0' }}>No sequence data yet.</p>;
  }

  return (
    <div>
      <label style={{ ...mono, fontSize: 11, color: C.mut, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', marginBottom: 10 }}>
        <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
        Show inactive sequences
      </label>

      {cohortOrder.map(cohort => (
        <div key={cohort} style={{ marginBottom: 16 }}>
          <p style={{ ...mono, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>{cohort}</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', ...mono, fontSize: 12 }}>
              <thead>
                <tr>
                  {SORT_COLUMNS.map(col => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      style={{ textAlign: 'left', padding: '6px 10px', color: sortKey === col.key ? C.txt : C.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.brd}`, cursor: 'pointer', userSelect: 'none' }}
                    >
                      {col.label}{sortKey === col.key ? (sortDesc ? ' ▼' : ' ▲') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byCohort.get(cohort).map(r => {
                  const flagged = r.bounceRate !== null && r.bounceRate > BOUNCE_FLAG_THRESHOLD;
                  return (
                    <tr key={r.id}>
                      <td style={{ padding: '7px 10px', color: r.active === false ? C.dim : C.txt, borderBottom: `1px solid ${C.brd}` }}>
                        {r.name}{r.active === false && ' (inactive)'}
                      </td>
                      <td style={{ padding: '7px 10px', color: C.txt, borderBottom: `1px solid ${C.brd}` }}>{formatValue(r.delivered, 'number')}</td>
                      <td style={{ padding: '7px 10px', color: C.txt, borderBottom: `1px solid ${C.brd}` }}>{formatValue(r.openRate, 'percent')}</td>
                      <td style={{ padding: '7px 10px', color: C.txt, borderBottom: `1px solid ${C.brd}` }}>{formatValue(r.replyRate, 'percent')}</td>
                      <td style={{ padding: '7px 10px', color: flagged ? C.red : C.txt, borderBottom: `1px solid ${C.brd}` }}>
                        {formatValue(r.bounceRate, 'percent')} {flagged && '⚠'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
