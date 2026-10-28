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

const app = express();
app.set('trust proxy', 1); // Render terminates TLS — trust X-Forwarded-Proto
app.use(require('./api/basicAuth.js').basicAuth);
// verify captures the raw request bytes as req.rawBody - needed for webhook
// HMAC signature verification (api/lib/webhookHandler.js), since the
// re-serialized parsed body isn't guaranteed to match what a provider signed.
// Harmless for every other route - nothing else reads req.rawBody.
app.use(express.json({ limit: '20mb', verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); } }));

// prospector-auth-v1 Stage 3 - every /api and /proxy request needs a signed-in
// user (api/lib/requireAuth.js has the exempt list); workspace routes add a
// role check. Mounted before any route so nothing slips past.
const authMw = (name, ...args) => (req, res, next) =>
  import('./api/lib/requireAuth.js').then(m => (args.length ? m[name](...args) : m[name])(req, res, next)).catch(next);
app.use(['/api', '/proxy'], authMw('sessionAuth'));
// Single-tenant integrations on shared credentials (one SFDC org token, one
// Hunter key, one Databricks warehouse) - platform owner until opened up.
app.use(['/api/sfdc', '/api/hunter', '/api/databricks'], authMw('platformOwnerOnly'));
app.use('/api/businesses/:id', authMw('businessGate'));
app.use('/api/sales/:businessId', authMw('salesGate'));
app.use('/api/hk/:businessId', authMw('hkGate'));
app.use('/api/projects/:id', authMw('parentGate', 'projects'));
app.use('/api/campaigns/:id', authMw('parentGate', 'campaigns'));

import('./api/lib/checkCredentials.js').then(({ checkCredentials }) => checkCredentials());

// Routes that call Anthropic server-side share the proxy's per-user hourly
// budget, so a session can't burn credits by looping on them instead.
const aiLimit = authMw('anthropicRateLimit');

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

