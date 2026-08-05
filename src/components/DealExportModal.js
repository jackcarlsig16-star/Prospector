import React, { useState, useEffect } from 'react';
import { C, mono } from '../constants/colors';
import { MEDPICC_FIELDS } from '../utils/dealIntel';
import { computePricing, getPfDiscounted, getEffectiveRate } from '../utils/pricing';
import { ROI_KEY } from '../utils/storageKeys';
import { productMonthlyCost, monthUsersAt } from '../utils/pricingMath';

// ── Formatting helpers ────────────────────────────────────────────────────────
const fmt    = n => n == null ? "—" : "$" + Math.round(n).toLocaleString();
const fmt$   = n => (n == null || isNaN(n)) ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN   = n => (n == null || isNaN(n)) ? "—" : Math.round(n).toLocaleString();
const fmtPct = n => (n == null || isNaN(n)) ? "—" : Math.round(n) + "%";
const dash   = n => (!n || n === 0) ? "—" : fmt$(n);

// ── Pricing renderText helpers ────────────────────────────────────────────────
const renderPricingExec = (d) => {
  if (!d || !d.productRows.length) return "PRICING\n  No pricing file saved.";
  const lines = ["PRICING"];
  lines.push(`Annual investment:  ${fmt$(d.annualTotal)}`);
  lines.push(`Key products:       ${d.productRows.map(p => p.name).join(", ")}`);
  if (d.savingsPct > 0) lines.push(`vs rack rate:       save ${fmt$(d.annualSavings)} (${d.savingsPct}% off)`);
  if (d.pfTier) lines.push(`Platform fee:       ${fmt$(getPfDiscounted(d.pfTier, d.pfDiscount))}/mo (${d.pfTier})`);
  if (d.commitFee > 0) lines.push(`Commitment fee:     ${fmt$(d.commitFee)}`);
  lines.push(`Monthly range:      ${fmt$(d.mo1Revenue)} (Mo.1) → ${fmt$(d.mo12Revenue)} (Mo.12)`);
  return lines.join("\n");
};

const renderPricingStandard = (d) => {
  if (!d || !d.productRows.length) return "PRICING\n  No pricing file saved.";
  const lines = ["PRICING"];
  lines.push("Product\tType\tRack\tCustom\tDiscount\tAnnual (Mo.12 vol)");
  d.productRows.forEach(p => {
    lines.push(`${p.name}\t${p.type}\t${fmt$(p.rack)}\t${fmt$(p.effectiveRate)}\t${p.discountPct}%\t${fmt$(p.annualAtMo12)}`);
  });
  lines.push("");
  if (d.commitFee > 0) lines.push(`Commitment fee:   ${fmt$(d.commitFee)}`);
  if (d.pfTier) lines.push(`Platform fee:     ${fmt$(getPfDiscounted(d.pfTier, d.pfDiscount))}/mo (${d.pfTier})`);
  lines.push(`Mo.1 volume:      ${fmtN(d.mo1)} users   Mo.12 volume: ${fmtN(d.mo12)} users`);
  lines.push(`Annual total:     ${fmt$(d.annualTotal)}`);
  return lines.join("\n");
};

