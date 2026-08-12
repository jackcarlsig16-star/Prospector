export const config = { maxDuration: 30 };

// ── Signal detection — run on raw scraped text ───────────────────────────────
function detectSignals(text) {
  const t = text.toLowerCase();

  const found = (patterns) => patterns.filter(p => {
    if (typeof p === "string") return t.includes(p.toLowerCase());
    return p.test(t);
  });

  const paymentHits = found([
    "connect bank", "link account", "link your bank", "bank transfer", "ach",
    "direct deposit", "wire transfer", "pay by bank", "instant verification",
    "micro-deposit", "microdeposit",
  ]);
  const competitorHits = found(["brightlinepay", "vergedata", "northstarfi"]);
  const onboardingHits = found([
    "verify identity", "kyc", "aml", "ssn", "ein",
    "bank-level security", "bank level security",
    /minutes to (get started|sign up|apply)/,
  ]);
  const creditHits = found([
    "check your rate", "apply now", "see if you qualify",
    "bank statements", "income verification", "asset verification",
    "no hard credit check", "soft credit check",
  ]);
  const scaleHits = found([
    /apps?\.apple\.com/,
    /play\.google\.com/,
    /\d[\d,]+\s*(users|customers|businesses|merchants)/,
    "pricing", "plans & pricing", "our pricing", "see pricing",
    "waitlist", "join the beta", "early access",
  ]);
  const platformHits = found([
    /api\./, "/api/", "api docs", "developer docs", "documentation",
    "our customers", "businesses we serve", "white label", "whitelabel",
    "white-label", "embedded finance", "powered by", "built for businesses",
    "partner", "integration", "marketplace",
  ]);

  // Slag / inactive signals
  const slagHits = found([
    "wix.com", "squarespace.com",
    "coming soon", "under construction", "launching soon",
    /copyright\s+20(19|20|21)\b/,  // 3+ years old
    // Parked / dead domain patterns
    "domain for sale", "this domain is for sale", "buy this domain",
    "parked domain", "domain parking", "godaddy.com/domains",
    "domain has expired", "domain expired", "renew this domain",
    "account suspended", "suspended domain",
    "this site can\u2019t be reached", "this page isn\u2019t working",
    "no longer operating", "we've shut down", "we have shut down",
    "wind down", "winding down", "sunsetting", "we are shutting",
    "acquired by", "now part of", "we\u2019ve joined", "we have joined",
  ]);

  const paymentSignals = [
    ...paymentHits.map(p => `"${typeof p === "string" ? p : p.toString()}" detected`),
    ...competitorHits.map(p => `competitor mention: ${p}`),
  ];
  const onboardingSignals = onboardingHits.map(p => `"${typeof p === "string" ? p : p.toString()}" detected`);
  const creditSignals = creditHits.map(p => `"${typeof p === "string" ? p : p.toString()}" detected`);
  const scaleSignals = (() => {
    const out = [];
    if (/apps?\.apple\.com/.test(t) || /play\.google\.com/.test(t)) out.push("app store link found");
    const userMatch = t.match(/(\d[\d,]+)\s*(users|customers|businesses|merchants)/);
    if (userMatch) out.push(`${userMatch[1]} ${userMatch[2]} mentioned`);
    if (/(pricing|plans & pricing|our pricing|see pricing)/.test(t)) out.push("pricing page exists");
    if (/(waitlist|join the beta|early access)/.test(t)) out.push("waitlist/beta — building traction");
    return out;
  })();
  const platformSignals = (() => {
    const out = [];
    if (/api\.|\/api\/|api docs|developer docs|documentation/.test(t)) out.push("API docs found");
    if (/(our customers|businesses we serve)/.test(t)) out.push("B2B distribution language");
    if (/(white.?label|embedded finance|powered by)/.test(t)) out.push("white-label / embedded language");
    if (/(partner|integration.*page|marketplace)/.test(t)) out.push("partner / integration page");
    return out;
  })();
  const slagSignals = (() => {
    const out = [];
    if (/(wix\.com|squarespace\.com)/.test(t)) out.push("template site builder detected");
    if (/(coming soon|under construction|launching soon)/.test(t)) out.push("coming soon — no live product");
    if (/copyright\s+20(19|20|21)\b/.test(t)) out.push("copyright 3+ years stale");
    if (/(domain for sale|buy this domain|parked domain|domain parking|domain has expired|domain expired|renew this domain|godaddy\.com\/domains)/.test(t)) out.push("parked / expired domain");
    if (/(account suspended|suspended domain)/.test(t)) out.push("account suspended");
    if (/(no longer operating|we.ve shut down|we have shut down|wind.{0,5}down|sunsetting|we are shutting)/.test(t)) out.push("company shutdown signal");
    if (/(acquired by|now part of|we.ve joined|we have joined)/.test(t)) out.push("acquisition / absorbed signal");
    return out;
  })();

  // Rough pre-score: each positive signal category adds points
  let signalScore = 50;
  signalScore += Math.min(paymentSignals.length * 8, 24);
  signalScore += Math.min(onboardingSignals.length * 6, 18);
  signalScore += Math.min(creditSignals.length * 6, 18);
  signalScore += Math.min(scaleSignals.length * 5, 20);
  signalScore += Math.min(platformSignals.length * 7, 21);
  signalScore -= Math.min(slagSignals.length * 15, 35);
  signalScore = Math.max(0, Math.min(100, signalScore));

  // Top signal summary
  const topSignalParts = [];
  if (paymentSignals.length) topSignalParts.push(`payment signals (${paymentSignals.slice(0,2).join(", ")})`);
  if (platformSignals.length) topSignalParts.push(platformSignals[0]);
  if (onboardingSignals.length) topSignalParts.push(onboardingSignals[0]);
  if (creditSignals.length) topSignalParts.push(creditSignals[0]);
  const topSignal = topSignalParts.length
    ? topSignalParts.slice(0, 2).join(" + ")
    : scaleSignals.length ? scaleSignals[0] : "No strong signals detected";

  return {
    paymentSignals,
    onboardingSignals: [...onboardingSignals, ...creditSignals],
    scaleSignals,
    platformSignals,
    slagSignals,
    signalScore,
    topSignal,
  };
}

