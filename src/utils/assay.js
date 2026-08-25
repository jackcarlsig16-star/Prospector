import { SEED_INTEL_DOCS } from '../constants/products';
import { MODELS } from '../config/models';
import { stripCitationMarkup } from './textSanitize';

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

// assay-citation-leak-and-raw-edit-dual-write-v1 Fix 1 — real bug found live:
// web_search results carry their own inline citation markup
// (<cite index="X-Y">...</cite>), and without an explicit instruction not to,
// the model sometimes echoes that markup verbatim into businessModel/
// productFit instead of writing plain prose. Confirmed on 2 of 20 real
// accounts. Unambiguous and direct on purpose, not a subtle phrasing - this
// exact failure mode already happened once with a softer implicit
// expectation.
const CITATION_FORMAT_INSTRUCTION = `OUTPUT FORMAT — businessModel and productFit must be plain prose only. Do not include citation tags, source markers, or any XML-like annotations such as <cite>, </cite>, <cite index="...">, or similar - write the content itself, never the citation wrapper around it.`;

// assay-engine-generalization-v1, narrowed by account-taxonomy-and-
// creation-upgrade-v1 Stage 2 — the original hardcoded fintech scoring
// prompt. As of Stage 2 this is ONLY reachable via Claim Jumper's
// not-yet-assigned pool scoring (no business object at all) — a real
// business with no Assay Criteria yet now gets buildGeneralizedPrompt({})
// instead (see clientAssay()'s comment). Do NOT "fix" this away for the
// pool path without a separate decision about ClaimJumperPage.js itself
// (already a flagged legacy-removal candidate) — this is intentionally
// scoped narrower now, not a bug.
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

