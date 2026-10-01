import { C, mono } from '../../constants/colors';
import { SEMANTIC } from './palette';
import { rowsFor, lastValue, ratio, formatValue } from './computeMetric';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';
import TimeChip from './TimeChip';

function truncate160(s) {
  if (!s) return '';
  return s.length > 160 ? s.slice(0, 160) + '…' : s;
}

// sales-analytics-core-names-fix-v1 Part B - real mailbox addresses (the
// business's own sending mailboxes, not prospect data), from GET /entities.
// Latest-snapshot values (lastValue), same reasoning as SequenceLeaderboard:
// these are already lifetime totals, no "collecting history" gate needed -
// but per dashboard-v2 Stage 3 (audit F9/F10), the open-rate figures Apollo
// itself computes are a real rolling 7-day window, not lifetime, so the
// header now says so explicitly rather than implying "all-time" by
// omission.
export default function MailboxHealth({ allRows, entities, widgetId = 'mailbox_health' }) {
  const entityById = new Map((entities?.mailboxes || []).map(m => [m.id, m]));
  const idsFromMetrics = new Set(
    allRows.filter(r => r.dim_type === 'mailbox' && r.metric_key.startsWith('mailbox_')).map(r => r.dim_value)
  );
  const allIds = new Set([...entityById.keys(), ...idsFromMetrics]);

  const mailboxes = [...allIds].map(id => {
    const entity = entityById.get(id);
    const label = entity ? entity.email : `Unknown (${id.slice(-6)})`;

    const sentRows = rowsFor(allRows, 'mailbox_sent', 'mailbox', id);
    const deliveredRows = rowsFor(allRows, 'mailbox_delivered', 'mailbox', id);
    const openedRows = rowsFor(allRows, 'mailbox_opened', 'mailbox', id);
    const repliedRows = rowsFor(allRows, 'mailbox_replied', 'mailbox', id);

    return {
      id, label,
      active: entity ? entity.active : undefined,
      sent: lastValue(sentRows),
      delivered: lastValue(deliveredRows),
      opened: lastValue(openedRows),
      replied: lastValue(repliedRows),
      openRate: ratio(openedRows, deliveredRows, lastValue),
      unlinkErrorCode: entity?.unlink_error_code || null,
      inactiveReason: entity?.inactive_reason || null,
      unlinkErrorMessage: entity?.unlink_error_message || null,
      dateFrom: entity?.deliverability_score?.date_from || null,
      dateTo: entity?.deliverability_score?.date_to || null,
    };
  }).filter(m => m.sent !== null || m.active !== undefined);

  if (!mailboxes.length) {
    return <p style={{ ...mono, fontSize: 12, color: C.dim, padding: '12px 0' }}>No mailbox data yet.</p>;
  }

  const windowMailbox = mailboxes.find(m => m.dateFrom && m.dateTo);

  // Real addresses (m.label), never ids.
  const handleExport = () => {
    exportWidgetCsv(widgetId, mailboxes, [
      { label: 'Mailbox', key: 'label' },
      { label: 'Status', value: m => (m.active === false ? 'Inactive' : 'Active') },
      { label: 'Sent', value: m => formatValue(m.sent, 'number') },
      { label: 'Delivered', value: m => formatValue(m.delivered, 'number') },
      { label: 'Opened', value: m => formatValue(m.opened, 'number') },
      { label: 'Replied', value: m => formatValue(m.replied, 'number') },
      { label: 'Open Rate', value: m => formatValue(m.openRate, 'percent') },
      { label: 'Connection Problem', value: m => (m.unlinkErrorCode || m.inactiveReason || '') },
    ]);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        {windowMailbox ? (
          <TimeChip>Apollo 7-day window: {windowMailbox.dateFrom} – {windowMailbox.dateTo}</TimeChip>
        ) : <span />}
        <ExportButton onClick={handleExport} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {mailboxes.map(m => {
        const hasProblem = !!(m.unlinkErrorCode || m.inactiveReason);
        return (
          <div key={m.id} style={{ flex: '1 1 220px', minWidth: 200, padding: '12px 14px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8 }}>
            <p style={{ ...mono, fontSize: 11, color: m.active === false ? C.dim : C.txt, margin: '0 0 8px', wordBreak: 'break-all' }}>
              {m.label}{m.active === false && ' (inactive)'}
            </p>
            {hasProblem && (
              <div style={{ marginBottom: 10, padding: '8px 10px', background: `${SEMANTIC.problem}18`, border: `1px solid ${SEMANTIC.problem}66`, borderRadius: 6 }}>
                <p style={{ ...mono, fontSize: 11, color: SEMANTIC.problem, fontWeight: 700, margin: '0 0 4px' }}>
                  ⚠ Connection problem — reconnect this mailbox in Apollo
                </p>
                {m.unlinkErrorCode && (
                  <p style={{ ...mono, fontSize: 10, color: C.mut, margin: '0 0 3px' }}>{m.unlinkErrorCode}</p>
                )}
                <p style={{ ...mono, fontSize: 10, color: C.mut, margin: 0, lineHeight: 1.4 }}>
                  {truncate160(m.unlinkErrorMessage || m.inactiveReason)}
                </p>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, ...mono, fontSize: 12 }}>
              <span style={{ color: C.dim }}>Sent</span><span style={{ color: C.txt, textAlign: 'right' }}>{formatValue(m.sent, 'number')}</span>
              <span style={{ color: C.dim }}>Delivered</span><span style={{ color: C.txt, textAlign: 'right' }}>{formatValue(m.delivered, 'number')}</span>
              <span style={{ color: C.dim }}>Opened</span><span style={{ color: C.txt, textAlign: 'right' }}>{formatValue(m.opened, 'number')}</span>
              <span style={{ color: C.dim }}>Replied</span><span style={{ color: C.txt, textAlign: 'right' }}>{formatValue(m.replied, 'number')}</span>
              <span style={{ color: C.dim }}>Open Rate</span><span style={{ color: C.txt, textAlign: 'right' }}>{formatValue(m.openRate, 'percent')}</span>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
