export const config = { maxDuration: 15 };

// POST /api/hunter/find — body: { domain, firstName, lastName }
// Wraps Hunter.io's email-finder. Returns { email, score, position, linkedin_url, verification }
// or { email: null } if Hunter found nothing.
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const key = process.env.HUNTER_API_KEY;
  if (!key) return res.status(500).json({ error: "HUNTER_API_KEY not configured" });

  const { domain, firstName, lastName } = req.body || {};
  if (!domain || !firstName || !lastName) {
    return res.status(400).json({ error: "domain, firstName, and lastName are required" });
  }

  const params = new URLSearchParams({
    domain: String(domain).trim(),
    first_name: String(firstName).trim(),
    last_name: String(lastName).trim(),
    api_key: key,
  });

  try {
    const r = await fetch(`https://api.hunter.io/v2/email-finder?${params}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (r.status === 404) return res.status(200).json({ email: null });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(r.status).json({ error: text.slice(0, 200) || `Hunter error ${r.status}` });
    }
    const data = await r.json();
    const d = data?.data || {};
    if (!d.email) return res.status(200).json({ email: null });
    return res.status(200).json({
      email:        d.email,
      score:        d.score ?? null,
      position:     d.position || null,
      linkedin_url: d.linkedin_url || null,
      verification: d.verification || null,
      firstName:    d.first_name || firstName,
      lastName:     d.last_name  || lastName,
      domain:       d.domain     || domain,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
