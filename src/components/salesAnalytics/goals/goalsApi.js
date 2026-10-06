// Thin fetch wrappers for /api/sales/:businessId/goals/* (api/sales/
// goalsRoutes.js + goalsReportRoutes.js). 0 Apollo calls - every route
// reads synced data.

// Raised when the server's tables are older than this code (the Stage 4
// migration adds sales_metric_targets.actual and the KPI metric keys), so
// a view can say so instead of showing a raw database error.
export class NeedsMigrationError extends Error {
  constructor() {
    super('This needs a database update that hasn’t been run yet.');
    this.needsMigration = true;
  }
}
const MIGRATION_PATTERN = /does not exist|schema cache|violates check constraint "sales_metric_targets_metric_key_check"/;

async function call(businessId, path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/sales/${businessId}/goals${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 500 && MIGRATION_PATTERN.test(data.error || '')) throw new NeedsMigrationError();
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

const q = params => new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();

export const goalsApi = {
  members: id => call(id, '/members').then(d => d.members),

  weekGoals: (id, from, to, kind) => call(id, `/week?${q({ from, to, kind })}`).then(d => d.goals),
  createWeekGoal: (id, body) => call(id, '/week', { method: 'POST', body }).then(d => d.goal),
  updateWeekGoal: (id, goalId, body) => call(id, `/week/${goalId}`, { method: 'PATCH', body }).then(d => d.goal),
  deleteWeekGoal: (id, goalId) => call(id, `/week/${goalId}`, { method: 'DELETE' }),
  carryOver: (id, weekStart, kind) => call(id, '/week/carry-over', { method: 'POST', body: { week_start: weekStart, kind } }),

  createStep: (id, goalId, body) => call(id, `/week/${goalId}/steps`, { method: 'POST', body }).then(d => d.step),
  updateStep: (id, stepId, body) => call(id, `/steps/${stepId}`, { method: 'PATCH', body }).then(d => d.step),

  partners: id => call(id, '/land?goal_type=partnership').then(d => d.goals),
  createPartner: (id, body) => call(id, '/land', { method: 'POST', body: { goal_type: 'partnership', ...body } }).then(d => d.goal),
  updatePartner: (id, goalId, body) => call(id, `/land/${goalId}`, { method: 'PATCH', body }).then(d => d.goal),

  companies: (id, from, to) => call(id, `/companies?${q({ from, to })}`),
  updateCompany: (id, accountId, body) => call(id, `/companies/${encodeURIComponent(accountId)}`, { method: 'PATCH', body }).then(d => d.company),

  cadences: (id, from, to) => call(id, `/cadences?${q({ from, to })}`).then(d => d.cadences),
  createCadence: (id, body) => call(id, '/cadences', { method: 'POST', body }).then(d => d.cadence),
  deleteCadence: (id, cadenceId) => call(id, `/cadences/${cadenceId}`, { method: 'DELETE' }),

  scorecard: (id, month, owner) => call(id, `/scorecard?${q({ month, owner })}`),
  saveTarget: (id, body) => call(id, '/targets', { method: 'PUT', body }).then(d => d.target),
};
