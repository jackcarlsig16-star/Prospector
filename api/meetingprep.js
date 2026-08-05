export const config = { maxDuration: 30 };

// Set to your org's Glean instance base URL
const GLEAN_BASE = process.env.GLEAN_BASE_URL;

async function gleanSearch(query, token) {
  // Try MCP first, then REST (same logic as glean.js)
  const res = await fetch(`${GLEAN_BASE}/mcp/all-data`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "search", arguments: { query, pageSize: 6 } },
      id: 1,
    }),
    signal: AbortSignal.timeout(10000),
  });

  const ct = res.headers.get("content-type") || "";
  let results = [];

  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (line.startsWith("data:")) {
        try { const p = JSON.parse(line.slice(5).trim()); if (p?.result?.content) { results = extractResults(p.result.content); break; } } catch {}
      }
    }
  } else if (ct.includes("application/json")) {
    const data = await res.json();
    if (data?.result?.content) results = extractResults(data.result.content);
  }

  // Fallback: REST API
  if (!results.length) {
    const rr = await fetch(`${GLEAN_BASE}/rest/api/v1/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ query, pageSize: 6 }),
      signal: AbortSignal.timeout(10000),
    });
    if (rr.ok) {
      const rd = await rr.json();
      results = (rd.results || []).slice(0, 6).map(r => ({
        title: r.title || r.document?.title || "Untitled",
        source: r.datasource || r.document?.datasource || "Glean",
        snippet: r.snippets?.[0]?.snippet?.value || r.summary || "",
        url: r.url || r.document?.url || null,
      }));
    }
  }

  return results;
}

function extractResults(content) {
  for (const block of content) {
    if (block.type === "text") {
      try {
        const p = JSON.parse(block.text);
        const arr = p.results || p;
        if (Array.isArray(arr)) return arr.slice(0, 6).map(r => ({
          title: r.title || r.document?.title || "Untitled",
          source: r.datasource || r.document?.datasource || "Glean",
          snippet: r.snippets?.[0]?.snippet?.value || r.summary || "",
          url: r.url || r.document?.url || null,
        }));
      } catch {
        return [{ title: "Glean context", source: "Glean", snippet: block.text.slice(0, 400), url: null }];
      }
    }
  }
  return [];
}

function formatGleanContext(results) {
  if (!results.length) return "No internal documents found.";
  return results.map((r, i) =>
    `[${i + 1}] ${r.title} (${r.source})\n${r.snippet || "(no snippet)"}`
  ).join("\n\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { account } = req.body;
  if (!account?.name) return res.status(400).json({ error: "account.name required" });

  const gleanToken = process.env.GLEAN_API_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  // Run two Glean searches in parallel (internal history + if token available)
  let internalContext = "Glean not connected — internal history unavailable.";
  let gleanResults = [];

  if (gleanToken) {
    try {
      const [historyResults, dealsResults] = await Promise.all([
        gleanSearch(`${account.name} conversations notes meetings`, gleanToken),
        gleanSearch(`${account.name} deal opportunity pipeline`, gleanToken),
      ]);
      // Deduplicate by URL
      const seen = new Set();
      gleanResults = [...historyResults, ...dealsResults].filter(r => {
        const key = r.url || r.title;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      }).slice(0, 8);
      internalContext = formatGleanContext(gleanResults);
    } catch (e) {
      internalContext = `Glean search failed: ${e.message}`;
    }
  }

  // Build assay context from existing account data
  const assayContext = [
    account.bm ? `Business model: ${account.bm}` : null,
    account.pf ? `product fit: ${account.pf}` : null,
    account.ucs?.length ? `Use cases: ${account.ucs.join(", ")}` : null,
    account.prods?.length ? `Recommended products: ${account.prods.join(", ")}` : null,
    account.sigs?.length ? `Key signals: ${account.sigs.join("; ")}` : null,
    account.dis ? `Disqualifier: ${account.dis}` : null,
    account.tier ? `Tier: ${account.tier} (score ${account.score}/4)` : null,
    account.stage ? `Stage: ${account.stage}` : null,
    account.last ? `Last activity: ${account.last}` : null,
    account.vert ? `Vertical: ${account.vert}${account.sub ? " / " + account.sub : ""}` : null,
    account.state ? `HQ state: ${account.state}` : null,
  ].filter(Boolean).join("\n");

  const personaContext = (account.personas || []).slice(0, 3).map(p =>
    `${p.name}, ${p.title}${p.angle ? ` — ${p.angle}` : ""}`
  ).join("\n") || "No personas identified yet.";

  const prompt = `You are an AE assistant generating a concise, punchy meeting prep brief.

ACCOUNT: ${account.name}
WEBSITE: ${account.web || "unknown"}

PROSPECTOR ANALYSIS:
${assayContext || "Not yet analyzed."}

TOP CONTACTS:
${personaContext}

INTERNAL HISTORY (from Glean — Gong calls, SFDC notes, Slack, emails):
${internalContext}

Write a meeting prep brief in this exact structure. Be specific, not generic. Use what's in the data.

# ${account.name} — Meeting Prep

## What We Know
2–4 bullets from Glean history: prior conversations, open items, relationships, previous deals or evaluations. If no Glean data, say so honestly.

## Why They Need Us
2–3 bullets grounded in their business model and the assay. Specific product angle.

## Who To Talk To
List the identified personas with a one-line angle for each.

## Talking Points by Product
For each recommended product, one sharp talking point tailored to their business.

## Signals & Timing
Last activity, stage, any urgency indicators, 6sense or stealth signals if present.

## Watch Outs
Any disqualifiers, risks, or objections to anticipate.

Keep it tight — this should fit on one screen. No filler.`;

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
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const claudeData = await claudeRes.json();
    const brief = claudeData.content?.[0]?.text || "Failed to generate brief.";

    return res.status(200).json({ brief, gleanResults, gleanConnected: !!gleanToken });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
