import { useState, useEffect, useCallback } from 'react';
import { C, mono } from '../../constants/colors';
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
`;

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

const STATUS_COLOR = { success: C.green, partial: C.orange, error: C.red, running: C.blue };

export default function SalesAnalyticsTab({ businessId, accent = C.gold }) {
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

  const handlePrint = () => window.print();

  return (
    <div>
      <style>{PRINT_STYLES}</style>

      {/* Header - hidden in print; the print-only block below replaces it */}
      <div className="no-print" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 20, padding: '12px 14px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: lastRun ? (STATUS_COLOR[lastRun.status] || C.dim) : C.dim, flexShrink: 0 }} />
          <span style={{ ...mono, fontSize: 11, color: C.mut }}>
            Last synced {relativeTime(lastRun?.finished_at || lastRun?.started_at)}
            {lastRun?.counts?.apollo_calls != null && ` · ${lastRun.counts.apollo_calls} Apollo calls`}
          </span>
        </div>

        <button
          onClick={handleSync}
          disabled={syncing}
          style={{ ...mono, fontSize: 11, padding: '5px 12px', borderRadius: 5, background: accent, border: `1px solid ${accent}`, color: C.bg, fontWeight: 700, cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.6 : 1 }}
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        {syncMessage && <span style={{ ...mono, fontSize: 11, color: C.orange }}>{syncMessage}</span>}

        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {PERIOD_PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              style={{
                ...mono, fontSize: 10, padding: '4px 9px', borderRadius: 5, cursor: 'pointer',
                background: preset === p.id ? `${accent}22` : 'transparent',
                border: `1px solid ${preset === p.id ? accent : C.brd}`,
                color: preset === p.id ? accent : C.mut,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ ...mono, fontSize: 11, padding: '3px 6px', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 4, color: C.txt }} />
            <span style={{ ...mono, fontSize: 10, color: C.dim }}>to</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ ...mono, fontSize: 11, padding: '3px 6px', background: C.bg, border: `1px solid ${C.brd}`, borderRadius: 4, color: C.txt }} />
          </div>
        )}

        <label style={{ ...mono, fontSize: 11, color: C.mut, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={compareEnabled} onChange={e => setCompareEnabled(e.target.checked)} />
          Compare to previous period
        </label>

        <button
          onClick={handlePrint}
          style={{ ...mono, fontSize: 11, padding: '5px 12px', borderRadius: 5, background: 'transparent', border: `1px solid ${C.brd}`, color: C.mut, cursor: 'pointer' }}
        >
          Export PDF
        </button>
      </div>

      {error && (
        <div className="no-print" style={{ ...mono, fontSize: 12, color: C.red, padding: '10px 14px', background: `${C.red}0F`, border: `1px solid ${C.red}44`, borderRadius: 8, marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      <div id="sales-analytics-print-area">
        {/* Print-only header - never shown on screen (dashboard-v2 Stage 5).
            "Goals & Weekly Priorities" is a reserved, explicitly-empty slot -
            sales-goals-v1 fills it; not built here. Section order below this
            point is a flagged interim: no scorecard or Seif's 15-section
            report exist in this codebase yet (both are separate, un-started
            SPECs), so this prints the dashboard's own existing widget order,
            not a scorecard-first order. */}
        <div className="print-only" style={{ marginBottom: 16 }}>
          <p style={{ ...mono, fontSize: 16, fontWeight: 700, color: '#000', margin: '0 0 4px' }}>
            HomeLover · Sales Analytics · {presetLabel} ({period.from} – {period.to}) · as of {lastSyncLabel}
          </p>
          <p style={{ ...mono, fontSize: 10, color: '#444', margin: '0 0 10px' }}>
            Filters applied: {filterSummary || 'default (Active sequences, all cohorts, all senders)'}
          </p>
          <div style={{ padding: '10px 12px', border: '1px dashed #999', borderRadius: 4, marginBottom: 4 }}>
            <p style={{ ...mono, fontSize: 11, color: '#666', margin: 0 }}>
              Goals &amp; Weekly Priorities — reserved slot, filled by sales-goals-v1 (not yet built)
            </p>
          </div>
        </div>

        {loading ? (
          <p style={{ ...mono, fontSize: 13, color: C.dim }}>Loading…</p>
        ) : (
          WIDGETS.filter(w => w.enabled).sort((a, b) => a.defaultOrder - b.defaultOrder).map(w => {
            const Widget = w.component;
            return (
              <div key={w.id} className="print-avoid-break" style={{ marginBottom: 24, padding: '16px 18px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8 }}>
                <p style={{ ...mono, fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>{w.title}</p>
                <Widget businessId={businessId} allRows={allRows} periodRows={periodRows} prevPeriodRows={prevPeriodRows} compareEnabled={compareEnabled} entities={entities} cohortBreakdown={cohortBreakdown} accent={accent} widgetId={w.id} onDataChanged={load} onFiltersChanged={setFilterSummary} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
