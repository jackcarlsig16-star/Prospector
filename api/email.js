import { MODELS } from '../src/config/models.js';
import { getSupabase, getVoiceProfileForUser } from './businesses/shared.js';

export const config = { maxDuration: 30 };

const MODEL = MODELS.FAST;

// account-card-color-fix-and-guided-generate-v1 Part B — message_type meaningfully
// changes tone/structure, not just a logged label. Undefined/unknown messageType
// (every pre-existing caller — AccountCardPersonas.js, FrontierEmailPanel.js) gets
// no guidance block at all, so their output is byte-identical to before this change.
const MESSAGE_TYPE_GUIDANCE = {
  cold_outreach: `MESSAGE TYPE — Cold Outreach: this is a first-touch message, no prior contact of any kind. Keep it short, one clear CTA, no assumption of familiarity. Never reference "as discussed," a prior call, or any earlier exchange.`,
  follow_up: `MESSAGE TYPE — Follow-up: prior contact/context already exists between sender and recipient. Reference a prior touchpoint naturally (a call, an email, a signup, a prior conversation) even generically if no specifics are given in the context below, and write as a continuation of an existing relationship, not a first introduction. Do not use a "nice to meet you" or "reaching out to introduce myself" style opener.`,
  warm_intro: `MESSAGE TYPE — Warm Intro: this message is being sent via, or references, a warm introduction rather than cold. Open warmer and more personally than a cold email would. If an introduction source or connector is mentioned in the context below, reference it naturally early in the message.`,
};

