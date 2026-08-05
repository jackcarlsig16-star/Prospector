import { SEED_INTEL_DOCS } from '../constants/products';
import { MODELS } from '../config/models';

export const detectIntelCategory = (text) => {
  const t = text.toLowerCase();
  if (/lend|loan|credit|underwriting|income verif|bnpl|ewa|borrow|mortgage/.test(t)) return "Credit & Lending";
  if (/payment|ach|pay by bank|transfer|disbursement|payroll|wire|rtp|fednow/.test(t)) return "Payments";
  if (/fraud|kyc|aml|risk|sanction|pep|ato|identity verif/.test(t)) return "Fraud & Risk";
  if (/onboard|sign.?up|account open|layer/.test(t)) return "Onboarding";
  if (/pfm|budget|transaction|investment|wealth|portfolio/.test(t)) return "Financial Management";
  if (/compet|vs\.|versus|battle|alternative|objection|pushback/.test(t)) return "Competitive Intel";
  return "General Intel";
};

export const getActiveExamples = () => {
  try {
    const saved = localStorage.getItem("prospector_example_accts");
    if (!saved) return "";
    const examples = JSON.parse(saved).filter(e => e.active);
    const gold   = examples.filter(e => e.type === "gold");
    const misses = examples.filter(e => e.type === "nearmiss");
    if (!examples.length) return "";
    const lines = [];
    if (gold.length) {
      lines.push("GOLD EXAMPLES (confirmed strong product fit):");
      gold.forEach(e => lines.push(`- ${e.name}${e.notes ? ": " + e.notes : ""}`));
    }
    if (misses.length) {
      lines.push("NEAR MISSES — looked like a fit but aren't:");
      misses.forEach(e => lines.push(`- ${e.name}: ${e.why}`));
    }
    return lines.join("\n");
  } catch { return ""; }
};

export const getActiveIntel = () => {
  try {
    const saved = localStorage.getItem("prospector_intel_docs");
    const userDocs = saved ? JSON.parse(saved) : [];
    // Always include seed docs that aren't already in localStorage (by id)
    const userIds = new Set(userDocs.map(d => d.id));
    const merged = [...userDocs, ...SEED_INTEL_DOCS.filter(d => !userIds.has(d.id))];
    const combined = merged.filter(d => d.active).map(d => `[${d.name}]\n${d.content}`).join("\n\n---\n\n");
    if (combined) return combined;
    return localStorage.getItem("prospector_intel") || "";
  } catch { return localStorage.getItem("prospector_intel") || ""; }
};

