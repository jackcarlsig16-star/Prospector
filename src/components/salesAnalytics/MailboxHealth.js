import { C, mono } from '../../constants/colors';
import { rowsFor, lastValue, ratio, formatValue } from './computeMetric';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';

// sales-analytics-core-names-fix-v1 Part B - real mailbox addresses (the
// business's own sending mailboxes, not prospect data), from GET /entities.
// Latest-snapshot values (lastValue), same reasoning as SequenceLeaderboard:
// these are already lifetime totals, no "collecting history" gate needed.
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
    };
  }).filter(m => m.sent !== null || m.active !== undefined);

  if (!mailboxes.length) {
    return <p style={{ ...mono, fontSize: 12, color: C.dim, padding: '12px 0' }}>No mailbox data yet.</p>;
  }

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
    ]);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <ExportButton onClick={handleExport} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {mailboxes.map(m => (
        <div key={m.id} style={{ flex: '1 1 220px', minWidth: 200, padding: '12px 14px', background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8 }}>
          <p style={{ ...mono, fontSize: 11, color: m.active === false ? C.dim : C.txt, margin: '0 0 8px', wordBreak: 'break-all' }}>
            {m.label}{m.active === false && ' (inactive)'}
          </p>
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
    </div>
  );
}
