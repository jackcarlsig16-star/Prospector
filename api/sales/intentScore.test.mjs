import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_WEIGHTS, COMPONENTS, SOURCE_ORDER, scoreCompany, bandFor, bandRange, trendOf, dedupeCompanies, breakdownLines } from './intentScore.js';

const NOW = Date.parse('2026-10-27T20:00:00Z');
const ago = days => new Date(NOW - days * 864e5).toISOString();
const score = (inputs, weights) => scoreCompany(inputs, weights, { now: NOW });
const pts = (inputs, k, weights) => score(inputs, weights).components[k].points;
const hotVisit = { visits_7d: 100, unique_visitors_7d: 50, top_paths: [{ path: '/pricing' }], us_500: true, apollo_intent: 'high', intent_score: 100, last_visit: ago(1).slice(0, 10) };

test('missing inputs: only the structural penalties (unresearched -3, headcount unknown 4, never touched -10), never NaN, score 0, P4', () => {
  for (const inputs of [undefined, {}, { type: 'employer', visit: null, people: null, research: null, heat: null, override: null, source: null }]) {
    const r = score(inputs);
    assert.equal(r.score, 0);
    assert.equal(r.band, 'P4');
    for (const k of COMPONENTS) assert.equal(r.components[k].points, ({ research: -3, fit: 4, recency: -10 })[k] || 0, `${k} for ${JSON.stringify(inputs)}`);
    assert.deepEqual([r.closed, r.flagged_out, r.override, r.duplicate_of], [false, false, null, null]);
    assert.ok(COMPONENTS.every(k => Number.isFinite(r.components[k].points)));
  }
});

test('visits: log-scaled, capped at 25, 0 after the 14-day decay', () => {
  assert.equal(pts({ visit: hotVisit }, 'visits'), 25);
  assert.equal(pts({ visit: { visits_7d: 6, unique_visitors_7d: 3, last_visit: ago(2).slice(0, 10) } }, 'visits'), 17);
  assert.equal(pts({ visit: { visits_7d: 1, unique_visitors_7d: 1, pulled_on: ago(2).slice(0, 10) } }, 'visits'), 7);
  const old = score({ visit: { ...hotVisit, last_visit: ago(15).slice(0, 10) } });
  assert.equal(old.components.visits.points, 0);
  assert.equal(old.components.visits.inputs.decayed, true);
  assert.equal(pts({ visit: { visits_7d: 'x', unique_visitors_7d: null, last_visit: ago(1).slice(0, 10) } }, 'visits'), 0);
});

test('pages: product/pricing/employer pages 10, other pages 5, home only 2, user-only or maybe_user 0, cap 10', () => {
  const v = paths => ({ visits_7d: 1, last_visit: ago(1).slice(0, 10), top_paths: paths.map(p => ({ path: p })) });
  assert.equal(pts({ visit: v(['/', '/pricing']) }, 'pages'), 10);
  assert.equal(pts({ visit: v(['/', '/about']) }, 'pages'), 5);
  assert.equal(pts({ visit: v(['/']) }, 'pages'), 2);
  assert.equal(pts({ visit: v(['/auth/login', '/help']) }, 'pages'), 0);
  assert.equal(pts({ visit: { ...v(['/pricing']), maybe_user: true } }, 'pages'), 0);
  assert.equal(pts({ visit: v([]) }, 'pages'), 0);
});

test('apollo_intent: intent_score / 20 capped at 5, else high 5 / medium 3 / low 1', () => {
  assert.equal(pts({ visit: hotVisit }, 'apollo_intent'), 5);
  assert.equal(pts({ visit: { intent_score: 20 } }, 'apollo_intent'), 1);
  assert.equal(pts({ visit: { apollo_intent: 'High' } }, 'apollo_intent'), 5);
  assert.equal(pts({ visit: { apollo_intent: 'medium' } }, 'apollo_intent'), 3);
  assert.equal(pts({ visit: { apollo_intent: 'low' } }, 'apollo_intent'), 1);
  assert.equal(pts({ visit: { apollo_intent: 'none' } }, 'apollo_intent'), 0);
});

test('people: buyer title 6, other 2, cap 15; titles only in the inputs', () => {
  assert.equal(pts({ people: [{ title: 'VP People', is_buyer: true }, { title: 'Engineer' }, { title: 'Designer' }] }, 'people'), 10);
  const r = score({ people: [{ title: 'CHRO', is_buyer: true }, { title: 'VP People', is_buyer: true }, { title: 'Benefits Director', is_buyer: true }] });
  assert.equal(r.components.people.points, 15);
  assert.deepEqual(r.components.people.inputs, { people: 3, buyers: 3, titles: ['CHRO', 'VP People', 'Benefits Director'] });
});

