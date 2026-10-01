import { useState, useEffect, useCallback, useRef } from 'react';
import { SA, SA_TYPE, SA_SHAPE, SA_THEME_CSS, SA_THEME_ROOT_ID, SA_BAD_BG, SA_BAD_BORDER, saSans } from './theme';
import AlertsRow from './AlertsRow';
import { WIDGETS } from './widgets.registry';
import { fetchMetrics, fetchRuns, fetchEntities, fetchCohortBreakdown, triggerSync } from './salesApi';
import { PERIOD_PRESETS, periodRange, previousPeriodRange, laDateString } from './periods';

const SPARKLINE_LOOKBACK_DAYS = 56; // ~8 weeks

// dashboard-v2 Stage 5 - the "print only this area" trick: hide
// everything on the page, then re-show only #sales-analytics-print-area
// and its descendants. Zero changes needed to Sidebar.js/MemberShell.js/
// the Scout bar - this app has no CSS classes anywhere (every component
// uses inline styles), so an opt-out approach (hide the sidebar
// specifically) would mean touching several unrelated files; this
// opt-in approach needs exactly one wrapper id instead.
// break-inside/page-break-inside: avoid on .print-avoid-break keeps a
// chart or table row from splitting across a page. print-color-adjust:
// exact keeps the real cohort/semantic colors on the printed page instead
// of browsers defaulting to grayscale-friendly stripping.
const PRINT_STYLES = `
  .print-only { display: none; }
  @media print {
    /* The app's global body background is dark (constants/tokens.js HUD
       theme) and "body * { visibility: hidden }" below only hides body's
       DESCENDANTS, never body itself - found while actually reading the
       rendered PDF: any page space the absolutely-positioned print area
       doesn't cover showed that dark background through as a stark black
       block, invisible as a bug on the old dark-on-dark PDF but glaring
       now that the print theme is white. */
    body { background: #FFFFFF; }
    body * { visibility: hidden; }
    #sales-analytics-print-area, #sales-analytics-print-area * { visibility: visible; }
    #sales-analytics-print-area { position: absolute; left: 0; top: 0; width: 100%; }
    .no-print { display: none !important; }
    .print-only { display: block !important; }
    .print-avoid-break { break-inside: avoid; page-break-inside: avoid; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { size: landscape letter; margin: 0.4in; }
  }
  .sa-row-2fr1fr { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
  .sa-row-1fr1fr { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  @media (max-width: 1100px) {
    .sa-row-2fr1fr, .sa-row-1fr1fr { grid-template-columns: minmax(0, 1fr); }
  }
  /* Jack's Stage 4 correction: the KPI row's flex-wrap let Bounce Rate
     wrap to its own line on the real printed page (page width minus the
     widget card's own padding left less room than the flex-basis math
     assumed). A fixed 5-column grid in print removes the ambiguity -
     screen keeps the flexible flex-wrap layout unchanged. */
  @media print {
    .sa-kpi-row { display: grid !important; grid-template-columns: repeat(5, minmax(0, 1fr)) !important; gap: 10px !important; }
  }
`;

// design-v1 Stage 3 - DECIDED layout pairs two widgets per row (items 4
// and 7: Email Trend | Mailbox Health, and Companies by Cohort | Delivery
// Mix), stacking under 1100px (.sa-row-2fr1fr/.sa-row-1fr1fr above). Every
// other widget keeps its own full-width card. This also closes a gap from
// Stage 2 - the Email Trend/Mailbox Health pairing was never built then
// (Stage 2's own text only said "the mailbox health restyle"), caught
// while building the mechanism Stage 3 needs for its own pair.
const PAIRED_ROWS = [
  { ids: ['email_trend', 'mailbox_health'], className: 'sa-row-2fr1fr' },
  { ids: ['companies_by_cohort', 'delivery_mix'], className: 'sa-row-1fr1fr' },
];

function groupWidgetsIntoRows(widgets) {
  const byId = new Map(widgets.map(w => [w.id, w]));
  const consumed = new Set();
  const rows = [];
  for (const w of widgets) {
    if (consumed.has(w.id)) continue;
    const pair = PAIRED_ROWS.find(p => p.ids[0] === w.id && byId.has(p.ids[1]) && !consumed.has(p.ids[1]));
    if (pair) {
      consumed.add(pair.ids[0]); consumed.add(pair.ids[1]);
      rows.push({ widgets: pair.ids.map(id => byId.get(id)), className: pair.className });
    } else {
      consumed.add(w.id);
      rows.push({ widgets: [w], className: null });
    }
  }
  return rows;
}

function rowsInRange(allRows, from, to) {
  return allRows.filter(r => r.metric_date >= from && r.metric_date <= to);
}

