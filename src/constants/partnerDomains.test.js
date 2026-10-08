import { normalizeDomain, parseDomainsFromSources, ownDomainFromSources, normalizeName, matchApolloAccounts, suggestionsFor, pendingSuggestions, SUGGESTION_BADGE, apolloAccountFor, exportCandidates, buildApolloCsv } from './partnerDomains';

// partner-360-v1 Stage 2 - the audit's examples (audits/partner-apollo-link-audit-report.md §2).
const accounts = [
  { id: 'a1', name: 'PerkSpot', domain: 'perkspot.com' }, { id: 'a2', name: 'Access Development', domain: 'accessdevelopment.com' },
  { id: 'a3', name: 'BenefitHub', domain: 'benefithub.com' }, { id: 'a4', name: 'Corestream', domain: 'corestream.com' },
  { id: 'a5', name: 'OneDigital', domain: 'onedigital.com' }, { id: 'a6', name: 'Gallagher', domain: 'ajg.com' },
  { id: 'a7', name: 'Stake', domain: 'stake.rent' }, { id: 'a8', name: 'Bilt', domain: 'bilt.com' },
  { id: 'a9', name: 'Domuso', domain: 'domuso.com' }, { id: 'a10', name: 'Action Property Management', domain: 'actionlife.com' },
  { id: 'a11', name: 'Gravy', domain: 'gravy.co' }, { id: 'a12', name: 'Piñata Rent', domain: 'pinata.ai' },
  { id: 'a13', name: 'Lockton Companies', domain: 'lockton.com' },
];
const partners = [
  { id: 'p1', name: 'Justworks', sources: 'justworks.com/about; justworks.com/press', category: '3. PEOs', tier: '1', owner_user_id: 'u-jack' },
  { id: 'p2', name: 'PerkSpot', sources: 'perkspot.com/about; perkspot.com/careers; lincolninternational.com (Perkopolis)' },
  { id: 'p3', name: 'Access Development', sources: 'accessdevelopment.com/about-access' },
  { id: 'p4', name: 'BenefitHub', sources: 'benefithub.com/about-benefithub; benefithub.com/news/x' },
  { id: 'p5', name: 'Corestream', sources: 'corp.corestream.com; businesswire.com/news/home/2026/en/' },
  { id: 'p6', name: 'OneDigital', sources: 'onedigital.com/about; onedigital.com/en-US/newsroom' },
  { id: 'p7', name: 'Gallagher', sources: 'ajg.com/about-us; ajg.com/employeeexperience' },
  { id: 'p8', name: 'Stake', sources: null }, { id: 'p9', name: 'Bilt', sources: null }, { id: 'p10', name: 'Domuso', sources: null },
  { id: 'p11', name: 'Action Property Management', sources: null }, { id: 'p12', name: 'Gravy', sources: null },
  { id: 'p13', name: 'Piñata', sources: 'pinata.ai/blog; newsfilecorp.com/release/205551' },
  { id: 'p14', name: 'Esusu', sources: 'esusurent.com; nationalmortgagenews.com (15K mortgages; Series C)' },
  { id: 'p15', name: 'Lockton', sources: 'global.lockton.com/us/en' },
  { id: 'p16', name: 'EBG (Entertainment Benefits Group)', sources: 'ebgsolutions.com; bp.beneplace.com/blog/ebg-acquires-beneplace' },
  { id: 'p17', name: 'WTW', sources: 'wtwco.com (Sept 2025 survey)' },
  { id: 'p18', name: 'Insperity', sources: 'insperity.com/about-us; insperity.com press releases' },
];

test('normalizeDomain: scheme, www, path, case, junk', () => {
  expect(normalizeDomain('https://www.Justworks.com/about')).toBe('justworks.com');
  expect(normalizeDomain('corp.corestream.com')).toBe('corp.corestream.com');
  expect(normalizeDomain('stake.rent/about.html')).toBe('stake.rent');
  expect(normalizeDomain('wtwco.com (Sept 2025 survey)')).toBe('wtwco.com');
  for (const bad of ['', 'nodot', '15k', '-bad.com', 'bad-.com', 'a.b', 'name@company.com', null, 42]) expect(normalizeDomain(bad)).toBeNull();
});

test('parseDomainsFromSources: own site first, press after, notes ignored', () => {
  expect(parseDomainsFromSources(partners[1].sources)).toEqual(['perkspot.com', 'lincolninternational.com']);
  expect(parseDomainsFromSources(partners[13].sources)).toEqual(['esusurent.com', 'nationalmortgagenews.com']);
  expect(parseDomainsFromSources(partners[17].sources)).toEqual(['insperity.com']);
  expect(parseDomainsFromSources(null)).toEqual([]);
  expect(ownDomainFromSources(partners[4].sources)).toBe('corp.corestream.com');
  expect(partners.map(p => ownDomainFromSources(p.sources)).filter(Boolean)).toHaveLength(13);
});

test('normalizeName: diacritics, parentheticals, legal suffixes', () => {
  expect(normalizeName('Piñata')).toBe('pinata');
  expect(normalizeName('EBG (Entertainment Benefits Group)')).toBe('ebg');
  expect(normalizeName('Lockton Companies')).toBe('lockton companies');
  expect(normalizeName('Gallagher, Inc.')).toBe('gallagher');
});

