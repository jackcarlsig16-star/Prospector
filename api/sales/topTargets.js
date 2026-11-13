import { getSupabase } from './goalsShared.js';
import { selectAllPages } from '../lib/selectAllPages.js';
import { loadScoreRows } from './scoresRoutes.js';
import { pinState, isPinned } from './pinState.js';
import { cleanText } from './scrubText.js';
import { COMPONENTS } from './intentScore.js';
import { openFlagRows } from './huddleFlags.js';
import { boardStage } from '../../src/constants/pipelineBoard.js';

// top-targets-v1 T4 / T5 (rulings Q1, Q2, Q7) - GET goals/top-targets?owner=&limit=&band=&pinned= : one ranking for
// "who do we go after". Rows = the open scored companies (not closed, not won / pilot, not a duplicate). ORDER = the
// P1 pins first (newest pin first), then score. A pin held at P2 / P3 (a hand-set band from before the rename) is
// shown as a pin but ranks by its score - it holds the company at that band, it does not lift it. Every row carries
// the five grouped bars and ONE Why line assembled from the inputs already stored (no model, fixed order).
export const TOP_LIMIT = 50, TOP_LIMIT_MAX = 1000;
export const SIZE_IDS = ['5000', '1000', '200', 'small', 'unknown'];
export const sizeId = e => (e == null ? 'unknown' : e >= 5000 ? '5000' : e >= 1000 ? '1000' : e >= 200 ? '200' : 'small');
const SIZE_SHORT = { 5000: '5,000+', 1000: '1,000–4,999', 200: '200–999', small: 'under 200', unknown: 'size unknown' };
const LINK_TYPE = { partner: 'partner', employer: 'opportunity', target: 'target' };
const STAGE_FIELD = { partner: 'pipeline_status', employer: 'stage', target: 'status' };
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

// S2: the page's rendering of the same inputs - it stops at the stage (the pin reason sits under the score, the next
// date in Next). Always opens with the size ("size unknown") and says "no visits this week".
export function whyShort(row, { partnerName = null, stageLabel = null } = {}) {
  const v = row.components?.visits?.inputs || {};
  const n = !v.decayed && v.visits_7d > 0 ? v.visits_7d : 0;
  return [SIZE_SHORT[sizeId(row.employees)], n ? `${n} visit${n === 1 ? '' : 's'} this week` : 'no visits this week', sourceWord(row, partnerName), stageLabel].filter(Boolean).join(' · ');
}

// The open to-do a row shows in Next: the earliest due first, an undated one after every dated one.
export function nextTodos(todos) {
  const out = new Map();
  for (const t of openFlagRows(todos)) {
    const key = `${t.link_type}:${t.link_id}`, cur = out.get(key);
    if (!cur || (t.due_date || '9999') < (cur.due_date || '9999')) out.set(key, t);
  }
  return out;
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
  return { owner, limit, band: BANDS.includes(q.band) ? q.band : null, pinned: q.pinned === 'true' || q.pinned === '1', size: SIZE_IDS.includes(q.size) ? q.size : null, q: String(q.q || '').trim().toLowerCase().slice(0, 80) };
}

