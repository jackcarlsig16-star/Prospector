import { selectAllPages } from '../lib/selectAllPages.js';
import { bulkStageRefusal } from './pipelineStages.js';

// pipeline-add-dedupe-v1 - every path that creates an opportunity reuses a
// live one first. The unique index is on lower(organization), so "[solidcore]"
// and "Solidcore" both got in; this key is what the paths compare instead.
const SUFFIXES = new Set(['inc', 'llc', 'corp', 'co']);
export function orgKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w && !SUFFIXES.has(w)).join(' ');
}

export function matchOpportunity(opps, { name, apolloAccountId = null }) {
  if (apolloAccountId) {
    const byApollo = opps.find(o => o.apollo_account_id === apolloAccountId);
    if (byApollo) return byApollo;
  }
  const key = orgKey(name);
  return (key && opps.find(o => orgKey(o.organization) === key)) || null;
}

export async function findOpportunity(supabase, businessId, { name, apolloAccountId = null }) {
  const opps = await selectAllPages(() => supabase.from('sales_opportunities').select('*')
    .eq('business_id', businessId).is('archived_at', null).order('id'));
  return matchOpportunity(opps, { name, apolloAccountId });
}

// Forward only (never-backwards + no parking a live deal); the stage trigger
// logs the move like any other.
export async function moveForward(supabase, opp, stage) {
  if (!stage || stage === opp.stage || bulkStageRefusal(opp.stage, stage)) return opp;
  const { data, error } = await supabase.from('sales_opportunities')
    .update({ stage, updated_at: new Date().toISOString() }).eq('id', opp.id).select().single();
  if (error) throw new Error(error.message);
  return data;
}
