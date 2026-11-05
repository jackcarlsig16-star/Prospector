import { addDays, laMonday } from './goalsShared.js';
import { laDateString } from './laDate.js';
import { humanShare } from './scorecardMath.js';
import { COHORT_COLORS } from '../../src/constants/cohortColors.js';
import { LAYERS, LAYER_IDS, BAND, HOME_LAYERS, SPLITS as SPLIT_LIST, BY as BY_LIST } from '../../src/constants/explorerLayers.js';

// dashboard-v3 Stage 3 (A1, A3, E) - the Explorer's one read, pure: layers over LA days or LA Monday weeks, split by
// team / person / mailbox / sequence / cohort, every rate computed here from the counts so Pulse, Explorer and
// Scorecard agree to the digit. Sources (A9): sent / delivered / bounces / spam / replies = sales_email_daily_counts by
// send date; human opens = Apollo opens × the human share of the tracked opens in that bucket (A4, scorecardMath's one
// rule); visitors = companies seen by the daily pulls (a bucket without a pull is null, never 0; no split - team-wide);
// meetings = Outlook events with ≥ 1 external domain by the day they were booked (A5; one per iCalUId per calendar);
// first-touched = people whose first touch falls in the bucket (partnerMetrics' merge). A rate with no denominator = null.
export { LAYERS, LAYER_IDS, BAND, HOME_LAYERS };
export const SPLITS = SPLIT_LIST.map(([id]) => id);
export const BY = BY_LIST.map(([id]) => id);
export const WEEKS_BACK = 8;
export const MAX_DAYS = 400;
// Mailbox / sequence splits: a stable hash onto this ramp (the cohort hues plus three more of the same family), so a
// sequence keeps its color from one read to the next and the legend carries the name.
export const RAMP = ['#6C9BD2', '#E07A5F', '#5FB3A8', '#D4B26A', '#B39DDB', '#8C8FD1', '#D98CB3', '#7FB069', '#C0A080', '#6FB1C9'];
export function stableColor(key, ramp = RAMP) {
  let h = 5381;
  for (const ch of String(key)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return ramp[h % ramp.length];
}

export const defaultRange = today => ({ from: addDays(laMonday(today), -7 * WEEKS_BACK), to: today });
export const laDayOf = iso => laDateString(new Date(iso));
export function bucketsOf(by, from, to) {
  const out = [];
  if (by === 'day') for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  else for (let w = laMonday(from); w <= to; w = addDays(w, 7)) out.push(w);
  return out;
}
const bucketOf = (by, day) => (by === 'day' ? day : laMonday(day));
const rate = (n, d) => (d ? n / d : null);

// Which split applies to a layer: email layers split every way; meetings and first-touched by person; visitors never.
const splitFor = (layer, split) => {
  const g = LAYERS[layer].group;
  if (split === 'team') return 'team';
  if (g === 'email') return split;
  if (split === 'person' && (g === 'calendar' || g === 'partners')) return 'person';
  return 'team';
};

function sum(map, key, by, day, field, n) {
  if (!map.has(key)) map.set(key, new Map());
  const m = map.get(key);
  const b = bucketOf(by, day);
  if (!m.has(b)) m.set(b, {});
  m.get(b)[field] = (m.get(b)[field] || 0) + n;
}

// entities(ctx): the ordered list of split keys for a given split, with label + color.
function entityList(split, ctx) {
  if (split === 'person') return [...ctx.members.map(m => ({ key: m.user_id, label: m.first, color: m.color })), { key: 'unassigned', label: 'Unassigned', color: '#6B7480' }];
  if (split === 'mailbox') return ctx.mailboxes.map(m => ({ key: m.email, exposed: `mailbox:${m.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, label: m.label, color: stableColor(m.email) }));
  if (split === 'sequence') return ctx.sequences.map(s => ({ key: s.id, label: s.name, color: stableColor(s.id) }));
  if (split === 'cohort') return ctx.cohorts.map(c => ({ key: c, label: c, color: COHORT_COLORS[c] || COHORT_COLORS.Other }));
  return [{ key: 'team', label: 'Team', color: null }];
}

export function buildExplorer({ layers, by = 'week', split = 'team', from, to, today, counts = [], opens = [], deliveredAt = new Map(), events = [], visits = [], people = [], members = [], mailboxOwner = new Map(), mailboxes = [], sequences = [], firstPull = null }) {
  const buckets = bucketsOf(by, from, to);
  const seqById = new Map(sequences.map(s => [s.id, s]));
  const cohortOf = sid => seqById.get(sid)?.cohort || 'Other';
  const inRange = d => d >= from && d <= to;
  const ctx = {
    members, mailboxes,
    sequences: sequences.filter(s => counts.some(r => r.sequence_id === s.id)).sort((a, b) => a.name.localeCompare(b.name)),
    cohorts: [...new Set(counts.map(r => cohortOf(r.sequence_id)))].sort((a, b) => Object.keys(COHORT_COLORS).indexOf(a) - Object.keys(COHORT_COLORS).indexOf(b)),
  };
  const emailKey = (sp, mailbox, sequenceId) => (sp === 'person' ? mailboxOwner.get(mailbox) || 'unassigned' : sp === 'mailbox' ? mailbox : sp === 'sequence' ? sequenceId : sp === 'cohort' ? cohortOf(sequenceId) : 'team');

  // Email totals per (split key, bucket) - once per distinct split in use.
  const emailTotals = new Map(); // sp -> Map(key -> Map(bucket -> totals))
  const emailSplits = [...new Set(layers.filter(l => LAYERS[l].group === 'email').map(l => splitFor(l, split)))];
  for (const sp of emailSplits) {
    const map = new Map();
    for (const r of counts) {
      if (!inRange(r.day)) continue;
      const k = emailKey(sp, r.mailbox, r.sequence_id);
      for (const f of ['delivered', 'hard_bounced', 'spam_blocked', 'opened', 'replied']) sum(map, k, by, r.day, f, r[f] || 0);
    }
    if (layers.includes('human_open_rate')) {
      const grouped = new Map();
      for (const o of opens) {
        const d = laDayOf(o.occurred_at);
        if (!inRange(d)) continue;
        const gk = `${emailKey(sp, o.sender, o.sequence_id)}|${bucketOf(by, d)}`;
        if (!grouped.has(gk)) grouped.set(gk, []);
        grouped.get(gk).push(o);
      }
      for (const [gk, list] of grouped) {
        const [k, b] = gk.split('|');
        if (!map.has(k)) map.set(k, new Map());
        if (!map.get(k).has(b)) map.get(k).set(b, {});
        map.get(k).get(b).share = humanShare(list, deliveredAt);
      }
    }
    emailTotals.set(sp, map);
  }
  const emailValue = (layer, t) => {
    const sent = (t.delivered || 0) + (t.hard_bounced || 0) + (t.spam_blocked || 0);
    switch (layer) {
      case 'sent': return sent;
      case 'delivered_rate': return rate(t.delivered || 0, sent);
      case 'hard_bounce_rate': return rate(t.hard_bounced || 0, sent);
      case 'spam_rate': return rate(t.spam_blocked || 0, sent);
      case 'reply_rate': return rate(t.replied || 0, t.delivered || 0);
      case 'human_open_rate': { const r = rate(t.opened || 0, t.delivered || 0); return r == null || t.share == null ? null : r * t.share; }
      default: return null;
    }
  };

  // Meetings: booked day = created_at_graph else start_at; team = one per iCalUId across calendars; person = per calendar.
  const meetingMap = new Map();
  if (layers.includes('meetings')) {
    const sp = splitFor('meetings', split);
    const seen = new Set();
    for (const e of [...events].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))) {
      if (e.is_cancelled || !(e.external_domains || []).length) continue;
      const d = laDayOf(e.created_at_graph || e.start_at);
      if (!inRange(d)) continue;
      const key = sp === 'person' ? e.user_id || 'unassigned' : 'team';
      const dedupe = `${key}|${e.ical_uid || e.graph_id}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      sum(meetingMap, key, by, d, 'n', 1);
    }
  }
  const touchMap = new Map();
  if (layers.includes('first_touched')) {
    const sp = splitFor('first_touched', split);
    for (const p of people) {
      const d = laDayOf(p.first_touch_at);
      if (!inRange(d)) continue;
      sum(touchMap, sp === 'person' ? p.owner_user_id || 'unassigned' : 'team', by, d, 'n', 1);
    }
  }
  // Visitors: unique companies per bucket over the pulls in it; no pull = null.
  const visitBuckets = new Map();
  if (layers.includes('visitors')) {
    for (const v of visits) {
      if (!inRange(v.pulled_on)) continue;
      const b = bucketOf(by, v.pulled_on);
      if (!visitBuckets.has(b)) visitBuckets.set(b, new Set());
      visitBuckets.get(b).add(v.company_key);
    }
  }

  const series = [];
  for (const layer of layers) {
    const L = LAYERS[layer];
    const sp = splitFor(layer, split);
    const teamWide = split !== 'team' && sp === 'team';
    const ents = entityList(sp, ctx);
    for (const ent of ents) {
      let values;
      if (L.group === 'email') { const m = emailTotals.get(sp)?.get(ent.key); if (!m && ent.key !== 'team') continue; values = buckets.map(b => (m?.get(b) ? emailValue(layer, m.get(b)) : (L.kind === 'count' ? 0 : null))); }
      else if (layer === 'meetings') { const m = meetingMap.get(ent.key); if (!m && ent.key !== 'team' && ent.key !== 'unassigned') continue; values = buckets.map(b => m?.get(b)?.n || 0); if (ent.key === 'unassigned' && !m) continue; }
      else if (layer === 'first_touched') { const m = touchMap.get(ent.key); if (!m && ent.key !== 'team') continue; values = buckets.map(b => m?.get(b)?.n || 0); }
      else values = buckets.map(b => (visitBuckets.has(b) ? visitBuckets.get(b).size : null));
      series.push({
        layer, split_key: ent.exposed || ent.key, kind: L.kind,
        label: ent.key === 'team' ? (teamWide ? `${L.label} · team-wide` : L.label) : `${ent.label} · ${L.label}`,
        color: ent.color || L.color, values,
      });
    }
  }
  const notes = {};
  if (layers.includes('visitors') && firstPull && firstPull > from) notes.visitors = `from ${shortDate(firstPull)}`;
  if (layers.includes('meetings')) notes.meetings = 'Outlook';
  if (layers.includes('first_touched')) notes.first_touched = 'partners';
  const curKey = bucketOf(by, today);
  return {
    from, to, by, split, today, layers,
    labels: buckets.map(b => ({ key: b, label: shortDate(b), current: b === curKey })),
    series, notes, band: BAND,
  };
}
const shortDate = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
