// hkos-daily-check-v1 J1 / J2 - the thin runners behind both schedulers (cron.js) and the routes (jobsRoutes.js):
// gmail-sync-all (every tethered founder's mailbox, their own grant server-side), daily-check (the planner's due
// follow-ups drafted on each OWNER's grant through the same builder the composer uses, DM texts, the digest, Slack when
// configured) and the page-load fallback. Every run writes hk_job_runs; the partial unique index on that table is the
// once-per-day guard (a second daily-check the same Chicago day fails its insert and reads "already ran today").
// NO SEND PATH: the only Gmail writes are the shared builder's draft create. Nothing here returns an address.
import { deps0, createDraftFor, runMailboxSync, pageloadSkip } from '../gmailRoutes.js';
import { HkError, liveBrands, selectAllPages, logEvent } from '../hkShared.js';
import { SETTINGS_DEFAULTS, dataWarnings } from '../opsRoutes.js';
import { RECONNECT, NeedsGoogle } from '../../lib/googleGrants.js';
import { GmailError } from '../gmailClient.js';
import { dueFollowups, dueDms, planCounts, dayIn, isPastDigestTime, isDigestDay, ranToday, statsStale } from './plan.js';
import { bumpText, finalText, dmText, followupSubject } from '../followupText.js';
import { buildDigest, renderSlack } from './digest.js';
import { scrubAddresses } from '../../sales/scrubText.js';

export const DRAFTS_PER_RUN = 25; // REVISABLE
export const SLACK_ENV = 'HK_SLACK_WEBHOOK_URL';
export const slackConfigured = () => !!process.env[SLACK_ENV];
export const jobDeps = (d = {}) => ({ ...deps0(d), fetch: d.fetch || ((...a) => fetch(...a)), slackUrl: 'slackUrl' in d ? d.slackUrl : process.env[SLACK_ENV] || null });
const RUN_FIELDS = ['id', 'job', 'trigger', 'chicago_day', 'started_at', 'finished_at', 'status', 'counts', 'error', 'started_by'];
export const runRow = r => (r ? Object.fromEntries(RUN_FIELDS.map(k => [k, r[k] ?? null])) : null);
const firstWord = s => (s && !String(s).includes('@') ? String(s).trim().split(/\s+/)[0] || null : null);
const must = r => { if (r.error) throw new Error(r.error.message); return r.data || []; };

async function settingsOf(supabase, businessId) { const { data } = await supabase.from('hk_settings').select('*').eq('business_id', businessId).maybeSingle(); return { ...SETTINGS_DEFAULTS, ...(data || {}) }; }
// Members with a profile, each with the mailbox the workspace tethers for them (or null). Never the default account.
async function founders(D, businessId) {
  const rows = must(await D.supabase.from('business_members').select('user_id,name,role,profile:profiles!business_members_user_id_fkey(display_name)').eq('business_id', businessId));
  const out = [];
  for (const r of rows) { if (!r.user_id) continue; const m = await D.mailbox(businessId, r.user_id, 'drafts').catch(() => null); out.push({ user_id: r.user_id, first_name: firstWord(r.profile?.display_name) || firstWord(r.name) || 'Founder', m }); }
  return out;
}
const members = fs => fs.map(f => ({ user_id: f.user_id, first_name: f.first_name }));
async function workspaceRows(D, businessId) {
  const { supabase } = D;
  const all = t => selectAllPages(() => supabase.from(t).select('*').eq('business_id', businessId).order('created_at').order('id'));
  const [brands, touches, replies, contacts] = await Promise.all([liveBrands(supabase, businessId), all('hk_touches'), all('hk_replies'), all('hk_contacts')]);
  return { brands, touches, replies, contacts };
}
async function recentEvents(D, businessId, now) { const since = new Date(now.getTime() - 3 * 86400e3).toISOString(); return must(await D.supabase.from('hk_events').select('action, detail, created_at').eq('business_id', businessId).gte('created_at', since)); }
async function startRun(D, { businessId, job, trigger, day, startedBy = null }) {
  const { data, error } = await D.supabase.from('hk_job_runs').insert({ business_id: businessId, job, trigger, chicago_day: day, started_at: D.now().toISOString(), status: 'running', started_by: startedBy }).select().single();
  if (error) { if (error.code === '23505') return null; throw new Error(error.message); }
  return data;
}
async function finishRun(D, run, patch) { const { data, error } = await D.supabase.from('hk_job_runs').update({ finished_at: D.now().toISOString(), ...patch }).eq('id', run.id).select().single(); if (error) throw new Error(error.message); return data; }
const errText = e => scrubAddresses(String(e?.message || e)).slice(0, 200);
// hk_sync_runs only knows manual | pageload | test; a cron tick's per-mailbox rows read manual, the job row keeps 'cron'.
const syncTrigger = t => (t === 'pageload' || t === 'test' ? t : 'manual');

