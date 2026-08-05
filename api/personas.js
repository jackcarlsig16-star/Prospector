export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { name, web, linkedin, vert } = req.body;

  let content = "";

  // Try LinkedIn company/people page
  if (linkedin) {
    const slug = linkedin.replace(/\/$/, "").split("/").pop();
    try {
      const r = await fetch(`https://r.jina.ai/https://www.linkedin.com/company/${slug}/people`, {
        headers: { "Accept": "text/plain" },
        signal: AbortSignal.timeout(8000),
      });
      const text = (await r.text()).slice(0, 4000);
      if (text.length > 300 && !text.includes("Sign in") && !text.includes("Join now")) {
        content = text;
      }
    } catch (e) {}
  }

  // Fallback: scrape company website team/about/leadership pages
  if (!content) {
    const base = web ? (web.startsWith("http") ? web : `https://${web}`) : null;
    if (base) {
      for (const path of ["/team", "/about", "/leadership", "/company", "/about-us", ""]) {
        try {
          const r = await fetch(`https://r.jina.ai/${base}${path}`, {
            headers: { "Accept": "text/plain" },
            signal: AbortSignal.timeout(7000),
          });
          const text = (await r.text()).slice(0, 4000);
          if (text.length > 400) { content = text; break; }
        } catch (e) {}
      }
    }
  }

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
        system: `You extract decision makers relevant to a fintech integration from company content. Target roles: CFO, CTO, VP Engineering, Head of Payments, VP Finance, Treasurer, Head of Product, VP Partnerships, Co-founder, CEO (if small company). For each person explain in 6 words why they matter to us (e.g. "Owns payment infrastructure decisions", "Controls fintech vendor budget"). Return ONLY a JSON array, no other text: [{"name":"Full Name","title":"Job Title","linkedinUrl":"url or null","relevance":"6-word reason"}]. Max 5 people. If no named individuals found in the content, return [].`,
        messages: [{
          role: "user",
          content: `Company: ${name}\nVertical: ${vert || "fintech"}\n\nContent scraped from their site:\n${content || "No content available — infer likely roles from company type."}\n\nReturn ONLY the JSON array.`
        }]
      }),
    });

    const data = await response.json();
    const textBlock = (data.content || []).find(b => b.type === "text");
    if (!textBlock) return res.status(500).json({ error: "No response" });
    const match = textBlock.text.match(/\[[\s\S]*\]/);
    if (!match) return res.status(200).json({ personas: [], source: "none" });
    const personas = JSON.parse(match[0]);
    return res.status(200).json({ personas, source: content ? "scraped" : "inferred" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
