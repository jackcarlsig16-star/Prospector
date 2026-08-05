export const config = { maxDuration: 20 };

// Set to your org's Glean instance base URL
const GLEAN_BASE = process.env.GLEAN_BASE_URL;

// Call the Glean MCP server's search tool via streamable HTTP transport.
// Falls back to Glean REST API if MCP returns an unexpected format.
async function gleanSearch(query, token) {
  // ── Attempt 1: MCP streamable HTTP ──────────────────────────────────────────
  // Glean's MCP server accepts JSON-RPC tool calls over HTTP.
  // The session is stateless for tool calls (no prior initialize required
  // when using the all-data endpoint directly).
  const mcpRes = await fetch(`${GLEAN_BASE}/mcp/all-data`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "search",
        arguments: { query, pageSize: 8 },
      },
      id: 1,
    }),
    signal: AbortSignal.timeout(12000),
  });

  const contentType = mcpRes.headers.get("content-type") || "";

  // SSE stream — read until we get the result event
  if (contentType.includes("text/event-stream")) {
    const text = await mcpRes.text();
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data:")) {
        try {
          const parsed = JSON.parse(line.slice(5).trim());
          if (parsed?.result?.content) return parseMcpResults(parsed.result.content);
        } catch {}
      }
    }
    throw new Error("MCP stream ended without result");
  }

  // JSON response
  if (contentType.includes("application/json")) {
    const data = await mcpRes.json();
    if (data?.result?.content) return parseMcpResults(data.result.content);
    if (data?.error) throw new Error(data.error.message || "MCP error");
  }

  // ── Attempt 2: Glean REST API ────────────────────────────────────────────────
  const restRes = await fetch(`${GLEAN_BASE}/rest/api/v1/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      query,
      pageSize: 8,
      requestOptions: { facetFilters: [] },
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (!restRes.ok) throw new Error(`Glean search failed: ${restRes.status}`);
  const restData = await restRes.json();
  return parseRestResults(restData);
}

function parseMcpResults(content) {
  // MCP content is usually an array of { type:"text", text: JSON string }
  for (const block of content) {
    if (block.type === "text") {
      try {
        const parsed = JSON.parse(block.text);
        // Could be { results: [...] } or an array directly
        const results = parsed.results || parsed;
        if (Array.isArray(results)) return normalizeResults(results);
      } catch {
        // Plain text summary — wrap it
        return [{ title: "Glean summary", source: "Glean", snippet: block.text, url: null }];
      }
    }
  }
  return [];
}

function parseRestResults(data) {
  const results = data.results || [];
  return normalizeResults(results);
}

function normalizeResults(results) {
  return results.slice(0, 8).map(r => ({
    title: r.title || r.document?.title || r.name || "Untitled",
    source: r.datasource || r.document?.datasource || r.source || "Glean",
    snippet: r.snippets?.[0]?.snippet?.value
      || r.snippet?.value
      || r.summary
      || r.body?.slice(0, 200)
      || "",
    url: r.url || r.document?.url || null,
  }));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query, accountName } = req.body;
  if (!query && !accountName) return res.status(400).json({ error: "query or accountName required" });

  const token = process.env.GLEAN_API_TOKEN;
  if (!token) return res.status(500).json({ error: "GLEAN_API_TOKEN not configured" });
  if (!GLEAN_BASE) return res.status(500).json({ error: "GLEAN_BASE_URL not configured" });

  const searchQuery = query || accountName;

  try {
    const results = await gleanSearch(searchQuery, token);
    return res.status(200).json({ results, query: searchQuery });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
