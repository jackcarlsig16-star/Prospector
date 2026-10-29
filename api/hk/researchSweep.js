// grow-inbox-intel-v1 REV3 M2 - the auto-research sweep: the one approved exception to "no Claude call without a click"
// (Oct 28 10:29 PM). Cron once per Chicago day (cron.js) or "Run research now"; NEVER the page-load runner. Up to N
// researches per Chicago day, (1) the B3 top candidates without intel, by domain else by name, then (2) Needs-you
// senders without intel from the in-process inbox cache. Skips the 30-day cache and the research_attempted_at window;
// stops on the day's count, on any error, and once the day's sweep spend reaches the dollar cap. Every run is an
// hk_job_runs row (job research-sweep); every call logs business_anthropic_usage (call_type hk_research_sweep).
import { getSupabase, HkError, fail, me, TEAM_DOMAINS } from './hkShared.js';
import { dayIn } from './jobs/plan.js';
import { rankReach, intelFor } from './intelScore.js';
import { loadIntel, firstNameOf } from './intelData.js';
import { researchBrand, freshIntel, attemptedRecently, SWEEP_CALL_TYPE } from './brandResearch.js';
import { cachedNeedsYouSenders } from './inboxRoutes.js';
import { callAnthropic } from '../businesses/shared.js';

export const SWEEP_JOB = 'research-sweep';
const deps = d => ({ supabase: d.supabase || getSupabase(), call: d.call || callAnthropic, now: d.now || (() => new Date()), senders: d.senders || cachedNeedsYouSenders });

// The day's sweep so far, from its own run rows: calls made + dollars spent.
export async function sweepToday(supabase, businessId, day) {
  const { data, error } = await supabase.from('hk_job_runs').select('trigger, status, counts, started_at, finished_at').eq('business_id', businessId).eq('job', SWEEP_JOB).eq('chicago_day', day).order('started_at', { ascending: false });
  if (error) throw new Error(error.message);
  const runs = data || [];
  return { runs, calls: runs.reduce((n, r) => n + (r.counts?.calls || 0), 0), spend: Math.round(runs.reduce((n, r) => n + (r.counts?.cost_usd || 0), 0) * 1e6) / 1e6, last: runs[0] || null };
}

// What the sweep would research next, in order (no calls).
export function sweepQueue(data, { meIds, senders = [], now }) {
  const ranked = new Map();
  for (const meId of meIds) for (const r of rankReach(data.brands, { ...data, meId, now }, { meFirstName: firstNameOf(data, meId), limit: null })) if (!ranked.has(r.brand.id) || ranked.get(r.brand.id).score < r.score) ranked.set(r.brand.id, r);
  const brands = [...ranked.values()].sort((a, b) => b.score - a.score)
    .filter(r => !freshIntel(intelFor(r.brand, data.intelByDomain), now) && !attemptedRecently(r.brand, now, data.settings.retry_days))
    .map(r => ({ kind: 'brand', brand: r.brand }));
  const people = senders.filter(s => s.domain && !TEAM_DOMAINS.includes(s.domain) && !freshIntel(data.intelByDomain[s.domain], now) && !data.brands.some(b => b.domain === s.domain))
    .map(s => ({ kind: 'sender', brand: { id: null, name: s.name, domain: s.domain } }));
  return [...brands, ...people];
}

// -> { skipped } | { run, counts }
export async function researchSweep({ businessId, trigger, startedBy = null, d = {} }) {
  if (trigger === 'pageload') throw new HkError(400, 'the research sweep never runs from a page load');
  const D = deps(d), now = D.now();
  const data = await loadIntel(D.supabase, businessId, now);
  const S = data.settings.sweep, day = dayIn(now, data.settingsRow.timezone || 'America/Chicago');
  if (!S.on) return { skipped: 'off' };
  const so = await sweepToday(D.supabase, businessId, day);
  if (trigger === 'cron' && so.runs.some(r => r.trigger === 'cron' && r.status !== 'error')) return { skipped: 'already ran today' };
  if (so.calls >= S.n) return { skipped: 'daily count reached', calls: so.calls, n: S.n };
  if (so.spend >= S.cap_usd) return { skipped: 'dollar cap reached', spend: so.spend, cap_usd: S.cap_usd };
  const meIds = startedBy ? [startedBy] : data.members.map(m => m.user_id).filter(Boolean);
  const queue = sweepQueue(data, { meIds, senders: D.senders(businessId, now.getTime()), now });
  const { data: run, error } = await D.supabase.from('hk_job_runs').insert({ business_id: businessId, job: SWEEP_JOB, trigger, chicago_day: day, started_at: now.toISOString(), status: 'running', started_by: startedBy }).select().single();
  if (error) throw new Error(error.message);
  const counts = { calls: 0, researched: 0, not_found: 0, cached: 0, cost_usd: 0, queued: queue.length, stopped: null };
  let status = 'ok', err = null;
  for (const item of queue) {
    if (so.calls + counts.calls >= S.n) { counts.stopped = 'daily count'; break; }
    if (so.spend + counts.cost_usd >= S.cap_usd) { counts.stopped = 'dollar cap'; break; }
    try {
      const r = await researchBrand({ D, businessId, uid: startedBy, brand: item.brand, callType: SWEEP_CALL_TYPE });
      if (r.status === 'cached') { counts.cached += 1; continue; }
      counts.calls += 1; counts.cost_usd = Math.round((counts.cost_usd + (r.cost_usd || 0)) * 1e6) / 1e6;
      counts[r.status === 'researched' ? 'researched' : 'not_found'] += 1;
    } catch (e) { status = counts.calls ? 'partial' : 'error'; err = String(e.message || e).slice(0, 200); counts.stopped = 'error'; break; }
  }
  const { data: done, error: e2 } = await D.supabase.from('hk_job_runs').update({ finished_at: D.now().toISOString(), status, counts, error: err }).eq('id', run.id).select().single();
  if (e2) throw new Error(e2.message);
  return { run: done, counts };
}

// POST /jobs/research-sweep - "Run research now" (member; hkGate). Trigger 'manual'; the day's count and cap still apply.
export async function runSweepRoute(req, res, d = {}) {
  try { res.json(await researchSweep({ businessId: req.params.businessId, trigger: 'manual', startedBy: me(req), d })); }
  catch (e) { fail(res, e, 'jobs/research-sweep'); }
}
