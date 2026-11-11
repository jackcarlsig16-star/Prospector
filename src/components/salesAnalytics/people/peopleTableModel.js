// people-v2 Stage 2 - the pure half of Pipeline › People (unit-tested): the filter chips and selects (P3), the Mine rule,
// the old feed links mapped onto chips, the CSV columns (P7, structured fields only - never an address) and the band
// groups (heat-v2 D1: Hot / Warm / Cold in the table's heat order, Cold collapsed) - the band itself is never recomputed
// here, it arrives from the route.
import { headcountCsv, headcountSourceWord, sizeCounts, inSizeFilter, sizeLabels } from '../../../constants/headcount';

export const CHIPS = [['opened', 'Opened'], ['clicked', 'Clicked'], ['replied', 'Replied'], ['sent', 'Sent (any)'], ['identified', 'Identified visitor'], ['visited_7d', 'Company visited 7 d'], ['buyer', 'Buyer title'], ['hot', 'Hot'], ['needs_touch', 'Needs a touch'], ['mine', 'Mine']];
export const WINDOW_OPTIONS = [['all', 'All time'], ['7', '7 d'], ['30', '30 d'], ['90', '90 d']];
export const SOURCE_OPTIONS = ['Apollo', 'Website', 'Partner', 'Typed', 'Upload'];
export const NEEDS_TOUCH_DAYS = 14; // REVISABLE (spec P3) - the route's rule
export const EMPTY_FILTERS = { chips: [], source: '', stage: '', owner: '', window: 'all', q: '', company: null, sizes: [] };
export const LS_SORT = 'prospector_people_sort'; // { id, dir } | null, per viewer

// heat-v2 D1: the band groups when the table is in heat order (no sort, or sorted by heat); null when another column
// sorts the rows (the bands would interleave, one group). A person with no heat yet sits in Cold - no points, no signal.
export const BANDS = ['hot', 'warm', 'cold'];
export function bandGroups(rows, sort) {
  if (sort && sort.id !== 'heat') return null;
  const by = Object.fromEntries(BANDS.map(b => [b, []]));
  for (const r of rows) by[r.heat_band && by[r.heat_band] ? r.heat_band : 'cold'].push(r);
  const order = sort?.dir === 'asc' ? [...BANDS].reverse() : BANDS;
  return order.map(band => ({ band, rows: by[band] }));
}
export const bandRule = (band, r = { hot: 40, warm: 10 }) => (band === 'hot' ? `score ≥ ${r.hot}` : band === 'warm' ? `score ${r.warm}–${r.hot - 1}` : `score < ${r.warm}`);

const DAY = 864e5;
const sevenDaysAgo = now => new Date(now - 6 * DAY).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

// ctx = { meId, now }
export function chipMatches(r, chip, ctx = {}) {
  const now = ctx.now ?? Date.now();
  switch (chip) {
    case 'opened': return r.emails.opened > 0;
    case 'clicked': return r.emails.clicked > 0;
    case 'replied': return r.emails.replied > 0;
    case 'sent': return r.emails.sent > 0;
    case 'identified': return !!r.identified_at;
    case 'visited_7d': return !!r.visits && r.visits.visits_7d > 0 && String(r.visits.seen_to || '') >= sevenDaysAgo(now);
    case 'buyer': return !!r.buyer;
    case 'hot': return r.heat_band === 'hot';
    case 'needs_touch': return !r.last_touch_at || Date.parse(r.last_touch_at) < now - NEEDS_TOUCH_DAYS * DAY;
    case 'mine': return !!ctx.meId && (r.company?.owner_user_id === ctx.meId || r.owner_user_id === ctx.meId);
    default: return true;
  }
}

