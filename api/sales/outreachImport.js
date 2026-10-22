import { openUpload, cellText, UPLOAD_MAX_ROWS } from './sheetUpdate.js';
import { ImportRefused } from './masterImport.js';
import { cleanText } from './scrubText.js';
import { findDupes, loadDupeContext } from './partnerDupeCheck.js';
import { parseCsvLine } from '../../src/utils/csv.js';

// seif-campaign-v1 B1 - a contact sheet -> sales_outreach_contacts. Unlike
// the Scout import, this sheet MUST hold addresses: they are read here,
// matched, stored server-side and never echoed back. The preview says
// "has_email" only; refusals and reasons name rows and columns, never a
// cell's value. A preview writes nothing; commit re-reads the same file,
// re-plans and inserts the rows that would be added.

const HEADER_SCAN_ROWS = 10;
const INSERT_CHUNK = 200;
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;
const FIELDS = {
  name: ['name', 'full name', 'contact', 'contact name'],
  first_name: ['first name', 'first'],
  last_name: ['last name', 'last', 'surname'],
  title: ['title', 'job title', 'position', 'role'],
  company: ['company', 'company name', 'organization', 'organisation', 'account', 'employer'],
  email: ['email', 'e-mail', 'email address', 'work email'],
  segment: ['segment', 'list', 'type', 'category'],
  warmth: ['warmth', 'knows seif', 'relationship', 'warm/cold', 'tone'],
};
export const MAPPABLE = Object.keys(FIELDS);
const norm = h => String(h || '').trim().toLowerCase();

export const REASON_LABEL = {
  missing_name: 'missing name', missing_email: 'missing email', bad_email: "email doesn't look right",
  dup_sheet: 'duplicate in the sheet', in_campaign: 'already in this campaign',
  brad: "Brad's / Upside's company", in_pipeline: 'company already in Pipeline',
  in_apollo: 'already in an Apollo sequence', no_track: 'no segment / warmth yet',
};
// Reasons that keep a row out. 'brad' does too unless the row is in include.
const SKIPS = ['missing_name', 'missing_email', 'bad_email', 'dup_sheet', 'in_campaign'];