// J1 gmail-sync-all: one runMailboxSync per tethered founder in state ok. -> { run, counts }
export async function gmailSyncAll({ businessId, trigger = 'manual', startedBy = null, d = {} }) {
  const D = jobDeps(d), now = D.now(), settings = await settingsOf(D.supabase, businessId);
  const run = await startRun(D, { businessId, job: 'gmail-sync-all', trigger, day: dayIn(now, settings.timezone), startedBy });
  const counts = { mailboxes: 0, synced: 0, reconnect: 0, running: 0, errors: 0, sent_detected: 0, replies: 0 };
  try {
    for (const f of await founders(D, businessId)) {
      if (!f.m) continue;
      counts.mailboxes++;
      if (f.m.state === RECONNECT) { counts.reconnect++; continue; }
      try {
        const out = await runMailboxSync({ D, businessId, userId: f.user_id, m: f.m, trigger: syncTrigger(trigger) });
        if (out.status === 'ok') { counts.synced++; counts.sent_detected += out.run.counts?.sent_detected || 0; counts.replies += out.run.counts?.replies || 0; }
        else if (out.status === 'running') counts.running++;
        else counts.reconnect++;
      } catch (e) { counts.errors++; }
    }
    return { run: runRow(await finishRun(D, run, { status: counts.errors ? 'partial' : 'ok', counts })), counts };
  } catch (e) { await finishRun(D, run, { status: 'error', counts, error: errText(e) }); throw e; }
}

const contactFirstName = (contacts, item, brandName) => { const c = contacts.find(x => x.id === item.contact_id); const n = c?.name && c.name !== `${brandName} contact` ? firstWord(c.name) : null; return n; };

