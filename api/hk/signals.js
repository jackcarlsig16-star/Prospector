// grow-signals-v1 - one signal log (hk_signals) and a per-brand heat level. A signal is written once per source row
// (unique business_id + kind + ref_type + ref_id; a re-run is a no-op). Heat = the sum of a brand's live signals'
// points decayed with a 7-day half-life, floored at 0 - PROSPECT brands only; sponsor-kind signals are logged and shown
// under Sponsors but add 0 (Stage 0 ruling 1). Auto-replies write no signal at all (Stage 2 ruling). No Claude and no
// Gmail call anywhere in here: writers only read what other jobs already produced.
import { detailHasPii, selectAllPages, selectIn, chunks } from './hkShared.js';

export const POINTS = {
  reply_interest: 40, reply_pricing: 35, reply_referral: 30, reply_other: 15, reply_decline: -30,
  new_person_sender: 10, sender_is_candidate: 25, research_strong_fit: 20, research_possible: 8, warm_thread_found: 10,
  follow_up_due: 12, waiting_overdue: 6, meeting_set: 30, sponsor_renewal_due: 25, sponsor_lapsed: 15, targeted_by_user: 10,
};
export const SPONSOR_KINDS = new Set(['sponsor_renewal_due', 'sponsor_lapsed']);
export const HALF_LIFE_DAYS = 7, WAITING_DAYS = 7, RENEWAL_DAYS = 30, BACKFILL_DAYS = 30;
export const BANDS = [['hot', 40], ['warm', 20], ['cool', 5]];
const DAY = 864e5;

const REPLY_KIND = { interested: 'reply_interest', pricing: 'reply_pricing', referral: 'reply_referral', decline: 'reply_decline' };
const NON_HUMAN = new Set(['auto_reply']);
// null = no signal (an auto-reply). An unlabeled reply (label cap reached) is a person: reply_other.
export const replyKind = label => (NON_HUMAN.has(label) ? null : REPLY_KIND[label] || 'reply_other');
export const bandOf = heat => (BANDS.find(([, min]) => heat >= min) || ['cold'])[0];

export function heatOf(brand, signals, now = new Date()) {
  if (!brand || brand.relationship !== 'prospect') return 0;
  let h = 0;
  for (const s of signals) {
    if (s.dismissed_at || SPONSOR_KINDS.has(s.kind)) continue;
    const age = Math.max(0, (now.getTime() - Date.parse(s.occurred_at)) / DAY);
    h += s.points * Math.pow(0.5, age / HALF_LIFE_DAYS);
  }
  return Math.max(0, Math.round(h));
}

const LABEL = { reply_interest: 'replied: interested', reply_pricing: 'replied: pricing question', reply_referral: 'replied: referral', reply_other: 'replied', reply_decline: 'replied: not interested', new_person_sender: 'new person wrote in', sender_is_candidate: 'wrote in (a candidate brand)', research_strong_fit: 'research: strong fit', research_possible: 'research: possible fit', warm_thread_found: 'warm thread found', follow_up_due: 'follow-up due', waiting_overdue: 'no reply for over a week', meeting_set: 'meeting set', sponsor_renewal_due: 'sponsor renewal due', sponsor_lapsed: 'sponsor: no period this month', targeted_by_user: 'added to Targets' };
export const signalWords = kind => LABEL[kind] || kind;

// Insert-or-skip. Returns the row written, or null when that (kind, ref) already exists.
export async function writeSignal(supabase, s) {
  const row = { business_id: s.businessId, brand_id: s.brandId || null, domain: s.domain || null, kind: s.kind, points: POINTS[s.kind], occurred_at: s.occurredAt, source: s.source, ref_type: s.refType, ref_id: String(s.refId), detail: s.detail ? String(s.detail).slice(0, 200) : null, owner_user_id: s.ownerUserId || null };
  if (row.points == null) throw new Error(`unknown signal kind ${s.kind}`);
  if (row.detail && detailHasPii({ d: row.detail })) row.detail = null;
  const { data, error } = await supabase.from('hk_signals').insert(row).select().single();
  if (error) { if (error.code === '23505') return null; throw new Error(error.message); }
  return data;
}

