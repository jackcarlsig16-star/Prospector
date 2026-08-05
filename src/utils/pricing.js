const PF_TIERS = [
  { id: "base",    label: "Base",    amount: 2000  },
  { id: "plus",    label: "Plus",    amount: 5000  },
  { id: "premium", label: "Premium", amount: 15000 },
];

export const getPfAmount = (pfTier) => PF_TIERS.find(t => t.id === pfTier)?.amount || 0;

export const getPfDiscounted = (pfTier, pfDiscount) => {
  const base = getPfAmount(pfTier);
  if (!pfDiscount?.enabled) return base;
  if (pfDiscount.type === "pct")  return base * (1 - pfDiscount.amount / 100);
  if (pfDiscount.type === "flat") return Math.max(0, base - pfDiscount.amount);
  return base;
};

export const getEffectiveRate = (p, users, tieredPricing, tiers) => {
  const base = p.custom ?? p.rack;
  if (!tieredPricing || !tiers?.length) return base;
  const sorted = [...tiers].sort((a, b) => b.threshold - a.threshold);
  const match = sorted.find(t => users >= t.threshold);
  return match ? base * (1 - match.discount) : base;
};

export function computePricing(pFile) {
  if (!pFile) return null;
  const includedProducts = (pFile.products || []).filter(p => p.included);
  const monthlyUsers = pFile.monthlyUsers || Array(12).fill(0);
  const mo1 = monthlyUsers[0] || 0;
  const mo12 = monthlyUsers[11] || 0;
  const avgAccounts = pFile.avgAccounts || 1;
  const commitFee = pFile.commitFee || 0;
  const commitRamp = pFile.commitRamp || false;
  const commitRampSched = pFile.commitRampSched || Array(12).fill(commitFee / 12);
  const pfTier = pFile.pfTier || null;
  const pfDiscount = pFile.pfDiscount || { enabled: false };
  const tieredPricing = pFile.tieredPricing || false;
  const tiers = pFile.tiers || [];

  const pfBase    = getPfAmount(pfTier);
  const pfMonthly = pfTier ? getPfDiscounted(pfTier, pfDiscount) : 0;
  const pfAnnual  = pfMonthly * 12;
  const pfSavings = (pfBase - pfMonthly) * 12;

  const productRows = includedProducts.map(p => {
    const rack = p.rack || 0;
    const custom = p.custom ?? rack;
    const effectiveRate = getEffectiveRate(p, mo12, tieredPricing, tiers);
    const discountPct = rack > 0 ? Math.round((1 - effectiveRate / rack) * 100) : 0;
    const mul = p.type === "R" ? 12 : 1;
    const accMult = (p.type === "R" && p.isBundle) ? 1 : avgAccounts;
    const annualAtMo12 = effectiveRate * mo12 * accMult * mul;
    const annualAtRack = rack * mo12 * accMult * mul;
    const savingsVsRack = annualAtRack - annualAtMo12;
    const mo1Cost  = getEffectiveRate(p, mo1,  tieredPricing, tiers) * mo1  * accMult;
    const mo12Cost = effectiveRate * mo12 * accMult;
    return { name: p.name, type: p.type, rack, custom, effectiveRate, discountPct,
             annualAtMo12, annualAtRack, savingsVsRack, mo1Cost, mo12Cost };
  });

  const monthlyFloor = monthlyUsers.map((_, i) =>
    commitRamp ? (commitRampSched[i] || 0) : commitFee / 12
  );

  const monthlyRevenue = monthlyUsers.map((users, i) => {
    const productRev = includedProducts.reduce((sum, p) => {
      const rate = getEffectiveRate(p, users, tieredPricing, tiers);
      const accMult = (p.type === "R" && p.isBundle) ? 1 : avgAccounts;
      return sum + rate * users * accMult;
    }, 0);
    return productRev + pfMonthly + monthlyFloor[i];
  });

  const mo1Revenue  = monthlyRevenue[0]  || 0;
  const mo12Revenue = monthlyRevenue[11] || 0;

  const annualSingle    = productRows.filter(p => p.type === "S").reduce((s, p) => s + p.annualAtMo12, 0);
  const annualRecurring = productRows.filter(p => p.type === "R").reduce((s, p) => s + p.annualAtMo12, 0);
  const annualOnDemand  = productRows.filter(p => p.type === "T").reduce((s, p) => s + p.annualAtMo12, 0);
  const annualProductTotal = annualSingle + annualRecurring + annualOnDemand;
  const annualTotal    = annualProductTotal + pfAnnual + commitFee;
  const annualRack     = productRows.reduce((s, p) => s + p.annualAtRack, 0) + pfBase * 12;
  const annualSavings  = annualRack - (annualProductTotal + pfAnnual);
  const savingsPct     = annualRack > 0 ? Math.round((annualSavings / annualRack) * 100) : 0;

  const minimumLockIn  = commitFee + pfAnnual;
  const variableSpend  = annualProductTotal;
  const lockInPct      = annualTotal > 0 ? Math.round((minimumLockIn / annualTotal) * 100) : 0;

  const conservative = annualTotal * 0.75;
  const bestCase     = annualTotal * 1.25;

  return {
    includedProducts, productRows, monthlyUsers, monthlyRevenue, monthlyFloor,
    mo1, mo12, mo1Revenue, mo12Revenue,
    pfBase, pfMonthly, pfAnnual, pfSavings, pfTier, pfDiscount,
    commitFee, commitRamp, commitRampSched,
    annualSingle, annualRecurring, annualOnDemand, annualProductTotal,
    annualTotal, annualRack, annualSavings, savingsPct,
    minimumLockIn, variableSpend, lockInPct,
    conservative, bestCase,
    avgAccounts, tieredPricing, tiers,
  };
}
