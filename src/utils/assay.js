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

// audit-triage-v1 follow-up — was 4000. Confirmed live that real pages
// return far more (Bilt Rewards: 71,982 real chars, only ~5.6% of it was
// reaching the model). 10000 is a deliberate middle ground: MODELS.FAST has
// plenty of headroom for it, but Assay runs per-account at bulk scale (up to
// ~100/hour per the product's own Phase-1 goal), so this isn't raised to the
// max just because tokens are cheap - a much larger cap would add real
// latency/cost multiplied across a bulk run for diminishing signal past this
// point (most useful page content live-tested was front-loaded).
export async function fetchSiteContentClient(web) {
  const url = web.startsWith("http") ? web : `https://${web}`;
  try {
    const r = await fetch(`/proxy/jina?url=${encodeURIComponent(url)}`, { signal:AbortSignal.timeout(15000) });
    if (r.ok) { const text = await r.text(); if (text && text.length > 100 && !text.toLowerCase().includes("jina.ai error")) return { content: text.slice(0, 10000), method: "jina" }; }
  } catch (_) {}
  return { content: null, method: "failed" };
}

// audit-triage-v1 follow-up — live diagnostic this session found a real
// hallucination class: Coconut Cult's fetched page never mentioned "Chicago"
// anywhere, but the model asserted "Chicago-area wellness food brand" at
// confidence:High anyway. Shared by both prompt builders below - the model
// must distinguish "stated in the retrieved content" from "recalled/
// inferred" and surface the difference, not just assert everything as fact.
const GROUNDING_DISCIPLINE = `GROUNDING DISCIPLINE — this is the most important rule in this prompt:
Only state a specific factual claim (location, funding status, team size, customer count, named partnerships, "based in X", etc.) as fact if it is EXPLICITLY present in the website content or web search results provided below. Do not fill gaps with background knowledge or a plausible-sounding inference and present it as verified fact.
If you want to reference something you believe is likely true but that is not explicitly stated in the retrieved content, either omit it, or phrase it as a hedge ("appears to be", "likely") in the relevant field AND list the specific claim in "ungroundedClaims".
"ungroundedClaims": array of short strings — one per specific claim used anywhere in businessModel/productFit/keySignals that is not directly stated in the retrieved website/search content. Empty array if every specific claim used is directly sourced from that content.
If ungroundedClaims is non-empty, confidence must NOT be "High" — cap it at "Medium" or lower, since part of the reasoning rests on unverified inference rather than confirmed content.`;

// Same reasoning/framing already proven live in runResearch() (this file
// family, api/businesses/shared.js) - "recent news, competitors, market
// position" - extended per Jack's ask to also surface motto/founder info
// where findable. Tool version matches CallPrepModal.js's client-side
// precedent (web_search_20250305), not runResearch()'s server-side
// web_search_20260209 - confirmed those are different tool versions for
// client vs server /proxy paths, the client one is what actually works
// through the same /proxy/anthropic/messages call clientAssay() uses below.
const WEB_SEARCH_GUIDANCE = `WEB SEARCH — use it to find recent news, competitors, market position, and the company's motto/founder info where findable, on top of (not instead of) the fetched website content below. Only surface search findings in businessModel/productFit/keySignals if genuinely relevant to fit — don't pad with filler, and the same GROUNDING DISCIPLINE above applies to anything found via search: state it as fact only if the search result actually said it.`;

