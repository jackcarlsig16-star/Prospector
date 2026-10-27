import { SA } from './theme';
import { KIT_PRIORITY } from '../../ui/tokens';
// dashboard-v2 Stage 3 - single source of truth for every color this
// feature uses. The same cohort is the same color in every widget, chart,
// legend, and the PDF - nothing else computes its own color. Color is
// never the only signal; every colored mark pairs with a text label or
// legend entry (enforced in the components that use this file, not here).
//
// 7 real, deliberately-chosen cohort hues plus one reserved Partner hue,
// spaced to stay clear of the 3 semantic colors below (healthy/warning/
// problem) so a colored dot never carries two different meanings
// depending on context - e.g. no cohort reuses the same green as
// "healthy" or the same red as "problem". Not reused from
// colors.js/tokens.js's existing tokens (which are mostly warm
// gold/orange/red, i.e. exactly the zone reserved for semantics here) -
// chosen fresh, cool-leaning (180-340 degrees of hue) plus one warm lime
// for Partner that sits clear of amber (45deg) and green (150deg).

// sales-analytics-design-v1 - replaced with the approved mockup's muted
// palette (specs/design/sales-analytics-mockup.html). Hospitality has no
// value in that mockup (HomeLover has zero Hospitality-cohort sequences
// today, so it wasn't shown) - this is a GUESS in the same muted,
// cool-leaning family as the rest, flagged for Jack to correct rather
// than silently treated as final.
export const COHORT_COLORS = {
  Fitness: '#E07A5F',
  Retail: '#6C9BD2',
  'Car Rental': '#B39DDB',
  SaaS: '#5FB3A8',
  Wireless: '#D4B26A',
  Other: '#7A8390',
  Hospitality: '#8C8FD1', // GUESS - not in the mockup, flag back if wrong
};

// Base hex unchanged; the mockup applies this at 70% opacity wherever it
// fills a shape (stacked-bar segments, chips) - that's a per-usage-site
// concern, not a second constant here.
export const PARTNER_COLOR = '#A8D04A';

export const AUDIENCE_LABELS = { employer: 'Employer', membership: 'Membership org', channel_partner: 'Channel partner' };
export function audienceColor(audience) { return audience === 'employer' ? SA.muted : PARTNER_COLOR; }

// sales-analytics-design-v1 - updated to the mockup's status hex values
// (good/warn/bad in the mockup = healthy/warning/problem here; same
// three-meaning model, new values). Single source every widget already
// imports from, so this takes effect everywhere at once, independent of
// each widget's own layout restyle stage.
export const SEMANTIC = {
  healthy: '#3DD68C',
  warning: '#F2B544',
  problem: '#FF6B6B',
};

export function cohortColor(cohort) {
  return COHORT_COLORS[cohort] || COHORT_COLORS.Other;
}

// PROPOSED (SPEC) - revisable starting thresholds, flag back rather than
// silently tuning.
export const HEALTH_THRESHOLDS = {
  bounceAmber: 0.03,
  bounceRed: 0.08,
  openAmber: 0.05,
};

export function bounceHealthColor(bouncePercent) {
  if (bouncePercent === null || bouncePercent === undefined) return null;
  if (bouncePercent >= HEALTH_THRESHOLDS.bounceRed) return SEMANTIC.problem;
  if (bouncePercent >= HEALTH_THRESHOLDS.bounceAmber) return SEMANTIC.warning;
  return SEMANTIC.healthy;
}

// sales-email-trend-v1 REV2 - series colours for Email Performance Over
// Time, from the dataviz reference palette and validated per panel with its
// validator (2026-10-01): deliverability {hard bounce, spam block} and
// engagement {open, reply, click} each pass all-pairs CVD + normal-vision
// checks on the dark card surface (#12161B) and on white print; the two
// mailbox colours pass as an adjacent stacked pair. Red is left out on
// purpose - it already means "bad" on this page. Print light-mode values
// for aqua/yellow/magenta sit under 3:1 on white, so every line carries a
// direct label and the health table repeats the numbers.
const TREND_VALUES = {
  hardBounce: ['#d95926', '#eb6834'],
  spamBlock: ['#9085e9', '#4a3aa7'],
  open: ['#3987e5', '#2a78d6'],
  reply: ['#199e70', '#1baf7a'],
  click: ['#c98500', '#eda100'],
  mailbox1: ['#008300', '#008300'],
  mailbox2: ['#d55181', '#e87ba4'],
};
const trendVar = key => `--sa-trend-${key.replace(/[A-Z0-9]/g, c => `-${c.toLowerCase()}`)}`;
export const TREND_COLORS = Object.fromEntries(Object.keys(TREND_VALUES).map(k => [k, `var(${trendVar(k)})`]));
export const TREND_THEME_CSS = `
  #sales-analytics-root { ${Object.entries(TREND_VALUES).map(([k, [dark]]) => `${trendVar(k)}: ${dark};`).join(' ')} }
  @media print {
    #sales-analytics-root { ${Object.entries(TREND_VALUES).map(([k, [, print]]) => `${trendVar(k)}: ${print};`).join(' ')} }
  }
`;

