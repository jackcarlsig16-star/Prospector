// grow-today-workflow-v1 Stage 1 - "Your day": one ordered checklist for the SIGNED-IN member (the owner toggle never
// applies). Steps 1 Answer replies · 3 Send follow-ups · 4 Send Instagram DMs · 5 Send today's pitches; step 2 (deal
// nudges) and the money card stay hidden until grow-deal-email-v1 / grow-sponsor-deals-v1 data exists. A step shows when
// it has items left or something was done today (then it collapses to its done line). Done-today comes from today's
// touches, replies, linked threads and Activity rows - no new table. 0 Gmail, 0 Claude, 0 Apollo; no address leaves here.
import { getSupabase, HkError, fail, me, detailHasPii } from './hkShared.js';
import { isOpenDraft, sheetOwnerOf } from './rules.js';
import { loadIntel, firstNameOf } from './intelData.js';
import { rankReach, importanceOf, intelSettings, intelFor } from './intelScore.js';
import { cardOf } from './briefingRoutes.js';
import { researchEstimate, pitchRoute } from './brandActions.js';
import { dayIn } from './jobs/plan.js';

const DAY = 864e5;
export const MINUTES = { replies: 3, deals: 2, followups: 1, dms: 2, pitches: 2 }; // REVISABLE (design input)
export const COMING_UP_N = 3, PITCH_ALL_MAX = 10;
const STEPS = {
  replies: { n: 1, title: 'Answer replies', why: 'Someone wrote back - a person is waiting on you.' },
  followups: { n: 3, title: 'Send follow-ups that are due', why: 'Already written in your Gmail - about a minute each.' },
  dms: { n: 4, title: 'Send Instagram DMs that are due', why: 'The text is written - copy it, send it in Instagram.' },
  pitches: { n: 5, title: "Send today's pitches", why: 'New outreach is the biggest block, so it comes last.' },
};
const CLOSED = new Set(['passed', 'skipped', 'sponsor', 'signed']);
const ageDays = (iso, now) => (iso ? Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY)) : null);
const latest = isos => isos.filter(Boolean).sort().pop() || null;
const target = cmd => cmd.replace(/^hk pitch /, '');

