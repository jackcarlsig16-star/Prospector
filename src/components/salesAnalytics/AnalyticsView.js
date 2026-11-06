import { useState, useEffect, useCallback, useRef } from 'react';
import useMediaQuery from '../../utils/useMediaQuery';
import { createPortal } from 'react-dom';
import { SA, SA_SHAPE, SA_THEME_ROOT_ID } from './theme';
import { FRAME_TOOLS_ID } from './salesFrame';
import { visibleWidgets } from './widgets.registry';
import { fetchMetrics, fetchRuns, fetchEntities, fetchCohortBreakdown, fetchInsights, fetchSequenceSteps, triggerSync } from './salesApi';
import { fetchOpportunities } from './pipelineApi';
import { laDateString } from './periods';
import { goalsApi } from './goals/goalsApi';
import Segmented from '../../ui/Segmented';
import { PERIODS, DEFAULT_PERIOD } from './goals/HomeView';
import { PulseGrid, md, agoOf } from './goals/PulseTiles';
import ExplorerView from './goals/ExplorerView';
import InsightsPanel from './InsightsPanel';
import MailboxHealth from './MailboxHealth';
import SequenceLeaderboard from './SequenceLeaderboard';
import { flashTo, ErrorNote, Btn } from './goals/goalsUi';

// dashboard-v3 Stage 4 (M, DashEmail.dc.html) - Dashboard › Email. Tools in the frame row: PERIOD (the Pulse windows) ·
// Sync now (Members; the existing Apollo sync) · Export (Print · every CSV on the page). Title "Email · <from> – <to> vs
// <prev> · Apollo sequences, opens, replies · synced n h ago". PULSE (email) over GET goals/pulse?scope=email: Sent ·
// Delivered · Hard bounce (down = good) · Spam blocks (down = good) · Human opens · Replies · Meetings. EXPLORER with
// the email defaults (six delivery layers, 9 weeks, split Mailbox, tall; the band draws because hard bounce / spam are
// on). WHY (1.6fr) = every live insight as a compact row + Dismissed ▾; MAILBOXES (1fr) = the pulse's tiles; SEQUENCES =
// the DataTable with per-step rows. The pipeline widgets stay for a workspace without goals_sales (registry; Stage 5).
const EMAIL_LAYERS = ['sent', 'delivered_rate', 'hard_bounce_rate', 'spam_rate', 'human_open_rate', 'reply_rate'];
const EXPLORER_DEFAULTS = { layers: EMAIL_LAYERS, show: 'lines', by: 'week', split: 'mailbox', height: 'tall' };
const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const pts = r => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);
export const EMAIL_TILES = [
  { key: 'sent', label: 'Sent', src: m => `${fmt(m.delivered)} delivered · ${m.mailboxes} mailbox${m.mailboxes === 1 ? '' : 'es'}` },
  { key: 'delivered_rate', label: 'Delivered', src: m => `of sent · by send date` },
  { key: 'hard_bounce_rate', label: 'Hard bounce', src: m => `${fmt(m.hard_bounced)} hard bounce${m.hard_bounced === 1 ? '' : 's'} · down = good` },
  { key: 'spam_blocks', label: 'Spam blocks', src: m => `${pts(m.rate)} of sent${m.top_mailbox ? ` · ${m.top_mailbox}` : ''} · down = good` },
  { key: 'human_open_rate', label: 'Human opens', src: m => `${fmt(m.opens_tracked)} tracked · bots hidden` },
  { key: 'reply_rate', label: 'Replies', src: m => `${fmt(m.replied)} of ${fmt(m.delivered)}` },
  { key: 'meetings', label: 'Meetings', src: m => m.source },
];
const relativeTime = iso => agoOf(iso) || 'never';
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export default function AnalyticsView({ businessId, features, canEdit, focusWidget, onFocused }) {
  const narrow = useMediaQuery('(max-width: 899px)');
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [pulse, setPulse] = useState(null);
  const [pulseError, setPulseError] = useState('');
  const [insights, setInsights] = useState(null);
  const [entities, setEntities] = useState({ sequences: [], mailboxes: [] });
  const [allRows, setAllRows] = useState([]);
  const [steps, setSteps] = useState(null);
  const [runs, setRuns] = useState([]);
  const [extra, setExtra] = useState({ cohortBreakdown: {}, opportunities: [] });
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [toolsSlot, setToolsSlot] = useState(null);
  const exportMenuRef = useRef(null);
  useEffect(() => { setToolsSlot(document.getElementById(FRAME_TOOLS_ID)); }, []);
  const widgets = visibleWidgets(features);

  const loadPulse = useCallback(() => {
    setPulseError('');
    return goalsApi.pulse(businessId, { period, scope: 'email' }).then(setPulse).catch(e => setPulseError(e.message));
  }, [businessId, period]);
  useEffect(() => { loadPulse(); }, [loadPulse]);
  const load = useCallback(async () => {
    setError('');
    try {
      const today = laDateString();
      const [latestInsights, latestEntities, metrics, latestSteps, latestRuns, breakdown, opps] = await Promise.all([
        fetchInsights(businessId).catch(e => ({ error: e.message, insights: [], not_enough_data: [], dismissed: [] })),
        fetchEntities(businessId),
        fetchMetrics(businessId, addDays(today, -14), today),
        fetchSequenceSteps(businessId),
        fetchRuns(businessId, 5),
        widgets.length ? fetchCohortBreakdown(businessId) : Promise.resolve({ breakdown: {} }),
        widgets.length ? fetchOpportunities(businessId) : Promise.resolve([]),
      ]);
      setInsights(latestInsights); setEntities(latestEntities); setAllRows(metrics); setSteps(latestSteps); setRuns(latestRuns);
      setExtra({ cohortBreakdown: breakdown.breakdown || {}, opportunities: opps });
    } catch (e) { setError(e.message); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!exportMenuOpen) return undefined;
    const onClick = e => { if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setExportMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [exportMenuOpen]);
  useEffect(() => {
    if (!focusWidget) return undefined;
    const t = setTimeout(() => { flashTo(`sa-widget-${focusWidget}`); onFocused?.(); }, 150);
    return () => clearTimeout(t);
  }, [focusWidget, onFocused]);

  const reloadInsights = useCallback(async () => { setInsights(await fetchInsights(businessId)); }, [businessId]);
  const handleSync = async () => {
    setSyncing(true); setSyncMessage('');
    try {
      const run = await triggerSync(businessId);
      setSyncMessage(run.status === 'success' ? 'Sync complete.' : `Sync finished: ${run.status}${run.error_text ? ` (${run.error_text})` : ''}`);
      await Promise.all([load(), loadPulse()]);
    } catch (e) { setSyncMessage(e.message); } finally { setSyncing(false); }
  };
  const handlePrint = () => { setExportMenuOpen(false); window.print(); };
  const handleDownloadAllCsvs = () => { setExportMenuOpen(false); document.querySelectorAll('#sales-analytics-print-area button').forEach(btn => { if (btn.textContent.trim() === 'Export CSV') btn.click(); }); };

  const lastRun = runs.find(r => r.finished_at && ['success', 'partial'].includes(r.status)) || runs[0];
  const lastFailed = runs[0]?.status === 'error' ? runs[0] : null;
  const syncedAt = pulse?.synced_at || lastRun?.finished_at || lastRun?.started_at;
  const periodLabel = PERIODS.find(([id]) => id === period)?.[1] || 'This week';
  const title = pulse ? `${md(pulse.from)} – ${md(pulse.to)} vs ${md(pulse.prev.from)} – ${md(pulse.prev.to)} · Apollo sequences, opens, replies · synced ${relativeTime(syncedAt)}${pulse.apollo_calls != null ? ` · ${fmt(pulse.apollo_calls)} Apollo calls` : ''}` : pulseError ? '' : 'Loading…';
  const tools = toolsSlot && createPortal(
    <>
      <Segmented label="Period" items={PERIODS.map(([id, label]) => ({ id, label }))} value={period} onChange={setPeriod} />
      {canEdit && <Btn onClick={handleSync} disabled={syncing} title={syncing ? 'A sync is running' : 'Sync Apollo (sequences, opens, replies)'}>{syncing ? 'Syncing…' : 'Sync now'}</Btn>}
      <Btn primary id="sales-export-btn" aria-haspopup="menu" aria-expanded={exportMenuOpen} onClick={() => setExportMenuOpen(o => !o)}>Export</Btn>
    </>,
    toolsSlot,
  );
  const exportRect = exportMenuOpen && document.getElementById('sales-export-btn')?.getBoundingClientRect();
  const exportMenu = exportOpenMenu(exportMenuOpen && exportRect, exportMenuRef, exportRect, handlePrint, handleDownloadAllCsvs);

  return (
    <div data-email-view style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      {tools}
      {exportMenu}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: '-0.025em', color: SA.text }}>{period === 'this_week' ? 'Email' : `Email · ${periodLabel}`}</h1>
        <span data-email-title style={{ color: SA.muted, fontVariantNumeric: 'tabular-nums' }}>{title}</span>
        {lastFailed && <span style={{ color: SA.bad, fontSize: 13 }} title={lastFailed.error_text || ''}>· last sync failed</span>}
      </div>
      {syncMessage && <span role="status" style={{ fontSize: 12, color: SA.warn }}>{syncMessage}</span>}
      {(error || pulseError) && <ErrorNote message={error || pulseError} />}
      {pulse && <PulseGrid tiles={EMAIL_TILES} metrics={pulse.metrics} period={period} />}
      <div id="sales-analytics-print-area" style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <div className="print-only" style={{ fontSize: 14, fontWeight: 600, color: SA.text }}>HomeLover · Email · {title}</div>
        <ExplorerView businessId={businessId} canEdit={canEdit} context="email" defaults={EXPLORER_DEFAULTS} sub="email delivery efficiency and engagement on one chart · 9 weeks" />
        <div data-why-mailboxes style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 16, minWidth: 0 }}>
          <div id="sa-widget-email_insights" style={{ ...card }}><InsightsPanel businessId={businessId} insights={insights} canEdit={canEdit} onInsightsChanged={reloadInsights} onOpenExplorer={() => flashTo('h-explorer')} /></div>
          <div id="sa-widget-mailbox_health" style={{ ...card }}><MailboxHealth tiles={pulse?.mailboxes || null} periodLabel={periodLabel.toLowerCase()} /></div>
        </div>
        <div id="sa-widget-sequence_leaderboard" style={{ ...card }}>
          <SequenceLeaderboard businessId={businessId} allRows={allRows} entities={entities} steps={steps} canEdit={canEdit} onDataChanged={load} />
        </div>
        {widgets.map(w => (
          <div key={w.id} id={`sa-widget-${w.id}`} className="print-avoid-break" style={{ ...card }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: SA.text }}>{w.title}</h2>
            <w.component businessId={businessId} allRows={allRows} periodRows={allRows} prevPeriodRows={[]} period={pulse ? { from: pulse.from, to: pulse.to } : null} prevPeriod={pulse?.prev || null} preset={period} compareEnabled={false} entities={entities} cohortBreakdown={extra.cohortBreakdown} opportunities={extra.opportunities} canEdit={canEdit} widgetId={w.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
const card = { background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 14, padding: '18px 20px', minWidth: 0 };
function exportOpenMenu(open, ref, rect, onPrint, onCsvs) {
  if (!open) return null;
  return createPortal(
    <div ref={ref} role="menu" className="no-print" style={{ position: 'fixed', right: window.innerWidth - rect.right, top: rect.bottom + 4, zIndex: 4010, minWidth: 200, background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <button type="button" role="menuitem" className="ui-btn ui-btn--secondary ui-btn--block" style={{ border: 0 }} onClick={onPrint}>Print / PDF</button>
      <button type="button" role="menuitem" className="ui-btn ui-btn--secondary ui-btn--block" style={{ border: 0 }} onClick={onCsvs}>Download all CSVs</button>
    </div>,
    document.getElementById(SA_THEME_ROOT_ID) || document.body,
  );
}
