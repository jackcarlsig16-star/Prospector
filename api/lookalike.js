export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { account, customIntel, exampleAccts } = req.body;
  if (!account?.name) return res.status(400).json({ error: "account.name required" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const profile = [
    `Company: ${account.name}`,
    account.web ? `Website: ${account.web}` : null,
    account.vert ? `Vertical: ${account.vert}` : null,
    account.bm ? `Business model: ${account.bm}` : null,
    account.pf ? `product fit: ${account.pf}` : null,
    account.ucs?.length ? `Use cases: ${account.ucs.join(", ")}` : null,
    account.prods?.length ? `Products: ${account.prods.join(", ")}` : null,
    account.sigs?.length ? `Key signals: ${account.sigs.join("; ")}` : null,
    account.tier ? `Tier: ${account.tier}` : null,
    account.state ? `HQ state: ${account.state}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `You are an AE assistant. Given a reference account that's a strong product fit, generate 10 similar companies that would likely also be a strong fit for us.

REFERENCE ACCOUNT:
${profile}

${customIntel ? `AE INTEL CONTEXT:\n${customIntel.slice(0, 1500)}\n` : ""}
${exampleAccts ? `CALIBRATION EXAMPLES:\n${exampleAccts.slice(0, 1000)}\n` : ""}

Return ONLY a JSON array of 10 objects. For each suggestion:
- Pick REAL companies that actually exist
- Match the same fintech niche, business model pattern, and use case
- Vary the stage (some early-stage, some growth, some established)
- Prioritize SMB-sized companies (not public giants)
- Do NOT suggest companies already in common knowledge as existing customers

Each object:
{
  "name": "Company Name",
  "web": "website.com",
  "vert": "vertical (e.g. Payments, Lending, PFM, Fraud)",
  "why": "One sentence: why they're similar to ${account.name} and what use case fits",
  "products": ["Core Verify", "Balance Insights"],
  "tier": "Gold|Silver|Tin",
  "hq": "City, ST or Remote"
}

Return ONLY the JSON array, no other text.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || "";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return res.status(500).json({ error: "No JSON array in response", raw: text });

    const suggestions = JSON.parse(match[0]);
    return res.status(200).json({ suggestions });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
