import { createClient } from '@supabase/supabase-js';
import { runSync } from './sync.js';
import { isAllowlistedBusiness } from './allowlist.js';

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Every route checks this first and 403s - the real access gate for this
// feature (no real auth exists - A1b).
function checkAllowlist(req, res) {
  if (!isAllowlistedBusiness(req.params.businessId)) {
    res.status(403).json({ error: 'business is not allowlisted for sales analytics' });
    return false;
  }
  return true;
}

export async function syncRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  try {
    const result = await runSync({ businessId: req.params.businessId, trigger: 'manual' });
    if (result.refused) return res.status(429).json({ error: result.reason });
    if (result.error) return res.status(500).json({ error: result.error });
    res.status(200).json({ run: result.run });
  } catch (err) {
    console.error('[sales/sync]', err.message);
    res.status(500).json({ error: err.message });
  }
}

export async function runsRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('sales_sync_runs')
    .select('*')
    .eq('business_id', req.params.businessId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ runs: data });
}

export async function metricsRoute(req, res) {
  if (!checkAllowlist(req, res)) return;
  const { from, to } = req.query;
  const supabase = getSupabase();
  let query = supabase.from('sales_metrics_daily').select('*').eq('business_id', req.params.businessId);
  if (from) query = query.gte('metric_date', from);
  if (to) query = query.lte('metric_date', to);
  const { data, error } = await query.order('metric_date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ metrics: data });
}
