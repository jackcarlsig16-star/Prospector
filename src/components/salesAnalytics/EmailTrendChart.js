import { C, mono } from '../../constants/colors';
import { rowsFor, weeklySeries, formatValue } from './computeMetric';
import { laWeekStart } from './periods';
import LineChart from './LineChart';
import ExportButton from './ExportButton';
import { exportWidgetCsv } from './exportCsv';

// Delivered (a count) and open/reply rate (percentages, 0-1) are different
// scales - three separate small line charts rather than one dual-axis SVG,
// avoids inventing a dual-axis renderer for a v1 widget.
function weeklyRate(allRows, numKey, denKey) {
  const numByWeek = new Map(weeklySeries(rowsFor(allRows, numKey), 'snapshot_delta', laWeekStart).map(p => [p.x, p.y]));
  const denByWeek = new Map(weeklySeries(rowsFor(allRows, denKey), 'snapshot_delta', laWeekStart).map(p => [p.x, p.y]));
  const weeks = [...denByWeek.keys()].sort();
  return weeks
    .filter(w => denByWeek.get(w) > 0 && numByWeek.has(w))
    .map(w => ({ x: w, y: numByWeek.get(w) / denByWeek.get(w) }));
}

function TrendRow({ label, points, color, format }) {
  if (points.length < 2) return null;
  const latest = points[points.length - 1].y;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0', borderBottom: `1px solid ${C.brd}` }}>
      <div style={{ width: 90, flexShrink: 0 }}>
        <p style={{ ...mono, fontSize: 9, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>{label}</p>
        <p style={{ ...mono, fontSize: 16, fontWeight: 700, color: C.txt, margin: 0 }}>{formatValue(latest, format)}</p>
      </div>
      <LineChart points={points} width={220} height={40} color={color} showDots />
    </div>
  );
}

export default function EmailTrendChart({ allRows, accent = C.gold, widgetId = 'email_trend' }) {
  const delivered = weeklySeries(rowsFor(allRows, 'unique_delivered'), 'snapshot_delta', laWeekStart);
  const openRate = weeklyRate(allRows, 'unique_opened', 'unique_delivered');
  const replyRate = weeklyRate(allRows, 'unique_replied', 'unique_delivered');

  if (delivered.length < 2 && openRate.length < 2 && replyRate.length < 2) {
    return (
      <p style={{ ...mono, fontSize: 12, color: C.dim, padding: '12px 0' }}>
        Collecting history — weekly changes appear after the first full week of daily syncs.
      </p>
    );
  }

  const handleExport = () => {
    const byWeek = new Map();
    const set = (week, key, value) => {
      if (!byWeek.has(week)) byWeek.set(week, { week });
      byWeek.get(week)[key] = value;
    };
    delivered.forEach(p => set(p.x, 'delivered', p.y));
    openRate.forEach(p => set(p.x, 'openRate', p.y));
    replyRate.forEach(p => set(p.x, 'replyRate', p.y));
    const weekRows = [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
    exportWidgetCsv(widgetId, weekRows, [
      { label: 'Week', key: 'week' },
      { label: 'Delivered', value: r => (r.delivered === undefined ? '' : formatValue(r.delivered, 'number')) },
      { label: 'Open Rate', value: r => (r.openRate === undefined ? '' : formatValue(r.openRate, 'percent')) },
      { label: 'Reply Rate', value: r => (r.replyRate === undefined ? '' : formatValue(r.replyRate, 'percent')) },
    ]);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <ExportButton onClick={handleExport} />
      </div>
      <TrendRow label="Delivered" points={delivered} color={accent} format="number" />
      <TrendRow label="Open Rate" points={openRate} color={C.blue} format="percent" />
      <TrendRow label="Reply Rate" points={replyRate} color={C.green} format="percent" />
    </div>
  );
}
