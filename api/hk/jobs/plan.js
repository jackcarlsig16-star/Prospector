// hkos-daily-check-v1 J1 - the pure planner behind daily-check: which brands are due a bump, a final or an Instagram DM,
// which are skipped and why, whether today is quiet, whether the stats are stale, and whether a run already happened
// today. Rules only: no Claude, no Gmail, no DB. The runner (Stage 2) feeds it rows and acts on the items; nothing here
// ever carries an address.
import { canContact, isOpenDraft } from '../rules.js';
import { normalizeDomain } from '../../../src/constants/partnerDomains.js';

const DAY = 86400e3;
export const STATS_STALE_DAYS = 14;
const FOLLOW = { cold: 'bump', bump: 'final', final: null };
const ACTIVE = new Set(['sent', 'bumped']);

export const dayIn = (date, tz = 'America/Chicago') => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const chicagoDay = date => dayIn(date, 'America/Chicago');
// FIX hk-cron-single-run: the slot a cron tick claims on its hk_job_runs row (unique per workspace + job, index
// hk_job_runs_cron_slot_once), so a tick fired in two server processes runs once: hourly for the sync, daily otherwise.
const hourIn = (date, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(date);
export const cronSlot = (job, date, tz = 'America/Chicago') => (job === 'gmail-sync-all' ? `${dayIn(date, tz)} ${hourIn(date, tz)}` : dayIn(date, tz));
export const SLOT_TAKEN = 'another process has this slot';
export const slotTaken = e => e?.code === '23505' && String(e.message || '').includes('hk_job_runs_cron_slot_once');
const partsIn = (date, tz) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date); const get = k => p.find(x => x.type === k)?.value; return { weekday: get('weekday'), minutes: Number(get('hour')) * 60 + Number(get('minute')) }; };
export const isWeekend = (date, tz = 'America/Chicago') => ['Sat', 'Sun'].includes(partsIn(date, tz).weekday);
// settings.quiet_weekends (default true): no follow-ups drafted on a Saturday or Sunday in the workspace timezone.
export const isQuietDay = (date, settings = {}) => (settings.quiet_weekends ?? true) && isWeekend(date, settings.timezone || 'America/Chicago');
// digest_time 'HH:MM' in settings.timezone; digest_days 'weekdays' | 'daily'.
export function isPastDigestTime(date, settings = {}) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(settings.digest_time || '07:30'));
  const at = m ? Number(m[1]) * 60 + Number(m[2]) : 7 * 60 + 30;
  return partsIn(date, settings.timezone || 'America/Chicago').minutes >= at;
}
export const isDigestDay = (date, settings = {}) => (settings.digest_days === 'daily' ? true : !isWeekend(date, settings.timezone || 'America/Chicago'));
// runs: hk_job_runs rows for the job, any order. Running / ok / partial hold the day; an error does not.
export const ranToday = (runs, date, settings = {}) => { const day = dayIn(date, settings.timezone || 'America/Chicago'); return (runs || []).some(r => r.status !== 'error' && (r.chicago_day === day || (r.started_at && dayIn(new Date(r.started_at), settings.timezone || 'America/Chicago') === day))); };
export const statsStale = (settings = {}, now = new Date()) => !settings.stats_confirmed_at || now.getTime() - Date.parse(settings.stats_confirmed_at) > STATS_STALE_DAYS * DAY;
export const cronExprFor = (settings = {}) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(settings.digest_time || '07:30')); const [h, mi] = m ? [Number(m[1]), Number(m[2])] : [7, 30]; return `${mi} ${h} * * ${settings.digest_days === 'daily' ? '*' : '1-5'}`; };

const byBrand = (rows, key = 'brand_id') => { const m = new Map(); for (const r of rows || []) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); } return m; };
const lastSentEmail = touches => [...touches].filter(t => t.channel === 'email' && t.state === 'sent' && t.sent_at).sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at))).pop() || null;
const repliedSince = (replies, sentAt) => replies.some(r => !sentAt || String(r.received_at) >= String(sentAt));

