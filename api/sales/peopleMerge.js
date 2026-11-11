import { normName } from './intakeMatch.js';
import { SOURCE_ORDER } from '../../src/constants/peopleSource.js';

// people-v2 P2 - one row per person over the three contact tables. Merge rule: the same Apollo contact id (a prospect's
// contact_id = a partner contact's apollo_contact_id) is one person; else the same normalised name at the same normalised
// company is one person; everything else stays apart (the same name at two companies = two people). A merged row lists
// every source it came from and keeps the richer fields (a title over none, a linked company over a bare name). Pure.
const better = (a, b) => (a && String(a).trim() ? a : b || null);
export const nameKey = (name, company) => { const n = normName(name || ''), c = normName(company || ''); return n && c ? `${n}|${c}` : null; };

export function mergePeople(rows) {
  const out = [];
  const byApollo = new Map(), byNameCo = new Map();
  for (const r of rows) {
    const k1 = r.apollo_id ? `a:${r.apollo_id}` : null;
    const k2 = nameKey(r.name, r.company?.name);
    let t = (k1 && byApollo.get(k1)) || (k2 && byNameCo.get(k2)) || null;
    if (!t) {
      t = { ...r, key: r.person_key, sources: [r.source], source_keys: [r.person_key], apollo_ids: r.apollo_id ? [r.apollo_id] : [] };
      out.push(t);
    } else {
      if (!t.sources.includes(r.source)) t.sources.push(r.source);
      t.source_keys.push(r.person_key);
      if (r.apollo_id && !t.apollo_ids.includes(r.apollo_id)) t.apollo_ids.push(r.apollo_id);
      t.title = better(t.title, r.title);
      t.name = better(t.name, r.name);
      if (!t.company?.id && r.company?.id) t.company = r.company;
      t.has_email = !!(t.has_email || r.has_email);
      t.identified_at = t.identified_at || r.identified_at || null;
      t.last_touch_at = [t.last_touch_at, r.last_touch_at].filter(Boolean).sort().pop() || null;
      t.contact_id = t.contact_id || r.contact_id || null;
      t.snooze_until = t.snooze_until || r.snooze_until || null;
      t.partner_contact_ids = [...(t.partner_contact_ids || []), ...(r.partner_contact_ids || [])];
    }
    if (k1) byApollo.set(k1, t);
    if (k2) byNameCo.set(k2, t);
  }
  for (const t of out) t.sources.sort((a, b) => SOURCE_ORDER.indexOf(a) - SOURCE_ORDER.indexOf(b));
  return out;
}
