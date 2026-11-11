import { pathToFileURL } from 'url';

// scout-v2 REV2 Stage 1 - the registry of module readers. Each module registers, from a file in its OWN folder, what
// Scout may read there; core Scout (this folder) iterates the registry and names no workspace. server.js hands the
// module files to ensureRegistry by path, the same way it mounts every module's routes by path.
//
// A module registers { appliesTo, entities, intents, standing, glossary, vocabulary }:
//   appliesTo(business)            -> bool; the module's own rule for a workspace (its feature flag), business = { id, name, features }
//   entities: [{ entity, label, search(supabase, { businessId, q, words, limit, today }) -> [{ id, title, subtitle?, date?, text? }],
//               open(id, row) -> { page, params?, hash?, inline? }, gate?({ words }) -> bool }]
//   intents:  [{ id, match(ask) -> bool, run(supabase, { businessId, auth, ask, today, now }) -> { read, items: [{ entity, id, title, text, date? }] } }]
//   standing(supabase, ctx)        -> { reads: [], items }   (what every fallback ask carries: the caller's open to-dos, recent notes ...)
//   glossary(supabase, ctx)        -> { lines: [], vocabulary }  (D7: the house words, built from the data the screens use)
//   verbs: [{ id, label, done, lead (RegExp on the command's start), accepts: [entity], needs?: 'member' | 'date',
//             plan(supabase, ctx, targets, args) -> { rows: [{ key, kind, title, from, to, skipped?, blocked?, note?, exec }] } | { cant } | { open, line },
//             act(supabase, ctx, exec) -> { undo?, to?, skipped? }, undo(supabase, ctx, exec, handle) }]   (scout-v3 S1: /plan, /act, /undo)
//   members(supabase, businessId) -> [{ id, name }]   pack(supabase, ctx, { q, records }) -> { text, records, chars } | { blocked }
//   vocabulary: { entities: { <entity>: [words] }, bands: { word: band }, sources: { word: label } } - static words; glossary adds the dynamic ones
export function createRegistry() {
  const modules = [];
  const reg = {
    register(name, def) {
      modules.push({ name, appliesTo: def.appliesTo || (() => true), entities: def.entities || [], openers: def.openers || {}, intents: def.intents || [], standing: def.standing || null, glossary: def.glossary || null, vocabulary: def.vocabulary || {}, verbs: def.verbs || [], members: def.members || null, pack: def.pack || null });
    },
    modulesFor(business) { return modules.filter(m => m.appliesTo(business)); },
    entitiesFor(business) { return reg.modulesFor(business).flatMap(m => m.entities.map(e => ({ ...e, module: m.name }))); },
    openerFor(entity) { for (const m of modules) { const e = m.entities.find(x => x.entity === entity); if (e?.open) return e.open; if (m.openers[entity]) return m.openers[entity]; } return null; },
    labelOf(entity) { for (const m of modules) { const e = m.entities.find(x => x.entity === entity); if (e) return e.label; } return entity; },
    modules,
  };
  return reg;
}

let shared = null, loading = null;
export async function ensureRegistry(paths = []) {
  if (shared) return shared;
  loading ||= (async () => {
    const r = createRegistry();
    for (const p of paths) { const mod = await import(/^file:/.test(p) ? p : pathToFileURL(p).href); await mod.register(r); }
    shared = r;
    return r;
  })();
  return loading;
}

// Tests swap these; the routes read through them.
export const scoutDeps = { registry: () => shared, getSupabase: null };
export async function getScoutSupabase() {
  if (!scoutDeps.getSupabase) scoutDeps.getSupabase = (await import('../sales/goalsShared.js')).getSupabase;
  return scoutDeps.getSupabase();
}

// The workspaces an ask or a search may read: the platform owner sees every workspace, everyone else the ones in
// req.auth.roles. scope = 'all' | one business id. Returns [{ id, name, features }] or throws { status: 403 }.
export async function scopedBusinesses(supabase, auth, scope) {
  const all = scope === 'all';
  const allowed = auth.isPlatformOwner ? null : [...auth.roles.keys()];
  if (!all && !auth.isPlatformOwner && !auth.roles.has(scope)) throw Object.assign(new Error('You are not in that workspace'), { status: 403 });
  let q = supabase.from('businesses').select('id, name, features').order('name');
  if (!all) q = q.eq('id', scope);
  else if (allowed) q = q.in('id', allowed.length ? allowed : ['-']);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}
