export const config = { maxDuration: 20 };

// Set to your org's Glean instance base URL
const GLEAN_BASE = process.env.GLEAN_BASE_URL;

async function gleanPeopleSearch(query, token) {
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
        name: "people_profile_search",
        arguments: { query, pageSize: 5 },
      },
      id: 1,
    }),
    signal: AbortSignal.timeout(12000),
  });

  const contentType = mcpRes.headers.get("content-type") || "";

  if (contentType.includes("text/event-stream")) {
    const text = await mcpRes.text();
    for (const line of text.split("\n")) {
      if (line.startsWith("data:")) {
        try {
          const parsed = JSON.parse(line.slice(5).trim());
          if (parsed?.result?.content) return parseMcpPeople(parsed.result.content);
        } catch {}
      }
    }
    throw new Error("MCP stream ended without result");
  }

  if (contentType.includes("application/json")) {
    const data = await mcpRes.json();
    if (data?.result?.content) return parseMcpPeople(data.result.content);
    if (data?.error) throw new Error(data.error.message || "MCP people search error");
  }

  // Fallback: Glean REST people search
  const restRes = await fetch(`${GLEAN_BASE}/rest/api/v1/people/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ query, pageSize: 5 }),
    signal: AbortSignal.timeout(12000),
  });

  if (!restRes.ok) throw new Error(`Glean people search failed: ${restRes.status}`);
  const restData = await restRes.json();
  return parsePeopleResults(restData);
}

function parseMcpPeople(content) {
  for (const block of content) {
    if (block.type === "text") {
      try {
        const parsed = JSON.parse(block.text);
        const results = parsed.results || parsed.people || parsed;
        if (Array.isArray(results)) return normalizePeople(results);
      } catch {
        return [{ name: "SE", title: "", email: "", summary: block.text }];
      }
    }
  }
  return [];
}

function parsePeopleResults(data) {
  return normalizePeople(data.results || data.people || []);
}

function normalizePeople(results) {
  return results.slice(0, 5).map(r => ({
    name: r.name || r.person?.name || r.displayName || "Unknown",
    title: r.title || r.person?.title || r.jobTitle || "",
    email: r.email || r.person?.email || r.emailAddress || "",
    department: r.department || r.person?.department || "",
  }));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query required" });
  const token = process.env.GLEAN_API_TOKEN;
  if (!token) return res.status(500).json({ error: "GLEAN_API_TOKEN not configured" });
  try {
    const people = await gleanPeopleSearch(query, token);
    return res.status(200).json({ people, query });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
