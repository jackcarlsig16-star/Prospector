// hkos-sheet-import-v1 S3 - the tracker's freeform Status + date cells -> a brand status, the touches that explain it,
// and warnings. Rules only (0 Claude). Unknown text is a warning and stays in notes, never a guess; a future date is a
// warning, never corrected. Dates: M/D (year DEFAULT_YEAR unless the cell carries one), M/D/YY, M/D/YYYY, YYYY-MM-DD;
// several in one cell are read in order: first = cold sent, second = bump sent, third = final sent (REVISABLE), the
// status follows the last. Output dates are YYYY-MM-DD.
export const DEFAULT_YEAR = 2026; // REVISABLE
// How far along a tracker row is, for merging two rows of one brand; passed / skipped are never produced here and never
// outrank. The display order of all 12 statuses is hkShared STATUS_ORDER.
export const ADVANCE_ORDER = ['candidate', 'claimed', 'drafted', 'sent', 'bumped', 'final_sent', 'replied', 'meeting', 'signed', 'sponsor'];
export const rank = s => ADVANCE_ORDER.indexOf(s);
export const mostAdvanced = (a, b) => (rank(b) > rank(a) ? b : a);
const SERIES = ['cold', 'bump', 'final'];
export const AFTER_SEND = { cold: 'sent', bump: 'bumped', final: 'final_sent' };

const DATE = /(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g;
export function parseDates(text, { year = DEFAULT_YEAR } = {}) {
  const out = [];
  for (const m of String(text || '').matchAll(DATE)) {
    let y, mo, d;
    if (m[1]) { y = +m[1]; mo = +m[2]; d = +m[3]; } else { mo = +m[4]; d = +m[5]; y = m[6] == null ? year : m[6].length === 2 ? 2000 + +m[6] : +m[6]; }
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) continue;
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (new Date(iso).toISOString().slice(0, 10) !== iso) continue;
    out.push(iso);
  }
  return out;
}

const RULES = [
  [/^email sent\b/, 'sent'],
  [/^sent\b/, 'sent'],
  [/^email drafted\b/, 'drafted'],
  [/^ig dm ready\b/, 'claimed'],
  [/^meeting\b/, 'meeting'],
  [/^(responded|replied)\b/, 'replied'],
];

// { status, outreachDate, jackOutreach, today } -> { status, touches: [{ kind, channel, state, at, sender }], warnings, note, dates }
export function normalizeStatus({ status = '', outreachDate = '', jackOutreach = '', today = null, year = DEFAULT_YEAR } = {}) {
  const text = String(status || '').replace(/\s+/g, ' ').trim(), low = text.toLowerCase();
  const warnings = [], touches = [];
  const statusDates = parseDates(text, { year });
  const dates = parseDates(outreachDate, { year });
  const rule = RULES.find(([re]) => re.test(low));
  const mapped = rule ? rule[1] : null;
  // A date inside "Email drafted 10/3" or "IG DM ready" is not a send date; inside "Email sent 9/12" / "Replied 10/5" / unknown text it is.
  const draftish = mapped === 'drafted' || /email drafted/.test(low);
  const series = dates.length ? dates : draftish || mapped === 'claimed' ? [] : statusDates;
  let out = 'candidate', note = null;
  if (series.length) {
    series.slice(0, 3).forEach((at, i) => touches.push({ kind: SERIES[i], channel: 'email', state: 'sent', at, sender: 'owner' }));
    if (series.length > 3) warnings.push({ code: 'extra_dates', detail: `${series.length} dates in one cell, the first 3 imported` });
    out = AFTER_SEND[SERIES[Math.min(series.length, 3) - 1]];
  }
  if (mapped === 'sent' && !series.length) { touches.push({ kind: 'cold', channel: 'email', state: 'sent', at: null, sender: 'owner' }); warnings.push({ code: 'missing_date', detail: text }); }
  if (draftish) {
    touches.push({ kind: 'cold', channel: 'email', state: 'drafted', at: statusDates[0] || null, sender: 'owner' });
    warnings.push({ code: 'draft_not_linked', detail: 'imported draft has no Gmail draft; the sync cannot follow it' });
  }
  if (mapped === 'claimed') touches.push({ kind: 'dm_text', channel: 'ig_dm', state: 'drafted', at: dates[0] || null, sender: 'owner' });
  if (mapped) out = mostAdvanced(out, mapped);
  else if (text) { warnings.push({ code: 'unmapped_status', detail: text }); note = text; }
  for (const at of parseDates(jackOutreach, { year })) touches.push({ kind: 'outside', channel: 'email', state: 'sent', at, sender: 'jack' });
  const future = touches.map(t => t.at).filter(at => at && today && at > today);
  if (future.length) warnings.push({ code: 'future_date', detail: [...new Set(future)].join(', ') });
  return { status: out, touches, warnings, note, dates: series };
}
