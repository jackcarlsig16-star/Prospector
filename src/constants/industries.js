import { PRESET_SWATCH_COLORS } from './colors';

// account-taxonomy-and-creation-upgrade-v1 Stage 1 — universal default
// industry taxonomy, replacing the old fintech-era vertical list (Stage 0
// consolidated 5 duplicate copies to this one file; this stage swaps the
// VALUES only, same shape). Per-business add/remove is future work
// (Company Settings, not built yet) — colors reuse the existing 15-value
// swatch palette already used for business/project color-picking, not a
// new parallel color system, and happen to line up 1:1 with the 15
// industries below.
export const INDUSTRIES = [
  "Consumer / Retail",
  "E-commerce",
  "Wellness & Health",
  "Real Estate",
  "Financial Services",
  "Manufacturing / Industrial",
  "Food & Beverage",
  "Hospitality",
  "Media & Entertainment",
  "Technology / Software",
  "Professional Services",
  "Nonprofit / Association",
  "Education",
  "Government / Public Sector",
  "Other",
];

export const INDUSTRY_COLOR = Object.fromEntries(
  INDUSTRIES.map((name, i) => [name, PRESET_SWATCH_COLORS[i]])
);
