import { openUpload, cellText, UPLOAD_MAX_ROWS } from './sheetUpdate.js';
import { ImportRefused } from './masterImport.js';
import { hasPii } from './targetsRoutes.js';
import { cleanText } from './scrubText.js';
import { normName } from './intakeMatch.js';
import { findDupes, loadDupeContext } from './partnerDupeCheck.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { addDays } from './goalsShared.js';
import { laDateString } from './laDate.js';
import { parseCsvLine } from '../../src/utils/csv.js';

// signals-v1 Stage 2 - the Signal Scout workbook -> proposed sales_signals
// rows. The file has title rows above its header, so the header is the first
// row holding both "Company" and "Signal(s)". Rows with no Company (the
// Rank-only footer) are skipped. Any "@" or phone shape anywhere in the file
// refuses all of it (D6) - the refusal names the cell, never its value.
// Import only proposes: a person accepts or dismisses each row later.

export const SCOUT_SHEET = 'Hit List';
export const ALSO_WATCH_SHEET = 'Also Watch';
export const DISMISS_DAYS = 7; // REVISABLE
const COLUMNS = {
  rank: h => h === 'rank', name: h => h === 'name', title: h => h === 'title', company: h => h === 'company',
  program: h => h === 'program', signal: h => h === 'signal(s)' || h === 'signals' || h === 'signal',
  why_now: h => h === 'why now', first_line: h => h === 'suggested first line', upside: h => h.startsWith('upside joint'), score: h => h === 'score',
};
const isHeader = cells => { const hs = cells.map(c => c.trim().toLowerCase()); return hs.includes('company') && hs.some(COLUMNS.signal); };
const YES = /^(y|yes|true|x|✓|✔)$/i;

export const laMonday = day => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

// Program -> kind (D5): Employer -> employer, Channel* -> partner, anything
// else -> partner, flagged as a guess.
export function kindOf(program) {
  const p = String(program || '').trim().toLowerCase();
  if (p === 'employer') return { kind: 'employer', kind_guessed: false };
  if (p.startsWith('channel')) return { kind: 'partner', kind_guessed: false };
  return { kind: 'partner', kind_guessed: true };
}

const piiIn = (sheet, rowNo, cells) => {
  const i = cells.findIndex(c => c && hasPii(c));
  if (i < 0) return;
  throw new ImportRefused(`${sheet ? `sheet "${sheet}", ` : ''}row ${rowNo}, column ${i + 1} holds ${cells[i].includes('@') ? 'an "@"' : 'a phone number'} - remove it and re-export`);
};

// -> { sheets: [{ name, rows: [{ n, cells: [text] }] }] }, every cell checked.
async function readGrid(file) {
  const { csv, workbook } = await openUpload(file);
  if (csv != null) {
    const rows = csv.split(/\r?\n/).map((line, i) => ({ n: i + 1, cells: parseCsvLine(line).map(c => c.trim()) })).filter(r => r.cells.some(Boolean));
    rows.forEach(r => piiIn(null, r.n, r.cells));
    return { sheets: [{ name: SCOUT_SHEET, rows }] };
  }
  const sheets = workbook.worksheets.map(ws => {
    const rows = [];
    ws.eachRow((row, n) => {
      const cells = (row.values || []).slice(1).map(v => cellText(v).trim());
      if (cells.some(Boolean)) rows.push({ n, cells });
    });
    rows.forEach(r => piiIn(ws.name, r.n, r.cells));
    return { name: ws.name, rows };
  });
  return { sheets };
}

// -> { rows: [{ n, company, name, title, program, signal, why_now, first_line, upside, score }], header_row, also_watch }
export async function readScout(file) {
  const { sheets } = await readGrid(file);
  const sheet = sheets.find(s => s.name.trim().toLowerCase() === SCOUT_SHEET.toLowerCase()) || sheets.find(s => s.rows.some(r => isHeader(r.cells)));
  const head = sheet?.rows.find(r => isHeader(r.cells));
  if (!head) throw new ImportRefused('no header row with "Company" and "Signal(s)" - is this a Signal Scout file?');
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, test]) => [k, head.cells.findIndex(h => test(h.trim().toLowerCase()))]));
  const at = (r, k) => (col[k] >= 0 ? r.cells[col[k]] || '' : '');
  const rows = sheet.rows.filter(r => r.n > head.n && at(r, 'company')).map(r => ({
    n: r.n, company: at(r, 'company'), name: at(r, 'name'), title: at(r, 'title'), program: at(r, 'program'),
    signal: at(r, 'signal'), why_now: at(r, 'why_now'), first_line: at(r, 'first_line'), upside: YES.test(at(r, 'upside')), score: at(r, 'score'),
  }));
  if (rows.length > UPLOAD_MAX_ROWS) throw new ImportRefused(`the file has ${rows.length} rows - the limit is ${UPLOAD_MAX_ROWS}`);
  const watch = sheets.find(s => s.name.trim().toLowerCase() === ALSO_WATCH_SHEET.toLowerCase());
  const watchHead = watch?.rows.find(r => r.cells.some(c => c.trim().toLowerCase() === 'company'));
  return { rows, header_row: head.n, also_watch: watchHead ? watch.rows.filter(r => r.n > watchHead.n).length : 0 };
}

