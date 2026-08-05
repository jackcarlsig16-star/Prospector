export const config = { maxDuration: 15 };

// Validate Client IDs look like MongoDB ObjectIDs (24 hex chars) before interpolating.
const VALID_CLIENT_ID = /^[a-f0-9]{24}$/i;

function mapSfdcToCompliance(record) {
  const stage          = record.Production_Request_Compliance_Stage__c || "";
  const readyForReview = record.Production_Ready_For_Review__c;
  const secStatus      = (record.Security_Diligence_SDR_Status__c || "").toUpperCase();

  let prodRequestStatus = "Not Started";
  if (stage === "APPROVED")                         prodRequestStatus = "Approved";
  else if (stage === "REJECTED")                    prodRequestStatus = "Blocked";
  else if (readyForReview)                          prodRequestStatus = "Submitted";
  else if (stage && stage !== "")                   prodRequestStatus = "In Progress";

  let secQStatus = "Not Started";
  if (secStatus === "APPROVED")                     secQStatus = "Approved";
  else if (secStatus === "REJECTED")                secQStatus = "Blocked";
  else if (secStatus === "IN_REVIEW" ||
           secStatus === "IN REVIEW")               secQStatus = "In Progress";
  else if (secStatus === "SUBMITTED")               secQStatus = "Submitted";
  else if (secStatus && secStatus !== "")           secQStatus = "In Progress";

  return {
    prodRequest:      { status: prodRequestStatus, note: record.Request_For_Information__c || null },
    securityQ:        { status: secQStatus },
    sfdcId:           record.Id,
    sfdcName:         record.Name,
    wadsworthLink:    record.Wadsworth_Client_Link__c || null,
    productsApproved: record.Products_Approved__c    || null,
    productsInReview: record.Products_In_Review__c   || null,
    productsRFI:      record.Products_RFI__c         || null,
    productsRejected: record.Products_Rejected__c    || null,
    diligenceFlow:    record.Diligence_Flow__c       || null,
    buildingStage:    record.Building_Stage__c       || null,
    rawStage:         stage,
    rawSecurityStatus: record.Security_Diligence_SDR_Status__c || null,
  };
}

const FIELDS = [
  "Id", "Name",
  "Production_Request_Compliance_Stage__c",
  "Production_Ready_For_Review__c",
  "Security_Diligence_SDR_Status__c",
  "Request_For_Information__c",
  "Building_Stage__c",
  "Planned_Products__c",
  "Products_Approved__c",
  "Products_In_Review__c",
  "Products_RFI__c",
  "Products_Rejected__c",
  "Diligence_Flow__c",
  "Wadsworth_Client_Link__c",
  "Opportunity__c",
].join(", ");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { clientId, sfdcToken, sfdcInstance } = req.body;

  if (!clientId) return res.status(400).json({ error: "Missing clientId" });
  if (!VALID_CLIENT_ID.test(clientId)) return res.status(400).json({ error: "Invalid clientId format" });

  // ── SF CLI fallback (local dev only, SF_CLI_MODE=true in .env) ───────────────
  if (!sfdcToken && process.env.SF_CLI_MODE === "true") {
    try {
      const { execSync } = await import("child_process");
      const query = `SELECT ${FIELDS} FROM ProductionRequest__c WHERE Client_ID__r.Name = '${clientId}' ORDER BY CreatedDate DESC LIMIT 1`;
      const out = execSync(
        `sf data query --query "${query}" --target-org ${process.env.SF_ORG || 'admin@example.com'} --json`,
        { timeout: 12000 }
      );
      const parsed = JSON.parse(out.toString());
      const records = parsed?.result?.records || [];
      if (!records.length) return res.json({ found: false });
      const compliance = mapSfdcToCompliance(records[0]);
      return res.json({ found: true, compliance, raw: records[0] });
    } catch (err) {
      return res.status(500).json({ error: `SF CLI error: ${err.message}` });
    }
  }

  if (!sfdcToken || !sfdcInstance) {
    return res.status(400).json({ error: "Missing sfdcToken or sfdcInstance" });
  }

  // ── REST API (production) ─────────────────────────────────────────────────────
  const query = `SELECT ${FIELDS} FROM ProductionRequest__c WHERE Client_ID__r.Name = '${clientId}' ORDER BY CreatedDate DESC LIMIT 1`;

  try {
    const url = `${sfdcInstance}/services/data/v59.0/query?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${sfdcToken}`, "Content-Type": "application/json" },
    });

    if (response.status === 401) {
      return res.status(401).json({ error: "SFDC token expired", code: "token_expired" });
    }
    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    if (Array.isArray(data) && data[0]?.errorCode) {
      return res.status(400).json({ error: data[0].message || "SFDC query error" });
    }

    const record = data.records?.[0] || null;
    if (!record) return res.json({ found: false });

    const compliance = mapSfdcToCompliance(record);
    return res.json({ found: true, compliance, raw: record });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