export function detectSignals(text) {
  const t = text.toLowerCase();
  const found = (patterns) => patterns.filter(p => typeof p === "string" ? t.includes(p.toLowerCase()) : p.test(t));
  const paymentHits = found(["connect bank","link account","link your bank","bank transfer","ach","direct deposit","wire transfer","pay by bank","instant verification","micro-deposit","microdeposit"]);
  const competitorHits = found(["brightlinepay","vergedata","northstarfi"]);
  const onboardingHits = found(["verify identity","kyc","aml","ssn","ein","bank-level security","bank level security",/minutes to (get started|sign up|apply)/]);
  const creditHits = found(["check your rate","apply now","see if you qualify","bank statements","income verification","asset verification","no hard credit check","soft credit check"]);
  const scaleHits = found([/apps?\.apple\.com/,/play\.google\.com/,/\d[\d,]+\s*(users|customers|businesses|merchants)/,"pricing","plans & pricing","our pricing","see pricing","waitlist","join the beta","early access"]);
  const platformHits = found([/api\./,"/api/","api docs","developer docs","documentation","our customers","businesses we serve","white label","whitelabel","white-label","embedded finance","powered by","built for businesses","partner","integration","marketplace"]);
  const slagHits = found(["wix.com","squarespace.com","coming soon","under construction","launching soon",/copyright\s+20(19|20|21)\b/,"domain for sale","this domain is for sale","buy this domain","parked domain","domain parking","godaddy.com/domains","domain has expired","domain expired","renew this domain","account suspended","suspended domain","no longer operating","we've shut down","we have shut down","wind down","winding down","sunsetting","we are shutting","acquired by","now part of","we\u2019ve joined","we have joined"]);
  const paymentSignals=[...paymentHits.map(p=>`"${typeof p==="string"?p:p.toString()}" detected`),...competitorHits.map(p=>`competitor mention: ${p}`)];
  const onboardingSignals=onboardingHits.map(p=>`"${typeof p==="string"?p:p.toString()}" detected`);
  const creditSignals=creditHits.map(p=>`"${typeof p==="string"?p:p.toString()}" detected`);
  const scaleSignals=(()=>{const out=[];if(/apps?\.apple\.com/.test(t)||/play\.google\.com/.test(t))out.push("app store link found");const um=t.match(/(\d[\d,]+)\s*(users|customers|businesses|merchants)/);if(um)out.push(`${um[1]} ${um[2]} mentioned`);if(/(pricing|plans & pricing|our pricing|see pricing)/.test(t))out.push("pricing page exists");if(/(waitlist|join the beta|early access)/.test(t))out.push("waitlist/beta — building traction");return out;})();
  const platformSignals=(()=>{const out=[];if(/api\.|\/api\/|api docs|developer docs|documentation/.test(t))out.push("API docs found");if(/(our customers|businesses we serve)/.test(t))out.push("B2B distribution language");if(/(white.?label|embedded finance|powered by)/.test(t))out.push("white-label / embedded language");if(/(partner|integration.*page|marketplace)/.test(t))out.push("partner / integration page");return out;})();
  const slagSignals=(()=>{const out=[];if(/(wix\.com|squarespace\.com)/.test(t))out.push("template site builder detected");if(/(coming soon|under construction|launching soon)/.test(t))out.push("coming soon — no live product");if(/copyright\s+20(19|20|21)\b/.test(t))out.push("copyright 3+ years stale");if(/(domain for sale|buy this domain|parked domain|domain parking|domain has expired|domain expired|renew this domain|godaddy\.com\/domains)/.test(t))out.push("parked / expired domain");if(/(account suspended|suspended domain)/.test(t))out.push("account suspended");if(/(no longer operating|we.ve shut down|we have shut down|wind.{0,5}down|sunsetting|we are shutting)/.test(t))out.push("company shutdown signal");if(/(acquired by|now part of|we.ve joined|we have joined)/.test(t))out.push("acquisition / absorbed signal");return out;})();
  let signalScore=50;
  signalScore+=Math.min(paymentSignals.length*8,24);signalScore+=Math.min(onboardingSignals.length*6,18);signalScore+=Math.min(creditSignals.length*6,18);signalScore+=Math.min(scaleSignals.length*5,20);signalScore+=Math.min(platformSignals.length*7,21);signalScore-=Math.min(slagSignals.length*15,35);
  signalScore=Math.max(0,Math.min(100,signalScore));
  const topSignalParts=[];if(paymentSignals.length)topSignalParts.push(`payment signals (${paymentSignals.slice(0,2).join(", ")})`);if(platformSignals.length)topSignalParts.push(platformSignals[0]);if(onboardingSignals.length)topSignalParts.push(onboardingSignals[0]);if(creditSignals.length)topSignalParts.push(creditSignals[0]);
  const topSignal=topSignalParts.length?topSignalParts.slice(0,2).join(" + "):scaleSignals.length?scaleSignals[0]:"No strong signals detected";
  return{paymentSignals,onboardingSignals:[...onboardingSignals,...creditSignals],scaleSignals,platformSignals,slagSignals,signalScore,topSignal};
}

export async function fetchSiteContentClient(web) {
  const url = web.startsWith("http") ? web : `https://${web}`;
  try {
    const r = await fetch(`/proxy/jina?url=${encodeURIComponent(url)}`, { signal:AbortSignal.timeout(15000) });
    if (r.ok) { const text = await r.text(); if (text && text.length > 100 && !text.toLowerCase().includes("jina.ai error")) return { content: text.slice(0, 4000), method: "jina" }; }
  } catch (_) {}
  return { content: null, method: "failed" };
}

