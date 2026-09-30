import { C, mono } from '../../constants/colors';
import { rowsFor, snapshotDelta, ratio, formatValue } from './computeMetric';

const METRIC_KEYS = { sent: 'mailbox_sent', delivered: 'mailbox_delivered', opened: 'mailbox_opened', replied: 'mailbox_replied' };

// Same real gap as SequenceLeaderboard.js: dim_value here is the mailbox's
// opaque Apollo id, not its email address - the metrics API has no lookup
// for the real address. Only 2 mailboxes exist today so this is less
// disruptive than the 21-sequence case, but the same fix (a small new
// route reading the latest raw snapshot) would apply to both.
export default function MailboxHealth({ periodRows }) {
  const ids = new Set(rowsFor(periodRows, METRIC_KEYS.sent, 'mailbox').map(r => r.dim_value));

  const mailboxes = [...ids].map(id => {
    const sent = snapshotDelta(rowsFor(periodRows, METRIC_KEYS.sent, 'mailbox', id));
    const delivered = snapshotDelta(rowsFor(periodRows, METRIC_KEYS.delivered, 'mailbox', id));
    const opened = snapshotDelta(rowsFor(periodRows, METRIC_KEYS.opened, 'mailbox', id));
    const replied = snapshotDelta(rowsFor(periodRows, METRIC_KEYS.replied, 'mailbox', id));
    const openRate = ratio(rowsFor(periodRows, METRIC_KEYS.opened, 'mailbox', id), rowsFor(periodRows, METRIC_KEYS.delivered, 'mailbox', id));
    return { id, sent, delivered, opened, replied, openRate };
  }).filter(m => m.sent !== null);

  if (!mailboxes.length) {
    return (
      <p style={{ ...mono, fontSize: 12, color: C.dim, padding: '12px 0' }}>
        Collecting history — weekly changes appear after the first full week of daily syncs.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {mailboxes.map(m => (
        <div key={m.id} style={{ flex: '1 1 200px', minWidth: 180, padding: '12px 14px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8 }}>
          <p style={{ ...mono, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>Mailbox {m.id.slice(0, 8)}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, ...mono, fontSize: 12 }}>
            <span style={{ color: C.dim }}>Sent</span><span style={{ color: C.txt, textAlign: 'right' }}>{formatValue(m.sent, 'number')}</span>
            <span style={{ color: C.dim }}>Delivered</span><span style={{ color: C.txt, textAlign: 'right' }}>{formatValue(m.delivered, 'number')}</span>
            <span style={{ color: C.dim }}>Opened</span><span style={{ color: C.txt, textAlign: 'right' }}>{formatValue(m.opened, 'number')}</span>
            <span style={{ color: C.dim }}>Replied</span><span style={{ color: C.txt, textAlign: 'right' }}>{formatValue(m.replied, 'number')}</span>
            <span style={{ color: C.dim }}>Open Rate</span><span style={{ color: C.txt, textAlign: 'right' }}>{formatValue(m.openRate, 'percent')}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