// "Referred us to Sam Lee, their marketing lead" -> "Sam Lee". Names only; the summary never carries an address.
export function referralName(summary) {
  const m = String(summary || '').match(/\b(?:to|contact|reach out to|talk to|speak with|email|ask for|connect with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  return m ? m[1] : null;
}

// Not today: per member, per day, in hk_member_prefs.rail.today_hidden = { day, brand_ids } (a stale day reads empty).
export const hiddenToday = (prefs, day) => (prefs?.rail?.today_hidden?.day === day ? prefs.rail.today_hidden.brand_ids || [] : []);

// The member's `add` rows today, less any brand whose later row is `drop` (its Undo) -> { brand_id: at }.
function netByBrand(events, { meId, on, add, drop }) {
  const last = {};
  for (const e of [...events].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    if (e.actor_user_id !== meId || !on(e.created_at)) continue;
    if (e.action === add) last[e.entity_id] = e.created_at;
    if (e.action === drop) delete last[e.entity_id];
  }
  return last;
}
const netToday = (events, o) => Object.keys(netByBrand(events, o));
// Pitched today = the member's brand.pitched rows today, less any brand whose later row is brand.pitch_undone.
export const pitchedToday = (events, { meId, on }) => netByBrand(events, { meId, on, add: 'brand.pitched', drop: 'brand.pitch_undone' });

// Pure. data = loadIntel(...) plus: replies (full rows, open + handled lately), drafts (the member's drafted touches with
// gmail_draft_id / subject / body_text), threads (the member's linked hk_brand_threads), events (since yesterday), noDraft
// (today's daily-check no_draft rows), periods (hk_sponsor_periods), prefs, lastRun, perCall.
export function buildDay({ meId, data, replies = [], drafts = [], threads = [], events = [], noDraft = [], periods = [], prefs = null, lastRun = null, perCall = null, now }) {
  const tz = data.settingsRow.timezone || 'America/Chicago', today = dayIn(now, tz);
  const on = iso => !!iso && dayIn(new Date(iso), tz) === today;
  const byId = Object.fromEntries(data.brands.map(b => [b.id, b]));
  const touchBy = Object.fromEntries(data.touches.map(t => [t.id, t]));
  const mineBrand = id => byId[id]?.owner_user_id === meId;
  const brandOf = id => ({ brand_id: id, brand_name: byId[id]?.name || 'Unknown brand', heat_band: byId[id]?.heat_band || 'cold' });
  const yours = r => mineBrand(r.brand_id) || (r.touch_id && touchBy[r.touch_id]?.sender_user_id === meId);

  // 1 Answer replies: tracked replies on your brands / your threads, then your linked threads waiting on us.
  const ictx = { byId, warmBrands: new Set(), settings: intelSettings(data.settingsRow.intel), now };
  const fitOf = id => intelFor(byId[id] || {}, data.intelByDomain)?.intel?.fit?.sponsor_fit || null;
  const open = replies.filter(r => byId[r.brand_id] && !r.handled && !(r.snoozed_until && String(r.snoozed_until) > now.toISOString()) && yours(r));
  const replyItems = open.map(r => {
    const imp = importanceOf({ lane: 'needs_you', chip: { brand_id: r.brand_id, label: r.label, kind: 'tracked' }, latest_from_us: false, snippet: '', intel_fit: fitOf(r.brand_id), unread: false, date: r.received_at }, ictx);
    const own = !!r.touch_id && touchBy[r.touch_id]?.sender_user_id === meId;
    return { kind: 'reply', ...brandOf(r.brand_id), reply_id: r.id, label: r.label || 'other', urgent: !!r.urgent, summary: r.summary || null, age_days: ageDays(r.received_at, now), received_at: r.received_at, importance: imp.score, why: imp.why, gmail_thread_id: own ? r.gmail_thread_id || null : null, referral_name: r.label === 'referral' ? referralName(r.summary) : null, command: `hk reply ${byId[r.brand_id].domain || byId[r.brand_id].name}` };
  }).sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.importance - a.importance || String(b.received_at).localeCompare(String(a.received_at)));
  const replyThreads = new Set(open.map(r => r.gmail_thread_id).filter(Boolean));
  const mineThreads = threads.filter(t => t.member_user_id === meId && t.link_state === 'linked' && byId[t.brand_id]);
  const threadItems = mineThreads.filter(t => t.waiting_on === 'us' && t.matched_by !== 'suggested_domain' && t.matched_by !== 'name' && !replyThreads.has(t.gmail_thread_id))
    .sort((a, b) => String(a.last_theirs_at).localeCompare(String(b.last_theirs_at)))
    .map(t => ({ kind: 'thread', ...brandOf(t.brand_id), thread_id: t.id, deal_stage: t.deal_stage || null, deal_month: t.deal_month || null, summary: t.summary || null, age_days: ageDays(t.last_theirs_at, now), gmail_thread_id: t.gmail_thread_id }));
  const answered = replies.filter(r => r.handled && on(r.handled_at) && yours(r));
  const threadsAnswered = mineThreads.filter(t => on(t.last_ours_at) && t.last_theirs_at && t.last_theirs_at < t.last_ours_at);
  const repliesDone = answered.length + threadsAnswered.length;

  // 3 Send follow-ups: your bump / final drafts with a real Gmail draft; today's no-draft rows on your brands as "Draft it".
  // A skipped follow-up keeps its Gmail draft (only Discard deletes one), so the skip itself hides the row.
  const skipped = netToday(events, { meId, on, add: 'followup_skipped', drop: 'followup_unskipped' });
  const followItems = [
    ...drafts.filter(t => t.sender_user_id === meId && t.channel === 'email' && (t.kind === 'bump' || t.kind === 'final') && isOpenDraft(t) && byId[t.brand_id] && !skipped.includes(t.brand_id))
      .map(t => ({ kind: 'draft', ...brandOf(t.brand_id), touch_id: t.id, touch_kind: t.kind, subject: t.subject || null, gmail_draft_id: t.gmail_draft_id, gmail_message_id: t.gmail_message_id || null, age_days: ageDays(t.drafted_at, now) })),
    ...noDraft.filter(x => mineBrand(x.brand_id) && !skipped.includes(x.brand_id)).map(x => ({ kind: 'draft_it', ...brandOf(x.brand_id), touch_kind: x.kind, reason: x.reason })),
  ];
  const sentToday = data.touches.filter(t => t.sender_user_id === meId && t.state === 'sent' && on(t.sent_at));
  const followSent = sentToday.filter(t => t.channel === 'email' && (t.kind === 'bump' || t.kind === 'final'));

  // 4 Send Instagram DMs: your DM texts.
  const dmItems = drafts.filter(t => t.sender_user_id === meId && t.channel === 'ig_dm' && t.state === 'drafted' && byId[t.brand_id])
    .map(t => ({ kind: 'dm', ...brandOf(t.brand_id), touch_id: t.id, text: t.body_text || '', instagram_handle: byId[t.brand_id].instagram_handle || null, age_days: ageDays(t.drafted_at, now) }));
  const dmSent = sentToday.filter(t => t.channel === 'ig_dm');

  // 5 Send today's pitches: your Ready-to-pitch rows from Send these 10, less Not today and today's pitches, up to the goal.
  const meFirstName = firstNameOf(data, meId), ctx = { ...data, meId, now };
  const cards = rankReach(data.brands, ctx, { meFirstName, limit: null }).map(r => cardOf(r, data, meId));
  const send10 = cards.slice(0, 10);
  const pitched = pitchedToday(events, { meId, on }), hidden = new Set(hiddenToday(prefs, today));
  const ready = send10.filter(c => c.primary?.kind === 'pitch' && !pitched[c.id] && !hidden.has(c.id));
  const goal = intelSettings(data.settingsRow.intel).pitch_goal;
  const pitchedN = Object.keys(pitched).length, room = Math.max(0, goal - pitchedN);
  const pitchItems = ready.slice(0, room).map(c => ({ kind: 'pitch', ...brandOf(c.id), targeted: !!c.targeted_at, fit: c.research?.fit || null, industry: c.research?.industry || null, market: c.is_local ? 'Chicago' : c.research?.hq_city || c.city || null, contact_role: c.contact?.title || null, idea: c.challenge_idea || c.research?.challenge_idea || null, command: c.command, owner_hint: sheetOwnerOf(byId[c.id], meFirstName) ? byId[c.id].owner_hint : null, card: c }));
  const morePitch = cards.filter(c => c.primary?.kind === 'pitch' && !pitched[c.id] && !hidden.has(c.id)).length - pitchItems.length;

  const fmtTime = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).toLowerCase();
  const doneLine = (n, word, at) => (n ? `${n} ${word}${at ? ` · detected in Gmail ${fmtTime(at)}` : ''}` : null);
  const step = (key, items, done) => ({ key, ...STEPS[key], minutes_each: MINUTES[key], left: items.length, minutes: items.length * MINUTES[key], items, done, collapsed: !items.length && done.n > 0 });
  const all = [
    step('replies', [...replyItems, ...threadItems], { n: repliesDone, line: doneLine(repliesDone, 'answered', latest(threadsAnswered.map(t => t.last_ours_at))) }),
    step('followups', followItems, { n: followSent.length + skipped.length, line: [doneLine(followSent.length, 'sent', latest(followSent.map(t => t.sent_at))), skipped.length ? `${skipped.length} skipped` : null].filter(Boolean).join(' · ') || null }),
    step('dms', dmItems, { n: dmSent.length, line: dmSent.length ? `${dmSent.length} sent` : null }),
    { ...step('pitches', pitchItems, { n: pitchedN, line: pitchedN ? `${pitchedN} pitched` : null }), goal, ready: ready.length, more_in_briefing: Math.max(0, morePitch), pitch_all: pitchItems.length > 1 ? { brand_ids: pitchItems.map(p => p.brand_id), command: `hk pitch ${pitchItems.map(p => target(p.command)).join(', ')}` } : null },
  ];
  const steps = all.filter(s => s.left || s.done.n);
  const left = steps.reduce((n, s) => n + s.left, 0), done = steps.reduce((n, s) => n + s.done.n, 0);

  // Never blank: real counts only, a line with nothing behind it is not sent.
  const research = send10.filter(c => c.primary?.kind === 'research').length;
  const needsEmail = send10.filter(c => c.primary?.kind === 'add_email').length;
  const sheet = {};
  for (const b of data.brands) { const h = !b.archived_at && b.relationship === 'prospect' ? sheetOwnerOf(b, meFirstName) : null; if (h && (data.contactsBy[b.id] || []).some(c => c.has_email)) sheet[h] = (sheet[h] || 0) + 1; }
  const want_more = [
    research ? { key: 'research', n: research, usd: perCall != null ? Math.round(research * perCall * 100) / 100 : null, to: 'briefing:research' } : null,
    needsEmail ? { key: 'needs_email', n: needsEmail, to: 'briefing:add_email' } : null,
    ...Object.entries(sheet).map(([hint, n]) => ({ key: 'sheet_emails', hint, n, to: 'brands:sheet' })),
  ].filter(Boolean);

  // Coming up: the next dated things - your follow-ups due on a date, your brands' sponsor months, your threads' months.
  const monthStart = m => `${m}-01`;
  const thisMonth = today.slice(0, 7);
  const coming = [
    ...data.brands.filter(b => b.owner_user_id === meId && b.next_due_at && Date.parse(b.next_due_at) > now.getTime() && !CLOSED.has(b.status)).map(b => ({ kind: 'followup_due', ...brandOf(b.id), date: dayIn(new Date(b.next_due_at), tz) })),
    ...periods.filter(p => p.kind === 'monthly' && (p.state || 'confirmed') === 'confirmed' && p.period > thisMonth && mineBrand(p.brand_id)).map(p => ({ kind: 'sponsor_month', ...brandOf(p.brand_id), date: monthStart(p.period) })),
    ...mineThreads.filter(t => t.deal_month && t.deal_month > thisMonth && (t.deal_stage === 'scheduling' || t.deal_stage === 'confirmed' || t.deal_stage === 'discussing')).map(t => ({ kind: 'deal_month', ...brandOf(t.brand_id), deal_stage: t.deal_stage, date: monthStart(t.deal_month) })),
  ].sort((a, b) => a.date.localeCompare(b.date)).filter((c, i, arr) => arr.findIndex(x => x.kind === c.kind && x.brand_id === c.brand_id && x.date === c.date) === i).slice(0, COMING_UP_N);

  const out = {
    day: today, me: meId, first_name: meFirstName,
    total: left + done, done, left, minutes_left: steps.reduce((n, s) => n + s.minutes, 0), badge: left,
    progress: { sent_today: sentToday.length, pitched: pitchedN, pitch_goal: goal, replies_answered: repliesDone, replies_total: repliesDone + replyItems.length + threadItems.length },
    daily_check: lastRun ? { at: lastRun.finished_at || lastRun.started_at, status: lastRun.status, today: lastRun.chicago_day === today } : null,
    steps, all_done: left === 0, want_more: left === 0 ? want_more : [], coming_up: coming, money: null,
  };
  if (detailHasPii(out)) throw new Error('Your day would carry an address or phone number');
  return out;
}