test('fit: US 500+ 15, 200-499 8, under 200 0, unknown headcount 4, partner by category 10 / 5, skip list 0', () => {
  assert.equal(pts({ type: 'employer', employees: 5000 }, 'fit'), 15);
  assert.equal(pts({ type: 'target', visit: { us_500: true } }, 'fit'), 15);
  assert.equal(pts({ type: 'employer', employees: 300 }, 'fit'), 8);
  assert.equal(pts({ type: 'employer', employees: 50 }, 'fit'), 0);
  assert.equal(pts({ type: 'employer' }, 'fit'), 4);
  assert.equal(pts({ type: 'partner', category: 'relocation' }, 'fit'), 10);
  assert.equal(pts({ type: 'partner' }, 'fit'), 5);
  assert.equal(pts({ type: 'employer', employees: 5000, on_skip_list: true }, 'fit'), 0);
});

test('research: fresh findings +4/+3/+3 (cap 10), competing housing perk -10, watch-out -5 (floor -10); unresearched -3; > 60 d decays to -3', () => {
  const full = { created_at: ago(5), result: { why_homelover: 'x', first_angle: 'y', titles: 'z', housing_perk: 'no housing perk found' } };
  assert.equal(pts({ research: full }, 'research'), 10);
  assert.equal(pts({ research: { ...full, result: { ...full.result, housing_perk: 'Offers a $5k relocation stipend' } } }, 'research'), 0);
  assert.equal(pts({ research: { created_at: ago(5), result: { housing_perk: 'rent subsidy', watch_outs: 'Being acquired by X' } } }, 'research'), -10);
  assert.equal(pts({ research: null }, 'research'), -3);
  const decayed = score({ research: { ...full, created_at: ago(61) } });
  assert.equal(decayed.components.research.points, -3);
  assert.deepEqual([decayed.components.research.inputs.researched, decayed.components.research.inputs.decayed], [true, true]);
  assert.equal(pts({ research: { ...full, created_at: ago(60) } }, 'research'), 10);
});

test('source: Upside list 6, Brad-named 12, other partner referral 12, inbound 12, campaign reply 10 / sent 4, website 6, outreach 3, scout 4, person referral 10, unknown 0', () => {
  const s = (source, extra = {}) => score({ source, ...extra }).components.source;
  assert.equal(s({ kind: 'partner_referral', via_upside: true }).points, 6);
  assert.equal(s({ kind: 'partner_referral', via_upside: true, named: true }).points, 12);
  assert.equal(s({ kind: 'partner_referral' }, { owner_team: 'both' }).points, 6, 'owner_team upside/both counts as via Upside');
  assert.equal(s({ kind: 'partner_referral' }).points, 12);
  assert.equal(s({ kind: 'inbound' }).points, 12);
  assert.equal(s({ kind: 'campaign', campaign_replied: true }).points, 10);
  assert.equal(s({ kind: 'campaign' }, { heat: { replied: true } }).points, 10, 'a heat reply counts as a campaign reply');
  assert.equal(s({ kind: 'campaign' }).points, 4);
  assert.equal(s({ kind: 'website' }).points, 6);
  assert.equal(s({ kind: 'homelover_outreach' }).points, 3);
  assert.equal(s({ kind: 'scout' }).points, 4);
  assert.equal(s({ kind: 'person_referral' }).points, 10);
  assert.equal(s({ kind: 'unknown' }).points, 0);
  assert.equal(s({ kind: 'something_else' }).inputs.label, 'other');
  assert.equal(score({ source: { kind: 'partner_referral', via_upside: true, named: true } }).source_label, 'upside');
  assert.ok(SOURCE_ORDER.includes('upside') && SOURCE_ORDER[0] === 'upside' && SOURCE_ORDER.at(-1) === 'other');
});

test('engagement: replied 10, clicked 6, opened 3, none 0', () => {
  assert.equal(pts({ heat: { replied: true, clicks: 0, opens: 0 } }, 'engagement'), 10);
  assert.equal(pts({ heat: { replied: false, clicks: 2, opens: 5 } }, 'engagement'), 6);
  assert.equal(pts({ heat: { replied: false, clicks: 0, opens: 1 } }, 'engagement'), 3);
  assert.equal(pts({ heat: { replied: false, clicks: 0, opens: 0 } }, 'engagement'), 0);
});