const renderPricingDetailed = (d, opts = {}) => {
  if (!d || !d.productRows.length) return "PRICING\n  No pricing file saved.";
  const typeLbl = t => t === "R" ? "Recurring" : t === "S" ? "Single-touch" : t === "T" ? "On-demand" : t;
  const pct = (num, den) => den > 0 ? fmtPct(num / den * 100) : "—";
  const accName = opts.acc?.name || "";
  const aeName  = opts.activeUser?.name || "";
  const lines   = [];

  // Header
  lines.push(`PRICING SUMMARY${accName ? " — " + accName : ""}`);
  lines.push(`Generated: ${new Date().toLocaleDateString()}${aeName ? "\tAE: " + aeName : ""}`);
  lines.push("");

  // 1 — Products
  lines.push("PRODUCTS");
  lines.push("Product\tType\tRack Rate\tCustom Rate\tDiscount %\tSavings vs Rack (Annual)\tMo.1 Cost\tMo.12 Cost\tAnnual (Mo.12 vol)");
  d.productRows.forEach(p => {
    lines.push([
      p.name, typeLbl(p.type),
      fmt$(p.rack), fmt$(p.effectiveRate), fmtPct(p.discountPct),
      dash(p.savingsVsRack), dash(p.mo1Cost), dash(p.mo12Cost), fmt$(p.annualAtMo12),
    ].join("\t"));
  });

  // 2 — Platform fee
  lines.push("");
  lines.push("PLATFORM FEE");
  lines.push("Tier\tBase Rate/mo\tBase Rate/yr\tDiscounted Rate/mo\tDiscounted Rate/yr\tMonthly Savings\tAnnual Savings");
  lines.push([
    d.pfTier || "None",
    d.pfTier ? fmt$(d.pfBase) : "—", d.pfTier ? fmt$(d.pfBase * 12) : "—",
    d.pfTier ? fmt$(d.pfMonthly) : "—", d.pfTier ? fmt$(d.pfAnnual) : "—",
    d.pfTier ? fmt$(d.pfBase - d.pfMonthly) : "—", d.pfTier ? fmt$(d.pfSavings) : "—",
  ].join("\t"));

  // 3 — API Commitment Ramp
  lines.push("");
  const rampTotal = d.commitRamp ? d.commitRampSched.reduce((s, v) => s + v, 0) : d.commitFee;
  lines.push(`API COMMITMENT RAMP — ${fmt$(rampTotal)}/yr`);
  lines.push("\t" + Array.from({ length: 12 }, (_, i) => `M${i + 1}`).join("\t"));
  lines.push("Floor\t" + d.commitRampSched.map(fmt$).join("\t"));

  // 4 — Annual Totals
  lines.push("");
  lines.push("ANNUAL TOTALS");
  lines.push("\tAmount\t% of Total");
  lines.push(`Single-touch\t${fmt$(d.annualSingle)}\t${pct(d.annualSingle, d.annualTotal)}`);
  lines.push(`Recurring\t${fmt$(d.annualRecurring)}\t${pct(d.annualRecurring, d.annualTotal)}`);
  if (d.annualOnDemand > 0) lines.push(`On-demand\t${fmt$(d.annualOnDemand)}\t${pct(d.annualOnDemand, d.annualTotal)}`);
  lines.push(`Platform Fee\t${fmt$(d.pfAnnual)}\t${pct(d.pfAnnual, d.annualTotal)}`);
  lines.push(`Commitment Fee\t${fmt$(d.commitFee)}\t${pct(d.commitFee, d.annualTotal)}`);
  lines.push(`Deal Total (projected)\t${fmt$(d.annualTotal)}\t100%`);
  lines.push(`Rack Total\t${fmt$(d.annualRack)}\t`);
  lines.push(`Savings vs Rack\t${fmt$(d.annualSavings)}\t${fmtPct(d.savingsPct)}`);

  // 5 — Scenario Range
  lines.push("");
  lines.push("SCENARIO RANGE (±25% estimated volumes)");
  lines.push("\tAmount/yr\tvs Base Case");
  lines.push(`Conservative (-25% volume)\t${fmt$(d.conservative)}\t-${fmt$(d.annualTotal - d.conservative)}`);
  lines.push(`Base Case (projected volumes)\t${fmt$(d.annualTotal)}\t—`);
  lines.push(`Best Case (+25% volume)\t${fmt$(d.bestCase)}\t${fmt$(d.bestCase - d.annualTotal)}`);

  // 6 — Lock-in vs Projected
  lines.push("");
  lines.push("LOCK-IN VS PROJECTED");
  lines.push("\tAmount\t% of Total Deal");
  lines.push(`Minimum (0 users) — commitment + platform\t${fmt$(d.minimumLockIn)}\t${fmtPct(d.lockInPct)}`);
  lines.push(`Variable (user-driven API spend)\t${fmt$(d.variableSpend)}\t${fmtPct(100 - d.lockInPct)}`);
  lines.push(`Projected Total\t${fmt$(d.annualTotal)}\t100%`);
  lines.push(`Mo.1 Monthly\t${fmt$(d.mo1Revenue)}\t`);
  lines.push(`Mo.12 Monthly\t${fmt$(d.mo12Revenue)}\t`);

  // 7 — Monthly Breakdown
  lines.push("");
  lines.push("MONTHLY BREAKDOWN");
  const hasT = d.includedProducts.some(p => p.type === "T");
  const moHdr = ["Mo", "Active Users", "New Users", "ONBRD (S)", "RECUR (R)", hasT ? "ONDMD (T)" : null, "Floor", "Plat.", "Total", "MoM Growth"].filter(Boolean);
  lines.push(moHdr.join("\t"));
  let prevTotal = null;
  d.monthlyUsers.forEach((users, i) => {
    const newU  = Math.max(0, users - (d.monthlyUsers[i - 1] || 0));
    const onbrd = d.includedProducts.filter(p => p.type === "S")
      .reduce((s, p) => s + getEffectiveRate(p, users, d.tieredPricing, d.tiers) * newU * d.avgAccounts, 0);
    const recur = d.includedProducts.filter(p => p.type === "R")
      .reduce((s, p) => s + getEffectiveRate(p, users, d.tieredPricing, d.tiers) * users * (p.isBundle ? 1 : d.avgAccounts), 0);
    const ondmd = d.includedProducts.filter(p => p.type === "T")
      .reduce((s, p) => s + getEffectiveRate(p, users, d.tieredPricing, d.tiers) * users * d.avgAccounts, 0);
    const floor = d.monthlyFloor[i];
    const total = onbrd + recur + ondmd + floor + d.pfMonthly;
    const growth = (prevTotal != null && prevTotal > 0) ? fmtPct((total - prevTotal) / prevTotal * 100) : "—";
    const row = [`Mo ${i + 1}`, fmtN(users), fmtN(newU), dash(onbrd), dash(recur), hasT ? dash(ondmd) : null, fmt$(floor), dash(d.pfMonthly), fmt$(total), growth].filter(v => v !== null);
    lines.push(row.join("\t"));
    prevTotal = total;
  });

  // 8 — ROI Summary (if available)
  if (d.roiData) {
    const r = d.roiData;
    const roiPct = r.productCost > 0 ? Math.round((r.netRoi / r.productCost) * 100) : null;
    lines.push("");
    lines.push("ROI SUMMARY");
    lines.push("\tValue");
    lines.push(`Annual Revenue Uplift\t${fmt$(r.annualGain)}`);
    lines.push(`Cost Savings\t${fmt$(r.totalSavings)}`);
    lines.push(`Net ROI\t${fmt$(r.netRoi)}`);
    lines.push(`ROI %\t${roiPct != null ? fmtPct(roiPct) : "—"}`);
    lines.push(`Payback Period\t${r.breakEven != null ? r.breakEven + " months" : "—"}`);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

// ── Pricing preview HTML ──────────────────────────────────────────────────────
const renderPricingPreviewHtml = (d, format) => {
  if (!d || !d.productRows.length) {
    return '<p style="font-family:monospace;font-size:11px;color:#444;margin:0">No pricing file saved.</p>';
  }

  const TH   = 'style="font-family:ui-monospace,monospace;font-size:9px;color:#555;padding:4px 10px;text-align:right;white-space:nowrap;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #222;"';
  const TH_L = 'style="font-family:ui-monospace,monospace;font-size:9px;color:#555;padding:4px 10px;text-align:left;white-space:nowrap;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #222;"';
  const TD   = 'style="font-family:ui-monospace,monospace;font-size:11px;color:#888;padding:3px 10px;text-align:right;white-space:nowrap;"';
  const TD_L = 'style="font-family:ui-monospace,monospace;font-size:11px;color:#888;padding:3px 10px;text-align:left;white-space:nowrap;"';
  const ROW0 = 'style="background:#0d0d0d"';
  const ROW1 = 'style="background:#111"';
  const SEC  = 'style="font-family:ui-monospace,monospace;font-size:9px;color:#f59e0b;text-transform:uppercase;letter-spacing:0.1em;margin:10px 0 4px;font-weight:600;"';
  const AMB  = 'style="background:#f59e0b1a"';
  const typeLbl = t => t === "R" ? "Recurring" : t === "S" ? "Single" : t === "T" ? "On-demand" : t;
  const tbl = (inner) => `<div style="overflow-x:auto;margin-bottom:8px"><table style="border-collapse:collapse;min-width:100%">${inner}</table></div>`;

  if (format === "exec") {
    return `<pre style="font-family:ui-monospace,monospace;font-size:11px;color:#888;margin:0;line-height:1.65;white-space:pre-wrap">${renderPricingExec(d).replace(/^PRICING\n/, "")}</pre>`;
  }

  // ── Products table (standard + detailed) ──
  const productTable = tbl(`
    <tr><th ${TH_L}>Product</th><th ${TH}>Type</th><th ${TH}>Rack</th><th ${TH}>Custom</th><th ${TH}>Discount</th><th ${TH}>Annual</th></tr>
    ${d.productRows.map((p, i) => `
      <tr ${i % 2 === 0 ? ROW0 : ROW1}>
        <td ${TD_L}>${p.name}</td>
        <td ${TD}>${typeLbl(p.type)}</td>
        <td ${TD}>${fmt$(p.rack)}</td>
        <td ${TD}>${fmt$(p.custom ?? p.rack)}</td>
        <td ${TD}>${p.discountPct}%</td>
        <td ${TD}>${fmt$(p.annualAtMo12)}</td>
      </tr>`).join("")}`);

  if (format !== "detailed") {
    const summaryLines = [];
    if (d.commitFee > 0) summaryLines.push(`Commitment: ${fmt$(d.commitFee)}/yr`);
    if (d.pfTier) summaryLines.push(`Platform fee: ${fmt$(getPfDiscounted(d.pfTier, d.pfDiscount))}/mo (${d.pfTier})`);
    summaryLines.push(`Mo.1: ${fmtN(d.mo1)} users  ·  Mo.12: ${fmtN(d.mo12)} users`);
    summaryLines.push(`Annual total: ${fmt$(d.annualTotal)}`);
    return `<p ${SEC}>Products</p>${productTable}<pre style="font-family:ui-monospace,monospace;font-size:11px;color:#888;margin:0 0 8px;line-height:1.5;white-space:pre">${summaryLines.join("\n")}</pre>`;
  }

  // ── Detailed: 7 sections ──
  const pfDisc = d.pfMonthly;

  // 1 — Products (9 cols, replaces standard 6-col table)
  const detailedProductTable = tbl(`
    <tr>
      <th ${TH_L}>Product</th><th ${TH}>Type</th><th ${TH}>Rack Rate</th><th ${TH}>Custom Rate</th>
      <th ${TH}>Discount %</th><th ${TH}>Savings vs Rack (Annual)</th>
      <th ${TH}>Mo.1 Cost</th><th ${TH}>Mo.12 Cost</th><th ${TH}>Annual (Mo.12 vol)</th>
    </tr>
    ${d.productRows.map((p, i) => `
      <tr ${i % 2 === 0 ? ROW0 : ROW1}>
        <td ${TD_L}>${p.name}</td>
        <td ${TD}>${typeLbl(p.type)}</td>
        <td ${TD}>${fmt$(p.rack)}</td>
        <td ${TD}>${fmt$(p.effectiveRate)}</td>
        <td ${TD}>${p.discountPct}%</td>
        <td ${TD}>${fmt$(p.savingsVsRack)}</td>
        <td ${TD}>${fmt$(p.mo1Cost)}</td>
        <td ${TD}>${fmt$(p.mo12Cost)}</td>
        <td ${TD}>${fmt$(p.annualAtMo12)}</td>
      </tr>`).join("")}`);

  // 2 — Platform fee
  const pfTable = tbl(`
    <tr><th ${TH_L}>Tier</th><th ${TH}>Base/mo</th><th ${TH}>Base/yr</th><th ${TH}>Discounted/mo</th><th ${TH}>Discounted/yr</th><th ${TH}>Monthly Savings</th><th ${TH}>Annual Savings</th></tr>
    <tr ${ROW0}>
      <td ${TD_L}>${d.pfTier || "None"}</td>
      <td ${TD}>${d.pfTier ? fmt$(d.pfBase) : "—"}</td>
      <td ${TD}>${d.pfTier ? fmt$(d.pfBase * 12) : "—"}</td>
      <td ${TD}>${d.pfTier ? fmt$(pfDisc) : "—"}</td>
      <td ${TD}>${d.pfTier ? fmt$(pfDisc * 12) : "—"}</td>
      <td ${TD}>${d.pfTier ? fmt$(d.pfBase - pfDisc) : "—"}</td>
      <td ${TD}>${d.pfTier ? fmt$(d.pfSavings) : "—"}</td>
    </tr>`);

  // 3 — API Commitment Ramp
  const moThs = Array.from({ length: 12 }, (_, i) => `<th ${TH}>M${i + 1}</th>`).join("");
  const rampTable = tbl(`
    <tr><th ${TH_L}>Commit ${fmt$(d.commitFee)}/yr</th>${moThs}</tr>
    <tr ${ROW0}><td ${TD_L}>Floor</td>${d.monthlyFloor.map(v => `<td ${TD}>${fmt$(v)}</td>`).join("")}</tr>`);

  // 4 — Annual Totals (labeled rows with amber highlights)
  const pct4 = (num) => d.annualTotal > 0 ? Math.round(num / d.annualTotal * 100) + "%" : "—";
  const totalsRows = [
    ["Single-touch", d.annualSingle, pct4(d.annualSingle), false],
    ["Recurring", d.annualRecurring, pct4(d.annualRecurring), false],
    ...(d.annualOnDemand > 0 ? [["On-demand", d.annualOnDemand, pct4(d.annualOnDemand), false]] : []),
    ["Platform Fee", d.pfAnnual, pct4(d.pfAnnual), false],
    ["Commitment Fee", d.commitFee, pct4(d.commitFee), false],
    ["Deal Total (projected)", d.annualTotal, "100%", true],
    ["Rack Total", d.annualRack, "—", false],
    ["Savings vs Rack", d.annualSavings, fmtPct(d.savingsPct), true],
  ];
  const totalsTable = tbl(`
    <tr><th ${TH_L}>Component</th><th ${TH}>Amount</th><th ${TH}>% of Total</th></tr>
    ${totalsRows.map(([label, amount, share, highlight], i) => `
      <tr ${highlight ? AMB : (i % 2 === 0 ? ROW0 : ROW1)}>
        <td ${TD_L}>${label}</td>
        <td ${TD}>${fmt$(amount)}</td>
        <td ${TD}>${share}</td>
      </tr>`).join("")}`);

  // 5 — Scenario Range
  const scenarioTable = tbl(`
    <tr><th ${TH_L}>Scenario</th><th ${TH}>Amount/yr</th><th ${TH}>vs Base Case</th></tr>
    <tr ${ROW0}><td ${TD_L}>Conservative (-25% volume)</td><td ${TD}>${fmt$(d.conservative)}</td><td ${TD}>-${fmt$(d.annualTotal - d.conservative)}</td></tr>
    <tr ${ROW1}><td ${TD_L}>Base Case (projected volumes)</td><td ${TD}>${fmt$(d.annualTotal)}</td><td ${TD}>—</td></tr>
    <tr ${ROW0}><td ${TD_L}>Best Case (+25% volume)</td><td ${TD}>${fmt$(d.bestCase)}</td><td ${TD}>+${fmt$(d.bestCase - d.annualTotal)}</td></tr>`);

  // 6 — Lock-in vs Projected
  const lockTable = tbl(`
    <tr><th ${TH_L}>Component</th><th ${TH}>Amount</th><th ${TH}>% of Total Deal</th></tr>
    <tr ${ROW0}><td ${TD_L}>Minimum (0 users) — commitment + platform</td><td ${TD}>${fmt$(d.minimumLockIn)}</td><td ${TD}>${fmtPct(d.lockInPct)}</td></tr>
    <tr ${ROW1}><td ${TD_L}>Variable (user-driven API spend)</td><td ${TD}>${fmt$(d.variableSpend)}</td><td ${TD}>${fmtPct(100 - d.lockInPct)}</td></tr>
    <tr ${ROW0}><td ${TD_L}>Projected Total</td><td ${TD}>${fmt$(d.annualTotal)}</td><td ${TD}>100%</td></tr>
    <tr ${ROW1}><td ${TD_L}>Mo.1 Monthly</td><td ${TD}>${fmt$(d.mo1Revenue)}</td><td ${TD}>—</td></tr>
    <tr ${ROW0}><td ${TD_L}>Mo.12 Monthly</td><td ${TD}>${fmt$(d.mo12Revenue)}</td><td ${TD}>—</td></tr>`);

  // 7 — Monthly Breakdown (with MoM Growth)
  const hasT = d.includedProducts.some(p => p.type === "T");
  let prevTotal = null;
  const moRows = d.monthlyUsers.map((users, i) => {
    const newU = Math.max(0, users - (d.monthlyUsers[i - 1] || 0));
    const onbrd = d.includedProducts.filter(p => p.type === "S")
      .reduce((s, p) => s + getEffectiveRate(p, users, d.tieredPricing, d.tiers) * newU * d.avgAccounts, 0);
    const recur = d.includedProducts.filter(p => p.type === "R")
      .reduce((s, p) => s + getEffectiveRate(p, users, d.tieredPricing, d.tiers) * users * (p.isBundle ? 1 : d.avgAccounts), 0);
    const ondmd = d.includedProducts.filter(p => p.type === "T")
      .reduce((s, p) => s + getEffectiveRate(p, users, d.tieredPricing, d.tiers) * users * d.avgAccounts, 0);
    const floor = d.monthlyFloor[i];
    const total = onbrd + recur + ondmd + floor + pfDisc;
    const growth = (prevTotal != null && prevTotal > 0) ? fmtPct((total - prevTotal) / prevTotal * 100) : "—";
    prevTotal = total;
    return `<tr ${i % 2 === 0 ? ROW0 : ROW1}>
      <td ${TD_L}>Mo ${i + 1}</td>
      <td ${TD}>${fmtN(users)}</td>
      <td ${TD}>${fmtN(newU)}</td>
      <td ${TD}>${dash(onbrd)}</td>
      <td ${TD}>${dash(recur)}</td>
      ${hasT ? `<td ${TD}>${dash(ondmd)}</td>` : ""}
      <td ${TD}>${fmt$(floor)}</td>
      <td ${TD}>${dash(pfDisc)}</td>
      <td ${TD}>${fmt$(total)}</td>
      <td ${TD}>${growth}</td>
    </tr>`;
  }).join("");
  const breakdownTable = tbl(`
    <tr>
      <th ${TH_L}>Mo</th><th ${TH}>Active</th><th ${TH}>New</th>
      <th ${TH}>ONBRD (S)</th><th ${TH}>RECUR (R)</th>
      ${hasT ? `<th ${TH}>ONDMD (T)</th>` : ""}
      <th ${TH}>Floor</th><th ${TH}>Plat.</th><th ${TH}>Total</th><th ${TH}>MoM Growth</th>
    </tr>${moRows}`);

  return [
    `<p ${SEC}>1 · Products</p>`, detailedProductTable,
    `<p ${SEC}>2 · Platform Fee</p>`, pfTable,
    `<p ${SEC}>3 · API Commitment Ramp</p>`, rampTable,
    `<p ${SEC}>4 · Annual Totals</p>`, totalsTable,
    `<p ${SEC}>5 · Scenario Range</p>`, scenarioTable,
    `<p ${SEC}>6 · Lock-in vs Projected</p>`, lockTable,
    `<p ${SEC}>7 · Monthly Breakdown</p>`, breakdownTable,
  ].join("");
};

// ── ROI calculation (mirrors DealSummaryModal) ────────────────────────────────
function computeRoi(acc, pFile, rFile) {
  const hasBoth = !!(pFile && rFile);
  const calcMonthlyCosts = (f) => {
    if (!f?.products || !f?.monthlyUsers) return Array(12).fill(0);
    try {
      const prods = f.products.filter(p => p.included);
      const pfAmt = getPfDiscounted(f.pfTier, f.pfDiscount);
      const sessionCtx = { avgAccounts: f.avgAccounts || 2.5, onDemand: f.onDemand || 0, tierMult: 1 };
      return Array.from({ length: 12 }, (_, i) => {
        const monthCtx = monthUsersAt(f.monthlyUsers, i);
        let apiSpend = 0;
        prods.forEach(p => { apiSpend += productMonthlyCost(p, monthCtx, sessionCtx); });
        const floorThisMo = f.commitRamp ? (f.commitRampSched?.[i] || 0) : (f.commitFee || 0);
        const apiCharge = floorThisMo > 0 ? Math.max(apiSpend, floorThisMo) : apiSpend;
        return Math.round(apiCharge + (f.pfRamp ? (f.pfRampSched?.[i] || 0) : pfAmt) + (f.isPartner ? (f.partnerFee || 0) : 0));
      });
    } catch { return Array(12).fill(0); }
  };

  const mu = pFile?.monthlyUsers || [];
  const avgRPU = rFile?.avgRevenuePerUser || 0;
  const costSPU = rFile?.manualCostSavingPerUser || 0;
  const integrationCost = rFile?.integrationCost || 0;
  const newUsersAtMo = i => i === 0 ? (mu[0] || 0) : Math.max(0, (mu[i] || 0) - (mu[i - 1] || 0));
  const monthlyRevArr = mu.map(u => u * avgRPU / 12);
  const monthlySavArr = mu.map((_, i) => newUsersAtMo(i) * costSPU);
  const monthlyCostArr = hasBoth ? calcMonthlyCosts(pFile) : Array(12).fill(0);
  const monthlyGainArr = monthlyRevArr.map((v, i) => v + monthlySavArr[i]);
  const annualRevenue = monthlyRevArr.reduce((s, v) => s + v, 0);
  const totalSavings = monthlySavArr.reduce((s, v) => s + v, 0);
  const annualGainP = annualRevenue + totalSavings;
  const annualCostP = monthlyCostArr.reduce((s, v) => s + v, 0);

  const r = rFile || {};
  const ma = r.monthlyAttempts || 0, cr = r.currentConvRate || 0, pr = r.newConvRate || 0;
  const addPerMo = ma * (pr - cr) / 100;
  const addPerYr = Math.round(addPerMo * 12);
  const revUplift = Math.round(addPerYr * (r.avgAnnualRevenue || avgRPU || 0));
  const costSavM = Math.round(ma * 12 * (r.manualCostPerAttempt || costSPU || 0) * (pr - cr) / 100);
  const annualGainM = revUplift + costSavM;

  const annualGain = hasBoth ? annualGainP : annualGainM;
  const productCost = hasBoth ? annualCostP : (r.manualCost || 0);
  const netRoi = annualGain - productCost;
  const roiRatio = productCost > 0 ? (annualGain / productCost).toFixed(1) : null;

  const cumulativeData = hasBoth
    ? Array.from({ length: 12 }, (_, i) => {
        let cum = -integrationCost;
        for (let m = 0; m <= i; m++) cum += monthlyGainArr[m] - monthlyCostArr[m];
        return cum;
      })
    : Array.from({ length: 12 }, (_, i) => (i + 1) * annualGain / 12 - (i + 1) * productCost / 12 - integrationCost);

  const breakEven = (() => {
    for (let m = 0; m < cumulativeData.length; m++) { if (cumulativeData[m] >= 0) return m + 1; }
    return null;
  })();

  return { annualGain, productCost, netRoi, roiRatio, breakEven, annualRevenue, totalSavings, revUplift, costSavM, hasBoth, mu };
}

// ── Custom template token substitution ───────────────────────────────────────
function applyTemplate(tpl, acc, pFile, rFile) {
  const roi = computeRoi(acc, pFile, rFile);
  const pricing = computePricing(pFile);
  const mu = pFile?.monthlyUsers || [];
  const included = (pFile?.products || []).filter(p => p.included);
  const tokens = {
    account_name: acc.name || "—",
    tier: acc.tier || "—",
    stage: acc.stage || "—",
    vertical: acc.vert || "—",
    business_model: acc.bm || "—",
    product_fit: acc.pf || "—",
    products: included.map(p => p.name).join(", ") || "—",
    commitment: pFile?.commitFee ? `$${pFile.commitFee.toLocaleString()}/mo` : "—",
    roi_ratio: roi.roiRatio ? `$${roi.roiRatio}` : "—",
    net_roi: fmt(roi.netRoi),
    annual_gain: fmt(roi.annualGain),
    product_cost: fmt(roi.productCost),
    break_even: roi.breakEven ? `Month ${roi.breakEven}` : "—",
    mo1_users: (mu[0] || 0).toLocaleString(),
    mo12_users: (mu[11] || mu[mu.length - 1] || 0).toLocaleString(),
    annual_investment: pricing ? fmt$(pricing.annualTotal) : "—",
  };
  return tpl.replace(/\[(\w+)\]/g, (_, k) => tokens[k] !== undefined ? tokens[k] : `[${k}]`);
}

// ── Component registry ────────────────────────────────────────────────────────
const EXPORT_COMPONENTS = [
  {
    id: "deal_summary",
    label: "Deal Summary",
    description: "Account name, tier, deal stage, vertical, business model, product fit",
    defaultChecked: true,
    getData: (acc, pFile, rFile) => ({
      name: acc.name, tier: acc.tier, stage: acc.stage, vert: acc.vert,
      bm: acc.bm, pf: acc.pf, prods: acc.prods, sigs: acc.sigs, dis: acc.dis,
    }),
    renderText: (d) => [
      `DEAL SUMMARY — ${d.name}`,
      d.tier ? `Tier: ${d.tier}` : null,
      d.stage ? `Stage: ${d.stage}` : null,
      d.vert ? `Vertical: ${d.vert}` : null,
      d.bm ? `\nBusiness Model:\n${d.bm}` : null,
      d.pf ? `\nProduct Fit:\n${d.pf}` : null,
      d.prods?.length ? `\nProducts: ${d.prods.join(", ")}` : null,
      d.sigs?.length ? `\nKey Signals:\n${d.sigs.map(s => `  • ${s}`).join("\n")}` : null,
      d.dis ? `\n⚠ Disqualifier: ${d.dis}` : null,
    ].filter(Boolean).join("\n"),
    renderSlide: (d) => [{
      label: "Deal Summary",
      body: [
        d.tier ? `Tier: ${d.tier}` : null,
        d.stage ? `Stage: ${d.stage}` : null,
        d.vert ? `Vertical: ${d.vert}` : null,
        d.bm ? `Business Model: ${d.bm}` : null,
        d.pf ? `Product Fit: ${d.pf}` : null,
        d.prods?.length ? `Products: ${d.prods.join(", ")}` : null,
      ].filter(Boolean).join("\n"),
    }],
  },
  {
    id: "pricing",
    label: "Pricing",
    description: "Commitment fee, platform fee, products, volume ramp Mo.1→Mo.12",
    defaultChecked: true,
    getData: (acc, pFile, rFile) => ({ ...computePricing(pFile), roiData: rFile ? computeRoi(acc, pFile, rFile) : null }),
    renderText: (d, opts = {}) => {
      const format = opts.format || "standard";
      if (format === "exec")     return renderPricingExec(d);
      if (format === "detailed") return renderPricingDetailed(d, opts);
      return renderPricingStandard(d);
    },
    renderPreviewHtml: (d, opts = {}) => renderPricingPreviewHtml(d, opts.format || "standard"),
    renderSlide: (d, opts = {}) => {
      const format = opts.format || "standard";
      if (format === "detailed" && d?.productRows?.length) {
        return [
          {
            label: "Pricing — Products",
            body: [
              "Product  |  Type  |  Rack  |  Custom  |  Discount  |  Annual",
              ...d.productRows.map(p => `${p.name}  |  ${p.type}  |  ${fmt$(p.rack)}  |  ${fmt$(p.effectiveRate)}  |  ${p.discountPct}%  |  ${fmt$(p.annualAtMo12)}`),
              "",
              d.commitFee > 0 ? `Commitment: ${fmt$(d.commitFee)}/mo` : null,
              d.pfTier ? `Platform fee: ${fmt$(getPfDiscounted(d.pfTier, d.pfDiscount))}/mo (${d.pfTier})` : null,
              `Annual total: ${fmt$(d.annualTotal)}`,
            ].filter(l => l !== null).join("\n"),
          },
          {
            label: "Pricing — Monthly Ramp",
            body: [
              Array.from({ length: 12 }, (_, i) => `Mo.${i + 1}`).join("\t"),
              d.monthlyUsers.map(fmtN).join("\t"),
              d.monthlyRevenue.map(fmt$).join("\t"),
            ].join("\n"),
          },
        ];
      }
      return [{ label: "Pricing", body: renderPricingExec(d).replace(/^PRICING\n/, "") }];
    },
  },
  {
    id: "roi",
    label: "ROI",
    description: "Cost savings, conversion uplift, net ROI",
    defaultChecked: true,
    getData: (acc, pFile, rFile) => ({ ...computeRoi(acc, pFile, rFile) }),
    renderText: (d) => {
      if (!d.annualGain && !d.productCost) return "ROI\n  No ROI data available.";
      return [
        "ROI",
        `  Annual Cost: ${fmt(d.productCost)}`,
        d.annualRevenue ? `  Revenue Uplift:    ${fmt(d.annualRevenue || d.revUplift)}` : null,
        d.totalSavings  ? `  Cost Savings:      ${fmt(d.totalSavings || d.costSavM)}` : null,
        `  Annual Gain:       ${fmt(d.annualGain)}`,
        `  Net ROI:           ${fmt(d.netRoi)}`,
        d.roiRatio ? `  ROI Ratio:         $${d.roiRatio} return per $1 spent` : null,
        d.breakEven ? `  Break-even:        Month ${d.breakEven}` : null,
      ].filter(Boolean).join("\n");
    },
    renderSlide: (d) => [{
      label: "ROI",
      body: [
        `Annual Cost: ${fmt(d.productCost)}`,
        `Annual Gain: ${fmt(d.annualGain)}`,
        `Net ROI: ${fmt(d.netRoi)}`,
        d.roiRatio ? `ROI Ratio: $${d.roiRatio} per $1` : null,
        d.breakEven ? `Break-even: Month ${d.breakEven}` : null,
      ].filter(Boolean).join("\n"),
    }],
  },
  {
    id: "medpicc",
    label: "MEDPICC",
    description: "All 7 MEDPICC fields with current values",
    defaultChecked: false,
    getData: (acc, pFile, rFile) => ({ medpicc: acc.medpicc || {} }),
    renderText: (d) => {
      const lines = ["MEDPICC"];
      MEDPICC_FIELDS.forEach(f => {
        lines.push(`  ${f.label.padEnd(22)}${d.medpicc[f.key] || "—"}`);
      });
      return lines.join("\n");
    },
    renderSlide: (d) => [{ label: "MEDPICC", body: MEDPICC_FIELDS.map(f => `${f.label}: ${d.medpicc[f.key] || "—"}`).join("\n") }],
  },
  {
    id: "next_steps",
    label: "Next Steps",
    description: "Most recent call's next steps with dates and owners",
    defaultChecked: false,
    getData: (acc, pFile, rFile) => {
      const calls = acc.calls || [];
      const recent = calls[calls.length - 1];
      return { nextSteps: recent?.nextSteps || [], date: recent?.date || null };
    },
    renderText: (d) => {
      if (!d.nextSteps?.length) return "NEXT STEPS\n  No next steps recorded.";
      const lines = ["NEXT STEPS"];
      d.nextSteps.forEach(ns => {
        const text = typeof ns === 'string' ? ns : (ns?.text || '');
        const due = typeof ns === 'object' ? ns?.dueDate : null;
        const owner = typeof ns === 'object' ? ns?.owner : null;
        lines.push(`  → ${due ? `[${due}] ` : ""}${owner ? `${owner}: ` : ""}${text}`);
      });
      return lines.join("\n");
    },
    renderSlide: (d) => [{
      label: "Next Steps",
      body: !d.nextSteps?.length ? "No next steps recorded." : d.nextSteps.map(ns => {
        const text = typeof ns === 'string' ? ns : (ns?.text || '');
        const due = typeof ns === 'object' ? ns?.dueDate : null;
        return `→ ${due ? `[${due}] ` : ""}${text}`;
      }).join("\n"),
    }],
  },
  {
    id: "call_summary",
    label: "Call Summary",
    description: "Most recent call summary and top pain points",
    defaultChecked: false,
    getData: (acc, pFile, rFile) => {
      const calls = acc.calls || [];
      const recent = calls[calls.length - 1];
      return { summary: recent?.summary || null, date: recent?.date || null, painPoints: (recent?.painPoints || []).slice(0, 3) };
    },
    renderText: (d) => {
      if (!d.summary) return "CALL SUMMARY\n  No calls recorded.";
      const lines = [`CALL SUMMARY${d.date ? ` (${d.date})` : ""}`];
      lines.push(`\n${d.summary}`);
      if (d.painPoints?.length) {
        lines.push("\nPain Points:");
        d.painPoints.forEach(p => { const topic = typeof p === 'string' ? p : (p?.topic || ''); lines.push(`  • ${topic}`); });
      }
      return lines.join("\n");
    },
    renderSlide: (d) => [{
      label: "Call Summary",
      body: !d.summary ? "No calls recorded." : [
        d.summary,
        ...(d.painPoints?.length ? ["\nPain Points:", ...d.painPoints.map(p => `• ${typeof p === 'string' ? p : (p?.topic || '')}`)] : []),
      ].join("\n"),
    }],
  },
];

// ── Main component ────────────────────────────────────────────────────────────
export default function DealExportModal({ accId, acc, onClose }) {
  const [tab, setTab] = useState("copy");
  const [pricingFormat, setPricingFormat] = useState("standard");
  const [checked, setChecked] = useState(() => {
    const s = {};
    EXPORT_COMPONENTS.forEach(c => { s[c.id] = c.defaultChecked; });
    return s;
  });
  const [copied, setCopied] = useState(false);
  const [slidesLoading, setSlidesLoading] = useState(false);
  const [slidesError, setSlidesError] = useState(null);
  const [slidesNeedsReauth, setSlidesNeedsReauth] = useState(false);
  const [selectedFmtId, setSelectedFmtId] = useState(null);

  const pFile = (() => { try { return JSON.parse(localStorage.getItem("prospector_pricing_files") || "{}")[accId] || null; } catch { return null; } })();
  const rFile = (() => { try { return JSON.parse(localStorage.getItem(ROI_KEY) || "{}")[accId] || null; } catch { return null; } })();
  const savedFormats = (() => { try { return JSON.parse(localStorage.getItem("prospector_export_format") || "{}").savedFormats || []; } catch { return []; } })();

  useEffect(() => {
    if (tab !== "slides") return;
    const token = localStorage.getItem("gmail_access_token");
    if (!token) return;
    fetch("https://slides.googleapis.com/v1/presentations/scope_check_placeholder", {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => { if (r.status === 403) setSlidesNeedsReauth(true); }).catch(() => {});
  }, [tab]);

  const activeUser = (() => { try { return JSON.parse(localStorage.getItem("prospector_user") || "null"); } catch { return null; } })();
  const opts = { format: pricingFormat, acc, rFile, activeUser };

  const assembleText = () =>
    EXPORT_COMPONENTS
      .filter(c => checked[c.id])
      .map(c => c.renderText(c.getData(acc, pFile, rFile), opts))
      .join("\n\n");

  const assembleSlideData = () =>
    EXPORT_COMPONENTS
      .filter(c => checked[c.id])
      .flatMap(c => c.renderSlide(c.getData(acc, pFile, rFile), opts));

  const selectedCount = Object.values(checked).filter(Boolean).length;

  const handleCopy = () => {
    const text = (tab === "custom" && selectedFmtId)
      ? (() => { const f = savedFormats.find(f => f.id === selectedFmtId); return f ? applyTemplate(f.template, acc, pFile, rFile) : assembleText(); })()
      : assembleText();
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); });
  };

  const handlePDF = () => {
    const htmlSections = EXPORT_COMPONENTS.filter(c => checked[c.id]).map(c => {
      const data = c.getData(acc, pFile, rFile);
      const text = c.renderText(data, opts);
      return `<div style="margin-bottom:28px">
        <h2 style="font-size:13px;font-weight:700;color:#333;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin:0 0 10px">${c.label}</h2>
        <pre style="font-size:12px;color:#444;white-space:pre-wrap;font-family:Arial,sans-serif;line-height:1.7;margin:0">${text.replace(/^[A-Z \/\-—]+\n/, "")}</pre>
      </div>`;
    }).join("");
    const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const html = `<!DOCTYPE html><html><head><title>${acc.name} — Deal Summary</title>
      <style>body{font-family:Arial,sans-serif;max-width:680px;margin:40px auto;color:#222;} @media print{body{margin:0;max-width:100%;}}</style>
    </head><body>
      <h1 style="font-size:22px;margin:0 0 4px;font-weight:700">${acc.name}</h1>
      <p style="font-size:12px;color:#888;margin:0 0 32px">Deal Summary — ${dateStr}</p>
      ${htmlSections}
    </body></html>`;
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.print();
  };

  const handleSlides = async () => {
    const token = localStorage.getItem("gmail_access_token");
    if (!token) { setSlidesError("No Google access token — connect Google first."); return; }
    setSlidesLoading(true);
    setSlidesError(null);
    try {
      const res = await fetch("/api/slides/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ components: assembleSlideData(), accountName: acc.name, accessToken: token }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Slides creation failed");
      window.open(data.slidesDeckUrl, "_blank");
    } catch (e) {
      setSlidesError(e.message || "Slides generation failed — use Copy / Paste instead");
    }
    setSlidesLoading(false);
  };

  const TABS = [
    { id: "copy",   label: "📋 Copy / Paste" },
    { id: "pdf",    label: "📄 PDF" },
    { id: "slides", label: "📊 Google Slides" },
    { id: "custom", label: "✏️ Custom" },
  ];

  const FORMAT_PILLS = [
    { id: "exec",     label: "Exec" },
    { id: "standard", label: "Standard" },
    { id: "detailed", label: "Detailed" },
  ];

  const ctaDisabled = slidesLoading || (tab === "custom" && savedFormats.length === 0) || (tab !== "custom" && selectedCount === 0);
  const ctaLabel = tab === "pdf"
    ? "Download PDF →"
    : tab === "slides"
      ? (slidesLoading ? "Creating your deck…" : "Generate in Google Slides →")
      : tab === "custom"
        ? "Export with template →"
        : (copied ? "✓ Copied!" : "Copy to clipboard →");

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1200, background: "#00000099", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 12, width: 700, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px #000f" }}>

        {/* Header */}
        <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${C.brd}`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div>
            <p style={{ ...mono, margin: 0, fontSize: 10, color: C.gold, textTransform: "uppercase", letterSpacing: "0.1em" }}>Export</p>
            <p style={{ margin: "2px 0 0", fontSize: 15, fontWeight: 700, color: C.txt }}>{acc.name}</p>
          </div>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "transparent", border: "none", color: C.mut, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

          {/* ZONE 1 — export format tabs */}
          <div style={{ display: "flex", gap: 5, marginBottom: 16 }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ ...mono, fontSize: 11, padding: "5px 12px", background: tab === t.id ? `${C.gold}18` : "transparent", border: `1px solid ${tab === t.id ? C.goldBdr : C.brd}`, color: tab === t.id ? C.gold : C.mut, borderRadius: 5, cursor: "pointer", whiteSpace: "nowrap" }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Slides reauth notice */}
          {tab === "slides" && slidesNeedsReauth && (
            <div style={{ ...mono, fontSize: 11, color: C.orange, background: `${C.orange}12`, border: `1px solid ${C.orange}33`, borderRadius: 5, padding: "8px 12px", marginBottom: 12 }}>
              Reconnect Google to enable Slides export —{" "}
              <a href="/api/gmail/auth" style={{ color: C.orange, textDecoration: "underline" }}>Reconnect →</a>
            </div>
          )}

          {/* Custom tab — format picker */}
          {tab === "custom" && (
            <div style={{ marginBottom: 14 }}>
              {savedFormats.length === 0
                ? <p style={{ ...mono, fontSize: 11, color: C.dim, margin: 0 }}>No saved formats — create one in the Pricing page.</p>
                : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ ...mono, fontSize: 11, color: C.mut }}>Format:</span>
                    <select value={selectedFmtId || ""} onChange={e => setSelectedFmtId(e.target.value || null)}
                      style={{ ...mono, fontSize: 11, padding: "4px 8px", background: C.sur, border: `1px solid ${C.brd}`, color: C.txt, borderRadius: 4, cursor: "pointer", outline: "none" }}>
                      <option value="">— select a format —</option>
                      {savedFormats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </div>
                )
              }
            </div>
          )}

          {/* ZONE 2 — FORMAT pills + component selector (hidden on custom tab) */}
          {tab !== "custom" && (
            <div style={{ marginBottom: 14 }}>

              {/* FORMAT pills */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <span style={{ ...mono, fontSize: 10, color: C.dim, textTransform: "uppercase", letterSpacing: "0.08em", marginRight: 2 }}>Format</span>
                {FORMAT_PILLS.map(f => (
                  <button key={f.id} onClick={() => setPricingFormat(f.id)}
                    style={{ ...mono, fontSize: 11, padding: "3px 10px", background: pricingFormat === f.id ? `${C.gold}18` : "transparent", border: `1px solid ${pricingFormat === f.id ? C.goldBdr : C.brd}`, color: pricingFormat === f.id ? C.gold : C.dim, borderRadius: 4, cursor: "pointer" }}>
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Component cards */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 7 }}>
                {EXPORT_COMPONENTS.map(c => (
                  <label key={c.id}
                    style={{ display: "flex", alignItems: "flex-start", gap: 8, background: checked[c.id] ? `${C.gold}0a` : C.sur, border: `1px solid ${checked[c.id] ? C.goldBdr : C.brd}`, borderRadius: 6, padding: "9px 11px", cursor: "pointer", userSelect: "none" }}>
                    <input type="checkbox" checked={!!checked[c.id]} onChange={e => setChecked(s => ({ ...s, [c.id]: e.target.checked }))}
                      style={{ marginTop: 2, accentColor: C.gold, flexShrink: 0 }} />
                    <div>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: checked[c.id] ? C.txt : C.mut, lineHeight: 1.3 }}>{c.label}</p>
                      <p style={{ ...mono, margin: "2px 0 0", fontSize: 10, color: C.dim, lineHeight: 1.4 }}>{c.description}</p>
                    </div>
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={() => setChecked(() => { const n = {}; EXPORT_COMPONENTS.forEach(c => n[c.id] = true); return n; })}
                  style={{ ...mono, fontSize: 10, background: "transparent", border: "none", color: C.mut, cursor: "pointer", padding: 0, textDecoration: "underline" }}>Select all</button>
                <button onClick={() => setChecked(() => { const n = {}; EXPORT_COMPONENTS.forEach(c => n[c.id] = false); return n; })}
                  style={{ ...mono, fontSize: 10, background: "transparent", border: "none", color: C.mut, cursor: "pointer", padding: 0, textDecoration: "underline" }}>Clear all</button>
                <span style={{ ...mono, fontSize: 10, color: C.dim, marginLeft: "auto" }}>{selectedCount} selected</span>
              </div>
            </div>
          )}

          {/* ZONE 3 — preview */}
          <div style={{ background: "#0a0a0a", border: `1px solid ${C.brd}`, borderRadius: 6, padding: "10px 14px", maxHeight: 200, overflowY: "auto" }}>
            {tab === "custom" ? (
              <pre style={{ ...mono, fontSize: 11, color: "#666", margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.65 }}>
                {(selectedFmtId ? (() => { const f = savedFormats.find(f => f.id === selectedFmtId); return f ? applyTemplate(f.template, acc, pFile, rFile) : "Select a format above."; })() : "Select a format above.").split("\n").map((line, i) => {
                  const trimmed = line.trim();
                  const isHeader = trimmed.length > 2 && trimmed === trimmed.toUpperCase() && /^[A-Z]/.test(trimmed) && !/^[\$\d•→?—]/.test(trimmed);
                  return <span key={i} style={{ color: isHeader ? C.gold : "#666" }}>{line}{"\n"}</span>;
                })}
              </pre>
            ) : selectedCount === 0 ? (
              <p style={{ ...mono, fontSize: 11, color: "#444", margin: 0 }}>Select at least one component above.</p>
            ) : (
              EXPORT_COMPONENTS.filter(c => checked[c.id]).map((c, i) => {
                const data = c.getData(acc, pFile, rFile);
                if (c.renderPreviewHtml) {
                  return (
                    <div key={c.id}>
                      {i > 0 && <div style={{ borderTop: `1px solid #1a1a1a`, margin: "8px 0" }} />}
                      <p style={{ ...mono, fontSize: 9, color: C.gold, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 5px" }}>{c.label}</p>
                      <div dangerouslySetInnerHTML={{ __html: c.renderPreviewHtml(data, opts) }} />
                    </div>
                  );
                }
                const text = c.renderText(data, opts);
                return (
                  <pre key={c.id} style={{ ...mono, fontSize: 11, color: "#666", margin: i > 0 ? "8px 0 0" : 0, whiteSpace: "pre-wrap", lineHeight: 1.65 }}>
                    {text.split("\n").map((line, j) => {
                      const trimmed = line.trim();
                      const isHeader = trimmed.length > 2 && trimmed === trimmed.toUpperCase() && /^[A-Z]/.test(trimmed) && !/^[\$\d•→?—]/.test(trimmed);
                      return <span key={j} style={{ color: isHeader ? C.gold : "#666" }}>{line}{"\n"}</span>;
                    })}
                  </pre>
                );
              })
            )}
          </div>

          {slidesError && (
            <p style={{ ...mono, fontSize: 11, color: C.red, margin: "8px 0 0" }}>{slidesError}</p>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.brd}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <button onClick={onClose}
            style={{ ...mono, fontSize: 12, padding: "6px 14px", background: "transparent", border: `1px solid ${C.brd}`, color: C.mut, borderRadius: 6, cursor: "pointer" }}>
            Close
          </button>
          <button
            disabled={ctaDisabled}
            onClick={() => { if (tab === "pdf") handlePDF(); else if (tab === "slides") handleSlides(); else handleCopy(); }}
            style={{ ...mono, fontSize: 12, padding: "6px 18px", background: copied ? `${C.green}18` : `${C.gold}18`, border: `1px solid ${copied ? C.green : C.goldBdr}`, color: copied ? C.green : C.gold, borderRadius: 6, cursor: ctaDisabled ? "not-allowed" : "pointer", fontWeight: 600, opacity: ctaDisabled ? 0.45 : 1, transition: "all 0.15s" }}>
            {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