const must = r => { if (r.error) throw new Error(r.error.message); return r.data || []; };
// GET /today/day - the signed-in member's day; ?owner is ignored on purpose (T1).
export async function dayRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, meId = me(req);
  try {
    const at = now(), data = await loadIntel(supabase, businessId, at);
    const since = new Date(at.getTime() - 2 * DAY).toISOString();
    const RCOLS = 'id, brand_id, touch_id, label, summary, urgent, handled, handled_at, handled_by, snoozed_until, received_at, gmail_thread_id';
    const [openR, doneR, drafts, threads, events, runs, periods, prefs] = await Promise.all([
      supabase.from('hk_replies').select(RCOLS).eq('business_id', businessId).eq('handled', false),
      supabase.from('hk_replies').select(RCOLS).eq('business_id', businessId).eq('handled', true).gte('handled_at', since),
      supabase.from('hk_touches').select('id, brand_id, sender_user_id, channel, kind, state, gmail_draft_id, gmail_message_id, subject, body_text, drafted_at').eq('business_id', businessId).eq('sender_user_id', meId).eq('state', 'drafted'),
      supabase.from('hk_brand_threads').select('id, brand_id, member_user_id, gmail_thread_id, matched_by, link_state, last_ours_at, last_theirs_at, waiting_on, deal_stage, deal_month, summary').eq('business_id', businessId).eq('member_user_id', meId).eq('link_state', 'linked'),
      supabase.from('hk_events').select('action, actor_user_id, entity_id, created_at').eq('business_id', businessId).in('action', ['brand.pitched', 'brand.pitch_undone', 'followup_skipped', 'followup_unskipped']).gte('created_at', since),
      supabase.from('hk_job_runs').select('chicago_day, status, started_at, finished_at, digest').eq('business_id', businessId).eq('job', 'daily-check').order('started_at', { ascending: false }).limit(1),
      supabase.from('hk_sponsor_periods').select('brand_id, period, kind, state').eq('business_id', businessId).is('archived_at', null),
      supabase.from('hk_member_prefs').select('rail').eq('business_id', businessId).eq('user_id', meId).maybeSingle(),
    ]);
    const lastRun = must(runs)[0] || null;
    const today = dayIn(at, data.settingsRow.timezone || 'America/Chicago');
    const noDraft = lastRun && lastRun.chicago_day === today && lastRun.status !== 'error' ? lastRun.digest?.sections?.no_draft || [] : [];
    const { per_call } = await researchEstimate(supabase, businessId);
    res.json(buildDay({ meId, data, replies: [...must(openR), ...must(doneR)], drafts: must(drafts), threads: must(threads), events: must(events), noDraft, periods: must(periods), prefs: prefs.data || null, lastRun, perCall: per_call, now: at }));
  } catch (e) { fail(res, e, 'today/day'); }
}

