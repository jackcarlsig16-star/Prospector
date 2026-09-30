// Server-side businessId allowlist - the real access gate for this feature,
// since there is no real auth (audit A1b: the app gate is a localStorage
// flag, nothing about identity is verified). Every /api/sales/* route 403s
// any businessId not in this list. Comma-separated env var, set in Render
// by Jack directly - never written by this session.

export function getAllowlistedBusinessIds() {
  return (process.env.SALES_ANALYTICS_BUSINESS_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function isAllowlistedBusiness(businessId) {
  return getAllowlistedBusinessIds().includes(businessId);
}
