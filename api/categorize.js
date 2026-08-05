export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { text, workflow } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: "text required" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  const prompt = `You are a product feedback categorizer for Prospector, a sales intelligence tool used by AEs and BDRs.

Categorize this idea/feedback submission and return ONLY a JSON object.

SUBMISSION:
"${text.slice(0, 1000)}"
${workflow ? `WORKFLOW CONTEXT: "${workflow}"` : ""}

CATEGORIES (pick one):
- "Feature Request": New capability the user wants added
- "Workflow Improvement": Existing feature that could work better or faster
- "Integration": Connect with external tool (Salesforce, Slack, etc.)
- "Analytics": Better data, reporting, or insights
- "Automation": Something that should happen automatically
- "Bug Report": Something is broken or behaving incorrectly

PRIORITY (pick one):
- "High": Blocking work, frequently needed, or high-impact
- "Medium": Would meaningfully improve productivity
- "Low": Nice to have, edge case, or minor polish

Return ONLY this JSON:
{
  "category": "Feature Request",
  "priority": "Medium",
  "summary": "One sentence describing the idea in product-manager language, starting with a verb."
}`;

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
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    const text_ = data.content?.[0]?.text || "";
    const match = text_.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: "No JSON in response", raw: text_ });

    const parsed = JSON.parse(match[0]);
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
