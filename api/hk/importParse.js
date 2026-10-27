// hkos-sheet-import-v1 Stage 1 - the tracker workbook -> rows per tab. Pure: no DB, no network, no decisions about what
// a value means (importStatus / importPlan do that). A tab's kind comes from its NAME (the monthly tabs by month word,
// "Septmeber" matched literally); headers are matched after lower-casing and dropping punctuation, so "Challange
// Schedule" and trailing empty columns are harmless. A row without a name is skipped and counted; a skipped tab still
// reports how many rows it held.
import { cellText } from '../sales/sheetUpdate.js';

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, septmeber: 9, october: 10, november: 11, december: 12 };
export const SEASON_YEAR = 2026; // REVISABLE - the tracker's first season runs June..December 2026 then January 2027
export const monthPeriod = month => `${month >= 6 ? SEASON_YEAR : SEASON_YEAR + 1}-${String(month).padStart(2, '0')}`;

// header text (lower-cased, punctuation dropped) -> row key. Anything else lands in unknown_headers and is ignored.
export const HEADERS = {
  name: 'name', 'business name': 'name', event: 'name', website: 'website', contact: 'contact', contacts: 'contact', email: 'email',
  'outreach date': 'outreach_date', 'jack outreach': 'jack_outreach', status: 'status', notes: 'notes', 'challenge reward ideas': 'ideas',
  'enrichment notes': 'enrichment', type: 'type', summary: 'summary', lane: 'lane', 'pitch angle': 'pitch_angle', 'host email source': 'host_email_source',
  'challenge sponsor': 'challenge_sponsor', 'challenge name': 'challenge_name', 'raffle item': 'raffle_item', reward: 'reward', 'redemption method': 'redemption_method',
  'discount code': 'discount_code', 'percentage off': 'percentage_off', agreement: 'agreement', paid: 'paid', amount: 'amount',
};
const headerKey = h => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function tabKind(name) {
  const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (n === 'pete outreach') return { kind: 'pete_outreach' };
  if (n === 'jack outreach') return { kind: 'jack_outreach' };
  if (n === 'confirmed launch sponsors') return { kind: 'launch' };
  const m = n.match(/^([a-z]+)(?: confirmed)? sponsors$/);
  if (m && MONTHS[m[1]]) return { kind: 'monthly', month: MONTHS[m[1]], period: monthPeriod(MONTHS[m[1]]) };
  if (/^non[- ]?profits?$/.test(n)) return { kind: 'nonprofit' };
  if (/press/.test(n)) return { kind: 'press' };
  if (n === 'podcasts') return { kind: 'podcast' };
  if (n === 'sheet8') return { kind: 'sheet8' };
  if (n === 'events') return { kind: 'skipped', reason: 'events are not brand-shaped (no event segment yet)' };
  if (/meliora|orgs to reach out/.test(n)) return { kind: 'skipped', reason: 'template' };
  return { kind: 'skipped', reason: 'unknown tab' };
}

export function parseWorkbook(wb) {
  const tabs = [];
  for (const ws of wb.worksheets) {
    const t = tabKind(ws.name);
    const colKey = {}, unknown = [];
    ws.getRow(1).eachCell({ includeEmpty: false }, (c, i) => { const k = headerKey(cellText(c.value)); if (!k) return; if (HEADERS[k]) colKey[i] = HEADERS[k]; else unknown.push(k); });
    const rows = []; let rowsRead = 0, skipped = 0;
    ws.eachRow({ includeEmpty: false }, (r, n) => {
      if (n === 1) return;
      const cells = {}; let any = false;
      r.eachCell({ includeEmpty: false }, (c, i) => { const v = cellText(c.value).trim(); if (!v) return; any = true; const k = colKey[i]; if (k) cells[k] = cells[k] ? `${cells[k]}\n${v}` : v; });
      if (!any) return;
      rowsRead++;
      if (t.kind === 'skipped') return;
      if (!cells.name) { skipped++; return; }
      rows.push({ ref: `${ws.name}:${n}`, ...cells });
    });
    tabs.push({ name: ws.name, ...t, headers: [...new Set(Object.values(colKey))], unknown_headers: unknown, rows_read: rowsRead, rows, skipped_rows: skipped });
  }
  return { tabs };
}
