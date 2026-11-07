// In-memory stand-in for the slice of supabase-js the sales routes use:
// filters, order, range, limit, single/maybeSingle, insert/upsert/update/delete
// with .select(), the one embed the targets list uses (note:sales_call_notes(...)),
// and optional unique keys ({ unique: { table: row => key | null } }, or a list
// of { name, key } per table for several named indexes) that answer a colliding
// insert with code 23505 like Postgres does, naming the index when given. now: a clock
// (() => ms) for the created_at / recorded_at an insert stamps, so a test that
// pins its own `now` stamps rows on that day, not the real one. Each inserted
// row gets a strictly later stamp than the last (Postgres's microsecond now()
// never ties across separate requests; a millisecond clock did, and "latest"
// then fell to a random uuid - the flaky partner Undo test). triggers: { table:
// ({ op, old, row, insert }) } runs after each inserted / updated row, like an
// AFTER ROW trigger (insert(table, row) writes another row). storage: a tiny
// in-memory bucket store (createSignedUploadUrl / list / createSignedUrl);
// put(bucket, path, { size, mimetype }) stands in for the browser's upload.
import { randomUUID } from 'node:crypto';

// Enough of supabase-js for these routes: filters, order, range, limit,
// single/maybeSingle, insert/update/delete with .select(), and the one
// embed the targets list uses (note:sales_call_notes(...)).
export function fakeSupabase(seed, { unique = {}, now = Date.now, triggers = {} } = {}) {
  let last = -Infinity;
  const stamp = () => { last = Math.max(now(), last + 1); return new Date(last).toISOString(); };
  const stamped = r => { const at = stamp(); return { id: randomUUID(), created_at: at, recorded_at: at, ...r }; };
  const db = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map(r => ({ ...r }))]));
  // scout-v2: ilike (PostgREST % wildcards, case-insensitive), or("a.ilike.%x%,b.eq.y,c.is.null"), contains (array column)
  // and the json path "data->>name" that Scout's searches use.
  const col = (row, k) => (k.includes('->>') ? k.split('->>').reduce((o, p) => (o == null ? o : o[p]), row) : row[k]);
  const likeRe = pat => new RegExp('^' + String(pat).split('%').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.')).join('.*') + '$', 'is');
  const parseOr = expr => expr.split(/,(?=[a-z_>-]+\.(?:ilike|eq|is|neq)\.)/).map(part => { const m = /^([^.]+)\.(ilike|eq|is|neq)\.(.*)$/s.exec(part.trim()); return { op: m[2], k: m[1], v: m[2] === 'is' && m[3] === 'null' ? null : m[3] }; });
  const matches = (row, f) => ({
    eq: () => col(row, f.k) === f.v, neq: () => col(row, f.k) !== f.v, in: () => f.v.includes(row[f.k]), gte: () => row[f.k] >= f.v, lte: () => row[f.k] != null && row[f.k] <= f.v, lt: () => row[f.k] != null && row[f.k] < f.v,
    is: () => (f.v === null ? col(row, f.k) == null : col(row, f.k) === f.v), not_is: () => row[f.k] != null,
    ilike: () => likeRe(f.v).test(String(col(row, f.k) ?? '')), or: () => f.v.some(sub => matches(row, sub)), contains: () => Array.isArray(row[f.k]) && f.v.every(x => row[f.k].includes(x)),
  })[f.op]();
  const addRow = (table, r) => { (db[table] ||= []).push(stamped(r)); };
  const exec = (table, q) => {
    db[table] ||= [];
    let rows;
    if (q.op === 'insert') {
      rows = (Array.isArray(q.payload) ? q.payload : [q.payload]).map(stamped);
      const u = unique[table], keys = Array.isArray(u) ? u : u ? [{ name: null, key: u }] : [];
      const hit = keys.find(({ key }) => rows.some(r => key(r) != null && db[table].some(x => key(x) === key(r))));
      if (hit) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint${hit.name ? ` "${hit.name}"` : ''}` } };
      db[table].push(...rows);
      if (triggers[table]) rows.forEach(r => triggers[table]({ op: 'insert', old: null, row: r, insert: addRow }));
    } else if (q.op === 'upsert') {
      const cols = q.onConflict.split(',');
      rows = (Array.isArray(q.payload) ? q.payload : [q.payload]).map(r => {
        const hit = db[table].find(x => cols.every(c => x[c] === r[c]));
        if (hit) return Object.assign(hit, r);
        const row = stamped(r);
        db[table].push(row);
        return row;
      });
    } else {
      const sel = db[table].filter(r => q.filters.every(f => matches(r, f)));
      if (q.op === 'update') sel.forEach(r => { const old = { ...r }; Object.assign(r, q.payload); if (triggers[table]) triggers[table]({ op: 'update', old, row: r, insert: addRow }); });
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
      eq: f('eq'), neq: f('neq'), in: f('in'), gte: f('gte'), lte: f('lte'), lt: f('lt'), is: f('is'), not(k) { q.filters.push({ op: 'not_is', k }); return b; },
      ilike: f('ilike'), contains: f('contains'), or(expr) { q.filters.push({ op: 'or', v: parseOr(expr) }); return b; },
      order(k, o = {}) { q.order.push([k, o.ascending !== false]); return b; }, limit(n) { q.limit = n; return b; }, range(a, z) { q.range = [a, z]; return b; },
      maybeSingle() { q.single = 'maybe'; return b; }, single() { q.single = 'one'; return b; },
      then(res, rej) { return Promise.resolve().then(() => exec(table, q)).then(res, rej); },
    };
    return b;
  };
  const objects = new Map();
  const storage = {
    from: bucket => ({
      async createSignedUploadUrl(path) { return { data: { signedUrl: `https://storage.test/upload/${bucket}/${path}?token=t`, token: 't', path }, error: null }; },
      async list(folder, { search = '' } = {}) {
        const out = [...objects].filter(([k]) => k.startsWith(`${bucket}/${folder}/`)).map(([k, meta]) => ({ name: k.slice(bucket.length + folder.length + 2), metadata: meta }));
        return { data: out.filter(o => !o.name.includes('/') && o.name.includes(search)), error: null };
      },
      async createSignedUrl(path, expiresIn) { return objects.has(`${bucket}/${path}`) ? { data: { signedUrl: `https://storage.test/sign/${bucket}/${path}?expires=${expiresIn}` }, error: null } : { data: null, error: { message: 'Object not found' } }; },
    }),
  };
  const put = (bucket, path, meta) => objects.set(`${bucket}/${path}`, meta);
  return { from, db, storage, put, objects };
}

// The sales_opportunities_log_event trigger (20261001_sales_pipeline_v1.sql) for tests that need its event rows.
export const opportunityEventsTrigger = ({ op, old, row, insert }) => {
  if (op === 'insert') insert('sales_opportunity_events', { business_id: row.business_id, opportunity_id: row.id, event_type: 'created', from_stage: null, to_stage: row.stage, changed_at: new Date().toISOString() });
  else if (row.archived_at && !old.archived_at) insert('sales_opportunity_events', { business_id: row.business_id, opportunity_id: row.id, event_type: 'archived', from_stage: old.stage, to_stage: row.stage, changed_at: new Date().toISOString() });
  else if (row.stage !== old.stage) insert('sales_opportunity_events', { business_id: row.business_id, opportunity_id: row.id, event_type: 'stage_change', from_stage: old.stage, to_stage: row.stage, changed_at: new Date().toISOString() });
};
