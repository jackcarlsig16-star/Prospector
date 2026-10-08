import { SA, SA_TYPE, SA_SHAPE, SA_BAD_BG } from './theme';
import { formatValue } from './computeMetric';
import { bounceHealthColor } from './palette';
import { perSender } from './weekStripData';
import { shortDate } from './emailTrendData';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';
import TimeChip from './TimeChip';
import { mailboxConnectionProblem, mailboxErrorNote, MAILBOX_SYNC_STALE_HOURS } from '../../utils/mailboxStatus';

// overview-home-v1 Stage 2 - one row per sender over the page's period,
// from Apollo's daily counts by mailbox (every message) plus the tracked
// human share by sender, so Cyrus's open rate sits next to Jack's. Status:
// Reconnect = Apollo reports the mailbox inactive / revoked / needs
// re-auth; Stale = Apollo hasn't synced it in 24h+ or it sent nothing in
// the last 7 days; else OK. The mailbox address is the business's own
// sending address, never prospect data.
const STALE_SEND_DAYS = 7;

const truncate160 = s => (!s ? '' : s.length > 160 ? s.slice(0, 160) + '…' : s);
const addDays = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function mailboxStatus(row, entity, today) {
  const problem = entity ? mailboxConnectionProblem(entity) : null;
  if (problem && !problem.startsWith('Not synced')) return { word: 'Reconnect', tone: 'bad', why: problem };
  if (problem) return { word: 'Stale', tone: 'warn', why: problem };
  if (!row.last_send_day || row.last_send_day < addDays(today, -STALE_SEND_DAYS)) return { word: 'Stale', tone: 'warn', why: row.last_send_day ? `Nothing sent since ${shortDate(row.last_send_day)}` : 'Nothing sent yet' };
  return { word: 'OK', tone: 'good', why: `Sent ${shortDate(row.last_send_day)}` };
}

const COLUMNS = [
  { id: 'mailbox', label: 'Mailbox', align: 'left' },
  { id: 'sent', label: 'Sent', align: 'right' },
  { id: 'delivered_rate', label: 'Delivered', align: 'right' },
  { id: 'bounce_rate', label: 'Bounce', align: 'right' },
  { id: 'spam_blocked', label: 'Spam', align: 'right' },
  { id: 'open_rate', label: 'Apollo open', align: 'right' },
  { id: 'human_open_rate', label: 'Human open (est.)', align: 'right' },
  { id: 'reply_rate', label: 'Reply', align: 'right' },
  { id: 'last_sync', label: 'Last sync', align: 'left' },
  { id: 'status', label: 'Status', align: 'left' },
];
const TONE = { good: SA.good, warn: SA.warn, bad: SA.bad };
const fmtSync = iso => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

