import { randomUUID } from 'crypto';

// An in-memory stand-in for the Supabase client, for the to-do suites: the filters, writes and returns the to-do
// writer and its callers use. tables = { name: [rows] } (mutated in place, so a test reads them back).
// the column defaults the real table has
const DEFAULTS = { sales_week_goals: { kind: 'todo', status: 'open', sort_order: 0, origin: 'manual' } };
export function memDb(tables = {}) {
  const t = name => (tables[name] ||= []);
  const stamp = () => new Date().toISOString();
  function query(name) {
    const filters = []; let op = 'select', payload = null, wantRows = false, one = null, orders = [], lim = null, head = false, counted = false, embed = null;
    const rows = () => t(name).filter(r => filters.every(f => f(r)));
    const api = {
      select(cols, opts = {}) { wantRows = true; head = !!opts.head; counted = !!opts.count; embed = /(\w+):(\w+)\(\*\)/.exec(cols || ''); return api; },
      insert(v) { op = 'insert'; payload = Array.isArray(v) ? v : [v]; return api; },
      update(v) { op = 'update'; payload = v; return api; },
      delete() { op = 'delete'; return api; },
      eq(k, v) { filters.push(r => (r[k] ?? null) === v); return api; },
      neq(k, v) { filters.push(r => (r[k] ?? null) !== v); return api; },
      is(k, v) { filters.push(r => (r[k] ?? null) === v); return api; },
      in(k, vs) { filters.push(r => vs.includes(r[k])); return api; },
      not(k, o, v) { filters.push(r => (o === 'is' ? (r[k] ?? null) !== v : true)); return api; },
      gte(k, v) { filters.push(r => r[k] != null && r[k] >= v); return api; },
      gt(k, v) { filters.push(r => r[k] != null && r[k] > v); return api; },
      lte(k, v) { filters.push(r => r[k] != null && r[k] <= v); return api; },
      lt(k, v) { filters.push(r => r[k] != null && r[k] < v); return api; },
      or() { return api; },
      order(k, o = {}) { orders.push([k, o.ascending === false ? -1 : 1]); return api; },
      limit(n) { lim = n; return api; },
      range(a, b) { api._range = [a, b]; return api; },
      maybeSingle() { one = 'maybe'; return api; },
      single() { one = 'single'; return api; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    function run() {
      if (tables.__fail?.[name]?.[op]) return { data: null, error: { message: tables.__fail[name][op] } };
      let out;
      if (op === 'insert') {
        out = payload.map(p => ({ id: randomUUID(), created_at: stamp(), updated_at: stamp(), ...DEFAULTS[name], ...p }));
        t(name).push(...out);
      } else if (op === 'update') {
        out = rows(); for (const r of out) Object.assign(r, payload);
      } else if (op === 'delete') {
        out = rows(); tables[name] = t(name).filter(r => !out.includes(r));
      } else out = rows();
      out = out.map(r => ({ ...r, ...(embed ? { [embed[1]]: t(embed[2]).filter(x => x.goal_id === r.id).map(x => ({ ...x })) } : {}) }));
      for (const [k, d] of [...orders].reverse()) out.sort((a, b) => (a[k] === b[k] ? 0 : a[k] == null ? 1 : b[k] == null ? -1 : a[k] < b[k] ? -d : d));
      if (api._range) out = out.slice(api._range[0], api._range[1] + 1);
      if (lim != null) out = out.slice(0, lim);
      if (head) return { data: null, count: out.length, error: null };
      if (one) return out.length ? { data: out[0], error: null } : one === 'maybe' ? { data: null, error: null } : { data: null, error: { message: 'no rows' } };
      return { data: wantRows || op === 'select' ? out : null, count: counted ? out.length : undefined, error: null };
    }
    return api;
  }
  return { from: query, tables };
}
