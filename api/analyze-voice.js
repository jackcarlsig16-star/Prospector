export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { emailText } = req.body;
  if (!emailText?.trim()) return res.status(400).json({ error: "emailText required" });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        messages: [{ role: "user", content:
`Analyze these sent emails and extract a precise voice profile for the sender. Look for consistent patterns across multiple emails.

${emailText.slice(0, 6000)}

Return ONLY a valid JSON object — no explanation, no markdown, just the JSON:
{
  "greeting": "the exact greeting pattern (e.g. 'Hey [First Name],' or 'Hi [First Name],')",
  "closing": "exact closing sign-off",
  "tone": "one word: casual | direct | warm | formal | conversational",
  "avgSentenceLength": "short | medium | long",
  "avgEmailLength": "brief (under 80 words) | moderate (80-150 words) | detailed (over 150 words)",
  "commonPhrases": ["up to 5 phrases the sender actually uses"],
  "avoidPhrases": ["phrases/words the sender never uses"],
  "signatureStyle": "description of how emails end",
  "formalityLevel": 2,
  "punctuationStyle": "brief description",
  "structureStyle": "brief description of paragraph patterns",
  "keyTraits": ["3-4 defining voice traits"],
  "sampleOpener": "copy an actual strong opener line from one email",
  "analyzedCount": "estimated number of emails in the paste"
}` }],
      }),
    });

    const data = await claudeRes.json();
    const text = data.content?.[0]?.text || "{}";
    const match = text.match(/\{[\s\S]+\}/);
    if (!match) throw new Error("Could not parse voice profile from response");

    const profile = JSON.parse(match[0]);
    profile.learnedAt = new Date().toISOString();
    profile.source = "paste";
    profile.teachCount = 0;

    return res.status(200).json({ profile });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