// ── Anthropic proxy ───────────────────────────────────────────────────────────
app.post('/proxy/anthropic/messages', authMw('anthropicRateLimit'), async (req, res) => {
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
        ...(process.env.JINA_API_KEY ? { 'Authorization': `Bearer ${process.env.JINA_API_KEY}` } : {}),
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

// The signed-in user's Google access token, minted server-side from their
// stored grant (api/lib/googleGrants.js); null after a 409/500 was sent.
const googleToken = (req, res, feature) =>
  import('./api/lib/googleGrants.js').then(m => m.googleTokenFor(req, res, feature));

// ── Gmail search proxies ──────────────────────────────────────────────────────
app.get('/proxy/gmail/messages', async (req, res) => {
  const token = await googleToken(req, res, 'gmail');
  if (!token) return;
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
  const token = await googleToken(req, res, 'gmail');
  if (!token) return;
  try {
    const r = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${req.params.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    res.json(await r.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/proxy/gmail/message/:id/body', async (req, res) => {
  const token = await googleToken(req, res, 'gmail');
  if (!token) return;
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
  const token = await googleToken(req, res, 'calendar');
  if (!token) return;
  const { timeMin, timeMax } = req.query;
  try {
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=50`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    res.json(await r.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Google OAuth (per feature, stored server-side) ────────────────────────────
app.get('/api/google/connect',    esHandler('./api/google/connect.js'));
app.get('/api/gmail/callback',    esHandler('./api/google/callback.js'));
app.get('/api/google/status',     esHandler('./api/google/status.js'));
app.post('/api/google/disconnect', esHandler('./api/google/disconnect.js'));
// mailbox-connections-v1 REV2 (M5) - the caller's Google accounts, workspace tethers and the map's data.
app.get('/api/mailboxes',                 esHandler('./api/mailboxes.js'));
app.put('/api/mailboxes/link',            esHandler('./api/mailboxes.js'));
app.delete('/api/mailboxes/link',         esHandler('./api/mailboxes.js'));
app.post('/api/mailboxes/default',        esHandler('./api/mailboxes.js'));
app.delete('/api/mailboxes/accounts/:id', esHandler('./api/mailboxes.js'));
app.get('/api/microsoft/connect',     esHandler('./api/microsoft/connect.js'));
app.get('/api/microsoft/callback',    esHandler('./api/microsoft/callback.js'));
app.get('/api/microsoft/status',      esHandler('./api/microsoft/status.js'));
app.post('/api/microsoft/check',      esHandler('./api/microsoft/check.js'));
app.post('/api/microsoft/disconnect', esHandler('./api/microsoft/disconnect.js'));
app.post('/api/microsoft/sync',         esHandler('./api/microsoft/sync.js'));
app.get('/api/microsoft/sync-summary',  esHandler('./api/microsoft/sync-summary.js'));

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
    // Fragment, not query: browsers never send it to the server, so tokens stay
    // out of Render's request logs and Referer headers.
    res.redirect(`/#${params}`);
  } catch (err) { res.redirect(`/?sfdc_error=${encodeURIComponent(err.message)}`); }
});

// ── Google Slides export ──────────────────────────────────────────────────────
app.post('/api/slides/create', async (req, res) => {
  const { components, accountName } = req.body;
  if (!components?.length) return res.status(400).json({ error: 'No components provided' });
  const accessToken = await googleToken(req, res, 'slides');
  if (!accessToken) return;
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

app.get('/api/access-log',     authMw('platformOwnerOnly'), esHandler('./api/access-log.js'));
app.get('/api/me',                       esHandler('./api/me.js'));
app.post('/api/me/welcome',              esHandler('./api/me.js'));
app.get('/api/invites/:token',           esHandler('./api/invites.js'));
app.post('/api/invites/:token/accept',   esHandler('./api/invites.js'));
app.post('/api/personas',      aiLimit, esHandler('./api/personas.js'));
app.post('/api/stealth',       aiLimit, esHandler('./api/stealth.js'));
app.post('/api/lookalike',     aiLimit, esHandler('./api/lookalike.js'));
app.post('/api/categorize',    aiLimit, esHandler('./api/categorize.js'));
app.post('/api/email',         aiLimit, esHandler('./api/email.js'));
app.post('/api/learn-voice',   aiLimit, esHandler('./api/learn-voice.js'));
app.post('/api/analyze-voice', aiLimit, esHandler('./api/analyze-voice.js'));
app.post('/api/meetingprep',   aiLimit, esHandler('./api/meetingprep.js'));
app.post('/api/glean',         esHandler('./api/glean.js'));
app.post('/api/glean/people',  esHandler('./api/glean-people.js'));
app.post('/api/gmail-intent',  esHandler('./api/gmail-intent.js'));
app.post('/api/sfdc/accounts',             esHandler('./api/sfdc/accounts.js'));
app.post('/api/sfdc/my-accounts',         esHandler('./api/sfdc/my-accounts.js'));
app.post('/api/sfdc/production-request',  esHandler('./api/sfdc/production-request.js'));
app.post('/api/sfdc/update-opp',          esHandler('./api/sfdc/update-opp.js'));
app.post('/api/gmail/draft',              esHandler('./api/gmail/draft.js'));
app.get('/api/hk/:businessId/shell',      esHandler('./api/hk/shell.js'));
// hkos-data-foundation-v1 D4 - brands / contacts / sponsors / review / activity / settings / prefs (hkGate already ran:
// viewer = GET, member = writes; owner-role checks live inside the routes). brands/check before brands/:id on purpose.
const hkRoute = (file, name) => async (req, res) => {
  try { const mod = await import(file); return mod[name](req, res); }
  catch (err) { console.error(`[hk/${name}] handler error:`, err); res.status(500).json({ error: err.message }); }
};
const HK_BRANDS = './api/hk/brandsRoutes.js', HK_OPS = './api/hk/opsRoutes.js';
app.get('/api/hk/:businessId/brands',                         hkRoute(HK_BRANDS, 'listBrandsRoute'));
app.post('/api/hk/:businessId/brands/check',                  hkRoute(HK_BRANDS, 'checkBrandsRoute'));
app.post('/api/hk/:businessId/brands',                        hkRoute(HK_BRANDS, 'createBrandRoute'));
app.get('/api/hk/:businessId/brands/:id',                     hkRoute(HK_BRANDS, 'getBrandRoute'));
app.patch('/api/hk/:businessId/brands/:id',                   hkRoute(HK_BRANDS, 'patchBrandRoute'));
app.get('/api/hk/:businessId/brands/:id/contacts',            hkRoute(HK_BRANDS, 'listContactsRoute'));
app.post('/api/hk/:businessId/brands/:id/contacts',           hkRoute(HK_BRANDS, 'createContactRoute'));
app.patch('/api/hk/:businessId/brands/:id/contacts/:cid',     hkRoute(HK_BRANDS, 'patchContactRoute'));
app.get('/api/hk/:businessId/sponsors',                       hkRoute(HK_OPS, 'sponsorsRoute'));
app.post('/api/hk/:businessId/sponsors/:brandId/periods',     hkRoute(HK_OPS, 'addPeriodRoute'));
app.delete('/api/hk/:businessId/sponsors/:brandId/periods/:pid', hkRoute(HK_OPS, 'deletePeriodRoute'));
app.get('/api/hk/:businessId/review/duplicates',              hkRoute(HK_OPS, 'duplicatesRoute'));
app.post('/api/hk/:businessId/review/duplicates/decide',      hkRoute(HK_OPS, 'decideDuplicateRoute'));
app.get('/api/hk/:businessId/review/warnings',                hkRoute(HK_OPS, 'warningsRoute'));
app.get('/api/hk/:businessId/activity',                       hkRoute(HK_OPS, 'activityRoute'));
app.get('/api/hk/:businessId/settings',                       hkRoute(HK_OPS, 'getSettingsRoute'));
app.patch('/api/hk/:businessId/settings',                     hkRoute(HK_OPS, 'patchSettingsRoute'));
app.post('/api/hk/:businessId/settings/confirm-stats',        hkRoute(HK_OPS, 'confirmStatsRoute'));
app.get('/api/hk/:businessId/me/prefs',                       hkRoute(HK_OPS, 'getPrefsRoute'));
app.patch('/api/hk/:businessId/me/prefs',                     hkRoute(HK_OPS, 'patchPrefsRoute'));
// hkos-gmail-connect-v1 (G3-G7) - drafts into the tethered mailbox, sync, replies, status. No send path anywhere.
const HK_GMAIL = './api/hk/gmailRoutes.js';
app.get('/api/hk/:businessId/drafts',                         hkRoute(HK_GMAIL, 'listDraftsRoute'));
app.post('/api/hk/:businessId/drafts',                        hkRoute(HK_GMAIL, 'createDraftRoute'));
app.post('/api/hk/:businessId/drafts/lint',                   hkRoute(HK_GMAIL, 'lintPreviewRoute'));
app.get('/api/hk/:businessId/drafts/:touchId',                hkRoute(HK_GMAIL, 'previewDraftRoute'));
app.post('/api/hk/:businessId/drafts/:touchId/lint',          hkRoute(HK_GMAIL, 'relintDraftRoute'));
app.delete('/api/hk/:businessId/drafts/:touchId',             hkRoute(HK_GMAIL, 'discardDraftRoute'));
app.post('/api/hk/:businessId/sync',                          hkRoute(HK_GMAIL, 'syncRoute'));
app.get('/api/hk/:businessId/replies',                        hkRoute(HK_GMAIL, 'listRepliesRoute'));
app.patch('/api/hk/:businessId/replies/:id',                  hkRoute(HK_GMAIL, 'patchReplyRoute'));
app.get('/api/hk/:businessId/gmail/status',                   hkRoute(HK_GMAIL, 'gmailStatusRoute'));
app.patch('/api/hk/:businessId/gmail/signature',              hkRoute(HK_GMAIL, 'patchSignatureRoute'));
// hkos-sheet-import-v1 S1 - preview writes only the run row; commit / undo need the owner role (checked inside).
const HK_IMPORTS = './api/hk/importRoutes.js';
app.get('/api/hk/:businessId/imports',                        hkRoute(HK_IMPORTS, 'listImportsRoute'));
app.post('/api/hk/:businessId/imports/preview',               hkRoute(HK_IMPORTS, 'previewImportRoute'));
app.post('/api/hk/:businessId/imports/:id/commit',            hkRoute(HK_IMPORTS, 'commitImportRoute'));
app.post('/api/hk/:businessId/imports/:id/undo',              hkRoute(HK_IMPORTS, 'undoImportRoute'));
// hkos-daily-check-v1 J2 - jobs: page load (any member), Today's read, runs; daily check / sync all / test digest (owner).
const HK_JOBS = './api/hk/jobsRoutes.js';
app.post('/api/hk/:businessId/jobs/pageload',                 hkRoute(HK_JOBS, 'pageloadRoute'));
app.post('/api/hk/:businessId/jobs/daily-check',              hkRoute(HK_JOBS, 'dailyCheckRoute'));
app.post('/api/hk/:businessId/jobs/gmail-sync-all',           hkRoute(HK_JOBS, 'syncAllRoute'));
app.post('/api/hk/:businessId/jobs/test-digest',              hkRoute(HK_JOBS, 'testDigestRoute'));
app.get('/api/hk/:businessId/jobs/today',                     hkRoute(HK_JOBS, 'todayRoute'));
app.get('/api/hk/:businessId/jobs/runs',                      hkRoute(HK_JOBS, 'runsRoute'));
app.post('/api/hk/:businessId/jobs/retry-draft',              hkRoute(HK_JOBS, 'retryDraftRoute'));
app.post('/api/hk/:businessId/jobs/skip-touch',               hkRoute(HK_JOBS, 'skipTouchRoute'));
app.post('/api/hk/:businessId/drafts/:touchId/dm-sent',       hkRoute(HK_JOBS, 'dmSentRoute'));
// hkos-inbox-v1 I1 - the caller's own tethered mailbox, read live; member+ inside the routes (a viewer has no mailbox).
const HK_INBOX = './api/hk/inboxRoutes.js';
app.get('/api/hk/:businessId/inbox/threads',                  hkRoute(HK_INBOX, 'listThreadsRoute'));
app.get('/api/hk/:businessId/inbox/threads/:id',              hkRoute(HK_INBOX, 'openThreadRoute'));
app.post('/api/hk/:businessId/inbox/threads/:id/link',        hkRoute(HK_INBOX, 'linkThreadRoute'));
app.post('/api/hk/:businessId/inbox/track',                   hkRoute(HK_INBOX, 'trackRoute'));
app.get('/api/hk/:businessId/inbox/ignore',                   hkRoute(HK_INBOX, 'listIgnoredRoute'));
app.post('/api/hk/:businessId/inbox/ignore',                  hkRoute(HK_INBOX, 'ignoreRoute'));
app.delete('/api/hk/:businessId/inbox/ignore/:domain',        hkRoute(HK_INBOX, 'unignoreRoute'));
app.post('/api/hunter/find',              esHandler('./api/hunter/find.js'));
app.post('/api/hunter/domain-search',     esHandler('./api/hunter/domain-search.js'));
app.get('/api/hunter/account',            esHandler('./api/hunter/account.js'));
app.post('/api/databricks/gong-calls',    esHandler('./api/databricks/gong-calls.js'));
app.post('/api/databricks/gong-enrich',  aiLimit, esHandler('./api/databricks/gong-enrich.js'));
app.post('/api/databricks/gong-trends',  aiLimit, esHandler('./api/databricks/gong-trends.js'));
app.post('/api/businesses',                    authMw('platformOwnerOnly'), aiLimit, esHandler('./api/businesses/create.js'));
app.get('/api/businesses/:id',                 esHandler('./api/businesses/detail.js'));
app.get('/api/businesses/:id/members',                    esHandler('./api/businesses/members.js'));
app.patch('/api/businesses/:id/members/:memberId',        esHandler('./api/businesses/members.js'));
app.delete('/api/businesses/:id/members/:memberId',       esHandler('./api/businesses/members.js'));
app.post('/api/businesses/:id/invites',                   esHandler('./api/businesses/member-invites.js'));
app.post('/api/businesses/:id/invites/:inviteId/:action', esHandler('./api/businesses/member-invites.js'));
app.get('/api/workspaces/members', authMw('platformOwnerOnly'), esHandler('./api/businesses/members-overview.js'));
app.get('/api/businesses/:id/status',          esHandler('./api/businesses/status.js'));
app.post('/api/businesses/:id/intel',          aiLimit, esHandler('./api/businesses/intel.js'));
app.post('/api/businesses/:id/retry-research', aiLimit, esHandler('./api/businesses/retry.js'));
app.post('/api/businesses/:id/intake',          aiLimit, esHandler('./api/businesses/intake.js'));
app.post('/api/businesses/:id/intake/confirm',  aiLimit, esHandler('./api/businesses/intake-confirm.js'));
app.post('/api/businesses/:id/import/classify', aiLimit, esHandler('./api/businesses/import-classify.js'));
app.post('/api/businesses/:id/import/directive', aiLimit, esHandler('./api/businesses/import-directive.js'));
app.post('/api/businesses/:id/influencer/assess', aiLimit, esHandler('./api/businesses/influencer-assess.js'));
app.post('/api/businesses/:id/assay-criteria/generate', aiLimit, esHandler('./api/businesses/assay-criteria-generate.js'));
app.put('/api/businesses/:id/assay-criteria',   esHandler('./api/businesses/assay-criteria-save.js'));
app.get('/api/businesses/:id/assay-criteria',   esHandler('./api/businesses/assay-criteria-get.js'));
app.put('/api/businesses/:id/profile-field',    esHandler('./api/businesses/profile-field-save.js'));
app.put('/api/businesses/:id/emoji',            esHandler('./api/businesses/emoji-save.js'));
app.put('/api/businesses/:id/features', authMw('platformOwnerOnly'), esHandler('./api/businesses/features-save.js'));
app.post('/api/businesses/:id/profile-field/resolve-conflict', esHandler('./api/businesses/profile-field-resolve-conflict.js'));
app.put('/api/businesses/:id/social-links',     aiLimit, esHandler('./api/businesses/social-links-save.js'));
app.put('/api/businesses/:id/website-url',      esHandler('./api/businesses/website-url-save.js'));
app.post('/api/businesses/:id/profile-refresh', aiLimit, esHandler('./api/businesses/profile-refresh.js'));
app.post('/api/businesses/:id/outreach-rules/generate', aiLimit, esHandler('./api/businesses/outreach-rules-generate.js'));
app.put('/api/businesses/:id/outreach-rules',   esHandler('./api/businesses/outreach-rules-save.js'));
app.put('/api/businesses/:id/sales-methodology', esHandler('./api/businesses/sales-methodology-save.js'));
app.get('/api/businesses/:id/outreach-rules',   esHandler('./api/businesses/outreach-rules-get.js'));
app.post('/api/projects/:id/outreach-examples/generate', aiLimit, esHandler('./api/projects/outreach-examples-generate.js'));
app.put('/api/projects/:id/outreach-examples-distilled', esHandler('./api/projects/outreach-examples-save.js'));
app.post('/api/projects/:id/outreach-examples/segment', aiLimit, esHandler('./api/projects/outreach-examples-segment.js'));
app.post('/api/campaigns/:id/outreach-examples/generate', aiLimit, esHandler('./api/campaigns/outreach-examples-generate.js'));
app.put('/api/campaigns/:id/outreach-examples-distilled', esHandler('./api/campaigns/outreach-examples-save.js'));
app.post('/api/campaigns/:id/outreach-examples/segment', aiLimit, esHandler('./api/campaigns/outreach-examples-segment.js'));
app.post('/api/projects/:id/extract-fields', aiLimit, esHandler('./api/projects/extract-fields.js'));
app.post('/api/campaigns/:id/extract-fields', aiLimit, esHandler('./api/campaigns/extract-fields.js'));
app.post('/api/businesses/:id/call-log', aiLimit, esHandler('./api/businesses/call-log.js'));
app.post('/api/businesses/:id/call-log/:entryId/reassign', esHandler('./api/businesses/call-log-reassign.js'));
app.post('/api/zoom/webhook', esHandler('./api/zoom/webhook.js'));
app.get('/api/zoom/events', authMw('platformOwnerOnly'), esHandler('./api/zoom/events.js'));
app.post('/api/zoom/events/:eventId/reassign', authMw('platformOwnerOnly'), esHandler('./api/zoom/events-reassign.js'));

// sales-analytics-core-v1 - not wired through esHandler since routes.js
// exports three named functions, not one default (esHandler always calls
// mod.default). Same dynamic-import-per-request pattern as esHandler
// otherwise, mirroring how the SFDC cron job below already loads
// sync-compliance.js's named export.
app.post('/api/sales/:businessId/sync', async (req, res) => {
  try {
    const { syncRoute } = await import('./api/sales/routes.js');
    return syncRoute(req, res);
  } catch (err) {
    console.error('[sales/sync] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/sales/:businessId/sync/pageload', async (req, res) => {
  try {
    const { pageloadSyncRoute } = await import('./api/sales/routes.js');
    return pageloadSyncRoute(req, res);
  } catch (err) {
    console.error('[sales/sync/pageload] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/sales/:businessId/runs', async (req, res) => {
  try {
    const { runsRoute } = await import('./api/sales/routes.js');
    return runsRoute(req, res);
  } catch (err) {
    console.error('[sales/runs] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/sales/:businessId/metrics', async (req, res) => {
  try {
    const { metricsRoute } = await import('./api/sales/routes.js');
    return metricsRoute(req, res);
  } catch (err) {
    console.error('[sales/metrics] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/sales/:businessId/entities', async (req, res) => {
  try {
    const { entitiesRoute } = await import('./api/sales/routes.js');
    return entitiesRoute(req, res);
  } catch (err) {
    console.error('[sales/entities] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/sales/:businessId/sequence-tags', async (req, res) => {
  try {
    const { sequenceTagsRoute } = await import('./api/sales/routes.js');
    return sequenceTagsRoute(req, res);
  } catch (err) {
    console.error('[sales/sequence-tags] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.put('/api/sales/:businessId/sequence-tags/:sequenceId', async (req, res) => {
  try {
    const { putSequenceTagRoute } = await import('./api/sales/routes.js');
    return putSequenceTagRoute(req, res);
  } catch (err) {
    console.error('[sales/sequence-tags/:id] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/sales/:businessId/cohort-breakdown', async (req, res) => {
  try {
    const { cohortBreakdownRoute } = await import('./api/sales/routes.js');
    return cohortBreakdownRoute(req, res);
  } catch (err) {
    console.error('[sales/cohort-breakdown] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

// sales-pipeline-v1 - same dynamic-import-per-request pattern as the
// sales analytics routes above. Order matters here: Express matches
// '/opportunities/:id' before more specific literal paths registered
// later, so the three literal sub-paths (template, import, movement) are
// registered BEFORE '/opportunities/:id' to avoid 'template'/'import'/
// 'movement' being parsed as an :id.
app.get('/api/sales/:businessId/opportunities/template', async (req, res) => {
  try {
    const { opportunityTemplateRoute } = await import('./api/sales/pipelineRoutes.js');
    return opportunityTemplateRoute(req, res);
  } catch (err) {
    console.error('[sales/opportunities/template] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/sales/:businessId/opportunities/import', async (req, res) => {
  try {
    const { importOpportunitiesRoute } = await import('./api/sales/pipelineRoutes.js');
    return importOpportunitiesRoute(req, res);
  } catch (err) {
    console.error('[sales/opportunities/import] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/sales/:businessId/opportunities/movement', async (req, res) => {
  try {
    const { movementRoute } = await import('./api/sales/pipelineRoutes.js');
    return movementRoute(req, res);
  } catch (err) {
    console.error('[sales/opportunities/movement] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/sales/:businessId/opportunities', async (req, res) => {
  try {
    const { listOpportunitiesRoute } = await import('./api/sales/pipelineRoutes.js');
    return listOpportunitiesRoute(req, res);
  } catch (err) {
    console.error('[sales/opportunities] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/sales/:businessId/opportunities', async (req, res) => {
  try {
    const { createOpportunityRoute } = await import('./api/sales/pipelineRoutes.js');
    return createOpportunityRoute(req, res);
  } catch (err) {
    console.error('[sales/opportunities POST] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.patch('/api/sales/:businessId/opportunities/:id', async (req, res) => {
  try {
    const { updateOpportunityRoute } = await import('./api/sales/pipelineRoutes.js');
    return updateOpportunityRoute(req, res);
  } catch (err) {
    console.error('[sales/opportunities/:id PATCH] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/sales/:businessId/opportunities/:id/archive', async (req, res) => {
  try {
    const { archiveOpportunityRoute } = await import('./api/sales/pipelineRoutes.js');
    return archiveOpportunityRoute(req, res);
  } catch (err) {
    console.error('[sales/opportunities/:id/archive] handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

// sales-hot-prospects-v1 / sales-email-trend-v1 - same dynamic-import-per-
// request pattern, for modules that export several named handlers.
const salesModuleRoute = (file, name, label) => async (req, res) => {
  try {
    const mod = await import(file);
    return mod[name](req, res);
  } catch (err) {
    console.error(`[sales/${label}] handler error:`, err);
    res.status(500).json({ error: err.message });
  }
};
app.get('/api/sales/:businessId/huddle', salesModuleRoute('./api/sales/huddleRoutes.js', 'huddleRoute', 'huddle'));
app.get('/api/sales/:businessId/huddle/feed', salesModuleRoute('./api/sales/huddleRoutes.js', 'huddleFeedRoute', 'huddle/feed'));
app.get('/api/sales/:businessId/huddle/live', salesModuleRoute('./api/sales/huddleLive.js', 'liveRoute', 'huddle/live'));
app.get('/api/sales/:businessId/huddle/flags', salesModuleRoute('./api/sales/huddleFlags.js', 'listFlagsRoute', 'huddle/flags'));
app.post('/api/sales/:businessId/prospects/:contactId/flag', salesModuleRoute('./api/sales/huddleFlags.js', 'flagProspectRoute', 'prospects/:contactId/flag POST'));
app.delete('/api/sales/:businessId/flags/:goalId', salesModuleRoute('./api/sales/huddleFlags.js', 'unflagRoute', 'flags/:goalId DELETE'));
app.post('/api/sales/:businessId/flags/:goalId/reassign', salesModuleRoute('./api/sales/huddleFlags.js', 'reassignFlagRoute', 'flags/:goalId/reassign POST'));
app.post('/api/sales/:businessId/flags/:goalId/drop', salesModuleRoute('./api/sales/huddleFlags.js', 'dropFlagRoute', 'flags/:goalId/drop POST'));
app.post('/api/sales/:businessId/flags/:goalId/complete', salesModuleRoute('./api/sales/huddleFlags.js', 'completeFlagRoute', 'flags/:goalId/complete POST'));
app.post('/api/sales/:businessId/huddles', salesModuleRoute('./api/sales/huddleRoutes.js', 'startHuddleRoute', 'huddles'));
app.patch('/api/sales/:businessId/prospects/:contactId', salesModuleRoute('./api/sales/huddleRoutes.js', 'updateProspectRoute', 'prospects/:contactId'));
app.post('/api/sales/:businessId/prospects/:contactId/pipeline', salesModuleRoute('./api/sales/huddleRoutes.js', 'addToPipelineRoute', 'prospects/:contactId/pipeline'));
app.post('/api/sales/:businessId/prospects/:contactId/unlink', salesModuleRoute('./api/sales/prospectLinks.js', 'unlinkProspectRoute', 'prospects/:contactId/unlink POST'));
app.get('/api/sales/:businessId/collateral', salesModuleRoute('./api/sales/huddleRoutes.js', 'listCollateralRoute', 'collateral'));
app.post('/api/sales/:businessId/collateral', salesModuleRoute('./api/sales/huddleRoutes.js', 'createCollateralRoute', 'collateral POST'));
app.patch('/api/sales/:businessId/collateral/:id', salesModuleRoute('./api/sales/huddleRoutes.js', 'updateCollateralRoute', 'collateral/:id'));
app.delete('/api/sales/:businessId/collateral/:id', salesModuleRoute('./api/sales/huddleRoutes.js', 'deleteCollateralRoute', 'collateral/:id DELETE'));
app.get('/api/sales/:businessId/email-counts', salesModuleRoute('./api/sales/trendRoutes.js', 'emailCountsRoute', 'email-counts'));
app.get('/api/sales/:businessId/events', salesModuleRoute('./api/sales/trendRoutes.js', 'listEventsRoute', 'events'));
app.post('/api/sales/:businessId/events', salesModuleRoute('./api/sales/trendRoutes.js', 'createEventRoute', 'events POST'));
app.get('/api/sales/:businessId/insights', salesModuleRoute('./api/sales/trendRoutes.js', 'insightsRoute', 'insights'));
app.get('/api/sales/:businessId/week-strip', salesModuleRoute('./api/sales/weekStripRoutes.js', 'weekStripRoute', 'week-strip'));
app.get('/api/sales/:businessId/bounces', salesModuleRoute('./api/sales/weekStripRoutes.js', 'bouncesRoute', 'bounces'));
app.post('/api/sales/:businessId/insights/dismiss', salesModuleRoute('./api/sales/trendRoutes.js', 'dismissInsightRoute', 'insights/dismiss'));
// sales-goals-v1 REVISION 3 - Goals & Weekly Plan.
app.get('/api/sales/:businessId/goals/members', salesModuleRoute('./api/sales/goalsRoutes.js', 'listGoalMembersRoute', 'goals/members'));
app.get('/api/sales/:businessId/goals/land', salesModuleRoute('./api/sales/goalsRoutes.js', 'listLandGoalsRoute', 'goals/land'));
app.post('/api/sales/:businessId/goals/land', aiLimit, salesModuleRoute('./api/sales/goalsRoutes.js', 'createLandGoalRoute', 'goals/land POST'));
app.patch('/api/sales/:businessId/goals/land/:id', salesModuleRoute('./api/sales/goalsRoutes.js', 'updateLandGoalRoute', 'goals/land/:id PATCH'));
app.post('/api/sales/:businessId/goals/land/:id/archive', salesModuleRoute('./api/sales/goalsRoutes.js', 'archiveLandGoalRoute', 'goals/land/:id/archive POST'));
app.get('/api/sales/:businessId/goals/month', salesModuleRoute('./api/sales/goalsRoutes.js', 'listMonthGoalsRoute', 'goals/month'));
app.post('/api/sales/:businessId/goals/month', salesModuleRoute('./api/sales/goalsRoutes.js', 'createMonthGoalRoute', 'goals/month POST'));
app.patch('/api/sales/:businessId/goals/month/:id', salesModuleRoute('./api/sales/goalsRoutes.js', 'updateMonthGoalRoute', 'goals/month/:id PATCH'));
app.delete('/api/sales/:businessId/goals/month/:id', salesModuleRoute('./api/sales/goalsRoutes.js', 'deleteMonthGoalRoute', 'goals/month/:id DELETE'));
app.get('/api/sales/:businessId/goals/week', salesModuleRoute('./api/sales/goalsRoutes.js', 'listWeekGoalsRoute', 'goals/week'));
app.get('/api/sales/:businessId/goals/tasks', salesModuleRoute('./api/sales/goalsRoutes.js', 'listLinkedTasksRoute', 'goals/tasks'));
app.post('/api/sales/:businessId/goals/week', salesModuleRoute('./api/sales/goalsRoutes.js', 'createWeekGoalRoute', 'goals/week POST'));
app.post('/api/sales/:businessId/goals/week/carry-over', salesModuleRoute('./api/sales/goalsRoutes.js', 'carryOverWeekGoalsRoute', 'goals/week/carry-over POST'));
// weekly-plan-v1 - "Plan this week" (before goals/week/:id).
app.post('/api/sales/:businessId/goals/week/plan/propose', aiLimit, salesModuleRoute('./api/sales/weekPlanRoutes.js', 'proposeWeekPlanRoute', 'goals/week/plan/propose POST'));
app.post('/api/sales/:businessId/goals/week/plan/save', salesModuleRoute('./api/sales/weekPlanRoutes.js', 'saveWeekPlanRoute', 'goals/week/plan/save POST'));
app.get('/api/sales/:businessId/goals/week/plan', salesModuleRoute('./api/sales/weekPlanRoutes.js', 'getWeekPlanRoute', 'goals/week/plan'));
app.get('/api/sales/:businessId/goals/week/plans', salesModuleRoute('./api/sales/weekPlanRoutes.js', 'listWeekPlansRoute', 'goals/week/plans'));
app.patch('/api/sales/:businessId/goals/week/:id', salesModuleRoute('./api/sales/goalsRoutes.js', 'updateWeekGoalRoute', 'goals/week/:id PATCH'));
app.delete('/api/sales/:businessId/goals/week/:id', salesModuleRoute('./api/sales/goalsRoutes.js', 'deleteWeekGoalRoute', 'goals/week/:id DELETE'));
app.get('/api/sales/:businessId/goals/notes', salesModuleRoute('./api/sales/goalsRoutes.js', 'listWeekNotesRoute', 'goals/notes'));
app.put('/api/sales/:businessId/goals/notes/:weekStart', salesModuleRoute('./api/sales/goalsRoutes.js', 'saveWeekNoteRoute', 'goals/notes/:weekStart PUT'));
app.post('/api/sales/:businessId/goals/week/:id/steps', salesModuleRoute('./api/sales/goalsRoutes.js', 'createStepRoute', 'goals/week/:id/steps POST'));
app.patch('/api/sales/:businessId/goals/steps/:id', salesModuleRoute('./api/sales/goalsRoutes.js', 'updateStepRoute', 'goals/steps/:id PATCH'));
app.delete('/api/sales/:businessId/goals/steps/:id', salesModuleRoute('./api/sales/goalsRoutes.js', 'deleteStepRoute', 'goals/steps/:id DELETE'));
app.get('/api/sales/:businessId/goals/cadences', salesModuleRoute('./api/sales/goalsRoutes.js', 'listCadencesRoute', 'goals/cadences'));
app.post('/api/sales/:businessId/goals/cadences', salesModuleRoute('./api/sales/goalsRoutes.js', 'createCadenceRoute', 'goals/cadences POST'));
app.patch('/api/sales/:businessId/goals/cadences/:id', salesModuleRoute('./api/sales/goalsRoutes.js', 'updateCadenceRoute', 'goals/cadences/:id PATCH'));
app.delete('/api/sales/:businessId/goals/cadences/:id', salesModuleRoute('./api/sales/goalsRoutes.js', 'deleteCadenceRoute', 'goals/cadences/:id DELETE'));
app.post('/api/sales/:businessId/goals/call-notes/extract', aiLimit, salesModuleRoute('./api/sales/callNotesRoutes.js', 'extractCallNotesRoute', 'goals/call-notes/extract POST'));
app.post('/api/sales/:businessId/goals/call-notes', salesModuleRoute('./api/sales/callNotesRoutes.js', 'createFromCallNotesRoute', 'goals/call-notes POST'));
// lead-upload-v1 - paste a lead list -> review -> File (companies + people + source).
app.post('/api/sales/:businessId/goals/leads/extract', aiLimit, salesModuleRoute('./api/sales/leadUploadRoutes.js', 'extractLeadsRoute', 'goals/leads/extract'));
app.post('/api/sales/:businessId/goals/leads', salesModuleRoute('./api/sales/leadUploadRoutes.js', 'fileLeadsRoute', 'goals/leads POST'));
app.get('/api/sales/:businessId/goals/call-notes/:id', salesModuleRoute('./api/sales/callNotesRoutes.js', 'getCallNoteRoute', 'goals/call-notes/:id'));
app.get('/api/sales/:businessId/goals/prospect-targets', salesModuleRoute('./api/sales/targetsRoutes.js', 'listProspectTargetsRoute', 'goals/prospect-targets'));
app.post('/api/sales/:businessId/goals/prospect-targets/:id/promote', salesModuleRoute('./api/sales/targetsRoutes.js', 'promoteTargetRoute', 'goals/prospect-targets/:id/promote POST'));
app.post('/api/sales/:businessId/goals/prospect-targets/:id/reject', salesModuleRoute('./api/sales/targetsRoutes.js', 'rejectTargetRoute', 'goals/prospect-targets/:id/reject POST'));
// signals-v1 Stage 2 - Signal Scout import + the Signals review queue.
app.get('/api/sales/:businessId/goals/signals', salesModuleRoute('./api/sales/signalsRoutes.js', 'listSignalsRoute', 'goals/signals'));
app.post('/api/sales/:businessId/goals/signals/scout-import', salesModuleRoute('./api/sales/signalsRoutes.js', 'scoutImportRoute', 'goals/signals/scout-import POST'));
app.post('/api/sales/:businessId/goals/signals/:id/accept', salesModuleRoute('./api/sales/signalsRoutes.js', 'acceptSignalRoute', 'goals/signals/:id/accept POST'));
app.post('/api/sales/:businessId/goals/signals/:id/dismiss', salesModuleRoute('./api/sales/signalsRoutes.js', 'dismissSignalRoute', 'goals/signals/:id/dismiss POST'));
app.post('/api/sales/:businessId/goals/signals/:id/undo', salesModuleRoute('./api/sales/signalsRoutes.js', 'undoSignalRoute', 'goals/signals/:id/undo POST'));
// signals-v1 Stage 4 - the daily website-visitor pull (page load / Pull now) and its status.
app.post('/api/sales/:businessId/goals/visits/pull', salesModuleRoute('./api/sales/visitPull.js', 'runVisitPullRoute', 'goals/visits/pull POST'));
app.get('/api/sales/:businessId/goals/visits/status', salesModuleRoute('./api/sales/visitPull.js', 'visitStatusRoute', 'goals/visits/status'));
// signals-v1 Stage 5 - the Website visitors report, Brad's .xlsx, and the skip list.
app.get('/api/sales/:businessId/goals/visits/report', salesModuleRoute('./api/sales/visitReport.js', 'visitReportRoute', 'goals/visits/report'));
app.get('/api/sales/:businessId/goals/visits/export', salesModuleRoute('./api/sales/visitReport.js', 'visitExportRoute', 'goals/visits/export'));
app.get('/api/sales/:businessId/goals/visits/skip', salesModuleRoute('./api/sales/visitReport.js', 'listSkipRoute', 'goals/visits/skip'));
app.post('/api/sales/:businessId/goals/visits/skip', salesModuleRoute('./api/sales/visitReport.js', 'addSkipRoute', 'goals/visits/skip POST'));
app.delete('/api/sales/:businessId/goals/visits/skip/:id', salesModuleRoute('./api/sales/visitReport.js', 'removeSkipRoute', 'goals/visits/skip DELETE'));
app.post('/api/sales/:businessId/goals/visits/priority', salesModuleRoute('./api/sales/visitPriority.js', 'setVisitPriorityRoute', 'goals/visits/priority POST'));
// visitor-to-record-v1 Stage 2 - a visit builds the company (on demand from Signals), Apollo's Visited People export, the People search.
app.post('/api/sales/:businessId/goals/signals/:id/auto-create', salesModuleRoute('./api/sales/visitorRoutes.js', 'autoCreateSignalRoute', 'goals/signals/:id/auto-create POST'));
app.post('/api/sales/:businessId/goals/visits/people-csv', salesModuleRoute('./api/sales/visitorRoutes.js', 'uploadVisitedPeopleRoute', 'goals/visits/people-csv POST'));
app.post('/api/sales/:businessId/goals/visits/people-pull', salesModuleRoute('./api/sales/visitorPeoplePull.js', 'runVisitorPeoplePullRoute', 'goals/visits/people-pull POST'));
app.get('/api/sales/:businessId/goals/people', salesModuleRoute('./api/sales/visitorRoutes.js', 'peopleSearchRoute', 'goals/people'));
app.post('/api/sales/:businessId/goals/people/:id/add-record', salesModuleRoute('./api/sales/visitorRoutes.js', 'addRecordFromPersonRoute', 'goals/people/:id/add-record POST'));
// intent-score-v1 Stage 2 - the ranked scores (filters), Recompute now (owner / admin; one company for a Member), the CSV, the Brief.
app.get('/api/sales/:businessId/goals/scores', salesModuleRoute('./api/sales/scoresRoutes.js', 'listScoresRoute', 'goals/scores'));
app.post('/api/sales/:businessId/goals/scores/recompute', salesModuleRoute('./api/sales/scoresRoutes.js', 'recomputeRoute', 'goals/scores/recompute POST'));
app.get('/api/sales/:businessId/goals/scores/export.csv', salesModuleRoute('./api/sales/scoresRoutes.js', 'exportScoresRoute', 'goals/scores/export.csv'));
app.get('/api/sales/:businessId/goals/brief/:type/:id', salesModuleRoute('./api/sales/companyBrief.js', 'briefRoute', 'goals/brief/:type/:id'));
// intent-score-v1 Stage 3 - one company's score (S4), saved share views (S5), Write email + its lint + the day's cap (S7).
app.get('/api/sales/:businessId/goals/scores/views', salesModuleRoute('./api/sales/scoresRoutes.js', 'listViewsRoute', 'goals/scores/views'));
app.post('/api/sales/:businessId/goals/scores/views', salesModuleRoute('./api/sales/scoresRoutes.js', 'saveViewRoute', 'goals/scores/views POST'));
app.delete('/api/sales/:businessId/goals/scores/views/:id', salesModuleRoute('./api/sales/scoresRoutes.js', 'deleteViewRoute', 'goals/scores/views/:id DELETE'));
app.get('/api/sales/:businessId/goals/scores/:type/:id', salesModuleRoute('./api/sales/scoresRoutes.js', 'scoreOfRoute', 'goals/scores/:type/:id'));
app.get('/api/sales/:businessId/goals/compose/status', salesModuleRoute('./api/sales/composeRoutes.js', 'composeStatusRoute', 'goals/compose/status'));
app.post('/api/sales/:businessId/goals/compose/lint', salesModuleRoute('./api/sales/composeRoutes.js', 'composeLintRoute', 'goals/compose/lint POST'));
app.post('/api/sales/:businessId/goals/compose/:type/:id', aiLimit, salesModuleRoute('./api/sales/composeRoutes.js', 'composeRoute', 'goals/compose/:type/:id POST'));
// sales-ia-v2 Stage 3 - the company side panel (every Pipeline row type): body sections, Add to pipeline, notes and
// contacts for employers / targets, a target's ownership / step, and Research + Check Apollo for any record type.
app.get('/api/sales/:businessId/goals/company', salesModuleRoute('./api/sales/companyPanel.js', 'companyDetailRoute', 'goals/company'));
app.post('/api/sales/:businessId/goals/company/add-to-pipeline', salesModuleRoute('./api/sales/companyPanel.js', 'addToPipelineRoute', 'goals/company/add-to-pipeline POST'));
app.post('/api/sales/:businessId/goals/company/:type/:id/note', salesModuleRoute('./api/sales/companyPanel.js', 'addNoteRoute', 'goals/company/:type/:id/note POST'));
// company-workflow-v1 W3/W4/W5 - employees, a partner's reach, an employer's / target's owner person (Members).
app.patch('/api/sales/:businessId/goals/company/:type/:id/fields', salesModuleRoute('./api/sales/companyFields.js', 'editCompanyFieldsRoute', 'goals/company/:type/:id/fields PATCH'));
app.post('/api/sales/:businessId/goals/company/:type/:id/contact', salesModuleRoute('./api/sales/companyPanel.js', 'addContactRoute', 'goals/company/:type/:id/contact POST'));
app.patch('/api/sales/:businessId/goals/company/target/:id', salesModuleRoute('./api/sales/companyPanel.js', 'updateTargetRoute', 'goals/company/target/:id PATCH'));
// company-panel-v2 Stage 2 - the Interest band's buttons.
app.post('/api/sales/:businessId/goals/company/:type/:id/book-meeting', salesModuleRoute('./api/sales/companyPanel.js', 'bookMeetingRoute', 'goals/company/:type/:id/book-meeting POST'));
app.post('/api/sales/:businessId/goals/company/:type/:id/contacted', salesModuleRoute('./api/sales/companyPanel.js', 'markContactedRoute', 'goals/company/:type/:id/contacted POST'));
app.post('/api/sales/:businessId/goals/company/:type/:id/not-now', salesModuleRoute('./api/sales/companyPanel.js', 'notNowRoute', 'goals/company/:type/:id/not-now POST'));
app.get('/api/sales/:businessId/goals/company/:type/:id/research', salesModuleRoute('./api/sales/partnerResearch.js', 'listCompanyResearchRoute', 'goals/company/:type/:id/research'));
app.post('/api/sales/:businessId/goals/company/:type/:id/research', aiLimit, salesModuleRoute('./api/sales/partnerResearch.js', 'runCompanyResearchRoute', 'goals/company/:type/:id/research POST'));
app.post('/api/sales/:businessId/goals/company/:type/:id/apollo-check', salesModuleRoute('./api/sales/partnerApolloCheck.js', 'checkCompanyApolloRoute', 'goals/company/:type/:id/apollo-check POST'));
app.get('/api/sales/:businessId/goals/copy-bundle', salesModuleRoute('./api/sales/targetsRoutes.js', 'copyBundleRoute', 'goals/copy-bundle'));
// call-notes-targets-v1 REV4 Stage 3 - Tidy (propose-only suggestions).
app.post('/api/sales/:businessId/goals/tidy/run', salesModuleRoute('./api/sales/tidyRoutes.js', 'runTidyRoute', 'goals/tidy/run POST'));
app.get('/api/sales/:businessId/goals/suggestions', salesModuleRoute('./api/sales/tidyRoutes.js', 'listSuggestionsRoute', 'goals/suggestions'));
app.post('/api/sales/:businessId/goals/suggestions/:id/accept', salesModuleRoute('./api/sales/tidyRoutes.js', 'acceptSuggestionRoute', 'goals/suggestions/:id/accept POST'));
app.post('/api/sales/:businessId/goals/suggestions/:id/dismiss', salesModuleRoute('./api/sales/tidyRoutes.js', 'parkSuggestionRoute', 'goals/suggestions/:id/dismiss POST'));
app.post('/api/sales/:businessId/goals/suggestions/:id/snooze', salesModuleRoute('./api/sales/tidyRoutes.js', 'parkSuggestionRoute', 'goals/suggestions/:id/snooze POST'));
app.post('/api/sales/:businessId/goals/suggestions/:id/undo', salesModuleRoute('./api/sales/tidyRoutes.js', 'undoSuggestionRoute', 'goals/suggestions/:id/undo POST'));
// sales-ia-v2 A1 - the Actions list (reads only).
app.get('/api/sales/:businessId/goals/actions', salesModuleRoute('./api/sales/actionsRoutes.js', 'listActionsRoute', 'goals/actions'));
app.get('/api/sales/:businessId/goals/attention', salesModuleRoute('./api/sales/attentionRoutes.js', 'attentionRoute', 'goals/attention'));
// lead-source-v1 Stage 2 - source edit / history, referred-by, Sources report + partner export, backfill (export / backfill before :id-style routes).
app.get('/api/sales/:businessId/goals/sources', salesModuleRoute('./api/sales/sourceRoutes.js', 'sourcesReportRoute', 'goals/sources'));
app.get('/api/sales/:businessId/goals/sources/export', salesModuleRoute('./api/sales/sourceRoutes.js', 'sourcesExportRoute', 'goals/sources/export'));
app.get('/api/sales/:businessId/goals/sources/backfill', salesModuleRoute('./api/sales/sourceRoutes.js', 'backfillPreviewRoute', 'goals/sources/backfill'));
app.post('/api/sales/:businessId/goals/sources/backfill/apply', salesModuleRoute('./api/sales/sourceRoutes.js', 'backfillApplyRoute', 'goals/sources/backfill/apply POST'));
app.get('/api/sales/:businessId/goals/source/:type/:id', salesModuleRoute('./api/sales/sourceRoutes.js', 'getSourceRoute', 'goals/source/:type/:id'));
app.patch('/api/sales/:businessId/goals/source/:type/:id', salesModuleRoute('./api/sales/sourceRoutes.js', 'editSourceRoute', 'goals/source/:type/:id PATCH'));
app.get('/api/sales/:businessId/goals/partners/:id/referred', salesModuleRoute('./api/sales/sourceRoutes.js', 'referredByRoute', 'goals/partners/:id/referred'));
// seif-campaign-v1 Stage 2 - outreach campaigns (summary before :id; import before :action).
app.get('/api/sales/:businessId/goals/campaigns', salesModuleRoute('./api/sales/outreachRoutes.js', 'listCampaignsRoute', 'goals/campaigns'));
app.get('/api/sales/:businessId/goals/campaigns/summary', salesModuleRoute('./api/sales/outreachRoutes.js', 'campaignSummaryRoute', 'goals/campaigns/summary'));
app.post('/api/sales/:businessId/goals/campaigns', salesModuleRoute('./api/sales/outreachRoutes.js', 'createCampaignRoute', 'goals/campaigns POST'));
app.get('/api/sales/:businessId/goals/campaigns/:id', salesModuleRoute('./api/sales/outreachRoutes.js', 'getCampaignRoute', 'goals/campaigns/:id'));
app.patch('/api/sales/:businessId/goals/campaigns/:id', salesModuleRoute('./api/sales/outreachRoutes.js', 'updateCampaignRoute', 'goals/campaigns/:id PATCH'));
app.patch('/api/sales/:businessId/goals/campaigns/:id/steps/:stepId', salesModuleRoute('./api/sales/outreachRoutes.js', 'updateStepRoute', 'goals/campaigns/:id/steps PATCH'));
app.post('/api/sales/:businessId/goals/campaigns/:id/import', salesModuleRoute('./api/sales/outreachRoutes.js', 'importCampaignRoute', 'goals/campaigns/:id/import POST'));
app.post('/api/sales/:businessId/goals/campaigns/:id/:action', salesModuleRoute('./api/sales/outreachRoutes.js', 'campaignActionRoute', 'goals/campaigns/:id/:action POST'));
app.get('/api/sales/:businessId/goals/campaign-contacts/:id/draft', salesModuleRoute('./api/sales/outreachRoutes.js', 'contactDraftRoute', 'goals/campaign-contacts/:id/draft'));
app.post('/api/sales/:businessId/goals/campaign-contacts/:id/:action', salesModuleRoute('./api/sales/outreachRoutes.js', 'contactActionRoute', 'goals/campaign-contacts/:id/:action POST'));
app.get('/api/sales/:businessId/goals/dashboard', salesModuleRoute('./api/sales/dashboardRoutes.js', 'dashboardRoute', 'goals/dashboard'));
// call-notes-targets-v1 REV5 - Nudge a waiting-on item into our own to-do.
app.post('/api/sales/:businessId/goals/waiting/:id/nudge', salesModuleRoute('./api/sales/waitingRoutes.js', 'nudgeWaitingRoute', 'goals/waiting/:id/nudge POST'));
app.post('/api/sales/:businessId/goals/partners/:id/signal', salesModuleRoute('./api/sales/partnersRoutes.js', 'partnerSignalRoute', 'goals/partners/:id/signal POST'));
app.post('/api/sales/:businessId/goals/partners/:id/undo', salesModuleRoute('./api/sales/partnersRoutes.js', 'partnerUndoRoute', 'goals/partners/:id/undo POST'));
app.post('/api/sales/:businessId/goals/partners/:id/rank', salesModuleRoute('./api/sales/partnersRoutes.js', 'partnerRankRoute', 'goals/partners/:id/rank POST'));
app.post('/api/sales/:businessId/goals/partners/touches', salesModuleRoute('./api/sales/partnersRoutes.js', 'logTouchesRoute', 'goals/partners/touches POST'));
app.get('/api/sales/:businessId/goals/partners/events', salesModuleRoute('./api/sales/partnersRoutes.js', 'listPartnerEventsRoute', 'goals/partners/events'));
app.get('/api/sales/:businessId/goals/partners/:id/people', salesModuleRoute('./api/sales/partnerPeople.js', 'listPeopleRoute', 'goals/partners/:id/people'));
app.post('/api/sales/:businessId/goals/partners/:id/people', salesModuleRoute('./api/sales/partnerPeople.js', 'addPersonRoute', 'goals/partners/:id/people POST'));
app.delete('/api/sales/:businessId/goals/partners/:id/people/:personId', salesModuleRoute('./api/sales/partnerPeople.js', 'deletePersonRoute', 'goals/partners/:id/people/:personId DELETE'));
app.post('/api/sales/:businessId/goals/partners/refresh-people', salesModuleRoute('./api/sales/partnerPeople.js', 'refreshPeopleRoute', 'goals/partners/refresh-people POST'));
app.get('/api/sales/:businessId/goals/partners/apollo-touches', salesModuleRoute('./api/sales/partnerApolloTouches.js', 'apolloTouchesDryRunRoute', 'goals/partners/apollo-touches'));
app.post('/api/sales/:businessId/goals/partners/apollo-touches/apply', salesModuleRoute('./api/sales/partnerApolloTouches.js', 'apolloTouchesApplyRoute', 'goals/partners/apollo-touches/apply POST'));
app.post('/api/sales/:businessId/goals/partners/apollo-touches/dismiss', salesModuleRoute('./api/sales/partnerApolloTouches.js', 'apolloTouchesDismissRoute', 'goals/partners/apollo-touches/dismiss POST'));
app.get('/api/sales/:businessId/goals/partners/outlook-touches', salesModuleRoute('./api/sales/partnerOutlookTouches.js', 'outlookTouchesDryRunRoute', 'goals/partners/outlook-touches'));
app.post('/api/sales/:businessId/goals/partners/outlook-touches/apply', salesModuleRoute('./api/sales/partnerOutlookTouches.js', 'outlookTouchesApplyRoute', 'goals/partners/outlook-touches/apply POST'));
app.post('/api/sales/:businessId/goals/partners/outlook-touches/dismiss', salesModuleRoute('./api/sales/partnerOutlookTouches.js', 'outlookTouchesDismissRoute', 'goals/partners/outlook-touches/dismiss POST'));
app.post('/api/sales/:businessId/goals/partners/outlook-touches/record', salesModuleRoute('./api/sales/partnerOutlookTouches.js', 'outlookTouchesRecordRoute', 'goals/partners/outlook-touches/record POST'));
app.get('/api/sales/:businessId/goals/partners/:id/research', salesModuleRoute('./api/sales/partnerResearch.js', 'listResearchRoute', 'goals/partners/:id/research'));
app.post('/api/sales/:businessId/goals/partners/:id/research', aiLimit, salesModuleRoute('./api/sales/partnerResearch.js', 'runResearchRoute', 'goals/partners/:id/research POST'));
// partner-add-research-v1 Stage 3 - Apollo people check for one partner (max 2 /contacts/search calls, 0 credits).
app.post('/api/sales/:businessId/goals/partners/:id/apollo-check', salesModuleRoute('./api/sales/partnerApolloCheck.js', 'checkPartnerApolloRoute', 'goals/partners/:id/apollo-check POST'));
app.get('/api/sales/:businessId/goals/partners/dupe-check', salesModuleRoute('./api/sales/partnerDupeCheck.js', 'dupeCheckRoute', 'goals/partners/dupe-check'));
app.get('/api/sales/:businessId/goals/partners/domains', salesModuleRoute('./api/sales/partnerDomains.js', 'listAllDomainsRoute', 'goals/partners/domains'));
app.get('/api/sales/:businessId/goals/partners/export-apollo.csv', salesModuleRoute('./api/sales/partnerDomains.js', 'exportApolloCsvRoute', 'goals/partners/export-apollo.csv'));
app.get('/api/sales/:businessId/goals/partners/:id/domains', salesModuleRoute('./api/sales/partnerDomains.js', 'listDomainsRoute', 'goals/partners/:id/domains'));
app.post('/api/sales/:businessId/goals/partners/:id/domains', salesModuleRoute('./api/sales/partnerDomains.js', 'addDomainRoute', 'goals/partners/:id/domains POST'));
app.patch('/api/sales/:businessId/goals/partners/:id/domains/:domainId', salesModuleRoute('./api/sales/partnerDomains.js', 'updateDomainRoute', 'goals/partners/:id/domains/:domainId PATCH'));
app.delete('/api/sales/:businessId/goals/partners/:id/domains/:domainId', salesModuleRoute('./api/sales/partnerDomains.js', 'deleteDomainRoute', 'goals/partners/:id/domains/:domainId DELETE'));
app.get('/api/sales/:businessId/goals/scorecard', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'scorecardRoute', 'goals/scorecard'));
app.get('/api/sales/:businessId/goals/kpi', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'kpiRoute', 'goals/kpi'));
app.get('/api/sales/:businessId/goals/companies', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'listCompaniesRoute', 'goals/companies'));
app.get('/api/sales/:businessId/goals/pipeline-board', salesModuleRoute('./api/sales/pipelineBoard.js', 'pipelineBoardRoute', 'goals/pipeline-board'));
app.get('/api/sales/:businessId/goals/pipeline-board/export', salesModuleRoute('./api/sales/pipelineBoard.js', 'pipelineBoardExportRoute', 'goals/pipeline-board/export'));
app.post('/api/sales/:businessId/goals/pipeline-board/update', salesModuleRoute('./api/sales/sheetUpdate.js', 'pipelineBoardUpdateRoute', 'goals/pipeline-board/update POST'));
app.patch('/api/sales/:businessId/goals/companies/:accountId', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'updateCompanyRoute', 'goals/companies/:accountId PATCH'));
app.get('/api/sales/:businessId/goals/targets', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'listTargetsRoute', 'goals/targets'));
app.get('/api/sales/:businessId/goals/hero', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'heroRoute', 'goals/hero'));
app.put('/api/sales/:businessId/goals/targets', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'saveTargetRoute', 'goals/targets PUT'));
app.get('/api/sales/:businessId/goals/report', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'getReportRoute', 'goals/report'));
app.put('/api/sales/:businessId/goals/report/:weekStart/sections/:key', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'saveSectionRoute', 'goals/report/:weekStart/sections/:key PUT'));
app.post('/api/sales/:businessId/goals/report/:weekStart/sections/:key/append', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'appendSectionRoute', 'goals/report/:weekStart/sections/:key/append POST'));
app.post('/api/sales/:businessId/goals/report/:weekStart/finalize', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'finalizeReportRoute', 'goals/report/:weekStart/finalize POST'));
app.post('/api/sales/:businessId/goals/report/:weekStart/reopen', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'reopenReportRoute', 'goals/report/:weekStart/reopen POST'));
app.post('/api/sales/:businessId/goals/infra', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'createInfraRoute', 'goals/infra POST'));
app.post('/api/sales/:businessId/goals/infra/carry-forward', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'carryForwardInfraRoute', 'goals/infra/carry-forward POST'));
app.patch('/api/sales/:businessId/goals/infra/:id', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'updateInfraRoute', 'goals/infra/:id PATCH'));
app.delete('/api/sales/:businessId/goals/infra/:id', salesModuleRoute('./api/sales/goalsReportRoutes.js', 'deleteInfraRoute', 'goals/infra/:id DELETE'));

app.post('/api/sfdc/sync-now', async (req, res) => {
  try {
    const { syncAllCompliance } = await import('./api/sfdc/sync-compliance.js');
    const result = await syncAllCompliance();
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

// ── Sales Analytics Apollo sync — daily, 06:00 America/Los_Angeles ─────────
// Guardrail 7: exactly one registration. The module-level flag is real
// insurance against this block ever running twice in one process (e.g. a
// future refactor that moves this into a function called more than once) -
// cron.schedule itself doesn't dedupe by expression or name.
let salesAnalyticsCronRegistered = false;
if (!salesAnalyticsCronRegistered) {
  salesAnalyticsCronRegistered = true;
  cron.schedule(
    '0 6 * * *',
    async () => {
      console.log('[CRON] Running Sales Analytics Apollo sync...');
      try {
        const { runSync, cleanupOldSnapshots } = await import('./api/sales/sync.js');
        const { getAllowlistedBusinessIds } = await import('./api/sales/allowlist.js');
        for (const businessId of getAllowlistedBusinessIds()) {
          const result = await runSync({ businessId, trigger: 'cron' });
          console.log(
            '[CRON] sales sync', businessId,
            result.refused ? `refused: ${result.reason}` : `status: ${result.run && result.run.status}`
          );
        }
        const cleanup = await cleanupOldSnapshots();
        console.log('[CRON] sales snapshot retention cleanup:', cleanup);
      } catch (err) {
        console.error('[CRON] Sales Analytics sync failed:', err.message);
      }
    },
    { timezone: 'America/Los_Angeles', noOverlap: true }
  );
  console.log('[CRON] Sales Analytics Apollo sync scheduled daily at 06:00 America/Los_Angeles');
}

// ── HumanKind daily check — in-process runner, ON only when HK_SCHEDULER=cron ──
// hkos-daily-check-v1 J2: the page-load runner (POST /api/hk/:b/jobs/pageload) is always the floor; this registers the
// hourly gmail-sync-all + the digest-time daily-check per hk_sales workspace, once, America/Chicago, noOverlap. Jack
// sets HK_SCHEDULER=cron in Render only after confirming the instance never sleeps.
let hkCronRegistered = false;
if (process.env.HK_SCHEDULER === 'cron' && !hkCronRegistered) {
  hkCronRegistered = true;
  import('./api/hk/jobs/cron.js')
    .then(m => m.registerHkCronFromDb(cron))
    .then(list => console.log('[CRON] HumanKind jobs scheduled:', JSON.stringify(list)))
    .catch(err => console.error('[CRON] HumanKind jobs failed to register:', err.message));
} else {
  console.log('[CRON] HumanKind daily check: cron runner off (HK_SCHEDULER is not "cron"); page-load runner only');
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✓ Prospector running on port ${PORT}`));