${CITATION_FORMAT_INSTRUCTION}

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
function buildGeneralizedPrompt(criteria, relationshipType) {
  const isCompetitor = relationshipType === 'Competitor';
  return `You research a company from its real online presence for an AE, then assess how that company aligns with the specific business below. Respond with ONLY a JSON object, no other text.

TWO PHASES, IN THIS ORDER — do not merge them:
PHASE 1 — COLLECT. Research this company on its own terms, independent of the business below and its criteria. Establish what it does, what it sells, who it serves, how many people it employs, where and at what scale it operates. Use the website content and web search to find real facts. businessModel, employeeCount, keySignals and scaleSignals are phase-1 output: they must stand alone as an accurate profile of the company, readable and useful to someone who has never heard of the business below, and must contain no fit language at all.
PHASE 2 — ALIGN. Only once phase 1 is complete, lay the business's criteria over what you found and produce productFit, the score/tier, fitSignals, and any disqualifier.
You MUST call web_search at least once during phase 1, before writing any output, even when the fetched website content looks comprehensive. That content is the company's own marketing copy: it reliably describes products and locations and reliably does NOT state headcount, revenue, or any third-party fact. Search at minimum for the company's employee count (e.g. "<company name> number of employees"), plus whatever else phase 1 needs that the site does not state. A long site fetch is not a reason to skip the search - verified live, the site alone produces an empty phase 1.
Phase 2 must never truncate phase 1. Concluding early that an account aligns weakly is NOT a reason to stop researching it — a weak-fit company still gets a complete, accurate profile. An empty or thin phase 1 is a failure of the research, not a finding about the company.

SCORING: 1=Gold(strong direct fit), 2=Silver(solid indirect fit), 3=Tin(weak/speculative fit), 4=Slag(weak or no meaningful fit).
Score is a SPECTRUM, not a qualify/disqualify gate. Every account gets a real, reasoned score somewhere on it. A low score is a legitimate outcome; refusing to evaluate is not.
If site unreachable but the company's name/vertical suggests a fit per the criteria below, score based on that — do NOT score 4 just because the site failed to load.

ACCOUNT TYPE: ${relationshipType || 'Prospect/Lead'}
${isCompetitor
  ? `This account is explicitly typed a COMPETITOR. That is the one hard exclusion: score 4=Slag and set disqualifier to "competitor — <one sentence on how they compete>".`
  : `This account is NOT typed a competitor. Assume it is a potential prospect or customer. Do NOT treat it as a competitor or as categorically excluded on the basis of what it sells. Being in an unrelated industry is a reason for a LOW score with a clear rationale, never a reason to skip real evaluation.`}

BEFORE concluding any category-based non-fit, check the FIT SIGNALS below against what this account actually IS, not just what it sells. If the criteria describe traits an account can possess independently of its product — an employee base, a member or workforce population, a customer roster, a distribution channel — look for evidence of THAT trait and record what you find in fitSignals. A company whose product is unrelated may still match on the trait the criteria actually asks about. Only conclude non-fit after that check, and say in productFit which specific FIT SIGNALS criterion is not evidenced.
fitSignals and keySignals must not be left empty just because the score is low — a low score still needs the evidence it was reasoned from.
Claiming an ABSENCE is a factual claim and needs evidence like any other. Do not conclude "no workforce", "no employees", "no members", or "no benefits function" from the fact that a company sells to consumers — nearly every operating company employs people. If a criterion turns on headcount or membership, search for the real number and put it in fitSignals; if you genuinely cannot find one, say so and set confidence="Low" rather than asserting the absence.

NARRATIVE FRAMING — businessModel is pure phase-1 intel: describe the company only, with no reference to the business below or to fit. productFit is phase 2, and must still OPEN by stating what the company actually is and does in its own terms before any alignment language appears; the fit read comes after that, never as the first clause. Treat alignment as ADDITIVE — what a genuine match would unlock — rather than as a test the account passes or fails. The company's own intel is the primary content; the fit read is a lens laid over it.
Reserve exclusionary language ("no fit", "no meaningful fit", "wrong vertical", "not a fit", "disqualified") for an account that actually and specifically meets one of the DISQUALIFIERS conditions below. Absent that, an account that merely aligns weakly is "not the strongest fit today" with the reason stated plainly, and the fit verdict is carried by score and tier — not asserted in prose.
This governs how the reasoning is WRITTEN, not what it concludes: a weakly-aligned account still scores low.

THIS BUSINESS'S FIT CRITERIA — apply these instead of any generic vertical assumptions:
FIT SIGNALS: ${criteria.fit_signals || "(not specified)"}
DISQUALIFIERS: ${criteria.disqualifiers || "(not specified)"}
TIER GUIDANCE: ${criteria.tier_guidance || "(not specified)"}

DISTRIBUTION MULTIPLIER — CRITICAL OVERRIDE:
If the company is a PLATFORM or B2B2C play that serves other businesses as customers, score them Gold (1) regardless of company size. Look for: "SMB customers", "small business platform", "marketplace", "white-label", "embedded", "powered by", serving 1000+ downstream businesses.
Set distributionMultiplier=true and note downstream reach in estimatedDownstreamUsers.

DEFUNCT / ACQUIRED: Score 4=Slag and set isActive=false if site mentions "acquired by", "now part of", "no longer operating", "sunset", or is a holding page.

${isCompetitor ? `DISQUALIFIER — this account is typed Competitor, so that is the answer: score 4=Slag and disqualifier MUST begin with "competitor — ". Do not substitute an audience or category rationale for it; the rules below about weak fits do not apply to a competitor.

` : ''}DISQUALIFIER — three different things, do not conflate them:
- defunct/dormant (company no longer operating) — a hard exclusion.
- competitor — a hard exclusion, but ONLY when ACCOUNT TYPE above says Competitor. Never infer it from what the account sells.
- weak or partial fit against the DISQUALIFIERS criteria — NOT an exclusion. Score it low on the spectrum and explain why in productFit.
Set disqualifier only for the first two, or where the DISQUALIFIERS criteria are unambiguously met on their own terms; otherwise leave it null and let the low score carry the message. It is a one-sentence free-text explanation naming the specific criterion met (e.g. "wrong audience — this business's ICP is X, this account serves Y"). A live, non-competitor account that is merely a poor fit gets disqualifier null and a low score, not a disqualifier.

SITE UNREACHABLE POLICY: Score based on company name + vertical + the fit criteria above. Set confidence="Low". Do NOT set disqualifier to "site unreachable".

${WEB_SEARCH_GUIDANCE}

${CITATION_FORMAT_INSTRUCTION}

${GROUNDING_DISCIPLINE}

USE CASES: return 1-4 short free-text tags describing how this account could fit this business, grounded in FIT SIGNALS above — not a fixed enum, whatever's actually relevant here.
PRODUCTS: this business may not have a fixed product catalog — if FIT SIGNALS references specific offerings, use those exact names; otherwise return an empty array rather than inventing product names.

CONSISTENCY — never assert in productFit, businessModel or topSignal that a company lacks employees, a workforce, a member population or a constituency when employeeCount is non-null. A found headcount settles that question; if it is set, the company demonstrably has a workforce, and any remaining weakness is about distribution or infrastructure, which is a different and narrower claim. Say that narrower thing instead.

COMPANY METRICS — employeeCount: the company's real total headcount as an integer, when the website content or a search result actually states one (e.g. "26,000 employees" -> 26000). Use the company-wide figure, not a single site or department, and strip commas/ranges to a single number (a range like "500-1,000" -> its midpoint, 750). This is an extraction field, not an estimate: if no source actually states a number, return null. Do NOT infer headcount from revenue, office count, funding stage, or company age, and do NOT guess a plausible figure - null is the correct answer whenever no real number was found, and it is never a reason to lower the score on its own.

SIGNAL BREAKDOWN — fill signalBreakdown's arrays with short evidence strings pulled from the site content/search results above (not the FIT CRITERIA text itself, which is business-level context, not per-account evidence):
scaleSignals: company size, customer base, or market reach evidence (e.g. "40+ named customers", "multi-state operations").
fitSignals: technical, operational, or structural characteristics indicating whether this business's product would actually fit THIS prospect, grounded in the FIT CRITERIA above — generic to whatever this business sells, not payment/platform-specific.
adoptionSignals: evidence of buying readiness, onboarding complexity/timing, or general purchase-intent signals — not narrowly identity-verification/KYC-specific.
slagSignals: signs the company is inactive, defunct, or a clear non-fit (parked domain, shutdown/acquisition language, template placeholder site, etc).
signalScore: 0-100 rough confidence-in-fit score derived from the above. topSignal: the single strongest piece of evidence found, or "" if none — state it as a real fact established about the company, never as a summary of what the company lacks.

Return ONLY this JSON:
{"score":1,"tier":"Gold","businessModel":"2 sentences describing only the company itself, no fit language","productFit":"2-3 sentences — opens by stating what the company is/does, then the alignment read","useCases":["tag1"],"products":[],"keySignals":["signal1"],"disqualifier":null,"confidence":"High","isActive":true,"employeeCount":null,"businessModelPattern":"platform","estimatedDownstreamUsers":"","isEstablished":true,"tractionSignals":[],"distributionMultiplier":false,"ungroundedClaims":[],"signalBreakdown":{"fitSignals":[],"adoptionSignals":[],"scaleSignals":[],"slagSignals":[],"signalScore":50,"topSignal":""}}`;
}

