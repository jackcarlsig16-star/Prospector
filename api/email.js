export const config = { maxDuration: 30 };

const MODEL = process.env.ANTHROPIC_MODEL_FAST || "claude-haiku-4-5-20251001";

const AVOID_ALWAYS = [
  "synergies", "solutions", "leverage", "excited to connect",
  "hope this finds you well", "reach out", "touch base",
  "circle back", "innovative", "best-in-class", "seamlessly",
  "Core Verify", "Core Verify Plus", "Balance Insights",
];

// Placeholder — replace with your own customer list for social-proof name-drops
const SOCIAL_PROOF = {
  pfm:      ["Northstar Finance", "Ledgerly", "Brightpath"],
  payments: ["Payflow", "Cardless", "Instapay"],
  lending:  ["Lendwell", "Fairstone Loans", "Bridgefund"],
  ewa:      ["Wagelink", "EarlyPay"],
  default:  ["Northstar Finance", "Lendwell", "Payflow"],
};

function getSocialProof(businessModel, useCase) {
  const bm = (businessModel || "").toLowerCase();
  const uc = (useCase || "").toLowerCase();
  if (bm.includes("lending") || uc.includes("lending")) return SOCIAL_PROOF.lending;
  if (bm.includes("ewa") || uc.includes("earned wage") || uc.includes("ewa")) return SOCIAL_PROOF.ewa;
  if (bm.includes("payment") || uc.includes("payment")) return SOCIAL_PROOF.payments;
  if (bm.includes("pfm") || uc.includes("personal finance") || uc.includes("pfm")) return SOCIAL_PROOF.pfm;
  return SOCIAL_PROOF.default;
}

function jinaTimeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function scrapeWebsite(website) {
  if (!website) return null;
  try {
    const url = website.startsWith("http") ? website : `https://${website}`;
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        "Accept": "text/plain",
        "User-Agent": "Mozilla/5.0 (compatible; Prospector/1.0)",
      },
      signal: jinaTimeoutSignal(8000),
    });
    if (!res.ok) return null;
    const raw = await res.text();
    if (!raw || raw.length < 50) return null;
    if (raw.toLowerCase().includes("jina.ai error")) return null;
    return raw.slice(0, 1200).trim();
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    name, businessModel, productFit, useCase, products,
    personaName, personaTitle,
    customIntel, senderName, voiceExamples, voiceProfile,
    signals, note, web, website,
    format,
  } = req.body;

  const sender = senderName || "your rep";
  const isLinkedIn = format === "linkedin_note";
  const wordLimit = isLinkedIn ? 50 : 60;
  const formatLabel = isLinkedIn ? "LinkedIn message" : "email";
  const personaFirstName = personaName ? personaName.split(" ")[0] : null;
  const proof = getSocialProof(businessModel, useCase);
  const websiteUrl = web || website || null;
  const websiteContent = await scrapeWebsite(websiteUrl);

  const greeting = voiceProfile?.greeting || `Hey ${personaFirstName || "[First Name]"},`;
  const closing  = voiceProfile?.closing  || `- ${sender}`;
  const avoidList = [...AVOID_ALWAYS, ...((voiceProfile?.avoidPhrases) || [])].join(", ");

  const voiceRules = voiceProfile
    ? `VOICE RULES — match ${sender}'s writing style precisely:
- Open with "${greeting}"
- Tone: ${voiceProfile.tone || "direct"} · Sentence length: ${voiceProfile.avgSentenceLength || "short"}
- Key traits: ${(voiceProfile.keyTraits || []).join(", ")}
- Close with "${closing}"
- NEVER use: ${avoidList}
- Sound exactly like ${sender}, not marketing copy`
    : `VOICE RULES:
- Short punchy sentences. Max 2 sentences per paragraph.
- Never say: ${avoidList}
- Sound like a human, not a press release`;

  const outputFormat = isLinkedIn
    ? `OUTPUT FORMAT:
- Message body only — 1-2 short paragraphs. No greeting header line.
- Hard limit: ${wordLimit} words total (LinkedIn caps connection notes at 300 chars)
- Soft CTA only — suggest a quick chat, don't demand it
- No fluff, flattery, or filler`
    : `OUTPUT FORMAT:
- Start with a single "Subject: <line>" — specific to ${name}, references something concrete from the website or signals
- Blank line, then the email body
- Body: opener, 2-3 short paragraphs, sign-off
- Hard limit: ${wordLimit} words total in the body (excluding subject)
- Soft CTA only — suggest a 15-min call, don't demand it
- No fluff, flattery, or filler — every sentence earns its place`;

  const systemPrompt = [
    `You are ${sender} writing first-touch outbound ${formatLabel}s.`,
    voiceRules,
    outputFormat,
    `PRODUCT LANGUAGE: Never mention our products by name (Core Verify, Core Verify Plus, Balance Insights, etc.). Describe what the solution does in plain language (e.g. "instant account verification" not "Core Verify", "bank account balance checks" not "Balance Insights").`,
    `SOCIAL PROOF: You may name-drop 1-2 of these real customers in the same space: ${proof.slice(0, 3).join(", ")}. Only use if it fits naturally. Never force it.`,
    voiceExamples ? `VOICE EXAMPLES — match this tone and length exactly:\n${voiceExamples.slice(0, 1500)}` : "",
  ].filter(Boolean).join("\n\n");

  const userMessage = [
    websiteContent
      ? `WEBSITE CONTENT (scraped from ${websiteUrl}):\n${websiteContent}`
      : `Company: ${name}\nBusiness model: ${businessModel || "fintech"}\nproduct fit: ${productFit || "relevant fintech use cases"}`,
    personaName
      ? `Recipient: ${personaName}${personaTitle ? `, ${personaTitle}` : ""} at ${name}`
      : `Recipient: [First Name] at ${name}`,
    useCase           ? `Top use case: ${useCase}` : null,
    products?.length  ? `Relevant products: ${products.join(", ")}` : null,
    signals?.length   ? `Account signals: ${signals.join(", ")}` : null,
    note              ? `AE context: ${note}` : null,
    customIntel       ? `Additional intel:\n${customIntel.slice(0, 800)}` : null,
    isLinkedIn
      ? `Write a ${formatLabel} that opens with genuine curiosity about a real operational challenge this company faces — not a generic pitch. Use the website content above to identify something specific about how they operate.`
      : `Write a ${formatLabel} with a Subject line and body. The subject must reference something specific from the website content or signals (not a generic "Intro + ${name}"). The opener should show genuine curiosity about a real operational challenge this company faces — not a generic pitch.`,
  ].filter(Boolean).join("\n\n");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    const data = await response.json();
    const textBlock = (data.content || []).find(b => b.type === "text");
    if (!textBlock) return res.status(500).json({ error: "No text", raw: JSON.stringify(data) });
    const cleaned = textBlock.text.replace(/\*\*/g, "").replace(/\*/g, "").replace(/--/g, "-").trim();
    return res.status(200).json({ email: cleaned });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
