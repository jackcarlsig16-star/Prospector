export const config = { maxDuration: 20 };

function decodeBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  if (payload.parts) {
    const html = payload.parts.find(p => p.mimeType === 'text/html');
    if (html) return decodeBody(html);
    const txt  = payload.parts.find(p => p.mimeType === 'text/plain');
    if (txt)  return decodeBody(txt);
    for (const part of payload.parts) { const b = decodeBody(part); if (b) return b; }
  }
  return '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { accessToken, existingDates } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'Missing accessToken' });
  const skipDates = new Set(Array.isArray(existingDates) ? existingDates : []);

  const headers = { Authorization: `Bearer ${accessToken}` };

  const gmailSearch = async (q) => {
    const r = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=10`,
      { headers, signal: AbortSignal.timeout(12000) }
    );
    if (r.status === 401) return { expired: true };
    if (!r.ok) return { error: `Gmail search failed (${r.status})` };
    return r.json();
  };

  // Try narrow query first, then fall back without subject constraint
  let listData;
  try {
    listData = await gmailSearch('from:abm-alerts@6sense.com subject:"Daily Top Accounts" newer_than:7d');
    if (listData.expired) return res.status(401).json({ error: 'token_expired' });
    if (listData.error)   return res.status(500).json({ error: listData.error });
    if (!listData.messages?.length) {
      listData = await gmailSearch('from:abm-alerts@6sense.com newer_than:7d');
      if (listData.expired) return res.status(401).json({ error: 'token_expired' });
      if (listData.error)   return res.status(500).json({ error: listData.error });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  if (!listData.messages?.length) return res.json({ found: false, emailFound: false, accounts: [] });

  const { parse6senseEmail } = await import('../src/utils/parse6senseEmail.js');

  const fetched = await Promise.all(listData.messages.map(async ({ id }) => {
    try {
      const r = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        { headers, signal: AbortSignal.timeout(12000) }
      );
      if (!r.ok) return null;
      const msg = await r.json();
      const hdrs = msg.payload?.headers || [];
      const dateHeader = hdrs.find(h => h.name.toLowerCase() === 'date')?.value || '';
      const date = dateHeader
        ? (() => { try { return new Date(dateHeader).toISOString().slice(0, 10); } catch { return new Date().toISOString().slice(0, 10); } })()
        : new Date().toISOString().slice(0, 10);
      if (skipDates.has(date)) return { date, skipped: true, accounts: [] };
      const rawBody = decodeBody(msg.payload);
      if (!rawBody) return { date, accounts: [] };
      return { date, accounts: parse6senseEmail(rawBody, date) };
    } catch { return null; }
  }));

  const valid = fetched.filter(Boolean);
  const accounts = valid.flatMap(m => m.accounts || []);
  const dates = Array.from(new Set(valid.map(m => m.date))).sort();
  const mostRecent = dates[dates.length - 1] || new Date().toISOString().slice(0, 10);

  return res.json({
    found: true,
    emailFound: true,
    parsed: accounts.length,
    messagesProcessed: valid.length,
    date: mostRecent,
    dates,
    accounts,
  });
}
