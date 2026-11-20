import { selectAllPages } from '../lib/selectAllPages.js';
import { normName } from './normName.js';
import { addDays } from './goalsShared.js';
import { cleanText } from './scrubText.js';

// FIX scout-company-lookup S1 / S4 - the sales module's name index for Scout: every company name a question can mean,
// keyed by normName - partners, employers, targets, and the companies seen on the site in VISITOR_DAYS that have no
// record. Names and ids only, one read per table, kept NAME_INDEX_TTL_MS per client and business. A visit row matched
// to a record under another spelling is an alias of that record. find() also matches with the spaces taken out, so
// "grey orange" finds GreyOrange.
export const NAME_INDEX_TTL_MS = 5 * 60e3;
export const VISITOR_DAYS = 90;
export const NEAR_MAX = 3;
const ENTITY_OF = { partner: 'partners', employer: 'employers', target: 'targets' };
const cache = new WeakMap();
const squash = k => k.replace(/ /g, '');
const day = v => (v ? String(v).slice(0, 10) : null);

function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export function buildNameIndex({ partners, employers, targets, visits }) {
  const byKey = new Map(), bySquash = new Map(), byId = new Map();
  const put = (key, entry) => { if (!key || byKey.has(key)) return; byKey.set(key, entry); if (!bySquash.has(squash(key))) bySquash.set(squash(key), entry); };
  const record = (type, id, name) => { const e = { type, entity: ENTITY_OF[type], id, name: cleanText(name, 160) }; byId.set(`${type}:${id}`, e); put(normName(name), e); };
  for (const p of partners) record('partner', p.id, p.name);
  for (const o of employers) record('employer', o.id, o.organization);
  for (const t of targets) record('target', t.id, t.name);
  const seen = new Map();
  for (const v of visits) {
    const key = normName(v.company_name);
    if (!key) continue;
    const matched = v.matched_id ? byId.get(`${v.matched_type}:${v.matched_id}`) : null;
    if (matched) { put(key, matched); continue; }
    if (byKey.has(key) && byKey.get(key).type !== 'visitor') continue;
    const s = seen.get(key) || { days: new Set(), last: null, latest: null };
    s.days.add(v.pulled_on);
    const at = day(v.last_visit) || v.pulled_on;
    if (!s.last || at > s.last) s.last = at;
    if (!s.latest || v.pulled_on > s.latest.pulled_on) s.latest = v;
    seen.set(key, s);
  }
  for (const [key, s] of seen) put(key, { type: 'visitor', entity: 'visitor', id: s.latest.company_key, name: cleanText(s.latest.company_name, 160), seen: `seen on the site on ${s.days.size} day${s.days.size === 1 ? '' : 's'} in the last ${VISITOR_DAYS}, last ${s.last}`, add: { label: 'Add as target', type: 'visitor', id: s.latest.company_key } });
  return {
    size: byKey.size,
    find(text) { const k = normName(text); return k ? byKey.get(k) || bySquash.get(squash(k)) || null : null; },
    // S4: "Did you mean …" - records whose name is within 2 edits of the typed one, or that it opens (or that open it).
    near(text) {
      const k = normName(text);
      if (!k || k.length < 4) return [];
      const out = [];
      for (const [key, e] of byKey) {
        if (e.type === 'visitor' || key === k) continue;
        const d = distance(squash(k), squash(key), 2);
        if (d <= 2) out.push({ e, rank: d });
        else if (key.startsWith(k) || k.startsWith(`${key} `)) out.push({ e, rank: 3 });
      }
      return [...new Map(out.sort((a, b) => a.rank - b.rank || a.e.name.localeCompare(b.e.name)).map(x => [`${x.e.type}:${x.e.id}`, x.e])).values()].slice(0, NEAR_MAX);
    },
  };
}

export async function nameIndex(sb, { businessId, today, now = Date.now() }) {
  const perClient = cache.get(sb) || new Map();
  cache.set(sb, perClient);
  const hit = perClient.get(businessId);
  if (hit && now - hit.at < NAME_INDEX_TTL_MS) return hit.index;
  const all = (table, cols, build = x => x) => selectAllPages(() => build(sb.from(table).select(cols).eq('business_id', businessId)).order('id'));
  const [partners, employers, targets, visits] = await Promise.all([
    all('sales_goals', 'id, name', x => x.eq('goal_type', 'partnership').is('archived_at', null)),
    all('sales_opportunities', 'id, organization', x => x.is('archived_at', null)),
    all('sales_targets', 'id, name'),
    all('web_visits', 'id, company_key, company_name, pulled_on, last_visit, matched_type, matched_id', x => x.gte('pulled_on', addDays(today, -VISITOR_DAYS))),
  ]);
  const index = buildNameIndex({ partners, employers, targets, visits });
  perClient.set(businessId, { at: now, index });
  return index;
}
