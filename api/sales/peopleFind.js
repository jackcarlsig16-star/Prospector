import { cleanText, hasPii } from './scrubText.js';
import { normName } from './intakeMatch.js';
import { normalizeDomain } from '../../src/constants/partnerDomains.js';

// visitor-to-record-v1 REV2 V2 - the people at a visiting company, two sources, both pure here:
//   (a) Apollo's Visited People CSV export (Stage 0: no API path - api_search ignores the website_visitors_* filters,
//       the legacy people search is deprecated) read through parseVisitedPeopleCsv -> rows the upload path files.
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
const PERSON_KEYS = ['name', 'title', 'location', 'linkedin_url', 'note', 'apollo_person_id', 'source_kind', 'visit_id', 'company', 'domain', 'last_visit', 'visits', 'pages'];
const ADDRESS = /[^\s@<>()"',;=&#]+@[^\s@<>()"',;=&#]+\.[a-z]{2,}/i;
// A phone is 10+ digits in one run (a date like 2026-10-27 has 8 and must pass).
const looksPhone = s => (String(s).match(/\+?\d[\d\s().-]{7,}\d/g) || []).some(x => x.replace(/\D/g, '').length >= 10);
const LINKEDIN = /^https?:\/\/(www\.)?linkedin\.com\//i;

// Free-text keys get the phone test too; ids (visit_id, apollo_person_id) and links are digit-heavy by nature.
const TEXT_KEYS = new Set(['name', 'title', 'location', 'note', 'company', 'pages', 'domain']);
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

// --- (a) the Visited People export ---------------------------------------------------------------------------------
// Header map (REVISABLE until one real export pins it): the reader finds the header row by its known names, so extra
// columns, a title row above the headers, or a different column order all work. Email / phone columns are never read.
const HEADERS = {
  first_name: ['first name', 'first'], last_name: ['last name', 'last'], name: ['name', 'full name', 'person', 'contact'],
  title: ['title', 'job title'], company: ['company', 'company name', 'organization', 'account'], domain: ['company domain', 'website', 'company website', 'domain'],
  linkedin_url: ['person linkedin url', 'linkedin url', 'linkedin', 'person linkedin'], city: ['city', 'person city'], state: ['state', 'person state'],
  last_visit: ['last visit', 'last visited', 'last visit date', 'last seen'], visits: ['visits', 'page views', 'total visits', 'visit count'], pages: ['pages visited', 'top pages', 'pages', 'page'],
  apollo_person_id: ['apollo id', 'person id', 'id'],
};
export function parseCsv(text) {
  const rows = [], row = [];
  let cell = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
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
    if ((cols.name != null || cols.first_name != null) && cols.company != null) return { at: i, cols };
  }
  return null;
}
const ymd = v => { const s = String(v || '').trim(); const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) || /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (!m) return null; return m[0].includes('/') ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : `${m[1]}-${m[2]}-${m[3]}`; };
const int = v => { const n = Number(String(v || '').replace(/[^\d]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

// -> { people: [{ name, title, location, linkedin_url, company, domain, last_visit, visits, pages, apollo_person_id, source_kind, note }],
//      companies: [{ name, domain, company_key, people: n, last_visit }], skipped: n, header_row }. Throws if no header row.
export function parseVisitedPeopleCsv(text, { max = 500 } = {}) {
  const rows = parseCsv(text);
  const h = findHeader(rows);
  if (!h) throw Object.assign(new Error('Could not find the header row (needs a name column and a Company column)'), { status: 400 });
  const at = k => (h.cols[k] == null ? null : h.cols[k]);
  const people = [], byCompany = new Map();
  let skipped = 0;
  for (const r of rows.slice(h.at + 1)) {
    if (people.length >= max) break;
    const cell = k => (at(k) == null ? null : r[at(k)]);
    const full = name(cell('name'), 120) || [name(cell('first_name'), 60), name(cell('last_name'), 60)].filter(Boolean).join(' ') || null;
    const company = name(cell('company'), 160);
    if (!full || !company) { skipped++; continue; }
    const loc = [str(cell('city'), 60), str(cell('state'), 60)].filter(Boolean).join(', ') || null;
    const li = String(cell('linkedin_url') || '').trim();
    const p = pick({
      name: full, title: str(cell('title'), 160), location: loc, linkedin_url: LINKEDIN.test(li) ? li.slice(0, 300) : null,
      company, domain: normalizeDomain(cell('domain') || '') || null, last_visit: ymd(cell('last_visit')), visits: int(cell('visits')), pages: str(cell('pages'), 300),
      apollo_person_id: str(cell('apollo_person_id'), 80), source_kind: 'web_visit',
      note: cleanText(`Identified visitor${ymd(cell('last_visit')) ? ` · ${ymd(cell('last_visit'))}` : ''}${str(cell('pages'), 300) ? ` · pages ${str(cell('pages'), 200)}` : ''}`, 500),
    });
    people.push(p);
    const key = normName(company) || p.domain;
    const c = byCompany.get(key) || { name: company, domain: p.domain, company_key: key, people: 0, last_visit: null };
    c.people++;
    if (p.last_visit && (!c.last_visit || p.last_visit > c.last_visit)) c.last_visit = p.last_visit;
    if (!c.domain && p.domain) c.domain = p.domain;
    byCompany.set(key, c);
  }
  return { people, companies: [...byCompany.values()], skipped, header_row: h.at + 1 };
}
