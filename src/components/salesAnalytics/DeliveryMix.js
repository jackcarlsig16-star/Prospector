import { SA, SA_TYPE } from './theme';
import { COHORT_COLORS, cohortColor } from './palette';
import { formatValue } from './computeMetric';
import { perSequenceDelivered } from './charts/perSequenceData';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';

const SENDER_PALETTE = [SA.accent, SA.good, SA.warn, '#B39DDB', '#5FB3A8'];
const UNKNOWN_SENDER_COLOR = SA.faint;

function StackedBar({ segments }) {
  return (
    <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
      {segments.map(s => (
        <span key={s.label} title={`${s.label}: ${s.value}`} style={{ display: 'block', width: `${s.pct}%`, background: s.color }} />
      ))}
    </div>
  );
}

function Legend({ segments }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
      {segments.map(s => (
        <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: SA.muted }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
          {s.label} <span style={{ color: SA.text, fontVariantNumeric: 'tabular-nums' }}>{formatValue(s.value, 'number')}</span> <span style={{ fontVariantNumeric: 'tabular-nums' }}>({s.pct.toFixed(0)}%)</span>
        </span>
      ))}
    </div>
  );
}

// design-v1 Stage 3 - replaces the three donut charts (Delivered by
// Cohort, Delivered by Sender, Direct vs Partner) with one card, exactly
// the two bars DECIDED specifies: By cohort and By sender. Direct vs
// Partner has no bar of its own here - the SPEC doesn't ask for one, and
// Partner share stays visible via Companies-by-cohort's own stacked bars
// whenever a Partner company exists. Reuses perSequenceDelivered(allRows,
// entities) - the exact same per-sequence join the donuts read from, so
// the total (1,028) can't drift from what shipped before.
export default function DeliveryMix({ allRows, entities, widgetId = 'delivery_mix' }) {
  const perSeq = perSequenceDelivered(allRows, entities);
  const total = perSeq.reduce((sum, r) => sum + r.delivered, 0);

  if (!perSeq.length || total === 0) {
    return <p style={{ ...SA_TYPE.body, fontSize: 12, color: SA.muted, padding: '12px 0' }}>No data yet.</p>;
  }

  const byCohort = {};
  perSeq.forEach(r => { byCohort[r.cohort] = (byCohort[r.cohort] || 0) + r.delivered; });
  const cohortSegments = Object.keys(COHORT_COLORS)
    .map(cohort => ({ label: cohort, value: byCohort[cohort] || 0, color: cohortColor(cohort) }))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .map(s => ({ ...s, pct: (s.value / total) * 100 }));

  const bySender = {};
  perSeq.forEach(r => { const key = r.senderEmail || 'Unattributed'; bySender[key] = (bySender[key] || 0) + r.delivered; });
  const senderKeys = Object.keys(bySender).sort((a, b) => bySender[b] - bySender[a]);
  let paletteIdx = 0;
  const senderSegments = senderKeys.map(label => {
    const color = label === 'Unattributed' ? UNKNOWN_SENDER_COLOR : SENDER_PALETTE[paletteIdx++ % SENDER_PALETTE.length];
    return { label, value: bySender[label], color, pct: (bySender[label] / total) * 100 };
  });

  const handleExport = () => {
    exportWidgetCsv(widgetId, [
      ...cohortSegments.map(s => ({ group: 'Cohort', label: s.label, value: s.value, pct: s.pct })),
      ...senderSegments.map(s => ({ group: 'Sender', label: s.label, value: s.value, pct: s.pct })),
    ], [
      { label: 'Group', key: 'group' },
      { label: 'Label', key: 'label' },
      { label: 'Delivered', value: r => formatValue(r.value, 'number') },
      { label: 'Share', value: r => `${r.pct.toFixed(1)}%` },
    ]);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <ExportButton onClick={handleExport} />
      </div>
      <div style={{ fontSize: 12, color: SA.faint, marginBottom: 16 }}>{formatValue(total, 'number')} delivered · all sequences incl. inactive · all-time</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        <div style={{ ...SA_TYPE.label, color: SA.muted }}>By cohort</div>
        <StackedBar segments={cohortSegments} />
        <Legend segments={cohortSegments} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ ...SA_TYPE.label, color: SA.muted }}>By sender</div>
        <StackedBar segments={senderSegments} />
        <Legend segments={senderSegments} />
      </div>
    </div>
  );
}
