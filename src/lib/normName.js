// The ONE company-name key (ruling K6): accents folded, "&" read as "and", a bracketed aside and trailing legal
// suffixes dropped, a leading "the" dropped. The server imports this file through api/sales/normName.js, and the SQL
// function sales_norm_name is defined to return the same text; normName.fixture.json (100 real names) is what the
// server test, the client test and the migration's proof all run.
const SUFFIX = /\b(inc|llc|ltd|corp|corporation|co|plc)$/;
export function normName(s) {
  let n = String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  while (SUFFIX.test(n)) n = n.replace(SUFFIX, '').trim();
  return n.replace(/^the /, '');
}
