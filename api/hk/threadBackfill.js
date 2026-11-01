// grow-mailbox-link-v1 L2 - the one-time backfill of ONE member's own mailbox, with that member's own grant: Gmail search
// over the last BACKFILL_DAYS for threads with a brand's domain (saved, or high-confidence suggested) or a contact address
// on From / To, chunked like the Brands lane (<= 1,200 chars), then threads.get metadata (From / To / Cc / Date only) per
// new thread -> one hk_brand_threads row with the derived facts. Name-only matches are never searched here (ruling 1).
// Caps per member (REVISABLE): BACKFILL_UNITS_MAX units across all its runs, BACKFILL_THREADS_MAX threads, UNITS_PER_MIN
// (sleeps to the next minute). Resumable: each run row (job thread-backfill, counts.member) keeps the cursor; a quota
// error leaves the run 'partial' and the next run carries on; finishing every chunk (or a cap) sets counts.done and the
// member is never backfilled again. Never on a page load.
import { GmailError, GMAIL_UNITS } from './gmailClient.js';
import { deps0 } from './gmailRoutes.js';
import { TEAM_DOMAINS } from './hkShared.js';
import { dayIn } from './jobs/plan.js';
import { BACKFILL_DAYS, matcherFor, messagesOf, threadFacts } from './threadLinks.js';
import { scrubAddresses } from '../sales/scrubText.js';

export const BACKFILL_JOB = 'thread-backfill';
export const BACKFILL_UNITS_MAX = 25000, BACKFILL_THREADS_MAX = 400, UNITS_PER_MIN = 3000; // REVISABLE (Jack, Oct 31)
export const QUERY_MAX = 1200, LIST_PAGE = 100;
const RUNNING_STALE_MS = 30 * 60e3;
const deps = d => ({ ...deps0(d), sleep: d.sleep || (ms => new Promise(r => setTimeout(r, ms))) });
class Stop extends Error {}

// "{from:(a OR b) to:(a OR b)}" chunks, each <= max characters with the date prefix.
export function backfillQueries(keys, { days = BACKFILL_DAYS, max = QUERY_MAX } = {}) {
  const q = ks => `newer_than:${days}d {from:(${ks.join(' OR ')}) to:(${ks.join(' OR ')})}`;
  const out = []; let cur = [];
  for (const k of [...new Set(keys)].sort()) { if (cur.length && q([...cur, k]).length > max) { out.push(q(cur)); cur = []; } cur.push(k); }
  if (cur.length) out.push(q(cur));
  return out;
}

export async function memberBackfill(supabase, businessId, memberId) {
  const { data, error } = await supabase.from('hk_job_runs').select('id, status, counts, started_at').eq('business_id', businessId).eq('job', BACKFILL_JOB).order('started_at', { ascending: true });
  if (error) throw new Error(error.message);
  const runs = (data || []).filter(r => r.counts?.member === memberId);
  const last = runs[runs.length - 1] || null;
  return { runs, done: runs.some(r => r.counts?.done), units: runs.reduce((n, r) => n + (r.counts?.units || 0), 0), linked: runs.reduce((n, r) => n + (r.counts?.linked || 0), 0), cursor: last?.counts?.cursor || null, last };
}

