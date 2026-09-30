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
