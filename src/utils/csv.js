// Shared CSV parsing + fuzzy name matching - extracted from UploadsPage.js's
// inline implementation so csv-account-import-v1 doesn't duplicate a second
// hand-rolled parser/matcher. UploadsPage.js itself is untouched (legacy,
// owner_email-scoped, working) - this is the shared home for any future
// caller, starting with the business-scoped importer (modular-tools discipline).

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

export const normName = n => (n || "").toLowerCase()
  .replace(/\b(inc|llc|ltd|corp|co|company|group|holdings|tech|technologies|solutions|services|global|international|the)\b/g, '')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const nameSim = (a, b) => {
  const na = normName(a), nb = normName(b);
  if (na === nb) return 1;
  const ta = new Set(na.split(' ').filter(Boolean)), tb = new Set(nb.split(' ').filter(Boolean));
  const inter = [...ta].filter(t => tb.has(t)).length, union = new Set([...ta, ...tb]).size;
  return union > 0 ? inter / union : 0;
};
