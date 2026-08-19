import { MODELS } from '../src/config/models.js';
import { getSupabase, getVoiceProfileForUser } from './businesses/shared.js';
import { stripCitationMarkup } from '../src/utils/textSanitize.js';

export const config = { maxDuration: 30 };

const MODEL = MODELS.FAST;

// account-card-color-fix-and-guided-generate-v1 Part B — message_type meaningfully
// changes tone/structure, not just a logged label. Undefined/unknown messageType
// (every pre-existing caller — AccountCardPersonas.js, FrontierEmailPanel.js) gets
// no guidance block at all, so their output is byte-identical to before this change.
// outreach-intelligence-doctrine-v1 Stage 2 - deliberately NOT migrated into
// outreach_doctrine, unlike AVOID_ALWAYS and outputFormat's CTA rule below.
// This map is conditional on messageType (cold_outreach says never reference
// a prior call; follow_up says the opposite: reference one naturally) -
// outreach_doctrine has no messageType-scoping column, and injecting all 4
// entries unconditionally into every generation (the way doctrine rows work)
// would put directly contradictory instructions in the same prompt. This is
// genuinely parameterized behavior, not a flat platform rule, so it stays
// here. The one real universal principle underneath cold_outreach's and
// reply's rules - never fabricate a prior interaction - was extracted as a
// real doctrine row instead (see the 'grounding' category rule, seeded
// Stage 2), since that generalizes cleanly across every message type.
const MESSAGE_TYPE_GUIDANCE = {
  cold_outreach: `MESSAGE TYPE — Cold Outreach: this is a first-touch message, no prior contact of any kind. Keep it short, one clear CTA, no assumption of familiarity. Never reference "as discussed," a prior call, or any earlier exchange.`,
  follow_up: `MESSAGE TYPE — Follow-up: prior contact/context already exists between sender and recipient. Reference a prior touchpoint naturally (a call, an email, a signup, a prior conversation) even generically if no specifics are given in the context below, and write as a continuation of an existing relationship, not a first introduction. Do not use a "nice to meet you" or "reaching out to introduce myself" style opener.`,
  warm_intro: `MESSAGE TYPE — Warm Intro: this message is being sent via, or references, a warm introduction rather than cold. Open warmer and more personally than a cold email would. If an introduction source or connector is mentioned in the context below, reference it naturally early in the message.`,
  // generation-engine-consolidation-v1 Stage 1 - real new type, not a force-fit
  // of AccountCardComms.js's old "reply" onto follow_up. Replying to a specific
  // inbound message is a different task than writing a proactive follow-up:
  // it must respond to what the other side actually said, never invent a
  // recap of things they didn't write. The inbound message itself belongs in
  // the Directive field below (paste it in) - this guidance is just how to
  // treat it once it's there.
  reply: `MESSAGE TYPE — Reply: this is a direct reply to a specific inbound message from the recipient (its content, if provided, is in the Directive section below). Read what they actually said and respond to that — never invent a meeting recap, summary, or next step that isn't grounded in their actual message. If they're deferring to a future timeline (funding, bandwidth, a specific quarter/month, "circle back," "reconnect later"), keep the reply brief and gracious, confirm their stated timeline exactly, and do not propose a call or add a near-term CTA. Otherwise, answer their question or address their concern directly, under 200 words.`,
};

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

