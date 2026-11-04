import { SOURCE_LABEL } from '../../src/constants/leadSources.js';
import { CLIENT_STATUS_LABEL } from '../../src/constants/clients.js';
import { TEAM_LABEL } from '../../src/constants/ownership.js';

// homelover-clients-v1 C8-C10 - "what did this partner bring in", pure over rows sourceRoutes loads (publicRow + type,
// source_kind, source_partner_id). Nothing is stored; every count is computed per request.

export const GROUP_LIMIT = 25;
export const MAX_DEPTH = 4;
const GROUPS = [['clients', 'Clients'], ['employers', 'Employers in pipeline'], ['partners', 'Partners'], ['targets', 'Targets']];
const livesOf = r => r.eligible_now ?? r.covered_lives ?? 0;
const isClient = r => r.type === 'employer' && !!r.client_status;
const inPipeline = r => r.type === 'employer' && !r.client_status && r.stage !== 'lost';
const groupOf = r => (isClient(r) ? 'clients' : inPipeline(r) ? 'employers' : r.type === 'partner' ? 'partners' : r.type === 'target' ? 'targets' : null);
const label = r => (isClient(r) ? CLIENT_STATUS_LABEL[r.client_status] : r.stage_label || null);

// The partner panel's Network card. rows = the companies whose source partner is this partner.
export function networkOf(rows, { partner, partnerName = null, owner = null, limit = GROUP_LIMIT }) {
  const by = Object.fromEntries(GROUPS.map(([k]) => [k, []]));
  for (const r of rows) { const g = groupOf(r); if (g) by[g].push(r); }
  const clients = by.clients;
  return {
    header: { clients: clients.length, lives: clients.reduce((n, r) => n + livesOf(r), 0), in_pipeline: by.employers.length, partners: by.partners.length, targets: by.targets.length },
    groups: GROUPS.map(([key, title]) => {
      const list = by[key].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return { key, label: title, total: list.length, more: Math.max(0, list.length - limit), rows: list.slice(0, limit).map(r => ({ type: r.type, id: r.id, name: r.name, status_label: label(r), client_status: r.client_status || null, lives: isClient(r) ? livesOf(r) : null, owner: r.owner || null })) };
    }),
    came_from: {
      kind: partner.source_kind || null, label: partner.source_kind ? SOURCE_LABEL[partner.source_kind] : null,
      partner_id: partner.source_partner_id || null, partner_name: partnerName, person: partner.source_person || null,
      partner_not_set: partner.source_kind === 'partner_referral' && !partner.source_partner_id,
    },
    ownership: { owner, team: partner.owner_team ? TEAM_LABEL[partner.owner_team] || null : null, co_owner_name: partner.co_owner_name || null },
  };
}

// Sources › Network: an indented tree from each top-level referrer (a partner that brought something in and whose own
// source names no live partner) down through what it brought in. Each company appears once - a repeat is a "↻ see above"
// leaf; at most MAX_DEPTH levels and `limit` children per node (then "and n more"). A partner node's rollup counts its
// whole sub-network (each company once), however deep, so cutting the display never changes the numbers.
export function networkTree(rows, { limit = GROUP_LIMIT, maxDepth = MAX_DEPTH } = {}) {
  const byId = new Map(rows.map(r => [`${r.type}:${r.id}`, r]));
  const partners = new Map(rows.filter(r => r.type === 'partner').map(r => [r.id, r]));
  const kids = new Map();
  for (const r of rows) {
    if (!r.source_partner_id || !partners.has(r.source_partner_id) || (r.type === 'partner' && r.source_partner_id === r.id)) continue;
    if (!kids.has(r.source_partner_id)) kids.set(r.source_partner_id, []);
    kids.get(r.source_partner_id).push(r);
  }
  for (const list of kids.values()) list.sort((a, b) => (groupOf(a) === groupOf(b) ? String(a.name).localeCompare(String(b.name)) : GROUPS.findIndex(([k]) => k === groupOf(a)) - GROUPS.findIndex(([k]) => k === groupOf(b))));
  const rollup = id => {
    const seen = new Set([`partner:${id}`]), stack = [...(kids.get(id) || [])], out = { clients: 0, lives: 0, in_pipeline: 0 };
    while (stack.length) {
      const r = stack.pop(), key = `${r.type}:${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (isClient(r)) { out.clients++; out.lives += livesOf(r); } else if (inPipeline(r)) out.in_pipeline++;
      if (r.type === 'partner') stack.push(...(kids.get(r.id) || []));
    }
    return out;
  };
  const shown = new Set();
  const node = (r, depth) => {
    const key = `${r.type}:${r.id}`;
    const base = { type: r.type, id: r.id, name: r.name, status_label: label(r), client_status: r.client_status || null, lives: isClient(r) ? livesOf(r) : null, depth };
    if (shown.has(key)) return { ...base, repeat: true };
    shown.add(key);
    if (r.type !== 'partner') return base;
    const list = kids.get(r.id) || [];
    const out = { ...base, rollup: rollup(r.id), partner_not_set: r.source_kind === 'partner_referral' && !r.source_partner_id, total: list.length };
    if (depth >= maxDepth) return { ...out, children: [], more: list.length };
    return { ...out, children: list.slice(0, limit).map(c => node(c, depth + 1)), more: Math.max(0, list.length - limit) };
  };
  const isRoot = p => kids.has(p.id) && (!p.source_partner_id || !partners.has(p.source_partner_id) || p.source_partner_id === p.id);
  const roots = [...partners.values()].filter(isRoot).sort((a, b) => rollup(b.id).clients - rollup(a.id).clients || (kids.get(b.id).length - kids.get(a.id).length) || String(a.name).localeCompare(String(b.name))).map(p => node(p, 1));
  // A ring of partners that only refer each other has no top: start it at its first partner by name. Reachable = under a
  // root at any depth (a partner the depth cut hides is still under its root, not a new top).
  const reachable = new Set();
  const reach = id => { const stack = [id]; while (stack.length) { const p = stack.pop(); if (reachable.has(p)) continue; reachable.add(p); for (const c of kids.get(p) || []) if (c.type === 'partner') stack.push(c.id); } };
  roots.forEach(r => reach(r.id));
  for (const p of [...partners.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)))) if (kids.has(p.id) && !reachable.has(p.id)) { reach(p.id); roots.push(node(p, 1)); }
  return { roots, partners_with_none: [...partners.values()].filter(p => !kids.has(p.id)).length };
}

// C10 - clients + eligible lives per partner: direct (its own source partner) and via one level up (the referring
// partner's own source partner). partnerParent: Map(partner id -> its source partner id | null).
export function clientAttribution(clients, partnerParent) {
  const out = new Map();
  const add = (pid, k, lives) => {
    if (!pid) return;
    if (!out.has(pid)) out.set(pid, { clients_direct: 0, lives_direct: 0, clients_via: 0, lives_via: 0 });
    const a = out.get(pid);
    a[`clients_${k}`]++; a[`lives_${k}`] += lives;
  };
  for (const c of clients) {
    if (c.source_kind !== 'partner_referral' || !c.source_partner_id) continue;
    const lives = c.eligible_now ?? c.covered_lives ?? 0;
    add(c.source_partner_id, 'direct', lives);
    const up = partnerParent.get(c.source_partner_id);
    if (up && up !== c.source_partner_id) add(up, 'via', lives);
  }
  return out;
}