// assay-engine-generalization-v1 — the original hardcoded fintech scoring
// prompt, preserved verbatim as the deliberate fallback for when no business
// context is available (Claim Jumper's not-yet-assigned pool scoring) or a
// business hasn't generated Assay Criteria yet. Do NOT "fix" this away —
// see clientAssay()'s comment for why this path is intentional, not a bug.
function buildLegacyFintechPrompt(customIntel, exampleAccts) {
  return `You are a product fit scoring engine for an SMB AE. Respond with ONLY a JSON object, no other text.

SCORING: 1=Gold(strong direct product fit), 2=Silver(solid indirect fit), 3=Tin(weak/speculative fit), 4=Slag(defunct OR zero fintech angle).
Be generous: payments, lending, banking, crypto, insurance, wealth, PFM, payroll, EWA, rent, HR with payments = Gold or Silver.
If site unreachable but vertical suggests fintech, score based on vertical — do NOT score 4 just because the site failed to load.

DISTRIBUTION MULTIPLIER — CRITICAL OVERRIDE:
If the company is a PLATFORM or B2B2C play that serves other businesses as customers, score them Gold (1) regardless of company size. Look for: "SMB customers", "small business platform", "marketplace", "white-label", "embedded", "powered by", serving 1000+ downstream businesses.
Set distributionMultiplier=true and note downstream reach in estimatedDownstreamUsers.

DEFUNCT / ACQUIRED: Score 4=Slag and set isActive=false if site mentions "acquired by", "now part of", "no longer operating", "sunset", or is a holding page.
Set disqualifier as: "reason_code — one sentence explanation." Reason codes: dead_site | wrong_vertical | no_fiat_rail | acquired | crypto_no_bank | b2c_only | no_fintech | coming_soon | suspended | stale. Example: "acquired — absorbed by Stripe in 2022, no longer an independent prospect." If active, disqualifier must be null.

SITE UNREACHABLE POLICY: Score based on company name + vertical + industry knowledge. Set confidence="Low". Do NOT set disqualifier to "site unreachable".

${WEB_SEARCH_GUIDANCE}

${GROUNDING_DISCIPLINE}

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
{"score":1,"tier":"Gold","businessModel":"2 sentences","productFit":"2 sentences","useCases":["payments"],"products":["Core Verify","Balance Insights"],"keySignals":["signal1"],"disqualifier":null,"confidence":"High","isActive":true,"bankConnectSignal":false,"businessModelPattern":"platform","estimatedDownstreamUsers":"","isEstablished":true,"tractionSignals":[],"distributionMultiplier":false,"ungroundedClaims":[],"signalBreakdown":{"paymentSignals":[],"onboardingSignals":[],"scaleSignals":[],"platformSignals":[],"slagSignals":[],"signalScore":50,"topSignal":""}}`;
}

// assay-engine-generalization-v1 — business-criteria-driven prompt, used
// whenever a business has generated Assay Criteria (src/components/AssayCriteriaCard.js).
// Same output JSON shape as the legacy prompt (downstream UI reads these exact
// field names) but the fit/disqualifier/tier reasoning comes from that business's
// own criteria instead of hardcoded fintech verticals and a fixed product catalog —
// this business may not sell verification products at all.
//
// Deliberately does not take customIntel/exampleAccts (unlike the legacy prompt):
// those are global AE-level state (prospector_intel_docs / SEED_INTEL_DOCS,
// prospector_example_accts), not scoped per business, and still hold the
// original fintech product docs (Core Verify etc). Injecting them here bled
// fintech language into every other business's scoring regardless of that
// business's own criteria (confirmed live against HumanKind/The Coconut Cult).
// assay_criteria is the intended full substitute for business-specific
// context in this path — don't re-add these params without giving AEs a
// business-scoped equivalent first.
function buildGeneralizedPrompt(criteria) {
  return `You are a product/partnership fit scoring engine for an AE, scoring how well a prospect account fits the specific business below. Respond with ONLY a JSON object, no other text.

SCORING: 1=Gold(strong direct fit), 2=Silver(solid indirect fit), 3=Tin(weak/speculative fit), 4=Slag(defunct OR no meaningful fit).
If site unreachable but the company's name/vertical suggests a fit per the criteria below, score based on that — do NOT score 4 just because the site failed to load.

THIS BUSINESS'S FIT CRITERIA — apply these instead of any generic vertical assumptions:
FIT SIGNALS: ${criteria.fit_signals || "(not specified)"}
DISQUALIFIERS: ${criteria.disqualifiers || "(not specified)"}
TIER GUIDANCE: ${criteria.tier_guidance || "(not specified)"}

DISTRIBUTION MULTIPLIER — CRITICAL OVERRIDE:
If the company is a PLATFORM or B2B2C play that serves other businesses as customers, score them Gold (1) regardless of company size. Look for: "SMB customers", "small business platform", "marketplace", "white-label", "embedded", "powered by", serving 1000+ downstream businesses.
Set distributionMultiplier=true and note downstream reach in estimatedDownstreamUsers.

DEFUNCT / ACQUIRED: Score 4=Slag and set isActive=false if site mentions "acquired by", "now part of", "no longer operating", "sunset", or is a holding page.
Set disqualifier as a free-text one-sentence explanation grounded in the DISQUALIFIERS criteria above (e.g. "wrong audience — this business's ICP is X, this account serves Y"). If active and not disqualified, disqualifier must be null.

SITE UNREACHABLE POLICY: Score based on company name + vertical + the fit criteria above. Set confidence="Low". Do NOT set disqualifier to "site unreachable".

${WEB_SEARCH_GUIDANCE}

${GROUNDING_DISCIPLINE}

USE CASES: return 1-4 short free-text tags describing how this account could fit this business, grounded in FIT SIGNALS above — not a fixed enum, whatever's actually relevant here.
PRODUCTS: this business may not have a fixed product catalog — if FIT SIGNALS references specific offerings, use those exact names; otherwise return an empty array rather than inventing product names.

Return ONLY this JSON:
{"score":1,"tier":"Gold","businessModel":"2 sentences","productFit":"2 sentences — fit rationale against this business's criteria","useCases":["tag1"],"products":[],"keySignals":["signal1"],"disqualifier":null,"confidence":"High","isActive":true,"bankConnectSignal":false,"businessModelPattern":"platform","estimatedDownstreamUsers":"","isEstablished":true,"tractionSignals":[],"distributionMultiplier":false,"ungroundedClaims":[],"signalBreakdown":{"paymentSignals":[],"onboardingSignals":[],"scaleSignals":[],"platformSignals":[],"slagSignals":[],"signalScore":50,"topSignal":""}}`;
}