export async function clientAssay({ name, web, vert, sub, customIntel, exampleAccts, stage }) {
  let siteContent = "", linkedin = null, signalBreakdown = null, fetchMethod = "none";
  if (web) {
    const { content, method } = await fetchSiteContentClient(web);
    fetchMethod = method;
    if (content) {
      siteContent = content;
      const liMatch = siteContent.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-zA-Z0-9_\-\.]+\/?/i);
      if (liMatch) linkedin = liMatch[0].replace(/\/$/, "") + "/";
      signalBreakdown = detectSignals(siteContent);
    } else { siteContent = "Site unreachable after fetch attempt"; }
  }
  const signalSummary = signalBreakdown ? `\nPRE-DETECTED SIGNALS:\n${JSON.stringify(signalBreakdown,null,2)}\n` : "";

  const response = await fetch("/proxy/anthropic/messages", {
    method: "POST",
    headers: { "Content-Type":"application/json", "anthropic-version":"2023-06-01" },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model: MODELS.FAST,
      max_tokens: 900,
      system: `You are a product fit scoring engine for an SMB AE. Respond with ONLY a JSON object, no other text.

SCORING: 1=Gold(strong direct product fit), 2=Silver(solid indirect fit), 3=Tin(weak/speculative fit), 4=Slag(defunct OR zero fintech angle).
Be generous: payments, lending, banking, crypto, insurance, wealth, PFM, payroll, EWA, rent, HR with payments = Gold or Silver.
If site unreachable but vertical suggests fintech, score based on vertical — do NOT score 4 just because the site failed to load.

DISTRIBUTION MULTIPLIER — CRITICAL OVERRIDE:
If the company is a PLATFORM or B2B2C play that serves other businesses as customers, score them Gold (1) regardless of company size. Look for: "SMB customers", "small business platform", "marketplace", "white-label", "embedded", "powered by", serving 1000+ downstream businesses.
Set distributionMultiplier=true and note downstream reach in estimatedDownstreamUsers.

DEFUNCT / ACQUIRED: Score 4=Slag and set isActive=false if site mentions "acquired by", "now part of", "no longer operating", "sunset", or is a holding page.
Set disqualifier as: "reason_code — one sentence explanation." Reason codes: dead_site | wrong_vertical | no_fiat_rail | acquired | crypto_no_bank | b2c_only | no_fintech | coming_soon | suspended | stale. Example: "acquired — absorbed by Stripe in 2022, no longer an independent prospect." If active, disqualifier must be null.

SITE UNREACHABLE POLICY: Score based on company name + vertical + industry knowledge. Set confidence="Low". Do NOT set disqualifier to "site unreachable".

VERTICAL-SPECIFIC SCORING RULES — apply these before finalizing score:

LENDING — be specific:
- Personal lending with bank statement underwriting = Balance Insights + Core Verify → Gold
- Business lending = Balance Insights + Core Verify → Gold
- RULE: any lending product that touches bank data = Gold

PAYMENTS / MARKETPLACES:
- ACH collection or payout = Core Verify → Silver minimum
- Multi-party settlement touching bank accounts = Core Verify + Core Verify Plus → Silver minimum
- RULE: any payment platform moving money via bank transfer = Silver minimum

INSURANCE / PROPTECH:
- Premium or rent collection = Core Verify + Core Verify Plus → Silver minimum
- Tenant or policyholder screening with income verification = Balance Insights → Gold
- RULE: any recurring bank-collection product = Silver minimum

GENERAL SIGNAL BOOSTS — apply these regardless of vertical:
- KYC/AML/compliance language exists → add Core Verify Plus, boost score up
- "Bank account" + "verify" together → Core Verify fit → boost score
- Platform (B2B2C) serving financial businesses → Silver minimum regardless of tech stack

USE CASES (return exact strings): "onboarding" | "credit" | "fraud" | "payments" | "pfm" | "openfinance"
PRODUCTS (exact names): Core Verify, Core Verify Plus, Balance Insights
BUNDLE RULE: "Core Verify Plus" is a bundle that includes Core Verify. Never list both — if Core Verify Plus fits, use only "Core Verify Plus" and omit "Core Verify".

PRODUCT CONFIDENCE TIERS:
HIGH CONFIDENCE — use freely as primary fit indicators and scoring signals:
Core Verify, Core Verify Plus
LOWER CONFIDENCE — include as secondary/possible fit only, never sole reason for Gold:
Balance Insights
RULE: A Gold score requires at least one HIGH CONFIDENCE product with clear evidence. Lower confidence products can appear in recommendations but cannot be the primary justification for tier.

${customIntel ? `ADDITIONAL CONTEXT FROM AE:\n${customIntel.slice(0,2000)}\n` : ""}${exampleAccts ? `\nCALIBRATION EXAMPLES:\n${exampleAccts.slice(0,1500)}\n` : ""}
Return ONLY this JSON:
{"score":1,"tier":"Gold","businessModel":"2 sentences","productFit":"2 sentences","useCases":["payments"],"products":["Core Verify","Balance Insights"],"keySignals":["signal1"],"disqualifier":null,"confidence":"High","isActive":true,"bankConnectSignal":false,"businessModelPattern":"platform","estimatedDownstreamUsers":"","isEstablished":true,"tractionSignals":[],"distributionMultiplier":false,"signalBreakdown":{"paymentSignals":[],"onboardingSignals":[],"scaleSignals":[],"platformSignals":[],"slagSignals":[],"signalScore":50,"topSignal":""}}`,
      messages: [{ role:"user", content:`Score product fit:\nCompany: ${name}\nWebsite: ${web||"none"}\nVertical: ${vert||"unknown"}\nSubvertical: ${sub||"unknown"}\nPipeline stage: ${stage||"Prospecting"}\nWebsite content (fetch method: ${fetchMethod}): ${siteContent||"not available"}\n${signalSummary}\nReturn ONLY the JSON.` }],
    }),
  });
  const data = await response.json();
  const textBlock = (data.content||[]).find(b=>b.type==="text");
  if (!textBlock) throw new Error("No response from Claude");
  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Could not parse assay response");
  const parsed = JSON.parse(jsonMatch[0]);

  // Post-processing (mirrors server)
  if (!parsed.signalBreakdown && signalBreakdown) parsed.signalBreakdown = signalBreakdown;

  // Hard override: local signal detection found parked/dead/acquired signals
  if (signalBreakdown?.slagSignals?.some(s => /(parked|expired|suspended|shutdown|acquisition|absorbed)/.test(s))) {
    parsed.isActive = false;
    parsed.score = 4;
    parsed.tier = "Slag";
    if (!parsed.disqualifier) {
      const sig = signalBreakdown.slagSignals.find(s => /(parked|expired|suspended|shutdown|acquisition|absorbed|coming.soon|under.construction)/.test(s)) || '';
      const code = /acquired|absorption|now part of/.test(sig) ? 'acquired' : /suspended/.test(sig) ? 'suspended' : /coming.soon|under.construction|launching.soon/.test(sig) ? 'coming_soon' : 'dead_site';
      parsed.disqualifier = `${code} — ${sig || 'site inactive or unreachable'}`;
    }
  }

  if (!parsed.bankConnectSignal && Array.isArray(parsed.keySignals)) {
    const sigText = parsed.keySignals.join(" ").toLowerCase();
    if (/bank.{0,15}(connect|link|verif)|connect.{0,10}bank|instant.{0,5}(bank|ach)|open.?banking|pay.{0,5}bank|link.{0,10}account/.test(sigText)) parsed.bankConnectSignal = true;
  }
  if (!parsed.distributionMultiplier && ["platform","b2b2c","marketplace","embedded"].includes(parsed.businessModelPattern)) parsed.distributionMultiplier = true;
  if (parsed.distributionMultiplier && parsed.score > 1 && parsed.isActive !== false) { parsed.score = 1; parsed.tier = "Gold"; }
  if (parsed.disqualifier && /unreachable|site.*fail|cannot.*access|failed to load/i.test(parsed.disqualifier)) { parsed.disqualifier = null; parsed.confidence = "Low"; }
  if (!Array.isArray(parsed.tractionSignals)) parsed.tractionSignals = [];
  // Bundle normalization: Core Verify Plus supersedes Core Verify; remove Core Verify if both present
  if (Array.isArray(parsed.products) && parsed.products.includes("Core Verify Plus")) {
    parsed.products = parsed.products.filter(p => p !== "Core Verify");
  }

  return { ...parsed, linkedin, fetchMethod };
}

export const buildVoiceContext = (vp) => {
  if (!vp) return "";
  return [
    `Greeting: ${vp.greeting || "Hey [First Name],"}`,
    `Closing: ${vp.closing || "- AE"}`,
    `Tone: ${vp.tone || "direct"} · Length: ${vp.avgEmailLength || "brief"} · Formality: ${vp.formalityLevel || 2}/5`,
    vp.commonPhrases?.length ? `Common phrases: ${vp.commonPhrases.join(", ")}` : null,
    vp.avoidPhrases?.length ? `Never use: ${vp.avoidPhrases.join(", ")}` : null,
    vp.keyTraits?.length ? `Traits: ${vp.keyTraits.join(", ")}` : null,
  ].filter(Boolean).join("\n");
};
