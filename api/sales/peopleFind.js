import { cleanText, hasPii } from './scrubText.js';
import { normName } from './intakeMatch.js';
import { normalizeDomain } from '../../src/constants/partnerDomains.js';

// visitor-to-record-v1 REV2 V2 - the people at a visiting company, two sources, both pure here:
//   (a) Apollo's contacts export (the Visited People CSV; Oct 27 2026: 66 rows x 80 columns pinned the header map)
//       read through parseVisitedPeopleCsv, and the same people through Apollo's own contacts list ("Prospector ·
//       Website visitors (export)", fed by hand): GET /labels resolves the list id by exact name once, then
//       POST /contacts/search { contact_label_ids } pages it (0 credits) -> mapContacts keeps the SAME field set.
//   (b) POST /mixed_people/api_search scoped to ONE company domain + the buyer titles (0 credits, Stage 0 call 2):
//       peopleSearchRequest builds it, mapPeople keeps name / title / id only. api_search returns last_name_obfuscated,
//       so a found person reads "Larry F." until a reveal (a separate click, never here).
// No email, phone or address is ever mapped or serialized: every output passes through an allowlist of keys and
// assertNoAddress throws if a kept value still looks like one.
export const PEOPLE_SEARCH_PATH = '/mixed_people/api_search';
export const PEOPLE_PER_COMPANY = 3; // REVISABLE
export const PEOPLE_SEARCH_DAILY_CAP = 25; // REVISABLE
export const PER_PAGE = 10; // REVISABLE
export const REVEAL_NOTE = 'reveal to see full name';
export const isPartialName = note => String(note || '').includes(REVEAL_NOTE);
const PERSON_KEYS = ['name', 'title', 'location', 'linkedin_url', 'note', 'apollo_person_id', 'apollo_account_id', 'source_kind', 'visit_id', 'company', 'domain', 'last_visit', 'visits', 'pages', 'seniority', 'departments', 'lists', 'account_owner', 'seen_on'];
const ADDRESS = /[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+\.[a-z]{2,}/i;
// A phone is 10+ digits in one run (a date like 2026-10-27 has 8 and must pass).
const looksPhone = s => (String(s).match(/\+?\d[\d\s().-]{7,}\d/g) || []).some(x => x.replace(/\D/g, '').length >= 10);
const LINKEDIN = /^https?:\/\/(www\.)?linkedin\.com\//i;

// Free-text keys get the phone test too; ids (visit_id, apollo_person_id) and links are digit-heavy by nature.
const TEXT_KEYS = new Set(['name', 'title', 'location', 'note', 'company', 'pages', 'domain', 'seniority', 'departments', 'lists', 'account_owner']);
export function assertNoAddress(rows) {
  for (const r of rows) for (const [k, v] of Object.entries(r)) {
    if (typeof v !== 'string') continue;
    if (ADDRESS.test(v) || (TEXT_KEYS.has(k) && looksPhone(v))) throw new Error(`peopleFind: ${k} carries an address or phone - refused`);
  }
  return rows;
}
const pick = r => assertNoAddress([Object.fromEntries(PERSON_KEYS.filter(k => k in r && r[k] !== undefined).map(k => [k, r[k]]))])[0];
const str = (v, max) => { const s = cleanText(v == null ? '' : String(v), max); return s || null; };
const name = (v, max = 120) => { const s = str(v, max); return s && !hasPii(s) ? s : null; };

// The one allowed shape: a domain is required (the allowlist guard refuses a general people search), titles from
// sales_settings.buyer_titles, page 1 only.
export function peopleSearchRequest({ domain, titles = [], perPage = PER_PAGE }) {
  const d = normalizeDomain(domain || '');
  if (!d) throw new Error('peopleFind: a company domain is required - never a general people search');
  const person_titles = [...new Set(titles.map(t => str(t, 80)).filter(Boolean))].slice(0, 20);
  if (!person_titles.length) throw new Error('peopleFind: at least one buyer title is required');
  return { method: 'POST', path: PEOPLE_SEARCH_PATH, body: { q_organization_domains: [d], person_titles, per_page: Math.min(Math.max(1, perPage), 25), page: 1 } };
}

// api_search people -> sales_people fragments (name, title, apollo id, the visit tie). Nothing else is read.
export function mapPeople(json, { visitId = null, max = PEOPLE_PER_COMPANY, day = null } = {}) {
  const people = Array.isArray(json?.people) ? json.people : [];
  const out = [];
  for (const p of people) {
    if (out.length >= max) break;
    const first = name(p.first_name, 60), last = name(p.last_name || p.last_name_obfuscated, 60);
    const full = [first, last].filter(Boolean).join(' ');
    if (!full) continue;
    const partial = !p.last_name && !!p.last_name_obfuscated;
    out.push(pick({ name: full, title: str(p.title, 160), location: null, linkedin_url: LINKEDIN.test(String(p.linkedin_url || '')) ? String(p.linkedin_url).slice(0, 300) : null, note: `Found via visit · Apollo search${day ? ` · ${day}` : ''}${partial ? ` · ${REVEAL_NOTE}` : ''}`, apollo_person_id: str(p.id, 80), source_kind: 'web_visit', visit_id: visitId }));
  }
  return out;
}

export const capLeft = (usedToday, cap = PEOPLE_SEARCH_DAILY_CAP) => Math.max(0, cap - (usedToday || 0));

// --- (a) the Visited People export + (c) the Apollo list --------------------------------------------------------------
// The header map is the REAL export's columns (Oct 27 2026 ruling). KEEP is everything the reader may index; the other
// columns - Email*, every *Phone, Address / City / State / Country, Company Address / Phone, Person Linkedin Url,
// Keywords, Technologies, funding, SIC / NAICS, intent, personas - are never read, so nothing from them can land.
// The export carries no per-person visit date or pages: seen_on is the day Prospector files the person (the upload or
// the pull), and the note says so.
export const VISITOR_LIST_NAME = 'Prospector \u00b7 Website visitors (export)';
export const CONTACTS_PATH = '/contacts/search';
export const LISTS_PATH = '/labels';
export const CONTACTS_PER_PAGE = 100; // Apollo's documented max
const HEADERS = {
  first_name: ['first name'], last_name: ['last name'], name: ['name', 'full name'], title: ['title'], company: ['company name', 'company'],
  seniority: ['seniority'], departments: ['departments'], lists: ['lists'], apollo_person_id: ['apollo contact id'], apollo_account_id: ['apollo account id'], account_owner: ['account owner'],
  domain: ['website', 'company domain'], employees: ['# employees'], industry: ['industry'], company_country: ['company country'], company_state: ['company state'],
};
export const KEPT_COLUMNS = Object.values(HEADERS).flat();
export function parseCsv(text) {
  const rows = [], row = [];
  let cell = '', q = false;
  const s = String(text || '').replace(/^\ufeff/, '');
  const endRow = () => { row.push(cell); rows.push(row.splice(0)); cell = ''; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') endRow();
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) endRow();
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}
const findHeader = rows => {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].map(c => String(c).trim().toLowerCase());
    const cols = {};
    for (const [key, names] of Object.entries(HEADERS)) { const at = cells.findIndex(c => names.includes(c)); if (at >= 0) cols[key] = at; }
    if ((cols.name != null || cols.first_name != null) && cols.company != null) return { at: i, cols, dropped: cells.length - Object.keys(cols).length };
  }
  return null;
}
const int = v => { const n = Number(String(v || '').replace(/[^\d]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const noteFor = (seenOn, seniority, departments) => cleanText(['Identified visitor', seenOn, seniority, departments].filter(Boolean).join(' · '), 500);

// One person + one company fragment from already-picked values; shared by the CSV reader and the contacts mapper.
function filePair(out, { full, company, title, seniority, departments, lists, apollo_person_id, apollo_account_id, account_owner, domain, employees, industry, country, state, seenOn }) {
  const p = pick({
    name: full, title, location: null, linkedin_url: null, company, domain: normalizeDomain(domain || '') || null,
    seniority, departments, lists, account_owner, apollo_person_id, apollo_account_id, source_kind: 'web_visit', seen_on: seenOn || null,
    note: noteFor(seenOn, seniority, departments),
  });
  out.people.push(p);
  const key = normName(company) || p.domain;
  const c = out.byCompany.get(key) || { name: company, domain: p.domain, company_key: key, people: 0, last_visit: seenOn || null, employees: null, industry: null, location: null, country: null, apollo_account_id: null, account_owner: null };
  c.people++;
  if (!c.domain && p.domain) c.domain = p.domain;
  if (c.employees == null && employees) c.employees = employees;
  if (!c.industry && industry) c.industry = industry;
  if (!c.location) c.location = [state, country].filter(Boolean).join(', ') || null;
  if (!c.country && country) c.country = country;
  if (!c.apollo_account_id && apollo_account_id) c.apollo_account_id = apollo_account_id;
  if (!c.account_owner && account_owner) c.account_owner = account_owner;
  out.byCompany.set(key, c);
}
const finish = (out, extra) => ({ people: out.people, companies: [...out.byCompany.values()], ...extra });

// -> { people: [{ name, title, company, domain, seniority, departments, lists, apollo_person_id, apollo_account_id, account_owner,
//      seen_on, source_kind, note }], companies: [{ name, domain, company_key, people, employees, industry, location, country,
//      apollo_account_id, account_owner }], skipped, header_row, columns_dropped }. Throws if no header row. Email / phone / address columns are not indexed.
export function parseVisitedPeopleCsv(text, { max = 500, seenOn = null } = {}) {
  const rows = parseCsv(text);
  const h = findHeader(rows);
  if (!h) throw Object.assign(new Error('Could not find the header row (needs First Name / Last Name or Name, and Company Name)'), { status: 400 });
  const at = k => (h.cols[k] == null ? null : h.cols[k]);
  const out = { people: [], byCompany: new Map() };
  let skipped = 0;
  for (const r of rows.slice(h.at + 1)) {
    if (out.people.length >= max) break;
    const cell = k => (at(k) == null ? null : r[at(k)]);
    const full = name(cell('name'), 120) || [name(cell('first_name'), 60), name(cell('last_name'), 60)].filter(Boolean).join(' ') || null;
    const company = name(cell('company'), 160);
    if (!full || !company) { skipped++; continue; }
    filePair(out, {
      full, company, title: str(cell('title'), 160), seniority: str(cell('seniority'), 40), departments: str(cell('departments'), 120), lists: str(cell('lists'), 200),
      apollo_person_id: str(cell('apollo_person_id'), 80), apollo_account_id: str(cell('apollo_account_id'), 80), account_owner: name(cell('account_owner'), 120),
      domain: cell('domain'), employees: int(cell('employees')), industry: str(cell('industry'), 80), country: str(cell('company_country'), 60), state: str(cell('company_state'), 60), seenOn,
    });
  }
  return finish(out, { skipped, header_row: h.at + 1, columns_dropped: h.dropped });
}

// The list request + the exact-name resolver: modality 'contacts', name compared after trim + NFC (the middle dot is
// U+00B7, not a hyphen). -> { id, name, count } | null. The reply never carries the other lists.
export const listsRequest = () => ({ method: 'GET', path: LISTS_PATH });
export function findListByName(json, listName = VISITOR_LIST_NAME) {
  const want = String(listName).normalize('NFC').trim();
  const lists = Array.isArray(json) ? json : Array.isArray(json?.labels) ? json.labels : [];
  const hit = lists.find(l => l && (l.modality == null || l.modality === 'contacts') && String(l.name || '').normalize('NFC').trim() === want);
  return hit ? { id: str(hit.id || hit._id, 80), name: want, count: Number.isInteger(hit.cached_count) ? hit.cached_count : null } : null;
}
// One page of the list's contacts (0 credits): newest first so a capped pull keeps the latest additions.
export const contactsRequest = ({ listId, page = 1, perPage = CONTACTS_PER_PAGE }) => {
  const id = str(listId, 80);
  if (!id) throw new Error('peopleFind: a list id is required - never a general contacts search');
  return { method: 'POST', path: CONTACTS_PATH, body: { contact_label_ids: [id], per_page: Math.min(Math.max(1, perPage), CONTACTS_PER_PAGE), page, sort_by_field: 'contact_created_at', sort_ascending: false } };
};
// contacts/search rows -> the same { people, companies } the CSV reader builds, plus with_email (a count, never an
// address). Only the keep-set is read; email / phone / address keys on a contact are never touched.
export function mapContacts(contacts, { seenOn = null, max = 500 } = {}) {
  const out = { people: [], byCompany: new Map() };
  let skipped = 0, withEmail = 0;
  for (const c of Array.isArray(contacts) ? contacts : []) {
    if (out.people.length >= max) break;
    const org = c?.organization || {};
    const full = [name(c?.first_name, 60), name(c?.last_name, 60)].filter(Boolean).join(' ') || name(c?.name, 120) || null;
    const company = name(c?.organization_name || org.name, 160);
    if (!full || !company) { skipped++; continue; }
    if (c.email || c.has_email === true) withEmail++;
    filePair(out, {
      full, company, title: str(c.title, 160), seniority: str(c.seniority, 40), departments: str(Array.isArray(c.departments) ? c.departments.join(', ') : c.departments, 120),
      lists: null, apollo_person_id: str(c.id, 80), apollo_account_id: str(c.account_id, 80), account_owner: null,
      domain: org.primary_domain || org.website_url || null, employees: int(org.estimated_num_employees), industry: str(org.industry, 80), country: str(org.country, 60), state: str(org.state, 60), seenOn,
    });
  }
  return finish(out, { skipped, with_email: withEmail });
}
