// Fetches Gong call briefings from Databricks for a given SFDC account ID.
// Requires env: DATABRICKS_HOST, DATABRICKS_PATH, DATABRICKS_TOKEN, DATABRICKS_CALLS_TABLE

const DATABRICKS_HOST  = process.env.DATABRICKS_HOST;
const DATABRICKS_PATH  = process.env.DATABRICKS_PATH;  // e.g. /sql/1.0/warehouses/abc123
const DATABRICKS_TOKEN = process.env.DATABRICKS_TOKEN;
// Table holding synced SFDC call task records, e.g. catalog.schema.table
const DATABRICKS_CALLS_TABLE = process.env.DATABRICKS_CALLS_TABLE;

// Extract warehouse ID from path: /sql/1.0/warehouses/{id}
function warehouseId() {
  if (!DATABRICKS_PATH) return null;
  const parts = DATABRICKS_PATH.split('/');
  return parts[parts.length - 1] || null;
}

function parseDescription(text) {
  if (!text) return { summary: '', keyPoints: [], nextSteps: [] };

  const lines = text.split('\n');
  let section = 'summary';
  const summaryLines = [];
  const keyPoints    = [];
  const nextSteps    = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (/^key discussion points:/i.test(line)) { section = 'keyPoints'; continue; }
    if (/^next steps:/i.test(line))            { section = 'nextSteps'; continue; }

    if (section === 'summary') {
      summaryLines.push(line);
    } else if (section === 'keyPoints') {
      const m = line.match(/^\d+[\.\)]\s*(.+)/);
      if (m) keyPoints.push(m[1].trim());
    } else if (section === 'nextSteps') {
      const m = line.match(/^[*\-•]\s*(.+)/);
      if (m) nextSteps.push(m[1].trim());
    }
  }

  return { summary: summaryLines.join(' '), keyPoints, nextSteps };
}

export default async function handler(req, res) {
  const { sfdcId } = req.body || {};
  if (!sfdcId) return res.status(400).json({ error: 'sfdcId required' });

  if (!DATABRICKS_HOST || !DATABRICKS_TOKEN || !DATABRICKS_PATH || !DATABRICKS_CALLS_TABLE) {
    return res.status(503).json({ error: 'Databricks not configured' });
  }

  const wid = warehouseId();
  if (!wid) return res.status(503).json({ error: 'Invalid DATABRICKS_PATH' });

  const statement = `
    SELECT
      id,
      subject,
      activitydate,
      call_duration_seconds,
      description,
      name AS ae_name,
      role_name,
      whoid,
      whoid_type
    FROM ${DATABRICKS_CALLS_TABLE}
    WHERE accountid = :accountid
      AND is_ae = 1
      AND description IS NOT NULL
      AND LENGTH(TRIM(description)) > 0
    ORDER BY activitydate DESC
    LIMIT 50
  `.trim();

  try {
    const resp = await fetch(`https://${DATABRICKS_HOST}/api/2.0/sql/statements`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DATABRICKS_TOKEN}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        warehouse_id:  wid,
        statement,
        wait_timeout:  '30s',
        parameters:    [{ name: 'accountid', value: sfdcId, type: 'STRING' }],
      }),
    });

    const data = await resp.json();

    if (data.status?.state === 'FAILED') {
      console.error('[gong-calls] Databricks error:', data.status.error);
      return res.status(502).json({ error: data.status.error?.message || 'Query failed' });
    }

    const cols  = (data.manifest?.schema?.columns || []).map(c => c.name);
    const rows  = data.result?.data_array || [];

    const calls = rows.map(row => {
      const r = Object.fromEntries(cols.map((c, i) => [c, row[i]]));
      const parsed = parseDescription(r.description);
      return {
        id:              r.id,
        source:          'gong',
        subject:         r.subject || '',
        date:            r.activitydate ? r.activitydate.slice(0, 10) : '',
        durationSeconds: r.call_duration_seconds ? Number(r.call_duration_seconds) : null,
        summary:         parsed.summary,
        keyPoints:       parsed.keyPoints,
        nextSteps:       parsed.nextSteps,
        aeName:          r.ae_name || '',
        rawDescription:  r.description,
      };
    });

    res.json({ calls });
  } catch (err) {
    console.error('[gong-calls] fetch error:', err);
    res.status(500).json({ error: err.message });
  }
}
