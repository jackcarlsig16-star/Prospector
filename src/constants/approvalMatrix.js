// PRICING APPROVAL MATRIX (placeholder data — replace with your org's real floors)
// Dollar-amount based floor rates per product per monthly minimum tier
//
// COLUMN MEANINGS:
//   L0 column = the suggested price floor (lowest rate with zero approval needed)
//   L1 column = the floor where manager approval STARTS (at or below this → L1)
//   L2 column = the floor where 2nd line manager approval STARTS
//   L3 column = the floor where commercial team approval STARTS
//   L4 column = the floor where head of commercial approval STARTS
//   Below L4  = Finance approval required
//
// NOTE: The L0 column value is NOT used in comparisons — it is shown in the UI
//       as a reference price for the AE. Approval logic is driven by L1–L4 only.
//
// USAGE (see getApprovalLevel below):
//   if (customRate > row.L1) return "L0";   // strictly above L1 floor → no approval
//   if (customRate > row.L2) return "L1";   // at/below L1, above L2 → manager approval
//   if (customRate > row.L3) return "L2";   // at/below L2, above L3 → 2nd line manager
//   if (customRate > row.L4) return "L3";   // at/below L3, above L4 → commercial team
//   if (customRate >= row.L4) return "L4";  // at exactly L4 floor → head of commercial
//   return "FINANCE";                        // below L4 floor → Finance required

export const PRODUCT_APPROVAL_FLOORS = {
  "Core Verify": {
    rack: 1.5,
    floors: [
      { minLow: 500, minHigh: 5000, L0: 1.35, L1: 1.05, L2: 0.825, L3: 0.75, L4: 0.3 },
      { minLow: 5000, minHigh: 50000, L0: 1.275, L1: 0.975, L2: 0.75, L3: 0.675, L4: 0.3 },
      { minLow: 50000, minHigh: 9999999, L0: 1.14, L1: 0.84, L2: 0.615, L3: 0.54, L4: 0.3 },
    ]
  },
  "Core Verify Plus": {
    rack: 2.75,
    floors: [
      { minLow: 500, minHigh: 5000, L0: 2.475, L1: 1.925, L2: 1.5125, L3: 1.375, L4: 0.55 },
      { minLow: 5000, minHigh: 50000, L0: 2.3375, L1: 1.7875, L2: 1.375, L3: 1.2375, L4: 0.55 },
      { minLow: 50000, minHigh: 9999999, L0: 2.09, L1: 1.54, L2: 1.1275, L3: 0.99, L4: 0.55 },
    ]
  },
  "Balance Insights": {
    rack: 0.1,
    floors: [
      { minLow: 500, minHigh: 5000, L0: 0.095, L1: 0.08, L2: 0.065, L3: 0.06, L4: 0.035 },
      { minLow: 5000, minHigh: 50000, L0: 0.0875, L1: 0.075, L2: 0.06, L3: 0.055, L4: 0.035 },
      { minLow: 50000, minHigh: 9999999, L0: 0.083, L1: 0.066, L2: 0.051, L3: 0.046, L4: 0.035 },
    ]
  },
};

export function getApprovalLevel(productName, customRate, monthlyMinimum) {
  const product = PRODUCT_APPROVAL_FLOORS[productName];
  if (!product) return "L0"; // unknown product, no restriction

  // Zero minimum = L0 AE discretion. Fall through to lowest band thresholds so
  // extreme rates still surface, but no-commit alone does not force approval.
  const row = product.floors.find(r => monthlyMinimum >= r.minLow && monthlyMinimum < r.minHigh)
    || product.floors[0];

  if (!row) return "L0";
  // L0 column is the suggested price; L0 zone extends from rack down to just above the L1 floor
  if (customRate > row.L1) return "L0";
  if (customRate > row.L2) return "L1";
  if (customRate > row.L3) return "L2";
  if (customRate > row.L4) return "L3";
  if (customRate >= row.L4) return "L4";
  return "FINANCE";
}

// Approval level metadata
export const APPROVAL_LEVELS = {
  L0:      { label: "Pre-approved",       color: "#4B5563", dot: null,      bg: "transparent", border: "transparent", desc: "No approval required"                   },
  L1:      { label: "Manager approval",   color: "#D97706", dot: "#92400E", bg: "#2D2008",      border: "#92400E",    desc: "1st line manager must approve"           },
  L2:      { label: "2nd line manager",   color: "#EA580C", dot: "#9A3412", bg: "#2D1500",      border: "#9A3412",    desc: "2nd line manager must approve"           },
  L3:      { label: "Commercial team",    color: "#DC2626", dot: "#991B1B", bg: "#2D0A0A",      border: "#991B1B",    desc: "Commercial team + 2nd line manager"      },
  L4:      { label: "Head of Commercial", color: "#EF4444", dot: "#7F1D1D", bg: "#1A0505",      border: "#7F1D1D",    desc: "Head of Commercial + Segment Lead"       },
  FINANCE: { label: "Finance approval",   color: "#F87171", dot: "#450A0A", bg: "#0D0D0D",      border: "#450A0A",    desc: "Below floor — Finance required"          },
};

export const PRODUCT_NAME_MAP = {
  "Core Verify (Legacy Name)": "Core Verify",
  "Balance Insights (Beta)": "Balance Insights",
};
