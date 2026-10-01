import { useState, Fragment } from 'react';
import { C, mono } from '../../constants/colors';
import { formatValue } from './computeMetric';
import { cohortColor, SEMANTIC } from './palette';
import { COHORTS } from './metrics.registry';
import { buildSequenceRows, needsAttention } from './sequenceRows';
import { setSequencePartner } from './salesApi';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';
import TimeChip from './TimeChip';

const BOUNCE_FLAG_THRESHOLD = 0.03; // existing PROPOSED value (SPEC)
const GROUP_OPTIONS = [
  { id: 'cohort', label: 'Cohort' },
  { id: 'sender', label: 'Sender' },
  { id: 'partner', label: 'Partner' },
  { id: 'none', label: 'None' },
];
const SORT_COLUMNS = [
  { key: 'name', label: 'Sequence' },
  { key: 'senderEmail', label: 'Sender' },
  { key: 'numSteps', label: 'Steps' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'openRate', label: 'Open %' },
  { key: 'replyRate', label: 'Reply %' },
  { key: 'bounceRate', label: 'Bounce %' },
];
const EXPAND_COUNTER_ROWS = [
  ['unique_scheduled', 'Scheduled'], ['unique_delivered', 'Delivered'], ['unique_opened', 'Opened'],
  ['unique_clicked', 'Clicked'], ['unique_replied', 'Replied'], ['unique_bounced', 'Bounced'],
  ['unique_hard_bounced', 'Hard Bounced'], ['unique_spam_blocked', 'Spam Blocked'], ['unique_unsubscribed', 'Unsubscribed'],
];

function groupKeyFor(row, groupBy) {
  if (groupBy === 'cohort') return row.cohort;
  if (groupBy === 'sender') return row.senderEmail || 'Unknown';
  if (groupBy === 'partner') return row.isPartner ? 'Partner' : 'Direct';
  return 'All sequences';
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return '—'; }
}

