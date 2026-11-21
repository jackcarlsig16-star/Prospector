import { cleanText } from './sales/scrubText.js';
import { laDateString } from './sales/laDate.js';
import { scoutDeps, getScoutSupabase } from './scout/registry.js';

// app-shell-v2 S2 - GET /api/search?q=&business=<id> -> { q, business, groups: [{ key, label, count, items: [{ id,
// title, sub, pill: { label, value } | null, owner: { id, name } | null, due?, open }] }] } for the header's one
// field. The caller must be in that workspace (the platform owner: any); a Viewer may search. The rows come from the
// `quick` reader each module in scope registered (api/scout/registry.js) - this file names no workspace and reads no
// table itself. Plain reads only: no model call, nothing written.
export const MIN_CHARS = 2, MAX_CHARS = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function search(supabase, registry, { auth, q, business, now = Date.now() }) {
  if (!UUID.test(String(business || ''))) return { status: 400, body: { error: 'business is required' } };
  if (!auth.isPlatformOwner && !auth.roles.has(business)) return { status: 403, body: { error: 'You are not in that workspace' } };
  const text = cleanText(String(q || ''), MAX_CHARS).trim();
  if (text.length < MIN_CHARS) return { status: 200, body: { q: text, business, groups: [] } };
  const { data: b, error } = await supabase.from('businesses').select('id, name, features').eq('id', business).maybeSingle();
  if (error) throw new Error(error.message);
  if (!b) return { status: 404, body: { error: 'workspace not found' } };
  const today = laDateString(new Date(now));
  const groups = [];
  for (const m of registry.modulesFor(b)) if (m.quick) groups.push(...await m.quick(supabase, { businessId: b.id, q: text, auth, today }));
  return { status: 200, body: { q: text, business, groups } };
}

export async function searchRoute(req, res) {
  try {
    const r = await search(await getScoutSupabase(), scoutDeps.registry(), { auth: req.auth, q: req.query.q, business: req.query.business });
    res.status(r.status).json(r.body);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
}
