import crypto from "crypto";

export const config = { maxDuration: 10 };

export default function handler(req, res) {
  const clientId = process.env.SFDC_CLIENT_ID;
  const redirectUri = process.env.SFDC_REDIRECT_URI || "http://localhost:3000/api/sfdc/callback";

  if (!clientId) {
    return res.status(500).json({ error: "SFDC_CLIENT_ID not configured." });
  }

  // PKCE: generate verifier + challenge
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

  // Store verifier in a short-lived cookie so callback.js can read it
  res.setHeader("Set-Cookie", `pkce_verifier=${codeVerifier}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax`);

  // Caller can pass ?state=<base64-encoded-json> to carry resume context across
  // the OAuth round-trip (e.g. wizardStep, returnTo). Round-tripped to callback
  // via the standard OAuth `state` param.
  const callerState = typeof req.query?.state === "string" ? req.query.state.slice(0, 1024) : "";

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "api id",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  if (callerState) params.set("state", callerState);

  res.redirect(302, `https://login.salesforce.com/services/oauth2/authorize?${params}`);
}
