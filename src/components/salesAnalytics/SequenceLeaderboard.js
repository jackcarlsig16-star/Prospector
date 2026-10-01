import { useState, useEffect, Fragment } from 'react';
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

// sales-leaderboard-alignment-v1 - ONE column definition (id, label, sort
// key, width, alignment), shared by the <colgroup> and every <th>/<td> in
// every table on this widget (the header table-less layout, and one
// <table> per group when grouped). Measured root cause (not the guessed
// one): header/body cells inside a single <table> already matched to
// 0.0px natively - browsers share column widths between thead/tbody. The
// real drift (up to 90.9px at 1440px) was CROSS-table: grouped mode
// renders one independent <table> per group, each auto-sizing its own
// columns from only its own rows. table-layout:fixed + this shared
// <colgroup> (same widths on every table) fixes that at the source.
// `width: null` (name) is the one flexible column - with no <col> width
// set, fixed-layout tables give it 100% of whatever space remains above
// TABLE_MIN_WIDTH, which plays the role of minmax(220px, 1fr).
const LEADERBOARD_COLUMNS = [
  { id: 'expand', label: '', sortKey: null, width: 28, align: 'left' },
  { id: 'name', label: 'Sequence', sortKey: 'name', width: null, align: 'left' },
  { id: 'sender', label: 'Sender', sortKey: 'senderEmail', width: 150, align: 'left' },
  { id: 'steps', label: 'Steps', sortKey: 'numSteps', width: 56, align: 'right' },
  { id: 'delivered', label: 'Delivered', sortKey: 'delivered', width: 92, align: 'right' },
  { id: 'open', label: 'Open %', sortKey: 'openRate', width: 70, align: 'right' },
  { id: 'reply', label: 'Reply %', sortKey: 'replyRate', width: 70, align: 'right' },
  { id: 'bounce', label: 'Bounce %', sortKey: 'bounceRate', width: 82, align: 'right' },
  { id: 'partner', label: 'Partner', sortKey: null, width: 72, align: 'left' },
  { id: 'health', label: 'Health', sortKey: null, width: 172, align: 'left' },
];
const NAME_COL_MIN_WIDTH = 220; // REVISABLE starting value, per SPEC
const NAME_COL_LEFT = LEADERBOARD_COLUMNS[0].width; // sticky offset for the name column = the expand column's width
const TABLE_MIN_WIDTH = LEADERBOARD_COLUMNS.reduce((sum, c) => sum + (c.width ?? NAME_COL_MIN_WIDTH), 0);

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

// Fixed-width (never shrinks when empty) so an appearing/disappearing sort
// arrow can't shift the header label itself - measured requirement from
// sales-leaderboard-alignment-v1 ("sort arrows don't shift the label text").
function SortIndicator({ active, desc }) {
  return <span style={{ display: 'inline-block', width: 10, flexShrink: 0, textAlign: 'center' }}>{active ? (desc ? '▼' : '▲') : ''}</span>;
}

// Same column definition reused by every <table> on this widget (ungrouped,
// and once per group) - this is the fix for the measured cross-table drift.
function Colgroup() {
  return (
    <colgroup>
      {LEADERBOARD_COLUMNS.map(col => (
        <col key={col.id} style={col.width ? { width: col.width } : undefined} />
      ))}
    </colgroup>
  );
}

