const express = require("express");
const crypto  = require("crypto");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY    || "";
const SFDC_CLIENT_ID   = process.env.SFDC_CLIENT_ID       || "";
const SFDC_SECRET      = process.env.SFDC_CLIENT_SECRET   || "";
const SFDC_REDIRECT    = process.env.SFDC_REDIRECT_URI    || "http://localhost:3000/api/sfdc/callback";

module.exports = function (app) {

  // ── Anthropic proxy ──────────────────────────────────────────────────────
  app.post("/proxy/anthropic/messages", express.json({ limit: "2mb" }), async (req, res) => {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(req.body),
      });
      res.json(await response.json());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Salesforce OAuth — local dev (mirrors server.js) ─────────────────────
  app.get("/api/sfdc/auth", (req, res) => {
    if (!SFDC_CLIENT_ID) return res.status(500).json({ error: "SFDC_CLIENT_ID not configured." });
    const codeVerifier  = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    res.setHeader("Set-Cookie", `pkce_verifier=${codeVerifier}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax`);
    const callerState = typeof req.query?.state === "string" ? req.query.state.slice(0, 1024) : "";
    const params = new URLSearchParams({
      response_type: "code",
      client_id: SFDC_CLIENT_ID,
      redirect_uri: SFDC_REDIRECT,
      scope: "api refresh_token",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    if (callerState) params.set("state", callerState);
    res.redirect(`https://login.salesforce.com/services/oauth2/authorize?${params}`);
  });

  app.get("/api/sfdc/callback", async (req, res) => {
    const { code, error, error_description, state } = req.query;
    const safeState = typeof state === "string" ? state.slice(0, 1024) : "";
    if (error) {
      const suffix = safeState ? `&sfdc_state=${encodeURIComponent(safeState)}` : "";
      return res.redirect(`/?sfdc_error=${encodeURIComponent(error_description || error)}${suffix}`);
    }
    if (!code) return res.status(400).json({ error: "Missing authorization code" });
    if (!SFDC_CLIENT_ID || !SFDC_SECRET) return res.redirect("/?sfdc_error=SFDC%20credentials%20not%20configured");
    try {
      const cookies = req.headers.cookie || "";
      const m = cookies.match(/pkce_verifier=([^;]+)/);
      const codeVerifier = m ? m[1] : null;
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: SFDC_CLIENT_ID,
        client_secret: SFDC_SECRET,
        redirect_uri: SFDC_REDIRECT,
      });
      if (codeVerifier) tokenBody.set("code_verifier", codeVerifier);
      const tokenRes = await fetch("https://login.salesforce.com/services/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody,
      });
      const tokenData = await tokenRes.json();
      if (tokenData.error) return res.redirect(`/?sfdc_error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`);
      const { access_token, instance_url, id: identityUrl } = tokenData;
      const idRes  = await fetch(identityUrl, { headers: { Authorization: `Bearer ${access_token}` } });
      const idData = await idRes.json();
      const email = idData.email || idData.username || "";
      let companyName = "";
      try {
        const orgQ = encodeURIComponent("SELECT Name FROM Organization LIMIT 1");
        const orgRes = await fetch(`${instance_url}/services/data/v59.0/query?q=${orgQ}`, { headers: { Authorization: `Bearer ${access_token}` } });
        if (orgRes.ok) {
          const orgData = await orgRes.json();
          companyName = orgData.records?.[0]?.Name || "";
        }
      } catch {}
      const params = new URLSearchParams({
        sfdc_token:    access_token,
        sfdc_instance: instance_url,
        sfdc_uid:      idData.user_id      || "",
        sfdc_name:     idData.display_name || idData.username || "",
      });
      if (email)       params.set("sfdc_email",   email);
      if (companyName) params.set("sfdc_company", companyName);
      if (safeState)   params.set("sfdc_state",   safeState);
      res.redirect(`/?${params}`);
    } catch (err) {
      res.redirect(`/?sfdc_error=${encodeURIComponent(err.message)}`);
    }
  });

  // ── Hunter.io proxy — local dev (mirrors api/hunter/*.js) ────────────────
  const HUNTER_KEY = process.env.HUNTER_API_KEY || "";
  app.post("/api/hunter/find", express.json(), async (req, res) => {
    if (!HUNTER_KEY) return res.status(500).json({ error: "HUNTER_API_KEY not configured" });
    const { domain, firstName, lastName } = req.body || {};
    if (!domain || !firstName || !lastName) return res.status(400).json({ error: "domain, firstName, lastName required" });
    const params = new URLSearchParams({ domain, first_name: firstName, last_name: lastName, api_key: HUNTER_KEY });
    try {
      const r = await fetch(`https://api.hunter.io/v2/email-finder?${params}`);
      if (r.status === 404) return res.json({ email: null });
      if (!r.ok) return res.status(r.status).json({ error: `Hunter error ${r.status}` });
      const data = await r.json();
      const d = data?.data || {};
      if (!d.email) return res.json({ email: null });
      res.json({
        email: d.email, score: d.score ?? null, position: d.position || null,
        linkedin_url: d.linkedin_url || null, verification: d.verification || null,
        firstName: d.first_name || firstName, lastName: d.last_name || lastName,
        domain: d.domain || domain,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.post("/api/hunter/domain-search", express.json(), async (req, res) => {
    if (!HUNTER_KEY) return res.status(500).json({ error: "HUNTER_API_KEY not configured" });
    const { domain, department, limit } = req.body || {};
    if (!domain) return res.status(400).json({ error: "domain required" });
    const params = new URLSearchParams({
      domain, limit: String(Math.max(1, Math.min(10, Number(limit) || 5))), api_key: HUNTER_KEY,
    });
    if (department) params.set("department", department);
    try {
      const r = await fetch(`https://api.hunter.io/v2/domain-search?${params}`);
      if (!r.ok) return res.status(r.status).json({ error: `Hunter error ${r.status}` });
      const data = await r.json();
      const emails = data?.data?.emails || [];
      res.json({
        domain: data?.data?.domain || domain,
        organization: data?.data?.organization || null,
        contacts: emails.map(e => ({
          email: e.value, firstName: e.first_name || "", lastName: e.last_name || "",
          position: e.position || "", seniority: e.seniority || "", department: e.department || "",
          confidence: e.confidence ?? null, linkedin: e.linkedin || null, type: e.type || null,
        })),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  app.get("/api/hunter/account", async (req, res) => {
    if (!HUNTER_KEY) return res.status(500).json({ error: "HUNTER_API_KEY not configured" });
    try {
      const r = await fetch(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(HUNTER_KEY)}`);
      if (!r.ok) return res.status(r.status).json({ error: `Hunter error ${r.status}` });
      const data = await r.json();
      const d = data?.data || {};
      res.json({
        email: d.email || null, plan: d.plan_name || null, calls: d.calls || null,
        searches: d.requests?.searches || null, verifications: d.requests?.verifications || null,
        reset_date: d.reset_date || null,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
