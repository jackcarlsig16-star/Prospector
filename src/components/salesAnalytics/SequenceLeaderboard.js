import { useState, useEffect, Fragment } from 'react';
import { SA, SA_TYPE, SA_SHAPE } from './theme';
import { formatValue } from './computeMetric';
import { cohortColor, bounceHealthColor } from './palette';
import { COHORTS } from './metrics.registry';
import { buildSequenceRows, needsAttention } from './sequenceRows';
import { BOUNCE_ALERT_THRESHOLD, BOUNCE_ALERT_MIN_DELIVERED } from './alertRules';
import { setSequencePartner } from './salesApi';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';
import TimeChip from './TimeChip';

const GROUP_OPTIONS = [
  { id: 'cohort', label: 'Cohort' },
  { id: 'sender', label: 'Sender' },
  { id: 'partner', label: 'Partner' },
  { id: 'none', label: 'None' },
];

// sales-leaderboard-alignment-v1 (8981261) - ONE column definition, shared
// by the <colgroup> and every <th>/<td> in every table on this widget (the
// bug that fix solved: grouped mode renders one <table> per group, and
// without a shared definition each auto-sizes its own columns). Kept
// through this stage's restyle - only the column SET and cell rendering
// changed (Cohort is now its own column instead of a dot inside the name
// cell; Delivered gets an inline bar; Partner stays, real functionality
// the mockup's static image just didn't draw, same as the header's kept
// Compare checkbox in Stage 1).
const LEADERBOARD_COLUMNS = [
  { id: 'expand', label: '', sortKey: null, width: 28, align: 'left' },
  { id: 'name', label: 'Sequence', sortKey: 'name', width: null, align: 'left' },
  { id: 'cohort', label: 'Cohort', sortKey: null, width: 120, align: 'left' },
  { id: 'sender', label: 'Sender', sortKey: 'senderEmail', width: 110, align: 'left' },
  { id: 'steps', label: 'Steps', sortKey: 'numSteps', width: 52, align: 'right' },
  { id: 'delivered', label: 'Delivered', sortKey: 'delivered', width: 160, align: 'right' },
  { id: 'open', label: 'Open', sortKey: 'openRate', width: 64, align: 'right' },
  { id: 'reply', label: 'Reply', sortKey: 'replyRate', width: 64, align: 'right' },
  { id: 'bounce', label: 'Bounce', sortKey: 'bounceRate', width: 80, align: 'right' },
  { id: 'partner', label: 'Partner', sortKey: null, width: 64, align: 'left' },
  { id: 'health', label: 'Health', sortKey: null, width: 150, align: 'left' },
];
const NAME_COL_MIN_WIDTH = 170; // REVISABLE starting value, per SPEC
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
// arrow can't shift the header label itself.
function SortIndicator({ active, desc }) {
  return <span style={{ display: 'inline-block', width: 10, flexShrink: 0, textAlign: 'center' }}>{active ? (desc ? '▼' : '▲') : ''}</span>;
}

function Colgroup() {
  return (
    <colgroup>
      {LEADERBOARD_COLUMNS.map(col => (
        <col key={col.id} style={col.width ? { width: col.width } : undefined} />
      ))}
    </colgroup>
  );
}

