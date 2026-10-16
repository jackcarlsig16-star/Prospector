import { hasRole } from '../lib/requireAuth.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { getSupabase } from './goalsShared.js';
import { nameMatches, normName } from './intakeMatch.js';
import { normalizeDomain } from '../../src/constants/partnerDomains.js';

// partner-add-research-v1 REV3 Stage 1 (D1) - "is this company already in
// Prospector?" before a partner (or, from pipeline-wide-table Stage 3, any
// company) is added. Same matcher as Intake (intakeMatch normName /
// nameMatches), with every row it can hide behind: archived partners,
// archived opportunities, Apollo-only accounts (sales_sequenced_accounts)
// and targets whatever their status, plus a confirmed partner domain.
// 0 Claude, 0 Apollo, reads only. Member+ even though it's a GET: the Add
// form is Member-only and the answer lists records a Viewer may not open.

const SOURCES = [['partner', 'partners', 'name'], ['opportunity', 'opportunities', 'organization'], ['account', 'companies', 'name'], ['target', 'targets', 'name']];
export const MAX_PARTIAL = 5;
export const MAX_NAME = 160;

export async function loadDupeContext(supabase, businessId) {
  const page = build => selectAllPages(() => build(supabase).eq('business_id', businessId));
  const [partners, opportunities, companies, targets, domains] = await Promise.all([
    page(s => s.from('sales_goals').select('id, name, archived_at, pipeline_status').eq('goal_type', 'partnership').order('id')),
    page(s => s.from('sales_opportunities').select('id, organization, archived_at').order('id')),
    page(s => s.from('sales_sequenced_accounts').select('account_id, name').order('account_id')),
    page(s => s.from('sales_targets').select('id, name, status').order('id')),
    page(s => s.from('partner_domains').select('goal_id, domain').eq('confirmed', true).order('goal_id').order('domain')),
  ]);
  return { partners, opportunities, companies: companies.filter(c => c.name), targets, domains };
}

const publicRow = (type, row, key, via) => ({
  type, id: type === 'account' ? row.account_id : row.id, name: row[key], archived: !!row.archived_at, via,
  ...(type === 'partner' ? { pipeline_status: row.pipeline_status || 'not_started' } : {}),
  ...(type === 'target' ? { status: row.status } : {}),
});

// { exact: [{ type, id, name, archived, via: 'name' | 'domain', pipeline_status? | status? }], partial: [...] }
// exact = same normalized name in any source, or the domain is a confirmed
// partner domain; partial = whole-word overlap, first MAX_PARTIAL, never
// repeating an exact hit.
export function findDupes({ name, domain }, ctx) {
  const exact = [], partial = [];
  const seen = new Set();
  const push = (list, type, row, key, via) => {
    const r = publicRow(type, row, key, via);
    const k = `${type}:${r.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    list.push(r);
  };
  for (const [type, list, key] of SOURCES) for (const row of nameMatches(name, ctx[list], key, false)) push(exact, type, row, key, 'name');
  const d = normalizeDomain(domain);
  if (d) {
    for (const dm of ctx.domains.filter(x => x.domain === d)) {
      const p = ctx.partners.find(x => x.id === dm.goal_id);
      if (p) push(exact, 'partner', p, 'name', 'domain');
    }
  }
  for (const [type, list, key] of SOURCES) for (const row of nameMatches(name, ctx[list], key, true)) {
    if (partial.length >= MAX_PARTIAL) break;
    push(partial, type, row, key, 'name');
  }
  return { exact, partial };
}

// GET /goals/partners/dupe-check?name=&domain=
export async function dupeCheckRoute(req, res, supabase = getSupabase()) {
  const businessId = req.params.businessId;
  if (!hasRole(req, businessId, 'member')) return res.status(403).json({ error: 'You need member access to this workspace' });
  const name = typeof req.query.name === 'string' ? req.query.name.trim().slice(0, MAX_NAME) : '';
  const domain = normalizeDomain(req.query.domain);
  if (normName(name).length < 2 && !domain) return res.status(400).json({ error: 'name (2+ characters) or domain is required' });
  try {
    res.json(findDupes({ name, domain }, await loadDupeContext(supabase, businessId)));
  } catch (e) { res.status(500).json({ error: e.message }); }
}
