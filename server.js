'use strict';
const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const cron    = require('node-cron');
require('dotenv').config();

// ── Env validation ────────────────────────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('⚠  ANTHROPIC_API_KEY missing — AI features will not work');
}

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY    || '';
const GMAIL_ID       = process.env.GMAIL_CLIENT_ID       || '';
const GMAIL_SECRET   = process.env.GMAIL_CLIENT_SECRET   || '';
const GMAIL_REDIRECT = process.env.GMAIL_REDIRECT_URI    || '';
const GOOGLE_SCOPES  = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/presentations';

const app = express();
app.set('trust proxy', 1); // Render terminates TLS — trust X-Forwarded-Proto
// verify captures the raw request bytes as req.rawBody - needed for webhook
// HMAC signature verification (api/lib/webhookHandler.js), since the
// re-serialized parsed body isn't guaranteed to match what a provider signed.
// Harmless for every other route - nothing else reads req.rawBody.
app.use(express.json({ limit: '20mb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); } }));

import('./api/lib/checkCredentials.js').then(({ checkCredentials }) => checkCredentials());

// ── Anthropic proxy ───────────────────────────────────────────────────────────
app.post('/proxy/anthropic/messages', async (req, res) => {
  const model  = req.body?.model || '?';
  const stream = !!req.body?.stream;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(55000),
    });

    console.log(`[anthropic-proxy] model=${model} stream=${stream} status=${r.status}`);

    if (!r.ok) {
      const errBody = await r.text();
      console.error(`[anthropic-proxy] error body: ${errBody}`);
      return res.status(r.status).send(errBody);
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.status(200);
      const reader = r.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); return; }
          res.write(value);
        }
      };
      await pump();
      return;
    }

    const body = await r.json();
    res.status(r.status).json(body);
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    console.error(`[anthropic-proxy] exception: ${err.name} ${err.message}`);
    res.status(isTimeout ? 504 : 500).json({ error: isTimeout ? 'Request to Anthropic timed out' : err.message });
  }
});

// ── Jina reader proxy (avoids CORS / rate-limit issues from browser) ──────────
app.get('/proxy/jina', async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).json({ error: 'url param required' });
  try {
    const decoded = decodeURIComponent(raw);
    const target = decoded.startsWith('http') ? decoded : `https://${decoded}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const r = await fetch(`https://r.jina.ai/${target}`, {
      headers: {
        'Accept': 'text/plain',
        'User-Agent': 'Mozilla/5.0 (compatible; Prospector/1.0)',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return res.status(r.status).json({ error: `Jina returned ${r.status}` });
    const text = await r.text();
    res.type('text/plain').send(text);
  } catch (err) {
    const status = err.name === 'AbortError' ? 504 : 502;
    res.status(status).json({ error: err.message });
  }
});