// design-v1 Stage 3 - leaderboard restyle: Cohort as its own column (dot +
// name, no longer inline in the Sequence cell), Delivered gets a thin
// inline bar scaled to the max of the currently-filtered set, Bounce %
// text is status-colored only when delivered >= 20 (otherwise faint - a
// 100% bounce rate on 1 send isn't a real signal), a Health pill/text
// ("Underperforming" for Apollo's own performing-poorly flag, "Low
// volume" under 20 delivered, else "OK"), and rows with bounce > 5% get a
// faint red tint - independent of the delivered>=20 gate above (a row can
// be tinted and still show its Bounce % in faint gray if its volume is
// too low to color confidently). BOUNCE_ALERT_THRESHOLD/
// BOUNCE_ALERT_MIN_DELIVERED are imported from alertRules.js rather than
// re-declared, so the leaderboard's tint and the alerts row's own bounce
// rule can never drift apart.
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
    return <p style={{ ...SA_TYPE.body, fontSize: 12, color: SA.muted, padding: '12px 0' }}>No sequence data yet.</p>;
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

  const maxDelivered = Math.max(1, ...filtered.map(r => r.delivered || 0));

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
    ...SA_TYPE.body, fontSize: 12, padding: '0 12px', height: 32, display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: SA_SHAPE.radiusPill, cursor: 'pointer',
    background: active ? SA.surface2 : 'transparent',
    border: `1px solid ${active ? color : SA.border}`,
    color: active ? SA.text : SA.muted,
  });
  const selectStyle = { ...SA_TYPE.body, fontSize: 12, padding: '5px 8px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, color: SA.text };

  // Sticky cells (expand arrow + name) need their own opaque background -
  // otherwise horizontally-scrolled-under content shows through while
  // pinned. The header's own arrow/name cells share these same sticky
  // offsets, so they stay aligned with the pinned body column during
  // horizontal scroll.
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
              textAlign: col.align, padding: '0 10px 10px', color: col.sortKey && sortKey === col.sortKey ? SA.text : SA.muted,
              ...SA_TYPE.label, fontSize: 11, borderBottom: `1px solid ${SA.border}`,
              cursor: col.sortKey ? 'pointer' : 'default', userSelect: 'none', overflow: 'hidden',
              ...stickyCellStyle(col.id, SA.surface),
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
    const meaningfulVolume = r.delivered !== null && r.delivered >= BOUNCE_ALERT_MIN_DELIVERED;
    const tinted = r.bounceRate !== null && r.bounceRate > BOUNCE_ALERT_THRESHOLD;
    const expanded = expandedIds.has(r.id);
    const saving = savingId === r.id;
    const rowError = errorById[r.id];
    const rowBg = tinted ? `${SA.bad}0D` : undefined;
    const cellStyle = { padding: '10px 10px', color: SA.text, borderBottom: `1px solid ${SA.border}`, background: rowBg };
    const numericCellStyle = { ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
    return (
      <Fragment key={r.id}>
        <tr>
          <td
            style={{ ...cellStyle, padding: '10px 4px', cursor: 'pointer', color: SA.muted, textAlign: 'center', ...stickyCellStyle('expand', tinted ? `${SA.bad}0D` : SA.surface) }}
            onClick={() => toggleExpand(r.id)}
          >
            {expanded ? '▾' : '▸'}
          </td>
          <td
            style={{ ...cellStyle, color: r.active === false ? SA.muted : SA.text, fontWeight: 500, cursor: 'pointer', maxWidth: 0, ...stickyCellStyle('name', tinted ? `${SA.bad}0D` : SA.surface) }}
            onClick={() => toggleExpand(r.id)}
            title={r.name}
          >
            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}{r.active === false && ' (inactive)'}</span>
          </td>
          <td style={cellStyle}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: SA.muted }}>
              <span data-cohort-dot={r.cohort} style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: cohortColor(r.cohort), flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.cohort}</span>
            </span>
          </td>
          <td style={{ ...cellStyle, color: SA.muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.senderEmail || 'Unknown'}>
            {r.senderEmail || 'Unknown'}
          </td>
          <td style={{ ...numericCellStyle, color: SA.muted }}>{r.numSteps ?? '—'}</td>
          <td style={cellStyle}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{formatValue(r.delivered, 'number')}</span>
              <span style={{ flexGrow: 1, height: 6, background: SA.ground, borderRadius: 3, overflow: 'hidden', display: 'block' }}>
                <span style={{ display: 'block', height: 6, width: `${Math.max(0, Math.min(100, ((r.delivered || 0) / maxDelivered) * 100))}%`, background: SA.barNeutral, borderRadius: 3 }} />
              </span>
            </span>
          </td>
          <td style={numericCellStyle}>{formatValue(r.openRate, 'percent')}</td>
          <td style={numericCellStyle}>{formatValue(r.replyRate, 'percent')}</td>
          <td style={{ ...numericCellStyle, fontWeight: 600, color: meaningfulVolume ? (bounceHealthColor(r.bounceRate) || SA.text) : SA.faint }}>
            {formatValue(r.bounceRate, 'percent')}
          </td>
          <td style={cellStyle}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.5 : 1 }}>
              <input type="checkbox" checked={r.isPartner} disabled={saving} onChange={() => handleTogglePartner(r)} />
            </label>
            {rowError && <div style={{ color: SA.bad, fontSize: 9, marginTop: 2 }}>⚠ {rowError}</div>}
          </td>
          <td style={cellStyle}>
            {r.isPerformingPoorly ? (
              <span style={{ fontSize: 11, fontWeight: 600, color: SA.bad, background: `${SA.bad}1A`, borderRadius: SA_SHAPE.radiusPill, padding: '4px 10px', whiteSpace: 'nowrap' }}>
                Underperforming
              </span>
            ) : (
              <span style={{ fontSize: 12, color: meaningfulVolume ? SA.muted : SA.faint }}>{meaningfulVolume ? 'OK' : 'Low volume'}</span>
            )}
          </td>
        </tr>
        {expanded && (
          <tr>
            <td style={{ borderBottom: `1px solid ${SA.border}`, background: SA.surface2, ...stickyCellStyle('expand', SA.surface2) }} />
            <td colSpan={LEADERBOARD_COLUMNS.length - 1} style={{ padding: '12px 16px', borderBottom: `1px solid ${SA.border}`, background: SA.surface2 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 8 }}>
                {EXPAND_COUNTER_ROWS.map(([key, label]) => (
                  <div key={key}>
                    <span style={{ ...SA_TYPE.label, fontSize: 9, color: SA.muted }}>{label}</span>
                    <div style={{ ...SA_TYPE.body, fontSize: 13, color: SA.text }}>{formatValue(r.counters[key], 'number')}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, color: SA.muted }}>
                <span>Click % <strong style={{ color: SA.text }}>{formatValue(r.clickRate, 'percent')}</strong></span>
                <span>Unsubscribe % <strong style={{ color: SA.text }}>{formatValue(r.unsubscribeRate, 'percent')}</strong></span>
                <span>Created <strong style={{ color: SA.text }}>{fmtDate(r.createdAt)}</strong></span>
                <span>Apollo performing poorly <strong style={{ color: r.isPerformingPoorly ? SA.bad : SA.text }}>{r.isPerformingPoorly ? 'Yes' : 'No'}</strong></span>
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
      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', padding: '10px 12px', background: SA.ground, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, marginBottom: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {COHORTS.map(cohort => (
            <span key={cohort} onClick={() => toggleCohortFilter(cohort)} style={chipStyle(cohortFilter.has(cohort), cohortColor(cohort))}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: cohortColor(cohort), display: 'inline-block' }} />
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
          style={{ ...SA_TYPE.body, fontSize: 12, padding: '6px 8px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, color: SA.text, flex: '1 1 140px', minWidth: 120 }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <p style={{ fontSize: 12, color: SA.muted, margin: 0 }}>Showing {filtered.length} of {totalCount} sequences</p>
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: SA.faint }}>Group by</span>
          {GROUP_OPTIONS.map(g => (
            <span key={g.id} onClick={() => setGroupBy(g.id)} style={chipStyle(groupBy === g.id, SA.accent)}>{g.label}</span>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, padding: '10px 12px', background: SA.ground, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, marginBottom: 12, fontSize: 12 }}>
        <span style={{ color: SA.muted }}>Sequences <strong style={{ color: SA.text }}>{summary.count}</strong></span>
        <span style={{ color: SA.muted }}>Delivered <strong style={{ color: SA.text }}>{formatValue(summary.delivered, 'number')}</strong></span>
        <span style={{ color: SA.muted }}>Open % <strong style={{ color: SA.text }}>{formatValue(summaryOpenRate, 'percent')}</strong></span>
        <span style={{ color: SA.muted }}>Reply % <strong style={{ color: SA.text }}>{formatValue(summaryReplyRate, 'percent')}</strong></span>
        <span style={{ color: SA.muted }}>Bounce % <strong style={{ color: SA.text }}>{formatValue(summaryBounceRate, 'percent')}</strong></span>
      </div>

      {!filtered.length && (
        <p style={{ fontSize: 12, color: SA.muted, padding: '12px 0' }}>No sequences match the current filters.</p>
      )}

      {groupOrder.map(groupKey => (
        <div key={groupKey} style={{ marginBottom: 16 }}>
          {groupBy !== 'none' && (
            <p style={{ ...SA_TYPE.label, fontSize: 10, color: SA.faint, margin: '0 0 6px' }}>{groupKey}</p>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: TABLE_MIN_WIDTH, tableLayout: 'fixed', borderCollapse: 'collapse', ...SA_TYPE.body, fontSize: 13 }}>
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
