import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { loadScoreRows } from './scoresRoutes.js';
import { pinState } from './pinState.js';

// top-targets-v1 T4 / T5 (rulings Q1, Q2, Q7) - GET goals/top-targets?owner=&limit=&band=&pinned= : one ranking for
// "who do we go after". Rows = the open scored companies (not closed, not won / pilot, not a duplicate). ORDER = the
// P1 pins first (newest pin first), then score. A pin held at P2 / P3 (a hand-set band from before the rename) is
// shown as a pin but ranks by its score - it holds the company at that band, it does not lift it. Every row carries
// the five grouped bars and ONE Why line assembled from the inputs already stored (no model, fixed order).
export const TOP_LIMIT = 50, TOP_LIMIT_MAX = 200;
const BANDS = ['P1', 'P2', 'P3', 'P4'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const md = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null);
const STAGE_SAID = new Set(['contacted', 'first_email_sent', 'in_sequence', 'responded', 'replied', 'meeting', 'meeting_set', 'nurture', 'proposal_pilot']);

export const sizeWord = e => (e == null ? null : e >= 5000 ? '5,000+ employees' : e >= 1000 ? '1,000–4,999 employees' : e >= 200 ? '200–999 employees' : 'under 200 employees');
// The source word the ruling names: Brad / the referring partner / inbound. Anything else says nothing.
export function sourceWord(row, partnerName = null) {
  const s = row.components?.source?.inputs || {};
  if (s.via_upside) return s.named ? 'Brad referral' : 'Upside list';
  if (s.kind === 'partner_referral') return partnerName ? `${partnerName} referral` : 'partner referral';
  if (s.kind === 'person_referral') return 'referral';
  if (s.kind === 'inbound') return 'inbound';
  return null;
}
// Fixed order (Q7): size band · visits this week · source word · stage + next date · pin reason.
export function whyLine(row, { partnerName = null, nextDate = null, pin = null } = {}) {
  const v = row.components?.visits?.inputs || {};
  const visits = !v.decayed && v.visits_7d > 0 ? `${v.visits_7d} visit${v.visits_7d === 1 ? '' : 's'} this week` : null;
  const stage = STAGE_SAID.has(row.stage) ? String(row.stage).replace(/_/g, ' ') : null;
  const next = nextDate ? `next ${md(nextDate)}` : null;
  const stageLine = stage && next ? `${stage}, ${next}` : stage || next;
  const pinLine = pin ? (pin.held ? `held at P${pin.level}` : 'pinned') + (pin.reason ? `: ${pin.reason}` : '') : null;
  return [sizeWord(row.employees), visits, sourceWord(row, partnerName), stageLine, pinLine].filter(Boolean).join(' · ') || 'no signal yet';
}

export const pinFirst = (a, b) => {
  const pa = a.pin && !a.pin.held ? 1 : 0, pb = b.pin && !b.pin.held ? 1 : 0;
  if (pa !== pb) return pb - pa;
  if (pa && pb) return String(b.pin.at || '').localeCompare(String(a.pin.at || '')) || b.score - a.score || String(a.name).localeCompare(String(b.name));
  return b.score - a.score || String(a.name).localeCompare(String(b.name));
};

export function parseTopQuery(q = {}, meId = null) {
  const owner = q.owner === 'me' ? meId : q.owner === 'unassigned' ? 'unassigned' : UUID.test(q.owner || '') ? q.owner : null;
  const limit = Math.min(TOP_LIMIT_MAX, Math.max(1, Number.parseInt(q.limit, 10) || TOP_LIMIT));
  return { owner, limit, band: BANDS.includes(q.band) ? q.band : null, pinned: q.pinned === 'true' || q.pinned === '1' };
}

// -> { rows, n (shown), total (after the filters), book (every open company), pinned (in the owner's set), filters, computed_at }
export async function topTargets(supabase, businessId, query = {}, { now = Date.now(), meId = null } = {}) {
  const f = parseTopQuery(query, meId);
  const cols = 'id, pinned_until, pin_reason, pinned_by, pinned_at';
  const all = (t, c, build = x => x) => selectAllPages(() => build(supabase.from(t).select(c).eq('business_id', businessId)).order('id'));
  const [{ rows: scored, computedAt }, partners, employers, targets] = await Promise.all([
    loadScoreRows(supabase, businessId, { now }),
    all('sales_goals', `${cols}, name, priority, priority_set_at, next_meeting_at`, x => x.eq('goal_type', 'partnership')),
    all('sales_opportunities', `${cols}, priority, priority_set_at, next_action_date`),
    all('sales_targets', cols),
  ]);
  const rec = new Map([...partners.map(r => [`partner:${r.id}`, r]), ...employers.map(r => [`employer:${r.id}`, r]), ...targets.map(r => [`target:${r.id}`, r])]);
  const partnerName = new Map(partners.map(p => [p.id, p.name]));
  const open = scored.filter(r => !r.closed && !r.live && !r.duplicate_of).map(r => {
    const row = rec.get(`${r.type}:${r.id}`) || null;
    const pin = row ? pinState(row, now) : null;
    const nextDate = [row?.next_meeting_at, row?.next_action_date].find(d => d && String(d).slice(0, 10) >= new Date(now).toISOString().slice(0, 10)) || null;
    return {
      type: r.type, id: r.id, key: r.key, name: r.name, stage: r.stage, owner_user_id: r.owner_user_id, owner: r.owner, employees: r.employees,
      score: r.score, band: r.band, groups: r.groups, pin, next_date: nextDate, trend: r.trend,
      why: whyLine(r, { partnerName: partnerName.get(r.source_partner_id) || null, nextDate, pin }),
    };
  });
  const mine = open.filter(r => (f.owner === 'unassigned' ? !r.owner_user_id : f.owner ? r.owner_user_id === f.owner : true));
  const filtered = mine.filter(r => (!f.band || r.band === f.band) && (!f.pinned || !!r.pin)).sort(pinFirst);
  const rows = filtered.slice(0, f.limit).map((r, i) => ({ ...r, rank: i + 1 }));
  return { status: 200, body: { rows, n: rows.length, total: filtered.length, book: open.length, pinned: mine.filter(r => r.pin).length, filters: f, computed_at: computedAt } };
}

// GET goals/top-targets (Viewer+; names of companies only - never a person's address or phone)
export async function topTargetsRoute(req, res) {
  try {
    const r = await topTargets(getSupabase(), req.params.businessId, req.query, { meId: req.auth?.user?.id || null });
    res.status(r.status).json(r.body);
  } catch (e) { console.error('[goals/top-targets]', e.message); res.status(e.status || 500).json({ error: e.message }); }
}