test('matchApolloAccounts: the audit\'s 11 by name and 7 by domain, Piñata only by domain, Corestream only by name', () => {
  const byName = partners.filter(p => matchApolloAccounts({ name: p.name }, accounts).byName.length).map(p => p.name);
  expect(byName).toEqual(['PerkSpot', 'Access Development', 'BenefitHub', 'Corestream', 'OneDigital', 'Gallagher', 'Stake', 'Bilt', 'Domuso', 'Action Property Management', 'Gravy']);
  const byDomain = partners.filter(p => { const d = ownDomainFromSources(p.sources); return d && matchApolloAccounts({ name: p.name, domains: [d] }, accounts).byDomain.length; }).map(p => p.name);
  expect(byDomain).toEqual(['PerkSpot', 'Access Development', 'BenefitHub', 'OneDigital', 'Gallagher', 'Piñata']);
  expect(byDomain).not.toContain('Corestream');
});

test('suggestionsFor: sheet domain + Apollo domains, minus stored rows; both = sheet and a same-name Apollo account agree', () => {
  expect(suggestionsFor(partners[4], [], accounts)).toEqual([
    { domain: 'corp.corestream.com', source: 'sources', apollo_account: null, both: false },
    { domain: 'corestream.com', source: 'apollo', apollo_account: { id: 'a4', name: 'Corestream', domain: 'corestream.com' }, both: false },
  ]);
  expect(suggestionsFor(partners[1], [], accounts)).toEqual([{ domain: 'perkspot.com', source: 'sources', apollo_account: { id: 'a1', name: 'PerkSpot', domain: 'perkspot.com' }, both: true }]);
  expect(suggestionsFor(partners[7], [], accounts)).toEqual([{ domain: 'stake.rent', source: 'apollo', apollo_account: { id: 'a7', name: 'Stake', domain: 'stake.rent' }, both: false }]);
  expect(suggestionsFor(partners[0], [], accounts)).toEqual([{ domain: 'justworks.com', source: 'sources', apollo_account: null, both: false }]);
  expect(suggestionsFor(partners[0], [{ domain: 'justworks.com', confirmed: false }], accounts)).toEqual([]);
  expect(suggestionsFor(partners[14], [], accounts)).toEqual([{ domain: 'global.lockton.com', source: 'sources', apollo_account: null, both: false }]);
  // Apollo has the host under a different name: one signal, not two.
  expect(suggestionsFor({ id: 'x', name: 'Perk Spot Benefits', sources: 'perkspot.com' }, [], accounts)[0].both).toBe(false);
  expect(SUGGESTION_BADGE({ source: 'sources', both: true })).toBe('Both');
  expect(SUGGESTION_BADGE({ source: 'sources', both: false })).toBe('Sheet');
  expect(SUGGESTION_BADGE({ source: 'apollo', both: false })).toBe('Apollo');
});

test('pendingSuggestions: one row per suggestion, partners by name, stored rows excluded', () => {
  const out = pendingSuggestions([partners[4], partners[1], partners[0]], { [partners[0].id]: [{ domain: 'justworks.com', confirmed: true }] }, accounts);
  expect(out).toEqual([
    { goal_id: partners[4].id, partner_name: 'Corestream', domain: 'corp.corestream.com', source: 'sources', both: false },
    { goal_id: partners[4].id, partner_name: 'Corestream', domain: 'corestream.com', source: 'apollo', both: false },
    { goal_id: partners[1].id, partner_name: 'PerkSpot', domain: 'perkspot.com', source: 'sources', both: true },
  ]);
  expect(new Set(out.map(s => s.goal_id)).size).toBe(2);
});

test('apolloAccountFor: only confirmed domains count, then the name', () => {
  expect(apolloAccountFor(partners[4], [{ domain: 'corp.corestream.com', confirmed: true }], accounts)).toEqual({ id: 'a4', name: 'Corestream', domain: 'corestream.com' });
  expect(apolloAccountFor(partners[12], [{ domain: 'pinata.ai', confirmed: false }], accounts)).toBeNull();
  expect(apolloAccountFor(partners[12], [{ domain: 'pinata.ai', confirmed: true }], accounts)).toEqual({ id: 'a12', name: 'Piñata Rent', domain: 'pinata.ai' });
  expect(apolloAccountFor(partners[0], [{ domain: 'justworks.com', confirmed: true }], accounts)).toBeNull();
});

test('exportCandidates + buildApolloCsv: confirmed, not in Apollo, primary first, no emails', () => {
  const rows = {
    p1: [{ domain: 'justworks.io', confirmed: true, is_primary: false }, { domain: 'justworks.com', confirmed: true, is_primary: true }],
    p2: [{ domain: 'perkspot.com', confirmed: true, is_primary: true }],
    p14: [{ domain: 'esusurent.com', confirmed: false }],
    p16: [{ domain: 'ebgsolutions.com', confirmed: true }],
    p8: [{ domain: 'stake.io', confirmed: true }],
  };
  const out = exportCandidates(partners, rows, accounts, id => ({ 'u-jack': 'Jack Carlson' }[id]));
  expect(out).toEqual([
    { name: 'EBG (Entertainment Benefits Group)', domain: 'ebgsolutions.com', category: '', tier: '', owner: '' },
    { name: 'Justworks', domain: 'justworks.com', category: 'PEOs', tier: '1', owner: 'Jack Carlson' },
  ]);
  const csv = buildApolloCsv(out);
  expect(csv.split('\r\n')[0]).toBe('Company Name,Website,Category,Tier,Owner');
  expect(csv).toContain('EBG (Entertainment Benefits Group),ebgsolutions.com,,,');
  expect(csv).toContain('Justworks,justworks.com,PEOs,1,Jack Carlson');
  expect(csv).not.toMatch(/@/);
  expect(buildApolloCsv([{ name: 'A "quoted", name', domain: 'a.com', category: '', tier: '', owner: '' }])).toContain('"A ""quoted"", name",a.com');
});