// dashboard-v2 Stage 4 - the full sequence-area redesign: filter bar,
// grouping, sortable columns, row expand (every kept unique_* counter),
// a summary strip, and a real Partner toggle per row (never silent on
// failure - audit-grounded requirement). Builds on buildSequenceRows()
// (sequenceRows.js), which already joins GET /entities (names/cohort/
// Partner/sender/steps/etc, Stage 2) with GET /metrics (the unique_*
// counters) - this file is purely filtering/grouping/sorting/rendering on
// top of that one real data join.
export default function SequenceLeaderboard({ businessId, allRows, entities, widgetId = 'sequence_leaderboard', onDataChanged }) {
  const [cohortFilter, setCohortFilter] = useState(() => new Set(COHORTS));
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [senderFilter, setSenderFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [healthFilter, setHealthFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState('cohort');
  const [sortKey, setSortKey] = useState('delivered');
  const [sortDesc, setSortDesc] = useState(true);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [savingId, setSavingId] = useState(null);
  const [errorById, setErrorById] = useState({});

  const allSequenceRows = buildSequenceRows(allRows, entities);
  const totalCount = allSequenceRows.length;

  if (!totalCount) {
    return <p style={{ ...mono, fontSize: 12, color: C.dim, padding: '12px 0' }}>No sequence data yet.</p>;
  }

  const senderOptions = [...new Set(allSequenceRows.map(r => r.senderEmail || 'Unknown'))].sort();

  const filtered = allSequenceRows.filter(r => {
    if (!cohortFilter.has(r.cohort) && r.cohort !== 'Unknown') return false;
    if (partnerFilter === 'direct' && r.isPartner) return false;
    if (partnerFilter === 'partner' && !r.isPartner) return false;
    if (senderFilter !== 'all' && (r.senderEmail || 'Unknown') !== senderFilter) return false;
    if (statusFilter === 'active' && r.active === false) return false;
    if (statusFilter === 'inactive' && r.active !== false) return false;
    if (healthFilter === 'needs_attention' && !needsAttention(r)) return false;
    if (search.trim() && !r.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  const toggleCohortFilter = cohort => {
    setCohortFilter(prev => {
      const next = new Set(prev);
      if (next.has(cohort)) next.delete(cohort); else next.add(cohort);
      return next;
    });
  };

  const toggleSort = key => {
    if (sortKey === key) setSortDesc(d => !d);
    else { setSortKey(key); setSortDesc(true); }
  };

  const sortRows = rows => [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === 'string' || typeof bv === 'string') {
      const as = av == null ? '' : String(av);
      const bs = bv == null ? '' : String(bv);
      return sortDesc ? bs.localeCompare(as) : as.localeCompare(bs);
    }
    const an = av === null || av === undefined ? -Infinity : av;
    const bn = bv === null || bv === undefined ? -Infinity : bv;
    return sortDesc ? bn - an : an - bn;
  });

  const groups = new Map();
  for (const row of filtered) {
    const key = groupKeyFor(row, groupBy);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const groupOrder = [...groups.keys()].sort();
  for (const key of groupOrder) groups.set(key, sortRows(groups.get(key)));
  const exportRows = groupOrder.flatMap(key => groups.get(key));

  // Weighted over the filtered set (sum counts first, divide once) - same
  // "aggregate first" principle computeMetric.js's ratio() already uses,
  // never an average of each row's own rate.
  const summary = filtered.reduce((acc, r) => {
    acc.count += 1;
    acc.delivered += r.delivered || 0;
    acc.opened += r.counters.unique_opened || 0;
    acc.replied += r.counters.unique_replied || 0;
    acc.bounced += r.counters.unique_bounced || 0;
    return acc;
  }, { count: 0, delivered: 0, opened: 0, replied: 0, bounced: 0 });
  const summaryOpenRate = summary.delivered > 0 ? summary.opened / summary.delivered : null;
  const summaryReplyRate = summary.delivered > 0 ? summary.replied / summary.delivered : null;
  const summaryBounceRate = (summary.delivered + summary.bounced) > 0 ? summary.bounced / (summary.delivered + summary.bounced) : null;

  const toggleExpand = id => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleTogglePartner = async row => {
    setSavingId(row.id);
    setErrorById(prev => { const next = { ...prev }; delete next[row.id]; return next; });
    try {
      await setSequencePartner(businessId, row.id, !row.isPartner);
      onDataChanged?.();
    } catch (e) {
      setErrorById(prev => ({ ...prev, [row.id]: e.message }));
    } finally {
      setSavingId(null);
    }
  };

  const handleExport = () => {
    exportWidgetCsv(widgetId, exportRows, [
      { label: 'Cohort', key: 'cohort' },
      { label: 'Sequence', key: 'name' },
      { label: 'Status', value: r => (r.active === false ? 'Inactive' : 'Active') },
      { label: 'Partner', value: r => (r.isPartner ? 'Yes' : 'No') },
      { label: 'Sender', value: r => r.senderEmail || 'Unknown' },
      { label: 'Steps', value: r => (r.numSteps ?? '') },
      { label: 'Delivered', value: r => formatValue(r.delivered, 'number') },
      { label: 'Open %', value: r => formatValue(r.openRate, 'percent') },
      { label: 'Reply %', value: r => formatValue(r.replyRate, 'percent') },
      { label: 'Bounce %', value: r => formatValue(r.bounceRate, 'percent') },
      { label: 'Hard-Bounce %', value: r => formatValue(r.hardBounceRate, 'percent') },
      { label: 'Spam-Block %', value: r => formatValue(r.spamBlockRate, 'percent') },
      { label: 'Performing Poorly', value: r => (r.isPerformingPoorly ? 'Yes' : 'No') },
    ]);
  };

  const chipStyle = (active, color) => ({
    ...mono, fontSize: 10, padding: '3px 9px', borderRadius: 10, cursor: 'pointer',
    background: active ? `${color}22` : 'transparent',
    border: `1px solid ${active ? color : C.brd}`,
    color: active ? color : C.dim,
  });
  const selectStyle = { ...mono, fontSize: 11, padding: '3px 7px', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 5, color: C.txt };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <TimeChip>All-time (Apollo lifetime totals)</TimeChip>
        <ExportButton onClick={handleExport} />
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '10px 12px', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 6, marginBottom: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {COHORTS.map(cohort => (
            <span key={cohort} onClick={() => toggleCohortFilter(cohort)} style={chipStyle(cohortFilter.has(cohort), cohortColor(cohort))}>
              {cohort}
            </span>
          ))}
        </div>
        <select value={partnerFilter} onChange={e => setPartnerFilter(e.target.value)} style={selectStyle}>
          <option value="all">All (Direct + Partner)</option>
          <option value="direct">Direct only</option>
          <option value="partner">Partner only</option>
        </select>
        <select value={senderFilter} onChange={e => setSenderFilter(e.target.value)} style={selectStyle}>
          <option value="all">All senders</option>
          {senderOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All statuses</option>
        </select>
        <select value={healthFilter} onChange={e => setHealthFilter(e.target.value)} style={selectStyle}>
          <option value="all">All health</option>
          <option value="needs_attention">Needs attention</option>
        </select>
        <input
          type="text" placeholder="Search name…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...mono, fontSize: 11, padding: '4px 8px', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 5, color: C.txt, flex: '1 1 140px', minWidth: 120 }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <p style={{ ...mono, fontSize: 11, color: C.mut, margin: 0 }}>Showing {filtered.length} of {totalCount} sequences</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ ...mono, fontSize: 10, color: C.dim }}>Group by</span>
          {GROUP_OPTIONS.map(g => (
            <span key={g.id} onClick={() => setGroupBy(g.id)} style={chipStyle(groupBy === g.id, C.gold)}>{g.label}</span>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, padding: '8px 12px', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 6, marginBottom: 12, ...mono, fontSize: 11 }}>
        <span style={{ color: C.dim }}>Sequences <strong style={{ color: C.txt }}>{summary.count}</strong></span>
        <span style={{ color: C.dim }}>Delivered <strong style={{ color: C.txt }}>{formatValue(summary.delivered, 'number')}</strong></span>
        <span style={{ color: C.dim }}>Open % <strong style={{ color: C.txt }}>{formatValue(summaryOpenRate, 'percent')}</strong></span>
        <span style={{ color: C.dim }}>Reply % <strong style={{ color: C.txt }}>{formatValue(summaryReplyRate, 'percent')}</strong></span>
        <span style={{ color: C.dim }}>Bounce % <strong style={{ color: C.txt }}>{formatValue(summaryBounceRate, 'percent')}</strong></span>
      </div>

      {!filtered.length && (
        <p style={{ ...mono, fontSize: 12, color: C.dim, padding: '12px 0' }}>No sequences match the current filters.</p>
      )}

      {groupOrder.map(groupKey => (
        <div key={groupKey} style={{ marginBottom: 16 }}>
          {groupBy !== 'none' && (
            <p style={{ ...mono, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 6px' }}>{groupKey}</p>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', ...mono, fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 18 }} />
                  {SORT_COLUMNS.map(col => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      style={{ textAlign: 'left', padding: '6px 10px', color: sortKey === col.key ? C.txt : C.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.brd}`, cursor: 'pointer', userSelect: 'none' }}
                    >
                      {col.label}{sortKey === col.key ? (sortDesc ? ' ▼' : ' ▲') : ''}
                    </th>
                  ))}
                  <th style={{ textAlign: 'left', padding: '6px 10px', color: C.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.brd}` }}>Partner</th>
                  <th style={{ textAlign: 'left', padding: '6px 10px', color: C.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.brd}` }}>Health</th>
                </tr>
              </thead>
              <tbody>
                {groups.get(groupKey).map(r => {
                  const flagged = r.bounceRate !== null && r.bounceRate > BOUNCE_FLAG_THRESHOLD;
                  const expanded = expandedIds.has(r.id);
                  const saving = savingId === r.id;
                  const rowError = errorById[r.id];
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        <td style={{ padding: '7px 4px', borderBottom: `1px solid ${C.brd}`, cursor: 'pointer', color: C.dim }} onClick={() => toggleExpand(r.id)}>
                          {expanded ? '▾' : '▸'}
                        </td>
                        <td style={{ padding: '7px 10px', color: r.active === false ? C.dim : C.txt, borderBottom: `1px solid ${C.brd}`, cursor: 'pointer' }} onClick={() => toggleExpand(r.id)}>
                          <span data-cohort-dot={r.cohort} style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: cohortColor(r.cohort), marginRight: 7 }} />
                          {r.name}{r.active === false && ' (inactive)'}
                        </td>
                        <td style={{ padding: '7px 10px', color: C.mut, borderBottom: `1px solid ${C.brd}` }}>{r.senderEmail || 'Unknown'}</td>
                        <td style={{ padding: '7px 10px', color: C.txt, borderBottom: `1px solid ${C.brd}` }}>{r.numSteps ?? '—'}</td>
                        <td style={{ padding: '7px 10px', color: C.txt, borderBottom: `1px solid ${C.brd}` }}>{formatValue(r.delivered, 'number')}</td>
                        <td style={{ padding: '7px 10px', color: C.txt, borderBottom: `1px solid ${C.brd}` }}>{formatValue(r.openRate, 'percent')}</td>
                        <td style={{ padding: '7px 10px', color: C.txt, borderBottom: `1px solid ${C.brd}` }}>{formatValue(r.replyRate, 'percent')}</td>
                        <td style={{ padding: '7px 10px', color: flagged ? SEMANTIC.problem : C.txt, borderBottom: `1px solid ${C.brd}` }}>
                          {formatValue(r.bounceRate, 'percent')} {flagged && '⚠'}
                        </td>
                        <td style={{ padding: '7px 10px', borderBottom: `1px solid ${C.brd}` }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.5 : 1 }}>
                            <input type="checkbox" checked={r.isPartner} disabled={saving} onChange={() => handleTogglePartner(r)} />
                          </label>
                          {rowError && <div style={{ color: SEMANTIC.problem, fontSize: 9, marginTop: 2 }}>⚠ {rowError}</div>}
                        </td>
                        <td style={{ padding: '7px 10px', borderBottom: `1px solid ${C.brd}` }}>
                          {r.isPerformingPoorly && (
                            <span style={{ ...mono, fontSize: 9, color: SEMANTIC.problem, background: `${SEMANTIC.problem}18`, border: `1px solid ${SEMANTIC.problem}66`, borderRadius: 8, padding: '1px 6px' }}>
                              Apollo: performing poorly
                            </span>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td />
                          <td colSpan={8} style={{ padding: '10px 14px', borderBottom: `1px solid ${C.brd}`, background: C.bg }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 8 }}>
                              {EXPAND_COUNTER_ROWS.map(([key, label]) => (
                                <div key={key}>
                                  <span style={{ ...mono, fontSize: 9, color: C.dim, textTransform: 'uppercase' }}>{label}</span>
                                  <div style={{ ...mono, fontSize: 13, color: C.txt }}>{formatValue(r.counters[key], 'number')}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, ...mono, fontSize: 11, color: C.mut }}>
                              <span>Click % <strong style={{ color: C.txt }}>{formatValue(r.clickRate, 'percent')}</strong></span>
                              <span>Unsubscribe % <strong style={{ color: C.txt }}>{formatValue(r.unsubscribeRate, 'percent')}</strong></span>
                              <span>Created <strong style={{ color: C.txt }}>{fmtDate(r.createdAt)}</strong></span>
                              <span>Apollo performing poorly <strong style={{ color: r.isPerformingPoorly ? SEMANTIC.problem : C.txt }}>{r.isPerformingPoorly ? 'Yes' : 'No'}</strong></span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