// -> { skipped } | { run, counts }
export async function backfillMailbox({ businessId, memberId, trigger = 'manual', startedBy = null, d = {} }) {
  const D = deps(d), now = D.now();
  const prior = await memberBackfill(D.supabase, businessId, memberId);
  if (prior.done) return { skipped: 'done' };
  if (prior.last?.status === 'running' && now.getTime() - Date.parse(prior.last.started_at) < RUNNING_STALE_MS) return { skipped: 'running' };
  const m = await D.mailbox(businessId, memberId, 'inbox').catch(() => null) || await D.mailbox(businessId, memberId, 'drafts').catch(() => null);
  if (!m) return { skipped: 'no_mailbox' };
  let token;
  try { token = await D.tokenForGrant(m.grant, 'gmail'); } catch { return { skipped: 'needs_reconnect' }; }
  const { data: settings } = await D.supabase.from('hk_settings').select('timezone').eq('business_id', businessId).maybeSingle();
  const { data: run, error } = await D.supabase.from('hk_job_runs').insert({ business_id: businessId, job: BACKFILL_JOB, trigger, chicago_day: dayIn(now, settings?.timezone || 'America/Chicago'), started_at: now.toISOString(), status: 'running', started_by: startedBy, counts: { member: memberId } }).select().single();
  if (error) throw new Error(error.message);

  const ownEmails = [m.grant.google_email].filter(Boolean).map(e => e.toLowerCase());
  const ownDomains = ownEmails.map(e => e.split('@')[1]);
  const matcher = await matcherFor(D.supabase, businessId, ownDomains);
  const queries = [...backfillQueries([...matcher.queries.domains, ...matcher.queries.suggested]), ...backfillQueries(matcher.queries.addresses)];
  const { data: have, error: e0 } = await D.supabase.from('hk_brand_threads').select('gmail_thread_id').eq('business_id', businessId).eq('member_user_id', memberId);
  if (e0) throw new Error(e0.message);
  const seen = new Set((have || []).map(r => r.gmail_thread_id));
  const counts = { member: memberId, units: 0, listed: 0, fetched: 0, linked: 0, unmatched: 0, queries: queries.length, cursor: prior.cursor || { chunk: 0, page: null }, done: false, stopped: null };
  let minuteStart = D.now().getTime(), minuteUnits = 0, status = 'ok', err = null;
  const charge = async n => {
    if (prior.units + counts.units + n > BACKFILL_UNITS_MAX) throw new Stop('unit cap');
    if (D.now().getTime() - minuteStart >= 60e3) { minuteStart = D.now().getTime(); minuteUnits = 0; }
    if (minuteUnits + n > UNITS_PER_MIN) { await D.sleep(60e3 - (D.now().getTime() - minuteStart)); minuteStart = D.now().getTime(); minuteUnits = 0; }
    minuteUnits += n; counts.units += n;
  };
  const save = async () => { const { error: e } = await D.supabase.from('hk_job_runs').update({ counts }).eq('id', run.id); if (e) throw new Error(e.message); };
  try {
    for (let i = counts.cursor.chunk; i < queries.length; i++) {
      let pageToken = i === counts.cursor.chunk ? counts.cursor.page : null;
      do {
        await charge(GMAIL_UNITS['threads.list']);
        const list = await D.gmail.listThreads(token, { q: queries[i], pageToken, maxResults: LIST_PAGE });
        for (const t of list?.threads || []) {
          counts.listed++;
          if (seen.has(t.id)) continue;
          if (prior.linked + counts.linked >= BACKFILL_THREADS_MAX) throw new Stop('thread cap');
          await charge(GMAIL_UNITS['threads.get']);
          const th = await D.gmail.getThreadPeople(token, t.id).catch(e => { if (e instanceof GmailError && e.status === 404) return null; throw e; });
          seen.add(t.id);
          if (!th) continue;
          counts.fetched++;
          const msgs = messagesOf(th);
          const hit = matcher.match(msgs.flatMap(x => x.people));
          if (!hit || hit.matched_by === 'name') { counts.unmatched++; continue; }
          const row = { business_id: businessId, brand_id: hit.brand_id, member_user_id: memberId, gmail_thread_id: t.id, matched_by: hit.matched_by, link_state: 'linked', ...threadFacts(msgs, { ownEmails, ownDomains: [...ownDomains, ...TEAM_DOMAINS] }), updated_at: D.now().toISOString() };
          const { error: e } = await D.supabase.from('hk_brand_threads').upsert(row, { onConflict: 'business_id,member_user_id,gmail_thread_id' });
          if (e) throw new Error(e.message);
          counts.linked++;
        }
        pageToken = list?.nextPageToken || null;
        counts.cursor = pageToken ? { chunk: i, page: pageToken } : { chunk: i + 1, page: null };
        await save();
      } while (pageToken);
    }
    counts.done = true;
  } catch (e) {
    if (e instanceof Stop) { counts.stopped = e.message; counts.done = true; }
    else if (e instanceof GmailError && (e.status === 429 || e.status === 403)) { status = 'partial'; counts.stopped = 'gmail busy'; err = scrubAddresses(String(e.message)).slice(0, 200); }
    else { status = counts.linked ? 'partial' : 'error'; counts.stopped = 'error'; err = scrubAddresses(String(e.message || e)).slice(0, 200); }
  }
  const { data: done, error: e2 } = await D.supabase.from('hk_job_runs').update({ finished_at: D.now().toISOString(), status, counts, error: err }).eq('id', run.id).select().single();
  if (e2) throw new Error(e2.message);
  return { run: done, counts };
}