// dashboard-v2 Stage 4 - the full sequence-area redesign: filter bar,
// grouping, sortable columns, row expand (every kept unique_* counter),
// a summary strip, and a real Partner toggle per row (never silent on
// failure - audit-grounded requirement). Builds on buildSequenceRows()
// (sequenceRows.js), which already joins GET /entities (names/cohort/
// Partner/sender/steps/etc, Stage 2) with GET /metrics (the unique_*
// counters) - this file is purely filtering/grouping/sorting/rendering on
// top of that one real data join.
export default function SequenceLeaderboard({ businessId, allRows, entities, widgetId = 'sequence_leaderboard', onDataChanged, onFiltersChanged }) {
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

  // Reports a human-readable summary up to the parent so the print-only
  // PDF header can state "filters applied" without lifting all of this
  // state itself (dashboard-v2 Stage 5 requirement).
  useEffect(() => {
    const cohortLabel = cohortFilter.size === COHORTS.length ? 'all cohorts' : `cohorts: ${[...cohortFilter].join(', ') || 'none'}`;
    const parts = [
      cohortLabel,
      `Partner: ${partnerFilter === 'all' ? 'all' : partnerFilter}`,
      `Sender: ${senderFilter === 'all' ? 'all' : senderFilter}`,
      `Status: ${statusFilter}`,
      `Health: ${healthFilter === 'all' ? 'all' : 'needs attention'}`,
      search.trim() ? `Search: "${search.trim()}"` : null,
      `Grouped by: ${groupBy}`,
    ].filter(Boolean);
    onFiltersChanged?.(`Sequences — ${parts.join('; ')} (showing ${filtered.length} of ${totalCount})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cohortFilter, partnerFilter, senderFilter, statusFilter, healthFilter, search, groupBy, filtered.length, totalCount]);

  const toggleCohortFilter = cohort => {
    setCohortFilter(prev => {
      const next = new Set(prev);
      if (next.has(cohort)) next.delete(cohort); else next.add(cohort);
      return next;
    });
  };

  const toggleSort = key => {
    if (!key) return;
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

  // Sticky cells (expand arrow + name) need their own opaque background -
  // otherwise horizontally-scrolled-under content shows through while
  // pinned (SPEC: "name column stays pinned on the left" at narrow widths).
  // "Header is sticky inside the table's scroll area" is implemented as:
  // the header's own arrow/name cells share these same sticky offsets, so
  // they stay aligned with the pinned body column during horizontal
  // scroll, instead of scrolling away from it (flagged back in the report
  // as the practical reading - there's no bounded-height vertical scroll
  // region here for a top:0 vertical sticky header to apply to).
  const stickyCellStyle = (colId, bg) => {
    if (colId !== 'expand' && colId !== 'name') return {};
    return { position: 'sticky', left: colId === 'expand' ? 0 : NAME_COL_LEFT, zIndex: colId === 'expand' ? 3 : 2, background: bg };
  };

  const renderHeader = () => (
    <thead>
      <tr>
        {LEADERBOARD_COLUMNS.map(col => (
          <th
            key={col.id}
            onClick={() => toggleSort(col.sortKey)}
            style={{
              textAlign: col.align, padding: '6px 10px', color: col.sortKey && sortKey === col.sortKey ? C.txt : C.dim,
              fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.brd}`,
              cursor: col.sortKey ? 'pointer' : 'default', userSelect: 'none', overflow: 'hidden',
              ...stickyCellStyle(col.id, C.card),
            }}
          >
            {col.label && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start', width: '100%' }}>
                {col.align === 'right' && <SortIndicator active={sortKey === col.sortKey} desc={sortDesc} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.label}</span>
                {col.align !== 'right' && col.sortKey && <SortIndicator active={sortKey === col.sortKey} desc={sortDesc} />}
              </span>
            )}
          </th>
        ))}
      </tr>
    </thead>
  );

  const renderRows = rows => rows.map(r => {
    const flagged = r.bounceRate !== null && r.bounceRate > BOUNCE_FLAG_THRESHOLD;
    const expanded = expandedIds.has(r.id);
    const saving = savingId === r.id;
    const rowError = errorById[r.id];
    const numericCellStyle = { padding: '7px 10px', color: C.txt, borderBottom: `1px solid ${C.brd}`, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
    return (
      <Fragment key={r.id}>
        <tr>
          <td
            style={{ padding: '7px 4px', borderBottom: `1px solid ${C.brd}`, cursor: 'pointer', color: C.dim, textAlign: 'center', ...stickyCellStyle('expand', C.card) }}
            onClick={() => toggleExpand(r.id)}
          >
            {expanded ? '▾' : '▸'}
          </td>
          <td
            style={{ padding: '7px 10px', color: r.active === false ? C.dim : C.txt, borderBottom: `1px solid ${C.brd}`, borderRight: `1px solid ${C.brd}`, cursor: 'pointer', maxWidth: 0, ...stickyCellStyle('name', C.card) }}
            onClick={() => toggleExpand(r.id)}
            title={r.name}
          >
            <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
              <span data-cohort-dot={r.cohort} style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: cohortColor(r.cohort), marginRight: 7, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}{r.active === false && ' (inactive)'}</span>
            </div>
          </td>
          <td style={{ padding: '7px 10px', color: C.mut, borderBottom: `1px solid ${C.brd}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.senderEmail || 'Unknown'}>
            {r.senderEmail || 'Unknown'}
          </td>
          <td style={numericCellStyle}>{r.numSteps ?? '—'}</td>
          <td style={numericCellStyle}>{formatValue(r.delivered, 'number')}</td>
          <td style={numericCellStyle}>{formatValue(r.openRate, 'percent')}</td>
          <td style={numericCellStyle}>{formatValue(r.replyRate, 'percent')}</td>
          <td style={{ ...numericCellStyle, color: flagged ? SEMANTIC.problem : C.txt }}>
            {formatValue(r.bounceRate, 'percent')} {flagged && '⚠'}
          </td>
          <td style={{ padding: '7px 10px', borderBottom: `1px solid ${C.brd}`, overflow: 'hidden' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.5 : 1 }}>
              <input type="checkbox" checked={r.isPartner} disabled={saving} onChange={() => handleTogglePartner(r)} />
            </label>
            {rowError && <div style={{ color: SEMANTIC.problem, fontSize: 9, marginTop: 2 }}>⚠ {rowError}</div>}
          </td>
          <td style={{ padding: '7px 10px', borderBottom: `1px solid ${C.brd}`, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {r.isPerformingPoorly && (
              <span style={{ ...mono, fontSize: 9, color: SEMANTIC.problem, background: `${SEMANTIC.problem}18`, border: `1px solid ${SEMANTIC.problem}66`, borderRadius: 8, padding: '1px 6px' }}>
                Apollo: performing poorly
              </span>
            )}
          </td>
        </tr>
        {expanded && (
          <tr>
            <td style={{ borderBottom: `1px solid ${C.brd}`, background: C.bg, ...stickyCellStyle('expand', C.bg) }} />
            <td colSpan={LEADERBOARD_COLUMNS.length - 1} style={{ padding: '10px 14px', borderBottom: `1px solid ${C.brd}`, background: C.bg }}>
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
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <TimeChip>All-time (Apollo lifetime totals)</TimeChip>
        <ExportButton onClick={handleExport} />
      </div>

      {/* Filter bar - hidden in print; the print-only header states the
          same filters as static text (see onFiltersChanged above). */}
      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '10px 12px', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 6, marginBottom: 10 }}>
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
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
            <table style={{ width: '100%', minWidth: TABLE_MIN_WIDTH, tableLayout: 'fixed', borderCollapse: 'collapse', ...mono, fontSize: 12 }}>
              <Colgroup />
              {renderHeader()}
              <tbody>
                {renderRows(groups.get(groupKey))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
