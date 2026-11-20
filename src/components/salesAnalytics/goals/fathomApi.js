// fathom-notes-v1 - the Fathom connection routes (/api/sales/:businessId/fathom). No reply carries the key or the
// webhook secret. userId: an Owner acting for another member; left out, the caller's own connection.
async function call(businessId, path = '', { method = 'GET', body } = {}) {
  const res = await fetch(`/api/sales/${businessId}/fathom${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}
const post = (id, path, userId, extra = {}) => call(id, path, { method: 'POST', body: { ...extra, ...(userId ? { user_id: userId } : {}) } });

export const fathomApi = {
  status: id => call(id),
  connect: (id, key, userId = null) => post(id, '/connect', userId, { key }),
  test: (id, userId = null) => post(id, '/test', userId),
  register: (id, userId = null) => post(id, '/webhook', userId),
  pull: (id, userId = null) => post(id, '/pull', userId),
  disconnect: (id, userId = null) => post(id, '/disconnect', userId),
  setCap: (id, cap) => call(id, '/cap', { method: 'PUT', body: { cap } }),
  // "Extract" on a stored recording with no proposal yet: one model call under the workspace's daily cap -> the review.
  extractNote: (id, noteId) => call(id, `/notes/${noteId}/extract`, { method: 'POST', body: {} }),
};
