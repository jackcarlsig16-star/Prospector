export const config = { maxDuration: 30 };

// Known LinkedIn placeholder slugs — these are shared hubs, NOT real companies
const PLACEHOLDER_SLUGS = ["stealth-startup", "stealth-mode", "stealth-company", "stealthstartup", "stealth"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { linkedinUrl, senderName, manualContext } = req.body;

  const urlLower = (linkedinUrl || "").toLowerCase();
  const isPlaceholderUrl = PLACEHOLDER_SLUGS.some(slug =>
    urlLower.includes(`/company/${slug}`) || urlLower.includes(`/company/${slug}/`)
  );

  const isProfileUrl = urlLower.includes("/in/");

  // If manual context provided, use it directly and skip LinkedIn scrape (it's auth-walled for /in/ profiles)
  let content = manualContext ? manualContext.slice(0, 4000) : "";
  let website = null;

  if (!manualContext) {
    // Attempt scrape — works for company pages, usually fails for /in/ profiles
    try {
      const r = await fetch(`https://r.jina.ai/${linkedinUrl}`, {
        headers: { "Accept": "text/plain" },
        signal: AbortSignal.timeout(9000),
      });
      const raw = await r.text();
      if (raw.length > 200 && !raw.includes("authwall") && !raw.includes("Join now to see") && !raw.includes("Sign in")) {
        content = raw.slice(0, 5000);
      }
    } catch (e) {}
  }

  // Extract website from content (company URLs only, not placeholder hubs)
  if (content && !isPlaceholderUrl) {
    const webMatch = content.match(/https?:\/\/(?!(?:www\.)?linkedin)[a-zA-Z0-9\-]+\.[a-z]{2,6}[^\s,)"']*/i);
    if (webMatch) website = webMatch[0].replace(/[.,]+$/, "");
  }

  // Scrape real website for extra signals
  let extraContent = "";
  if (website) {
    try {
      const r = await fetch(`https://r.jina.ai/${website}`, {
        headers: { "Accept": "text/plain" },
        signal: AbortSignal.timeout(7000),
      });
      extraContent = (await r.text()).slice(0, 2000);
    } catch (e) {}
  }

  const allContent = [content, extraContent].filter(Boolean).join("\n\n---\n\n");
  const scraped = !!content;

  const system = `You are a BD researcher identifying early-stage fintech founders worth seeding a relationship with.

TARGET PROFILE — who this is for:
Anyone early enough that a full sales pitch would feel premature or off-putting. This includes:
- True stealth (no public company yet)
- Announced but pre-product / pre-revenue
- Seed or pre-seed stage with a small team
- Recently launched and clearly still figuring out the stack
The goal is NOT to pitch. It's to get on their radar before they choose vendors.

CRITICAL RULE — Placeholder detection:
"Stealth Startup", "Stealth Mode", "Stealth Company" are SHARED PLACEHOLDER company names on LinkedIn used by thousands of unrelated founders. They are NOT real companies. If the content shows one of these placeholder names as the company, set isPlaceholder=true and companyName=null. The real company may be discoverable from the founder's posts, bio links, or hiring content — extract it if found.

Your job is FOUNDER-FIRST:
1. Identify the individual founder (name, title, background)
2. Extract their REAL company if discoverable (not a placeholder name)
3. Find fintech relevance signals (ACH, payments, banking, KYC, fraud, lending, data, etc.)
4. Extract their pedigree — former employers are key signals (ex-Stripe, ex-Square, ex-Brex, ex-Chime, ex-Coinbase, ex-Goldman, ex-a16z, etc.)

EMAIL RULES — relationship seed, NOT a pitch. Always generate an email, even with minimal info:
- Open with "Hi [First Name]," on its own line — use actual name if found, otherwise "[First Name]"
- ONE sentence: if you have specific signals, reference them (their background, what they're building). If you have nothing specific, use something warm and general like "Glad you're keeping things under the radar — looking forward to seeing what comes out of it." Never leave this blank.
- ONE sentence: "I'm your contact here, so I'm mostly just following along with interest for now."
- ONE sentence: "But if you ever need a direct line for the [most likely fintech piece given their background or vertical — bank connectivity, payments, data layer, etc.] down the road, I'm your guy."
- Close with "Best,\\n${senderName || "AE"}"
- 4-5 sentences total. Warm, human, brief. No ask for a meeting. No product pitch. No buzzwords.
- Always return a non-empty email string.

Return ONLY this JSON (no other text):
{
  "isPlaceholder": false,
  "linkedinCompany": "what's literally listed as company on LinkedIn",
  "companyName": "real company name or null if still unknown/placeholder",
  "founderName": "",
  "founderTitle": "",
  "founderBackground": ["ex-Stripe", "ex-Square"],
  "whatTheyBuild": "one sentence describing the product/problem they're solving, or null",
  "stage": "stealth|pre-seed|seed|early|series-a|unknown",
  "fintechRelevance": "high|medium|low|none",
  "signals": ["signal1", "signal2"],
  "email": "full email body or empty string"
}`;

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
        max_tokens: 700,
        system,
        messages: [{
          role: "user",
          content: `LinkedIn URL: ${linkedinUrl}
Is known placeholder URL: ${isPlaceholderUrl}
Is individual profile URL: ${isProfileUrl}
Context source: ${manualContext ? "manually provided by user" : "web scrape"}

Content:
${allContent || "No content available — LinkedIn blocked access. Infer what you can from the URL alone."}

Return ONLY the JSON.`
        }]
      }),
    });

    const data = await response.json();
    const textBlock = (data.content || []).find(b => b.type === "text");
    if (!textBlock) return res.status(500).json({ error: "No response" });
    const match = textBlock.text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: "No JSON", raw: textBlock.text });
    const parsed = JSON.parse(match[0]);
    return res.status(200).json({ ...parsed, website, scraped, isPlaceholderUrl, manualContextUsed: !!manualContext });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
