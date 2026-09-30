import { useState, useEffect, useCallback } from 'react';
import { C, mono } from '../../constants/colors';
import { WIDGETS } from './widgets.registry';
import { fetchMetrics, fetchRuns, fetchEntities, triggerSync } from './salesApi';
import { PERIOD_PRESETS, periodRange, previousPeriodRange, laDateString } from './periods';

const SPARKLINE_LOOKBACK_DAYS = 56; // ~8 weeks

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

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

      const [metrics, latestRuns, latestEntities] = await Promise.all([
        fetchMetrics(businessId, from, to),
        fetchRuns(businessId, 5),
        fetchEntities(businessId),
      ]);
      setAllRows(metrics);
      setRuns(latestRuns);
      setEntities(latestEntities);
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

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 20, padding: '12px 14px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8 }}>
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
      </div>

      {error && (
        <div style={{ ...mono, fontSize: 12, color: C.red, padding: '10px 14px', background: `${C.red}0F`, border: `1px solid ${C.red}44`, borderRadius: 8, marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      {loading ? (
        <p style={{ ...mono, fontSize: 13, color: C.dim }}>Loading…</p>
      ) : (
        WIDGETS.filter(w => w.enabled).sort((a, b) => a.defaultOrder - b.defaultOrder).map(w => {
          const Widget = w.component;
          return (
            <div key={w.id} style={{ marginBottom: 24, padding: '16px 18px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8 }}>
              <p style={{ ...mono, fontSize: 10, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>{w.title}</p>
              <Widget allRows={allRows} periodRows={periodRows} prevPeriodRows={prevPeriodRows} compareEnabled={compareEnabled} entities={entities} accent={accent} />
            </div>
          );
        })
      )}
    </div>
  );
}
