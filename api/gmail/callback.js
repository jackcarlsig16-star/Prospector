export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) return res.redirect(302, `/?gmail_error=${encodeURIComponent(error)}`);
  if (!code) return res.status(400).json({ error: "Missing authorization code" });

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI || "http://localhost:3000/api/gmail/callback";

  if (!clientId || !clientSecret) {
    return res.redirect(302, "/?gmail_error=Gmail+credentials+not+configured");
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();

    if (tokens.error) {
      const msg = encodeURIComponent(tokens.error_description || tokens.error);
      return res.redirect(302, `/?gmail_error=${msg}`);
    }

    // Get user info to confirm identity
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();

    const params = new URLSearchParams({
      gmail_access_token: tokens.access_token,
      gmail_refresh_token: tokens.refresh_token || "",
      gmail_token_expiry: String(Date.now() + (tokens.expires_in || 3600) * 1000),
      gmail_email: profile.email || "",
    });

    res.redirect(302, `/?${params}`);
  } catch (err) {
    res.redirect(302, `/?gmail_error=${encodeURIComponent(err.message)}`);
  }
}
