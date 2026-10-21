import { useState, useEffect, useCallback, useRef } from 'react';
import { SA, SA_TYPE, SA_SHAPE, SA_BAD_BG, SA_BAD_BORDER } from './theme';
import AlertsRow from './AlertsRow';
import { flashTo } from './goals/goalsUi';
import OverviewGoals from './goals/OverviewGoals';
import { visibleWidgets } from './widgets.registry';
import { fetchMetrics, fetchRuns, fetchEntities, fetchCohortBreakdown, fetchInsights, fetchEmailCounts, fetchWeekStrip, triggerSync } from './salesApi';
import { fetchOpportunities } from './pipelineApi';
import { PERIOD_PRESETS, periodRange, previousPeriodRange, laDateString } from './periods';

const SPARKLINE_LOOKBACK_DAYS = 56; // ~8 weeks
const EMAIL_TRACKED_LOOKBACK_DAYS = 91; // the strip's 8 weeks + the 4-week avg's compare window

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

// sales-ia-v1 - the old "Overview" tab, now Reports › Analytics. Period
// presets, Sync now and Export report stay in here (Design C). design-v1's
// "ONE accent" rule still applies: SA.accent, never the business's color.
// focusWidget: a widget id a Goals number opened; flashed once the widgets exist.
export default function AnalyticsView({ businessId, features, canEdit, onOpenGoals, onOpenHuddle, focusWidget, onFocused }) {
  const [preset, setPreset] = useState('this_week');
  const [customFrom, setCustomFrom] = useState(laDateString());
  const [customTo, setCustomTo] = useState(laDateString());
  const [compareEnabled, setCompareEnabled] = useState(true); // overview-home-v1: the week strip reads "this week vs last" by default

  const [allRows, setAllRows] = useState([]);
  const [runs, setRuns] = useState([]);
  const [entities, setEntities] = useState({ sequences: [], mailboxes: [] });
  const [cohortBreakdown, setCohortBreakdown] = useState({});
  const [opportunities, setOpportunities] = useState([]);
  const [insights, setInsights] = useState(null);
  const [emailData, setEmailData] = useState(null); // { emailRows, days, senders, manualMeetings } - shared by the strip, the chart and the mailbox table
  const [humanOpens, setHumanOpens] = useState(true); // R9's toggle: human-open estimate on the strip + the chart
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

      const trackedFrom = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - EMAIL_TRACKED_LOOKBACK_DAYS); return laDateString(d); })();
      const [metrics, latestRuns, latestEntities, latestCohortBreakdown, latestOpportunities, latestInsights, counts, strip] = await Promise.all([
        fetchMetrics(businessId, from, to),
        fetchRuns(businessId, 5),
        fetchEntities(businessId),
        fetchCohortBreakdown(businessId),
        fetchOpportunities(businessId),
        // A failing insights request shouldn't take the whole page down.
        fetchInsights(businessId).catch(e => ({ error: e.message, insights: [], not_enough_data: [], dismissed: [] })),
        fetchEmailCounts(businessId),
        fetchWeekStrip(businessId, trackedFrom),
      ]);
      setInsights(latestInsights);
      setEmailData({ emailRows: counts.rows, incompleteWeeks: counts.incomplete_weeks, days: strip.days, senders: strip.senders, manualMeetings: strip.manual_meetings });
      setAllRows(metrics);
      setRuns(latestRuns);
      setEntities(latestEntities);
      setCohortBreakdown(latestCohortBreakdown.breakdown || {});
      setOpportunities(latestOpportunities);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, preset, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (loading || !focusWidget) return;
    const t = setTimeout(() => { flashTo(`sa-widget-${focusWidget}`); onFocused(); }, 150);
    return () => clearTimeout(t);
  }, [loading, focusWidget, onFocused]);

  // Shared by the alerts row and the insights panel - refreshed on its own
  // after a dismiss, without reloading every widget.
  const reloadInsights = useCallback(async () => {
    setInsights(await fetchInsights(businessId));
  }, [businessId]);

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

  // runs come back with stuck 'running' rows already reported as failed.
  const lastRun = runs.find(r => r.finished_at && ['success', 'partial'].includes(r.status)) || runs[0];
  const lastFailed = runs[0]?.status === 'error' ? runs[0] : null;
  const periodRows = rowsInRange(allRows, period.from, period.to);
  const prevPeriodRows = compareEnabled ? rowsInRange(allRows, prevPeriod.from, prevPeriod.to) : [];

  const presetLabel = PERIOD_PRESETS.find(p => p.id === preset)?.label || preset;
  const lastSyncLabel = lastRun?.finished_at ? new Date(lastRun.finished_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';

  const handlePrint = () => { setExportMenuOpen(false); window.print(); };

  // design-v1 - there's no single combined "report CSV" in this feature's
  // data model (every CSV export is per-widget, by design), so "Download all
  // CSVs" runs each currently-enabled widget's own existing export in sequence.
  const handleDownloadAllCsvs = () => {
    setExportMenuOpen(false);
    document.querySelectorAll('#sales-analytics-print-area button').forEach(btn => {
      if (btn.textContent.trim() === 'Export CSV') btn.click();
    });
  };

  return <>
      {/* Header - hidden in print; the print-only block below replaces it */}
      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 13, color: SA.muted }}>
            <span>{presetLabel} ({period.from} – {period.to})</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: lastRun ? (STATUS_COLOR[lastRun.status] || SA.faint) : SA.faint, display: 'inline-block' }} />
              Synced {relativeTime(lastRun?.finished_at || lastRun?.started_at)}
              {lastRun?.counts?.apollo_calls != null && ` · ${lastRun.counts.apollo_calls} Apollo calls`}
            </span>
            {lastFailed && <span style={{ color: SA.bad }} title={lastFailed.error_text || ''}>· last sync failed</span>}
          </div>
          {syncMessage && <span style={{ fontSize: 12, color: SA.warn }}>{syncMessage}</span>}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: SA.muted, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', marginRight: 4 }}>
            <input type="checkbox" checked={compareEnabled} onChange={e => setCompareEnabled(e.target.checked)} />
            Compare to previous period
          </label>

          {/* ui-clarity-v1 R2: the period presets are the kit segmented control (R7 label beside it). */}
          <span className="ui-group-label" aria-hidden="true">Period</span>
          <div role="group" aria-label="Period" className="ui-seg">
            {PERIOD_PRESETS.map(p => (
              <button key={p.id} type="button" className="ui-seg__btn" aria-pressed={preset === p.id} onClick={() => setPreset(p.id)} style={{ height: 36 }}>{p.label}</button>
            ))}
          </div>

          {preset === 'custom' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ ...SA_TYPE.body, fontSize: 13, padding: '6px 8px', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 6, color: SA.text }} />
              <span style={{ fontSize: 12, color: SA.faint }}>to</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ ...SA_TYPE.body, fontSize: 13, padding: '6px 8px', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 6, color: SA.text }} />
            </div>
          )}

          <button type="button" className="ui-btn ui-btn--secondary" onClick={handleSync} disabled={syncing} title={syncing ? 'A sync is running' : undefined} style={{ height: 44, padding: '0 16px', borderRadius: SA_SHAPE.radiusInner }}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>

          <div ref={exportMenuRef} style={{ position: 'relative' }}>
            <button type="button" className="ui-btn ui-btn--primary" aria-haspopup="menu" aria-expanded={exportMenuOpen} onClick={() => setExportMenuOpen(o => !o)} style={{ height: 44, padding: '0 18px', borderRadius: SA_SHAPE.radiusInner, fontWeight: 600 }}>
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
        {/* Print-only header - never shown on screen (dashboard-v2 Stage 5).
            The filters line is SequenceLeaderboard's own readable sentence
            (built in its onFiltersChanged). Section order is the dashboard's
            own widget order (printOrder in widgets.registry.js). */}
        <div className="print-only" style={{ marginBottom: 16 }}>
          <p style={{ ...SA_TYPE.cardTitle, fontSize: 16, color: SA.text, margin: '0 0 4px' }}>
            HomeLover · Sales Analytics · {presetLabel} ({period.from} – {period.to}) · as of {lastSyncLabel}
          </p>
          {filterSummary && (
            <p style={{ ...SA_TYPE.body, fontSize: 11, color: SA.muted, margin: 0 }}>{filterSummary}</p>
          )}
        </div>

        <OverviewGoals businessId={businessId} onOpenGoals={onOpenGoals} onFocusWidget={id => flashTo(`sa-widget-${id}`)} />
        {!loading && <AlertsRow runs={runs} insights={insights} />}

        {loading ? (
          <p style={{ ...SA_TYPE.body, fontSize: 13, color: SA.muted }}>Loading…</p>
        ) : (
          <div className="sa-widget-list">
          {visibleWidgets(features).map(w => (
            <div key={w.id} id={`sa-widget-${w.id}`} className={`print-avoid-break${w.printPage ? ' sa-band-start' : ''}`} style={{ marginBottom: 12, order: w.printOrder, padding: '22px 24px', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusCard }}>
              <p style={{ ...SA_TYPE.cardTitle, color: SA.text, margin: '0 0 14px' }}>{w.title}</p>
              <w.component businessId={businessId} allRows={allRows} periodRows={periodRows} prevPeriodRows={prevPeriodRows} period={period} prevPeriod={prevPeriod} preset={preset} compareEnabled={compareEnabled} entities={entities} cohortBreakdown={cohortBreakdown} opportunities={opportunities} accent={SA.accent} widgetId={w.id} onDataChanged={load} onPipelineChanged={load} onFiltersChanged={setFilterSummary} insights={insights} onInsightsChanged={reloadInsights} onOpenGoals={onOpenGoals} onOpenHuddle={onOpenHuddle} emailData={emailData} humanOpens={humanOpens} onToggleHumanOpens={() => setHumanOpens(h => !h)} canEdit={canEdit} lastRun={lastRun} />
            </div>
          ))}
          </div>
        )}
      </div>
  </>;
}
