const express = require("express");
const crypto  = require("crypto");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY    || "";
const GMAIL_CLIENT_ID  = process.env.GMAIL_CLIENT_ID      || "";
const GMAIL_SECRET     = process.env.GMAIL_CLIENT_SECRET  || "";
const GMAIL_REDIRECT   = "http://localhost:3000/api/gmail/callback";
const SFDC_CLIENT_ID   = process.env.SFDC_CLIENT_ID       || "";
const SFDC_SECRET      = process.env.SFDC_CLIENT_SECRET   || "";
const SFDC_REDIRECT    = process.env.SFDC_REDIRECT_URI    || "http://localhost:3000/api/sfdc/callback";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

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

  // ── Gmail + Calendar OAuth — works locally ───────────────────────────────
  app.get("/api/gmail/auth", (req, res) => {
    if (!GMAIL_CLIENT_ID) return res.redirect("/?gmail_error=GMAIL_CLIENT_ID+not+set");
    const params = new URLSearchParams({
      client_id:     GMAIL_CLIENT_ID,
      redirect_uri:  GMAIL_REDIRECT,
      response_type: "code",
      scope:         GOOGLE_SCOPES,
      access_type:   "offline",
      prompt:        "consent",
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  app.get("/api/gmail/callback", async (req, res) => {
    const { code, error } = req.query;
    if (error) return res.redirect(`/?gmail_error=${encodeURIComponent(error)}`);
    if (!code)  return res.redirect("/?gmail_error=Missing+code");
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id:     GMAIL_CLIENT_ID,
          client_secret: GMAIL_SECRET,
          redirect_uri:  GMAIL_REDIRECT,
          grant_type:    "authorization_code",
        }),
      });
      const tokens = await tokenRes.json();
      if (tokens.error) {
        return res.redirect(`/?gmail_error=${encodeURIComponent(tokens.error_description || tokens.error)}`);
      }
      const profileRes = await fetch("https://www.googleapis.com/oauth2/v1/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = await profileRes.json();
      const params = new URLSearchParams({
        gmail_access_token:  tokens.access_token,
        gmail_refresh_token: tokens.refresh_token || "",
        gmail_token_expiry:  String(Date.now() + (tokens.expires_in || 3600) * 1000),
        gmail_email:         profile.email || "",
      });
      res.redirect(`/?${params}`);
    } catch (err) {
      res.redirect(`/?gmail_error=${encodeURIComponent(err.message)}`);
    }
  });

  // ── Gmail token refresh ──────────────────────────────────────────────────
  app.post("/api/gmail/refresh", express.json(), async (req, res) => {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(400).json({ error: "Missing refreshToken" });
    if (!GMAIL_CLIENT_ID || !GMAIL_SECRET) return res.status(500).json({ error: "Gmail credentials not configured" });
    try {
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id:     GMAIL_CLIENT_ID,
          client_secret: GMAIL_SECRET,
          refresh_token: refreshToken,
          grant_type:    "refresh_token",
        }),
      });
      const data = await r.json();
      if (data.error) return res.status(401).json({ error: data.error_description || data.error });
      res.json({ accessToken: data.access_token, expiry: Date.now() + (data.expires_in || 3600) * 1000 });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Gmail draft creation ─────────────────────────────────────────────────
  app.post("/api/gmail/draft", express.json({ limit: "1mb" }), async (req, res) => {
    const { to, subject, body, accessToken } = req.body || {};
    if (!accessToken) return res.status(400).json({ error: "Missing accessToken" });
    if (!subject && !body) return res.status(400).json({ error: "Need at least subject or body" });
    try {
      const headers = [];
      if (to)      headers.push(`To: ${to}`);
      if (subject) headers.push(`Subject: ${subject}`);
      headers.push("Content-Type: text/plain; charset=utf-8");
      const mime = `${headers.join("\r\n")}\r\n\r\n${body || ""}`;
      const raw = Buffer.from(mime, "utf-8").toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { raw } }),
      });
      if (!r.ok) {
        const errText = await r.text();
        return res.status(r.status).json({ error: errText.slice(0, 400) });
      }
      const data = await r.json();
      const messageId = data.message?.id;
      const draftUrl = messageId
        ? `https://mail.google.com/mail/u/0/#drafts/${messageId}`
        : `https://mail.google.com/mail/u/0/#drafts`;
      res.json({ draftId: data.id, messageId, draftUrl });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Gmail search proxy ───────────────────────────────────────────────────
  app.get("/proxy/gmail/messages", async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "No token" });
    const { q, maxResults } = req.query;
    const url = `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q||"")}&maxResults=${maxResults||8}`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      res.json(await r.json());
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/proxy/gmail/message/:id", async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "No token" });
    const url = `https://www.googleapis.com/gmail/v1/users/me/messages/${req.params.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      res.json(await r.json());
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get("/proxy/gmail/message/:id/body", async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "No token" });
    try {
      const r = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${req.params.id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const msg = await r.json();
      const decode = data => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
      const extractText = payload => {
        if (!payload) return "";
        if (payload.mimeType === "text/plain" && payload.body?.data) return decode(payload.body.data);
        if (payload.parts) {
          for (const p of payload.parts) { const t = extractText(p); if (t) return t; }
        }
        return "";
      };
      const text = extractText(msg.payload);
      const headers = msg.payload?.headers || [];
      const getH = n => headers.find(h => h.name === n)?.value || "";
      res.json({ text, subject: getH("Subject"), from: getH("From") });
    } catch (err) { res.status(500).json({ error: err.message }); }
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

  // ── Google Calendar proxy ─────────────────────────────────────────────────
  app.get("/proxy/gcal/events", async (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "No token" });
    const { timeMin, timeMax } = req.query;
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=50`;
    try {
      const response = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
      res.json(await response.json());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
