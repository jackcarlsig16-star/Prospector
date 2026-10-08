import { selectAllPages } from '../lib/selectAllPages.js';
import { getSupabase } from './goalsShared.js';
import { normalizeDomain, suggestionsFor, apolloAccountFor, exportCandidates, buildApolloCsv, pendingSuggestions } from '../../src/constants/partnerDomains.js';

// partner-360-v1 Stage 2 - partner domains. Mounted under
// /api/sales/:businessId (salesGate: GET = Viewer, writes = Member). Apollo
// is only ever read here, and only from the latest accounts snapshot
// already in the DB (0 Apollo calls). Nothing here touches contact data.

const PARTNER_COLS = 'id, name, sources, category, tier, owner_user_id';

async function partnerOr404(supabase, businessId, goalId, res) {
  const { data, error } = await supabase.from('sales_goals').select(PARTNER_COLS)
    .eq('business_id', businessId).eq('id', goalId).eq('goal_type', 'partnership').maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return null; }
  if (!data) { res.status(404).json({ error: 'partner not found' }); return null; }
  return data;
}

async function latestAccounts(supabase, businessId) {
  const { data, error } = await supabase.from('sales_raw_snapshots').select('payload, captured_at')
    .eq('business_id', businessId).eq('entity', 'accounts').order('captured_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return { accounts: Array.isArray(data?.payload) ? data.payload : [], captured_at: data?.captured_at || null };
}

const rowsFor = (supabase, businessId, goalId) => supabase.from('partner_domains').select('*')
  .eq('business_id', businessId).eq('goal_id', goalId).order('is_primary', { ascending: false }).order('domain');

async function respondDomains(supabase, partner, businessId, res, status = 200) {
  const [{ data: rows, error }, { accounts, captured_at }] = await Promise.all([rowsFor(supabase, businessId, partner.id), latestAccounts(supabase, businessId)]);
  if (error) return res.status(500).json({ error: error.message });
  res.status(status).json({ domains: rows, suggestions: suggestionsFor(partner, rows, accounts), apollo_account: apolloAccountFor(partner, rows, accounts), snapshot_at: captured_at });
}

// GET /goals/partners/:id/domains -> { domains, suggestions, apollo_account, snapshot_at }
export async function listDomainsRoute(req, res) {
  const supabase = getSupabase();
  const partner = await partnerOr404(supabase, req.params.businessId, req.params.id, res);
  if (!partner) return;
  try { await respondDomains(supabase, partner, req.params.businessId, res); } catch (e) { res.status(500).json({ error: e.message }); }
}

// POST /goals/partners/:id/domains  body { domain, dismiss? } - confirms a
// suggestion or adds a domain by hand (confirmed); dismiss = true stores a
// confirmed=false row so the suggestion stops being offered. The first
// confirmed domain becomes primary. Re-posting an existing domain flips
// its confirmed flag instead of failing.
export async function addDomainRoute(req, res) {
  const supabase = getSupabase();
  const businessId = req.params.businessId;
  const partner = await partnerOr404(supabase, businessId, req.params.id, res);
  if (!partner) return;
  const domain = normalizeDomain(req.body?.domain);
  if (!domain) return res.status(400).json({ error: 'domain must look like company.com' });
  const confirmed = req.body?.dismiss !== true;
  try {
    const [{ data: rows, error }, { accounts }] = await Promise.all([rowsFor(supabase, businessId, partner.id), latestAccounts(supabase, businessId)]);
    if (error) throw new Error(error.message);
    const existing = rows.find(r => r.domain === domain);
    const suggestion = suggestionsFor(partner, existing ? rows.filter(r => r.id !== existing.id) : rows, accounts).find(s => s.domain === domain);
    if (!confirmed && !existing && !suggestion) return res.status(400).json({ error: 'only a suggested domain can be dismissed' });
    const makePrimary = confirmed && !rows.some(r => r.confirmed && r.is_primary && r.id !== existing?.id);
    const patch = { confirmed, is_primary: confirmed ? (existing?.is_primary || makePrimary) : false, updated_at: new Date().toISOString() };
    const q = existing
      ? supabase.from('partner_domains').update(patch).eq('id', existing.id)
      : supabase.from('partner_domains').insert({ business_id: businessId, goal_id: partner.id, domain, source: suggestion ? suggestion.source : 'manual', created_by: req.auth.user.id, ...patch });
    const { error: wErr } = await q;
    if (wErr) throw new Error(wErr.message);
    await respondDomains(supabase, partner, businessId, res, existing ? 200 : 201);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// PATCH /goals/partners/:id/domains/:domainId  body { domain?, is_primary?, confirmed? }
export async function updateDomainRoute(req, res) {
  const supabase = getSupabase();
  const businessId = req.params.businessId;
  const partner = await partnerOr404(supabase, businessId, req.params.id, res);
  if (!partner) return;
  const b = req.body || {};
  const patch = { updated_at: new Date().toISOString() };
  if ('domain' in b) { patch.domain = normalizeDomain(b.domain); if (!patch.domain) return res.status(400).json({ error: 'domain must look like company.com' }); }
  if ('is_primary' in b) { if (typeof b.is_primary !== 'boolean') return res.status(400).json({ error: 'is_primary must be true or false' }); patch.is_primary = b.is_primary; }
  if ('confirmed' in b) { if (typeof b.confirmed !== 'boolean') return res.status(400).json({ error: 'confirmed must be true or false' }); patch.confirmed = b.confirmed; }
  if (Object.keys(patch).length === 1) return res.status(400).json({ error: 'nothing to change' });
  try {
    const { data: rows, error } = await rowsFor(supabase, businessId, partner.id);
    if (error) throw new Error(error.message);
    const row = rows.find(r => r.id === req.params.domainId);
    if (!row) return res.status(404).json({ error: 'domain not found' });
    if (patch.domain && rows.some(r => r.id !== row.id && r.domain === patch.domain)) return res.status(409).json({ error: 'this partner already has that domain' });
    const confirmed = patch.confirmed ?? row.confirmed;
    if (patch.is_primary && !confirmed) return res.status(400).json({ error: 'only a confirmed domain can be primary' });
    if (patch.confirmed === false) patch.is_primary = false;
    if (patch.is_primary) {
      const { error: clrErr } = await supabase.from('partner_domains').update({ is_primary: false }).eq('goal_id', partner.id).eq('is_primary', true).neq('id', row.id);
      if (clrErr) throw new Error(clrErr.message);
    }
    const { error: wErr } = await supabase.from('partner_domains').update(patch).eq('id', row.id);
    if (wErr) throw new Error(wErr.message);
    await respondDomains(supabase, partner, businessId, res);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// DELETE /goals/partners/:id/domains/:domainId
export async function deleteDomainRoute(req, res) {
  const supabase = getSupabase();
  const businessId = req.params.businessId;
  const partner = await partnerOr404(supabase, businessId, req.params.id, res);
  if (!partner) return;
  const { data: row, error: findErr } = await supabase.from('partner_domains').select('id').eq('business_id', businessId).eq('goal_id', partner.id).eq('id', req.params.domainId).maybeSingle();
  if (findErr) return res.status(500).json({ error: findErr.message });
  if (!row) return res.status(404).json({ error: 'domain not found' });
  const { error } = await supabase.from('partner_domains').delete().eq('id', row.id);
  if (error) return res.status(500).json({ error: error.message });
  try { await respondDomains(supabase, partner, businessId, res); } catch (e) { res.status(500).json({ error: e.message }); }
}

async function workspaceExport(supabase, businessId) {
  const [goals, rows, members, { accounts, captured_at }] = await Promise.all([
    selectAllPages(() => supabase.from('sales_goals').select(PARTNER_COLS).eq('business_id', businessId).eq('goal_type', 'partnership').is('archived_at', null).order('id')),
    selectAllPages(() => supabase.from('partner_domains').select('*').eq('business_id', businessId).order('id')),
    supabase.from('business_members').select('user_id, name').eq('business_id', businessId).then(r => { if (r.error) throw new Error(r.error.message); return r.data; }),
    latestAccounts(supabase, businessId),
  ]);
  const byGoal = {};
  for (const r of rows) (byGoal[r.goal_id] ||= []).push(r);
  const nameOf = Object.fromEntries(members.map(m => [m.user_id, m.name]));
  const candidates = exportCandidates(goals, byGoal, accounts, id => nameOf[id]);
  return { goals, rows, byGoal, accounts, candidates, captured_at };
}

// GET /goals/partners/domains -> every partner's rows + the export preview
// (what "Export to Apollo (CSV)" will contain) + how many partners have a
// confirmed domain + every pending suggestion (what "Review domains" lists).
export async function listAllDomainsRoute(req, res) {
  try {
    const { goals, rows, byGoal, accounts, candidates, captured_at } = await workspaceExport(getSupabase(), req.params.businessId);
    const in_apollo = goals.filter(g => apolloAccountFor(g, byGoal[g.id] || [], accounts)).length;
    const confirmed = goals.filter(g => (byGoal[g.id] || []).some(r => r.confirmed)).length;
    const suggestions = pendingSuggestions(goals, byGoal, accounts);
    res.json({ domains: rows, candidates: candidates.map(c => ({ name: c.name, domain: c.domain })), suggestions, counts: { partners: goals.length, confirmed, in_apollo, pending: new Set(suggestions.map(s => s.goal_id)).size }, snapshot_at: captured_at });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// GET /goals/partners/export-apollo.csv - Company Name, Website, Category,
// Tier, Owner for every partner with a confirmed domain that isn't an
// Apollo account yet. No contact data, ever. Jack imports it in Apollo.
export async function exportApolloCsvRoute(req, res) {
  try {
    const { candidates } = await workspaceExport(getSupabase(), req.params.businessId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="partners-for-apollo-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(buildApolloCsv(candidates));
  } catch (e) { res.status(500).json({ error: e.message }); }
}
