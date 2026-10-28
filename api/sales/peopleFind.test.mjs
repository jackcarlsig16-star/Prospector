// node --test api/sales/peopleFind.test.mjs  (react-scripts' Jest only runs src/)
// visitor-to-record-v1 REV2 Stage 1 - the domain-scoped people search request, the api_search mapping (names / titles /
// ids only, obfuscated last names kept as Apollo gives them), the Visited People CSV reader with a header map, and the
// no-address wall. Invented people on example.invalid; 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { peopleSearchRequest, mapPeople, assertNoAddress, parseCsv, parseVisitedPeopleCsv, mapContacts, findListByName, contactsRequest, listsRequest, capLeft, PEOPLE_SEARCH_PATH, PEOPLE_PER_COMPANY, PEOPLE_SEARCH_DAILY_CAP, VISITOR_LIST_NAME, KEPT_COLUMNS } from './peopleFind.js';

const TITLES = ['Chief People Officer', 'VP People', 'VP People', ' Head of Total Rewards '];

test('request: ONE company domain (normalized) + the buyer titles (deduped, trimmed), page 1, per_page clamped; no domain or no titles -> refused', () => {
  const r = peopleSearchRequest({ domain: 'https://www.Zz-Alder.example/careers', titles: TITLES });
  assert.deepEqual(r, { method: 'POST', path: PEOPLE_SEARCH_PATH, body: { q_organization_domains: ['zz-alder.example'], person_titles: ['Chief People Officer', 'VP People', 'Head of Total Rewards'], per_page: 10, page: 1 } });
  assert.equal(peopleSearchRequest({ domain: 'a.example', titles: ['x'], perPage: 99 }).body.per_page, 25);
  assert.equal(peopleSearchRequest({ domain: 'a.example', titles: ['x'], perPage: 0 }).body.per_page, 1);
  assert.throws(() => peopleSearchRequest({ domain: '', titles: TITLES }), /domain is required/);
  assert.throws(() => peopleSearchRequest({ domain: 'a.example', titles: [] }), /buyer title/);
  assert.equal(PEOPLE_SEARCH_PATH, '/mixed_people/api_search');
});

test('mapPeople: name from first + obfuscated last, title, apollo id, the visit tie and note; max per company; email / phone keys on the input never reach a row; only linkedin.com links kept', () => {
  const json = { total_entries: 5, people: [
    { id: 'p1', first_name: 'Larry', last_name_obfuscated: 'F.', title: 'Chief People Officer', email: 'larry@zzalder.example', phone_numbers: [{ raw_number: '+1 312 555 0100' }], sanitized_phone: '+13125550100', linkedin_url: 'http://www.linkedin.com/in/larry-f', organization: { name: 'Zz Alder' } },
    { id: 'p2', first_name: 'Mona', last_name: 'Quill', title: 'VP People', linkedin_url: 'https://example.invalid/not-linkedin' },
    { id: 'p3', first_name: '', last_name_obfuscated: '', title: 'nobody' },
    { id: 'p4', first_name: 'Ravi', last_name_obfuscated: 'S.', title: 'Head of Total Rewards' },
    { id: 'p5', first_name: 'Extra', last_name_obfuscated: 'E.', title: 'Benefits Manager' },
  ] };
  const rows = mapPeople(json, { visitId: 'v-1', day: '2026-10-27' });
  assert.equal(rows.length, PEOPLE_PER_COMPANY);
  assert.deepEqual(rows[0], { name: 'Larry F.', title: 'Chief People Officer', location: null, linkedin_url: 'http://www.linkedin.com/in/larry-f', note: 'Found via visit · Apollo search · 2026-10-27 · reveal to see full name', apollo_person_id: 'p1', source_kind: 'web_visit', visit_id: 'v-1' });
  assert.ok(!rows[1].note.includes('reveal'), 'a full last name carries no reveal flag');
  assert.deepEqual([rows[1].name, rows[1].linkedin_url, rows[2].name], ['Mona Quill', null, 'Ravi S.']);
  const text = JSON.stringify(rows);
  assert.ok(!text.includes('@') && !/555/.test(text) && !/phone|email/i.test(Object.keys(rows[0]).join(',')));
  assert.deepEqual(mapPeople({ people: [] }), []);
  assert.deepEqual(mapPeople(null), []);
});

