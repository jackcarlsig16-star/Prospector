// grow-sponsor-deals-v1 S3 - the tracker's month + launch tabs WITH column A's fill -> month states, then the one-time,
// re-runnable correction plan against the database. Pure: no DB, no network. Fill: green (FF6AA84F or theme 7) =
// confirmed, yellow (FFFFFF00) = in discussion, none = in discussion when the row has content beyond the name (else
// skipped and listed). The launch tab carries no fills: every named row there is confirmed (ruling 1, Nov 2). Paid /
// Amount on any tab that has them; a tab whose Paid / Amount sit under the wrong headers (December: Y/N under "Status",
// numbers under "Type") is detected by its VALUES and read two columns over. Contact cells are never read into a month.
import { cellText } from '../sales/sheetUpdate.js';
import { tabKind } from './importParse.js';
import { tightKey } from './importPlan.js';
import { stateOf, relationshipPatch, STATE_WORDS, monthWords, detailPii } from './deals.js';

const headerKey = h => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const YN = /^(y|n|yes|no)$/i;
const NUM = /^\$?\s*\d+(\.\d+)?$/;
const SKIP_DETAILS = new Set(['name', 'contact', 'contacts', 'paid', 'amount', 'type']);
export const fillOf = cell => {
  const f = cell?.fill;
  if (!f || f.type !== 'pattern' || !f.pattern || f.pattern === 'none') return 'none';
  const c = f.fgColor || {};
  if (c.argb === 'FF6AA84F' || c.theme === 7) return 'green';
  if (c.argb === 'FFFFFF00') return 'yellow';
  return 'other';
};
const yes = v => /^y(es)?$/i.test(String(v || '').trim());
const money = v => { const s = String(v ?? '').replace(/[$,\s]/g, ''); return s && Number.isFinite(Number(s)) ? Math.round(Number(s) * 100) / 100 : null; };

// exceljs Workbook -> { tabs: [{ name, kind, period, shifted, rows: [{ ref, name, fill, state, paid, amount_usd, deal_type, details, warnings }], skipped: [{ ref, name, why }] }] }
export function parseSponsorTabs(wb) {
  const tabs = [];
  for (const ws of wb.worksheets) {
    const t = tabKind(ws.name);
    if (t.kind !== 'launch' && t.kind !== 'monthly') continue;
    const headers = {};
    ws.getRow(1).eachCell({ includeEmpty: false }, (c, i) => { const raw = cellText(c.value).trim(); if (raw) headers[i] = raw; });
    const keyAt = i => headerKey(headers[i]);
    const cols = {}; for (const i of Object.keys(headers)) cols[keyAt(i)] ||= Number(i);
    const raw = [];
    ws.eachRow({ includeEmpty: false }, (r, n) => {
      if (n === 1) return;
      const cells = {};
      r.eachCell({ includeEmpty: false }, (c, i) => { const v = cellText(c.value).trim(); if (v) cells[i] = v; });
      if (Object.keys(cells).length) raw.push({ n, cells, fill: fillOf(r.getCell(1)) });
    });
    // December's shift: no Paid / Amount headers, but every value under column 2 is Y/N and every one under column 3 a number.
    const colVals = i => raw.map(x => x.cells[i]).filter(Boolean);
    const shifted = !cols.paid && !cols.amount && colVals(2).length > 0 && colVals(2).every(v => YN.test(v)) && colVals(3).length > 0 && colVals(3).every(v => NUM.test(v));
    const labelAt = i => (shifted ? (i === 2 ? 'Paid?' : i === 3 ? 'Amount' : headers[i - 2]) : headers[i]);
    const rows = [], skipped = [];
    for (const x of raw) {
      const ref = `${ws.name}:${x.n}`, name = x.cells[1] ? x.cells[1].replace(/\s+/g, ' ').trim() : '';
      if (!name) { skipped.push({ ref, name: null, why: 'no name' }); continue; }
      const byKey = {}, details = {}, warnings = [];
      for (const [i, v] of Object.entries(x.cells)) {
        if (Number(i) === 1) continue;
        const label = labelAt(Number(i)); if (!label) continue;
        const k = headerKey(label);
        byKey[k] = v;
        if (SKIP_DETAILS.has(k)) continue;
        if (detailPii(v)) { warnings.push(`${label}: left out (holds an address or phone)`); continue; }
        details[label.replace(/\s+/g, ' ').trim().slice(0, 40)] = v.replace(/\s+/g, ' ').slice(0, 300);
      }
      while (Buffer.byteLength(JSON.stringify(details)) > 2048) { const last = Object.keys(details).pop(); delete details[last]; warnings.push(`${last}: left out (details over 2 KB)`); }
      const content = Object.keys(x.cells).some(i => Number(i) !== 1 && !['contact', 'contacts'].includes(headerKey(labelAt(Number(i)))));
      let state;
      if (t.kind === 'launch') state = 'confirmed';
      else if (x.fill === 'green') state = 'confirmed';
      else if (x.fill === 'yellow') state = 'discussing';
      else if (content) { state = 'discussing'; if (x.fill === 'other') warnings.push('an unknown fill color - read as in discussion'); }
      else { skipped.push({ ref, name, why: 'no fill and nothing but the name' }); continue; }
      rows.push({ ref, name, fill: x.fill, state, paid: yes(byKey.paid), amount_usd: money(byKey.amount), deal_type: byKey.type ? byKey.type.slice(0, 80) : null, details, warnings });
    }
    tabs.push({ name: ws.name, kind: t.kind, period: t.kind === 'launch' ? 'launch' : t.period, shifted, rows, skipped });
  }
  return { tabs };
}