// Heat for the given brands (or every live brand). Writes only rows whose heat or band changed. -> { brands, changed }
export async function recomputeHeat(supabase, businessId, { brandIds = null, now = new Date() } = {}) {
  const brands = brandIds
    ? await selectIn(() => supabase.from('hk_brands').select('id, relationship, heat, heat_band, archived_at').eq('business_id', businessId).order('id'), 'id', [...new Set(brandIds.filter(Boolean))])
    : await selectAllPages(() => supabase.from('hk_brands').select('id, relationship, heat, heat_band, archived_at').eq('business_id', businessId).is('archived_at', null).order('id'));
  if (!brands.length) return { brands: 0, changed: 0 };
  const since = new Date(now.getTime() - 20 * HALF_LIFE_DAYS * DAY).toISOString();
  const sigs = brandIds
    ? await selectIn(() => supabase.from('hk_signals').select('brand_id, kind, points, occurred_at, dismissed_at').eq('business_id', businessId).gte('occurred_at', since).order('id'), 'brand_id', brands.map(b => b.id))
    : await selectAllPages(() => supabase.from('hk_signals').select('brand_id, kind, points, occurred_at, dismissed_at').eq('business_id', businessId).gte('occurred_at', since).order('id'));
  const by = {};
  for (const s of sigs) if (s.brand_id) (by[s.brand_id] ||= []).push(s);
  let changed = 0;
  for (const group of chunks(brands, 50)) {
    await Promise.all(group.map(async b => {
      const heat = heatOf(b, by[b.id] || [], now), band = bandOf(heat);
      if (heat === b.heat && band === b.heat_band) return;
      const { error } = await supabase.from('hk_brands').update({ heat, heat_band: band, heat_at: now.toISOString() }).eq('id', b.id).eq('business_id', businessId);
      if (error) throw new Error(error.message);
      changed++;
    }));
  }
  return { brands: brands.length, changed };
}

// A sender's domain became a brand: its domain-only signals move onto it.
export async function moveDomainSignals(supabase, businessId, domain, brandId) {
  if (!domain) return 0;
  const { data, error } = await supabase.from('hk_signals').update({ brand_id: brandId }).eq('business_id', businessId).eq('domain', domain).is('brand_id', null).select('id');
  if (error) throw new Error(error.message);
  return (data || []).length;
}

// The daily-check / backfill set, from rows already in the DB. Pure. `since` bounds replies, research and meetings
// (the backfill window); follow-ups, overdue waits and sponsor gaps are as of `now`. sponsor_renewal_due needs
// hk_brands.deal_end (grow-brands-sheet REV2 S6) and stays dormant while that column is absent.
export function signalsFromRows({ businessId, brands = [], touches = [], replies = [], intel = [], periods = [], meetings = [], followups = [], now = new Date(), since = null }) {
  const out = [], live = brands.filter(b => !b.archived_at), byId = Object.fromEntries(live.map(b => [b.id, b]));
  const byDomain = Object.fromEntries(live.filter(b => b.domain).map(b => [b.domain, b]));
  const after = at => !since || String(at) >= since;
  const push = (kind, brand, o) => out.push({ businessId, kind, brandId: brand?.id || null, ownerUserId: brand?.owner_user_id || null, ...o });
  for (const r of replies) {
    const kind = replyKind(r.label), b = byId[r.brand_id];
    if (kind && b && after(r.received_at)) push(kind, b, { occurredAt: r.received_at, source: 'sync', refType: 'reply', refId: r.id, detail: `${b.name} ${signalWords(kind)}` });
  }
  for (const i of intel) {
    const fit = i.intel?.fit?.sponsor_fit, kind = fit === 'strong' ? 'research_strong_fit' : fit === 'possible' ? 'research_possible' : null;
    if (kind && after(i.researched_at)) { const b = byDomain[i.domain] || null; push(kind, b, { domain: b ? null : i.domain, occurredAt: i.researched_at, source: 'research', refType: 'domain_intel', refId: `${i.domain}:${i.researched_at}`, detail: `${b?.name || i.domain} ${signalWords(kind)}` }); }
  }
  for (const f of followups) { const b = byId[f.brand_id]; if (b) push('follow_up_due', b, { occurredAt: now.toISOString(), source: 'daily_check', refType: 'follow_up', refId: `${b.id}:${f.kind}`, detail: `${b.name}: ${f.kind} due` }); }
  const lastSent = {};
  for (const t of touches) if (t.state === 'sent' && t.channel === 'email' && t.sent_at && (!lastSent[t.brand_id] || t.sent_at > lastSent[t.brand_id].sent_at)) lastSent[t.brand_id] = t;
  for (const t of Object.values(lastSent)) {
    const b = byId[t.brand_id], over = new Date(Date.parse(t.sent_at) + WAITING_DAYS * DAY);
    if (!b || b.relationship !== 'prospect' || over > now || replies.some(r => r.brand_id === b.id && String(r.received_at) > t.sent_at)) continue;
    push('waiting_overdue', b, { occurredAt: over.toISOString(), source: 'daily_check', refType: 'touch', refId: t.id, detail: `${b.name}: ${signalWords('waiting_overdue')}` });
  }
  for (const e of meetings) { const b = byId[e.entity_id]; if (b && after(e.created_at)) push('meeting_set', b, { occurredAt: e.created_at, source: 'user', refType: 'event', refId: e.id, detail: `${b.name}: ${signalWords('meeting_set')}` }); }
  const month = now.toISOString().slice(0, 7);
  for (const s of live.filter(b => b.relationship === 'sponsor' || b.relationship === 'founding_partner')) {
    if ('deal_end' in s && s.deal_end && Date.parse(s.deal_end) - now.getTime() <= RENEWAL_DAYS * DAY && Date.parse(s.deal_end) >= now.getTime() - DAY) push('sponsor_renewal_due', s, { occurredAt: now.toISOString(), source: 'daily_check', refType: 'deal_end', refId: `${s.id}:${s.deal_end}`, detail: `${s.name}: ${signalWords('sponsor_renewal_due')}` });
    if (!periods.some(p => p.brand_id === s.id && p.kind === 'monthly' && p.period === month)) push('sponsor_lapsed', s, { occurredAt: now.toISOString(), source: 'daily_check', refType: 'sponsor_month', refId: `${s.id}:${month}`, detail: `${s.name}: ${signalWords('sponsor_lapsed')}` });
  }
  return out;
}

