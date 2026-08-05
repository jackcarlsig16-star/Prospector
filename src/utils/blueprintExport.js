/**
 * Generates a tab-separated spreadsheet from a deck blueprint + pricing session.
 * Output can be pasted directly into Google Sheets.
 */

const TAB = "\t";
const NL  = "\n";

const fmtD = n => n == null ? "—" : `$${Number(n).toFixed(2)}`;
const fmtM = n => `$${Math.round(n).toLocaleString()}`;
const pct  = (rack, custom) => rack > 0 ? Math.round((rack - custom) / rack * 100) : 0;

const MO_HDR = ["Mo 1","Mo 2","Mo 3","Mo 4","Mo 5","Mo 6","Mo 7","Mo 8","Mo 9","Mo 10","Mo 11","Mo 12"];

const TYPE_FREQ = {
  S: "Onboarding (per connected account)",
  R: "Per connected account/mo",
  T: "On-demand",
};

/** Annual volume for a product given a session */
function annualVol(p, session) {
  const { monthlyUsers = [], avgAccounts = 1, onDemand = 0 } = session;
  return Math.round(monthlyUsers.reduce((s, u) => {
    if (p.type === "S") return s + u * avgAccounts;
    if (p.type === "R") return s + u * avgAccounts;
    if (p.type === "T") return s + u * onDemand;
    return s;
  }, 0));
}

function annualRackTotal(session) {
  const included = (session.products || []).filter(p => p.included && p.rack != null);
  return included.reduce((s, p) => s + (p.rack || 0) * annualVol(p, session), 0);
}

function annualCustomTotal(session) {
  const included = (session.products || []).filter(p => p.included && p.rack != null);
  const productCost = included.reduce((s, p) => {
    const rate = p.custom ?? p.rack;
    return s + (rate || 0) * annualVol(p, session);
  }, 0);
  const floorTotal = session.commitRamp
    ? (session.commitRampSched || []).reduce((s, v) => s + v, 0)
    : (session.commitFee || 0) * 12;
  return productCost + floorTotal;
}

function annualPfTotal(session) {
  if (session.pfRamp) return (session.pfRampSched || []).reduce((s, v) => s + v, 0);
  const { pfTier, pfDiscount } = session;
  if (!pfTier) return 0;
  const PF_TIERS = [{ id:"base", amount:2000 }, { id:"plus", amount:5000 }, { id:"premium", amount:15000 }];
  const base = PF_TIERS.find(t => t.id === pfTier)?.amount || 0;
  if (!pfDiscount?.enabled) return base;
  if (pfDiscount.type === "pct")  return base * (1 - pfDiscount.amount / 100);
  if (pfDiscount.type === "flat") return Math.max(0, base - pfDiscount.amount);
  return base;
}