// J1 daily-check. -> { run, counts, digest } or { skipped: 'already ran today' }. Drafts land on each owner's grant.
export async function dailyCheck({ businessId, trigger = 'manual', startedBy = null, d = {} }) {
  const D = jobDeps(d), now = D.now(), settings = await settingsOf(D.supabase, businessId);
  const run = await startRun(D, { businessId, job: 'daily-check', trigger, day: dayIn(now, settings.timezone), startedBy });
  if (!run) return { skipped: 'already ran today' };
  try {
    const fs = await founders(D, businessId), byUser = Object.fromEntries(fs.map(f => [f.user_id, f]));
    const { brands, touches, replies, contacts } = await workspaceRows(D, businessId);
    const follow = dueFollowups({ brands, touches, replies, contacts, settings, now });
    const dms = dueDms({ brands, touches, replies, settings, now });
    const noDraft = [], newTouches = [];
    let made = 0, capped = 0, errors = 0;
    const miss = (item, reason, detail = null) => noDraft.push({ brand_id: item.brand_id, kind: item.kind, reason, detail });
    for (const item of follow.items) {
      if (made >= DRAFTS_PER_RUN) { capped++; continue; }
      const f = byUser[item.owner_user_id];
      if (!f?.m) { miss(item, 'no_mailbox'); continue; }
      if (f.m.state === RECONNECT) { miss(item, 'reconnect'); continue; }
      if (!item.has_email) { miss(item, 'no_contact'); continue; }
      if (!item.prior_thread_id) { miss(item, 'no_thread'); continue; }
      let token;
      try { token = await D.tokenForGrant(f.m.grant, 'gmail'); }
      catch (e) { if (e instanceof NeedsGoogle) await D.flag(f.m.grant.id).catch(() => {}); miss(item, 'reconnect'); errors++; continue; }
      const args = { brandName: item.brand_name, brandId: item.brand_id, firstName: contactFirstName(contacts, item, item.brand_name), concept: item.challenge_concept, ownerFirstName: f.first_name };
      const text = item.kind === 'bump' ? bumpText(args) : finalText(args);
      try {
        const out = await createDraftFor({ D: { ...D, mailbox: async () => f.m }, businessId, userId: item.owner_user_id, body: { brand_id: item.brand_id, channel: 'email', kind: item.kind, subject: followupSubject(item.prior_subject), body_markdown: text.body, challenge_concept: item.challenge_concept, reply_to_touch_id: item.prior_touch_id, contact_id: item.contact_id }, tokenFor: async () => token, createdBy: 'system' });
        if (out) { newTouches.push(out.touch); made++; }
      } catch (e) {
        if (e instanceof HkError && e.status === 422) miss(item, 'lint', e.extra?.problems?.[0]?.message || null);
        else if (e instanceof HkError) miss(item, e.extra?.needs_contact ? 'no_contact' : e.extra?.needs_prior_touch ? 'no_thread' : 'blocked', e.message);
        else if ((e instanceof GmailError && e.status === 401) || e instanceof NeedsGoogle) { await D.flag(f.m.grant.id).catch(() => {}); miss(item, 'reconnect'); errors++; }
        else { miss(item, 'gmail', errText(e).slice(0, 120)); errors++; }
      }
    }
    // J1d - DM texts: a touch to copy from Today, no Gmail.
    for (const item of dms.items) {
      const f = byUser[item.owner_user_id];
      const { body } = dmText({ brandName: item.brand_name, ownerFirstName: f?.first_name || 'Jack', settings });
      const { data: t, error } = await D.supabase.from('hk_touches').insert({ business_id: businessId, brand_id: item.brand_id, sender_user_id: item.owner_user_id, channel: 'ig_dm', kind: 'dm_text', state: 'drafted', body_text: body, drafted_at: now.toISOString(), lint_passed: true, created_by: 'system' }).select().single();
      if (error) throw new Error(error.message);
      newTouches.push(t);
      await logEvent(D.supabase, { businessId, actorUserId: item.owner_user_id, actorKind: 'system', entityType: 'brand', entityId: item.brand_id, action: 'draft_created', detail: { touch_id: t.id, kind: 'dm_text', channel: 'ig_dm' } });
    }
    const all = [...touches, ...newTouches];
    const digest = buildDigest({ replies, touches: all, brands, members: members(fs), noDraft, dmReady: all.filter(t => t.channel === 'ig_dm' && t.state === 'drafted').map(t => ({ brand_id: t.brand_id, touch_id: t.id })), warningsCount: dataWarnings(brands, now).length, settings, events: await recentEvents(D, businessId, now), now });
    const slack = await postSlack(D, digest);
    const counts = { ...planCounts(follow, dms), drafted: made, capped, dm_texts: dms.items.length, no_draft: noDraft.length, errors, slack, digest: digest.counts };
    const done = await finishRun(D, run, { status: errors ? 'partial' : 'ok', counts, digest });
    return { run: runRow(done), counts, digest, skipped: null };
  } catch (e) { await finishRun(D, run, { status: 'error', error: errText(e) }).catch(() => {}); throw e; }
}

// One POST to the webhook when it is configured; otherwise skipped and counted. A PII trip inside renderSlack is an
// error here, never a post.
export async function postSlack(D, digest) {
  if (!D.slackUrl) return 'skipped';
  try {
    const msg = renderSlack(digest);
    const r = await D.fetch(D.slackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) });
    return r.ok ? 'posted' : 'error';
  } catch { return 'error'; }
}

