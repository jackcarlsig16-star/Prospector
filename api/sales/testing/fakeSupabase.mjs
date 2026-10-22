// In-memory stand-in for the slice of supabase-js the sales routes use:
// filters, order, range, limit, single/maybeSingle, insert/upsert/update/delete
// with .select(), the one embed the targets list uses (note:sales_call_notes(...)),
// and optional unique keys ({ unique: { table: row => key | null } }) that
// answer a colliding insert with code 23505 like Postgres does. now: a clock
// (() => ms) for the created_at / recorded_at an insert stamps, so a test that
// pins its own `now` stamps rows on that day, not the real one.
import { randomUUID } from 'node:crypto';

// Enough of supabase-js for these routes: filters, order, range, limit,
// single/maybeSingle, insert/update/delete with .select(), and the one
// embed the targets list uses (note:sales_call_notes(...)).
export function fakeSupabase(seed, { unique = {}, now = Date.now } = {}) {
  const stamp = () => new Date(now()).toISOString();
  const db = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map(r => ({ ...r }))]));
  const matches = (row, f) => ({
    eq: () => row[f.k] === f.v, neq: () => row[f.k] !== f.v, in: () => f.v.includes(row[f.k]), gte: () => row[f.k] >= f.v,
    is: () => (f.v === null ? row[f.k] == null : row[f.k] === f.v), not_is: () => row[f.k] != null,
  })[f.op]();
  const exec = (table, q) => {
    db[table] ||= [];
    let rows;
    if (q.op === 'insert') {
      rows = (Array.isArray(q.payload) ? q.payload : [q.payload]).map(r => ({ id: randomUUID(), created_at: stamp(), recorded_at: stamp(), ...r }));
      const key = unique[table];
      if (key && rows.some(r => key(r) != null && db[table].some(x => key(x) === key(r)))) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      db[table].push(...rows);
    } else if (q.op === 'upsert') {
      const cols = q.onConflict.split(',');
      rows = (Array.isArray(q.payload) ? q.payload : [q.payload]).map(r => {
        const hit = db[table].find(x => cols.every(c => x[c] === r[c]));
        if (hit) return Object.assign(hit, r);
        const row = { id: randomUUID(), created_at: stamp(), recorded_at: stamp(), ...r };
        db[table].push(row);
        return row;
      });
    } else {
      const sel = db[table].filter(r => q.filters.every(f => matches(r, f)));
      if (q.op === 'update') sel.forEach(r => Object.assign(r, q.payload));
      if (q.op === 'delete') db[table] = db[table].filter(r => !sel.includes(r));
      rows = sel;
    }
    if (q.op === 'select') {
      for (const [k, asc] of [...q.order].reverse()) rows = [...rows].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1));
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      if (q.limit != null) rows = rows.slice(0, q.limit);
      if (table === 'sales_targets' && q.cols.includes('sales_call_notes(')) rows = rows.map(r => ({ ...r, note: (db.sales_call_notes || []).find(n => n.id === r.source_note_id) || null }));
      if (q.cols !== '*' && !q.cols.includes('!')) {
        const keep = q.cols.replace(/\([^)]*\)/g, '').split(',').map(c => c.trim().split(':')[0]).filter(Boolean);
        rows = rows.map(r => Object.fromEntries(keep.filter(k => k in r).map(k => [k, r[k]])));
      }
      if (q.head) return { data: null, error: null, count: rows.length };
    }
    if (q.single === 'one') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: `expected one row, got ${rows.length}` } };
    if (q.single === 'maybe') return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  };
  const from = table => {
    const q = { op: 'select', filters: [], order: [], range: null, limit: null, single: null, cols: '*', head: false };
    const f = op => (k, v) => { q.filters.push({ op, k, v }); return b; };
    const b = {
      select(cols = '*', opts = {}) { if (q.op === 'select') { q.cols = cols; q.head = !!opts.head; } return b; },
      insert(p) { q.op = 'insert'; q.payload = p; return b; }, upsert(p, o = {}) { q.op = 'upsert'; q.payload = p; q.onConflict = o.onConflict; return b; }, update(p) { q.op = 'update'; q.payload = p; return b; }, delete() { q.op = 'delete'; return b; },
      eq: f('eq'), neq: f('neq'), in: f('in'), gte: f('gte'), is: f('is'), not(k) { q.filters.push({ op: 'not_is', k }); return b; },
      order(k, o = {}) { q.order.push([k, o.ascending !== false]); return b; }, limit(n) { q.limit = n; return b; }, range(a, z) { q.range = [a, z]; return b; },
      maybeSingle() { q.single = 'maybe'; return b; }, single() { q.single = 'one'; return b; },
      then(res, rej) { return Promise.resolve().then(() => exec(table, q)).then(res, rej); },
    };
    return b;
  };
  return { from, db };
}
