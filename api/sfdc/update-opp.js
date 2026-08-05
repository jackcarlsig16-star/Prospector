export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { accessToken, instanceUrl, oppId, fields } = req.body || {};
  if (!accessToken || !instanceUrl || !oppId || !fields) {
    return res.status(400).json({ error: 'Missing accessToken, instanceUrl, oppId, or fields' });
  }
  try {
    const r = await fetch(`${instanceUrl}/services/data/v59.0/sobjects/Opportunity/${oppId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(fields),
    });
    if (r.status === 204) return res.json({ success: true });
    const body = await r.text();
    return res.status(r.status).json({ error: body.slice(0, 500) || `SFDC ${r.status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