const STOP = new Set(['and', 'the', 'of', 'x', 'by']);
// A short all-caps name (LSQP, PBK, CBA) whose letters run in order through a longer, several-word name.
const abbreviates = (short, long) => {
  if (!/^[A-Z]{2,5}$/.test(short.trim()) || String(long).trim().split(/\s+/).filter(w => !STOP.has(w.toLowerCase())).length < 2) return false;
  const s = short.toLowerCase(), l = tightKey(long);
  const words = String(long).trim().split(/\s+/).filter(w => !STOP.has(w.toLowerCase()));
  if (l[0] !== s[0] || words[words.length - 1][0].toLowerCase() !== s[s.length - 1]) return false;
  let i = 0; for (const ch of l) if (ch === s[i]) i++;
  return i === s.length;
};
const SAME = ['state', 'amount_usd', 'paid', 'deal_type', 'details'];
const norm = p => ({ state: stateOf(p), amount_usd: p.amount_usd == null ? null : Number(p.amount_usd), paid: !!p.paid, deal_type: p.deal_type || null, details: p.details || {} });

// { tabs } + live brands + every period of the workspace (archived too) -> the dry-run report and the writes --apply makes.
// Never a delete: DB-only rows are left and listed; archived and user / email-edited rows are left alone.
export function planReimport({ tabs, brands, periods }) {
  const byKey = new Map();
  for (const b of brands) { byKey.set(tightKey(b.name), b); for (const a of b.aliases || []) byKey.set(tightKey(a), b); }
  const writes = [], unmatched = [], leave = [], perTab = [];
  const seen = new Set();
  for (const tab of tabs) {
    const r = { tab: tab.name, period: tab.period, shifted: tab.shifted, would_confirm: [], would_mark_discussing: [], would_fill: [], would_add: [], unchanged: 0, would_leave: [], unmatched: [], skipped: tab.skipped.map(s => s.name || s.ref), warnings: [] };
    for (const row of tab.rows) {
      const b = byKey.get(tightKey(row.name));
      if (!b) { r.unmatched.push(row.name); unmatched.push({ tab: tab.name, name: row.name }); continue; }
      const kind = tab.kind === 'launch' ? 'launch' : 'monthly', key = `${b.id}|${tab.period}|${kind}`;
      if (seen.has(key)) { r.warnings.push(`${row.name}: listed twice - the first row wins`); continue; }
      seen.add(key);
      for (const w of row.warnings) r.warnings.push(`${row.name}: ${w}`);
      const next = { state: row.state, amount_usd: row.amount_usd, paid: row.paid, deal_type: row.deal_type, details: row.details };
      const cur = periods.find(p => p.brand_id === b.id && p.period === tab.period && p.kind === kind);
      if (cur?.archived_at) { r.would_leave.push(`${b.name} (removed in Grow)`); continue; }
      if (cur && cur.source && cur.source !== 'sheet') { r.would_leave.push(`${b.name} (edited in Grow - ${cur.source})`); continue; }
      const entry = { brand_id: b.id, brand: b.name, period: tab.period, kind, ref: row.ref, next, period_id: cur?.id || null, prev: cur ? norm(cur) : null };
      if (!cur) { r.would_add.push(`${b.name} (${STATE_WORDS[row.state].toLowerCase()})`); writes.push(entry); continue; }
      if (SAME.every(k => JSON.stringify(entry.prev[k]) === JSON.stringify(next[k]))) { r.unchanged++; continue; }
      (entry.prev.state === row.state ? r.would_fill : row.state === 'discussing' ? r.would_mark_discussing : r.would_confirm).push(b.name);
      writes.push(entry);
    }
    perTab.push(r);
  }
  // DB-only months on a tab the sheet has: left and listed (e.g. a month the sheet stopped listing).
  for (const r of perTab) {
    const kind = r.period === 'launch' ? 'launch' : 'monthly';
    for (const p of periods.filter(x => x.period === r.period && x.kind === kind && !x.archived_at)) {
      if (seen.has(`${p.brand_id}|${p.period}|${kind}`)) continue;
      const b = brands.find(x => x.id === p.brand_id);
      if (b) { r.would_leave.push(`${b.name} (in Grow, not on the sheet)`); leave.push({ brand: b.name, period: p.period }); }
    }
  }
  // Relationship after the writes, per brand touched (S2): the sponsor -> prospect list, and any the other way.
  const after = new Map();
  for (const p of periods.filter(x => !x.archived_at)) (after.get(p.brand_id) || after.set(p.brand_id, []).get(p.brand_id)).push({ ...p });
  for (const w of writes) {
    const list = after.get(w.brand_id) || after.set(w.brand_id, []).get(w.brand_id);
    const hit = list.find(p => p.period === w.period && p.kind === w.kind);
    if (hit) Object.assign(hit, w.next); else list.push({ brand_id: w.brand_id, period: w.period, kind: w.kind, ...w.next });
  }
  const relationships = [];
  for (const id of new Set(writes.map(w => w.brand_id))) {
    const b = brands.find(x => x.id === id), patch = relationshipPatch(b, after.get(id) || []);
    if (patch) relationships.push({ brand_id: id, brand: b.name, from: b.relationship, to: patch.relationship, status_from: b.status, status_to: patch.status || b.status, patch });
  }
  // Name families on the sheet (LSQP / Logan Square Pilates, Protein Bar / PBK): a note for Review, never merged.
  const names = [...new Set(tabs.flatMap(t => t.rows.map(x => x.name)))];
  const families = [];
  for (const a of names) for (const b of names) {
    if (a >= b) continue;
    const ka = tightKey(a), kb = tightKey(b);
    if (ka === kb) continue;
    if ((ka.length >= 4 && kb.startsWith(ka)) || (kb.length >= 4 && ka.startsWith(kb)) || abbreviates(a, b) || abbreviates(b, a)) families.push([a, b]);
  }
  return { tabs: perTab, writes, relationships, unmatched, leave, families, after: [...after.values()].flat() };
}

// One Activity line per brand changed by --apply: "Sheet re-import: Nov 2026 → in discussion".
export const changeWords = w => `${w.period === 'launch' ? 'Launch' : monthWords(w.period)} → ${STATE_WORDS[w.next.state].toLowerCase()}${w.next.amount_usd != null ? ` $${w.next.amount_usd}` : ''}${w.next.paid ? ', paid' : ''}`;
