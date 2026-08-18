export const config = { maxDuration: 20 };

function mapSfdcStage(sfdcStage) {
  const map = {
    "Qualify":            "Prospecting",
    "Discovery":          "Engaged",
    "Evaluation":         "Active Deal",
    "Mutual Alignment":   "Active Deal",
    "Negotiation":        "Active Deal",
    "Contract Execution": "Active Deal",
    "Closed Won":         "Closed Won",
    "Closed Won - Locked":"Closed Won",
    "Closed Lost":        "Closed Lost",
  };
  return map[sfdcStage] || "Prospecting";
}

// account-taxonomy-gaps-fix-v1 Stage 2 - "Partner" (Prospector's account
// source value) renamed to "Partner Referral" so it no longer collides
// with relationship_type's own "Partner" value. This is the real SFDC
// leadSource -> Prospector source mapping (consumed client-side in
// AccountsPage.js's handleImportSfdc) - the rename has to happen here too,
// not just in the dropdown's option list.
function mapLeadSource(leadSource, dealSource) {
  const ds = (dealSource || "").toLowerCase();
  if (ds.includes("inbound") || ds.includes("nba")) return "Inbound";
  if (leadSource === "Partner")  return "Partner Referral";
  if (leadSource === "Referral") return "Referral";
  return "SFDC";
}

const escapeSoql = s => String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const SFDC_ID_RE = /^[a-zA-Z0-9]{15,18}$/;

