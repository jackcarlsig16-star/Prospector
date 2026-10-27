// node --test api/sales/peopleFind.test.mjs  (react-scripts' Jest only runs src/)
// visitor-to-record-v1 REV2 Stage 1 - the domain-scoped people search request, the api_search mapping (names / titles /
// ids only, obfuscated last names kept as Apollo gives them), the Visited People CSV reader with a header map, and the
// no-address wall. Invented people on example.invalid; 0 network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { peopleSearchRequest, mapPeople, assertNoAddress, parseCsv, parseVisitedPeopleCsv, capLeft, PEOPLE_SEARCH_PATH, PEOPLE_PER_COMPANY, PEOPLE_SEARCH_DAILY_CAP } from './peopleFind.js';

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
  assert.deepEqual(rows[0], { name: 'Larry F.', title: 'Chief People Officer', location: null, linkedin_url: 'http://www.linkedin.com/in/larry-f', note: 'Found via visit · Apollo search · 2026-10-27', apollo_person_id: 'p1', source_kind: 'web_visit', visit_id: 'v-1' });
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

const CSV = [
  'Apollo Website Visitors - People,,,,,,,,,',
  'Exported 2026-10-27,,,,,,,,,',
  'First Name,Last Name,Title,Company,Email,Company Domain,Person Linkedin Url,City,State,Last Visit,Page Views,Pages Visited,Phone',
  'Jean,Horton,VP Human Resources,Zz ADP,jean@zzadp.example,zzadp.example,https://www.linkedin.com/in/jean-h,Chicago,IL,2026-10-17,4,"/pricing, /employer-partners",312-555-0100',
  'Margo,R.,Benefits Manager,Zz Calpine,,,,Houston,TX,10/18/2026,2,/,',
  ',,Director,Zz Nameless,,,,,,2026-10-19,1,/,',
  'Sam,Rivera,Head of People,Zz ADP,,www.zzadp.example,,,,2026-10-19,1,/benefits,',
].join('\n');

test('Visited People export: the header row is found under a title row, columns map by name, email + phone columns are never read, dates in both forms, people grouped per company with the latest visit; rows without a name or company are skipped', () => {
  const out = parseVisitedPeopleCsv(CSV);
  assert.equal(out.header_row, 3);
  assert.equal(out.skipped, 1);
  assert.deepEqual(out.people.map(p => [p.name, p.title, p.company, p.domain, p.last_visit, p.visits, p.pages, p.location, p.linkedin_url]), [
    ['Jean Horton', 'VP Human Resources', 'Zz ADP', 'zzadp.example', '2026-10-17', 4, '/pricing, /employer-partners', 'Chicago, IL', 'https://www.linkedin.com/in/jean-h'],
    ['Margo R.', 'Benefits Manager', 'Zz Calpine', null, '2026-10-18', 2, '/', 'Houston, TX', null],
    ['Sam Rivera', 'Head of People', 'Zz ADP', 'zzadp.example', '2026-10-19', 1, '/benefits', null, null],
  ]);
  assert.ok(out.people.every(p => p.source_kind === 'web_visit' && /^Identified visitor · 2026-10-\d\d · pages /.test(p.note)));
  assert.deepEqual(out.companies, [
    { name: 'Zz ADP', domain: 'zzadp.example', company_key: 'zz adp', people: 2, last_visit: '2026-10-19' },
    { name: 'Zz Calpine', domain: null, company_key: 'zz calpine', people: 1, last_visit: '2026-10-18' },
  ]);
  const text = JSON.stringify(out);
  assert.ok(!text.includes('@') && !text.includes('555'), 'no address or phone anywhere in the output');
  assert.throws(() => parseVisitedPeopleCsv('a,b\n1,2'), /header row/);
  assert.equal(parseVisitedPeopleCsv(CSV, { max: 1 }).people.length, 1);
  const byName = parseVisitedPeopleCsv('Name,Company,Last Visit\n"Ana Example","Zz Birch",2026-10-20\n');
  assert.deepEqual([byName.people[0].name, byName.people[0].company, byName.people[0].last_visit], ['Ana Example', 'Zz Birch', '2026-10-20']);
});

test('caps: searches left today', () => {
  assert.equal(capLeft(0), PEOPLE_SEARCH_DAILY_CAP);
  assert.equal(capLeft(PEOPLE_SEARCH_DAILY_CAP + 3), 0);
  assert.equal(capLeft(4, 10), 6);
});