export function parseSegment(v) {
  const s = norm(v);
  if (!s) return null;
  if (/consult|broker|channel|partner/.test(s)) return 'consultant_broker';
  if (/corp|direct|employer|client|company/.test(s)) return 'corporate';
  return null;
}
export function parseWarmth(v) {
  const s = norm(v);
  if (!s) return null;
  if (/^(no|n|false|0)$|cold|doesn|don't|dont|unknown|new/.test(s)) return 'cold';
  if (/^(yes|y|true|x|1|✓|✔)$|warm|knows|known/.test(s)) return 'warm';
  return null;
}
export const normEmail = v => String(v || '').trim().toLowerCase().replace(/^mailto:/, '');
export const isEmail = v => v.length <= 320 && EMAIL_RE.test(v);

// -> [{ n, cells }] of the first sheet (or the CSV).
async function readRows(file) {
  const { csv, workbook } = await openUpload(file);
  if (csv != null) return csv.split(/\r?\n/).map((line, i) => ({ n: i + 1, cells: parseCsvLine(line).map(c => c.trim()) })).filter(r => r.cells.some(Boolean));
  const ws = workbook.worksheets[0];
  if (!ws) throw new ImportRefused('the workbook has no sheet');
  const rows = [];
  ws.eachRow((row, n) => {
    const cells = (row.values || []).slice(1).map(v => cellText(v).trim());
    if (cells.some(Boolean)) rows.push({ n, cells });
  });
  return rows;
}

const findCol = (headers, names) => headers.findIndex(h => names.includes(norm(h)));

// mapping: { field: header text } from the column-mapping preview; a field
// it names wins over the guess. -> { header_row, headers, columns, rows }
export async function readContacts(file, mapping = {}) {
  const all = await readRows(file);
  const guess = cells => Object.fromEntries(MAPPABLE.map(f => [f, findCol(cells, FIELDS[f])]));
  const head = all.slice(0, HEADER_SCAN_ROWS).find(r => {
    const g = guess(r.cells);
    return g.email >= 0 && (g.name >= 0 || g.first_name >= 0);
  });
  if (!head) throw new ImportRefused(`no header row with a name and an email column in the first ${HEADER_SCAN_ROWS} rows`);
  const col = guess(head.cells);
  for (const [field, header] of Object.entries(mapping || {})) {
    if (!MAPPABLE.includes(field)) throw new ImportRefused(`unknown field in the column mapping: ${field}`);
    if (header == null || header === '') { col[field] = -1; continue; }
    const i = head.cells.findIndex(h => norm(h) === norm(header));
    if (i < 0) throw new ImportRefused(`the mapping names a column the sheet doesn't have (for ${field})`);
    col[field] = i;
  }
  const at = (r, f) => (col[f] >= 0 ? r.cells[col[f]] || '' : '');
  const rows = all.filter(r => r.n > head.n).map(r => ({
    n: r.n,
    name: cleanText(at(r, 'name') || [at(r, 'first_name'), at(r, 'last_name')].filter(Boolean).join(' '), 160),
    title: cleanText(at(r, 'title'), 200), company: cleanText(at(r, 'company'), 200),
    email: normEmail(at(r, 'email')),
    segment: parseSegment(at(r, 'segment')), warmth: parseWarmth(at(r, 'warmth')),
  }));
  if (rows.length > UPLOAD_MAX_ROWS) throw new ImportRefused(`the file has ${rows.length} rows - the limit is ${UPLOAD_MAX_ROWS}`);
  // Header text is shown back for the mapping; a header cell holding an
  // address is not.
  const headers = head.cells.map((h, i) => (h.includes('@') ? `(column ${i + 1})` : h));
  const columns = Object.fromEntries(MAPPABLE.map(f => [f, col[f] >= 0 ? headers[col[f]] : null]));
  return { header_row: head.n, headers, columns, rows };
}

const isBrads = r => !!r && (r.owner_team === 'upside' || r.owner_team === 'both' || /\bbrad\b/i.test(r.co_owner_name || ''));
const LINK_RANK = { partner: 0, opportunity: 1, target: 2 };
const CTX_LIST = { partner: 'partners', opportunity: 'opportunities', target: 'targets' };

// The company's own record (exact name, live before archived, partner >
// employer > target) and whether Brad / Upside owns it. Apollo-only
// accounts don't count.
export function companyMatch(company, ctx) {
  if (!company) return null;
  const hit = findDupes({ name: company }, ctx).exact.filter(h => h.type in LINK_RANK)
    .sort((a, b) => a.archived - b.archived || LINK_RANK[a.type] - LINK_RANK[b.type])[0];
  if (!hit) return null;
  const row = ctx[CTX_LIST[hit.type]].find(x => x.id === hit.id);
  return { type: hit.type, id: hit.id, name: hit.name, archived: hit.archived, brads: isBrads(row) };
}

const chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };

// Lower-cased addresses Apollo already has in a sequence (prospect state
// email -> contact -> a sequenced message).
async function apolloSequenced(supabase, businessId, emails) {
  const prospects = [];
  for (const part of chunks(emails, INSERT_CHUNK)) prospects.push(...must(await supabase.from('sales_prospect_state').select('contact_id, email').eq('business_id', businessId).in('email', part)));
  if (!prospects.length) return new Set();
  const seq = new Set();
  for (const part of chunks([...new Set(prospects.map(p => p.contact_id))], INSERT_CHUNK)) {
    for (const m of must(await supabase.from('sales_email_messages').select('contact_id, sequence_id').eq('business_id', businessId).in('contact_id', part))) if (m.sequence_id) seq.add(m.contact_id);
  }
  return new Set(prospects.filter(p => seq.has(p.contact_id)).map(p => p.email));
}

