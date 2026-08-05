export const config = { maxDuration: 15 };

// POST /api/hunter/domain-search — body: { domain, department?, limit? }
// Wraps Hunter.io's domain-search. Returns array of contacts.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const key = process.env.HUNTER_API_KEY;
  if (!key) return res.status(500).json({ error: "HUNTER_API_KEY not configured" });

  const { domain, department, limit } = req.body || {};
  if (!domain) return res.status(400).json({ error: "domain is required" });

  const params = new URLSearchParams({
    domain: String(domain).trim(),
    limit: String(Math.max(1, Math.min(10, Number(limit) || 5))),
    api_key: key,
  });
  if (department) params.set("department", String(department).trim());

  try {
    const r = await fetch(`https://api.hunter.io/v2/domain-search?${params}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(r.status).json({ error: text.slice(0, 200) || `Hunter error ${r.status}` });
    }
    const data = await r.json();
    const emails = data?.data?.emails || [];
    return res.status(200).json({
      domain: data?.data?.domain || domain,
      organization: data?.data?.organization || null,
      contacts: emails.map(e => ({
        email:      e.value,
        firstName:  e.first_name  || "",
        lastName:   e.last_name   || "",
        position:   e.position    || "",
        seniority:  e.seniority   || "",
        department: e.department  || "",
        confidence: e.confidence ?? null,
        linkedin:   e.linkedin    || null,
        type:       e.type        || null,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
