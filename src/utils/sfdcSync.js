const STEP_PRIORITY = { "Not Started": 0, "In Progress": 1, "Submitted": 2, "Approved": 3, "Blocked": 1.5 };

export async function syncComplianceFromSFDC(acc, data, updateAndSave) {
  const clientId = (acc.clientIds || [])[0];
  if (!clientId) return { status: "no_client_id" };

  const sfdcToken    = localStorage.getItem("sfdc_access_token");
  const sfdcInstance = localStorage.getItem("sfdc_instance_url");
  if (!sfdcToken || !sfdcInstance) return { status: "no_token" };

  let res;
  try {
    res = await fetch("/api/sfdc/production-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, sfdcToken, sfdcInstance }),
    });
  } catch (err) {
    return { status: "error", message: err.message };
  }

  if (res.status === 401) return { status: "token_expired" };
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { status: "error", message: err.error || `HTTP ${res.status}` };
  }

  const json = await res.json();
  if (!json.found) return { status: "not_found" };

  const sfdc = json.compliance;

  const mergeStatus = (current, incoming) => {
    const cp = STEP_PRIORITY[current] ?? 0;
    const ip = STEP_PRIORITY[incoming] ?? 0;
    return ip > cp ? incoming : current;
  };

  const now = new Date().toISOString();
  const newSteps = (data.steps || []).map(s => {
    if (s.id === "prod_request" && sfdc.prodRequest?.status) {
      const merged = mergeStatus(s.status, sfdc.prodRequest.status);
      const u = { ...s, sfdcSynced: true };
      if (merged !== s.status) {
        u.status = merged;
        if (merged !== "Not Started" && !s.startedAt) u.startedAt = now;
        if (merged === "Approved" && !s.completedAt) u.completedAt = now;
      }
      if (sfdc.prodRequest.note && !s.notes) u.notes = sfdc.prodRequest.note;
      return u;
    }
    if (s.id === "security_q" && sfdc.securityQ?.status) {
      const merged = mergeStatus(s.status, sfdc.securityQ.status);
      const u = { ...s, sfdcSynced: true };
      if (merged !== s.status) {
        u.status = merged;
        if (merged !== "Not Started" && !s.startedAt) u.startedAt = now;
        if (merged === "Approved" && !s.completedAt) u.completedAt = now;
      }
      return u;
    }
    return s;
  });

  const extras = {};
  if (sfdc.wadsworthLink)    extras.wadsworthLink    = sfdc.wadsworthLink;
  if (sfdc.productsApproved) extras.productsApproved = sfdc.productsApproved;
  if (sfdc.productsInReview) extras.productsInReview = sfdc.productsInReview;
  if (sfdc.productsRFI)      extras.productsRFI      = sfdc.productsRFI;
  if (sfdc.productsRejected) extras.productsRejected = sfdc.productsRejected;

  updateAndSave({ ...data, steps: newSteps, ...extras, lastSfdcSync: now });
  return { status: "ok", result: sfdc };
}
