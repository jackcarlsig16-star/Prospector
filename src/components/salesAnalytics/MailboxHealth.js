import { SA } from './theme';
import { formatValue } from './computeMetric';
import { exportWidgetCsv } from './exportCsv';
import { cardStyle, numStyle } from './goals/goalsUi';

// overview-home-v1 Stage 2 / dashboard-v3 Stage 4 (M): one tile per mailbox for the period, from GET goals/pulse?scope=
// email (tiles): NAME never the address · a health pill · sent + delivered % (or spam % once any spam block) · a bar of
// sends per weekday against the cap (Apollo's daily threshold, 50 unset); warn border at ≥ 95 % of the cap; 0 sends =
// idle; a connection problem = reconnect. Every number is the route's.
const PILL = {
  healthy: { word: '✓ healthy', color: SA.good },
  at_capacity: { word: '! at capacity', color: SA.warn },
  idle: { word: 'idle', color: SA.muted },
  reconnect: { word: '! reconnect', color: SA.bad },
};
const pct = v => formatValue(v, 'percent');
export const tileLine = t => (t.sent === 0 ? 'nothing sent' : `${formatValue(t.sent, 'number')} sent · ${t.spam_blocked > 0 ? `${pct(t.spam_rate)} spam` : `${pct(t.delivered_rate)} delivered`}`);

export default function MailboxHealth({ tiles, periodLabel, widgetId = 'mailbox_health' }) {
  const cap = tiles?.[0]?.cap || 50;
  const handleExport = () => exportWidgetCsv(widgetId, tiles || [], [
    { label: 'Mailbox', key: 'label' }, { label: 'Status', key: 'status' }, { label: 'Sent', key: 'sent' }, { label: 'Delivered %', value: t => pct(t.delivered_rate) },
    { label: 'Hard bounce %', value: t => pct(t.hard_bounce_rate) }, { label: 'Spam %', value: t => pct(t.spam_rate) }, { label: 'Sends per weekday', value: t => t.per_weekday.toFixed(1) }, { label: 'Cap per day', key: 'cap' },
  ]);
  return (
    <section aria-labelledby="h-mailboxes" data-mailboxes={tiles ? tiles.length : 'loading'} style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h2 id="h-mailboxes" style={{ margin: 0, fontSize: 15, fontWeight: 600, color: SA.text }}>Mailboxes</h2>
        <span style={{ fontSize: 12, color: SA.muted }}>{periodLabel} · cap {cap} / day each{tiles?.length ? <> · <button type="button" className="ui-link" onClick={handleExport}>Export CSV</button></> : null}</span>
      </div>
      {!tiles && <span style={{ fontSize: 12, color: SA.muted }}>Loading…</span>}
      {tiles && !tiles.length && <span style={{ fontSize: 12, color: SA.muted }}>No mailbox data yet.</span>}
      {tiles?.map(t => {
        const pill = PILL[t.status] || PILL.healthy;
        const p = Math.min(100, Math.round((t.per_weekday / (t.cap || cap)) * 100));
        return (
          <div key={t.key} data-mailbox-tile={t.key} data-status={t.status} title={t.why || undefined} style={{ ...cardStyle, borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, borderColor: t.status === 'at_capacity' ? SA.warn : t.status === 'reconnect' ? SA.bad : SA.border }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <b style={{ fontSize: 14, fontWeight: 600, color: SA.text }}>{t.label}</b>
              <span data-pill style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px', borderRadius: 999, border: `1px solid ${pill.color}`, color: pill.color, fontSize: 11, whiteSpace: 'nowrap' }}>{pill.word}</span>
            </div>
            <div style={{ ...numStyle, fontSize: 22, fontWeight: 600, color: SA.text }}>
              {t.sent === 0 ? <span style={{ fontSize: 13, fontWeight: 400, color: SA.muted }}>nothing sent</span> : <>{formatValue(t.sent, 'number')} <small style={{ fontSize: 12, color: SA.muted, fontWeight: 400 }}>{tileLine(t).replace(/^[\d,]+ /, '')}</small></>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span role="img" aria-label={`${t.per_weekday.toFixed(1)} of ${t.cap || cap} sends per weekday`} style={{ flex: 1, height: 4, borderRadius: 999, background: 'rgba(120,130,144,.25)', position: 'relative', overflow: 'hidden', display: 'block' }}>
                <span data-cap-bar style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${p}%`, background: t.status === 'at_capacity' ? SA.warn : SA.accent, borderRadius: 999 }} />
              </span>
              <span style={{ ...numStyle, fontSize: 11, color: SA.muted, whiteSpace: 'nowrap' }}>{t.per_weekday % 1 ? t.per_weekday.toFixed(1) : t.per_weekday} / {t.cap || cap} per day</span>
            </div>
          </div>
        );
      })}
      <span style={{ fontSize: 11, color: SA.faint }}>Addresses are never shown. Sends per weekday = the period's sends ÷ its weekdays so far; the cap is Apollo's daily threshold.</span>
    </section>
  );
}