test('the wall: a kept value that looks like an address or a phone throws', () => {
  assert.throws(() => assertNoAddress([{ title: 'write to ana@zz.example' }]), /address or phone/);
  assert.throws(() => assertNoAddress([{ note: 'call 312-555-0100 now' }]), /address or phone/);
  assert.deepEqual(assertNoAddress([{ name: 'Ana', linkedin_url: 'https://linkedin.com/in/ana-1234567890' }]), [{ name: 'Ana', linkedin_url: 'https://linkedin.com/in/ana-1234567890' }]);
  const scrubbed = mapPeople({ people: [{ id: 'x', first_name: 'Ana', last_name_obfuscated: 'B.', title: 'CPO (ana@zz.example)' }] });
  assert.equal(scrubbed[0].title, 'CPO ([email removed])', 'cleanText scrubs an address inside a title before the wall sees it');
});

test('parseCsv: quoted commas, escaped quotes, CRLF, BOM, blank lines', () => {
  assert.deepEqual(parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,,\n'), [['a', 'b', 'c'], ['1', 'x, y', 'say "hi"'], ['2', '', '']]);
});

// The real export's shape (Oct 27 2026: 80 columns): a title row above, the keep-set spread among email / phone /
// address / LinkedIn / funding columns that carry MARKER values the output must never contain.
const H = ['First Name', 'Last Name', 'Title', 'Company Name', 'Company Name for Emails', 'Email', 'Email Status', 'Seniority', 'Departments', 'Contact Owner', 'Work Direct Phone', 'Mobile Phone', 'Stage', 'Lists', 'Account Owner', '# Employees', 'Industry', 'Keywords', 'Person Linkedin Url', 'Website', 'Address', 'City', 'State', 'Country', 'Company Address', 'Company City', 'Company State', 'Company Country', 'Company Phone', 'Technologies', 'Total Funding', 'SIC Codes', 'NAICS Codes', 'Apollo Contact Id', 'Apollo Account Id', 'Primary Intent Topic'];
const rowOf = o => H.map(h => o[h] ?? '').map(v => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',');
const CSV = [
  'Apollo contacts export,,,',
  H.join(','),
  rowOf({ 'First Name': 'Jean', 'Last Name': 'Horton', Title: 'VP Human Resources', 'Company Name': 'Zz ADP', 'Company Name for Emails': 'ADP', Email: 'jean@zzadp.example', 'Email Status': 'Verified', Seniority: 'VP', Departments: 'Human Resources', 'Contact Owner': 'owner@zz.example', 'Work Direct Phone': '+1 312-555-0100', 'Mobile Phone': '312-555-0101', Stage: 'Cold', Lists: 'Prospector · Website visitors (export)', 'Account Owner': 'Jack Carlson', '# Employees': '58000', Industry: 'human resources', Keywords: 'payroll, hr', 'Person Linkedin Url': 'http://www.linkedin.com/in/jean-h', Website: 'http://www.zzadp.example', Address: '1 Main St', City: 'Chicago', State: 'Illinois', Country: 'United States', 'Company Address': '2 Corp Way', 'Company City': 'Roseland', 'Company State': 'New Jersey', 'Company Country': 'United States', 'Company Phone': '+1 973 555 0199', Technologies: 'Workday', 'Total Funding': '1000000', 'SIC Codes': '7374', 'NAICS Codes': '541214', 'Apollo Contact Id': 'c-1', 'Apollo Account Id': 'a-1', 'Primary Intent Topic': 'Benefits' }),
  rowOf({ 'First Name': 'Margo', 'Last Name': 'R.', Title: 'Benefits Manager', 'Company Name': 'Zz Calpine', Seniority: 'Manager', Lists: 'Prospector · Website visitors (export)', City: 'Houston', State: 'Texas', 'Company State': 'Texas', 'Company Country': 'United States', 'Apollo Contact Id': 'c-2', 'Apollo Account Id': 'a-2' }),
  rowOf({ Title: 'Director', 'Company Name': 'Zz Nameless' }),
  rowOf({ 'First Name': 'Sam', 'Last Name': 'Rivera', Title: 'Head of People', 'Company Name': 'Zz ADP', Website: 'www.zzadp.example', '# Employees': '58000', 'Apollo Contact Id': 'c-3', 'Apollo Account Id': 'a-1' }),
].join('\n');

test('the real export: header row under a title row; only the keep-set is read (name, title, company, seniority, departments, lists, ids, account owner, website, # employees, industry, company state / country); email, phone, address, city / state, LinkedIn, keywords, technologies, funding, SIC / NAICS, intent never land; seen_on stamps the note; people grouped per company with the headcount', () => {
  const out = parseVisitedPeopleCsv(CSV, { seenOn: '2026-10-27' });
  assert.equal(out.header_row, 2);
  assert.equal(out.skipped, 1);
  assert.equal(out.columns_dropped, H.length - 15);
  assert.deepEqual(out.people.map(p => [p.name, p.title, p.company, p.domain, p.seniority, p.departments, p.lists, p.apollo_person_id, p.apollo_account_id, p.account_owner, p.seen_on, p.location, p.linkedin_url]), [
    ['Jean Horton', 'VP Human Resources', 'Zz ADP', 'zzadp.example', 'VP', 'Human Resources', 'Prospector · Website visitors (export)', 'c-1', 'a-1', 'Jack Carlson', '2026-10-27', null, null],
    ['Margo R.', 'Benefits Manager', 'Zz Calpine', null, 'Manager', null, 'Prospector · Website visitors (export)', 'c-2', 'a-2', null, '2026-10-27', null, null],
    ['Sam Rivera', 'Head of People', 'Zz ADP', 'zzadp.example', null, null, null, 'c-3', 'a-1', null, '2026-10-27', null, null],
  ]);
  assert.deepEqual(out.people.map(p => p.note), ['Identified visitor · 2026-10-27 · VP · Human Resources', 'Identified visitor · 2026-10-27 · Manager', 'Identified visitor · 2026-10-27']);
  assert.ok(out.people.every(p => p.source_kind === 'web_visit'));
  assert.deepEqual(out.companies, [
    { name: 'Zz ADP', domain: 'zzadp.example', company_key: 'zz adp', people: 2, last_visit: '2026-10-27', employees: 58000, industry: 'human resources', location: 'New Jersey, United States', country: 'United States', apollo_account_id: 'a-1', account_owner: 'Jack Carlson' },
    { name: 'Zz Calpine', domain: null, company_key: 'zz calpine', people: 1, last_visit: '2026-10-27', employees: null, industry: null, location: 'Texas, United States', country: 'United States', apollo_account_id: 'a-2', account_owner: null },
  ]);
  const text = JSON.stringify(out);
  for (const marker of ['@', '555', 'Main St', 'Corp Way', 'Chicago', 'Houston', 'Roseland', 'linkedin.com', 'payroll', 'Workday', '1000000', '7374', '541214', 'Benefits\"', 'Cold', 'Verified']) assert.ok(!text.includes(marker), `${marker} must not land`);
  assert.throws(() => parseVisitedPeopleCsv('a,b\n1,2'), /header row/);
  assert.equal(parseVisitedPeopleCsv(CSV, { max: 1 }).people.length, 1);
  const byName = parseVisitedPeopleCsv('Name,Company\n"Ana Example","Zz Birch"\n');
  assert.deepEqual([byName.people[0].name, byName.people[0].company, byName.people[0].seen_on, byName.people[0].note], ['Ana Example', 'Zz Birch', null, 'Identified visitor']);
  assert.ok(KEPT_COLUMNS.every(c => !/email|phone|address|linkedin|keyword|technolog|funding|sic|naics|intent/.test(c)), 'the keep-set names no dropped column');
});

test('the Apollo list: GET /labels resolved by the exact name (U+00B7 middle dot, NFC, trimmed, contacts only); the contacts request is list-scoped, newest first, 100 per page; mapContacts keeps the same field set and counts has_email without an address', () => {
  assert.deepEqual(listsRequest(), { method: 'GET', path: '/labels' });
  assert.equal(VISITOR_LIST_NAME.charCodeAt(11), 0xb7);
  const labels = [{ id: 'l-acc', name: VISITOR_LIST_NAME, modality: 'accounts', cached_count: 2 }, { _id: 'l-1', id: 'l-1', name: ` ${VISITOR_LIST_NAME} `, modality: 'contacts', cached_count: 66 }, { id: 'l-x', name: 'Prospector - Website visitors (export)', modality: 'contacts' }];
  assert.deepEqual(findListByName(labels), { id: 'l-1', name: VISITOR_LIST_NAME, count: 66 });
  assert.equal(findListByName(labels, 'Nope'), null);
  assert.equal(findListByName({ labels: [{ id: 'l-2', name: 'Other' }] }, 'Other').id, 'l-2');
  assert.deepEqual(contactsRequest({ listId: 'l-1', page: 2 }), { method: 'POST', path: '/contacts/search', body: { contact_label_ids: ['l-1'], per_page: 100, page: 2, sort_by_field: 'contact_created_at', sort_ascending: false } });
  assert.throws(() => contactsRequest({ listId: '' }), /list id/);
  const contacts = [
    { id: 'c-1', first_name: 'Jean', last_name: 'Horton', title: 'VP Human Resources', organization_name: 'Zz ADP', account_id: 'a-1', seniority: 'vp', departments: ['human_resources'], email: 'jean@zzadp.example', phone_numbers: [{ raw_number: '+1 312 555 0100' }], organization: { name: 'Zz ADP', primary_domain: 'zzadp.example', website_url: 'http://www.zzadp.example', estimated_num_employees: 58000, industry: 'human resources', country: 'United States', state: 'New Jersey', phone: '+1 973 555 0199' }, label_ids: ['l-1'] },
    { id: 'c-2', first_name: 'Margo', last_name: 'R.', title: 'Benefits Manager', organization_name: 'Zz Calpine', account_id: 'a-2', organization: {} },
    { id: 'c-3', name: 'Sam Rivera', organization: { name: 'Zz ADP', website_url: 'https://zzadp.example/' } },
    { id: 'c-4', first_name: 'No', last_name: 'Company' },
  ];
  const out = mapContacts(contacts, { seenOn: '2026-10-27' });
  assert.deepEqual([out.skipped, out.with_email], [1, 1]);
  assert.deepEqual(out.people.map(p => [p.name, p.title, p.company, p.domain, p.seniority, p.departments, p.apollo_person_id, p.apollo_account_id, p.note]), [
    ['Jean Horton', 'VP Human Resources', 'Zz ADP', 'zzadp.example', 'vp', 'human_resources', 'c-1', 'a-1', 'Identified visitor · 2026-10-27 · vp · human_resources'],
    ['Margo R.', 'Benefits Manager', 'Zz Calpine', null, null, null, 'c-2', 'a-2', 'Identified visitor · 2026-10-27'],
    ['Sam Rivera', null, 'Zz ADP', 'zzadp.example', null, null, 'c-3', null, 'Identified visitor · 2026-10-27'],
  ]);
  assert.deepEqual(out.companies.map(c => [c.name, c.domain, c.employees, c.industry, c.location, c.people]), [['Zz ADP', 'zzadp.example', 58000, 'human resources', 'New Jersey, United States', 2], ['Zz Calpine', null, null, null, null, 1]]);
  const text = JSON.stringify(out);
  assert.ok(!text.includes('@') && !text.includes('555') && !text.includes('l-1'), 'no address, phone or label id in the output');
});

test('caps: searches left today', () => {
  assert.equal(capLeft(0), PEOPLE_SEARCH_DAILY_CAP);
  assert.equal(capLeft(PEOPLE_SEARCH_DAILY_CAP + 3), 0);
  assert.equal(capLeft(4, 10), 6);
});