function relativeTime(iso) {
  if (!iso) return 'never';
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.round(diffHr / 24)}d ago`;
}

const STATUS_COLOR = { success: SA.good, partial: SA.warn, error: SA.bad, running: SA.accent };

// design-v1 - the SPEC's "ONE accent" rule means this page no longer
// takes the caller's (BusinessDetailPage's) per-business accent color for
// its own chrome or widgets - SA.accent (#8FA8FF) is used consistently
// instead, independent of whatever accent the rest of the app assigned
// this business. BusinessDetailPage still passes an accent prop; it's
// simply not destructured here, so it's a no-op rather than used.
export default function SalesAnalyticsTab({ businessId }) {
  const [preset, setPreset] = useState('this_week');
  const [customFrom, setCustomFrom] = useState(laDateString());
  const [customTo, setCustomTo] = useState(laDateString());
  const [compareEnabled, setCompareEnabled] = useState(false);

  const [allRows, setAllRows] = useState([]);
  const [runs, setRuns] = useState([]);
  const [entities, setEntities] = useState({ sequences: [], mailboxes: [] });
  const [cohortBreakdown, setCohortBreakdown] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [filterSummary, setFilterSummary] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef(null);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onClick = e => { if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setExportMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [exportMenuOpen]);

  const period = periodRange(preset, customFrom, customTo);
  const prevPeriod = previousPeriodRange(period);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const sparklineFrom = (() => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - SPARKLINE_LOOKBACK_DAYS);
        return laDateString(d);
      })();
      const from = [period.from, prevPeriod.from, sparklineFrom].sort()[0];
      const to = [period.to, laDateString()].sort().reverse()[0];

      const [metrics, latestRuns, latestEntities, latestCohortBreakdown] = await Promise.all([
        fetchMetrics(businessId, from, to),
        fetchRuns(businessId, 5),
        fetchEntities(businessId),
        fetchCohortBreakdown(businessId),
      ]);
      setAllRows(metrics);
      setRuns(latestRuns);
      setEntities(latestEntities);
      setCohortBreakdown(latestCohortBreakdown.breakdown || {});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, preset, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage('');
    try {
      const run = await triggerSync(businessId);
      setSyncMessage(run.status === 'success' ? 'Sync complete.' : `Sync finished: ${run.status}${run.error_text ? ` (${run.error_text})` : ''}`);
      await load();
    } catch (e) {
      setSyncMessage(e.message);
    } finally {
      setSyncing(false);
    }
  };

  const lastRun = runs[0];
  const periodRows = rowsInRange(allRows, period.from, period.to);
  const prevPeriodRows = compareEnabled ? rowsInRange(allRows, prevPeriod.from, prevPeriod.to) : [];

  const presetLabel = PERIOD_PRESETS.find(p => p.id === preset)?.label || preset;
  const lastSyncLabel = lastRun?.finished_at ? new Date(lastRun.finished_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';

  const handlePrint = () => { setExportMenuOpen(false); window.print(); };

  // design-v1 - "Export report" consolidates the entry point per the
  // mockup; PDF is wired to the existing print flow. There's no single
  // combined "report CSV" anywhere in this feature's data model (every
  // CSV export is per-widget, by design, including in the not-yet-built
  // scorecard/pipeline SPECs) - "Download all CSVs" runs each currently-
  // enabled widget's own existing export in sequence rather than
  // inventing a new combined-file concept. Flagged back in the stage
  // report; correct on a different reading if that's not what Jack meant.
  const handleDownloadAllCsvs = () => {
    setExportMenuOpen(false);
    document.querySelectorAll('#sales-analytics-print-area button').forEach(btn => {
      if (btn.textContent.trim() === 'Export CSV') btn.click();
    });
  };

  return (
    <div id={SA_THEME_ROOT_ID} style={{ ...saSans, background: SA.ground, color: SA.text, minHeight: '100%', padding: '0 0 32px' }}>
      <style>{SA_THEME_CSS}</style>
      <style>{PRINT_STYLES}</style>
      <div style={{ maxWidth: 1360, margin: '0 auto' }}>

      {/* Header - hidden in print; the print-only block below replaces it */}
      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ ...SA_TYPE.label, color: SA.muted }}>HomeLover · Command Center</div>
          <h1 style={{ margin: 0, ...SA_TYPE.pageTitle, color: SA.text }}>Sales Analytics</h1>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 13, color: SA.muted }}>
            <span>{presetLabel} ({period.from} – {period.to})</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: lastRun ? (STATUS_COLOR[lastRun.status] || SA.faint) : SA.faint, display: 'inline-block' }} />
              Synced {relativeTime(lastRun?.finished_at || lastRun?.started_at)}
              {lastRun?.counts?.apollo_calls != null && ` · ${lastRun.counts.apollo_calls} Apollo calls`}
            </span>
          </div>
          {syncMessage && <span style={{ fontSize: 12, color: SA.warn }}>{syncMessage}</span>}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: SA.muted, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', marginRight: 4 }}>
            <input type="checkbox" checked={compareEnabled} onChange={e => setCompareEnabled(e.target.checked)} />
            Compare to previous period
          </label>

          <div style={{ display: 'flex', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, padding: 3 }}>
            {PERIOD_PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => setPreset(p.id)}
                style={{
                  ...SA_TYPE.body, fontSize: 13, border: 0, borderRadius: 7, padding: '9px 14px', minHeight: 36, cursor: 'pointer',
                  background: preset === p.id ? SA.surface2 : 'transparent',
                  color: preset === p.id ? SA.text : SA.muted,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ ...SA_TYPE.body, fontSize: 13, padding: '6px 8px', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 6, color: SA.text }} />
              <span style={{ fontSize: 12, color: SA.faint }}>to</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ ...SA_TYPE.body, fontSize: 13, padding: '6px 8px', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 6, color: SA.text }} />
            </div>
          )}

          <button
            onClick={handleSync}
            disabled={syncing}
            style={{ ...SA_TYPE.body, fontSize: 13, fontWeight: 500, background: 'transparent', color: SA.text, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, padding: '0 16px', height: 44, cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.6 : 1 }}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>

          <div ref={exportMenuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setExportMenuOpen(o => !o)}
              style={{ ...SA_TYPE.body, fontSize: 13, fontWeight: 600, background: SA.accent, color: SA.ground, border: 0, borderRadius: SA_SHAPE.radiusInner, padding: '0 18px', height: 44, cursor: 'pointer' }}
            >
              Export report
            </button>
            {exportMenuOpen && (
              <div style={{ position: 'absolute', right: 0, top: 48, zIndex: 10, background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, padding: 4, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                <button onClick={handlePrint} style={{ ...SA_TYPE.body, fontSize: 13, display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', background: 'transparent', border: 0, borderRadius: 7, color: SA.text, cursor: 'pointer' }}>PDF</button>
                <button onClick={handleDownloadAllCsvs} style={{ ...SA_TYPE.body, fontSize: 13, display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', background: 'transparent', border: 0, borderRadius: 7, color: SA.text, cursor: 'pointer' }}>Download all CSVs</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="no-print" style={{ fontSize: 13, color: SA.bad, padding: '10px 14px', background: SA_BAD_BG, border: `1px solid ${SA_BAD_BORDER}`, borderRadius: SA_SHAPE.radiusInner, marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      <div id="sales-analytics-print-area">
        {/* Print-only header - never shown on screen (dashboard-v2 Stage 5,
            restyled design-v1 Stage 4). No developer/placeholder text
            (DECIDED "honesty and labels"): the Goals & Weekly Priorities
            reserved-slot box is gone - sales-goals-v1 renders its real
            block when it ships, same "render nothing until it's real"
            rule the Weekly Scorecard slot already follows. The filters
            line is SequenceLeaderboard's own readable sentence (built in
            its onFiltersChanged, not a raw "key: value" dump) - no
            separate "Filters applied:" label needed, the sentence already
            reads as one. Section order is still a flagged interim: no
            scorecard or Seif's 15-section report exist in this codebase
            yet (separate, un-started SPECs), so this prints the
            dashboard's own existing widget order. */}
        <div className="print-only" style={{ marginBottom: 16 }}>
          <p style={{ ...SA_TYPE.cardTitle, fontSize: 16, color: SA.text, margin: '0 0 4px' }}>
            HomeLover · Sales Analytics · {presetLabel} ({period.from} – {period.to}) · as of {lastSyncLabel}
          </p>
          {filterSummary && (
            <p style={{ ...SA_TYPE.body, fontSize: 11, color: SA.muted, margin: 0 }}>{filterSummary}</p>
          )}
        </div>

        {!loading && <AlertsRow allRows={allRows} entities={entities} runs={runs} />}

        {loading ? (
          <p style={{ ...SA_TYPE.body, fontSize: 13, color: SA.muted }}>Loading…</p>
        ) : (
          groupWidgetsIntoRows(WIDGETS.filter(w => w.enabled).sort((a, b) => a.defaultOrder - b.defaultOrder)).map(row => (
            <div key={row.widgets.map(w => w.id).join('+')} className={row.className ? `${row.className} print-avoid-break` : undefined} style={{ marginBottom: 12, display: row.className ? 'grid' : undefined, gap: row.className ? 12 : undefined }}>
              {row.widgets.map(w => (
                <div key={w.id} className={row.className ? undefined : 'print-avoid-break'} style={{ padding: '22px 24px', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusCard }}>
                  <p style={{ ...SA_TYPE.cardTitle, color: SA.text, margin: '0 0 14px' }}>{w.title}</p>
                  <w.component businessId={businessId} allRows={allRows} periodRows={periodRows} prevPeriodRows={prevPeriodRows} prevPeriod={prevPeriod} compareEnabled={compareEnabled} entities={entities} cohortBreakdown={cohortBreakdown} accent={SA.accent} widgetId={w.id} onDataChanged={load} onFiltersChanged={setFilterSummary} />
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      </div>
    </div>
  );
}
