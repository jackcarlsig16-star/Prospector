import { createClient } from '@supabase/supabase-js';

const STEP_PRIORITY = { "Not Started": 0, "In Progress": 1, "Submitted": 2, "Blocked": 1.5, "Approved": 3 };

const FIELDS = [
  "Id", "Name",
  "Production_Request_Compliance_Stage__c",
  "Security_Diligence_SDR_Status__c",
  "Request_For_Information__c",
  "Wadsworth_Client_Link__c",
].join(", ");

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function syncAllCompliance({ clientToken, clientInstance } = {}) {
  console.log('[SFDC SYNC] Starting compliance sync at', new Date().toISOString());

  const supabase = getSupabase();
  if (!supabase) {
    console.log('[SFDC SYNC] Supabase not configured — skipping');
    return { synced: 0, error: 'Supabase not configured' };
  }

  const cliMode = process.env.SF_CLI_MODE === 'true';
  let tokenRow = null;

  if (!cliMode) {
    const { data } = await supabase
      .from('sfdc_tokens')
      .select('access_token, instance_url')
      .eq('id', 'primary')
      .single();

    if (data) {
      tokenRow = data;
    } else if (clientToken && clientInstance) {
      // Client passed its localStorage token — use it and re-store in Supabase for future cron runs
      console.log('[SFDC SYNC] No Supabase token; using client-provided token and re-storing');
      tokenRow = { access_token: clientToken, instance_url: clientInstance };
      supabase.from('sfdc_tokens').upsert({
        id: 'primary',
        access_token: clientToken,
        instance_url: clientInstance,
        issued_at: new Date().toISOString(),
      }, { onConflict: 'id' }).then(() => {}).catch(e => console.warn('[SFDC SYNC] Token re-store failed:', e.message));
    } else {
      console.log('[SFDC SYNC] No SFDC token found — skipping');
      return { synced: 0, error: 'No SFDC token' };
    }
  }

  const { data: accountRows, error: accErr } = await supabase
    .from('accounts')
    .select('id, data');

  if (accErr) {
    console.error('[SFDC SYNC] Failed to fetch accounts:', accErr.message);
    return { synced: 0, error: accErr.message };
  }

  const activeDeals = (accountRows || []).filter(r =>
    r.data?.sfdc &&
    Array.isArray(r.data?.clientIds) &&
    r.data.clientIds.length > 0 &&
    r.data?.stage === 'Active Deal'
  );

  if (!activeDeals.length) {
    console.log('[SFDC SYNC] No Active Deal accounts with client IDs found');
    return { synced: 0, total: 0 };
  }

  let synced = 0;
  const errors = [];

  for (const row of activeDeals) {
    const acc = row.data;
    const clientId = acc.clientIds[0];
    if (!clientId) continue;

    try {
      const sfdcRecord = await querySFDC(clientId, tokenRow, cliMode);
      if (!sfdcRecord) {
        console.log(`[SFDC SYNC] No production request found for ${acc.name} (clientId: ${clientId})`);
        continue;
      }

      const incomingSteps = mapSfdcToSteps(sfdcRecord);

      const { data: existing } = await supabase
        .from('plospect_compliance')
        .select('steps, type')
        .eq('acc_id', String(acc.id))
        .single();

      const mergedSteps = mergeSteps(existing?.steps || [], incomingSteps);

      await supabase.from('plospect_compliance').upsert({
        acc_id: String(acc.id),
        acc_name: acc.name,
        type: existing?.type || (acc.partner ? 'partner' : 'standard'),
        steps: mergedSteps,
        last_sfdc_sync: new Date().toISOString(),
        sfdc_raw: sfdcRecord,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'acc_id' });

      synced++;
      console.log(`[SFDC SYNC] Synced ${acc.name}`);

      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`[SFDC SYNC] Error on ${acc.name}:`, err.message);
      errors.push({ acc: acc.name, error: err.message });
    }
  }

  console.log(`[SFDC SYNC] Done. Synced ${synced}/${activeDeals.length} accounts`);
  return { synced, total: activeDeals.length, errors };
}

async function querySFDC(clientId, tokenRow, cliMode) {
  const query = `SELECT ${FIELDS} FROM ProductionRequest__c WHERE Raw_Client_ID__c = '${clientId}' ORDER BY CreatedDate DESC LIMIT 1`;

  if (cliMode) {
    const { execSync } = await import('child_process');
    const out = execSync(
      `sf data query --query "${query}" --target-org ${process.env.SF_ORG || 'admin@example.com'} --json 2>/dev/null`,
      { timeout: 12000 }
    );
    const parsed = JSON.parse(out.toString());
    return parsed.result?.records?.[0] || null;
  }

  const url = `${tokenRow.instance_url}/services/data/v59.0/query?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${tokenRow.access_token}` },
    signal: AbortSignal.timeout(10000),
  });

  if (res.status === 401) throw new Error('SFDC token expired');
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SFDC ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (Array.isArray(data) && data[0]?.errorCode) throw new Error(data[0].message);
  return data.records?.[0] || null;
}

function mapSfdcToSteps(record) {
  const stage = record.Production_Request_Compliance_Stage__c || '';
  const secStatus = (record.Security_Diligence_SDR_Status__c || '').toUpperCase();

  let prodStatus = 'Not Started';
  if (stage === 'APPROVED')                                        prodStatus = 'Approved';
  else if (stage === 'REJECTED' || stage === 'DISCARDED')          prodStatus = 'Blocked';
  else if (stage === 'PENDING_EXTERNALLY')                         prodStatus = 'Submitted';
  else if (stage === 'NEW' || stage === 'PENDING_INTERNALLY' ||
           stage === 'IN_REVIEW' || stage === 'In Review')         prodStatus = 'In Progress';

  let secQStatus = 'Not Started';
  if (secStatus === 'APPROVED')      secQStatus = 'Approved';
  else if (secStatus === 'REJECTED') secQStatus = 'Blocked';
  else if (secStatus)                secQStatus = 'In Progress';

  const now = new Date().toISOString();
  return [
    {
      id: 'prod_request',
      status: prodStatus,
      sfdcSynced: true,
      sfdcSyncedAt: now,
      sfdcId: record.Id,
      wadsworthLink: record.Wadsworth_Client_Link__c || null,
      notes: record.Request_For_Information__c || '',
    },
    {
      id: 'security_q',
      status: secQStatus,
      sfdcSynced: true,
      sfdcSyncedAt: now,
    },
  ];
}

function mergeSteps(existing, incoming) {
  const merged = existing.map(s => ({ ...s }));
  for (const inStep of incoming) {
    const idx = merged.findIndex(s => s.id === inStep.id);
    if (idx === -1) {
      merged.push(inStep);
    } else {
      const existPriority = STEP_PRIORITY[merged[idx].status] ?? 0;
      const inPriority    = STEP_PRIORITY[inStep.status]      ?? 0;
      if (inPriority > existPriority) {
        merged[idx] = { ...merged[idx], ...inStep };
      } else {
        merged[idx] = { ...merged[idx], ...inStep, status: merged[idx].status };
      }
    }
  }
  return merged;
}
