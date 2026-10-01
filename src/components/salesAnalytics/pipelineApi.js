// Thin fetch wrappers for api/sales/pipelineRoutes.js. Same shape as
// salesApi.js's wrappers - every route already 403s a non-allowlisted
// business server-side, nothing extra needed here.

export async function fetchOpportunities(businessId, { includeArchived = false } = {}) {
  const qs = includeArchived ? '?include_archived=true' : '';
  const res = await fetch(`/api/sales/${businessId}/opportunities${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load opportunities (${res.status})`);
  return data.opportunities || [];
}

export async function createOpportunity(businessId, payload) {
  const res = await fetch(`/api/sales/${businessId}/opportunities`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to create opportunity (${res.status})`);
  return data.opportunity;
}

export async function updateOpportunity(businessId, id, payload) {
  const res = await fetch(`/api/sales/${businessId}/opportunities/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to update opportunity (${res.status})`);
  return data.opportunity;
}

export async function archiveOpportunity(businessId, id) {
  const res = await fetch(`/api/sales/${businessId}/opportunities/${id}/archive`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to archive opportunity (${res.status})`);
  return data.opportunity;
}

export async function importOpportunitiesCsv(businessId, csvText) {
  const res = await fetch(`/api/sales/${businessId}/opportunities/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: csvText }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`);
  return data; // { inserted, updated, errors }
}

export async function fetchMovement(businessId, from, to) {
  const res = await fetch(`/api/sales/${businessId}/opportunities/movement?from=${from}&to=${to}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load movement (${res.status})`);
  return data; // { moved_forward, moved_back, added, lost, stalled }
}

export function templateUrl(businessId) {
  return `/api/sales/${businessId}/opportunities/template`;
}