// -> { rows, n (shown), total (after the filters), scope (the owner's set), book (every open company), pinned (in the
//      owner's set), counts { owners { <user id> | unassigned: n }, bands { P1..P4: n in the owner's set } }, filters, computed_at }
export async function topTargets(supabase, businessId, query = {}, { now = Date.now(), meId = null } = {}) {
  const f = parseTopQuery(query, meId);
  const cols = 'id, pinned_until, pin_reason, pinned_by, pinned_at';
  const all = (t, c, build = x => x) => selectAllPages(() => build(supabase.from(t).select(c).eq('business_id', businessId)).order('id'));
  const [{ rows: scored, computedAt }, partners, employers, targets, todos] = await Promise.all([
    loadScoreRows(supabase, businessId, { now }),
    all('sales_goals', `${cols}, name, priority, priority_set_at, next_meeting_at`, x => x.eq('goal_type', 'partnership')),
    all('sales_opportunities', `${cols}, priority, priority_set_at, next_action_date`),
    all('sales_targets', cols),
    all('sales_week_goals', 'id, text, status, due_date, link_type, link_id, carried_from_id', x => x.eq('kind', 'todo').in('link_type', Object.values(LINK_TYPE))),
  ]);
  const next = nextTodos(todos);
  const rec = new Map([...partners.map(r => [`partner:${r.id}`, r]), ...employers.map(r => [`employer:${r.id}`, r]), ...targets.map(r => [`target:${r.id}`, r])]);
  const partnerName = new Map(partners.map(p => [p.id, p.name]));
  const open = scored.filter(r => !r.closed && !r.live && !r.duplicate_of).map(r => {
    const row = rec.get(`${r.type}:${r.id}`) || null;
    const pin = row ? pinState(row, now) : null;
    const nextDate = [row?.next_meeting_at, row?.next_action_date].find(d => d && String(d).slice(0, 10) >= new Date(now).toISOString().slice(0, 10)) || null;
    const todo = next.get(`${LINK_TYPE[r.type]}:${r.id}`) || null;
    const said = r.stage ? String(r.stage).replace(/_/g, ' ') : null;
    const stageLabel = boardStage(r.type, { [STAGE_FIELD[r.type]]: r.stage })?.stage_label || (said ? said[0].toUpperCase() + said.slice(1) : null);
    const from = partnerName.get(r.source_partner_id) || null;
    return {
      type: r.type, id: r.id, key: r.key, name: r.name, stage: r.stage, stage_label: stageLabel, owner_user_id: r.owner_user_id, owner: r.owner, employees: r.employees,
      score: r.score, band: r.band, groups: r.groups, parts: Object.fromEntries(COMPONENTS.map(k => [k, Number(r.components?.[k]?.points) || 0])),
      pin, pinned_until: row?.pinned_until || null, pin_expired: row?.pinned_until && !isPinned(row, now) ? { until: row.pinned_until, reason: row.pin_reason || null } : null,
      next_date: nextDate, next: todo ? { text: cleanText(todo.text, 120), due: todo.due_date || null } : null, trend: r.trend,
      why: { short: whyShort(r, { partnerName: from, stageLabel }), full: whyLine(r, { partnerName: from, nextDate, pin }) },
    };
  });
  const mine = open.filter(r => (f.owner === 'unassigned' ? !r.owner_user_id : f.owner ? r.owner_user_id === f.owner : true));
  const filtered = mine.filter(r => (!f.band || r.band === f.band) && (!f.pinned || !!r.pin) && (!f.size || sizeId(r.employees) === f.size) && (!f.q || String(r.name || '').toLowerCase().includes(f.q))).sort(pinFirst);
  const tally = (list, keyOf) => list.reduce((m, r) => { const k = keyOf(r); m[k] = (m[k] || 0) + 1; return m; }, {});
  const counts = { owners: tally(open, r => r.owner_user_id || 'unassigned'), bands: { P1: 0, P2: 0, P3: 0, P4: 0, ...tally(mine, r => r.band) } };
  const rows = filtered.slice(0, f.limit).map((r, i) => ({ ...r, rank: i + 1 }));
  return { status: 200, body: { rows, n: rows.length, total: filtered.length, scope: mine.length, book: open.length, pinned: mine.filter(r => r.pin).length, counts, filters: f, computed_at: computedAt } };
}

// GET goals/top-targets (Viewer+; names of companies only - never a person's address or phone)
export async function topTargetsRoute(req, res) {
  try {
    const r = await topTargets(getSupabase(), req.params.businessId, req.query, { meId: req.auth?.user?.id || null });
    res.status(r.status).json(r.body);
  } catch (e) { console.error('[goals/top-targets]', e.message); res.status(e.status || 500).json({ error: e.message }); }
}
