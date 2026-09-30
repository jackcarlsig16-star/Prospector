import { toCsv } from '../../utils/csv';
import { laDateString } from './periods';

// Real browser download (Blob + object-URL anchor click) - this is a real
// deployed web app running in a real browser, not a sandboxed preview, so
// the standard <a download> pattern works normally here.
export function exportWidgetCsv(widgetId, rows, columns) {
  const csv = toCsv(rows, columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `homelover-sales-${widgetId.replace(/_/g, '-')}-${laDateString()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
