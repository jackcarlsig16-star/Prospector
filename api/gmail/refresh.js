export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'Missing refreshToken' });

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.status(500).json({ error: 'Gmail credentials not configured' });

  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const data = await r.json();
    if (data.error) return res.status(401).json({ error: data.error_description || data.error });
    res.json({
      accessToken: data.access_token,
      expiry: Date.now() + (data.expires_in || 3600) * 1000,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
