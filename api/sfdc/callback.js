export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  const { code, error, error_description, state } = req.query;
  const safeState = typeof state === "string" ? state.slice(0, 1024) : "";

  if (error) {
    const msg = encodeURIComponent(error_description || error);
    const suffix = safeState ? `&sfdc_state=${encodeURIComponent(safeState)}` : "";
    return res.redirect(302, `/?sfdc_error=${msg}${suffix}`);
  }

  if (!code) {
    return res.status(400).json({ error: "Missing authorization code" });
  }

  const clientId = process.env.SFDC_CLIENT_ID;
  const clientSecret = process.env.SFDC_CLIENT_SECRET;
  const redirectUri = process.env.SFDC_REDIRECT_URI || "http://localhost:3000/api/sfdc/callback";

  if (!clientId || !clientSecret) {
    return res.redirect(302, "/?sfdc_error=SFDC%20credentials%20not%20configured");
  }

  try {
    // Read PKCE verifier from cookie set by auth.js
    const cookies = req.headers.cookie || "";
    const verifierMatch = cookies.match(/pkce_verifier=([^;]+)/);
    const codeVerifier = verifierMatch ? verifierMatch[1] : null;

    // Exchange authorization code for access token
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });
    if (codeVerifier) tokenBody.set("code_verifier", codeVerifier);

    const tokenRes = await fetch("https://login.salesforce.com/services/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });

    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      const msg = encodeURIComponent(tokenData.error_description || tokenData.error);
      return res.redirect(302, `/?sfdc_error=${msg}`);
    }

    const { access_token, instance_url, id: identityUrl } = tokenData;

    // Resolve user identity (user_id, display_name) from SFDC identity endpoint
    const idRes = await fetch(identityUrl, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const idData = await idRes.json();

    const userId = idData.user_id || "";
    const displayName = idData.display_name || idData.username || "";
    const email = idData.email || idData.username || "";

    // Best-effort: fetch the org name so onboarding can prefill the Company field.
    // Tolerated to fail silently — onboarding still works without it.
    let companyName = "";
    try {
      const orgQ = encodeURIComponent("SELECT Name FROM Organization LIMIT 1");
      const orgRes = await fetch(`${instance_url}/services/data/v59.0/query?q=${orgQ}`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (orgRes.ok) {
        const orgData = await orgRes.json();
        companyName = orgData.records?.[0]?.Name || "";
      }
    } catch {}

    // Redirect back to the app, passing token info via query params
    // The React app reads these on mount, stores to localStorage, and clears the URL
    const params = new URLSearchParams({
      sfdc_token: access_token,
      sfdc_instance: instance_url,
      sfdc_uid: userId,
      sfdc_name: displayName,
    });
    if (email) params.set("sfdc_email", email);
    if (companyName) params.set("sfdc_company", companyName);
    // Round-trip any opaque caller state (resume marker for onboarding flow, etc.)
    if (safeState) params.set("sfdc_state", safeState);

    res.redirect(302, `/?${params}`);
  } catch (err) {
    const msg = encodeURIComponent(err.message);
    res.redirect(302, `/?sfdc_error=${msg}`);
  }
}