test('stage: meeting 8, replied / responded 4, contacted 2, first touch 0; a lost / paused stage scores 0', () => {
  assert.equal(pts({ stage: 'meeting_set' }, 'stage'), 8);
  assert.equal(pts({ stage: 'responded' }, 'stage'), 4);
  assert.equal(pts({ stage: 'contacted' }, 'stage'), 2);
  assert.equal(pts({ stage: 'target' }, 'stage'), 0);
  assert.equal(pts({ stage: 'paused' }, 'stage'), 0);
});

test('recency: touch or visit within 30 d 0, within 60 d -5, older or never -10; a visit counts as a touch', () => {
  assert.equal(pts({ last_touch_at: ago(10) }, 'recency'), 0);
  assert.equal(pts({ last_touch_at: ago(45) }, 'recency'), -5);
  assert.equal(pts({ last_touch_at: ago(90) }, 'recency'), -10);
  assert.equal(pts({}, 'recency'), -10);
  assert.equal(pts({ last_touch_at: ago(90), visit: { last_visit: ago(3).slice(0, 10) } }, 'recency'), 0);
});

test('closed: lost / rejected / on_hold forces the score to 10 or less with closed_reason = the stage', () => {
  const r = score({ type: 'employer', stage: 'on_hold', visit: hotVisit, source: { kind: 'inbound' }, research: { created_at: ago(1), result: { why_homelover: 'x' } } });
  assert.ok(r.score <= 10, `score ${r.score}`);
  assert.deepEqual([r.closed, r.closed_reason, r.band, r.flagged_out], [true, 'on_hold', 'P4', false]);
});

test('Not a fit (visitPriority override) forces the score to 10 or less and ignores any hand-set P', () => {
  const r = score({ type: 'target', visit: hotVisit, source: { kind: 'inbound' }, override: { priority: 1, not_a_fit: true, set_at: ago(1) } });
  assert.ok(r.score <= 10);
  assert.deepEqual([r.closed, r.closed_reason, r.override], [true, 'not_a_fit', null]);
});

test('hand-set P: a floor / ceiling for 30 days (P1 lifts to 60, P4 caps at 14), expired after 30 d, the scored value kept', () => {
  const quiet = { type: 'employer', last_touch_at: ago(1), source: { kind: 'website' } };
  const p1 = score({ ...quiet, override: { priority: 1, not_a_fit: false, set_at: ago(29) } });
  assert.deepEqual([p1.score, p1.band, p1.override.priority, p1.override.scored], [60, 'P1', 1, 7]);
  assert.equal(p1.override.expires_at, new Date(Date.parse(ago(29)) + 30 * 864e5).toISOString());
  const p4 = score({ type: 'employer', visit: hotVisit, source: { kind: 'inbound' }, override: { priority: 4, not_a_fit: false, set_at: ago(1) } });
  assert.deepEqual([p4.score, p4.band], [14, 'P4']);
  const expired = score({ ...quiet, override: { priority: 1, not_a_fit: false, set_at: ago(31) } });
  assert.deepEqual([expired.score, expired.override], [7, null]);
  assert.equal(score({ ...quiet, override: { priority: null, not_a_fit: false, set_at: ago(1) } }).override, null);
  assert.equal(score({ ...quiet, override: { priority: 1, not_a_fit: false, set_at: 'garbage' } }).override, null, 'unparseable set_at = no override');
});

test('flagged out: closed-won (launched / live / contract / verbal) and pilot keep their score but leave the ranking', () => {
  for (const [stage, reason] of [['live', 'closed_won'], ['verbal', 'closed_won'], ['proposal_pilot', 'pilot']]) {
    const r = score({ type: 'partner', stage, category: 'c', source: { kind: 'inbound' }, last_touch_at: ago(1) });
    assert.deepEqual([r.flagged_out, r.flag_reason, r.closed], [true, reason, false], stage);
    assert.ok(r.score > 10);
  }
  assert.equal(score({ stage: 'meeting_set' }).flagged_out, false);
});

test('bands: P1 >= 60, P2 >= 40, P3 >= 15, else P4; bandRange is the inverse; a custom thresholds row is honored', () => {
  assert.deepEqual([bandFor(60), bandFor(59), bandFor(40), bandFor(39), bandFor(15), bandFor(14), bandFor(0)], ['P1', 'P2', 'P2', 'P3', 'P3', 'P4', 'P4']);
  assert.deepEqual([bandRange('P1'), bandRange('P2'), bandRange('P3'), bandRange('P4')], [[60, 100], [40, 59], [15, 39], [0, 14]]);
  const hk = { ...DEFAULT_WEIGHTS, thresholds: { P1: 80, P2: 50, P3: 20 } };
  assert.equal(bandFor(70, hk.thresholds), 'P2');
  assert.equal(score({ type: 'employer', visit: hotVisit, source: { kind: 'inbound' }, people: [{ is_buyer: true }, { is_buyer: true }, { is_buyer: true }] }, hk).band, 'P2');
});

