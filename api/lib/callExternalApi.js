// Shared outbound-call wrapper (external-api-foundation-v1). Modeled on
// businesses/shared.js's callAnthropic() (timeout, thrown-error-on-missing-key,
// structured failure) and hunter/find.js (key check -> request -> explicit
// status branches -> typed response) - not a new pattern invented from
// scratch. The 8 pre-existing integrations keep their own fetch calls;
// this is only for integrations declared in integrations.js.
import { getIntegration } from './integrations.js';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 300;

// Per-process OAuth token cache - valid since server.js runs as a single
// persistent Express process (not serverless), same assumption businesses/
// shared.js's runResearch() background-work comment already relies on.
const tokenCache = new Map();

function missingEnvVars(integration) {
  return integration.requiredEnvVars.filter(v => !process.env[v]);
}

async function getOAuth2Token(integration) {
  const cached = tokenCache.get(integration.name);
  if (cached && cached.expiresAt > Date.now() + 30000) return cached.token;

  const { tokenUrl, accountIdEnvVar, clientIdEnvVar, clientSecretEnvVar } = integration.oauth;
  const accountId = process.env[accountIdEnvVar];
  const clientId = process.env[clientIdEnvVar];
  const clientSecret = process.env[clientSecretEnvVar];
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(`${tokenUrl}?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`${integration.name}: OAuth token request failed (${res.status}) ${data.error || data.reason || ''}`.trim());
  }
  const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  tokenCache.set(integration.name, { token: data.access_token, expiresAt });
  return data.access_token;
}

async function resolveAuth(integration) {
  const missing = missingEnvVars(integration);
  if (missing.length) {
    throw new Error(`${integration.name}: missing required env var(s) ${missing.join(', ')}`);
  }

  switch (integration.authType) {
    case 'none':
      return {};
    case 'apiKeyHeader': {
      const key = process.env[integration.auth.envVar];
      const value = integration.auth.format ? integration.auth.format.replace('{key}', key) : key;
      return { headers: { [integration.auth.headerName]: value } };
    }
    case 'apiKeyQuery': {
      const key = process.env[integration.auth.envVar];
      return { query: { [integration.auth.paramName]: key } };
    }
    case 'oauth2_server_to_server': {
      const token = await getOAuth2Token(integration);
      return { headers: { Authorization: `Bearer ${token}` } };
    }
    default:
      throw new Error(`${integration.name}: unknown authType "${integration.authType}"`);
  }
}

function isRetryableStatus(status) {
  return status >= 500 && status < 600;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// callExternalApi(config, options)
//   config:  { integration, method, path, query, headers, body }
//   options: { timeoutMs, retries } - override the integration's defaults
// Never throws. Returns { ok, data, error, status }.
// Retries only network errors/timeouts and 5xx - a 4xx (bad request, bad
// auth, not found) means retrying would just fail the same way again.
export async function callExternalApi(config, options = {}) {
  const { integration: name, method = 'GET', path = '', query = {}, headers = {}, body } = config;
  const integration = getIntegration(name);
  const timeoutMs = options.timeoutMs ?? integration.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.retries ?? integration.defaultRetries ?? DEFAULT_RETRIES;

  let auth;
  try {
    auth = await resolveAuth(integration);
  } catch (err) {
    return { ok: false, error: err.message, status: null };
  }

  const url = new URL(`${integration.baseUrl}${path}`);
  for (const [k, v] of Object.entries({ ...query, ...(auth.query || {}) })) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  const finalHeaders = {
    'Content-Type': 'application/json',
    ...headers,
    ...(auth.headers || {}),
  };

  let attempt = 0;
  let lastError;
  while (attempt <= maxRetries) {
    try {
      const res = await fetch(url.toString(), {
        method,
        headers: finalHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        if (isRetryableStatus(res.status) && attempt < maxRetries) {
          attempt++;
          await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
          continue;
        }
        const text = await res.text().catch(() => '');
        return { ok: false, error: text.slice(0, 500) || `${integration.name} returned ${res.status}`, status: res.status };
      }

      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await res.json() : await res.text();
      return { ok: true, data, status: res.status };
    } catch (err) {
      lastError = err;
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
      const isNetworkError = err.name === 'TypeError' || isTimeout;
      if (isNetworkError && attempt < maxRetries) {
        attempt++;
        await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
      return { ok: false, error: isTimeout ? `${integration.name} request timed out` : err.message, status: null };
    }
  }
  return { ok: false, error: lastError?.message || 'Unknown error', status: null };
}
