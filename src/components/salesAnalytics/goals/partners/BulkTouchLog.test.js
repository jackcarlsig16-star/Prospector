import { matchPartners } from './BulkTouchLog';

// partner-360-v1 Stage 1 - pasted names -> partners.
const partners = [{ id: '1', name: 'Justworks' }, { id: '2', name: 'Gallagher' }, { id: '3', name: 'Norton / Gen Digital (Moneyline)' }, { id: '4', name: 'Gen Z Renters' }];

test('exact, loose-unique, ambiguous, unknown, duplicate lines', () => {
  const { matched, unmatched } = matchPartners('justworks\nGALLAGHER\nNorton\nGen\nNobody Inc\nJustworks\n', partners);
  expect(matched.map(m => [m.line, m.partner.id])).toEqual([['justworks', '1'], ['GALLAGHER', '2'], ['Norton', '3']]);
  expect(unmatched).toEqual([{ line: 'Gen', reason: 'matches 2 partners' }, { line: 'Nobody Inc', reason: 'no partner with that name' }, { line: 'Justworks', reason: 'same partner twice' }]);
});
