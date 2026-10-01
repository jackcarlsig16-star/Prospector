// Thin fetch wrappers for the 3 routes api/sales/routes.js exposes. Every
// route already 403s a non-allowlisted business server-side (Stage 2) -
// nothing extra needed here.

export async function fetchMetrics(businessId, from, to) {
  const res = await fetch(`/api/sales/${businessId}/metrics?from=${from}&to=${to}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load metrics (${res.status})`);
  return data.metrics || [];
}

export async function fetchRuns(businessId, limit = 10) {
  const res = await fetch(`/api/sales/${businessId}/runs?limit=${limit}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load runs (${res.status})`);
  return data.runs || [];
}

// sales-analytics-core-names-fix-v1 Part B - name/cohort/address lookup,
// reads the latest raw snapshot server-side, 0 Apollo calls.
export async function fetchEntities(businessId) {
  const res = await fetch(`/api/sales/${businessId}/entities`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load entities (${res.status})`);
  return data;
}

// dashboard-v2 Stage 2 - cohort x {direct, partner} company counts,
// computed server-side at read time from the latest accounts snapshot +
// current tags, so an audience change is reflected the moment this is
// re-fetched (no sync required). 0 Apollo calls.
export async function fetchCohortBreakdown(businessId) {
  const res = await fetch(`/api/sales/${businessId}/cohort-breakdown`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load cohort breakdown (${res.status})`);
  return data;
}

// sales-sequence-motion-v1 - replaces setSequencePartner({is_partner}).
// audience must be one of 'employer'|'membership'|'channel_partner'
// (server validates too - this is just the real call shape).
export async function setSequenceAudience(businessId, sequenceId, audience) {
  const res = await fetch(`/api/sales/${businessId}/sequence-tags/${sequenceId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audience }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Failed to set audience (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data.tag;
}

export async function triggerSync(businessId) {
  const res = await fetch(`/api/sales/${businessId}/sync`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Sync failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data.run;
}

// sales-email-trend-v1 REV2 - stored daily counts and chart events. Both
// read the DB only; zero Apollo calls.
export async function fetchEmailCounts(businessId) {
  const res = await fetch(`/api/sales/${businessId}/email-counts`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load email counts (${res.status})`);
  return data;
}

export async function fetchSalesEvents(businessId) {
  const res = await fetch(`/api/sales/${businessId}/events`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load events (${res.status})`);
  return data.events || [];
}

export async function createSalesEvent(businessId, payload) {
  const res = await fetch(`/api/sales/${businessId}/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to add event (${res.status})`);
  return data.event;
}

export async function fetchInsights(businessId) {
  const res = await fetch(`/api/sales/${businessId}/insights`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load insights (${res.status})`);
  return data;
}

export async function dismissInsight(businessId, payload) {
  const res = await fetch(`/api/sales/${businessId}/insights/dismiss`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to dismiss (${res.status})`);
  return data.dismissal;
}