async function paginate(sfdcInstance, headers, initialData) {
  const data = { ...initialData, records: [...(initialData.records || [])] };
  while (!data.done && data.nextRecordsUrl) {
    const r = await fetch(`${sfdcInstance}${data.nextRecordsUrl}`, { headers });
    if (!r.ok) break;
    const page = await r.json();
    data.records.push(...(page.records || []));
    data.done = page.done;
    data.nextRecordsUrl = page.nextRecordsUrl;
  }
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { sfdcToken, sfdcInstance, sfdcUserId, ownerName } = req.body;

  // Prefer ID-based scoping; fall back to escaped name match for legacy callers / CLI mode
  const useIdScope = sfdcUserId && SFDC_ID_RE.test(sfdcUserId);
  if (!useIdScope && !ownerName) {
    return res.status(400).json({ error: "Missing sfdcUserId or ownerName" });
  }
  const accountScope = useIdScope
    ? `OwnerId = '${sfdcUserId}'`
    : `Owner.Name = '${escapeSoql(ownerName)}'`;
  const oppScope = useIdScope
    ? `OwnerId = '${sfdcUserId}'`
    : `Owner.Name = '${escapeSoql(ownerName)}'`;
  const clientIdScope = useIdScope
    ? `Account__r.OwnerId = '${sfdcUserId}'`
    : `Account__r.Owner.Name = '${escapeSoql(ownerName)}'`;

  const accountQuery = `SELECT Id, Name, Website, Industry, BillingState, BillingCity, OwnerId FROM Account WHERE ${accountScope} LIMIT 2000`;

  const oppQuery = `SELECT Id, Name, StageName, AccountId, CloseDate, Amount, LeadSource, NBA_Notes__c, Deal_Source__c, AE_Handoff_Meeting_Completed__c, Sales_Follow_Up_Date__c, SDR_Initiated_Demo__c, Lead_Source_Details__c FROM Opportunity WHERE ${oppScope} AND IsClosed = false ORDER BY CreatedDate DESC LIMIT 2000`;

  const clientIdQuery = `SELECT Id, Name, Account__c, ProductionEnabled__c, Enabled_Products__c FROM Client_ID__c WHERE ${clientIdScope}`;

  // ── SF CLI fallback (local dev) ───────────────────────────────────────────────
  if (!sfdcToken && process.env.SF_CLI_MODE === "true") {
    try {
      const { execSync } = await import("child_process");
      const runQ = (q) => execSync(
        `sf data query --query "${q.replace(/\n\s*/g," ")}" --target-org ${process.env.SF_ORG || 'admin@example.com'} --json`,
        { timeout: 15000 }
      );
      const accData = JSON.parse(runQ(accountQuery).toString()).result;
      const oppData = JSON.parse(runQ(oppQuery).toString()).result;
      const cidData = JSON.parse(runQ(clientIdQuery).toString()).result;
      return res.json({ accounts: buildAccounts(accData, oppData, cidData) });
    } catch (err) {
      return res.status(500).json({ error: `SF CLI error: ${err.message}` });
    }
  }

  if (!sfdcToken || !sfdcInstance) {
    return res.status(400).json({ error: "Missing sfdcToken or sfdcInstance" });
  }

  // ── REST API ─────────────────────────────────────────────────────────────────
  try {
    const headers = { Authorization: `Bearer ${sfdcToken}`, "Content-Type": "application/json" };
    const qurl = (q) => `${sfdcInstance}/services/data/v59.0/query?q=${encodeURIComponent(q)}`;

    const [accRes, oppRes, cidRes] = await Promise.all([
      fetch(qurl(accountQuery), { headers }),
      fetch(qurl(oppQuery),     { headers }),
      fetch(qurl(clientIdQuery),{ headers }),
    ]);

    if (accRes.status === 401 || oppRes.status === 401) {
      return res.status(401).json({ error: "SFDC token expired", code: "token_expired" });
    }
    if (!accRes.ok) {
      const err = await accRes.text();
      return res.status(accRes.status).json({ error: err });
    }
    if (!oppRes.ok) {
      const err = await oppRes.text();
      return res.status(oppRes.status).json({ error: err });
    }

    const [accData, oppData, cidData] = await Promise.all([
      paginate(sfdcInstance, headers, await accRes.json()),
      paginate(sfdcInstance, headers, await oppRes.json()),
      cidRes.ok ? paginate(sfdcInstance, headers, await cidRes.json()) : { records: [] },
    ]);

    return res.json({ accounts: buildAccounts(accData, oppData, cidData) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function buildAccounts(accData, oppData, cidData) {
  // Index opps by AccountId — keep the most recent (oppQuery sorts CreatedDate DESC, so first wins)
  const oppByAccount = {};
  for (const opp of (oppData.records || [])) {
    if (!opp.AccountId) continue;
    if (!oppByAccount[opp.AccountId]) oppByAccount[opp.AccountId] = opp;
  }

  // Index client IDs by AccountId
  const clientIdsByAccount = {};
  for (const cid of (cidData.records || [])) {
    if (!cid.Account__c) continue;
    if (!clientIdsByAccount[cid.Account__c]) clientIdsByAccount[cid.Account__c] = [];
    clientIdsByAccount[cid.Account__c].push({
      id: cid.Name,
      productionEnabled: cid.ProductionEnabled__c,
      enabledProducts: cid.Enabled_Products__c,
    });
  }

  const baseUrl = "https://your-org.lightning.force.com/lightning/r";

  return (accData.records || []).map(acc => {
    const opp = oppByAccount[acc.Id] || null;
    const sfdcUrl = opp
      ? `${baseUrl}/Opportunity/${opp.Id}/view`
      : `${baseUrl}/Account/${acc.Id}/view`;

    return {
      sfdcOppId:        opp?.Id || null,
      sfdcAccountId:    acc.Id,
      name:             acc.Name || opp?.Name || "",
      web:              acc.Website || null,
      vert:             acc.Industry || null,
      state:            acc.BillingState || null,
      city:             acc.BillingCity || null,
      stage:            opp ? mapSfdcStage(opp.StageName) : "Prospecting",
      sfdcStage:        opp?.StageName || null,
      sfdc:             sfdcUrl,
      closeDate:        opp?.CloseDate || null,
      acv:              opp?.Amount || null,
      source:           opp ? mapLeadSource(opp.LeadSource, opp.Deal_Source__c) : "SFDC",
      isHandoff:        opp?.AE_Handoff_Meeting_Completed__c === true,
      nbaNotes:         opp?.NBA_Notes__c || null,
      leadSourceDetail: opp?.Lead_Source_Details__c || null,
      clientIds:        (clientIdsByAccount[acc.Id] || []).map(c => c.id),
      clientIdDetails:  clientIdsByAccount[acc.Id] || [],
    };
  });
}