export function matchesFilters(r, f, ctx = {}) {
  if (f.chips.some(c => !chipMatches(r, c, ctx))) return false;
  if (f.source && r.source !== f.source && !r.sources.includes(f.source)) return false;
  if (f.stage && (r.company?.stage || '') !== f.stage) return false;
  if (f.owner && (f.owner === 'unassigned' ? !!r.company?.owner_user_id : r.company?.owner_user_id !== f.owner)) return false;
  if (f.company && !(r.company && r.company.type === f.company.type && r.company.id === f.company.id)) return false;
  if (!inSizeFilter(r.company?.employees, f.sizes)) return false;
  if (f.q) { const n = f.q.trim().toLowerCase(); if (n && !`${r.name || ''} ${r.title || ''} ${r.company?.name || ''}`.toLowerCase().includes(n)) return false; }
  return true;
}
export const applyFilters = (rows, f, ctx) => rows.filter(r => matchesFilters(r, f, ctx));
// Chip counts over the window's whole set (like the Map's legend: the count says what the chip would narrow to from everything).
export const chipCounts = (rows, ctx) => Object.fromEntries(CHIPS.map(([id]) => [id, rows.filter(r => chipMatches(r, id, ctx)).length]));
// heat-size-v1 S1: the size chips count people by their company's headcount bucket (no company record = Unknown).
export const sizeChipCounts = rows => sizeCounts(rows, r => r.company?.employees);
// R5: companies = the distinct records behind the rows; known = those with a headcount; people with no record at all.
export function peopleCoverage(rows) {
  const recs = new Map();
  let noCompanyPeople = 0;
  for (const r of rows) { if (r.company?.id) recs.set(`${r.company.type}:${r.company.id}`, r.company.employees != null); else noCompanyPeople += 1; }
  return { companies: recs.size, known: [...recs.values()].filter(Boolean).length, noCompanyPeople };
}
export const stageOptions = rows => [...new Set(rows.map(r => r.company?.stage).filter(Boolean))].sort();
export const activeFilterCount = f => f.chips.length + ['source', 'stage', 'owner', 'q'].filter(k => f[k]).length + (f.window !== 'all' ? 1 : 0) + (f.company ? 1 : 0) + (f.sizes?.length ? 1 : 0);
export const activeFilters = (f, { members = [] } = {}) => [
  ...f.chips.map(c => ({ key: `chip:${c}`, text: CHIPS.find(([id]) => id === c)?.[1] || c })),
  f.sizes?.length > 0 && { key: 'sizes', text: `Size: ${sizeLabels(f.sizes)}` },
  f.source && { key: 'source', text: `Source: ${f.source}` },
  f.stage && { key: 'stage', text: `Stage: ${String(f.stage).replace(/_/g, ' ')}` },
  f.owner && { key: 'owner', text: `Owner: ${f.owner === 'unassigned' ? 'Unassigned' : members.find(m => m.user_id === f.owner)?.name || 'owner'}` },
  f.window !== 'all' && { key: 'window', text: `Window: ${WINDOW_OPTIONS.find(([id]) => id === f.window)?.[1] || f.window}` },
  f.company && { key: 'company', text: `Company: ${f.company.name || f.company.type}` },
  f.q && { key: 'q', text: `“${f.q}”` },
].filter(Boolean);
export function removeFilter(f, key) {
  if (key.startsWith('chip:')) return { ...f, chips: f.chips.filter(c => c !== key.slice(5)) };
  return { ...f, [key]: EMPTY_FILTERS[key] };
}
export const toggleChip = (f, chip) => ({ ...f, chips: f.chips.includes(chip) ? f.chips.filter(c => c !== chip) : [...f.chips, chip] });

// The old feed links (the Goals numbers' open-feed targets): { feed: 'open' | 'click' | 'reply' | null } -> the matching chip,
// { flags: true } -> Mine. Anything else = no filter.
export function targetToFilters(target, base = EMPTY_FILTERS) {
  if (!target) return base;
  if (target.flags) return { ...base, chips: ['mine'] };
  const chip = { open: 'opened', click: 'clicked', reply: 'replied' }[target.feed];
  return chip ? { ...base, chips: [chip] } : base;
}

const md = iso => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }) : '');
// P7: the CSV of the filtered rows - structured fields only (never an address; the ✉ is a yes / no).
// members = the workspace's members ({ user_id, name }); the Owner column is the person's owner, first name or Unassigned (person-owner-v1 O6).
export const csvColumns = (members = []) => [
  { label: 'Person', value: r => r.name || '' }, { label: 'Title', value: r => r.title || '' }, { label: 'Company', value: r => r.company?.name || '' },
  { label: 'Owner', value: r => (r.owner_user_id ? String(members.find(m => m.user_id === r.owner_user_id)?.name || '').trim().split(/\s+/)[0] || 'Another member' : 'Unassigned') },
  { label: 'Company stage', value: r => r.company?.stage || '' },
  { label: 'Company size', value: r => headcountCsv(r.company?.employees) }, { label: 'Size source', value: r => headcountSourceWord(r.company?.employees, r.company?.employees_source) },
  { label: 'Source', value: r => r.sources.join(' + ') },
  { label: 'Sent', value: r => r.emails.sent }, { label: 'Opened (human)', value: r => r.emails.opened }, { label: 'Clicked', value: r => r.emails.clicked }, { label: 'Replied', value: r => r.emails.replied },
  { label: 'Last email', value: r => (r.last_email ? `${md(r.last_email.at)} ${r.last_email.what}` : '') },
  { label: 'Heat', value: r => (r.heat == null ? '' : r.heat) }, { label: 'Heat band', value: r => r.heat_band || '' },
  { label: 'Company visits 7 d', value: r => r.visits?.visits_7d ?? '' }, { label: 'Last visit', value: r => r.visits?.last_visit || '' },
  { label: 'Identified', value: r => r.identified_at || '' }, { label: 'Buyer title', value: r => (r.buyer ? 'yes' : '') }, { label: 'Address on file', value: r => (r.has_email ? 'yes' : '') },
  { label: 'Last touch', value: r => md(r.last_touch_at) },
];

export function readSort() {
  try { const s = JSON.parse(localStorage.getItem(LS_SORT) || 'null'); return s && typeof s.id === 'string' && ['asc', 'desc'].includes(s.dir) ? s : null; } catch { return null; }
}
export const writeSort = s => { try { if (s) localStorage.setItem(LS_SORT, JSON.stringify(s)); else localStorage.removeItem(LS_SORT); } catch { /* private mode */ } };