// businessId is optional (Claim Jumper's not-yet-assigned pool scoring has
// none — deliberate, see below). When present, fetches that business's
// cached Assay Criteria (cheap read, not a fresh generation — see
// AssayCriteriaCard.js/generateAssayCriteria() for the generation side) and
// scores against it instead of the hardcoded fintech prompt. Falls back to
// the legacy fintech prompt when businessId is absent OR the business hasn't
// generated criteria yet — this fallback is intentional, documented
// behavior for the pool-scoring path, not a bug to "fix" away later.
export async function clientAssay({ name, web, vert, sub, customIntel, exampleAccts, stage, businessId }) {
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

  let assayCriteria = null;
  if (businessId) {
    try {
      const r = await fetch(`/api/businesses/${businessId}/assay-criteria`);
      if (r.ok) { const d = await r.json(); assayCriteria = d.assay_criteria || null; }
    } catch { /* fall through to legacy prompt */ }
  }
  const systemPrompt = assayCriteria
    ? buildGeneralizedPrompt(assayCriteria)
    : buildLegacyFintechPrompt(customIntel, exampleAccts);

  const response = await fetch("/proxy/anthropic/messages", {
    method: "POST",
    headers: { "Content-Type":"application/json", "anthropic-version":"2023-06-01" },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      model: MODELS.FAST,
      // Raised from 900 - web_search tool-use/result blocks count against
      // this budget too (confirmed via CallPrepModal.js's precedent, which
      // uses 2500 for a comparable web_search+JSON task), and there needs to
      // be enough left over after up to 3 search rounds to still emit the
      // full final JSON.
      max_tokens: 1600,
      system: systemPrompt,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
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
  if (!Array.isArray(parsed.ungroundedClaims)) parsed.ungroundedClaims = [];
  // Hard override, not just prompt instruction - don't trust the model to
  // self-enforce its own confidence cap every time.
  if (parsed.ungroundedClaims.length && parsed.confidence === "High") parsed.confidence = "Medium";
  // Bundle normalization: Core Verify Plus supersedes Core Verify; remove Core Verify if both present
  if (Array.isArray(parsed.products) && parsed.products.includes("Core Verify Plus")) {
    parsed.products = parsed.products.filter(p => p !== "Core Verify");
  }

  return { ...parsed, linkedin, fetchMethod };
}

// account-business-details-v1 — converts a clientAssay() result into
// account_business_details' row shape. Narrow-scope decision (Jack,
// 2026-08-17): only AccountsPage.js's single/bulk re-assay call this and
// write the result to the new table; clientAssay() itself stays a pure
// function with its accounts.data-writing behavior completely unchanged,
// so Claim Jumper's pool scoring and any other clientAssay() caller outside
// that narrow scope are unaffected. business_model/fit_rationale get their
// own columns (was businessModel/bm and productFit/pf - two names for the
// same value, now one each); disqualifier/score/tier keep their names
// unchanged. Everything else clientAssay() returns is supporting evidence
// behind the fit call, not dropped - nested under fit_signals instead of
// 14 more top-level columns.
export function mapAssayResultToBusinessDetails(parsed) {
  return {
    score: parsed.score ?? null,
    tier: parsed.tier || null,
    business_model: parsed.businessModel || null,
    fit_rationale: parsed.productFit || null,
    disqualifier: parsed.disqualifier ?? null,
    ungrounded_claims: Array.isArray(parsed.ungroundedClaims) && parsed.ungroundedClaims.length ? parsed.ungroundedClaims : null,
    fit_signals: {
      key_signals: parsed.keySignals || [],
      signal_breakdown: parsed.signalBreakdown || null,
      traction_signals: parsed.tractionSignals || [],
      confidence: parsed.confidence || null,
      is_active: parsed.isActive,
      bank_connect_signal: parsed.bankConnectSignal,
      business_model_pattern: parsed.businessModelPattern || null,
      estimated_downstream_users: parsed.estimatedDownstreamUsers || null,
      is_established: parsed.isEstablished,
      distribution_multiplier: parsed.distributionMultiplier,
      use_cases: parsed.useCases || [],
      products: parsed.products || [],
      fetch_method: parsed.fetchMethod || null,
      linkedin: parsed.linkedin || null,
    },
  };
}
