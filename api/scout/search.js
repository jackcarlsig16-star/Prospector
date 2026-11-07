import { cleanText, hasPii } from '../sales/scrubText.js';
import { laDateString } from '../sales/laDate.js';
import { scoutDeps, getScoutSupabase, scopedBusinesses } from './registry.js';

// scout-v2 REV2 Stage 1 (D1) - GET /api/scout/search?q=&scope=<businessId|all>&limit= -> { groups: [{ entity, label,
// items: [{ id, title, subtitle, date, workspace_id, workspace_name, open }] }] }, at most PER_GROUP per group and
// TOTAL in all, over the entities every module in scope registered. Scoped by membership (the platform owner: all).
export const PER_GROUP = 8, TOTAL = 40, MIN_CHARS = 2;

export async function search(supabase, registry, { auth, q, scope, limit = PER_GROUP, now = Date.now() }) {
  const text = cleanText(String(q || ''), 120).trim();
  if (text.length < MIN_CHARS) return { q: text, scope, groups: [] };
  const per = Math.max(1, Math.min(PER_GROUP, Number(limit) || PER_GROUP));
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const today = laDateString(new Date(now));
  const businesses = await scopedBusinesses(supabase, auth, scope);
  const groups = new Map();
  for (const b of businesses) for (const e of registry.entitiesFor(b)) {
    if (e.gate && !e.gate({ words, q: text })) continue;
    const rows = await e.search(supabase, { businessId: b.id, business: b, auth, q: text, words, limit: per, today });
    if (!rows.length) continue;
    const g = groups.get(e.entity) || { entity: e.entity, label: e.label, items: [] };
    for (const r of rows) {
      const item = { id: String(r.id), title: cleanText(String(r.title || ''), 120), subtitle: r.subtitle ? cleanText(String(r.subtitle), 160) : null, date: r.date || null, workspace_id: b.id, workspace_name: b.name, open: e.open ? e.open(String(r.id), r) : null };
      if (hasPii(`${item.title} ${item.subtitle || ''}`)) continue;
      g.items.push(item);
    }
    groups.set(e.entity, g);
  }
  const out = [...groups.values()].map(g => ({ ...g, items: g.items.slice(0, per) })).filter(g => g.items.length);
  // The total cap trims round-robin from the longest groups so every group keeps its first hits.
  let total = out.reduce((n, g) => n + g.items.length, 0);
  while (total > TOTAL) { const longest = out.reduce((a, g) => (g.items.length > a.items.length ? g : a), out[0]); longest.items.pop(); total -= 1; }
  return { q: text, scope, groups: out.filter(g => g.items.length), workspaces: businesses.map(b => ({ id: b.id, name: b.name })) };
}

export async function searchRoute(req, res) {
  try {
    const scope = typeof req.query.scope === 'string' && req.query.scope ? req.query.scope : (req.auth.roles.keys().next().value || 'all');
    const out = await search(await getScoutSupabase(), scoutDeps.registry(), { auth: req.auth, q: req.query.q, scope, limit: req.query.limit });
    res.json(out);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}
