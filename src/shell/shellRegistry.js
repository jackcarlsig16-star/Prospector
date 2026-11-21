// app-shell-v2 - the shell's registry. The shell (nav, header, Settings groups, Connections cards, phone tabs) is drawn
// from ONE entry per kind of workspace; each entry lives in its module's own tree and says which workspaces it applies
// to by a feature flag. This file and everything under src/shell name no workspace.
//   entry = {
//     id, appliesTo(business) -> bool, home (item id),
//     items:    [{ id, label, icon, to: { page, tab?, view? }, group? ('Grow' ...), badge? ('today' | 'ideas'), soon? }],
//     settings: { workspace: [{ id, label, icon, to }], admin: [{ id, label, icon, to, gate: 'owner' | 'platform' }] },
//     feeds:    [{ id, label, note }]          the Connections cards, in order
//     phone:    [item id, item id, item id]    the bottom tabs beside the search button and More
//     search:   bool                            the header field searches this workspace's records
//   }
const REQUIRED_ITEM = ['id', 'label', 'icon', 'to'];
const GATES = ['owner', 'platform'];

export function validateEntry(e) {
  const problems = [];
  if (!e || typeof e.id !== 'string') return ['entry.id is required'];
  if (typeof e.appliesTo !== 'function') problems.push('appliesTo must be a function');
  const ids = new Set();
  for (const it of e.items || []) {
    for (const k of REQUIRED_ITEM) if (it[k] == null) problems.push(`item ${it.id || '?'}: ${k} is required`);
    if (ids.has(it.id)) problems.push(`item ${it.id}: listed twice`);
    ids.add(it.id);
  }
  if (!(e.items || []).length) problems.push('items must list at least one item');
  if (e.home && !ids.has(e.home)) problems.push(`home ${e.home} is not an item`);
  for (const id of e.phone || []) if (!ids.has(id)) problems.push(`phone tab ${id} is not an item`);
  for (const p of e.settings?.workspace || []) for (const k of REQUIRED_ITEM) if (p[k] == null) problems.push(`settings page ${p.id || '?'}: ${k} is required`);
  for (const p of e.settings?.admin || []) {
    for (const k of REQUIRED_ITEM) if (p[k] == null) problems.push(`admin page ${p.id || '?'}: ${k} is required`);
    if (!GATES.includes(p.gate)) problems.push(`admin page ${p.id || '?'}: gate must be owner or platform`);
  }
  for (const f of e.feeds || []) if (!f.id || !f.label) problems.push('a feed needs id and label');
  return problems;
}

export function createShellRegistry(entries = []) {
  const list = [];
  const reg = {
    register(entry) { const bad = validateEntry(entry); if (bad.length) throw new Error(`shell entry ${entry?.id || '?'}: ${bad.join('; ')}`); list.push(entry); return reg; },
    entryFor(business) { return (business && list.find(e => e.appliesTo(business))) || null; },
    entries: list,
  };
  entries.forEach(e => reg.register(e));
  return reg;
}

// Who sees what (Q4, Q10): role = 'owner' | 'admin' | 'member' | 'viewer'. The Admin group shows for the workspace owner
// and the platform owner; a platform-gated page is ABSENT (not disabled) for a workspace owner.
export function settingsFor(entry, { role, isPlatformOwner = false } = {}) {
  const workspace = entry?.settings?.workspace || [];
  const sees = p => isPlatformOwner || (role === 'owner' && p.gate === 'owner');
  const admin = (entry?.settings?.admin || []).filter(sees);
  return { workspace, admin };
}
export const canAdd = ({ role, isPlatformOwner = false } = {}) => isPlatformOwner || ['owner', 'admin', 'member'].includes(role);