// { brands, touches, replies, contacts, settings, members: { jack, pete }, now, maxEmailTouches }
//   -> { quiet, items: [{ brand_id, brand_name, owner_user_id, kind, prior_touch_id, prior_subject, prior_thread_id, contact_id, has_email, challenge_concept }],
//        skipped: [{ brand_id, brand_name, reason, kind? }] }
// Reasons: quiet_weekend · not_active · not_prospect · owner_missing (owner_hint set, no profile yet) · unowned · replied ·
// no_due_date · not_due · final_done · days_not_elapsed · draft_exists · blocked:<canContact reason>.
export function dueFollowups({ brands = [], touches = [], replies = [], contacts = [], settings = {}, now = new Date(), maxEmailTouches = null } = {}) {
  const items = [], skipped = [];
  const skip = (b, reason, kind = null) => skipped.push({ brand_id: b.id, brand_name: b.name, reason, kind });
  if (isQuietDay(now, settings)) return { quiet: true, items, skipped: brands.filter(b => ACTIVE.has(b.status)).map(b => ({ brand_id: b.id, brand_name: b.name, reason: 'quiet_weekend', kind: null })) };
  const tBy = byBrand(touches), rBy = byBrand(replies), cBy = byBrand(contacts);
  const bump = settings.bump_after_days ?? 5, fin = settings.final_after_days ?? 14;
  for (const b of brands) {
    if (b.archived_at) continue;
    if (!ACTIVE.has(b.status)) { if (b.status === 'drafted' || b.status === 'claimed' || b.status === 'final_sent') skip(b, b.status === 'final_sent' ? 'final_done' : 'not_active'); continue; }
    if (b.relationship !== 'prospect') { skip(b, 'not_prospect'); continue; }
    if (!b.owner_user_id) { skip(b, b.owner_hint ? 'owner_missing' : 'unowned'); continue; }
    // A logged outside touch (Log activity) never moves the sequence: only Grow's own cold / bump / final do.
    const mine = (tBy.get(b.id) || []).filter(t => t.kind !== 'outside');
    const last = lastSentEmail(mine);
    if (!last) { skip(b, 'no_sent_touch'); continue; }
    const kind = FOLLOW[last.kind] ?? null;
    if (!kind) { skip(b, 'final_done'); continue; }
    if (repliedSince(rBy.get(b.id) || [], last.sent_at)) { skip(b, 'replied', kind); continue; }
    if (!b.next_due_at) { skip(b, 'no_due_date', kind); continue; }
    if (String(b.next_due_at) > now.toISOString()) { skip(b, 'not_due', kind); continue; }
    const waitDays = kind === 'bump' ? bump : Math.max(1, fin - bump);
    if (now.getTime() < Date.parse(last.sent_at) + waitDays * DAY) { skip(b, 'days_not_elapsed', kind); continue; }
    if (mine.some(t => t.channel === 'email' && isOpenDraft(t) && t.kind === kind)) { skip(b, 'draft_exists', kind); continue; }
    const verdict = canContact({ brand: b, touches: mine, senderUserId: b.owner_user_id, kind, maxEmailTouches: maxEmailTouches ?? settings.max_email_touches ?? 3 });
    if (!verdict.ok) { skip(b, `blocked:${verdict.reason}`, kind); continue; }
    const cs = cBy.get(b.id) || [];
    const contact = cs.find(c => c.is_primary && c.email) || cs.find(c => c.email) || null;
    items.push({ brand_id: b.id, brand_name: b.name, owner_user_id: b.owner_user_id, kind, prior_touch_id: last.id, prior_subject: last.subject || null, prior_thread_id: last.gmail_thread_id || null, contact_id: contact?.id || null, has_email: !!contact, challenge_concept: last.challenge_concept || b.challenge_idea || null });
  }
  return { quiet: false, items, skipped };
}

// J1d - a cold email went out dm_after_days ago, no reply, no Instagram DM yet -> a DM text to copy. Same owner / prospect
// / quiet rules; never for a brand with a drafted or sent DM already.
export function dueDms({ brands = [], touches = [], replies = [], settings = {}, now = new Date() } = {}) {
  const items = [], skipped = [];
  if (isQuietDay(now, settings)) return { quiet: true, items, skipped };
  const tBy = byBrand(touches), rBy = byBrand(replies), after = settings.dm_after_days ?? 9;
  for (const b of brands) {
    if (b.archived_at || b.relationship !== 'prospect' || !b.owner_user_id) continue;
    if (!['sent', 'bumped', 'final_sent'].includes(b.status)) continue;
    const mine = tBy.get(b.id) || [];
    const cold = mine.find(t => t.channel === 'email' && t.kind === 'cold' && t.state === 'sent' && t.sent_at);
    if (!cold) continue;
    // An imported DM text (the sheet said one was ready) is hidden from the DM step, so it must not block a fresh one.
    if (mine.some(t => t.channel === 'ig_dm' && t.state !== 'discarded' && t.state !== 'imported')) { skipped.push({ brand_id: b.id, brand_name: b.name, reason: 'dm_exists' }); continue; }
    if (repliedSince(rBy.get(b.id) || [], cold.sent_at)) { skipped.push({ brand_id: b.id, brand_name: b.name, reason: 'replied' }); continue; }
    if (now.getTime() < Date.parse(cold.sent_at) + after * DAY) continue;
    const verdict = canContact({ brand: b, touches: mine, senderUserId: b.owner_user_id, kind: 'dm_text' });
    if (!verdict.ok) { skipped.push({ brand_id: b.id, brand_name: b.name, reason: `blocked:${verdict.reason}` }); continue; }
    items.push({ brand_id: b.id, brand_name: b.name, owner_user_id: b.owner_user_id, kind: 'dm_text', domain: b.domain ? normalizeDomain(b.domain) : null });
  }
  return { quiet: false, items, skipped };
}

// Numbers only, for the run row.
export const planCounts = (follow, dms) => {
  const reasons = {};
  for (const s of [...follow.skipped, ...dms.skipped]) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
  return { due_bump: follow.items.filter(i => i.kind === 'bump').length, due_final: follow.items.filter(i => i.kind === 'final').length, due_dm: dms.items.length, without_contact: follow.items.filter(i => !i.has_email).length, quiet: !!follow.quiet, skipped: reasons };
};
