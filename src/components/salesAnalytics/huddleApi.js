// Thin fetch wrappers for api/sales/huddleRoutes.js. Access is checked
// server-side (api/lib/requireAuth.js salesGate).

async function call(url, options, fallback) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `${fallback} (${res.status})`), { status: res.status, data });
  return data;
}

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function fetchHuddle(businessId) {
  return call(`/api/sales/${businessId}/huddle`, undefined, 'Failed to load huddle');
}

export async function updateProspect(businessId, contactId, payload) {
  const data = await call(`/api/sales/${businessId}/prospects/${contactId}`,
    json('PATCH', payload), 'Failed to update prospect');
  return data.prospect;
}

export async function startHuddle(businessId) {
  const data = await call(`/api/sales/${businessId}/huddles`, json('POST', {}), 'Failed to start huddle');
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
    json('POST', payload), 'Failed to add to pipeline');
}

// sales-huddle-v2 Stage 2 - newest-first opens / clicks / replies.
export async function fetchHuddleFeed(businessId, { days = 7, before } = {}) {
  const q = new URLSearchParams({ days: String(days), ...(before ? { before } : {}) });
  return call(`/api/sales/${businessId}/huddle/feed?${q}`, undefined, 'Failed to load activity');
}

// sales-huddle-v2 Stage 3 - "Flag for ...": a Goals to-do with a checklist.
export async function fetchFlags(businessId) {
  return (await call(`/api/sales/${businessId}/huddle/flags`, undefined, 'Failed to load flags')).flags;
}
export async function flagProspect(businessId, contactId, body) {
  return call(`/api/sales/${businessId}/prospects/${contactId}/flag`, json('POST', body), 'Failed to flag');
}
export async function unflag(businessId, goalId, restoreOwner, expectOwner) {
  const q = restoreOwner ? `?restore_owner=${restoreOwner}&expect_owner=${expectOwner}` : '';
  return call(`/api/sales/${businessId}/flags/${goalId}${q}`, { method: 'DELETE' }, 'Failed to undo the flag');
}
export async function reassignFlag(businessId, goalId, assigneeUserId) {
  return call(`/api/sales/${businessId}/flags/${goalId}/reassign`, json('POST', { assignee_user_id: assigneeUserId }), 'Failed to reassign');
}
// Lets the tab badge and the Huddle lane refresh after any flag change.
export const FLAGS_CHANGED = 'prospector:flags-changed';
export const announceFlagsChanged = () => window.dispatchEvent(new Event(FLAGS_CHANGED));
