import { SA, SA_TYPE, SA_SHAPE, SA_BAD_BG } from './theme';
import { rowsFor, lastValue, ratio, formatValue } from './computeMetric';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';
import TimeChip from './TimeChip';
import { mailboxConnectionProblem, mailboxErrorNote } from '../../utils/mailboxStatus';

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
//
// design-v1 Stage 2 - restyled to the mockup's compact-card look: address
// + status pill, a 4-stat row (Sent/Delivered/Open rate/Replies - "Opened"
// dropped from display since Open rate already carries that signal; the
// raw count is still in the CSV export, just not shown as its own stat
// here), "Status as of last sync" footer. The mockup's footer also names
// partners@/benefits@ as "not yet sending" - not reproduced here since
// that's a specific claim about mailboxes this component has no real data
// confirming one way or the other; flagged rather than guessed.
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
      problem: entity ? mailboxConnectionProblem(entity) : null,
      errorNote: entity ? mailboxErrorNote(entity) : null,
      dateFrom: entity?.deliverability_score?.date_from || null,
      dateTo: entity?.deliverability_score?.date_to || null,
    };
  }).filter(m => m.sent !== null || m.active !== undefined);

  if (!mailboxes.length) {
    return <p style={{ ...SA_TYPE.body, fontSize: 12, color: SA.muted, padding: '12px 0' }}>No mailbox data yet.</p>;
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
      { label: 'Connection Problem', value: m => m.problem || '' },
      { label: 'Apollo Error Note (may be stale)', value: m => [m.unlinkErrorCode, m.errorNote].filter(Boolean).join(': ') },
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {mailboxes.map(m => {
          const hasProblem = !!m.problem;
          const hasNote = !!(m.unlinkErrorCode || m.errorNote);
          return (
            <div key={m.id} id={`sa-mailbox-${m.label}`} style={{ padding: '14px 16px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ ...SA_TYPE.body, fontSize: 14, fontWeight: 500, color: m.active === false ? SA.muted : SA.text, wordBreak: 'break-all' }}>
                  {m.label}{m.active === false && ' (inactive)'}
                </span>
                {hasProblem && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: SA.bad, background: SA_BAD_BG, borderRadius: SA_SHAPE.radiusPill, padding: '4px 10px', flexShrink: 0 }}>
                    {m.problem}
                  </span>
                )}
              </div>
              {hasNote && (
                <div title={hasProblem ? undefined : 'Apollo keeps this text after a reconnect; the mailbox is currently connected.'}
                  style={{ fontSize: 11, color: SA.faint, lineHeight: 1.4, opacity: hasProblem ? 1 : 0.55 }}>
                  {!hasProblem && <span>Old Apollo note · </span>}
                  {m.unlinkErrorCode && <span style={{ fontWeight: 600, color: hasProblem ? SA.muted : SA.faint }}>{m.unlinkErrorCode}: </span>}
                  {truncate160(m.errorNote)}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: SA.muted }}>Sent</span>
                  <span style={{ ...SA_TYPE.body, fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: SA.text }}>{formatValue(m.sent, 'number')}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: SA.muted }}>Delivered</span>
                  <span style={{ ...SA_TYPE.body, fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: SA.text }}>{formatValue(m.delivered, 'number')}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: SA.muted }}>Open rate</span>
                  <span style={{ ...SA_TYPE.body, fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: SA.text }}>{formatValue(m.openRate, 'percent')}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: SA.muted }}>Replies</span>
                  <span style={{ ...SA_TYPE.body, fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: SA.text }}>{formatValue(m.replied, 'number')}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: SA.faint, marginTop: 12 }}>Status as of last sync.</div>
    </div>
  );
}