export function generateBlueprintTSV(blueprint, session) {
  const included = (session.products || []).filter(p => p.included && p.rack != null);
  // annualFloor = sum of the actual ramp schedule (or flat monthly × 12)
  const annualFloor = session.commitRamp
    ? (session.commitRampSched || []).reduce((s, v) => s + v, 0)
    : (session.commitFee || 0) * 12;
  // commitAmt = monthly label value (Mo.12 for ramp, flat amount for flat)
  const commitAmt = session.commitRamp
    ? (session.commitRampSched || [])[11] ?? 0
    : session.commitFee || 0;
  const monthlyUsers = session.monthlyUsers || Array(12).fill(0);

  const sections = [];

  // ── Section 1: Traffic / Volume ──────────────────────────────────────────
  if (blueprint.sections.traffic) {
    const unitLabel = blueprint.config?.traffic?.unitLabel || "New Users";
    const annualTotal = monthlyUsers.reduce((s, v) => s + v, 0);
    sections.push([
      `TRAFFIC OVERVIEW${TAB.repeat(13)}`,
      ["", ...MO_HDR, "Annual Total"].join(TAB),
      [unitLabel, ...monthlyUsers.map(v => v.toLocaleString()), annualTotal.toLocaleString()].join(TAB),
      "",
      `Notes:${TAB}${blueprint.config?.traffic?.notes || ""}`,
    ].join(NL));
  }

  // ── Section 2: Products Table ─────────────────────────────────────────────
  if (blueprint.sections.products) {
    const commitLabel = annualFloor > 0
      ? (session.commitRamp ? `${fmtM(annualFloor)}/yr floor (ramp)` : `${fmtM(commitAmt)}/mo commit`)
      : "None";

    const prodRows = included.map(p => {
      const disc      = pct(p.rack, p.custom ?? p.rack);
      const freq      = TYPE_FREQ[p.type] || p.type;
      const discLbl   = disc > 0 ? `${disc}%` : "—";
      const commitReq = disc > 0 && annualFloor > 0
        ? (session.commitRamp ? `${fmtM(annualFloor)}/yr (ramp)` : `${fmtM(commitAmt)}/mo`)
        : "—";
      const annSav    = disc > 0 ? fmtM(Math.round((p.rack - (p.custom ?? p.rack)) * annualVol(p, session))) : "—";
      return [p.name, freq, fmtD(p.rack), discLbl, commitReq, annSav].join(TAB);
    });

    const rampRows = (session.commitRamp && (session.commitRampSched || []).some(v => v > 0)) ? [
      "",
      "MONTHLY COMMITMENT SCHEDULE",
      MO_HDR.join(TAB),
      (session.commitRampSched || []).map(v => fmtM(v)).join(TAB),
      `Annual floor total:${TAB}${fmtM(annualFloor)}`,
    ] : commitAmt > 0 ? [
      "",
      "MONTHLY COMMITMENT",
      `${fmtM(commitAmt)}/mo (flat) · ${fmtM(annualFloor)}/yr`,
    ] : [];

    sections.push([
      `PRICING OVERVIEW${TAB.repeat(5)}`,
      ["Product", "Billing Frequency", "Rack Rate", "Discount", `Commitment (${commitLabel})`, "Est. Annual Savings"].join(TAB),
      ...prodRows,
      ...rampRows,
    ].join(NL));
  }

  // ── Section 3: Savings Comparison ────────────────────────────────────────
  if (blueprint.sections.savings) {
    const commitLbl  = blueprint.config?.savings?.commitmentLabel || "With Commitment";
    const discounted = included.filter(p => p.custom != null && p.custom < p.rack);

    const savRows = discounted.map(p => {
      const vol       = annualVol(p, session);
      const disc      = pct(p.rack, p.custom);
      const annSav    = Math.round((p.rack - p.custom) * vol);
      return [p.name, fmtD(p.rack), fmtD(p.custom), `${disc}% off`, fmtM(annSav)].join(TAB);
    });

    const productRack   = Math.round(annualRackTotal(session));
    const productCustom = Math.round(annualCustomTotal(session));
    const pfTotal       = Math.round(annualPfTotal(session));
    const noCommit      = productRack  + pfTotal;
    const withCommit    = productCustom + pfTotal;
    const totalSav      = noCommit - withCommit;

    sections.push([
      `SAVINGS COMPARISON${TAB.repeat(4)}`,
      ["Product", "No Commitment", commitLbl, "Discount", "Est. Annual Savings"].join(TAB),
      ...(savRows.length ? savRows : [["(no discounts applied)", "—", "—", "—", "—"].join(TAB)]),
      "",
      ["", "No Commitment", commitLbl, "Difference", ""].join(TAB),
      ["  API + Floor", fmtM(productRack), fmtM(productCustom), fmtM(Math.abs(productRack - productCustom)), ""].join(TAB),
      pfTotal > 0 ? ["  Platform Fee", fmtM(pfTotal), fmtM(pfTotal), "—", ""].join(TAB) : null,
      ["Total Annual Spend", fmtM(noCommit), fmtM(withCommit), fmtM(Math.abs(totalSav)), ""].join(TAB),
    ].filter(Boolean).join(NL));
  }

  // 3 blank rows between sections so each can be cut/pasted to its own sheet
  return sections.join(NL.repeat(4));
}