// POST /today/not-today { brand_id, on } - hides a pitch until tomorrow for the caller only; no brand data changes.
// on:false is the Undo.
export async function notTodayRoute(req, res, { supabase = getSupabase(), now = () => new Date() } = {}) {
  const businessId = req.params.businessId, meId = me(req), { brand_id: brandId, on } = req.body || {};
  try {
    if (typeof brandId !== 'string' || typeof on !== 'boolean') throw new HkError(400, 'send { brand_id, on: true | false }');
    const { data: b, error: e0 } = await supabase.from('hk_brands').select('id').eq('business_id', businessId).eq('id', brandId).maybeSingle();
    if (e0) throw new Error(e0.message);
    if (!b) throw new HkError(404, 'brand not found');
    const { data: s } = await supabase.from('hk_settings').select('timezone').eq('business_id', businessId).maybeSingle();
    const at = now(), day = dayIn(at, s?.timezone || 'America/Chicago');
    const { data: row, error: e1 } = await supabase.from('hk_member_prefs').select('rail').eq('business_id', businessId).eq('user_id', meId).maybeSingle();
    if (e1) throw new Error(e1.message);
    const ids = new Set(hiddenToday(row, day));
    if (on) ids.add(brandId); else ids.delete(brandId);
    const rail = { ...(row?.rail || {}), today_hidden: { day, brand_ids: [...ids] } };
    const { error } = await supabase.from('hk_member_prefs').upsert({ business_id: businessId, user_id: meId, rail, updated_at: at.toISOString() }, { onConflict: 'business_id,user_id' });
    if (error) throw new Error(error.message);
    res.json({ day, brand_ids: [...ids] });
  } catch (e) { fail(res, e, 'today/not-today'); }
}