export default function MailboxHealth({ emailData, period, entities, widgetId = 'mailbox_health' }) {
  if (!emailData) return <p style={{ fontSize: 12, color: SA.muted }}>Loading…</p>;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const entityByEmail = new Map((entities?.mailboxes || []).map(m => [m.email, m]));
  const senders = perSender(emailData, period.from, period.to);
  // Mailboxes Apollo knows but that never sent still get a row (status only).
  for (const m of entityByEmail.values()) if (!senders.some(r => r.mailbox === m.email)) senders.push({ mailbox: m.email, sent: 0, delivered: 0, hard_bounced: 0, spam_blocked: 0, opened: 0, replied: 0, delivered_rate: null, bounce_rate: null, open_rate: null, reply_rate: null, human_share: null, human_open_rate: null, tracked_opens: 0, tracked_bot_opens: 0, last_send_day: null });
  const rows = senders.map(r => { const e = entityByEmail.get(r.mailbox); return { ...r, entity: e, status: mailboxStatus(r, e, today), lastSync: e?.last_synced_at || null, note: e ? [e.unlink_error_code, mailboxErrorNote(e)].filter(Boolean).join(': ') : '' }; });

  if (!rows.length) return <p style={{ ...SA_TYPE.body, fontSize: 12, color: SA.muted, padding: '12px 0' }}>No mailbox data yet.</p>;

  const handleExport = () => exportWidgetCsv(widgetId, rows, [
    { label: 'Mailbox', key: 'mailbox' },
    { label: 'Sent', value: r => formatValue(r.sent, 'number') },
    { label: 'Delivered %', value: r => formatValue(r.delivered_rate, 'percent') },
    { label: 'Bounce %', value: r => formatValue(r.bounce_rate, 'percent') },
    { label: 'Spam blocked', value: r => formatValue(r.spam_blocked, 'number') },
    { label: 'Apollo open %', value: r => formatValue(r.open_rate, 'percent') },
    { label: 'Human open % (est.)', value: r => formatValue(r.human_open_rate, 'percent') },
    { label: 'Tracked opens', value: r => r.tracked_opens },
    { label: 'Reply %', value: r => formatValue(r.reply_rate, 'percent') },
    { label: 'Last sync', value: r => r.lastSync || '' },
    { label: 'Status', value: r => `${r.status.word}: ${r.status.why}` },
    { label: 'Apollo Error Note (may be stale)', value: r => r.note },
  ]);

  const cell = { padding: '9px 10px', borderBottom: `1px solid ${SA.border}`, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: SA.text };
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <TimeChip>{shortDate(period.from)} – {shortDate(period.to)} · Apollo daily counts by mailbox</TimeChip>
        <ExportButton onClick={handleExport} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table data-mailbox-table="" style={{ width: '100%', borderCollapse: 'collapse', ...SA_TYPE.body, fontSize: 13 }}>
          <thead>
            <tr>
              {COLUMNS.map(c => <th key={c.id} style={{ ...SA_TYPE.label, fontSize: 10, color: SA.muted, textAlign: c.align, padding: '0 10px 8px', borderBottom: `1px solid ${SA.border}`, whiteSpace: 'nowrap' }}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.mailbox} id={`sa-mailbox-${r.mailbox}`} data-mailbox-row={r.mailbox}>
                <td style={{ ...cell, fontWeight: 500, whiteSpace: 'normal', wordBreak: 'break-all', minWidth: 160 }}>
                  {r.mailbox}
                  {r.note && <div title={r.status.tone === 'bad' ? undefined : 'Apollo keeps this text after a reconnect; the mailbox is currently connected.'} style={{ fontSize: 11, color: SA.faint, fontWeight: 400, lineHeight: 1.4, marginTop: 2, opacity: r.status.tone === 'bad' ? 1 : 0.55 }}>{r.status.tone === 'bad' ? '' : 'Old Apollo note · '}{truncate160(r.note)}</div>}
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>{formatValue(r.sent, 'number')}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{formatValue(r.delivered_rate, 'percent')}</td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 600, color: r.sent >= 20 ? (bounceHealthColor(r.bounce_rate) || SA.text) : SA.faint }}>{formatValue(r.bounce_rate, 'percent')}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{formatValue(r.spam_blocked, 'number')}</td>
                <td data-cell="open_rate" style={{ ...cell, textAlign: 'right' }} title={`${formatValue(r.opened, 'number')} opens / ${formatValue(r.delivered, 'number')} delivered`}>{formatValue(r.open_rate, 'percent')}</td>
                <td data-cell="human_open_rate" style={{ ...cell, textAlign: 'right', color: r.human_open_rate === null ? SA.faint : SA.text }} title={r.tracked_opens > 0 ? `Apollo open rate × the human share of ${r.tracked_opens} tracked opens (${r.tracked_bot_opens} look automated)` : 'No tracked opens for this sender in the period'}>
                  {r.human_open_rate === null ? '—' : `~${formatValue(r.human_open_rate, 'percent')}`}
                </td>
                <td style={{ ...cell, textAlign: 'right' }} title={`${formatValue(r.replied, 'number')} replies / ${formatValue(r.delivered, 'number')} delivered`}>{formatValue(r.reply_rate, 'percent')}</td>
                <td style={{ ...cell, color: SA.muted, fontSize: 12 }} title={r.lastSync ? `Apollo's last sync of this mailbox (stale after ${MAILBOX_SYNC_STALE_HOURS}h)` : 'Apollo has not reported a sync time'}>{fmtSync(r.lastSync)}</td>
                <td data-cell="status" style={cell} title={r.status.why}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: TONE[r.status.tone], background: r.status.tone === 'bad' ? SA_BAD_BG : 'transparent', border: `1px solid ${r.status.tone === 'bad' ? 'transparent' : SA.border}`, borderRadius: SA_SHAPE.radiusPill, padding: '3px 9px' }}>
                    {r.status.tone === 'bad' ? '■' : r.status.tone === 'warn' ? '▲' : '●'} {r.status.word}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: SA.faint, marginTop: 10, lineHeight: 1.5 }}>Rates are over the period: delivered, bounce and spam ÷ sent; open and reply ÷ delivered. Human open (est.) = Apollo open rate × the human share of this sender's tracked opens. Status as of the last sync.</div>
    </div>
  );
}
