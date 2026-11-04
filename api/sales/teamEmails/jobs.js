import { WEEKDAYS, EVERY_DAY, laClock } from './scheduler.js';
import { getGrant } from '../../lib/microsoftGrants.js';
import { sendTeamEmail, loadSettings, loadMembers, senderOf } from './send.js';
import { loadVisitorData, buildVisitorEmail, periodFor } from './visitorEmail.js';
import { dueAlerts, sendClientAlert } from './clientAlert.js';

// homelover-team-emails-v1 T3 - HomeLover's jobs. Times are LA wall clock (REVISABLE). apollo-sync is the 06:00 Apollo
// sync moved off node-cron (its next-run drifted by an hour when the process stayed up across a DST change).
export const PULL_TIMEOUT_MS = 5 * 60e3;
const must = r => { if (r.error) throw new Error(r.error.message); return r.data; };
const timeLabel = iso => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const raced = async (work, timeoutMs, error) => {
  let timer;
  const stop = new Promise(resolve => { timer = setTimeout(() => resolve({ status: 504, body: { error } }), timeoutMs); });
  try { return await Promise.race([work, stop]); } finally { clearTimeout(timer); }
};

// The scheduler's visit pull: the page-load pull's code with trigger cron and a hard 5-minute stop. The per-LA-day
// guard is runVisitPull's own (a pull already done today answers ran:false), so two pulls never run in one day.
// Rulings Nov 4 (4): then the visitor people step (the Apollo contacts list - 0 credits, measured 6 runs Oct 28 - Nov 3),
// awaited, because on a cron day the page load finds the pull done; its own once-per-LA-day guard makes a second
// call (07:00, or a page load) a no-op. It runs even when the visit pull failed - the list doesn't depend on it.
export async function cronPull(supabase, businessId, { pull, people = null, now = Date.now(), timeoutMs = PULL_TIMEOUT_MS }) {
  const members = await loadMembers(supabase, businessId);
  const owner = senderOf(await loadSettings(supabase, businessId), members);
  if (!owner) return { ok: false, error: 'no owner' };
  const r = await raced(pull(supabase, { businessId, userId: owner.userId, trigger: 'cron', now, deadline: now + timeoutMs }), timeoutMs, 'Visitor pull timed out after 5 min');
  const b = r.body || {};
  const out = { ok: r.status === 200 && !b.paused, ran: !!b.ran, calls: b.run?.calls ?? b.calls ?? 0, credits: b.credits ?? 0, ...(r.status !== 200 || b.paused ? { error: b.error || b.reason || 'paused' } : {}) };
  if (people) {
    const p = await raced(people(supabase, { businessId, userId: owner.userId, now }), timeoutMs, 'Visitor people pull timed out after 5 min');
    const pb = p.body || {};
    out.people = { ran: !!pb.ran, calls: pb.calls ?? 0, credits: pb.credits ?? 0, added: pb.counts?.people_added ?? 0, ...(p.status !== 200 ? { error: pb.error || `HTTP ${p.status}` } : {}) };
  }
  return out;
}

const lastGoodPull = async (supabase, businessId) =>
  must(await supabase.from('visit_pull_runs').select('updated_at').eq('business_id', businessId).eq('status', 'ok').order('updated_at', { ascending: false }).limit(1))[0]?.updated_at || null;

// The 07:00 email: pull (a no-op when 06:30's ran), scores, build, send. A failed or stuck pull never blocks it.
// pull = null (Send a test) reads what is already stored.
export async function visitorEmailJob(supabase, businessId, { now = Date.now(), pull, people = null, recompute, deps, test = false } = {}) {
  const settings = await loadSettings(supabase, businessId);
  if (!settings) return { status: 'skipped', reason: 'no team email settings' };
  if (!settings.visitor_on && !test) return { status: 'skipped', reason: 'visitor email is off' };
  const p = pull ? await cronPull(supabase, businessId, { pull, people, now }) : { ok: true, ran: false, calls: 0, credits: 0 };
  let pullNote = null;
  if (!p.ok) {
    const last = await lastGoodPull(supabase, businessId);
    pullNote = `Visitor pull failed at ${timeLabel(new Date(now).toISOString())} — numbers are from ${last ? timeLabel(last) : 'no earlier pull'}`;
  } else if (recompute) await recompute(supabase, businessId);
  const date = laClock(now).date, { since, until } = periodFor(date);
  const members = await loadMembers(supabase, businessId);
  const companies = await loadVisitorData(supabase, businessId, { since, until: Math.max(until, now), members });
  const mail = buildVisitorEmail(companies, { date, since, pullNote });
  const sent = await sendTeamEmail(supabase, businessId, { kind: 'visitor', subject: mail.subject, html: mail.html, text: mail.text, slot: date, test }, deps);
  return { ...sent, rows: mail.rows, more: mail.more, pull: p };
}

export async function clientAlertsJob(supabase, businessId, { now = Date.now(), deps } = {}) {
  const settings = await loadSettings(supabase, businessId);
  if (!settings?.client_on) return [];
  const sender = senderOf(settings, await loadMembers(supabase, businessId));
  const grantAt = sender ? (await (deps?.getGrant || getGrant)(sender.userId))?.connected_at ?? null : null;
  const out = [];
  for (const due of await dueAlerts(supabase, businessId, settings, now, grantAt)) {
    const r = await sendClientAlert(supabase, businessId, due, deps, { grantAt });
    if (r) out.push({ id: due.row.id, status: r.status, recipients: r.recipients });
  }
  return out;
}

// The workspaces that get team emails: allowlisted and holding a settings row.
export async function teamScopes(supabase, allowlisted) {
  const ids = allowlisted();
  if (!ids.length) return [];
  return must(await supabase.from('sales_team_email_settings').select('business_id').in('business_id', ids)).map(r => r.business_id);
}

// d = { pull, people, recompute, runApolloSync, deps } - injected so tests run every job with 0 Apollo / 0 Graph calls.
export function hlJobs(d) {
  return [
    { name: 'apollo-sync', at: '06:00', days: EVERY_DAY, scope: 'all', run: () => d.runApolloSync() },
    { name: 'visitor-pull', at: '06:30', days: WEEKDAYS, scope: 'team', run: ({ supabase, scope, now }) => cronPull(supabase, scope, { pull: d.pull, people: d.people, now }) },
    { name: 'team-visitor-email', at: '07:00', days: WEEKDAYS, scope: 'team', run: async ({ supabase, scope, now }) => {
      const r = await visitorEmailJob(supabase, scope, { now, pull: d.pull, people: d.people, recompute: d.recompute, deps: d.deps });
      return { status: r.status, recipients: r.recipients ?? 0, rows: r.rows ?? 0, pull_calls: r.pull?.calls ?? 0, pull_credits: r.pull?.credits ?? 0, people_credits: r.pull?.people?.credits ?? 0 };
    } },
    { name: 'client-alerts', scope: 'team', run: ({ supabase, scope, now }) => clientAlertsJob(supabase, scope, { now, deps: d.deps }) },
  ];
}

const DAYS_LABEL = days => (days.length === 7 ? 'daily' : days.join() === '1,2,3,4,5' ? 'Mon-Fri' : days.join(','));
// The one startup line Render's log shows: "HomeLover scheduler on: apollo-sync 06:00 daily, ... (America/Los_Angeles)".
export const schedulerLine = jobs => `${jobs.map(j => (j.at ? `${j.name} ${j.at} ${DAYS_LABEL(j.days)}` : `${j.name} each minute`)).join(', ')} (America/Los_Angeles)`;