// J2 page-load fallback: the CALLER's mailbox sync (60-min guard) and, past digest time on a digest day, the workspace
// daily-check if it has not run today. -> { sync, daily }
export async function pageloadJob({ businessId, userId, d = {} }) {
  const D = jobDeps(d), now = D.now(), settings = await settingsOf(D.supabase, businessId);
  let sync;
  const m = await D.mailbox(businessId, userId, 'drafts').catch(() => null);
  if (!m) sync = { skipped: 'no mailbox' };
  else if (m.state === RECONNECT) sync = { skipped: 'needs_reconnect' };
  else {
    const { data: runs } = await D.supabase.from('hk_sync_runs').select('trigger, status, started_at, finished_at').eq('business_id', businessId).eq('user_id', userId).order('started_at', { ascending: false }).limit(20);
    const skip = pageloadSkip(runs || [], now.getTime());
    if (skip) sync = { skipped: skip };
    else { try { const out = await runMailboxSync({ D, businessId, userId, m, trigger: 'pageload' }); sync = out.status === 'ok' ? { ran: true, run_id: out.run.id, counts: out.run.counts } : { skipped: out.status }; } catch (e) { sync = { error: errText(e) }; } }
  }
  let daily;
  if (!isDigestDay(now, settings)) daily = { skipped: 'not a digest day' };
  else if (!isPastDigestTime(now, settings)) daily = { skipped: 'before digest time' };
  else {
    const { data: runs } = await D.supabase.from('hk_job_runs').select('status, chicago_day, started_at').eq('business_id', businessId).eq('job', 'daily-check').order('started_at', { ascending: false }).limit(5);
    if (ranToday(runs || [], now, settings)) daily = { skipped: 'already ran today' };
    else { try { const out = await dailyCheck({ businessId, trigger: 'pageload', d }); daily = out.skipped ? { skipped: out.skipped } : { ran: true, run_id: out.run.id, counts: out.counts }; } catch (e) { daily = { error: errText(e) }; } }
  }
  return { sync, daily };
}

// Today's one read: a fresh payload from the current rows (the morning's no-draft items ride along from today's run),
// the last daily-check run, the founders' mailbox states. No Gmail.
export async function todayPayload({ businessId, d = {} }) {
  const D = jobDeps(d), now = D.now(), settings = await settingsOf(D.supabase, businessId);
  const fs = await founders(D, businessId);
  const { brands, touches, replies } = await workspaceRows(D, businessId);
  const { data: runs } = await D.supabase.from('hk_job_runs').select('*').eq('business_id', businessId).eq('job', 'daily-check').order('started_at', { ascending: false }).limit(1);
  const last = runs?.[0] || null;
  const today = dayIn(now, settings.timezone);
  const noDraft = last && last.chicago_day === today && last.status !== 'error' ? (last.digest?.sections?.no_draft || []).map(x => ({ brand_id: x.brand_id, kind: x.kind, reason: x.reason, detail: x.detail })) : [];
  const digest = buildDigest({ replies, touches, brands, members: members(fs), noDraft, dmReady: touches.filter(t => t.channel === 'ig_dm' && t.state === 'drafted').map(t => ({ brand_id: t.brand_id, touch_id: t.id })), warningsCount: dataWarnings(brands, now).length, settings, events: await recentEvents(D, businessId, now), now });
  return { run: runRow(last), ran_today: !!last && last.chicago_day === today && last.status !== 'error', digest, stats_stale: statsStale(settings, now), slack: { configured: !!D.slackUrl, env: SLACK_ENV }, mailboxes: fs.map(f => ({ user_id: f.user_id, first_name: f.first_name, state: f.m ? f.m.state : 'none' })), settings: { digest_time: settings.digest_time, digest_days: settings.digest_days, timezone: settings.timezone, quiet_weekends: settings.quiet_weekends } };
}

// J6 Send test digest: the current payload marked TEST, posted when Slack is configured. -> { digest, slack }
export async function testDigest({ businessId, d = {} }) {
  const D = jobDeps(d), now = D.now(), settings = await settingsOf(D.supabase, businessId);
  const fs = await founders(D, businessId);
  const { brands, touches, replies } = await workspaceRows(D, businessId);
  const digest = buildDigest({ replies, touches, brands, members: members(fs), dmReady: touches.filter(t => t.channel === 'ig_dm' && t.state === 'drafted').map(t => ({ brand_id: t.brand_id, touch_id: t.id })), warningsCount: dataWarnings(brands, now).length, settings, events: await recentEvents(D, businessId, now), now, test: true });
  return { digest, slack: await postSlack(D, digest), slack_configured: !!D.slackUrl };
}
