// Territory-wide Gong trend engine.
// Queries all calls for an AE from Databricks, then runs a Claude Haiku
// analysis pass to surface pain point frequency, objections, product
// co-occurrence, and overall territory health.

const DATABRICKS_HOST  = process.env.DATABRICKS_HOST;
const DATABRICKS_PATH  = process.env.DATABRICKS_PATH;
const DATABRICKS_TOKEN = process.env.DATABRICKS_TOKEN;
// Table holding synced SFDC call task records, e.g. catalog.schema.table
const DATABRICKS_CALLS_TABLE = process.env.DATABRICKS_CALLS_TABLE;
const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY;

function warehouseId() {
  if (!DATABRICKS_PATH) return null;
  const parts = DATABRICKS_PATH.split('/');
  return parts[parts.length - 1] || null;
}

export default async function handler(req, res) {
  const { aeName } = req.body || {};
  if (!aeName) return res.status(400).json({ error: 'aeName required' });

  if (!DATABRICKS_HOST || !DATABRICKS_TOKEN || !DATABRICKS_PATH || !DATABRICKS_CALLS_TABLE) {
    return res.status(503).json({ error: 'Databricks not configured' });
  }

  const wid = warehouseId();
  if (!wid) return res.status(503).json({ error: 'Invalid DATABRICKS_PATH' });

  // Step 1: Pull all AE calls from Databricks
  const statement = `
    SELECT accountid, subject, activitydate, description
    FROM ${DATABRICKS_CALLS_TABLE}
    WHERE name = :aename
      AND is_ae = 1
      AND description IS NOT NULL
      AND LENGTH(TRIM(description)) > 0
    ORDER BY activitydate DESC
    LIMIT 200
  `.trim();

  let calls;
  try {
    const resp = await fetch(`https://${DATABRICKS_HOST}/api/2.0/sql/statements`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DATABRICKS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        warehouse_id: wid,
        statement,
        wait_timeout: '30s',
        parameters: [{ name: 'aename', value: aeName, type: 'STRING' }],
      }),
      signal: AbortSignal.timeout(35000),
    });

    const data = await resp.json();

    if (data.status?.state === 'FAILED') {
      console.error('[gong-trends] Databricks error:', data.status.error);
      return res.status(502).json({ error: data.status.error?.message || 'Query failed' });
    }

    const cols = (data.manifest?.schema?.columns || []).map(c => c.name);
    const rows = data.result?.data_array || [];
    calls = rows.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
  } catch (err) {
    console.error('[gong-trends] Databricks fetch error:', err);
    return res.status(500).json({ error: err.message });
  }

  if (!calls.length) {
    return res.json({ trends: null, callCount: 0, accountCount: 0, generatedAt: new Date().toISOString() });
  }

  if (!ANTHROPIC_KEY) {
    return res.status(503).json({ error: 'Anthropic not configured' });
  }

  // Step 2: Build condensed sample for Claude — cap description at 600 chars each
  const accountIds = new Set(calls.map(c => c.accountid).filter(Boolean));
  const sample = calls.slice(0, 100).map(c => {
    const desc = (c.description || '').slice(0, 600);
    return `[${(c.activitydate || '').slice(0, 10)}] ${c.subject || 'Call'}\n${desc}`;
  }).join('\n\n---\n\n');

  const prompt = `You are analyzing ${calls.length} Gong call briefings across ${accountIds.size} accounts for an Account Executive.

CALL BRIEFINGS (${Math.min(calls.length, 100)} sampled):
${sample}

Extract territory-wide trends. Be specific — use language from the actual calls. Respond ONLY with valid JSON:
{
  "topPainPoints": [
    { "pain": "string (concise label)", "frequency": number, "example": "brief quote or paraphrase from calls" }
  ],
  "topObjections": [
    { "objection": "string (concise label)", "frequency": number, "stage": "string or null" }
  ],
  "productSignals": [
    { "product": "product name", "context": "how it's coming up in calls" }
  ],
  "competitorMentions": [
    { "competitor": "name", "context": "how they're being mentioned" }
  ],
  "openNextStepsCount": number,
  "keyThemes": ["theme1", "theme2", "theme3"],
  "territoryHealth": "healthy | mixed | at-risk",
  "summary": "2-3 sentence executive summary of territory health and top opportunities"
}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await r.json();
    const text = data.content?.[0]?.text || '';

    let trends = null;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) trends = JSON.parse(m[0]);
    } catch (e) {
      console.error('[gong-trends] JSON parse error:', e.message);
    }

    res.json({
      trends,
      callCount: calls.length,
      accountCount: accountIds.size,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[gong-trends] Claude error:', err);
    res.status(500).json({ error: err.message });
  }
}