// Writes a set from signalsFromRows; -> { written, skipped, perKind }
export async function writeAll(supabase, sigs) {
  const perKind = {}; let written = 0, skipped = 0;
  for (const s of sigs) { const row = await writeSignal(supabase, s); if (row) { written++; perKind[s.kind] = (perKind[s.kind] || 0) + 1; } else skipped++; }
  return { written, skipped, perKind };
}

// The daily check's signal step: due follow-ups, overdue waits, sponsor gaps (replies are written by the sync, research
// by Analyze), then heat for every live brand so decay applies once a day.
const DAILY_KINDS = new Set(['follow_up_due', 'waiting_overdue', 'sponsor_renewal_due', 'sponsor_lapsed']);
export async function dailySignals(supabase, { businessId, brands, touches, replies, followups, now }) {
  const periods = await selectAllPages(() => supabase.from('hk_sponsor_periods').select('brand_id, period, kind').eq('business_id', businessId).order('id'));
  const sigs = signalsFromRows({ businessId, brands, touches, replies, periods, followups, now }).filter(s => DAILY_KINDS.has(s.kind));
  const out = await writeAll(supabase, sigs);
  const heat = await recomputeHeat(supabase, businessId, { now });
  return { ...out, heat_changed: heat.changed };
}

// A live writer's hook: write, then that brand's heat. Never fails the job it rides on (a sync, a link, a status edit).
export async function signalNow(supabase, s, now = new Date()) {
  try {
    const row = await writeSignal(supabase, s);
    if (row && s.brandId) await recomputeHeat(supabase, s.businessId, { brandIds: [s.brandId], now });
    return row;
  } catch (e) { console.error(`[hk/signals] ${s.kind}:`, e.message); return null; }
}

// Inbox list (G5): an inbound from a candidate brand's domain, once per thread; a new person sender (untracked, not
// bulk - chipFor already filtered bulk / team / self / ignored), once per domain. One read for what exists, then inserts.
export async function inboxListSignals(supabase, { businessId, rows, now = new Date() }) {
  try {
    const want = [];
    for (const r of rows) {
      if (r.chip?.kind === 'matches' && r.chip.status === 'candidate' && r.chip.brand_id) want.push({ businessId, kind: 'sender_is_candidate', brandId: r.chip.brand_id, occurredAt: r.date || now.toISOString(), source: 'inbox_open', refType: 'thread', refId: r.thread_id, detail: `${r.chip.brand_name || 'A candidate brand'} ${signalWords('sender_is_candidate')}` });
      else if (r.chip?.kind === 'untracked' && r.from_domain) want.push({ businessId, kind: 'new_person_sender', domain: r.from_domain, occurredAt: r.date || now.toISOString(), source: 'inbox_open', refType: 'domain', refId: r.from_domain, detail: `${r.from_domain}: ${signalWords('new_person_sender')}` });
    }
    const uniq = [...new Map(want.map(s => [`${s.kind}:${s.refId}`, s])).values()];
    if (!uniq.length) return 0;
    const have = new Set((await selectIn(() => supabase.from('hk_signals').select('kind, ref_id').eq('business_id', businessId).in('kind', ['sender_is_candidate', 'new_person_sender']).order('id'), 'ref_id', uniq.map(s => s.refId))).map(s => `${s.kind}:${s.ref_id}`));
    const fresh = uniq.filter(s => !have.has(`${s.kind}:${s.refId}`));
    for (const s of fresh) await writeSignal(supabase, s);
    const brandIds = fresh.map(s => s.brandId).filter(Boolean);
    if (brandIds.length) await recomputeHeat(supabase, businessId, { brandIds, now });
    return fresh.length;
  } catch (e) { console.error('[hk/signals] inbox list:', e.message); return 0; }
}