// project-guidance-and-creation-flow-v1 — this is the ONE generation path.
// Project-level generate (BulkOutreachModal.js), account-level generate
// (EmailModal.js), and bulk/list generate all call this same handler with
// different selected inputs (accountId(s) + optional projectId) - never
// three separate implementations. Project-level fields (objective/
// target_type/ask_type/project_hook/exclusions/outreach_example, read below
// via projectId) define HOW to communicate; account-level fields (name/
// businessModel/signals/etc, passed per-call) define WHO. This function's
// job is only to combine the two. If a future entry point needs generation,
// it calls this handler with the right inputs - it does not get its own
// prompt-building logic. (This landmine was real, not hypothetical:
// generation-engine-consolidation-v1 found and retired a second, fully
// independent generator that had grown on AccountCardComms.js's Comms
// panel - own prompts, own vocabulary, zero connection to any of this.)
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    name, businessModel, productFit, useCase, products,
    personaName, personaTitle,
    customIntel, senderName, voiceExamples,
    signals, web, website,
    format, accountKind, messageType, businessId, projectId, runningUserEmail,
    fitRationale, fitSignals, nicheAssessment, bioSnapshot,
    // generation-engine-consolidation-v1 - directive replaces the old `note`
    // field name (same free-text per-generation steering input, formalized
    // as a named provider below); accountIntel is new (Stage 4).
    directive, accountIntel,
  } = req.body;
  let { voiceProfile } = req.body;
  // assay-citation-leak-and-raw-edit-dual-write-v1 Fix 1 (belt-and-suspenders,
  // read-side) - businessModel/productFit reach this composition point
  // regardless of which client sent them; the write-side fix in
  // clientAssay() covers new/re-assayed data, this covers anything already
  // stored before that fix existed or written by a path this session hasn't
  // audited.
  const businessModelClean = stripCitationMarkup(businessModel);
  const productFitClean = stripCitationMarkup(productFit);

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

  // project-guidance-and-creation-flow-v1 — structured project guidance
  // layers on top of, does not replace, the business-level layers above.
  // Replaces the old free-text outreach_prompt field: objective/target_type/
  // ask_type/project_hook/exclusions map directly onto prompt sections
  // instead of one undifferentiated blob. outreach_prompt itself is left
  // live in the schema but intentionally unread here - confirmed 0 rows
  // populated before this change, nothing to migrate.
  // project-scoped-outreach-examples-v1 — outreach_example (single text)
  // replaced by outreach_examples_distilled (cached summary of the
  // project's own up-to-20-item example list, see the dedicated
  // projectExamples provider below). outreach_example itself is left live
  // in the schema but intentionally unread here, same precedent as
  // outreach_prompt above - its one real populated row was migrated
  // forward into outreach_examples at migration time, not lost.
  let projectGuidance = null;
  if (projectId && supabase) {
    try {
      const { data } = await supabase.from('projects').select('objective, target_type, ask_type, project_hook, exclusions, outreach_examples_distilled').eq('id', projectId).maybeSingle();
      if (data && Object.values(data).some(Boolean)) projectGuidance = data;
    } catch { /* fall through with no project-level guidance */ }
  }

  // outreach-intelligence-doctrine-v1 Stage 3 — platform-wide doctrine,
  // real per-call fetch (not a longer-lived process cache) despite being
  // the same for every business. Deliberate: this table exists specifically
  // so Jack can "continually train" it from the new admin tab and see it
  // take effect - a cache with any real TTL works directly against that
  // ("I just added a rule and it's not showing up"). The table is tiny
  // (a handful of rows), so the read itself isn't a real cost problem to
  // trade that freshness away for. Revisit only if this table grows large
  // or the read is ever a measured bottleneck.
  let doctrineHard = [];
  let doctrineDefault = [];
  if (supabase) {
    try {
      const { data } = await supabase.from('outreach_doctrine').select('category, rule_text, is_hard_constraint').eq('active', true);
      (data || []).forEach(r => (r.is_hard_constraint ? doctrineHard : doctrineDefault).push(r.rule_text));
    } catch { /* fall through with no platform doctrine */ }
  }

  const greeting = voiceProfile?.greeting || `Hey ${personaFirstName || "[First Name]"},`;
  const closing  = voiceProfile?.closing  || `- ${sender}`;
  // outreach-intelligence-doctrine-v1 Stage 3 - AVOID_ALWAYS (the old
  // hardcoded platform banned-phrase list) is migrated into outreach_doctrine
  // (the 'tone' hard-constraint row seeded in Stage 2) and now arrives via
  // the doctrineHard provider below, not duplicated here. avoidPhrases is a
  // genuinely different, still-real concept - a specific AE's own personally
  // learned avoid-list from "Teach from my edits" (EmailModal.js) - kept.
  const avoidList = (voiceProfile?.avoidPhrases || []).join(", ");

  const voiceRules = voiceProfile
    ? `VOICE RULES — match ${sender}'s writing style precisely:
- Open with "${greeting}"
- Tone: ${voiceProfile.tone || "direct"} · Sentence length: ${voiceProfile.avgSentenceLength || "short"}
- Key traits: ${(voiceProfile.keyTraits || []).join(", ")}
- Close with "${closing}"${avoidList ? `\n- NEVER use: ${avoidList}` : ""}
- Sound exactly like ${sender}, not marketing copy`
    : `VOICE RULES:
- Short punchy sentences. Max 2 sentences per paragraph.${avoidList ? `\n- Never say: ${avoidList}` : ""}
- Sound like a human, not a press release`;

  const outputFormat = isLinkedIn
    ? `OUTPUT FORMAT:
- Message body only — 1-2 short paragraphs. No greeting header line.
- Hard limit: ${wordLimit} words total (LinkedIn caps connection notes at 300 chars)
- No fluff, flattery, or filler`
    : `OUTPUT FORMAT:
- Start with a single "Subject: <line>" — specific to ${name}, references something concrete from the website or signals
- Blank line, then the email body
- Body: opener, 2-3 short paragraphs, sign-off
- Hard limit: ${wordLimit} words total in the body (excluding subject)
- No fluff, flattery, or filler — every sentence earns its place`;

  // generation-engine-consolidation-v1 — composition assembled as a named,
  // ordered list of context providers instead of positional ad hoc blocks,
  // so a future 6th source (My Profile - see the reserved, currently-empty
  // entry below) is a new entry here, not a rewrite of the other five. Each
  // provider is independent: adding, reordering, or removing one doesn't
  // touch the others' logic. This is the one composition step in the app -
  // every real generation call site (EmailModal.js, BulkOutreachModal.js,
  // DebriefWorkspace.js, FrontierEmailPanel.js, and AccountCardComms.js as
  // of this SPEC) feeds this same list.
  const CONTEXT_PROVIDERS = [
    // outreach-intelligence-doctrine-v1 Stage 3 - real structural separation,
    // not another flattened prose block: two distinctly-labeled sections
    // instead of merging into voice/companyIntel/etc like everything else.
    // This IS the point of this stage - the audit found zero hard-vs-default
    // distinction anywhere in the prompt before this. Placed first: hard
    // constraints are highest-authority regardless of position (the label
    // itself asserts that), and doctrineDefault is the most generic/
    // overridable layer, so everything more specific below (voice, company,
    // account, project, directive) naturally reads as refining it, not the
    // reverse.
    {
      name: 'doctrineHard',
      text: doctrineHard.length ? `NON-NEGOTIABLE (must follow, no exceptions):\n${doctrineHard.map(r => `- ${r}`).join('\n')}` : null,
    },
    {
      name: 'doctrineDefault',
      text: doctrineDefault.length ? `PLATFORM DEFAULTS (prefer these; business-specific guidance below may refine or override):\n${doctrineDefault.map(r => `- ${r}`).join('\n')}` : null,
    },
    { name: 'voice', text: voiceRules },
    {
      name: 'companyIntel',
      text: !isInfluencer && assayCriteria ? `THIS BUSINESS'S FIT CONTEXT — ground the pitch in this, not generic assumptions:
FIT SIGNALS: ${assayCriteria.fit_signals || "(not specified)"}
${assayCriteria.disqualifiers ? `Avoid language that contradicts: ${assayCriteria.disqualifiers}` : ""}
PRODUCT LANGUAGE: don't invent specific product names — describe what's offered in plain language grounded in the fit signals above.` : null,
    },
    {
      name: 'companyOutreachRules',
      text: outreachRules ? `THIS BUSINESS'S OUTREACH RULES — apply these on top of the voice rules above:
Tone: ${outreachRules.tone || "(not specified)"}
Structure: ${outreachRules.structure || "(not specified)"}
Key points to surface: ${outreachRules.key_points || "(not specified)"}
Do: ${outreachRules.dos || "(not specified)"}
Don't: ${outreachRules.donts || "(not specified)"}
${outreachRules.example_snippets ? `Echo this kind of language where it fits naturally: ${outreachRules.example_snippets}` : ""}` : null,
    },
    // Stage 4 — the account's own stored context (handoffNotes, recent call
    // summary, MEDPICC), built client-side (buildAccountIntel, utils/
    // accountIntel.js) and sent as one field. Not gated on businessId, unlike
    // customIntel below — this is the account's own data, not the AE's
    // global product docs, so the cross-business-leak guard that gates
    // customIntel doesn't apply here.
    {
      name: 'accountIntel',
      text: accountIntel ? `ACCOUNT CONTEXT — real, stored context specific to this account:\n${accountIntel.slice(0, 1500)}` : null,
    },
    {
      name: 'project',
      text: projectGuidance ? `PROJECT-SPECIFIC GUIDANCE — layers on top of everything above, for this campaign specifically:
${projectGuidance.objective ? `Objective: ${projectGuidance.objective}` : ""}
${projectGuidance.target_type ? `Target type: ${projectGuidance.target_type}` : ""}
${projectGuidance.ask_type ? `Ask/offer/CTA: ${projectGuidance.ask_type}` : ""}
${projectGuidance.project_hook ? `Hook to work in where it fits naturally: ${projectGuidance.project_hook}` : ""}
${projectGuidance.exclusions ? `Avoid: ${projectGuidance.exclusions}` : ""}`.trim() : null,
    },
    // project-scoped-outreach-examples-v1 — distilled from this project's
    // own outreach_examples array (up to 20 real past sent/approved
    // messages for this specific campaign), distinct from voiceExamples
    // below (per-AE, not business/project-scoped, no selection logic).
    // Placed immediately after `project` so project-level context stays
    // grouped together in the final prompt rather than scattered.
    {
      name: 'projectExamples',
      text: projectGuidance?.outreach_examples_distilled ? `THIS PROJECT'S OWN PAST EXAMPLES — real messages sent for this specific campaign, match this pattern:\n${projectGuidance.outreach_examples_distilled}` : null,
    },
    // Stage 3 — free-text, per-generation steering (was `note`/"AE context",
    // renamed and formalized as its own provider). Optional, additive - an
    // absent directive falls back to Project's structured fields alone,
    // exactly as before this SPEC. Placed after Project so it reads as the
    // most specific, most recent instruction, explicitly allowed to override
    // where the two conflict (e.g. "keep this one under 80 words").
    {
      name: 'directive',
      text: directive ? `GENERATION DIRECTIVE — an explicit instruction for this specific message. Treat this as taking priority over the general guidance above where they conflict:\n${directive.slice(0, 800)}` : null,
    },
    // Reserved for "My Profile" (per-person role/objective per business) -
    // not built yet, no schema exists. Wiring it in later means filling in
    // this provider's text, not restructuring the other five.
    { name: 'userProfile', text: null },
    { name: 'voiceExamples', text: voiceExamples ? `VOICE EXAMPLES — match this tone and length exactly:\n${voiceExamples.slice(0, 1500)}` : null },
  ];

  const systemPrompt = [
    isInfluencer
      ? `You are ${sender} writing a first-touch outbound ${formatLabel} to a content creator, pitching a partnership/collaboration — not a product sale.`
      : `You are ${sender} writing first-touch outbound ${formatLabel}s.`,
    outputFormat,
    messageTypeGuidance,
    ...CONTEXT_PROVIDERS.map(p => p.text),
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
          // outreach-intelligence-v1 follow-up — same bug class as the
          // customIntel gate: an unanalyzed account (empty businessModel/
          // productFit) with an unreachable site used to fall back to
          // hardcoded fintech defaults here even when the system prompt
          // above had a real, correct, non-fintech assayCriteria grounding
          // block - a direct contradiction inside the same prompt. Gate on
          // businessId the same way: a real business context means no
          // fintech assumption belongs here even if this account's own
          // fields are still empty. Only genuinely context-free callers
          // (no businessId at all) keep the fintech-flavored default.
          : (businessId
              ? `Company: ${name}${businessModelClean ? `\nBusiness model: ${businessModelClean}` : ""}${productFitClean ? `\nproduct fit: ${productFitClean}` : ""}`
              : `Company: ${name}\nBusiness model: ${businessModelClean || "fintech"}\nproduct fit: ${productFitClean || "relevant fintech use cases"}`)),
    personaName
      ? `Recipient: ${personaName}${personaTitle ? `, ${personaTitle}` : ""} at ${name}`
      : isInfluencer ? `Recipient: ${name}` : `Recipient: [First Name] at ${name}`,
    useCase           ? `Top use case: ${useCase}` : null,
    products?.length  ? `Relevant products: ${products.join(", ")}` : null,
    signals?.length   ? `Account signals: ${signals.join(", ")}` : null,
    // outreach-intelligence-v1 Section 0b follow-up — customIntel is
    // getActiveIntel()'s raw output: global, not business-scoped, still
    // holding the original fintech product docs (Core Verify etc). Gated on
    // !assayCriteria at first, but assayCriteria is never fetched at all for
    // influencer accounts (isInfluencer skips that query entirely) - so a
    // real businessId on an influencer account still let customIntel through
    // unconditionally. Live-tested against HumanKind's real influencer
    // accounts (bulk generation across a real project list): got "Core
    // Verify"/"ACH flow" pitches sent to Chicago wellness creators. Gate on
    // !businessId instead - any real businessId means a real, non-fintech
    // business context exists, regardless of whether assay_criteria has been
    // generated yet or the account is an influencer. Only Claim Jumper's
    // pool and Frontier stealth entries (genuinely no businessId at all)
    // keep getting customIntel exactly as before.
    customIntel && !businessId ? `Additional intel:\n${customIntel.slice(0, 800)}` : null,
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