test('everything maxed clamps at 100 and lands P1; a confirmed-weights ceiling is 110 before the clamp (stage tops out at meeting 8)', () => {
  const r = score({
    type: 'employer', stage: 'meeting_set', employees: 5000, last_touch_at: ago(1), visit: hotVisit,
    source: { kind: 'partner_referral', via_upside: true, named: true }, heat: { replied: true },
    people: [{ is_buyer: true }, { is_buyer: true }, { is_buyer: true }],
    research: { created_at: ago(1), result: { why_homelover: 'a', first_angle: 'b', titles: 'c', housing_perk: 'no housing perk found' } },
  });
  assert.equal(COMPONENTS.reduce((s, k) => s + r.components[k].points, 0), 110);
  assert.deepEqual([r.score, r.band, r.upside_owned], [100, 'P1', false]);
  assert.equal(score({ owner_team: 'upside' }).upside_owned, true);
});

test('custom weights: a different caps / points row changes the points without touching the defaults', () => {
  const w = { ...DEFAULT_WEIGHTS, caps: { ...DEFAULT_WEIGHTS.caps, source: 30 }, source: { ...DEFAULT_WEIGHTS.source, inbound: 25 } };
  assert.equal(pts({ source: { kind: 'inbound' } }, 'source', w), 25);
  assert.equal(pts({ source: { kind: 'inbound' } }, 'source'), 12);
  assert.equal(DEFAULT_WEIGHTS.source.inbound, 12);
});

test('dedupeCompanies: an employer and a target with the same normalized name -> the target is duplicate_of employer:<id>; partners and unmatched targets untouched', () => {
  const rows = [
    { type: 'employer', id: 'e1', name: 'IXL Learning, Inc.' },
    { type: 'target', id: 't1', name: 'IXL Learning' },
    { type: 'target', id: 't2', name: 'City of Minneapolis' },
    { type: 'partner', id: 'p1', name: 'IXL Learning' },
    { type: 'employer', id: 'e2', name: 'City of Minneapolis' },
  ];
  const out = dedupeCompanies(rows);
  assert.deepEqual(out.map(r => r.duplicate_of || null), [null, 'employer:e1', 'employer:e2', null, null]);
  assert.equal(score({ ...out[1], source: { kind: 'website' } }).duplicate_of, 'employer:e1');
  assert.deepEqual(dedupeCompanies([{ type: 'target', id: 't9', name: 'Lonely Co' }])[0].duplicate_of, undefined);
});

test('breakdownLines: biggest component first, signed, names + titles only (never an address)', () => {
  const r = score({
    type: 'employer', employees: 5000, last_touch_at: ago(1), visit: { ...hotVisit, visits_7d: 6, unique_visitors_7d: 3 },
    source: { kind: 'partner_referral', via_upside: true, named: true }, people: [{ title: 'VP People', is_buyer: true }, { title: 'Benefits Dir.', is_buyer: true }],
    research: { created_at: ago(1), result: { why_homelover: 'a', housing_perk: 'rent stipend' } },
  });
  const lines = breakdownLines(r);
  assert.equal(lines[0], '+17 visits (6 in 7 d, 3 people)');
  assert.ok(lines.includes('+15 fit (US 500+)') && lines.includes('+12 Brad referral (named)') && lines.includes('+12 people (VP People, Benefits Dir.)') && lines.includes('-6 research (competing housing perk)'), lines.join(' | '));
  assert.ok(!lines.join(' ').includes('@'));
  assert.ok(lines.every(l => /^[+-]\d+ /.test(l)));
});

test('trendOf: up / down / flat against the last snapshot, null without one', () => {
  assert.deepEqual([trendOf(50, 40), trendOf(40, 50), trendOf(40, 40), trendOf(40, null), trendOf(40, undefined)], ['up', 'down', 'flat', null, null]);
});

test('the migration seeds sales_settings.score_weights with exactly DEFAULT_WEIGHTS', () => {
  const sql = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'supabase', 'migrations', '20261027_intent_score_v1.sql'), 'utf8');
  const m = sql.match(/score_weights = \$w\$(.*?)\$w\$::jsonb/s);
  assert.ok(m, 'seed block present');
  assert.deepEqual(JSON.parse(m[1]), DEFAULT_WEIGHTS);
  assert.ok(sql.includes('sales_company_scores') && sql.includes('sales_company_score_days') && sql.includes('saved_views'));
  assert.ok(!m[1].includes('@'), 'no address in the seed');
});
