export const WIN_REASONS = [
  "Brand/reputation/referral",
  "Conversion",
  "Data insights",
  "Data partner/institution coverage",
  "Data quality/accuracy",
  "Ease/speed of implementation",
  "End user experience",
  "Fraud mitigation",
  "Full suite solution/vendor consolidation",
  "Integration with other platforms/vendors",
  "Integration with existing partner",
  "OAuth coverage",
  "Pricing",
  "Reliability/uptime",
  "Security/data privacy",
  "Support quality",
  "Other",
];

export const winReasonKey = id => `prospector_win_reasons_${id}`;

export function loadWinReason(id) {
  try { return JSON.parse(localStorage.getItem(winReasonKey(id)) || 'null'); } catch { return null; }
}

export function saveWinReason(id, data) {
  try { localStorage.setItem(winReasonKey(id), JSON.stringify({ ...data, savedAt: new Date().toISOString() })); } catch {}
}
