import React, { useState, useMemo, useRef } from 'react';
import { C, mono } from '../../constants/colors';
import { MODELS } from '../../config/models';
import { computePricing } from '../../utils/pricing';
import { FILES_KEY } from '../../utils/storageKeys';

function buildProposalContext(linkedAcc, customContext, pricingState) {
  const activeUser = (() => { try { return JSON.parse(localStorage.getItem("prospector_user") || "{}"); } catch { return {}; } })();
  const accId = linkedAcc?.id;
  const pFile = JSON.parse(localStorage.getItem(FILES_KEY) || "{}")[accId] || null;

  let monthlyBreakdown, annualTotal, annualRack, annualSavings, savingsPct;
  let includedProducts, commitFee, pfTier, pfAnnual;

  if (pricingState) {
    const { products, monthlyBreakdown: mb, avgAccounts, onDemand } = pricingState;

    monthlyBreakdown = (mb || []).map((m, i) => ({
      mo:       i + 1,
      users:    m.activeUsersThisMo,
      newUsers: m.newUsersThisMo,
      apiSpend: (m.singleCost || 0) + (m.recurringCost || 0) + (m.onDemandCost || 0),
      floor:    m.floorThisMo,
      plat:     m.dealPf,
      total:    m.total,
    }));

    annualTotal   = pricingState.annualTotal || 0;
    annualSavings = pricingState.annualSavings || 0;
    annualRack    = annualTotal + annualSavings;
    savingsPct    = annualRack > 0 ? Math.round((annualSavings / annualRack) * 100) : 0;
    commitFee     = pricingState.commitFee || 0;
    pfTier        = pricingState.pfTier || null;
    pfAnnual      = pricingState.annualPfTotal || 0;

    const selectedProducts = (products || []).filter(p => p.included);
    includedProducts = selectedProducts.map(p => {
      const c = p.custom ?? p.rack ?? 0;
      const a = (p.adoptionPct ?? 100) / 100;
      const annual = (mb || []).reduce((s, m) => {
        if (p.type === "S") return s + c * (m.newUsersThisMo || 0) * (avgAccounts || 1) * a;
        if (p.type === "R") return s + c * (m.activeUsersThisMo || 0) * (p.isBundle ? 1 : (avgAccounts || 1)) * a;
        if (p.type === "T") return s + c * (onDemand || 0) * (m.activeUsersThisMo || 0) * a;
        return s;
      }, 0);
      const discountPct = p.rack > 0 && p.custom != null ? Math.round((1 - (p.custom ?? p.rack) / p.rack) * 100) : 0;
      return { ...p, annualAtMo12: annual, discountPct };
    });

  } else {
    const pricing = pFile ? computePricing(pFile) : null;
    const {
      annualRack: pricingRack = 0, savingsPct: pricingSavingsPct = 0,
      productRows = [], pfMonthly = 0, commitFee: pricingCommit = 0,
    } = pricing || {};

    commitFee = pFile?.commitFee ?? pricingCommit;
    const pfRamp      = pFile?.pfRamp || false;
    const pfRampSched = pFile?.pfRampSched || Array(12).fill(pfMonthly);

    monthlyBreakdown = (pFile?.monthlyUsers || Array(12).fill(0)).map((users, i) => {
      const prevUsers = i > 0 ? (pFile.monthlyUsers[i - 1] || 0) : 0;
      const newUsers  = Math.max(0, users - prevUsers);
      const avg       = pFile?.avgAccounts || 1;
      const apiSpend  = productRows.reduce((s, p) => {
        const r = p.effectiveRate ?? p.custom ?? p.rack ?? 0;
        if (p.type === "S") return s + r * newUsers * avg;
        if (p.type === "R") return s + r * users * (p.isBundle ? 1 : avg);
        return s;
      }, 0);
      const floor     = pFile?.commitRamp ? (pFile?.commitRampSched?.[i] || 0) : commitFee / 12;
      const plat      = pfRamp ? (pfRampSched[i] || 0) : pfMonthly;
      const apiCharge = floor > 0 ? Math.max(apiSpend, floor) : apiSpend;
      const total     = apiCharge + plat;
      return { mo: i + 1, users, newUsers, apiSpend, floor, plat, total };
    });

    annualTotal   = monthlyBreakdown.reduce((s, m) => s + m.total, 0);
    annualSavings = pricing?.annualSavings || 0;
    annualRack    = pricingRack;
    savingsPct    = pricingSavingsPct;
    pfTier        = pFile?.pfTier || null;
    pfAnnual      = monthlyBreakdown.reduce((s, m) => s + m.plat, 0);
    includedProducts = productRows;
  }

  const mo1Revenue  = monthlyBreakdown[0]?.total  || 0;
  const mo12Revenue = monthlyBreakdown[11]?.total || 0;
  const conservative = pricingState?.annualConservative || annualTotal * 0.75;
  const bestCase     = pricingState?.annualBest        || annualTotal * 1.25;
  const minimum      = pricingState?.minimumAnnual     || (commitFee + pfAnnual);

  const billingStart = pFile?.billingStart || "";
  const goLiveTarget = linkedAcc?.medpicc?.timeline || billingStart || "";
  const aeQuote      = (linkedAcc?.pf || "").replace(/\b(?:not a fit|disqualif\w+|not suited|poor fit)\b.*$/i, "").trim().slice(0, 140) || null;

  const allCalls    = linkedAcc?.calls || [];
  const contactName = linkedAcc?.personas?.[0]?.name || "Contact";

  const PAIN_PH = "[Add pain point from call notes]";
  const rawPP = [...new Set(
    allCalls.flatMap(c => (c.painPoints || []).map(p => typeof p === "string" ? p : (p?.topic || "")))
      .filter(Boolean)
  )].slice(0, 4);
  const painPoints = rawPP.length > 0 ? rawPP : [PAIN_PH];
  while (painPoints.length < 4) painPoints.push(PAIN_PH);

  const nextSteps = allCalls
    .flatMap(c => (c.nextSteps || []).map(ns => {
      const text = typeof ns === "string" ? ns : (ns?.text || "");
      if (!text) return null;
      const owner  = typeof ns === "object" ? ns?.owner : null;
      const prefix = owner === "AE" ? `[${activeUser?.name || "AE"}]` : owner === "prospect" ? `[${contactName}]` : "";
      return prefix ? `${prefix} ${text}` : text;
    }))
    .filter(Boolean)
    .slice(0, 8);

  const discussedProdNames = [...new Set(
    allCalls.flatMap(c => (c.productsDiscussed || []).map(p => typeof p === "string" ? p : p?.product))
      .filter(Boolean)
  )];

  const finalIncludedProducts = includedProducts.length > 0 ? includedProducts
    : discussedProdNames.map(name => ({ name, type: "O", rack: null, custom: null, discountPct: 0, annualAtMo12: 0 }));

  return {
    accountName:      linkedAcc?.name    || "",
    vertical:         linkedAcc?.vert    || "",
    businessModel:    linkedAcc?.bm      || "",
    productFit:       linkedAcc?.pf      || "",
    stage:            linkedAcc?.stage   || "",
    medpicc:          linkedAcc?.medpicc || {},
    competitors:      linkedAcc?.competitors || [],
    discussedProdNames,
    includedProducts: finalIncludedProducts,
    annualTotal, annualRack, annualSavings, savingsPct,
    commitFee, pfTier, pfAnnual,
    monthlyBreakdown,
    mo1Revenue, mo12Revenue,
    conservative, bestCase, minimum,
    roiData:        null,
    painPoints, nextSteps,
    billingStart, goLiveTarget, aeQuote, customContext,
    aeName:         activeUser?.name || "AE",
    generatedAt:    new Date().toISOString(),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Deterministic formatters + page-module builders
// All currency numbers in the printed proposal flow through these helpers.
// Builders are pure (ctx) => htmlString — no side effects, no AI involvement.
// ───────────────────────────────────────────────────────────────────────────

const usd = (v) => `$${Math.round(v || 0).toLocaleString('en-US')}`;
const usdCents = (v) => {
  const n = v || 0;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const rampCell = (v) => {
  if (!v || v === 0) return '—';
  if (v >= 1000) return `$${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  return `$${Math.round(v)}`;
};

const PAGE_STYLE = `font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#111;line-height:1.55;`;
const H2 = `font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#666;font-weight:600;margin:0 0 10px 0;`;
const CARD = `border:1px solid #e0e0e0;border-radius:6px;padding:14px 16px;background:#fff;`;
const TABLE = `width:100%;border-collapse:collapse;font-size:12px;`;
const TH = `text-align:left;padding:8px 10px;background:#fafafa;border-bottom:1px solid #e0e0e0;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#666;`;
const TD = `padding:8px 10px;border-bottom:1px solid #f0f0f0;`;

function buildDealAtGlance(ctx) {
  const firstBill = (ctx.monthlyBreakdown || []).findIndex(m => (m.floor || 0) > 0 || (m.plat || 0) > 0);
  const firstBillMo = firstBill >= 0 ? firstBill + 1 : 1;
  const rampLabel = firstBillMo > 1
    ? `${firstBillMo - 1} mo free ramp`
    : 'billing from Mo 1';

  const card = (label, val, sub, accent) => `
    <div style="${CARD}flex:1;min-width:140px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#666;margin-bottom:6px;">${label}</div>
      <div style="font-size:20px;font-weight:700;color:${accent || '#111'};line-height:1.2;">${val}</div>
      <div style="font-size:10px;color:#888;margin-top:4px;">${sub}</div>
    </div>`;

  return `
    <div style="${PAGE_STYLE}margin-bottom:24px;">
      <h2 style="${H2}">Deal at a Glance</h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${card('Year 1 Projected', usd(ctx.annualTotal), `${(ctx.monthlyBreakdown?.[11]?.users || 0).toLocaleString()} paying users by Mo 12`)}
        ${card('Min Commitment',   usd(ctx.minimum),     'floor + platform fees')}
        ${card('Savings vs Rack',  usd(ctx.annualSavings), `rack rate ${usd(ctx.annualRack)}`, '#0a7d3d')}
        ${card('First Invoice',    `Mo ${firstBillMo}`,  rampLabel)}
      </div>
    </div>`;
}

function buildProductTable(ctx) {
  const rows = (ctx.includedProducts || []).map((p, i) => {
    const custom = p.custom ?? p.rack;
    const discounted = custom != null && p.rack != null && custom < p.rack;
    const customCell = custom != null
      ? `<span style="${discounted ? 'font-weight:700;color:#0a7d3d;' : ''}">${usdCents(custom)}</span>`
      : '—';
    return `<tr>
      <td style="${TD}font-weight:600;">${p.name}</td>
      <td style="${TD}color:#444;"><!--PRODUCT_DESC_${i}--></td>
      <td style="${TD}text-align:right;color:#888;">${p.rack != null ? usdCents(p.rack) : '—'}</td>
      <td style="${TD}text-align:right;">${customCell}</td>
      <td style="${TD}text-align:right;font-weight:600;">${usd(p.annualAtMo12)}</td>
    </tr>`;
  }).join('');

  const includedNames = new Set((ctx.includedProducts || []).map(p => p.name));
  const discussedNotIncluded = (ctx.discussedProdNames || []).filter(n => !includedNames.has(n));

  const scopeNote = discussedNotIncluded.length > 0
    ? `<p style="font-size:10px;color:#888;margin:8px 0 0 0;font-style:italic;">Note on scoping: ${discussedNotIncluded.join(', ')} discussed but not included in this proposal. Available to add at standard terms.</p>`
    : '';

  return `
    <div style="${PAGE_STYLE}margin-bottom:24px;">
      <h2 style="${H2}">Recommended Solution</h2>
      <table style="${TABLE}border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;">
        <thead><tr>
          <th style="${TH}">Capability</th>
          <th style="${TH}">What it does</th>
          <th style="${TH}text-align:right;">Rack rate</th>
          <th style="${TH}text-align:right;">Custom rate</th>
          <th style="${TH}text-align:right;">Est. annual</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${scopeNote}
    </div>`;
}

function buildRampGrids(ctx) {
  const commitActive = !!(ctx.commitRamp && Array.isArray(ctx.commitRampSched) && ctx.commitRampSched.some(v => v > 0));
  const pfActive     = !!(ctx.pfRamp     && Array.isArray(ctx.pfRampSched)     && ctx.pfRampSched.some(v => v > 0));
  const commitFlatNonzero = !commitActive && (ctx.commitFee || 0) > 0;
  const pfFlatNonzero     = !pfActive     && (ctx.pfAnnual  || 0) > 0;

  if (!commitActive && !pfActive && !commitFlatNonzero && !pfFlatNonzero) return '';

  const grid = (label, sched) => {
    const cells = sched.map((v, i) => `
      <div style="border:1px solid #e8e8e8;border-radius:4px;padding:6px 4px;text-align:center;background:#fafafa;">
        <div style="font-size:9px;color:#999;margin-bottom:2px;">M${i + 1}</div>
        <div style="font-size:11px;font-weight:600;color:#111;">${rampCell(v)}</div>
      </div>`).join('');
    return `
      <div style="margin-bottom:14px;">
        <div style="font-size:10px;color:#666;margin-bottom:6px;font-weight:600;">${label}</div>
        <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:4px;">${cells}</div>
      </div>`;
  };

  const blocks = [];
  if (commitActive) blocks.push(grid('API commitment / month', ctx.commitRampSched));
  else if (commitFlatNonzero) blocks.push(grid('API commitment / month', Array(12).fill(ctx.commitFee)));
  if (pfActive) blocks.push(grid('Platform fee / month', ctx.pfRampSched));
  else if (pfFlatNonzero) blocks.push(grid('Platform fee / month', (ctx.monthlyBreakdown || []).map(m => m.plat || 0)));

  return `
    <div style="${PAGE_STYLE}margin-bottom:24px;">
      <h2 style="${H2}">Billing Ramp</h2>
      ${blocks.join('')}
    </div>`;
}

function buildMonthlyTable(ctx) {
  const mb = ctx.monthlyBreakdown || [];
  const leadingFreeRun = (() => {
    let n = 0;
    for (const m of mb) {
      if ((m.floor || 0) === 0 && (m.plat || 0) === 0) n++;
      else break;
    }
    return n;
  })();

  const rows = mb.map(m => `<tr>
    <td style="${TD}">M${m.mo}</td>
    <td style="${TD}text-align:right;">${(m.users || 0).toLocaleString()}</td>
    <td style="${TD}text-align:right;color:#888;">${(m.newUsers || 0).toLocaleString()}</td>
    <td style="${TD}text-align:right;">${usd(m.apiSpend)}</td>
    <td style="${TD}text-align:right;color:#888;">${rampCell(m.floor)}</td>
    <td style="${TD}text-align:right;color:#888;">${rampCell(m.plat)}</td>
    <td style="${TD}text-align:right;font-weight:700;">${usd(m.total)}</td>
  </tr>`).join('');

  const totalApi   = mb.reduce((s, m) => s + (m.apiSpend || 0), 0);
  const totalFloor = mb.reduce((s, m) => s + (m.floor || 0), 0);
  const totalPlat  = mb.reduce((s, m) => s + (m.plat || 0), 0);

  const footRow = `<tr style="background:#fafafa;">
    <td style="${TD}font-weight:700;">12-Mo Total</td>
    <td style="${TD}"></td>
    <td style="${TD}"></td>
    <td style="${TD}text-align:right;font-weight:600;">${usd(totalApi)}</td>
    <td style="${TD}text-align:right;font-weight:600;">${usd(totalFloor)}</td>
    <td style="${TD}text-align:right;font-weight:600;">${usd(totalPlat)}</td>
    <td style="${TD}text-align:right;font-weight:700;">${usd(ctx.annualTotal)}</td>
  </tr>`;

  const caption = leadingFreeRun > 0
    ? `<p style="font-size:10px;color:#888;margin:8px 0 0 0;font-style:italic;">M1–M${leadingFreeRun} usage accrues but no invoice issued — covered under free ramp.</p>`
    : '';

  return `
    <div style="${PAGE_STYLE}margin-bottom:24px;">
      <h2 style="${H2}">Month-by-Month Breakdown</h2>
      <table style="${TABLE}border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;">
        <thead><tr>
          <th style="${TH}">Month</th>
          <th style="${TH}text-align:right;">Active</th>
          <th style="${TH}text-align:right;">New</th>
          <th style="${TH}text-align:right;">API usage</th>
          <th style="${TH}text-align:right;">API floor</th>
          <th style="${TH}text-align:right;">Platform</th>
          <th style="${TH}text-align:right;">Total</th>
        </tr></thead>
        <tbody>${rows}${footRow}</tbody>
      </table>
      ${caption}
    </div>`;
}

function buildScenarios(ctx) {
  const row = (label, val, highlight) => `<tr style="${highlight ? 'background:#fff8e0;' : ''}">
    <td style="${TD}font-weight:${highlight ? 700 : 500};">${label}</td>
    <td style="${TD}text-align:right;font-weight:${highlight ? 700 : 600};font-size:13px;">${val}</td>
  </tr>`;
  return `
    <div style="${PAGE_STYLE}margin-bottom:24px;">
      <h2 style="${H2}">Cost Scenarios</h2>
      <table style="${TABLE}border:1px solid #e0e0e0;border-radius:6px;overflow:hidden;max-width:420px;">
        <tbody>
          ${row('Conservative (−25% volume)', usd(ctx.conservative))}
          ${row('Base case', usd(ctx.annualTotal), true)}
          ${row('Upside (+25% volume)', usd(ctx.bestCase))}
        </tbody>
      </table>
    </div>`;
}

function buildInvestmentSummary(ctx) {
  const card = (label, val, sub, accent, strike) => `
    <div style="${CARD}flex:1;min-width:140px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#666;margin-bottom:6px;">${label}</div>
      <div style="font-size:18px;font-weight:700;color:${accent || '#111'};line-height:1.2;${strike ? 'text-decoration:line-through;color:#888;' : ''}">${val}</div>
      <div style="font-size:10px;color:#888;margin-top:4px;">${sub || ''}</div>
    </div>`;
  return `
    <div style="${PAGE_STYLE}margin-bottom:24px;">
      <h2 style="${H2}">Investment Summary</h2>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${card('Rack total',     usd(ctx.annualRack),     'list price', null, true)}
        ${card('Custom annual',  usd(ctx.annualTotal),    'this proposal')}
        ${card('Total savings',  usd(ctx.annualSavings),  `${ctx.savingsPct || 0}% off rack`, '#0a7d3d')}
        ${card('Minimum lock-in', usd(ctx.minimum),       'floor commitment (12 mo)')}
      </div>
    </div>`;
}

const DATA_SOURCES = [
  { id: 'account',   label: 'Account overview',    desc: 'Name, stage, tier, vertical, business model, product fit' },
  { id: 'pricing',   label: 'Products & pricing',  desc: 'Included products, rates, discount, annual value' },
  { id: 'ramp',      label: 'Monthly breakdown',   desc: 'M1–M12 users, API spend, floor, platform fee, totals' },
  { id: 'scenarios', label: 'Scenario range',      desc: 'Conservative / base / best case, lock-in vs projected' },
  { id: 'medpicc',   label: 'MEDPICC',             desc: 'Metrics, economic buyer, decision criteria, timeline, etc.' },
  { id: 'personas',  label: 'Contacts & personas', desc: 'Name, title, role, extracted from account' },
  { id: 'pain',      label: 'Pain points',         desc: 'Confirmed pain from call debriefs' },
  { id: 'nextsteps', label: 'Next steps',          desc: 'Open action items from calls' },
];

function ProposalBuilderModal({ linkedAcc, pricingState, onClose }) {
  const [checked, setChecked] = useState(() => {
    const init = {};
    DATA_SOURCES.forEach(s => { init[s.id] = true; });
    (linkedAcc?.calls || []).forEach((c, i) => {
      const hasContent = c.rawTranscript || c.structuredNotes || c.summary;
      init[`call_${i}`] = i === (linkedAcc.calls.length - 1) && !!hasContent;
    });
    return init;
  });
  const [customContext, setCustomContext] = useState('');
  const [loading, setLoading]             = useState(false);
  const [output, setOutput]               = useState(null);
  const [error, setError]                 = useState(null);
  const outputRef                         = useRef(null);

  const callSources = useMemo(() => {
    return (linkedAcc?.calls || [])
      .map((c, i) => {
        const hasContent = !!(c.rawTranscript || c.structuredNotes || c.summary);
        if (!hasContent) return null;
        const label = `Call — ${c.date || 'unknown date'} · ${(c.summary || '').slice(0, 60)}${(c.summary || '').length > 60 ? '…' : ''}`;
        const isTranscript = !!c.rawTranscript;
        return { id: `call_${i}`, label, isCall: true, callIdx: i, isTranscript };
      })
      .filter(Boolean)
      .reverse();
  }, [linkedAcc]);

  const allSources = [...DATA_SOURCES, ...callSources];

  const toggle = (id) => setChecked(prev => ({ ...prev, [id]: !prev[id] }));
  const selectAll = () => {
    const all = {};
    allSources.forEach(s => { all[s.id] = true; });
    setChecked(all);
  };
  const clearAll = () => {
    const none = {};
    allSources.forEach(s => { none[s.id] = false; });
    setChecked(none);
  };
  const checkedCount = allSources.filter(s => checked[s.id]).length;

  const buildContextBlock = (ctx) => {
    const sections = [];

    if (checked.account) {
      sections.push(`ACCOUNT
Name: ${ctx.accountName}
Vertical: ${ctx.vertical || '—'}
Business model: ${ctx.businessModel || '—'}
Stage: ${ctx.stage}
product fit: ${ctx.productFit || '—'}`);
    }

    if (ctx.competitors && ctx.competitors.length > 0) {
      sections.push(`COMPETITORS NAMED IN CALLS\n${ctx.competitors.map(c => `- ${c}`).join('\n')}`);
    }

    if (checked.medpicc && ctx.medpicc && Object.keys(ctx.medpicc).length > 0) {
      const m = ctx.medpicc;
      const fields = [
        m.metrics            && `Metrics: ${m.metrics}`,
        m.economic_buyer     && `Economic buyer: ${m.economic_buyer}`,
        m.decision_criteria  && `Decision criteria: ${m.decision_criteria}`,
        m.decision_process   && `Decision process: ${m.decision_process}`,
        m.identify_pain      && `Identified pain: ${m.identify_pain}`,
        m.champion           && `Champion: ${m.champion}`,
        m.competition        && `Competition: ${m.competition}`,
      ].filter(Boolean);
      if (fields.length > 0) sections.push(`MEDPICC\n${fields.join('\n')}`);
    }

    if (checked.personas && linkedAcc?.personas?.length > 0) {
      const pLines = linkedAcc.personas.map(p =>
        `${p.name || '—'}, ${p.title || '—'}${p.role ? ` (${p.role})` : ''}`
      );
      sections.push(`CONTACTS\n${pLines.join('\n')}`);
    }

    if (checked.pricing && ctx.includedProducts?.length > 0) {
      const pLines = ctx.includedProducts.map(p =>
        `${p.name} · ${p.type} · rack $${p.rack ?? '—'} · custom $${p.custom ?? '—'}${p.discountPct ? ` (${p.discountPct}% off)` : ''} · annual $${Math.round(p.annualAtMo12 || 0).toLocaleString()}`
      );
      sections.push(`PRODUCTS & PRICING
${pLines.join('\n')}
Annual total: $${Math.round(ctx.annualTotal).toLocaleString()}
Rack total: $${Math.round(ctx.annualRack).toLocaleString()}
Savings vs rack: $${Math.round(ctx.annualSavings).toLocaleString()} (${ctx.savingsPct}%)
Platform fee: $${Math.round(ctx.pfAnnual).toLocaleString()}/yr
API commitment: $${Math.round(ctx.commitFee).toLocaleString()}/mo`);
    }

    if (checked.ramp && ctx.monthlyBreakdown?.length > 0) {
      const rows = ctx.monthlyBreakdown.map(m =>
        `Mo ${m.mo}: ${m.users} users · API $${Math.round(m.apiSpend)} · floor $${Math.round(m.floor)} · plat $${Math.round(m.plat)} · total $${Math.round(m.total)}`
      );
      sections.push(`MONTHLY BREAKDOWN (M1–M12)\n${rows.join('\n')}`);
    }

    if (checked.scenarios) {
      sections.push(`SCENARIOS
Conservative (–25%): $${Math.round(ctx.conservative).toLocaleString()}/yr
Base case: $${Math.round(ctx.annualTotal).toLocaleString()}/yr
Best case (+25%): $${Math.round(ctx.bestCase).toLocaleString()}/yr
Minimum (lock-in): $${Math.round(ctx.minimum).toLocaleString()}/yr
Mo 1: $${Math.round(ctx.mo1Revenue).toLocaleString()} · Mo 12: $${Math.round(ctx.mo12Revenue).toLocaleString()}
Billing start: ${ctx.billingStart || '—'}
Go-live target: ${ctx.goLiveTarget || '—'}`);
    }

    if (checked.pain && ctx.painPoints?.length > 0) {
      const real = ctx.painPoints.filter(p => !p.includes('[Add pain point'));
      if (real.length > 0) sections.push(`CONFIRMED PAIN POINTS\n${real.map(p => `- ${p}`).join('\n')}`);
    }

    if (checked.nextsteps && ctx.nextSteps?.length > 0) {
      sections.push(`NEXT STEPS\n${ctx.nextSteps.map(ns => `- ${ns}`).join('\n')}`);
    }

    callSources.forEach(src => {
      if (!checked[src.id]) return;
      const call = linkedAcc.calls[src.callIdx];
      const content = call.rawTranscript || call.structuredNotes || call.summary || '';
      if (!content) return;
      const type = call.rawTranscript ? 'TRANSCRIPT' : 'CALL NOTES';
      sections.push(`${type} — ${call.date || 'unknown date'}\n${content.slice(0, 6000)}${content.length > 6000 ? '\n[… truncated]' : ''}`);
    });

    if (customContext?.trim()) {
      sections.push(`ADDITIONAL CONTEXT (AE-PROVIDED)\n${customContext.trim()}`);
    }

    return sections.join('\n\n---\n\n');
  };

  // ── Prompt A — structured prose (small, JSON, buffered, fast) ─────────────
  const buildStructuredPrompt = (ctx, productNames) => {
    const contextBlock = buildContextBlock(ctx);
    const productList = productNames.map((n, i) => `${i}: ${n}`).join('\n');

    return `You are a senior sales engineer writing the structured prose for a client-facing partnership proposal for ${ctx.accountName || 'this prospect'}.

CRITICAL RULES:
- DO NOT output any dollar amounts, user counts, monthly figures, or pricing numbers. All numeric data lives in deterministic tables rendered by the application. If you reference cost, say "the structure above," "as detailed on the proposal," etc.
- Describe what each product does for THIS account in plain language — not marketing-speak.
- If a field is missing or unknown, write naturally around the gap rather than using placeholder text.

Return ONLY a JSON object (no markdown fences, no preamble) with these exact fields:

{
  "executiveSummary": "2–3 paragraphs of plain prose tailored to this account. Why we are the right partner for their business. No HTML.",
  "solutionIntro": "1–2 sentences introducing the recommended product set. No HTML.",
  "productDescriptions": ["one description per product, in the same order as the list below. Each describes what this product does FOR THIS ACCOUNT in plain language. No HTML, no pricing."]
}

REQUIREMENTS:
- productDescriptions array length MUST equal ${productNames.length}, in the exact order shown below.

PRODUCT LIST (use exact order):
${productList || '(no products included)'}

DEAL CONTEXT:
${contextBlock}`;
  };

  // ── Prompt B — Page 2 HTML (streamed, raw, NOT JSON-wrapped) ──────────────
  const buildPage2Prompt = (ctx, hasCompetitors) => {
    const contextBlock = buildContextBlock(ctx);
    const competitiveGuidance = hasCompetitors
      ? `The competitors above were named in customer calls. Include a positioning section contrasting us against the named competitor(s). Focus on billing model, connect rate, infrastructure ownership, and reliability. Be specific to the competitor named, not generic.`
      : `No competitors were named. Instead of a competitive section, write a value/risk narrative: why infrastructure choice matters for their use case, data reliability, and what is at stake if connectivity is unreliable.`;

    return `You are a senior sales engineer writing Page 2 of a client-facing partnership proposal for ${ctx.accountName || 'this prospect'}.

This page covers our position for this account and the intelligence around the deal. It does NOT include any commercial numbers — those are on Page 1 (deterministic tables). If you reference cost or commercial terms, say "the structure on the previous page," "the committed ramp," etc.

Sections to include, in order:
1. Why us for this account specifically — draw from vertical, business model, product fit, pain points, call intel.
2. ${hasCompetitors ? 'Competitive positioning vs the named competitors' : 'Value / risk narrative'}. ${competitiveGuidance}
3. Confirmed next steps as a list.

RULES:
- Return ONLY the HTML body content for this page. No JSON, no code fences, no preamble.
- Start with a single wrapping <div>.
- Use semantic HTML with inline styles (clean, minimal, professional — white background, dark text, modest h2/h3 headings, font-family:-apple-system,sans-serif).
- NO dollar amounts, user counts, or pricing numbers anywhere.
- Do not name products in marketing-speak.

DEAL CONTEXT:
${contextBlock}`;
  };

  const generate = async () => {
    setLoading(true);
    setError(null);
    setOutput(null);

    const ctx = buildProposalContext(linkedAcc, customContext, pricingState);
    const productNames = (ctx.includedProducts || []).map(p => p.name);
    const hasCompetitors = (ctx.competitors || []).length > 0;

    // Deterministic Page 1 header — fixed per generation
    const dateLine = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const header = `
      <div style="${PAGE_STYLE}margin-bottom:24px;border-bottom:1px solid #e0e0e0;padding-bottom:14px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:4px;">Partnership Proposal</div>
        <h1 style="font-size:24px;margin:0;font-weight:700;color:#111;">${ctx.accountName || 'Partner'}</h1>
        <div style="font-size:10px;color:#888;margin-top:6px;">${dateLine}${ctx.vertical ? ` · ${ctx.vertical}` : ''}</div>
      </div>`;

    const wrapParagraphs = (text) => {
      if (!text || !text.trim()) return '';
      return text.trim().split(/\n\s*\n/).map(p => `<p style="margin:0 0 10px 0;font-size:13px;color:#222;">${p.replace(/\n/g, '<br/>')}</p>`).join('');
    };

    const buildPage1 = (descs, execHtml, introHtml, callAErr) => {
      let productTableHtml = buildProductTable(ctx);
      const safeDescs = Array.isArray(descs) ? descs : [];
      (ctx.includedProducts || []).forEach((_p, i) => {
        const desc = safeDescs[i] != null ? safeDescs[i] : '';
        productTableHtml = productTableHtml.replace(`<!--PRODUCT_DESC_${i}-->`, desc);
      });

      let execBlock = '';
      if (execHtml) {
        execBlock = `<div style="${PAGE_STYLE}margin-bottom:24px;"><h2 style="${H2}">Executive Summary</h2>${execHtml}</div>`;
      } else if (callAErr) {
        execBlock = `<div style="${PAGE_STYLE}margin-bottom:24px;"><h2 style="${H2}">Executive Summary</h2><p style="font-size:12px;color:#999;font-style:italic;margin:0;">Summary unavailable — retry to add narrative.</p></div>`;
      } else {
        execBlock = `<div style="${PAGE_STYLE}margin-bottom:24px;"><h2 style="${H2}">Executive Summary</h2><p style="font-size:12px;color:#bbb;font-style:italic;margin:0;">Generating summary…</p></div>`;
      }

      const introBlock = introHtml
        ? `<div style="${PAGE_STYLE}margin-bottom:14px;">${introHtml}</div>`
        : '';

      return `<div class="proposal-page">
        ${header}
        ${execBlock}
        ${buildDealAtGlance(ctx)}
        ${introBlock}
        ${productTableHtml}
        ${buildInvestmentSummary(ctx)}
        ${buildRampGrids(ctx)}
        ${buildMonthlyTable(ctx)}
        ${buildScenarios(ctx)}
      </div>`;
    };

    const buildPage2Html = (html, err, streaming) => {
      if (err) {
        return `<div class="proposal-page" style="${PAGE_STYLE}">
          <div style="${CARD}background:#fff8e0;border-color:#e8d070;">
            <h2 style="${H2}color:#8a6a00;">Page 2 generation failed</h2>
            <p style="font-size:12px;color:#665000;margin:0;">${err} — the commercial summary above is correct and complete. Retry from the modal to regenerate the intelligence page.</p>
          </div>
        </div>`;
      }
      if (html) {
        const streamingTag = streaming
          ? '<div style="font-size:11px;color:#999;margin-top:14px;font-style:italic;">generating…</div>'
          : '';
        return `<div class="proposal-page" style="${PAGE_STYLE}">${html}${streamingTag}</div>`;
      }
      return `<div class="proposal-page" style="${PAGE_STYLE}"><p style="color:#bbb;font-style:italic;font-size:13px;">Generating intelligence page…</p></div>`;
    };

    // Shared mutable state between callA and callB; rebuild() composes output
    const state = {
      descs: null,
      execHtml: '',
      introHtml: '',
      callAErr: null,
      page2Html: '',
      page2Err: null,
      page2Streaming: true,
    };
    const rebuild = () => {
      const p1 = buildPage1(state.descs, state.execHtml, state.introHtml, state.callAErr);
      const p2 = buildPage2Html(state.page2Html, state.page2Err, state.page2Streaming);
      setOutput(`${p1}${p2}`);
    };

    // Initial render — Page 1 deterministic tables visible immediately,
    // narrative placeholders for the still-loading prose, Page 2 placeholder.
    rebuild();

    // ── Call A — structured prose (buffered, fast, reliable) ──
    const callA = async () => {
      try {
        const res = await fetch('/proxy/anthropic/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODELS.STANDARD,
            max_tokens: 1500,
            messages: [{ role: 'user', content: buildStructuredPrompt(ctx, productNames) }],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
        const raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
        if (!raw) throw new Error('Empty response');
        const stripped = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        const parsed = JSON.parse(stripped);

        let descs = parsed.productDescriptions;
        if (!Array.isArray(descs) || descs.length !== productNames.length) {
          const safe = Array(productNames.length).fill('');
          if (Array.isArray(descs)) descs.forEach((d, i) => { if (i < safe.length) safe[i] = String(d || ''); });
          descs = safe;
        }
        state.descs = descs;
        state.execHtml = wrapParagraphs(parsed.executiveSummary || '');
        state.introHtml = wrapParagraphs(parsed.solutionIntro || '');
        rebuild();
      } catch (e) {
        console.error('[ProposalBuilderModal] Call A failed', e);
        state.callAErr = e.message || 'Generation failed';
        // Ensure descs is an array so placeholder tokens get cleared from Page 1
        state.descs = Array(productNames.length).fill('');
        rebuild();
      }
    };

    // ── Call B — Page 2 HTML (streamed, raw text) ──
    const callB = async () => {
      try {
        const res = await fetch('/proxy/anthropic/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODELS.STANDARD,
            max_tokens: 3000,
            stream: true,
            messages: [{ role: 'user', content: buildPage2Prompt(ctx, hasCompetitors) }],
          }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status} — ${txt.slice(0, 120) || 'streaming failed'}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        // Throttle re-renders during streaming to avoid thrashing on every token
        let lastRender = 0;
        const renderThrottle = 120; // ms
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop(); // keep incomplete line for next chunk
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed.delta?.text;
              if (typeof delta === 'string' && delta.length) {
                state.page2Html += delta;
              }
            } catch { /* non-JSON SSE line, ignore */ }
          }
          const now = Date.now();
          if (now - lastRender >= renderThrottle) {
            rebuild();
            lastRender = now;
          }
        }
        // Strip stray code fences defensively
        state.page2Html = state.page2Html.replace(/^```html?\s*/i, '').replace(/```\s*$/, '').trim();
        if (!state.page2Html) throw new Error('Empty streamed response');
        state.page2Streaming = false;
        rebuild();
      } catch (e) {
        console.error('[ProposalBuilderModal] Call B failed', e);
        state.page2Err = e.message || 'Generation failed';
        state.page2Streaming = false;
        rebuild();
      }
    };

    // Fire both in parallel — independent, fastest possible
    await Promise.allSettled([callA(), callB()]);

    // Aggregate error surface: only show banner if BOTH failed
    if (state.callAErr && state.page2Err) {
      setError('Both AI calls failed — Page 1 numbers are still correct. Retry to add narrative + Page 2.');
    } else if (state.callAErr) {
      setError('Summary + product descriptions unavailable — retry to add them.');
    } else if (state.page2Err) {
      setError('Page 2 generation failed — Page 1 is correct. Retry to add Page 2.');
    }
    setLoading(false);
  };

  const handlePrint = () => {
    if (!outputRef.current) return;
    const printWin = window.open('', '_blank');
    printWin.document.write(`<html><head><title>${linkedAcc?.name || 'Proposal'} — Proposal (DRAFT)</title>
      <style>
        body{font-family:sans-serif;padding:32px;max-width:860px;margin:0 auto;position:relative;}
        .draft-ribbon{position:fixed;top:18px;right:18px;background:#b59a3f;color:#fff;
          font-family:sans-serif;font-size:11px;font-weight:600;letter-spacing:0.08em;
          padding:5px 14px;border-radius:4px;text-transform:uppercase;z-index:9999;}
        .draft-footer{margin-top:40px;padding-top:16px;border-top:1px solid #ddd;
          font-family:sans-serif;font-size:10px;color:#999;text-align:center;}
        .proposal-page{page-break-after:always;}
        .proposal-page:last-child{page-break-after:auto;}
        @media print{
          body{padding:0;}
          .draft-ribbon{position:fixed;}
          .proposal-page{page-break-after:always;}
          .proposal-page:last-child{page-break-after:auto;}
        }
      </style>
      </head><body>
        <div class="draft-ribbon">Draft</div>
        ${outputRef.current.innerHTML}
        <div class="draft-footer">Draft proposal — generated by Prospector. Pricing and terms subject to internal review and approval before issuance.</div>
      </body></html>`);
    printWin.document.close();
    printWin.focus();
    printWin.print();
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)",
      display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div style={{ background:C.bg, border:`1px solid ${C.brd}`, borderRadius:10,
        width:"min(780px, 95vw)", maxHeight:"90vh", display:"flex", flexDirection:"column",
        overflow:"hidden" }}>

        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"12px 18px", borderBottom:`1px solid ${C.brd}`, background:C.card, flexShrink:0 }}>
          <div>
            <span style={{ ...mono, fontSize:13, fontWeight:700, color:C.gold }}>✦ Proposal Builder</span>
            {linkedAcc && <span style={{ ...mono, fontSize:11, color:C.dim, marginLeft:10 }}>{linkedAcc.name}</span>}
          </div>
          <button onClick={onClose}
            style={{ ...mono, fontSize:13, background:"transparent", border:"none",
              color:C.mut, cursor:"pointer", padding:"2px 6px" }}>✕</button>
        </div>

        <div style={{ overflowY:"auto", flex:1, padding:"16px 18px", display:"flex",
          flexDirection:"column", gap:16 }}>

          {output ? (
            <>
              <div style={{ display:"flex", gap:8, alignItems:"center", flexShrink:0 }}>
                <button onClick={() => setOutput(null)}
                  style={{ ...mono, fontSize:11, padding:"5px 12px", background:"transparent",
                    border:`1px solid ${C.brd}`, borderRadius:5, color:C.mut, cursor:"pointer" }}>
                  ← Back
                </button>
                <button onClick={handlePrint}
                  style={{ ...mono, fontSize:11, padding:"5px 12px",
                    background:`${C.gold}18`, border:`1px solid ${C.goldBdr}`,
                    borderRadius:5, color:C.gold, fontWeight:600, cursor:"pointer" }}>
                  🖨 Save as PDF
                </button>
                <span style={{ ...mono, fontSize:10, color:C.dim, marginLeft:4 }}>
                  Opens print dialog — Save as PDF
                </span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px",
                background:`${C.gold}14`, border:`1px solid ${C.goldBdr}`, borderRadius:6,
                flexShrink:0 }}>
                <span style={{ fontSize:13 }}>⚠</span>
                <span style={{ ...mono, fontSize:11, color:C.gold, fontWeight:600 }}>
                  DRAFT — AI-generated. Review all pricing and claims before sending to a client.
                </span>
              </div>
              <div ref={outputRef}
                style={{ background:"#fff", color:"#111", borderRadius:6,
                  border:`1px solid ${C.brd}`, padding:"32px 36px",
                  fontSize:14, lineHeight:"1.7", overflowX:"auto" }}
                dangerouslySetInnerHTML={{ __html: output }}
              />
            </>
          ) : (
            <>
              <div>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                  marginBottom:10 }}>
                  <span style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase",
                    letterSpacing:"0.08em" }}>
                    Data sources — {checkedCount}/{allSources.length} selected
                  </span>
                  <div style={{ display:"flex", gap:8 }}>
                    <button onClick={selectAll}
                      style={{ ...mono, fontSize:10, padding:"3px 10px", background:"transparent",
                        border:`1px solid ${C.brd}`, borderRadius:4, color:C.mut, cursor:"pointer" }}>
                      Select all
                    </button>
                    <button onClick={clearAll}
                      style={{ ...mono, fontSize:10, padding:"3px 10px", background:"transparent",
                        border:`1px solid ${C.brd}`, borderRadius:4, color:C.mut, cursor:"pointer" }}>
                      Clear
                    </button>
                  </div>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                  {DATA_SOURCES.map(src => (
                    <div key={src.id} onClick={() => toggle(src.id)}
                      style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"8px 10px",
                        borderRadius:6, cursor:"pointer",
                        border:`1px solid ${checked[src.id] ? C.goldBdr : C.brd}`,
                        background: checked[src.id] ? `${C.gold}0D` : "transparent" }}>
                      <div style={{ width:14, height:14, borderRadius:3, flexShrink:0, marginTop:1,
                        border:`1.5px solid ${checked[src.id] ? C.gold : C.brd}`,
                        background: checked[src.id] ? C.gold : "transparent",
                        display:"flex", alignItems:"center", justifyContent:"center" }}>
                        {checked[src.id] && <span style={{ fontSize:9, color:"#000", fontWeight:700 }}>✓</span>}
                      </div>
                      <div>
                        <div style={{ ...mono, fontSize:11, color:C.txt, fontWeight:600 }}>{src.label}</div>
                        <div style={{ ...mono, fontSize:10, color:C.dim, marginTop:1 }}>{src.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {callSources.length > 0 && (
                  <div style={{ marginTop:8 }}>
                    <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase",
                      letterSpacing:"0.08em", marginBottom:6 }}>Call transcripts & notes</div>
                    <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                      {callSources.map(src => (
                        <div key={src.id} onClick={() => toggle(src.id)}
                          style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px",
                            borderRadius:6, cursor:"pointer",
                            border:`1px solid ${checked[src.id] ? C.goldBdr : C.brd}`,
                            background: checked[src.id] ? `${C.gold}0D` : "transparent" }}>
                          <div style={{ width:14, height:14, borderRadius:3, flexShrink:0,
                            border:`1.5px solid ${checked[src.id] ? C.gold : C.brd}`,
                            background: checked[src.id] ? C.gold : "transparent",
                            display:"flex", alignItems:"center", justifyContent:"center" }}>
                            {checked[src.id] && <span style={{ fontSize:9, color:"#000", fontWeight:700 }}>✓</span>}
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <span style={{ ...mono, fontSize:11, color:C.txt }}>{src.label}</span>
                            {src.isTranscript && (
                              <span style={{ ...mono, fontSize:9, color:C.blue, marginLeft:6 }}>transcript</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div style={{ ...mono, fontSize:10, color:C.dim, textTransform:"uppercase",
                  letterSpacing:"0.08em", marginBottom:6 }}>
                  Additional context (email threads, Gong links, prospect data)
                </div>
                <textarea
                  value={customContext}
                  onChange={e => setCustomContext(e.target.value)}
                  placeholder="Paste email threads, Gong transcript, prospect CSV, or any context not in Prospector..."
                  rows={5}
                  style={{ ...mono, width:"100%", fontSize:11, padding:"9px 12px",
                    background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6,
                    color:C.txt, resize:"vertical", outline:"none", boxSizing:"border-box" }}
                />
              </div>

              {error && (
                <div style={{ ...mono, fontSize:11, color:"#e05", padding:"8px 12px",
                  border:"1px solid #e0553340", borderRadius:5, background:"#e055330A" }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {!output && (
          <div style={{ padding:"12px 18px", borderTop:`1px solid ${C.brd}`,
            background:C.card, display:"flex", alignItems:"center",
            justifyContent:"space-between", flexShrink:0 }}>
            <span style={{ ...mono, fontSize:10, color:C.dim }}>
              {checkedCount === 0
                ? "Select at least one data source"
                : `${checkedCount} source${checkedCount !== 1 ? 's' : ''} · MODELS.STANDARD · ~15s`}
            </span>
            <button
              onClick={generate}
              disabled={loading || checkedCount === 0}
              style={{ ...mono, fontSize:12, padding:"7px 20px",
                background: loading || checkedCount === 0 ? "transparent" : `${C.gold}22`,
                border: `1px solid ${loading || checkedCount === 0 ? C.brd : C.goldBdr}`,
                borderRadius:6,
                color: loading || checkedCount === 0 ? C.dim : C.gold,
                fontWeight:600,
                cursor: loading || checkedCount === 0 ? "not-allowed" : "pointer" }}>
              {loading ? "Generating…" : "✦ Generate proposal"}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

export default ProposalBuilderModal;
