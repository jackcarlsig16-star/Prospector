import { savePayload } from './opportunityPayload';

test('an edit sends only changed fields, never the server-only columns the row carries', () => {
  const row = { id: 'o1', business_id: 'b', organization: 'Acme', stage: 'target', covered_lives: 100, notes: null,
    record_id: 'HLU-0001', tier: '2', apollo_account_id: 'ap1', owner_team: 'upside', created_at: 'x', updated_at: 'y' };
  expect(savePayload(row, { ...row, stage: 'contacted', covered_lives: '250', notes: '' })).toEqual({ stage: 'contacted', covered_lives: 250 });
  expect(savePayload(row, { ...row })).toEqual({});
});

test('a create sends every draft field, blanks as null', () => {
  expect(savePayload(null, { organization: 'New Co', stage: 'target', covered_lives: '', is_top: false }))
    .toEqual({ organization: 'New Co', stage: 'target', covered_lives: null, is_top: false });
});
