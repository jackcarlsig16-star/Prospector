export const config = { maxDuration: 60 };

async function refreshGmailToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
    }),
  });
  return res.json();
}

async function fetchSentEmails(accessToken) {
  const listRes = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=SENT&maxResults=60&q=in:sent",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const listData = await listRes.json();
  if (listData.error) throw new Error(listData.error.message || "Gmail API error");
  if (!listData.messages?.length) return [];

  // Fetch messages in parallel (batch of 30 max to avoid rate limits)
  const msgs = await Promise.all(
    listData.messages.slice(0, 50).map(async m => {
      try {
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        return r.json();
      } catch { return null; }
    })
  );
  return msgs.filter(Boolean);
}

function extractEmailText(msg) {
  const headers = msg.payload?.headers || [];
  const to = headers.find(h => h.name === "To")?.value || "";
  const subject = headers.find(h => h.name === "Subject")?.value || "";
  const date = headers.find(h => h.name === "Date")?.value || "";

  let body = "";
  const walk = (part) => {
    if (!part) return;
    if (part.mimeType === "text/plain" && part.body?.data) {
      try { body = Buffer.from(part.body.data, "base64").toString("utf-8"); } catch {}
    }
    (part.parts || []).forEach(walk);
  };
  walk(msg.payload);

  // Clean up: strip reply threads, signatures, blank lines
  body = body
    .replace(/^On .+wrote:[\s\S]*/m, "")   // remove replied-to content
    .replace(/^>.*$/mg, "")                 // remove quoted lines
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 800);

  return { to, subject, date, body };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    accessToken,
    refreshToken,
    mode,          // "learn" (default) | "teach"
    original,      // teach mode: original AI-generated email
    edited,        // teach mode: user's edited version
    existingProfile,
  } = req.body;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  // ── TEACH MODE: refine existing profile from an edit pair ────────────────
  if (mode === "teach") {
    if (!original || !edited) return res.status(400).json({ error: "original and edited required for teach mode" });

    const profileJson = existingProfile ? JSON.stringify(existingProfile, null, 2) : "{}";
    try {
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{ role: "user", content:
`Given an existing voice profile and a before/after email edit, refine the profile to better capture the sender's voice. Focus specifically on what changed and what those changes reveal about their preferences.

EXISTING PROFILE:
${profileJson}

AI-GENERATED ORIGINAL:
${original}

USER'S EDITED VERSION:
${edited}

Return ONLY a valid JSON object with the same structure as the existing profile, updated where the edit gives new signal. Preserve unchanged fields.`
          }],
        }),
      });
      const data = await claudeRes.json();
      const text = data.content?.[0]?.text || "{}";
      const match = text.match(/\{[\s\S]+\}/);
      const profile = match ? JSON.parse(match[0]) : existingProfile || {};
      profile.lastRefined = new Date().toISOString();
      profile.teachCount = (existingProfile?.teachCount || 0) + 1;
      return res.status(200).json({ profile });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── LEARN MODE: fetch Gmail + analyze ───────────────────────────────────
  if (!accessToken) return res.status(400).json({ error: "accessToken required" });

  let token = accessToken;
  let messages = [];

  try {
    messages = await fetchSentEmails(token);
  } catch (e) {
    // Try refreshing
    if (refreshToken) {
      try {
        const refreshed = await refreshGmailToken(refreshToken);
        if (refreshed.access_token) {
          token = refreshed.access_token;
          messages = await fetchSentEmails(token);
        } else {
          return res.status(401).json({ error: "Token expired and refresh failed — reconnect Gmail" });
        }
      } catch (e2) {
        return res.status(401).json({ error: "Gmail authentication failed: " + e2.message });
      }
    } else {
      return res.status(401).json({ error: "Gmail token invalid — reconnect Gmail" });
    }
  }

  // Extract and filter to external emails only
  const emails = messages
    .map(extractEmailText)
    .filter(e =>
      e.body.trim().length > 40 &&
      e.to &&
      !e.to.toLowerCase().includes("@" + (process.env.COMPANY_DOMAIN || "example.com")) &&
      !e.to.toLowerCase().includes("noreply") &&
      !e.to.toLowerCase().includes("no-reply")
    )
    .slice(0, 25);

  if (emails.length < 3) {
    return res.status(200).json({
      profile: null,
      message: `Only ${emails.length} external sent emails found — need at least 3 to build a voice profile`,
    });
  }

  const samples = emails.slice(0, 20).map((e, i) =>
    `--- Email ${i + 1} ---\nTo: ${e.to}\nSubject: ${e.subject}\n\n${e.body}`
  ).join("\n\n");

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1200,
        messages: [{ role: "user", content:
`Analyze these sent emails and extract a precise voice profile for the sender. Look for consistent patterns across multiple emails.

${samples}

Return ONLY a valid JSON object — no explanation, no markdown, just the JSON:
{
  "greeting": "the exact greeting pattern (e.g. 'Hey [First Name],' or 'Hi [First Name],')",
  "closing": "exact closing sign-off (e.g. '- [Your Name]' or 'Thanks,\\n[Your Name]')",
  "tone": "one word: casual | direct | warm | formal | conversational",
  "avgSentenceLength": "short | medium | long",
  "avgEmailLength": "brief (under 80 words) | moderate (80-150 words) | detailed (over 150 words)",
  "commonPhrases": ["up to 5 phrases the sender actually uses"],
  "avoidPhrases": ["phrases/words the sender never uses — infer from absence and substitutions"],
  "signatureStyle": "description of how emails end",
  "formalityLevel": 2,
  "punctuationStyle": "brief description (e.g. no exclamation marks, uses em-dashes, minimal punctuation)",
  "structureStyle": "brief description of paragraph/structure patterns",
  "keyTraits": ["3-4 defining voice traits (e.g. 'Direct', 'No fluff', 'Conversational')"],
  "sampleOpener": "copy an actual strong opener line from one email",
  "analyzedCount": ${emails.length}
}`
        }],
      }),
    });

    const data = await claudeRes.json();
    const text = data.content?.[0]?.text || "{}";
    const match = text.match(/\{[\s\S]+\}/);
    if (!match) throw new Error("Claude returned non-JSON response");

    const profile = JSON.parse(match[0]);
    profile.learnedAt = new Date().toISOString();
    profile.emailCount = emails.length;
    profile.teachCount = 0;

    return res.status(200).json({
      profile,
      newAccessToken: token !== accessToken ? token : undefined,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
