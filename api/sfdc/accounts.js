export const config = { maxDuration: 20 };

// Allowed modes to prevent SOQL injection via the mode param
const ALLOWED_MODES = new Set(["my_accounts", "dormant"]);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { access_token, instance_url, user_id, mode } = req.body;

  if (!access_token || !instance_url) {
    return res.status(400).json({ error: "Missing access_token or instance_url" });
  }

  if (!ALLOWED_MODES.has(mode)) {
    return res.status(400).json({ error: "Invalid mode. Use 'my_accounts' or 'dormant'." });
  }

  // Build SOQL — no user-supplied values interpolated into the query body,
  // only user_id which comes from the server-side identity token exchange.
  // We validate it matches a SFDC ID format before interpolating.
  if (user_id && !/^[a-zA-Z0-9]{15,18}$/.test(user_id)) {
    return res.status(400).json({ error: "Invalid user_id format" });
  }

  const SUBQUERY = "(SELECT StageName FROM Opportunities WHERE IsClosed = false ORDER BY LastModifiedDate DESC LIMIT 1)";
  const SELECT_FULL  = `SELECT Id, Name, Website, Owner.Name, BillingState, Vertical__c, Client_ID__c, LastActivityDate, ${SUBQUERY}`;
  const SELECT_SHORT = `SELECT Id, Name, Website, Owner.Name, BillingState, Vertical__c, LastActivityDate, ${SUBQUERY}`;
  const FROM = "FROM Account";

  let where;
  if (mode === "dormant") {
    where = `WHERE OwnerId != '${user_id}' AND (LastActivityDate = null OR LastActivityDate < LAST_N_DAYS:180)`;
  } else {
    where = user_id ? `WHERE OwnerId = '${user_id}'` : "WHERE OwnerId != null";
  }

  const ORDER = mode === "dormant"
    ? "ORDER BY LastActivityDate ASC NULLS FIRST"
    : "ORDER BY LastActivityDate DESC NULLS LAST";

  const LIMIT = mode === "dormant" ? "LIMIT 200" : "LIMIT 500";

  const runQuery = async (select) => {
    const soql = `${select} ${FROM} ${where} ${ORDER} ${LIMIT}`;
    const r = await fetch(
      `${instance_url}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
      { headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" } }
    );
    return { res: r, data: await r.json() };
  };

  try {
    let { res: queryRes, data } = await runQuery(SELECT_FULL);

    // Client_ID__c may not exist in all orgs — retry without it
    if (!queryRes.ok) {
      const msg = Array.isArray(data) ? (data[0]?.message || "") : (data.message || "");
      if (msg.includes("Client_ID__c")) {
        ({ res: queryRes, data } = await runQuery(SELECT_SHORT));
      }
    }

    if (!queryRes.ok) {
      const errMsg = Array.isArray(data) ? data[0]?.message : (data.message || "SFDC query failed");
      return res.status(queryRes.status).json({ error: errMsg });
    }

    const accounts = (data.records || []).map(r => ({
      id: `sfdc_${r.Id}`,
      sfdc: r.Id,
      name: r.Name || "",
      web: r.Website || "",
      owner: r.Owner?.Name || "",
      state: r.BillingState || "",
      vert: r.Vertical__c || "",
      clientIds: r.Client_ID__c ? [r.Client_ID__c] : [],
      last: r.LastActivityDate || "",
      sfdcStageName: r.Opportunities?.records?.[0]?.StageName || null,
      source: "sfdc",
      pool: mode === "dormant",
      score: null,
      tier: null,
      analyzing: false,
      analyzed: false,
      bm: "", pf: "", sigs: [], ucs: [], prods: [], dis: null,
    }));

    return res.status(200).json({ accounts, total: data.totalSize || accounts.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