// FIX priority-colors-v1 - P1-P4 each have their own hue (tokens.js KIT_PRIORITY:
// orange, amber, teal, slate; overdue is SEMANTIC.problem / SA.bad with the word).
// The vars are defined on the module root + the Tasks drawer by theme.js
// (SA_THEME_CSS, dark + print), so chips, dots and the Dashboard stack agree.
export const PRIORITY_COLORS = Object.fromEntries(Object.keys(KIT_PRIORITY).map(k => [k, `var(--sa-prio-${k.toLowerCase()})`]));
// A row's priority (1-4, '1'-'4' or 'P1'-'P4') -> its var; null for none / Not a fit.
export const priorityColor = p => PRIORITY_COLORS[typeof p === 'string' && p.startsWith('P') ? p : `P${p}`] || null;

// sales-goals-v1 REV4 - member colors, assigned in workspace join order so
// a person keeps theirs and no two members share one. The first two are the
// mockup's (validated CVD-safe on the dark ground); the rest keep the same
// lightness and stay clear of the status and cohort hues.
export const MEMBER_COLORS = ['#6F8CF0', '#C97626', '#4FB0C6', '#B07CC6', '#8FB35A', '#D6788F'];
export const UNASSIGNED_COLOR = '#4A5462';
export function memberColor(index) {
  return index >= 0 ? MEMBER_COLORS[index % MEMBER_COLORS.length] : UNASSIGNED_COLOR;
}

// sales-partners-workflow-v1 - partner TYPE markers (6 families of the 14
// categories, partners/partnerTypes.js). Validated with the dataviz
// validator 2026-10-06 on the dark surface and the white print surface:
// lightness band, chroma, contrast >= 3:1, and every pair of families that
// sit next to each other in category order 1-14 at CVD dE >= 9.9 /
// normal dE >= 17. Each is >= 15 dE from the member blue/orange, the
// accent and the status colors. Pairs that never sit side by side are not
// all separable: Influence green vs Platforms crimson is dE 1.2 for
// red-green colorblind readers, Professional vs Renters dE 10.8 for
// everyone. The category name always sits beside the marker (and Current
// has a star), so color is never the only signal.
export const PARTNER_TYPE_COLORS = {
  // Current partners: silver (the soft text token, so it stays visible on
  // the white print surface too) plus a ★ on the row - Jack 2026-10-06.
  current: 'var(--sa-soft)', platforms: '#C33D59', brokers: '#00A19D',
  renters: '#9550BB', influence: '#3E8651', professional: '#C068AC',
};

// intent-score-v1 S3 - the lead-source hues, FIXED order (SOURCE_ORDER = the server's intentScore.js), assigned to
// the entity never the rank. The project's muted cohort / partner-type sets fail the dataviz validator's lightness
// band and chroma floor on both surfaces, so each slot was re-stepped onto the skill's reference ramps (dataviz
// references/palette.md, same hue family per slot) and validated 2026-10-27 as a set: adjacent CVD dE 8.4 dark /
// 9.1 light, normal-vision 19.3 / 19.6, every slot >= 3:1 on the dark inset (#12161B) and surface (#1E242C); on
// the white print surface aqua / yellow / magenta sit under 3:1, so the legend, the hover and the table always say
// the source in words. "Other" is the fold slot in the muted ink, never a ninth hue. Never a member or status color.
const SOURCE_VALUES = {
  upside: ['#3987e5', '#2a78d6'], partner_referral: ['#d95926', '#eb6834'], person_referral: ['#199e70', '#1baf7a'],
  campaign: ['#c98500', '#eda100'], website: ['#d55181', '#e87ba4'], inbound: ['#008300', '#008300'],
  homelover_outreach: ['#9085e9', '#6250d6'], scout: ['#e66767', '#e34948'], other: ['#898781', '#898781'],
};
export const SOURCE_ORDER = ['upside', 'partner_referral', 'person_referral', 'campaign', 'website', 'inbound', 'homelover_outreach', 'scout', 'other'];
export const SOURCE_LABELS = { upside: 'Brad / Upside', partner_referral: 'Partner referral', person_referral: 'Person referral', campaign: 'Campaign', website: 'Website', inbound: 'Inbound', homelover_outreach: 'Outreach', scout: 'Scout', other: 'Other' };
export const SOURCE_HEX = SOURCE_VALUES;
const sourceVar = k => `--sa-src-${k.replace(/_/g, '-')}`;
export const SOURCE_COLORS = Object.fromEntries(SOURCE_ORDER.map(k => [k, `var(${sourceVar(k)})`]));
export const sourceColor = label => SOURCE_COLORS[label] || SOURCE_COLORS.other;
export const SOURCE_THEME_CSS = `
  #sales-analytics-root { ${SOURCE_ORDER.map(k => `${sourceVar(k)}: ${SOURCE_VALUES[k][0]};`).join(' ')} }
  @media print {
    #sales-analytics-root { ${SOURCE_ORDER.map(k => `${sourceVar(k)}: ${SOURCE_VALUES[k][1]};`).join(' ')} }
  }
`;
