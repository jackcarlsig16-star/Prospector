// Canonical per-product, per-month cost for the standard S/R/T pricing model.
// Sum 12 calls to get annual.
//
// Three other pricing paths exist in the codebase and are intentionally NOT
// consumers of this helper — they implement different models:
//   - utils/pricing.js computePricing: flat Mo12 × 12 model, structurally
//     different from the per-month integrated approach. Left as-is.
//   - components/ROIPage.js calcPricingAnnual: uses per-product p.tiers[]
//     band model + p.discount. A different pricing model, not a buggy copy.
//   - utils/blueprintExport.js annualVol: computes call/unit volume, not
//     dollar cost. Separate concern.
//
// p:          { type:'S'|'R'|'T', rack, custom, adoptionPct?, isBundle? }
// monthCtx:   { newUsers, activeUsers }  — user counts for THIS month
// sessionCtx: { avgAccounts, onDemand, tierMult }
//
// Mo1 convention: at i=0, newUsers === activeUsers (all Mo1 users count as
// new). Matches PricingPage canonical newUsersAtMo + monthlyBreakdown useMemo.

export function productMonthlyCost(p, monthCtx, sessionCtx) {
  const r = p.custom ?? p.rack;
  if (r == null) return 0;
  const a = (p.adoptionPct ?? 100) / 100;
  const newUsers = monthCtx.newUsers ?? 0;
  const activeUsers = monthCtx.activeUsers ?? 0;
  const avgAccounts = sessionCtx.avgAccounts ?? 1;
  const onDemand = sessionCtx.onDemand ?? 0;
  const tierMult = sessionCtx.tierMult ?? 1;
  if (p.type === 'S') return r * newUsers * avgAccounts * a * tierMult;
  if (p.type === 'R') return r * activeUsers * (p.isBundle ? 1 : avgAccounts) * a * tierMult;
  if (p.type === 'T') return r * onDemand * activeUsers * a * tierMult;
  return 0;
}

// Rack-rate equivalent of productMonthlyCost — for savings-vs-rack comparison.
// Ignores custom + tierMult (rack is the undiscounted reference).
export function productMonthlyRack(p, monthCtx, sessionCtx) {
  if (p.rack == null) return 0;
  const a = (p.adoptionPct ?? 100) / 100;
  const newUsers = monthCtx.newUsers ?? 0;
  const activeUsers = monthCtx.activeUsers ?? 0;
  const avgAccounts = sessionCtx.avgAccounts ?? 1;
  const onDemand = sessionCtx.onDemand ?? 0;
  if (p.type === 'S') return p.rack * newUsers * avgAccounts * a;
  if (p.type === 'R') return p.rack * activeUsers * (p.isBundle ? 1 : avgAccounts) * a;
  if (p.type === 'T') return p.rack * onDemand * activeUsers * a;
  return 0;
}

// Session-site helper: derive { newUsers, activeUsers } from monthlyUsers[i].
export function monthUsersAt(monthlyUsers, i) {
  const activeUsers = monthlyUsers[i] || 0;
  const prevUsers = i > 0 ? (monthlyUsers[i - 1] || 0) : 0;
  const newUsers = Math.max(0, activeUsers - prevUsers);
  return { newUsers, activeUsers };
}