// ── Fetch site content — try Jina first, fall back to direct ─────────────────
export async function fetchSiteContent(web) {
  const url = web.startsWith("http") ? web : `https://${web}`;

  // 1. Try Jina reader (best at extracting text from JS-heavy sites)
  try {
    const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        "Accept": "text/plain",
        "User-Agent": "Mozilla/5.0 (compatible; Prospector/1.0)",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (jinaRes.ok) {
      const text = await jinaRes.text();
      if (text && text.length > 100 && !text.toLowerCase().includes("jina.ai error")) {
        return { content: text.slice(0, 4000), method: "jina" };
      }
    }
  } catch (_) { /* fall through */ }

  // 2. Fall back to direct fetch with realistic browser headers
  try {
    const directRes = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (directRes.ok) {
      const html = await directRes.text();
      // Strip tags for rough text
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 100) {
        return { content: text.slice(0, 4000), method: "direct" };
      }
    }
  } catch (_) { /* fall through */ }

  return { content: null, method: "failed" };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { name, web, vert, sub, customIntel, exampleAccts, stage } = req.body;

  let siteContent = "";
  let linkedin = null;
  let signalBreakdown = null;
  let fetchMethod = "none";

  if (web) {
    const { content, method } = await fetchSiteContent(web);
    fetchMethod = method;
    if (content) {
      siteContent = content;
      // Extract LinkedIn URL
      const liMatch = siteContent.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-zA-Z0-9_\-\.]+\/?/i);
      if (liMatch) linkedin = liMatch[0].replace(/\/$/, "") + "/";
      // Run local signal detection
      signalBreakdown = detectSignals(siteContent);
    } else {
      siteContent = "Site unreachable after multiple fetch attempts";
    }
  }

  const signalSummary = signalBreakdown
    ? `\nPRE-DETECTED SIGNALS (from scraped content — use these to inform scoring):\n${JSON.stringify(signalBreakdown, null, 2)}\n`
    : "";

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 900,
        system: `You are a product fit scoring engine for an SMB AE. Respond with ONLY a JSON object, no other text.

SCORING: 1=Gold(strong direct product fit), 2=Silver(solid indirect fit), 3=Tin(weak/speculative fit), 4=Slag(defunct OR zero fintech angle).
Be generous: payments, lending, banking, crypto, insurance, wealth, PFM, payroll, EWA, rent, HR with payments = Gold or Silver.
If site unreachable but vertical suggests fintech, score based on vertical — do NOT score 4 just because the site failed to load.

DISTRIBUTION MULTIPLIER — CRITICAL OVERRIDE:
If the company is a PLATFORM or B2B2C play that serves other businesses as customers (not just end consumers), score them Gold (1) regardless of company size. A 10-person company serving 120k SMBs is a bigger opportunity than a 500-person direct consumer app. Look for:
- "SMB customers", "small business platform", "we serve X businesses", "marketplace", "white-label", "embedded", "powered by"
- "our customers can", "built for [vertical] businesses", "tools for [industry]"
- Any mention of serving 1000+ downstream businesses or end users
Set distributionMultiplier=true and note the downstream reach in estimatedDownstreamUsers.

DEFUNCT / ACQUIRED — CRITICAL RULE: Score 4=Slag and set isActive=false if ANY of these signals appear:
- Site or content mentions "acquired by", "now part of", "we've joined", "no longer operating", "sunset", "wind down"
- Site redirects to a different company's homepage
- Company is known to have been acquired
- Job listings page is empty or removed, no recent blog posts, copyright year is 2+ years stale
- Site content is a holding page, placeholder, or 404
Set disqualifier using this format: "reason_code — one sentence explanation." Reason codes: dead_site | wrong_vertical | no_fiat_rail | acquired | crypto_no_bank | b2c_only | no_fintech | coming_soon | suspended | stale. Example: "acquired — absorbed by Stripe in 2022, no longer an independent prospect." If active, disqualifier must be null.
A company can have strong fintech signals AND be Slag if it's been absorbed.

SITE UNREACHABLE POLICY: If the site failed to load, score based on company name + vertical + industry knowledge. Do NOT set disqualifier to "site unreachable" — that's a technical limitation, not a business signal. Set confidence="Low" instead.

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

GENERAL SIGNAL BOOSTS — apply regardless of vertical:
- KYC/AML/compliance language exists → add Core Verify Plus, boost score up
- "Bank account" + "verify" together → Core Verify fit → boost score
- Platform (B2B2C) serving financial businesses → Silver minimum regardless of tech stack

BUSINESS MODEL PATTERN: "platform" | "b2b2c" | "marketplace" | "embedded" | "direct" | "unknown"

TRACTION SIGNALS — look for evidence the company is established:
- Pricing page, customer count, testimonials, case studies, years operating, funding, active jobs

USE CASES (return exact strings): "onboarding" | "credit" | "fraud" | "payments" | "pfm" | "openfinance"

PRODUCTS (exact names): Core Verify, Core Verify Plus, Balance Insights

PRODUCT CONFIDENCE TIERS:
HIGH CONFIDENCE — use freely as primary fit indicators and scoring signals:
Core Verify, Core Verify Plus
LOWER CONFIDENCE — include as secondary/possible fit only, never sole reason for Gold:
Balance Insights
RULE: A Gold score requires at least one HIGH CONFIDENCE product with clear evidence. Lower confidence products can appear in recommendations but cannot be the primary justification for tier.

BANK CONNECT SIGNAL: Set bankConnectSignal=true if explicit bank linking/ACH/instant verification language found.

CONFIDENCE: "Low" when site unreachable OR content sparse. "High" only for clear signals from live active site.

${customIntel ? `ADDITIONAL CONTEXT FROM AE:\n${customIntel.slice(0,2000)}\n` : ""}${exampleAccts ? `\nCALIBRATION EXAMPLES:\n${exampleAccts.slice(0,1500)}\n` : ""}
Return ONLY this JSON (all fields required):
{
  "score": 1,
  "tier": "Gold",
  "businessModel": "2 sentences",
  "productFit": "2 sentences",
  "useCases": ["payments","onboarding"],
  "products": ["Core Verify","Balance Insights"],
  "keySignals": ["signal1","signal2"],
  "disqualifier": null,
  "confidence": "High",
  "isActive": true,
  "bankConnectSignal": false,
  "businessModelPattern": "platform",
  "estimatedDownstreamUsers": "120k SMB customers",
  "isEstablished": true,
  "tractionSignals": ["pricing page exists","testimonials present"],
  "distributionMultiplier": true,
  "signalBreakdown": {
    "paymentSignals": [],
    "onboardingSignals": [],
    "scaleSignals": [],
    "platformSignals": [],
    "slagSignals": [],
    "signalScore": 50,
    "topSignal": "one sentence summary of strongest evidence"
  }
}`,
        messages: [{ role: "user", content: `Score product fit:
Company: ${name}
Website: ${web || "none"}
Vertical: ${vert || "unknown"}
Subvertical: ${sub || "unknown"}
Pipeline stage: ${stage || "Prospecting"}
Website content (fetch method: ${fetchMethod}): ${siteContent || "not available"}
${signalSummary}
IMPORTANT: Look for platform/B2B2C distribution, real traction signals, and whether financial data connectivity is core to their product.
If site was unreachable, score on company name + vertical — never penalize for a fetch failure.

Return ONLY the JSON.` }],
      }),
    });
    const data = await response.json();
    const textBlock = (data.content || []).find(b => b.type === "text");
    if (!textBlock) return res.status(500).json({ error: "No text", raw: JSON.stringify(data) });
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: "No JSON", raw: textBlock.text });
    const parsed = JSON.parse(jsonMatch[0]);

    // Merge local signal detection into breakdown if Claude didn't return one
    if (!parsed.signalBreakdown && signalBreakdown) {
      parsed.signalBreakdown = signalBreakdown;
    } else if (parsed.signalBreakdown && signalBreakdown) {
      // Merge: prefer Claude's descriptions but fill gaps from local detection
      parsed.signalBreakdown.paymentSignals = parsed.signalBreakdown.paymentSignals?.length
        ? parsed.signalBreakdown.paymentSignals : signalBreakdown.paymentSignals;
      parsed.signalBreakdown.onboardingSignals = parsed.signalBreakdown.onboardingSignals?.length
        ? parsed.signalBreakdown.onboardingSignals : signalBreakdown.onboardingSignals;
      parsed.signalBreakdown.scaleSignals = parsed.signalBreakdown.scaleSignals?.length
        ? parsed.signalBreakdown.scaleSignals : signalBreakdown.scaleSignals;
      parsed.signalBreakdown.platformSignals = parsed.signalBreakdown.platformSignals?.length
        ? parsed.signalBreakdown.platformSignals : signalBreakdown.platformSignals;
      parsed.signalBreakdown.slagSignals = parsed.signalBreakdown.slagSignals?.length
        ? parsed.signalBreakdown.slagSignals : signalBreakdown.slagSignals;
      if (!parsed.signalBreakdown.signalScore) parsed.signalBreakdown.signalScore = signalBreakdown.signalScore;
      if (!parsed.signalBreakdown.topSignal) parsed.signalBreakdown.topSignal = signalBreakdown.topSignal;
    }

    // Hard override: if local signal detection found parked/dead/acquired signals, force inactive
    if (signalBreakdown?.slagSignals?.some(s =>
      /(parked|expired|suspended|shutdown|acquisition|absorbed)/.test(s)
    )) {
      parsed.isActive = false;
      parsed.score = 4;
      parsed.tier = "Slag";
      if (!parsed.disqualifier) {
        const sig = signalBreakdown.slagSignals.find(s => /(parked|expired|suspended|shutdown|acquisition|absorbed|coming.soon|under.construction)/.test(s)) || '';
        const code = /acquired|absorption|now part of/.test(sig) ? 'acquired' : /suspended/.test(sig) ? 'suspended' : /coming.soon|under.construction|launching.soon/.test(sig) ? 'coming_soon' : 'dead_site';
        parsed.disqualifier = `${code} — ${sig || 'site inactive or unreachable'}`;
      }
    }

    // Infer bankConnectSignal from keySignals if model missed it
    if (!parsed.bankConnectSignal && Array.isArray(parsed.keySignals)) {
      const sigText = parsed.keySignals.join(" ").toLowerCase();
      if (/bank.{0,15}(connect|link|verif)|connect.{0,10}bank|instant.{0,5}(bank|ach)|open.?banking|pay.{0,5}bank|link.{0,10}account/.test(sigText)) {
        parsed.bankConnectSignal = true;
      }
    }

    // Infer distributionMultiplier from businessModelPattern if model missed it
    if (!parsed.distributionMultiplier && ["platform","b2b2c","marketplace","embedded"].includes(parsed.businessModelPattern)) {
      parsed.distributionMultiplier = true;
    }

    // Enforce Gold for confirmed distribution multiplier plays
    if (parsed.distributionMultiplier && parsed.score > 1 && parsed.isActive !== false) {
      parsed.score = 1;
      parsed.tier = "Gold";
    }

    // Never mark unreachable site as disqualifier
    if (parsed.disqualifier && /unreachable|site.*fail|cannot.*access|failed to load/i.test(parsed.disqualifier)) {
      parsed.disqualifier = null;
      parsed.confidence = "Low";
    }

    if (!Array.isArray(parsed.tractionSignals)) parsed.tractionSignals = [];

    return res.status(200).json({ ...parsed, linkedin, fetchMethod });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