// ── Gmail search proxies ──────────────────────────────────────────────────────
app.get('/proxy/gmail/messages', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  const { q, maxResults } = req.query;
  try {
    const r = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q||'')}&maxResults=${maxResults||8}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    res.json(await r.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/proxy/gmail/message/:id', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const r = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${req.params.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    res.json(await r.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/proxy/gmail/message/:id/body', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const r = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${req.params.id}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const msg = await r.json();
    // Decode body from base64url — walk parts to find text/plain
    const decode = (data) => Buffer.from(data.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf-8');
    const extractText = (payload) => {
      if (!payload) return '';
      if (payload.mimeType === 'text/plain' && payload.body?.data) return decode(payload.body.data);
      if (payload.parts) {
        for (const p of payload.parts) { const t = extractText(p); if (t) return t; }
      }
      return '';
    };
    const text = extractText(msg.payload);
    res.json({ text, subject: (msg.payload?.headers||[]).find(h=>h.name==='Subject')?.value||'', from: (msg.payload?.headers||[]).find(h=>h.name==='From')?.value||'' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Google Calendar proxy ─────────────────────────────────────────────────────
app.get('/proxy/gcal/events', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  const { timeMin, timeMax } = req.query;
  try {
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    res.json(await r.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Gmail OAuth ───────────────────────────────────────────────────────────────
app.get('/api/gmail/auth', (req, res) => {
  if (!GMAIL_ID) return res.redirect('/?gmail_error=GMAIL_CLIENT_ID+not+configured');
  const redirect = GMAIL_REDIRECT || `${req.protocol}://${req.get('host')}/api/gmail/callback`;
  const params = new URLSearchParams({
    client_id: GMAIL_ID,
    redirect_uri: redirect,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.post('/api/gmail/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'Missing refreshToken' });
  if (!GMAIL_ID || !GMAIL_SECRET) return res.status(500).json({ error: 'Gmail credentials not configured' });
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GMAIL_ID,
        client_secret: GMAIL_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const data = await r.json();
    if (data.error) return res.status(401).json({ error: data.error_description || data.error });
    res.json({ accessToken: data.access_token, expiry: Date.now() + (data.expires_in || 3600) * 1000 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/gmail/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect(`/?gmail_error=${encodeURIComponent(error)}`);
  if (!code) return res.redirect('/?gmail_error=Missing+code');
  const redirect = GMAIL_REDIRECT || `${req.protocol}://${req.get('host')}/api/gmail/callback`;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: GMAIL_ID, client_secret: GMAIL_SECRET, redirect_uri: redirect, grant_type: 'authorization_code' }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) return res.redirect(`/?gmail_error=${encodeURIComponent(tokens.error_description || tokens.error)}`);
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    const params = new URLSearchParams({
      gmail_access_token:  tokens.access_token,
      gmail_refresh_token: tokens.refresh_token || '',
      gmail_token_expiry:  String(Date.now() + (tokens.expires_in || 3600) * 1000),
      gmail_email:         profile.email || '',
    });
    res.redirect(`/?${params}`);
  } catch (err) { res.redirect(`/?gmail_error=${encodeURIComponent(err.message)}`); }
});

// ── Salesforce OAuth ──────────────────────────────────────────────────────────
app.get('/api/sfdc/auth', (req, res) => {
  const clientId    = process.env.SFDC_CLIENT_ID;
  const redirectUri = process.env.SFDC_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/sfdc/callback`;
  if (!clientId) return res.status(500).json({ error: 'SFDC_CLIENT_ID not configured.' });
  const codeVerifier  = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  res.setHeader('Set-Cookie', `pkce_verifier=${codeVerifier}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax`);
  // Caller may pass ?state=<opaque> for resume context (onboarding, etc.)
  const callerState = typeof req.query?.state === 'string' ? req.query.state.slice(0, 1024) : '';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'api refresh_token',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  if (callerState) params.set('state', callerState);
  res.redirect(`https://login.salesforce.com/services/oauth2/authorize?${params}`);
});

app.get('/api/sfdc/callback', async (req, res) => {
  const { code, error, error_description, state } = req.query;
  const safeState = typeof state === 'string' ? state.slice(0, 1024) : '';
  if (error) {
    const suffix = safeState ? `&sfdc_state=${encodeURIComponent(safeState)}` : '';
    return res.redirect(`/?sfdc_error=${encodeURIComponent(error_description || error)}${suffix}`);
  }
  if (!code)  return res.status(400).json({ error: 'Missing authorization code' });
  const clientId    = process.env.SFDC_CLIENT_ID;
  const clientSecret = process.env.SFDC_CLIENT_SECRET;
  const redirectUri  = process.env.SFDC_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/sfdc/callback`;
  if (!clientId || !clientSecret) return res.redirect('/?sfdc_error=SFDC%20credentials%20not%20configured');
  try {
    const cookies = req.headers.cookie || '';
    const verifierMatch = cookies.match(/pkce_verifier=([^;]+)/);
    const codeVerifier = verifierMatch ? verifierMatch[1] : null;
    const tokenBody = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri });
    if (codeVerifier) tokenBody.set('code_verifier', codeVerifier);
    const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody,
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) return res.redirect(`/?sfdc_error=${encodeURIComponent(tokenData.error_description || tokenData.error)}`);
    const { access_token, instance_url, id: identityUrl } = tokenData;
    const idRes  = await fetch(identityUrl, { headers: { Authorization: `Bearer ${access_token}` } });
    const idData = await idRes.json();
    const email = idData.email || idData.username || '';
    // Best-effort org name for onboarding prefill
    let companyName = '';
    try {
      const orgQ = encodeURIComponent('SELECT Name FROM Organization LIMIT 1');
      const orgRes = await fetch(`${instance_url}/services/data/v59.0/query?q=${orgQ}`, { headers: { Authorization: `Bearer ${access_token}` } });
      if (orgRes.ok) {
        const orgData = await orgRes.json();
        companyName = orgData.records?.[0]?.Name || '';
      }
    } catch {}
    // Store token server-side so cron jobs can use it without a browser session
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        await sb.from('sfdc_tokens').upsert({
          id: 'primary',
          access_token,
          instance_url,
          issued_at: new Date().toISOString(),
        }, { onConflict: 'id' });
        console.log('[SFDC] Token stored in Supabase for cron use');
      } catch (e) {
        console.error('[SFDC] Token storage failed (non-fatal):', e.message);
      }
    }
    const params = new URLSearchParams({
      sfdc_token:    access_token,
      sfdc_instance: instance_url,
      sfdc_uid:      idData.user_id      || '',
      sfdc_name:     idData.display_name || idData.username || '',
    });
    if (email)       params.set('sfdc_email',   email);
    if (companyName) params.set('sfdc_company', companyName);
    if (safeState)   params.set('sfdc_state',   safeState);
    res.redirect(`/?${params}`);
  } catch (err) { res.redirect(`/?sfdc_error=${encodeURIComponent(err.message)}`); }
});

// ── Google Slides export ──────────────────────────────────────────────────────
app.post('/api/slides/create', async (req, res) => {
  const { components, accountName, accessToken } = req.body;
  if (!accessToken) return res.status(401).json({ error: 'No access token' });
  if (!components?.length) return res.status(400).json({ error: 'No components provided' });
  try {
    // 1. Create presentation
    const createRes = await fetch('https://slides.googleapis.com/v1/presentations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ title: `${accountName} — Deal Summary` }),
    });
    const presentation = await createRes.json();
    if (presentation.error) return res.status(400).json({ error: presentation.error.message || 'Failed to create presentation' });
    const presentationId = presentation.presentationId;
    const firstSlideId = presentation.slides?.[0]?.objectId;

    // 2. Build batchUpdate requests — one slide per component
    const requests = [];
    // Delete the default blank slide first (we'll add our own)
    if (firstSlideId) {
      requests.push({ deleteObject: { objectId: firstSlideId } });
    }
    components.forEach((comp, i) => {
      const slideId = `slide_${i}`;
      const titleId = `title_${i}`;
      const bodyId  = `body_${i}`;
      requests.push(
        { createSlide: { objectId: slideId, insertionIndex: i, slideLayoutReference: { predefinedLayout: 'BLANK' } } },
        { createShape: { objectId: titleId, shapeType: 'TEXT_BOX', elementProperties: { pageObjectId: slideId, size: { width: { magnitude: 550, unit: 'PT' }, height: { magnitude: 40, unit: 'PT' } }, transform: { scaleX: 1, scaleY: 1, translateX: 30, translateY: 20, unit: 'PT' } } } },
        { insertText: { objectId: titleId, text: comp.label } },
        { updateTextStyle: { objectId: titleId, textRange: { type: 'ALL' }, style: { bold: true, fontSize: { magnitude: 18, unit: 'PT' } }, fields: 'bold,fontSize' } },
        { createShape: { objectId: bodyId, shapeType: 'TEXT_BOX', elementProperties: { pageObjectId: slideId, size: { width: { magnitude: 550, unit: 'PT' }, height: { magnitude: 310, unit: 'PT' } }, transform: { scaleX: 1, scaleY: 1, translateX: 30, translateY: 75, unit: 'PT' } } } },
        { insertText: { objectId: bodyId, text: comp.body || '' } },
        { updateTextStyle: { objectId: bodyId, textRange: { type: 'ALL' }, style: { fontSize: { magnitude: 11, unit: 'PT' } }, fields: 'fontSize' } }
      );
    });

    const batchRes = await fetch(`https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ requests }),
    });
    const batchData = await batchRes.json();
    if (batchData.error) return res.status(400).json({ error: batchData.error.message || 'Failed to populate slides' });

    res.json({ slidesDeckUrl: `https://docs.google.com/presentation/d/${presentationId}/edit` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API routes — delegate to ES module handlers via dynamic import ─────────────
// Dynamic import lets CommonJS load the ESM api/ handlers without conversion.
// Modules are cached after first load so there's no repeated overhead.
const esHandler = (rel) => async (req, res) => {
  try {
    const mod = await import(rel);
    return mod.default(req, res);
  } catch (err) {
    console.error(`Handler error [${rel}]:`, err);
    res.status(500).json({ error: err.message });
  }
};

app.get('/api/access-log',     esHandler('./api/access-log.js'));
app.post('/api/access-log',    esHandler('./api/access-log.js'));
app.post('/api/assay',         esHandler('./api/assay.js'));
app.post('/api/personas',      esHandler('./api/personas.js'));
app.post('/api/stealth',       esHandler('./api/stealth.js'));
app.post('/api/lookalike',     esHandler('./api/lookalike.js'));
app.post('/api/categorize',    esHandler('./api/categorize.js'));
app.post('/api/email',         esHandler('./api/email.js'));
app.post('/api/learn-voice',   esHandler('./api/learn-voice.js'));
app.post('/api/analyze-voice', esHandler('./api/analyze-voice.js'));
app.post('/api/meetingprep',   esHandler('./api/meetingprep.js'));
app.post('/api/glean',         esHandler('./api/glean.js'));
app.post('/api/glean/people',  esHandler('./api/glean-people.js'));
app.post('/api/gmail-intent',  esHandler('./api/gmail-intent.js'));
// Allow cross-origin requests from Disco Coach (standalone app on any origin)
const handoffCors = (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
};
app.options('/api/handoff', handoffCors);
app.post('/api/handoff', handoffCors, esHandler('./api/handoff.js'));
app.post('/api/sfdc/accounts',             esHandler('./api/sfdc/accounts.js'));
app.post('/api/sfdc/my-accounts',         esHandler('./api/sfdc/my-accounts.js'));
app.post('/api/sfdc/production-request',  esHandler('./api/sfdc/production-request.js'));
app.post('/api/sfdc/update-opp',          esHandler('./api/sfdc/update-opp.js'));
app.post('/api/gmail/draft',              esHandler('./api/gmail/draft.js'));
app.post('/api/hunter/find',              esHandler('./api/hunter/find.js'));
app.post('/api/hunter/domain-search',     esHandler('./api/hunter/domain-search.js'));
app.get('/api/hunter/account',            esHandler('./api/hunter/account.js'));
app.post('/api/databricks/gong-calls',    esHandler('./api/databricks/gong-calls.js'));
app.post('/api/databricks/gong-enrich',  esHandler('./api/databricks/gong-enrich.js'));
app.post('/api/databricks/gong-trends',  esHandler('./api/databricks/gong-trends.js'));
app.post('/api/notify-approved',          esHandler('./api/notify-approved.js'));
app.post('/api/businesses',                    esHandler('./api/businesses/create.js'));
app.get('/api/businesses/:id',                 esHandler('./api/businesses/detail.js'));
app.post('/api/businesses/:id/intel',          esHandler('./api/businesses/intel.js'));
app.post('/api/businesses/:id/retry-research', esHandler('./api/businesses/retry.js'));
app.get('/api/businesses/join/:code',          esHandler('./api/businesses/join.js'));
app.post('/api/businesses/join',                esHandler('./api/businesses/join.js'));
app.post('/api/businesses/:id/intake',          esHandler('./api/businesses/intake.js'));
app.post('/api/businesses/:id/intake/confirm',  esHandler('./api/businesses/intake-confirm.js'));
app.post('/api/businesses/:id/import/classify', esHandler('./api/businesses/import-classify.js'));
app.post('/api/businesses/:id/influencer/assess', esHandler('./api/businesses/influencer-assess.js'));
app.post('/api/businesses/:id/call-log', esHandler('./api/businesses/call-log.js'));
app.post('/api/businesses/:id/call-log/:entryId/reassign', esHandler('./api/businesses/call-log-reassign.js'));
app.post('/api/zoom/webhook', esHandler('./api/zoom/webhook.js'));
app.get('/api/zoom/events', esHandler('./api/zoom/events.js'));
app.post('/api/zoom/events/:eventId/reassign', esHandler('./api/zoom/events-reassign.js'));
app.post('/api/notify-pending', async (req, res) => {
  const { name, email, role } = req.body || {};
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  console.log(`[PENDING] Access request: ${name} (${email}, ${role})`);
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🪙 *New Prospector access request*\n*Name:* ${name}\n*Email:* ${email}\n*Role:* ${role}\nApprove at: https://prospector.onrender.com → Admin tab`,
        }),
      });
    } catch (e) {
      console.warn('[PENDING] Slack notify failed:', e.message);
    }
  }
  res.json({ ok: true });
});

app.post('/api/sfdc/sync-now', async (req, res) => {
  try {
    const { syncAllCompliance } = await import('./api/sfdc/sync-compliance.js');
    const { clientToken, clientInstance } = req.body || {};
    const result = await syncAllCompliance({ clientToken, clientInstance });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[sync-now] failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Serve React build ─────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'build')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'build', 'index.html')));

// ── Error handler — must be last; converts Express body-parse errors to JSON ──
// Without this, malformed/truncated request bodies return an HTML 400 page,
// which the client then fails to parse as JSON.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ── SFDC compliance sync — every 6 hours ─────────────────────────────────────
cron.schedule('0 */6 * * *', async () => {
  console.log('[CRON] Running SFDC compliance sync...');
  try {
    const { syncAllCompliance } = await import('./api/sfdc/sync-compliance.js');
    const result = await syncAllCompliance();
    console.log('[CRON] Sync complete:', result);
  } catch (err) {
    console.error('[CRON] Sync failed:', err.message);
  }
});
console.log('[CRON] SFDC compliance sync scheduled every 6 hours');

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✓ Prospector running on port ${PORT}`));
