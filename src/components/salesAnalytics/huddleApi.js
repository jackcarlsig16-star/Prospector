// Thin fetch wrappers for api/sales/huddleRoutes.js. Every route already
// 403s a non-allowlisted business server-side.

async function call(url, options, fallback) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${fallback} (${res.status})`);
  return data;
}

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Self-reported, not verified - there's no server-side identity yet.
// Same source EmailModal.js reads for the current user.
export function currentUserLabel() {
  for (const key of ['prospector_user', 'prospector_member']) {
    try {
      const u = JSON.parse(localStorage.getItem(key) || 'null');
      if (u && (u.email || u.name)) return u.email || u.name;
    } catch {}
  }
  return 'unknown';
}

export async function fetchHuddle(businessId) {
  return call(`/api/sales/${businessId}/huddle`, undefined, 'Failed to load huddle');
}

export async function updateProspect(businessId, contactId, payload) {
  const data = await call(`/api/sales/${businessId}/prospects/${contactId}`,
    json('PATCH', { ...payload, updated_by: currentUserLabel() }), 'Failed to update prospect');
  return data.prospect;
}

export async function startHuddle(businessId) {
  const data = await call(`/api/sales/${businessId}/huddles`, json('POST', { started_by: currentUserLabel() }), 'Failed to start huddle');
  return data.huddle;
}

export async function fetchCollateral(businessId) {
  const data = await call(`/api/sales/${businessId}/collateral`, undefined, 'Failed to load collateral');
  return data.collateral || [];
}

export async function createCollateral(businessId, payload) {
  const data = await call(`/api/sales/${businessId}/collateral`, json('POST', payload), 'Failed to add collateral');
  return data.item;
}

export async function updateCollateral(businessId, id, payload) {
  const data = await call(`/api/sales/${businessId}/collateral/${id}`, json('PATCH', payload), 'Failed to update collateral');
  return data.item;
}

export async function deleteCollateral(businessId, id) {
  return call(`/api/sales/${businessId}/collateral/${id}`, { method: 'DELETE' }, 'Failed to delete collateral');
}

export async function addProspectToPipeline(businessId, contactId, payload) {
  return call(`/api/sales/${businessId}/prospects/${contactId}/pipeline`,
    json('POST', { ...payload, updated_by: currentUserLabel() }), 'Failed to add to pipeline');
}
