// sales-analytics-design-v1 - the CSS-variable layer for every generic
// (non-cohort, non-status) UI token this feature uses; the values live in
// src/ui/tokens.js. Cohort/Partner/health-status colors stay in palette.js.
// Scoped to src/components/salesAnalytics only.
//
// Stage 4 - every SA.* value is now a CSS custom-property reference
// (`var(--sa-x)`), not a literal hex string. #sales-analytics-root (the
// page's own outer wrapper, in SalesAnalyticsTab.js) defines the dark
// values; a @media print block on that same selector redefines them to
// the light print palette (SA_THEME_CSS below, injected once via a
// <style> tag). This is what makes print actually go light without any
// component needing print-aware logic, a runtime theme switch, or
// Chrome's "Background graphics" setting (SPEC requirement) - the browser
// itself resolves the right value per media context, same as any other
// CSS cascade.
import { SA_DARK_VALUES, SA_PRINT_VALUES, KIT_PRIORITY } from '../../ui/tokens';

export { SA_BAD_TINT, SA_BAD_BG, SA_BAD_BORDER, saSans, saMono, SA_TYPE, SA_SHAPE } from '../../ui/tokens';

const TOKEN_CSS_VARS = {
  ground: '--sa-ground', surface: '--sa-surface', surface2: '--sa-surface-2', border: '--sa-border',
  text: '--sa-text', muted: '--sa-muted', faint: '--sa-faint', accent: '--sa-accent',
  good: '--sa-good', warn: '--sa-warn', bad: '--sa-bad', barNeutral: '--sa-bar-neutral',
  track: '--sa-track', inset: '--sa-inset', borderStrong: '--sa-border-strong', link: '--sa-link',
  soft: '--sa-soft', neutral: '--sa-neutral',
};

export const SA = Object.fromEntries(Object.entries(TOKEN_CSS_VARS).map(([key, cssVar]) => [key, `var(${cssVar})`]));

function cssVarBlock(values) {
  return Object.entries(TOKEN_CSS_VARS).map(([key, cssVar]) => `${cssVar}: ${values[key]};`).join(' ');
}

export const SA_THEME_ROOT_ID = 'sales-analytics-root';
// SA_THEME_CLASS: for SA-styled UI mounted outside the page root (the Tasks
// drawer lives at the app shell, on every workspace page).
export const SA_THEME_CLASS = 'sa-theme';
// ui-clarity-v1 H1: placeholder text reads at the muted token (the UA default grey sits under 4.5:1 on the inset).
// FIX priority-colors-v1: the P1-P4 hues (--sa-prio-p1..p4, palette.js PRIORITY_COLORS) ride on the same root and
// drawer class, dark on screen and the print pair under print, so every priority chip, dot and chart stack agrees.
const prioBlock = i => Object.entries(KIT_PRIORITY).map(([k, v]) => `--sa-prio-${k.toLowerCase()}: ${v[i]};`).join(' ');
export const SA_THEME_CSS = `
  #${SA_THEME_ROOT_ID}, .${SA_THEME_CLASS} { ${cssVarBlock(SA_DARK_VALUES)} ${prioBlock(0)} }
  #${SA_THEME_ROOT_ID} ::placeholder, .${SA_THEME_CLASS} ::placeholder { color: var(--sa-muted); opacity: 1; }
  @media print {
    #${SA_THEME_ROOT_ID} { ${cssVarBlock(SA_PRINT_VALUES)} ${prioBlock(1)} }
  }
`;
