// grow-sponsor-deals-v1 - sponsor months as deals. Pure rules (S2 deal stage + the relationship fix, S4 money, ruling 3
// thread suggestions) plus the one live-period read every caller shares. A month row: hk_sponsor_periods with state
// confirmed | discussing | declined, amount_usd, paid, source sheet | user | email; archived rows are never read here.
import { selectAllPages, logEvent, hasPii } from './hkShared.js';

export const STATES = ['confirmed', 'discussing', 'declined'];
// Deal details are full of date ranges ("06/01/2026 - 06/30/2026") that the shared phone check reads as a number:
// slash dates are dropped before the check. Addresses and real phone numbers still fail.
const SLASH_DATE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;
export const detailPii = v => hasPii(String(v).replace(SLASH_DATE, ''));
export const DEAL_STAGES = ['prospect', 'discussing', 'sponsor', 'past_sponsor', 'founding_partner', 'declined'];
export const DEAL_STAGE_WORDS = { prospect: 'Prospect', discussing: 'In discussion', sponsor: 'Sponsor', past_sponsor: 'Past sponsor', founding_partner: 'Founding partner', declined: 'Declined' };
export const STATE_WORDS = { confirmed: 'Confirmed', discussing: 'In discussion', declined: 'Declined' };

// The column default: a row written before the migration (or by a test fixture) is confirmed.
export const stateOf = p => p.state || 'confirmed';
export const chicagoMonth = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now).slice(0, 7);
export const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const t = y * 12 + (mo - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
export const monthWords = m => new Date(`${m}-15T12:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export const livePeriods = (supabase, businessId, cols = '*') => selectAllPages(() => supabase.from('hk_sponsor_periods').select(cols).eq('business_id', businessId).is('archived_at', null).order('id'));
export const groupByBrand = rows => { const by = {}; for (const r of rows) (by[r.brand_id] ||= []).push(r); return by; };

// S2 - one stage per brand from its live months. A current sponsor talking renewal is still a Sponsor; a confirmed month
// further out than next month counts as Sponsor too (it is booked). Discussing months that all lie in the past read as
// Prospect - nobody closed them - unless the latest month was declined.
export function dealStageOf(brand, periods, thisMonth) {
  if (brand.relationship === 'founding_partner') return 'founding_partner';
  const ms = periods.filter(p => p.kind === 'monthly');
  if (!ms.length) return 'prospect';
  if (ms.some(p => stateOf(p) === 'confirmed' && p.period >= thisMonth)) return 'sponsor';
  if (ms.some(p => stateOf(p) === 'discussing' && p.period >= thisMonth)) return 'discussing';
  const latest = [...ms].sort((a, b) => b.period.localeCompare(a.period))[0];
  if (stateOf(latest) === 'declined') return 'declined';
  if (ms.some(p => stateOf(p) === 'confirmed')) return 'past_sponsor';
  return 'prospect';
}

// S2 relationship fix - 'sponsor' only with >= 1 confirmed monthly month. A sponsor whose months are all discussing or
// declined is a prospect again; one with no months at all (set by hand) keeps what an owner chose. Founding partner and
// do not contact are never changed here.
export function relationshipFor(brand, periods) {
  if (brand.relationship !== 'sponsor' && brand.relationship !== 'prospect') return brand.relationship;
  const ms = periods.filter(p => p.kind === 'monthly');
  if (ms.some(p => stateOf(p) === 'confirmed')) return 'sponsor';
  return brand.relationship === 'sponsor' && ms.length ? 'prospect' : brand.relationship;
}
// The brand fields a relationship change brings: a new sponsor reads status 'sponsor' (as the relationship PATCH does);
// a sponsor turned prospect leaves the closed 'sponsor' status for 'replied' - they are in a live conversation.
export function relationshipPatch(brand, periods) {
  const rel = relationshipFor(brand, periods);
  if (rel === brand.relationship) return null;
  return { relationship: rel, ...(rel === 'sponsor' ? { status: 'sponsor' } : brand.status === 'sponsor' ? { status: 'replied' } : {}) };
}
export const hasDiscussing = periods => periods.some(p => stateOf(p) === 'discussing');

// S4 - per month (monthly rows of live brands only): Confirmed $ · Paid $ · Unpaid confirmed $ · In discussion $ and the
// three counts. A month with no amount on any row shows null dollars ("—"), never 0. No probabilities: confirmed and
// discussing are always separate; if_all_close = confirmed + discussing.
export function moneyByMonth(periods, months) {
  const sum = rows => (rows.some(p => p.amount_usd != null) ? Math.round(rows.reduce((n, p) => n + (p.amount_usd == null ? 0 : Number(p.amount_usd)), 0) * 100) / 100 : null);
  const rows = months.map(m => {
    const ps = periods.filter(p => p.kind === 'monthly' && p.period === m);
    const conf = ps.filter(p => stateOf(p) === 'confirmed'), disc = ps.filter(p => stateOf(p) === 'discussing');
    const known = ps.some(p => p.amount_usd != null);
    const usd = v => (known ? v ?? 0 : null);
    return {
      month: m, confirmed_usd: usd(sum(conf)), paid_usd: usd(sum(conf.filter(p => p.paid))), unpaid_usd: usd(sum(conf.filter(p => !p.paid))), discussing_usd: usd(sum(disc)),
      confirmed: conf.length, discussing: disc.length, declined: ps.filter(p => stateOf(p) === 'declined').length, paid: conf.filter(p => p.paid).length,
      without_amount: ps.filter(p => stateOf(p) !== 'declined' && p.amount_usd == null).length,
    };
  });
  const total = k => (rows.some(r => r[k] != null) ? Math.round(rows.reduce((n, r) => n + (r[k] || 0), 0) * 100) / 100 : null);
  const conf = total('confirmed_usd'), disc = total('discussing_usd');
  return { months: rows, totals: { confirmed_usd: conf, paid_usd: total('paid_usd'), unpaid_usd: total('unpaid_usd'), discussing_usd: disc, if_all_close_usd: conf == null && disc == null ? null : (conf || 0) + (disc || 0) } };
}

// Ruling 3 (Nov 2) - linked Gmail threads' deal facts feed the months as suggestions. Sheet and user rows never change.
// An email may only CREATE a missing month (In discussion, source 'email') from a discussing / scheduling / confirmed
// thread, and fill an empty amount on a row it created. Everything else is shown, not written: "Email says confirmed -
// Confirm?", an amount for a sheet / user row's empty amount, and a note when the email and the month disagree. A
// month someone archived is never recreated. threads: linked rows the caller may see in full (own or shared), with
// deal_stage, deal_month, deal_amount_usd, last_at. periods: every row for the brand, archived ones included.
const CREATES = new Set(['discussing', 'scheduling', 'confirmed']);
export function threadSuggestions(periods, threads) {
  const out = { create: [], fill: [], confirm: [], use_amount: [], notes: [] };
  const newest = [...threads].filter(t => t.deal_month && t.deal_stage).sort((a, b) => String(b.last_at || '').localeCompare(String(a.last_at || '')));
  const seen = new Set();
  for (const t of newest) {
    if (seen.has(t.deal_month)) continue;
    seen.add(t.deal_month);
    const amount = t.deal_amount_usd == null ? null : Number(t.deal_amount_usd);
    const row = periods.find(p => p.kind === 'monthly' && p.period === t.deal_month);
    const by = { thread_id: t.id, month: t.deal_month };
    if (!row) { if (CREATES.has(t.deal_stage)) { out.create.push({ ...by, amount_usd: amount }); if (t.deal_stage === 'confirmed') out.confirm.push({ ...by, period_id: null }); } continue; }
    if (row.archived_at) continue;
    const st = stateOf(row);
    if (t.deal_stage === 'confirmed' && st !== 'confirmed') out.confirm.push({ ...by, period_id: row.id });
    if (t.deal_stage === 'declined' && st !== 'declined') out.notes.push({ ...by, period_id: row.id, words: `Email reads declined - the month says ${STATE_WORDS[st].toLowerCase()}` });
    if (amount != null && row.amount_usd == null) (row.source === 'email' ? out.fill : out.use_amount).push({ ...by, period_id: row.id, amount_usd: amount });
    else if (amount != null && Number(row.amount_usd) !== amount) out.notes.push({ ...by, period_id: row.id, words: `Email says $${amount} - the month says $${Number(row.amount_usd)}` });
  }
  return out;
}

// After any month write: the brand's relationship from its live months (S2), with one Activity row when it moves.
export async function syncRelationship(supabase, { businessId, brand, actorUserId = null, actorKind = 'user', now = new Date() }) {
  const periods = await livePeriods(supabase, businessId, 'id, brand_id, period, kind, state');
  const patch = relationshipPatch(brand, periods.filter(p => p.brand_id === brand.id));
  if (!patch) return null;
  const { error } = await supabase.from('hk_brands').update({ ...patch, updated_at: now.toISOString() }).eq('id', brand.id).eq('business_id', businessId);
  if (error) throw new Error(error.message);
  const changed = Object.keys(patch);
  await logEvent(supabase, { businessId, actorUserId, actorKind, entityType: 'brand', entityId: brand.id, action: 'brand.relationship', detail: { changed, prev: Object.fromEntries(changed.map(k => [k, brand[k] ?? null])), reason: 'from its sponsor months' } });
  return patch;
}

// Ruling 3 writes: the months an email may create (In discussion, source 'email') and the empty amounts it may fill on
// its own rows. Threads of a member who doesn't share their deal status never write. 0 Claude, 0 Gmail.
export async function applyThreadFacts(supabase, { businessId, brandId, now = new Date() }) {
  const [p, t, prefs] = await Promise.all([
    supabase.from('hk_sponsor_periods').select('*').eq('business_id', businessId).eq('brand_id', brandId),
    supabase.from('hk_brand_threads').select('id, member_user_id, deal_stage, deal_month, deal_amount_usd, last_at').eq('business_id', businessId).eq('brand_id', brandId).eq('link_state', 'linked'),
    supabase.from('hk_member_prefs').select('user_id, share_deal_status').eq('business_id', businessId)]);
  for (const r of [p, t, prefs]) if (r.error) throw new Error(r.error.message);
  const hidden = new Set((prefs.data || []).filter(x => x.share_deal_status === false).map(x => x.user_id));
  const s = threadSuggestions(p.data || [], (t.data || []).filter(x => !hidden.has(x.member_user_id)));
  const at = now.toISOString();
  for (const c of s.create) {
    const { error } = await supabase.from('hk_sponsor_periods').insert({ business_id: businessId, brand_id: brandId, period: c.month, kind: 'monthly', state: 'discussing', source: 'email', amount_usd: c.amount_usd, note: 'From email', state_changed_at: at });
    if (error) throw new Error(error.message);
    await logEvent(supabase, { businessId, actorKind: 'system', entityType: 'brand', entityId: brandId, action: 'sponsor.period_by_email', detail: { period: c.month, state: 'discussing', amount_usd: c.amount_usd } });
  }
  for (const f of s.fill) {
    const { error } = await supabase.from('hk_sponsor_periods').update({ amount_usd: f.amount_usd }).eq('id', f.period_id).is('amount_usd', null);
    if (error) throw new Error(error.message);
    await logEvent(supabase, { businessId, actorKind: 'system', entityType: 'brand', entityId: brandId, action: 'sponsor.amount_by_email', detail: { period: f.month, amount_usd: f.amount_usd } });
  }
  return { created: s.create.length, filled: s.fill.length };
}

// The Brand page Deal card's data: stage, live months newest first, and the suggestions the caller may see.
export async function brandDeal(supabase, { businessId, brand, meId, now = new Date() }) {
  const [p, t, prefs] = await Promise.all([
    supabase.from('hk_sponsor_periods').select('*').eq('business_id', businessId).eq('brand_id', brand.id),
    supabase.from('hk_brand_threads').select('id, member_user_id, deal_stage, deal_month, deal_amount_usd, last_at').eq('business_id', businessId).eq('brand_id', brand.id).eq('link_state', 'linked'),
    supabase.from('hk_member_prefs').select('user_id, share_deal_status').eq('business_id', businessId)]);
  for (const r of [p, t, prefs]) if (r.error) throw new Error(r.error.message);
  const hidden = new Set((prefs.data || []).filter(x => x.share_deal_status === false && x.user_id !== meId).map(x => x.user_id));
  const all = p.data || [], live = all.filter(x => !x.archived_at);
  const s = threadSuggestions(all, (t.data || []).filter(x => !hidden.has(x.member_user_id)));
  return { stage: dealStageOf(brand, live, chicagoMonth(now)), months: live.sort((a, b) => b.period.localeCompare(a.period)), suggestions: { confirm: s.confirm.filter(x => x.period_id), use_amount: s.use_amount, notes: s.notes } };
}

// S7 - the Inbox thread status line, server-side (the sender's address never reaches the browser; another member's
// outreach shows who + date only - the warm-check rule). ctx: { byId, periodsBy, reachedBy (brand id -> { member_user_id,
// at }), firstName, meId, now }. Only a brand chip (tracked / matches) or an untracked sender gets a line.
export function statusLine(chip, ctx) {
  if (chip.kind === 'untracked') return { kind: 'new', line: 'New · not in Grow' };
  const b = (chip.kind === 'tracked' || chip.kind === 'matches') && chip.brand_id ? ctx.byId[chip.brand_id] : null;
  if (!b) return null;
  const thisMonth = chicagoMonth(ctx.now), ps = ctx.periodsBy[b.id] || [];
  const stage = dealStageOf(b, ps, thisMonth);
  const owner = b.owner_user_id === ctx.meId ? 'Yours' : b.owner_user_id ? `${ctx.firstName(b.owner_user_id) || 'Another founder'}'s` : b.owner_hint && String(b.owner_hint).trim() ? `Sheet: ${String(b.owner_hint).trim().replace(/^./, c => c.toUpperCase())}` : 'Unclaimed';
  const next = ps.filter(p => p.kind === 'monthly' && p.period >= thisMonth && stateOf(p) !== 'declined').sort((a, z) => a.period.localeCompare(z.period))[0];
  const open_month = next ? { period: next.period, state: stateOf(next), words: `${monthWords(next.period).split(' ')[0]}: ${STATE_WORDS[stateOf(next)].toLowerCase()}` } : null;
  const r = ctx.reachedBy[b.id];
  const days = r ? Math.max(0, Math.floor((ctx.now.getTime() - Date.parse(r.at)) / 864e5)) : null;
  const reached = r ? { mine: r.member_user_id === ctx.meId, first_name: r.member_user_id === ctx.meId ? null : ctx.firstName(r.member_user_id) || 'A teammate', at: r.at, days,
    line: r.member_user_id === ctx.meId ? `You emailed them ${days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`}` : `${ctx.firstName(r.member_user_id) || 'A teammate'} emailed them ${new Date(r.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })}` } : null;
  return { kind: 'saved', brand_id: b.id, brand_name: b.name, deal_stage: stage, owner_words: owner, open_month, reached, has_instagram: !!b.instagram_handle, instagram_handle: b.instagram_handle || null,
    line: [b.name, DEAL_STAGE_WORDS[stage], owner, open_month?.words].filter(Boolean).join(' · ') };
}
// The newest outreach per brand from sent touches and linked threads (our last message), any member.
export function reachedByBrand(touches, threads) {
  const by = {};
  const put = (brandId, uid, at) => { if (brandId && at && (!by[brandId] || at > by[brandId].at)) by[brandId] = { member_user_id: uid, at }; };
  for (const t of touches) if (t.state === 'sent') put(t.brand_id, t.sender_user_id, t.sent_at);
  for (const t of threads) put(t.brand_id, t.member_user_id, t.last_ours_at);
  return by;
}
