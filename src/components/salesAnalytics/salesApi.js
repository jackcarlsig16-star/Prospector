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
// current tags, so a Partner toggle is reflected the moment this is
// re-fetched (no sync required). 0 Apollo calls.
export async function fetchCohortBreakdown(businessId) {
  const res = await fetch(`/api/sales/${businessId}/cohort-breakdown`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load cohort breakdown (${res.status})`);
  return data;
}

// dashboard-v2 Stage 4 uses this for the Partner toggle; defined here now
// (Stage 2 built the route) so Stage 3's verification can exercise the
// real PUT without waiting for the leaderboard UI to exist.
export async function setSequencePartner(businessId, sequenceId, isPartner) {
  const res = await fetch(`/api/sales/${businessId}/sequence-tags/${sequenceId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_partner: isPartner }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Failed to set Partner tag (${res.status})`);
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