const asRes = () => { const out = { code: 200, body: null }; const r = { status(c) { out.code = c; return r; }, json(b) { out.body = b; return r; } }; return [r, out]; };
// POST /today/pitch-all { brand_ids, confirm_sheet_owner? } - the same Pitch for each (claim when nobody's, can_contact,
// sheet-owner confirm), one combined "hk pitch a, b, c" over the ones that went through.
// { undo: true, items: [{ brand_id, claimed, expect_updated_at }] } - each one's Pitch Undo.
export async function pitchAllRoute(req, res, d = {}) {
  const businessId = req.params.businessId, body = req.body || {};
  try {
    const list = body.undo === true ? body.items : body.brand_ids;
    if (!Array.isArray(list) || !list.length || list.length > PITCH_ALL_MAX) throw new HkError(400, `send 1 to ${PITCH_ALL_MAX} brands`);
    const done = [], refused = [];
    for (const x of list) {
      const id = body.undo === true ? x?.brand_id : x;
      if (typeof id !== 'string') throw new HkError(400, 'each brand is an id');
      const [r, out] = asRes();
      const one = body.undo === true ? { undo: true, claimed: x.claimed !== false, expect_updated_at: x.expect_updated_at } : (body.confirm_sheet_owner === true ? { confirm_sheet_owner: true } : {});
      await pitchRoute({ ...req, params: { businessId, id }, body: one }, r, d);
      if (out.code === 200) done.push({ brand_id: id, name: out.body.brand?.name || null, claimed: !!out.body.claimed, updated_at: out.body.brand?.updated_at || null, command: out.body.command || null });
      else refused.push({ brand_id: id, error: out.body?.error || 'that did not work', ...(out.body?.confirm_sheet_owner ? { needs_confirm: true, sheet_owner: out.body.sheet_owner || null } : {}) });
    }
    const cmds = done.map(x => x.command).filter(Boolean);
    res.json({ done, refused, undone: body.undo === true, command: cmds.length ? `hk pitch ${cmds.map(target).join(', ')}` : null });
  } catch (e) { fail(res, e, 'today/pitch-all'); }
}

