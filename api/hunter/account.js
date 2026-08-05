export const config = { maxDuration: 10 };

// GET /api/hunter/account — admin-only quota check + connection test.
// Returns { plan, calls, searches, verifications, reset_date, email } or { error }.
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const key = process.env.HUNTER_API_KEY;
  if (!key) return res.status(500).json({ error: "HUNTER_API_KEY not configured" });

  try {
    const r = await fetch(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(r.status).json({ error: text.slice(0, 200) || `Hunter error ${r.status}` });
    }
    const data = await r.json();
    const d = data?.data || {};
    return res.status(200).json({
      email:         d.email || null,
      plan:          d.plan_name || null,
      calls:         d.calls || null,
      searches:      d.requests?.searches || null,
      verifications: d.requests?.verifications || null,
      reset_date:    d.reset_date || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
