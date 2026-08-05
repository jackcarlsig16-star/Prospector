const FIVE_MIN = 5 * 60 * 1000;
let inflight = null;

export async function getValidGmailToken() {
  const token = localStorage.getItem('gmail_access_token');
  const expiry = Number(localStorage.getItem('gmail_token_expiry') || 0);
  const refresh = localStorage.getItem('gmail_refresh_token');

  if (token && expiry && expiry - Date.now() > FIVE_MIN) return token;
  if (!refresh) return token || null;

  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch('/api/gmail/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!r.ok) return null;
      const { accessToken, expiry: newExpiry } = await r.json();
      if (!accessToken) return null;
      localStorage.setItem('gmail_access_token', accessToken);
      if (newExpiry) localStorage.setItem('gmail_token_expiry', String(newExpiry));
      return accessToken;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
