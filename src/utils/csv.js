// Shared CSV parsing - extracted from UploadsPage.js's inline implementation
// so csv-account-import-v1 doesn't duplicate a second hand-rolled parser.
// UploadsPage.js itself is untouched (legacy, owner_email-scoped, working) -
// this is the shared home for any future caller, starting with the
// business-scoped importer (modular-tools discipline).
//
// Name/domain matching lives in normAccount.js, not here - that's the
// canonical dedup logic already used by App.js's merge pass and the manual
// DEDUPE button; the CSV importer was changed to call that directly instead
// of carrying its own separate fuzzy-matching heuristic
// (accounts-lists-and-activity-model-v1, Phase 0 audit finding).

export function parseCsvLine(line) {
  const cols = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      cols.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

// Full parse: returns { headers, rows } where rows is an array of plain
// objects keyed by header (not positional arrays) - easier for callers to
// work with than raw column arrays.
export function parseCsv(text) {
  const lines = text.trim().split("\n").filter(l => l.trim());
  if (lines.length < 1) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map(h => h.replace(/^"|"$/g, "").trim());
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (cols[i] || "").replace(/^"|"$/g, "").trim(); });
    return row;
  });
  return { headers, rows };
}

// sales-analytics-core-v1 Stage 4 - export side, the counterpart to
// parseCsv() above. columns: [{ key, label } | { value: row => cell, label }].
// RFC 4180 quoting (quote on comma/quote/CR/LF, double internal quotes) plus
// a defensive leading "'" on any cell starting with = + - @ (formula-
// injection guard - a cell like "=SUM(...)" or "-2+3" would otherwise
// execute as a formula when the file is opened in Excel/Sheets).
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(rows, columns) {
  const header = columns.map(c => csvCell(c.label)).join(',');
  const lines = rows.map(row =>
    columns.map(c => csvCell(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(',')
  );
  return [header, ...lines].join('\r\n');
}