const AVOID_ALWAYS = [
  "synergies", "solutions", "leverage", "excited to connect",
  "hope this finds you well", "reach out", "touch base",
  "circle back", "innovative", "best-in-class", "seamlessly",
];

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
        ...(process.env.JINA_API_KEY ? { "Authorization": `Bearer ${process.env.JINA_API_KEY}` } : {}),
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
    customIntel, senderName, voiceExamples,
    signals, note, web, website,
    format, accountKind, messageType, businessId, projectId, runningUserEmail,
    fitRationale, fitSignals, nicheAssessment, bioSnapshot,
  } = req.body;
  let { voiceProfile } = req.body;

  const isInfluencer = accountKind === 'influencer';
  const messageTypeGuidance = MESSAGE_TYPE_GUIDANCE[messageType] || "";
  const sender = senderName || "your rep";
  const isLinkedIn = format === "linkedin_note";
  const wordLimit = isLinkedIn ? 50 : 60;
  const formatLabel = isLinkedIn ? "LinkedIn message" : "email";
  const personaFirstName = personaName ? personaName.split(" ")[0] : null;
  const websiteUrl = web || website || null;
  const websiteContent = await scrapeWebsite(websiteUrl);

  const supabase = getSupabase();

  // outreach-intelligence-v1 Section 0a — bulk/background generation passes
  // runningUserEmail instead of a client-supplied voiceProfile object, so
  // the server pulls the running user's own voice fresh from voice_profiles
  // rather than trusting whatever the client happened to send. Interactive
  // single-account callers (EmailModal.js) keep passing voiceProfile
  // directly, unchanged - only used when voiceProfile itself is absent.
  if (!voiceProfile && runningUserEmail && supabase) {
    try { voiceProfile = await getVoiceProfileForUser(supabase, runningUserEmail); } catch { /* proceed voiceless */ }
  }

  // outreach-intelligence-v1 Section 3 — composition order: voice (above) ->
  // account intel/assay_criteria -> business outreach_rules -> project
  // guidance, each layer optional/graceful. businessId absent (Claim
  // Jumper's pool, Frontier stealth entries — neither has business context)
  // or the business hasn't generated criteria/rules yet both fall through to
  // these staying null; the prompt just omits that layer in that case.
  let assayCriteria = null;
  let outreachRules = null;
  if (businessId && !isInfluencer && supabase) {
    try {
      const { data } = await supabase.from('business_profiles').select('assay_criteria, outreach_rules').eq('business_id', businessId).maybeSingle();
      assayCriteria = data?.assay_criteria || null;
      outreachRules = data?.outreach_rules || null;
    } catch { /* fall through with no business-fit grounding */ }
  }

  // Project Outreach Guidance layers on top of, does not replace, the
  // business-level layers above - only fetched when a bulk/project-scoped
  // caller actually passes projectId (single-account EmailModal.js has no
  // project context today and never sends one).
  let projectGuidance = null;
  if (projectId && supabase) {
    try {
      const { data } = await supabase.from('projects').select('outreach_prompt, outreach_example').eq('id', projectId).maybeSingle();
      if (data && (data.outreach_prompt || data.outreach_example)) projectGuidance = data;
    } catch { /* fall through with no project-level guidance */ }
  }

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
    isInfluencer
      ? `You are ${sender} writing a first-touch outbound ${formatLabel} to a content creator, pitching a partnership/collaboration — not a product sale.`
      : `You are ${sender} writing first-touch outbound ${formatLabel}s.`,
    voiceRules,
    outputFormat,
    messageTypeGuidance,
    !isInfluencer && assayCriteria ? `THIS BUSINESS'S FIT CONTEXT — ground the pitch in this, not generic assumptions:
FIT SIGNALS: ${assayCriteria.fit_signals || "(not specified)"}
${assayCriteria.disqualifiers ? `Avoid language that contradicts: ${assayCriteria.disqualifiers}` : ""}
PRODUCT LANGUAGE: don't invent specific product names — describe what's offered in plain language grounded in the fit signals above.` : "",
    outreachRules ? `THIS BUSINESS'S OUTREACH RULES — apply these on top of the voice rules above:
Tone: ${outreachRules.tone || "(not specified)"}
Structure: ${outreachRules.structure || "(not specified)"}
Key points to surface: ${outreachRules.key_points || "(not specified)"}
Do: ${outreachRules.dos || "(not specified)"}
Don't: ${outreachRules.donts || "(not specified)"}
${outreachRules.example_snippets ? `Echo this kind of language where it fits naturally: ${outreachRules.example_snippets}` : ""}` : "",
    projectGuidance ? `PROJECT-SPECIFIC GUIDANCE — layers on top of everything above, for this campaign specifically:
${projectGuidance.outreach_prompt || ""}
${projectGuidance.outreach_example ? `Example of how this project's outreach should read:\n${projectGuidance.outreach_example}` : ""}` : "",
    voiceExamples ? `VOICE EXAMPLES — match this tone and length exactly:\n${voiceExamples.slice(0, 1500)}` : "",
  ].filter(Boolean).join("\n\n");

  const creatorContext = isInfluencer
    ? [
        bioSnapshot                        ? `Creator bio: ${bioSnapshot}` : null,
        nicheAssessment?.category          ? `Niche: ${nicheAssessment.category}` : null,
        nicheAssessment?.content_type      ? `Content type: ${nicheAssessment.content_type}` : null,
        nicheAssessment?.audience_read     ? `Audience: ${nicheAssessment.audience_read}` : null,
        fitRationale                       ? `Why this could be a fit: ${fitRationale}` : null,
        Array.isArray(fitSignals) && fitSignals.length
          ? `Fit signals: ${fitSignals.map(s => `${s.axis}: ${s.note}`).join("; ")}`
          : null,
      ].filter(Boolean).join("\n")
    : null;

  const userMessage = [
    isInfluencer
      ? [creatorContext, websiteContent ? `WEBSITE/PROFILE CONTENT (scraped from ${websiteUrl}):\n${websiteContent}` : null].filter(Boolean).join("\n\n") || `Creator: ${name}`
      : (websiteContent
          ? `WEBSITE CONTENT (scraped from ${websiteUrl}):\n${websiteContent}`
          : `Company: ${name}\nBusiness model: ${businessModel || "fintech"}\nproduct fit: ${productFit || "relevant fintech use cases"}`),
    personaName
      ? `Recipient: ${personaName}${personaTitle ? `, ${personaTitle}` : ""} at ${name}`
      : isInfluencer ? `Recipient: ${name}` : `Recipient: [First Name] at ${name}`,
    useCase           ? `Top use case: ${useCase}` : null,
    products?.length  ? `Relevant products: ${products.join(", ")}` : null,
    signals?.length   ? `Account signals: ${signals.join(", ")}` : null,
    note              ? `AE context: ${note}` : null,
    // outreach-intelligence-v1 Section 0b follow-up — customIntel is
    // getActiveIntel()'s raw output: global, not business-scoped, still
    // holding the original fintech product docs (Core Verify etc). Live-
    // tested against HumanKind/The Coconut Cult: even with correct
    // assayCriteria grounding in the system prompt, this raw product-doc
    // text in the user message overrode it and produced ACH/Core Verify
    // copy for a wellness-sponsorship business. Same root cause and same
    // fix as buildGeneralizedPrompt() in src/utils/assay.js - only include
    // it when there's no real business-fit context to replace it with
    // (Claim Jumper's pool, Frontier stealth entries, influencer accounts,
    // or a business that hasn't generated assay_criteria yet all keep
    // getting customIntel exactly as before).
    customIntel && !assayCriteria ? `Additional intel:\n${customIntel.slice(0, 800)}` : null,
    isInfluencer
      ? (isLinkedIn
          ? `Write a ${formatLabel} that opens with genuine curiosity about their content/audience — not a generic pitch. Use the creator context above to identify something specific.`
          : `Write a ${formatLabel} with a Subject line and body. The subject must reference something specific from the creator context above (not a generic "Intro + ${name}"). The opener should show genuine curiosity about their content — not a generic pitch.`)
      : (isLinkedIn
          ? `Write a ${formatLabel} that opens with genuine curiosity about a real operational challenge this company faces — not a generic pitch. Use the website content above to identify something specific about how they operate.`
          : `Write a ${formatLabel} with a Subject line and body. The subject must reference something specific from the website content or signals (not a generic "Intro + ${name}"). The opener should show genuine curiosity about a real operational challenge this company faces — not a generic pitch.`),
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