// "who" = Title + the masked Name the Scout skill writes (D6).
export function toSignal(r, { businessId, week, userId }) {
  const company = cleanText(r.company, 160);
  const who = cleanText([r.title, r.name].map(s => s.trim()).filter(Boolean).join(' · '), 160) || null;
  const score = Number.parseFloat(r.score);
  return {
    business_id: businessId, source: 'scout', signal_week: week, company_name: company, company_key: normName(company) || company.toLowerCase(),
    ...kindOf(r.program), who, who_key: who ? normName(who) || null : null,
    signal: cleanText(r.signal, 400) || null, why_now: cleanText(r.why_now, 400) || null, first_line: cleanText(r.first_line, 400) || null,
    score: Number.isFinite(score) ? Math.round(score) : null, upside_joint: r.upside, status: 'new', created_by: userId,
  };
}

const keyOf = s => [s.source, s.signal_week, s.company_key, s.who_key || ''].join('|');
const publicHit = (h, possible) => ({ type: h.type, id: h.id, name: h.name, archived: h.archived, possible, ...(h.pipeline_status ? { pipeline_status: h.pipeline_status } : {}), ...(h.status ? { status: h.status } : {}) });

// Exact first (a live partner over an archived one), else the first partial
// shown as "possible". Apollo-only accounts are hints only.
export function matchOf(name, ctx) {
  const { exact, partial } = findDupes({ name }, ctx);
  const hit = [...exact].sort((a, b) => a.archived - b.archived)[0];
  if (hit) return publicHit(hit, false);
  return partial[0] ? publicHit(partial[0], true) : null;
}

// dryRun -> { rows: [preview], header_row, also_watch, counts }; otherwise
// also inserts the 'propose' rows (status 'new') and nothing else.
export async function scoutImport(supabase, { businessId, userId, file, dryRun, now = new Date() }) {
  const read = await readScout(file);
  const today = laDateString(now);
  const week = laMonday(today);
  const [ctx, existing] = await Promise.all([
    loadDupeContext(supabase, businessId),
    selectAllPages(() => supabase.from('sales_signals').select('id, source, signal_week, company_key, who_key, status, dismissed_until').eq('business_id', businessId).order('id')),
  ]);
  const byKey = new Map(existing.map(s => [keyOf(s), s]));
  const parked = new Set(existing.filter(s => s.status === 'dismissed' && s.dismissed_until && s.dismissed_until >= today).map(s => s.company_key));
  const seen = new Set();
  const rows = read.rows.map(r => {
    const s = { ...toSignal(r, { businessId, week, userId }), match: matchOf(r.company, ctx) };
    const prior = byKey.get(keyOf(s));
    const would = seen.has(keyOf(s)) ? 'duplicate in file'
      : prior ? (prior.status === 'dismissed' ? 'dismissed' : 'already proposed')
      : parked.has(s.company_key) ? 'dismissed' : 'propose';
    seen.add(keyOf(s));
    return { row: r.n, would, signal: s };
  });
  const toInsert = rows.filter(r => r.would === 'propose').map(r => r.signal);
  let added = 0;
  if (!dryRun && toInsert.length) {
    const { data, error } = await supabase.from('sales_signals').insert(toInsert).select('id');
    if (error?.code === '23505') throw Object.assign(new Error('Someone imported this file a moment ago - preview it again'), { status: 409 });
    if (error) throw new Error(error.message);
    added = data.length;
  }
  const counts = rows.reduce((c, r) => ({ ...c, [r.would]: (c[r.would] || 0) + 1 }), {});
  return {
    header_row: read.header_row, also_watch: read.also_watch, week, counts, added,
    rows: rows.map(({ row, would, signal: s }) => ({ row, would, company: s.company_name, kind: s.kind, kind_guessed: s.kind_guessed, who: s.who, signal: s.signal, score: s.score, upside_joint: s.upside_joint, match: s.match })),
  };
}
