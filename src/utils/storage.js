export const COMPLIANCE_KEY = "prospector_compliance";
export const STAGED_ACCOUNTS_KEY = "prospector_staged_accounts";

export const getStagedAccounts = () => { try { return JSON.parse(localStorage.getItem(STAGED_ACCOUNTS_KEY)||"{}"); } catch { return {}; } };
export const getStagedAccount  = (evId) => { try { return getStagedAccounts()[String(evId)] || null; } catch { return null; } };
export const setStagedAccount  = (evId, data) => { try { const all = getStagedAccounts(); all[String(evId)] = data; localStorage.setItem(STAGED_ACCOUNTS_KEY, JSON.stringify(all)); } catch {} };

export const STANDARD_STEPS = [
  { id: "prod_request", label: "Production Request" },
  { id: "security_q",   label: "Security Questionnaire" },
  { id: "live",         label: "Live" },
];
export const PARTNER_STEPS = [
  { id: "prod_request", label: "Production Request" },
  { id: "security_q",   label: "Security Questionnaire" },
  { id: "partner_q",    label: "Partner Questionnaire" },
  { id: "live",         label: "Live" },
];
export const GAMING_STEPS = [
  { id: "uscomp_ticket",   label: "USCO Compliance Ticket", short: "USCO" },
  { id: "gaming_approved", label: "Gaming Approval",        short: "Gaming OK" },
];
export const STEP_STATUSES = ["Not Started","In Progress","Submitted","Approved","Blocked"];

export const getCompliance = (accId) => {
  try {
    const all = JSON.parse(localStorage.getItem(COMPLIANCE_KEY)||"{}");
    return all[accId] || null;
  } catch { return null; }
};
export const saveCompliance = (accId, data) => {
  try {
    const all = JSON.parse(localStorage.getItem(COMPLIANCE_KEY)||"{}");
    all[accId] = data;
    localStorage.setItem(COMPLIANCE_KEY, JSON.stringify(all));
  } catch {}
};
export const getAllCompliance = () => {
  try { return JSON.parse(localStorage.getItem(COMPLIANCE_KEY)||"{}"); } catch { return {}; }
};
