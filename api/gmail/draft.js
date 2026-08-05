export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { to, subject, body, accessToken } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'Missing accessToken' });
  if (!subject && !body) return res.status(400).json({ error: 'Need at least subject or body' });
  try {
    const headers = [];
    if (to)      headers.push(`To: ${to}`);
    if (subject) headers.push(`Subject: ${subject}`);
    headers.push('Content-Type: text/plain; charset=utf-8');
    const mime = `${headers.join('\r\n')}\r\n\r\n${body || ''}`;
    const raw = Buffer.from(mime, 'utf-8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw } }),
    });
    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ error: errText.slice(0, 400) });
    }
    const data = await r.json();
    const draftId = data.id;
    const messageId = data.message?.id;
    const draftUrl = messageId
      ? `https://mail.google.com/mail/u/0/#drafts/${messageId}`
      : `https://mail.google.com/mail/u/0/#drafts`;
    res.json({ draftId, messageId, draftUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
