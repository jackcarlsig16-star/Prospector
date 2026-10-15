import { parseCsv } from './csv';

test('a quoted cell keeps its line breaks and the row count is right', () => {
  const { headers, rows } = parseCsv('a,b\r\n1,"line one\r\nline two"\r\n2,"x, ""y"""\n3,\n');
  expect(headers).toEqual(['a', 'b']);
  expect(rows).toHaveLength(3);
  expect(rows[0].b).toBe('line one\r\nline two');
  expect(rows[1].b).toBe('x, "y"');
  expect(rows[2]).toEqual({ a: '3', b: '' });
});

test('plain files parse as before', () => {
  const { rows } = parseCsv('name,domain\nAcme,acme.com\n\nBeta,beta.io');
  expect(rows).toEqual([{ name: 'Acme', domain: 'acme.com' }, { name: 'Beta', domain: 'beta.io' }]);
});