// businessId is optional (Claim Jumper's not-yet-assigned pool scoring has
// none — deliberate, see below). When present, fetches that business's
// cached Assay Criteria (cheap read, not a fresh generation — see
// AssayCriteriaCard.js/generateAssayCriteria() for the generation side) and
// scores against it instead of the hardcoded fintech prompt.
//
// account-taxonomy-and-creation-upgrade-v1 Stage 2 — real-data check found
// the legacy fintech prompt (buildLegacyFintechPrompt) is NOT hypothetical
// dead code: 3 of 4 real businesses already have Assay Criteria, but Kopi
// Kita does not yet, and any brand-new business (which this same SPEC makes
// easier to create) always transits through "no criteria yet" before its
// first generation. That prompt's vertical-keyed rules and fixed product
// catalog (Core Verify/Balance Insights) are fintech-specific by
// construction, not just its vertical NAMES — patching the names in place
// would still leave Kopi Kita-shaped businesses being scored against
// bank-verification product fit. So: a businessId with no criteria yet now
// falls through to buildGeneralizedPrompt() with empty criteria (honest
// "no fit signals defined yet" scoring, same function already proven not to
// leak global fintech customIntel/exampleAccts into per-business scoring)
// instead of the fintech prompt. The fintech prompt itself is UNCHANGED and
// still used for the one remaining businessId-less case — Claim Jumper's
// pool, which isn't tied to any live business object and is itself a
// separately-flagged legacy-removal candidate, not something to redesign
// here.
export async function clientAssay({ name, web, vert, customIntel, exampleAccts, stage, businessId, relationshipType }) {
  let siteContent = "", linkedin = null, signalBreakdown = null, fetchMethod = "none";
  if (web) {
    const { content, method } = await fetchSiteContentClient(web);
    fetchMethod = method;
    if (content) {
      siteContent = content;
      const liMatch = siteContent.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-zA-Z0-9_\-\.]+\/?/i);
      if (liMatch) linkedin = liMatch[0].replace(/\/$/, "") + "/";
      // assay-signal-schema-coherence-and-token-budget-v1 Stage 1 - detectSignals()
      // is a hardcoded fintech-term detector (ach/kyc/bank transfer/etc); its
      // old-schema output (paymentSignals/platformSignals/onboardingSignals)
      // contradicted buildGeneralizedPrompt's fitSignals/adoptionSignals
      // vocabulary and let fintech noise read as real fit signals for
      // non-fintech businesses. Real businesses (businessId present) skip it
      // entirely; Claim Jumper's pool (no businessId) keeps it - fintech
      // detection is genuinely appropriate there.
      if (!businessId) signalBreakdown = detectSignals(siteContent);
    } else { siteContent = "Site unreachable after fetch attempt"; }
  }
  const signalSummary = signalBreakdown ? `\nPRE-DETECTED SIGNALS:\n${JSON.stringify(signalBreakdown,null,2)}\n` : "";

  let assayCriteria = null;
  if (businessId) {
    try {
      const r = await fetch(`/api/businesses/${businessId}/assay-criteria`);
      if (r.ok) { const d = await r.json(); assayCriteria = d.assay_criteria || null; }
    } catch { /* fall through */ }
  }
  const systemPrompt = assayCriteria
    ? buildGeneralizedPrompt(assayCriteria, relationshipType)
    : businessId
      ? buildGeneralizedPrompt({}, relationshipType) // real business, no criteria generated yet - honest empty-criteria scoring, not fintech rules
      : buildLegacyFintechPrompt(customIntel, exampleAccts); // Claim Jumper pool only - no business object at all

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
      // assay-mandatory-evidence-search-v1 — the model would not call
      // web_search on its own. Instrumented on prod: tools sent correctly,
      // stop_reason end_turn, 640/1600 output tokens, zero server_tool_use
      // blocks - it read the company's own marketing site and wrote the JSON
      // without searching, so headcount and any third-party fact were never
      // available. An explicit "You MUST call web_search" directive changed
      // nothing (still zero). tool_choice is an API-level constraint the
      // prompt cannot substitute for. Costs ~3.4x input tokens (8,650 ->
      // 28,915) because results enter the context; accepted deliberately.
      // Generalized path only - the legacy fintech prompt (Claim Jumper's
      // pool, no businessId) has no headcount criterion to satisfy.
      ...(businessId ? { tool_choice: { type: "any" } } : {}),
      messages: [{ role:"user", content:`Score product fit:\nCompany: ${name}\nWebsite: ${web||"none"}\nVertical: ${vert||"unknown"}\nPipeline stage: ${stage||"Prospecting"}\nWebsite content (fetch method: ${fetchMethod}): ${siteContent||"not available"}\n${signalSummary}\nReturn ONLY the JSON.` }],
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

  // Hard override, not just a prompt instruction - same reasoning as the
  // confidence cap below. Verified live: a Competitor-typed account with
  // strong fit evidence came back score 1/Gold, disqualifier null, despite
  // the prompt stating the competitor rule twice including "MUST begin with
  // competitor —". Evidence of fit outweighs one instruction, so the gate
  // can't live in the prompt. Type is the only competitor gate; it is set
  // by a human on the account, so it is trusted over the model's read.
  if (relationshipType === 'Competitor') {
    parsed.score = 4;
    parsed.tier = "Slag";
    if (!/^competitor\b/i.test(parsed.disqualifier || '')) {
      parsed.disqualifier = `competitor — typed as a competitor on the account${parsed.disqualifier ? `; model note: ${parsed.disqualifier}` : ''}`;
    }
  }

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

  // Same !businessId gate detectSignals() already uses - fintech-term matching
  // only belongs on Claim Jumper's pool. Verified against the real assay path:
  // keySignals like "Instant ACH bank verification at signup" forced this true
  // for a non-fintech business before the gate.
  if (!businessId && !parsed.bankConnectSignal && Array.isArray(parsed.keySignals)) {
    const sigText = parsed.keySignals.join(" ").toLowerCase();
    if (/bank.{0,15}(connect|link|verif)|connect.{0,10}bank|instant.{0,5}(bank|ach)|open.?banking|pay.{0,5}bank|link.{0,10}account/.test(sigText)) parsed.bankConnectSignal = true;
  }
  if (!parsed.distributionMultiplier && ["platform","b2b2c","marketplace","embedded"].includes(parsed.businessModelPattern)) parsed.distributionMultiplier = true;
  if (parsed.distributionMultiplier && parsed.score > 1 && parsed.isActive !== false) { parsed.score = 1; parsed.tier = "Gold"; }
  if (parsed.disqualifier && /unreachable|site.*fail|cannot.*access|failed to load/i.test(parsed.disqualifier)) { parsed.disqualifier = null; parsed.confidence = "Low"; }
  // Extraction field, not an assessment - anything the model returns that
  // isn't a real positive number becomes null rather than a displayed guess
  // ("unknown", "~5000", 0, NaN all collapse to null). Same evidence
  // requirement as the disqualifier/confidence guards above.
  const ec = typeof parsed.employeeCount === 'string' ? Number(parsed.employeeCount.replace(/[^0-9.]/g, '')) : parsed.employeeCount;
  parsed.employeeCount = Number.isFinite(ec) && ec > 0 ? Math.round(ec) : null;
  if (!Array.isArray(parsed.tractionSignals)) parsed.tractionSignals = [];
  if (!Array.isArray(parsed.ungroundedClaims)) parsed.ungroundedClaims = [];
  // assay-additive-fit-framing-v1 REVISION 3 — phase 2 kept asserting an
  // absence that phase 1 had just disproved: real Hertz output read "no
  // identifiable employee population... While the company operates at
  // significant scale with approximately 26,000 employees globally" in one
  // paragraph. employeeCount and fitSignals are filled by separate,
  // unconnected instructions (COMPANY METRICS vs SIGNAL BREAKDOWN), so a
  // found headcount never reached the evidence array the confidence guard
  // reads, and nothing stopped the narrative contradicting it. Prompt-only
  // has failed three times today, so both halves are enforced in code.
  if (parsed.employeeCount) {
    // A real headcount IS fit evidence when the criteria turn on workforce
    // size. Without this the confidence guard below sees an empty array and
    // downgrades a result that did find hard evidence.
    const fsArr = parsed.signalBreakdown?.fitSignals;
    if (Array.isArray(fsArr) && fsArr.length === 0) {
      fsArr.push(`${parsed.employeeCount.toLocaleString('en-US')} employees (headcount found during research)`);
    }
    // Drop only sentences that deny a workforce EXISTS - negation + a
    // workforce noun + a population noun together, and no figure of their
    // own. Narrower claims ("no HR benefits function", "no member services
    // team") are about infrastructure, aren't contradicted by a headcount,
    // and are deliberately left standing.
    // The negation must directly govern the workforce noun-phrase - no verb or
    // preposition may sit between them. That is what separates "no employee
    // population" (denies the workforce exists, and a found headcount
    // disproves it) from "no HR function serving employee populations" (an
    // infrastructure gap a headcount says nothing about, left standing). A
    // sentence citing its own figure is already reconciling with the number.
    const DENY = /\b(?:no|neither|nor|without|lacks?|lacking)\s+(?:(?!serving|for|to|across|among|within|through)\w+\s+){0,3}(?:employee|workforce|member|staff)s?\b(?:\s+(?:or|and|nor)\s+\w+)?[^.,;]{0,24}?\b(?:population|base|constituenc\w+|constituent)s?\b/i;
    const denies = t => DENY.test(t) && !/\d/.test(t);
    const scrub = text => {
      if (!text) return text;
      const kept = String(text).split(/(?<=[.!?])\s+/).filter(sent => !denies(sent));
      return kept.join(' ').trim();
    };
    for (const field of ['productFit', 'businessModel']) {
      const next = scrub(parsed[field]);
      if (next !== parsed[field]) {
        parsed.ungroundedClaims.push(`Removed an absence-of-workforce claim from ${field} contradicted by employeeCount ${parsed.employeeCount}`);
        parsed[field] = next;
      }
    }
    if (parsed.signalBreakdown?.topSignal && denies(parsed.signalBreakdown.topSignal)) {
      parsed.signalBreakdown.topSignal = `${parsed.employeeCount.toLocaleString('en-US')} employees`;
    }
  }
  // Hard override, not just prompt instruction - don't trust the model to
  // self-enforce its own confidence cap every time.
  if (parsed.ungroundedClaims.length && parsed.confidence === "High") parsed.confidence = "Medium";
  // Same class: the prompt above already asks for confidence="Low" when no
  // fitSignals evidence was found, and it did not hold - 30 of 73 analyzed
  // accounts came back with fitSignals: [] AND confidence: "High". An absence
  // asserted with no evidence behind it cannot be high-confidence. Generalized
  // path only; Claim Jumper's legacy prompt has no fitSignals array at all.
  if (businessId && parsed.confidence === "High" && !parsed.signalBreakdown?.fitSignals?.length) parsed.confidence = "Low";
  // Same evidence requirement, applied to the disqualifier itself rather than
  // only to confidence. Real case: Ramp (>1,000 employees) came back with
  // disqualifier "Wrong audience — ... it has no employee or member
  // constituency" and fitSignals: [] - a false absence claim rendering as
  // stated fact. An exclusion asserted with no evidence behind it is not an
  // exclusion; the low score and Low confidence already carry the message.
  // Two exemptions, both deliberate: a Competitor disqualifier is set from
  // human-typed Type just above and is never the model's read, and a defunct
  // claim is left alone because it is NOT independently evidenced on this path
  // (detectSignals' hard override above is gated !businessId, so for a real
  // business defunct rests on the model's own isActive/slagSignals) - nulling
  // it here would weaken a genuine defunct exclusion rather than an unevidenced
  // one. isActive is the defunct signal and the only one usable here: the
  // prompt defines slagSignals as "inactive, defunct, OR a clear non-fit", so
  // it is not defunct-specific - verified live, Ramp returned two non-fit
  // slagSignals and an earlier version of this guard exempted it on that basis.
  if (
    businessId &&
    parsed.disqualifier &&
    relationshipType !== 'Competitor' &&
    parsed.isActive !== false &&
    !parsed.signalBreakdown?.fitSignals?.length
  ) {
    parsed.disqualifier = null;
  }
  // Bundle normalization: Core Verify Plus supersedes Core Verify; remove Core
  // Verify if both present. Gated on !businessId - these are buildLegacyFintechPrompt's
  // product names, so only Claim Jumper's pool can legitimately return them.
  if (!businessId && Array.isArray(parsed.products) && parsed.products.includes("Core Verify Plus")) {
    parsed.products = parsed.products.filter(p => p !== "Core Verify");
  }

  // Fix 1 (belt-and-suspenders) - CITATION_FORMAT_INSTRUCTION above should
  // stop this at the source, but a prompt instruction isn't a hard guarantee
  // (confirmed live: it leaked before this instruction existed). Stripped
  // here, at the single point every real caller's bm/pf ultimately derives
  // from (AccountsPage.js's reassay, bulkAssay.js, ClaimJumperPage.js all
  // read parsed.businessModel/productFit from this return value) - one fix,
  // not one per call site.
  if (parsed.businessModel) parsed.businessModel = stripCitationMarkup(parsed.businessModel);
  if (parsed.productFit) parsed.productFit = stripCitationMarkup(parsed.productFit);

  return { ...parsed, linkedin, fetchMethod };
}

// assay-employee-count-metric-v1 REVISION 2 — mirrors generateProfile's
// EDITABLE_FIELDS skip (api/businesses/shared.js:589), the codebase's only
// real overwrite protection: a manually-entered value is never silently
// replaced by an automated re-assay. NOT the assay_criteria_edited_manually
// pattern, which is a provenance label that regeneration deliberately resets.
// Lives here rather than inside clientAssay() because clientAssay is a pure
// function of the fresh result and never sees the existing account; every
// merge site calls this instead of spreading `parsed` directly.
export function preserveManualEdits(existing, parsed) {
  if (!existing?.employeeCountEditedManually) return parsed;
  return { ...parsed, employeeCount: existing.employeeCount ?? null, employeeCountEditedManually: true };
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
      business_model_pattern: parsed.businessModelPattern || null,
      estimated_downstream_users: parsed.estimatedDownstreamUsers || null,
      is_established: parsed.isEstablished,
      distribution_multiplier: parsed.distributionMultiplier,
      employee_count: parsed.employeeCount ?? null,
      use_cases: parsed.useCases || [],
      products: parsed.products || [],
      fetch_method: parsed.fetchMethod || null,
      linkedin: parsed.linkedin || null,
    },
  };
}