// -> [{ row fields..., reasons, would, track_id, match }]
export function planRows(rows, { existing, tracks, ctx, sequenced, include = [], defaults = {} }) {
  const seen = new Set();
  const trackOf = (segment, warmth) => tracks.find(t => t.segment === segment && t.warmth === warmth) || null;
  return rows.map(r => {
    const segment = r.segment || defaults.segment || null, warmth = r.warmth || defaults.warmth || null;
    const reasons = [];
    if (!r.name) reasons.push('missing_name');
    if (!r.email) reasons.push('missing_email');
    else if (!isEmail(r.email)) reasons.push('bad_email');
    else if (seen.has(r.email)) reasons.push('dup_sheet');
    else if (existing.has(r.email)) reasons.push('in_campaign');
    if (r.email) seen.add(r.email);
    const match = companyMatch(r.company, ctx);
    if (match?.brads) reasons.push('brad');
    if (match) reasons.push('in_pipeline');
    if (r.email && sequenced.has(r.email)) reasons.push('in_apollo');
    const track = segment && warmth ? trackOf(segment, warmth) : null;
    if (!track) reasons.push('no_track');
    const skip = reasons.some(x => SKIPS.includes(x)) || (reasons.includes('brad') && !include.includes(r.n));
    return { ...r, segment, warmth, track_id: track?.id || null, track: track?.name || null, match, reasons, would: skip ? 'skip' : 'add' };
  });
}

const publicRow = p => ({
  row: p.n, would: p.would, reasons: p.reasons, labels: p.reasons.map(x => REASON_LABEL[x]),
  name: p.name, title: p.title, company: p.company, segment: p.segment, warmth: p.warmth, track: p.track,
  has_email: !!p.email && isEmail(p.email), match: p.match ? { type: p.match.type, id: p.match.id, name: p.match.name, archived: p.match.archived } : null,
});

// The conflict note kept on the contact: the flags a person should see
// before sending (never an address).
const CONFLICT_REASONS = ['brad', 'in_pipeline', 'in_apollo'];
const conflictOf = p => p.reasons.filter(x => CONFLICT_REASONS.includes(x)).map(x => (x === 'in_pipeline' && p.match ? `${REASON_LABEL[x]} (${p.match.name})` : REASON_LABEL[x])).join(' · ').slice(0, 400) || null;
const LINK_COL = { partner: 'goal_id', opportunity: 'opportunity_id', target: 'target_id' };

// { file, dryRun, mapping?, include?: [sheet row numbers to add despite Brad],
//   defaults?: { segment, warmth }, owner_user_id } -> { columns, headers,
// header_row, rows: [public], counts, added }
export async function importContacts(supabase, { businessId, campaign, tracks, file, dryRun, mapping, include = [], defaults = {}, ownerUserId }) {
  const read = await readContacts(file, mapping);
  const emails = [...new Set(read.rows.map(r => r.email).filter(isEmail))];
  const [ctx, existingRows, sequenced] = await Promise.all([
    loadDupeContext(supabase, businessId),
    (async () => { const out = []; for (const part of chunks(emails, INSERT_CHUNK)) out.push(...must(await supabase.from('sales_outreach_contacts').select('email').eq('campaign_id', campaign.id).in('email', part))); return out; })(),
    apolloSequenced(supabase, businessId, emails),
  ]);
  const plan = planRows(read.rows, { existing: new Set(existingRows.map(r => r.email.toLowerCase())), tracks, ctx, sequenced, include, defaults });
  let added = 0;
  if (!dryRun) {
    const rows = plan.filter(p => p.would === 'add').map(p => ({
      campaign_id: campaign.id, business_id: businessId, name: p.name, title: p.title || null, company: p.company || null, email: p.email,
      segment: p.segment, warmth: p.warmth, track_id: p.track_id, owner_user_id: ownerUserId, status: 'queued', current_step: 1,
      conflict: conflictOf(p), notes: null, import_row: p.n, ...(p.match ? { [LINK_COL[p.match.type]]: p.match.id } : {}),
    }));
    for (const part of chunks(rows, INSERT_CHUNK)) {
      const { data, error } = await supabase.from('sales_outreach_contacts').insert(part).select('id');
      if (error?.code === '23505') throw Object.assign(new Error(`Someone imported into this campaign a moment ago - ${added} added; preview it again`), { status: 409 });
      if (error) throw new Error(error.message);
      added += data.length;
    }
  }
  const counts = plan.reduce((c, p) => {
    c[p.would] = (c[p.would] || 0) + 1;
    for (const x of p.reasons) c[x] = (c[x] || 0) + 1;
    return c;
  }, { add: 0, skip: 0 });
  return { header_row: read.header_row, headers: read.headers, columns: read.columns, counts, added, rows: plan.map(publicRow) };
}
