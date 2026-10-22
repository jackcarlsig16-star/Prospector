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

// task-drawer-v1 - the Tasks drawer and Goals -> This week show the same
// to-dos at once; any to-do/step write tells the other to reload.
export const TODOS_CHANGED = 'prospector:todos-changed';
// "Open in Sales" from the drawer when Sales & Marketing is already on screen.
export const OPEN_GOALS_WEEK = 'prospector:open-goals-week';
// Opens the drawer filtered to one link; detail = { link: { type, id }, filter, view? }.
export const OPEN_TASKS = 'prospector:open-tasks';
// From the drawer into Sales & Marketing with a link target (GoalsTab go()); detail = { target }.
export const OPEN_GOALS_TARGET = 'prospector:open-goals-target';

async function call(businessId, path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/sales/${businessId}/goals${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 500 && MIGRATION_PATTERN.test(data.error || '')) throw new NeedsMigrationError();
    throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  }
  if (method !== 'GET' && /^\/(week|steps)\b|^\/call-notes$|^\/prospect-targets\/.+\/(promote|reject)$|^\/tidy\/run$|^\/waiting\/.+\/nudge$|^\/(partners|company\/[a-z]+)\/.+\/apollo-check$|^\/company\/add-to-pipeline$|^\/suggestions\/.+\/(accept|dismiss|snooze|undo)$|^\/signals\/(scout-import|.+\/(accept|dismiss|undo))$|^\/visits\/pull$/.test(path)) window.dispatchEvent(new Event(TODOS_CHANGED));
  return data;
}

const q = params => new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();

export const goalsApi = {
  members: id => call(id, '/members').then(d => d.members),

  weekGoals: (id, from, to, kind) => call(id, `/week?${q({ from, to, kind })}`).then(d => d.goals),
  createWeekGoal: (id, body) => call(id, '/week', { method: 'POST', body }).then(d => d.goal),
  updateWeekGoal: (id, goalId, body) => call(id, `/week/${goalId}`, { method: 'PATCH', body }).then(d => d.goal),
  deleteWeekGoal: (id, goalId) => call(id, `/week/${goalId}`, { method: 'DELETE' }),
  proposePlan: (id, body) => call(id, '/week/plan/propose', { method: 'POST', body }),
  savePlan: (id, body) => call(id, '/week/plan/save', { method: 'POST', body }),
  weekPlans: (id, ownerId) => call(id, `/week/plans?${q({ owner_user_id: ownerId })}`).then(d => d.plans),
  carryOver: (id, weekStart, kind) => call(id, '/week/carry-over', { method: 'POST', body: { week_start: weekStart, kind } }),

  // call-notes-to-tasks-v1 - extract writes nothing; create stores the note + the kept to-dos.
  extractCallNotes: (id, body) => call(id, '/call-notes/extract', { method: 'POST', body }),
  createFromCallNotes: (id, body) => call(id, '/call-notes', { method: 'POST', body }),
  // call-notes-targets-v1 - companies from notes that aren't a partner or employer yet.
  prospectTargets: id => call(id, '/prospect-targets').then(r => r.targets),
  // Stage 2 - promote = { created | already }; reject drops its open to-dos, { undo: true, reopen } puts it back.
  promoteTarget: (id, targetId, body) => call(id, `/prospect-targets/${targetId}/promote`, { method: 'POST', body }),
  rejectTarget: (id, targetId, body = {}) => call(id, `/prospect-targets/${targetId}/reject`, { method: 'POST', body }),
  // Copy for Claude - markdown with no emails or phones (the route refuses otherwise). 0 AI calls.
  copyBundle: (id, type, recordId) => call(id, `/copy-bundle?${q({ type, id: recordId })}`).then(d => d.markdown),
  callNote: (id, noteId) => call(id, `/call-notes/${noteId}`).then(d => d.note),
  // call-notes-targets-v1 Stage 3 - Tidy. suggestions = { suggestions (proposed), last_run };
  // run = { ran, created, skipped } or { ran: false, reason, last_run }; force = "Tidy now". 0 AI, 0 Apollo.
  suggestions: id => call(id, '/suggestions'),
  runTidy: (id, { force = false, trigger = 'manual' } = {}) => call(id, '/tidy/run', { method: 'POST', body: { force, trigger } }),
  // FIX actions-done-button-v1: { done: true } = the to-do is born done; a partner-linked one logs an email touch (touch_event_id back).
  acceptSuggestion: (id, sid, { done = false } = {}) => call(id, `/suggestions/${sid}/accept`, { method: 'POST', body: done ? { done: true } : {} }),
  dismissSuggestion: (id, sid) => call(id, `/suggestions/${sid}/dismiss`, { method: 'POST', body: {} }),
  snoozeSuggestion: (id, sid) => call(id, `/suggestions/${sid}/snooze`, { method: 'POST', body: {} }),
  // sales-ia-v2 A1 - back to proposed within 10 min; todo_id = the to-do Accept returned (deleted if still open).
  undoSuggestion: (id, sid, todoId, touchEventId) => call(id, `/suggestions/${sid}/undo`, { method: 'POST', body: { ...(todoId ? { todo_id: todoId } : {}), ...(touchEventId ? { touch_event_id: touchEventId } : {}) } }),
  // signals-v1 Stage 2 - the Signals review queue. scoutImport: dryRun = preview, nothing written.
  // accept = { signal, todo, via, record }; dismiss parks the company 7 days. 0 AI, 0 Apollo.
  signals: (id, status = 'new') => call(id, `/signals?${q({ status })}`).then(d => d.signals),
  scoutImport: (id, file, dryRun) => call(id, '/signals/scout-import', { method: 'POST', body: { file, dryRun } }),
  acceptSignal: (id, sid, { done = false } = {}) => call(id, `/signals/${sid}/accept`, { method: 'POST', body: done ? { done: true } : {} }),
  dismissSignal: (id, sid) => call(id, `/signals/${sid}/dismiss`, { method: 'POST', body: {} }),
  // sales-ia-v2 A1 - a just-accepted / dismissed signal back to new (its to-do, target or note come off too).
  undoSignal: (id, sid, touchEventId) => call(id, `/signals/${sid}/undo`, { method: 'POST', body: touchEventId ? { touch_event_id: touchEventId } : {} }),
  // sales-ia-v2 A1 - the Actions list: { items, today, week_start }; items ranked overdue -> P1..P4 -> due. 0 AI, 0 Apollo.
  actions: id => call(id, '/actions'),
  // sales-ia-v2 D1 - the Dashboard's 13 chart series in one read; days 7 | 30 | 90, owner = a member's user id, team = owner_team. 0 AI, 0 Apollo.
  dashboard: (id, { days, owner, team }) => call(id, `/dashboard?${q({ days, owner, team })}`),
  // signals-v1 Stage 4 - the daily website-visitor pull (Members) and its status (Viewers too).
  visitPull: (id, { force = false, trigger = 'manual' } = {}) => call(id, '/visits/pull', { method: 'POST', body: { force, trigger } }),
  visitStatus: id => call(id, '/visits/status'),
  // signals-v1 Stage 5 - the Website visitors report, Brad's .xlsx (fetched as a blob) and the skip list.
  visitReport: id => call(id, '/visits/report'),
  visitExportUrl: id => `/api/sales/${id}/goals/visits/export`,
  visitSkip: id => call(id, '/visits/skip'),
  addVisitSkip: (id, body) => call(id, '/visits/skip', { method: 'POST', body }),
  removeVisitSkip: (id, skipId) => call(id, `/visits/skip/${skipId}`, { method: 'DELETE' }),
  // sales-ia-v2 P3 - a visitor's P1-P4 / Not a fit; { priority: null } = back to the pull's own score.
  setVisitPriority: (id, body) => call(id, '/visits/priority', { method: 'POST', body }),
  // sales-ia-v2 P4 - the company side panel for any Pipeline row (type = partner | employer | target | apollo | visitor).
  // detail = { record, todos, waiting, visits, signals, recent, people, research, decisions, terms }; 0 AI, 0 Apollo.
  companyDetail: (id, type, recordId) => call(id, `/company?${q({ type, id: recordId })}`),
  // -> 201 { created: { type, id, name } } | 200 { already }. A visitor / Apollo-only company becomes a target (default), partner or employer.
  addToPipeline: (id, body) => call(id, '/company/add-to-pipeline', { method: 'POST', body }),
  addCompanyNote: (id, type, recordId, note) => call(id, `/company/${type}/${recordId}/note`, { method: 'POST', body: { note } }),
  // name, title, LinkedIn URL only - never an email or phone (L1).
  addCompanyContact: (id, type, recordId, body) => call(id, `/company/${type}/${recordId}/contact`, { method: 'POST', body }),
  updateTarget: (id, targetId, body) => call(id, `/company/target/${targetId}`, { method: 'PATCH', body }).then(d => d.target),
  // company-panel-v2 Stage 2 - the Interest band's buttons; every write returns what Undo needs.
  bookMeeting: (id, type, recordId, body = {}) => call(id, `/company/${type}/${recordId}/book-meeting`, { method: 'POST', body }),
  markContacted: (id, type, recordId, body = {}) => call(id, `/company/${type}/${recordId}/contacted`, { method: 'POST', body }),
  notNow: (id, type, recordId, body = {}) => call(id, `/company/${type}/${recordId}/not-now`, { method: 'POST', body }),
  // Research + Check Apollo for any record type (same caps as the partner ones below).
  companyResearch: (id, type, recordId) => call(id, `/company/${type}/${recordId}/research`),
  runCompanyResearch: (id, type, recordId) => call(id, `/company/${type}/${recordId}/research`, { method: 'POST' }),
  checkCompanyApollo: (id, type, recordId) => call(id, `/company/${type}/${recordId}/apollo-check`, { method: 'POST' }),
  // REV5 - what counterparts owe us (kind 'waiting' rows; open ones only). No partnerId = every partner.
  // Got it = updateWeekGoal { status: 'done' }; nudge = our own to-do, due today, owned by the clicker.
  waitingRows: (id, partnerId) => call(id, `/tasks?${q({ link_type: 'partner', link_id: partnerId, kind: 'waiting' })}`).then(d => d.tasks.filter(t => t.status === 'open')),
  nudgeWaiting: (id, rowId) => call(id, `/waiting/${rowId}/nudge`, { method: 'POST', body: {} }).then(d => d.todo),

  createStep: (id, goalId, body) => call(id, `/week/${goalId}/steps`, { method: 'POST', body }).then(d => d.step),
  updateStep: (id, stepId, body) => call(id, `/steps/${stepId}`, { method: 'PATCH', body }).then(d => d.step),

  partners: id => call(id, '/land?goal_type=partnership').then(d => d.goals),
  // pipeline-board-v1 - one row per company, color + stage computed server-side.
  pipelineBoard: (id, includeApollo) => call(id, `/pipeline-board?${q({ include_apollo: includeApollo ? 'true' : null })}`).then(d => d.rows),
  // The joint sheet (.xlsx) for the board's current filters; fetched as a blob, not JSON.
  pipelineBoardExportUrl: (id, f) => `/api/sales/${id}/goals/pipeline-board/export?${q({ type: f.type, owner_team: f.ownerTeam, owner: f.owner, tier: f.tier, color: f.color, q: f.q })}`,
  // pipeline-board-v1 Stage 4 - file = { name, data: base64 }. Preview writes nothing; apply = [{ key, sig }] from the preview.
  sheetUpdatePreview: (id, file) => call(id, '/pipeline-board/update', { method: 'POST', body: { file } }),
  sheetUpdateApply: (id, file, apply) => call(id, '/pipeline-board/update', { method: 'POST', body: { file, apply } }),
  hotPartners: id => call(id, '/land?goal_type=partnership&hot=true').then(d => d.goals),
  // partner-add-research-v1 Stage 2 - GET { runs, today, cap }; POST starts a run (202, one Claude call with web_search) and the card polls GET.
  partnerResearch: (id, goalId) => call(id, `/partners/${goalId}/research`),
  runPartnerResearch: (id, goalId) => call(id, `/partners/${goalId}/research`, { method: 'POST' }),
  // Stage 3 - { status: found|no_account|no_people|skipped, people: [{ name, title }], todo, todo_created, calls } (max 2 Apollo reads, 0 credits).
  checkPartnerApollo: (id, goalId) => call(id, `/partners/${goalId}/apollo-check`, { method: 'POST' }),
  // partner-add-research-v1 - 0 AI, 0 Apollo; { exact: [{ type, id, name, archived, via }], partial: [...] }.
  partnerDupeCheck: (id, params) => call(id, `/partners/dupe-check?${q(params)}`),
  createPartner: (id, body) => call(id, '/land', { method: 'POST', body: { goal_type: 'partnership', ...body } }).then(d => d.goal),
  updatePartner: (id, goalId, body) => call(id, `/land/${goalId}`, { method: 'PATCH', body }).then(d => d.goal),
  // sales-partners-pipeline-v1 - buttons go through signals so each click has a history row.
  partnerSignal: (id, goalId, signal) => call(id, `/partners/${goalId}/signal`, { method: 'POST', body: signal }),
  partnerUndo: (id, goalId, eventId) => call(id, `/partners/${goalId}/undo`, { method: 'POST', body: { event_id: eventId } }),
  partnerEvents: (id, params) => call(id, `/partners/events?${q(params)}`).then(d => d.events),
  // sales-partners-workflow-v1 - order = the group's ids top to bottom after the move.
  partnerRank: (id, goalId, order) => call(id, `/partners/${goalId}/rank`, { method: 'POST', body: { order } }).then(d => d.ranks),
  // partner-360-v1 - partner_contacts rows; the drop-down merges them with logged touches + the sheet (src/constants/partnerPeople.js).
  partnerPeople: (id, goalId) => call(id, `/partners/${goalId}/people`).then(d => d.people),
  addPartnerPerson: (id, goalId, body) => call(id, `/partners/${goalId}/people`, { method: 'POST', body }).then(d => d.person),
  deletePartnerPerson: (id, goalId, personId) => call(id, `/partners/${goalId}/people/${personId}`, { method: 'DELETE' }),
  // partner-360-v1 Stage 3 - a Sync now with the Apollo partner-people step forced; same cooldown as Sync now.
  refreshPartnerPeople: id => call(id, '/partners/refresh-people', { method: 'POST', body: {} }),
  // partner-touch-log-v1 - body { dry_run?, touches: [...] }; dry_run previews, the real run applies all or nothing.
  partnerTouches: (id, body) => call(id, '/partners/touches', { method: 'POST', body }),
  // partner-360-v1 Stage 2 - partner_domains rows + live suggestions; every write returns the same shape.
  partnerDomains: (id, goalId) => call(id, `/partners/${goalId}/domains`),
  addPartnerDomain: (id, goalId, body) => call(id, `/partners/${goalId}/domains`, { method: 'POST', body }),
  updatePartnerDomain: (id, goalId, domainId, body) => call(id, `/partners/${goalId}/domains/${domainId}`, { method: 'PATCH', body }),
  deletePartnerDomain: (id, goalId, domainId) => call(id, `/partners/${goalId}/domains/${domainId}`, { method: 'DELETE' }),
  allPartnerDomains: id => call(id, '/partners/domains'),
  apolloCsvUrl: id => `/api/sales/${id}/goals/partners/export-apollo.csv`,
  apolloMoves: id => call(id, '/partners/apollo-touches'),
  applyApolloMoves: (id, keys, includeHeld = false) => call(id, '/partners/apollo-touches/apply', { method: 'POST', body: { keys, include_held: includeHeld } }),
  dismissApolloMove: (id, key) => call(id, '/partners/apollo-touches/dismiss', { method: 'POST', body: { key } }),
  outlookMoves: id => call(id, '/partners/outlook-touches'),
  applyOutlookMoves: (id, keys, includeHeld = false) => call(id, '/partners/outlook-touches/apply', { method: 'POST', body: { keys, include_held: includeHeld } }),
  dismissOutlookMove: (id, key) => call(id, '/partners/outlook-touches/dismiss', { method: 'POST', body: { key } }),
  recordOutlookTouches: id => call(id, '/partners/outlook-touches/record', { method: 'POST', body: {} }),

  companies: (id, from, to) => call(id, `/companies?${q({ from, to })}`),
  updateCompany: (id, accountId, body) => call(id, `/companies/${encodeURIComponent(accountId)}`, { method: 'PATCH', body }).then(d => d.company),

  cadences: (id, from, to) => call(id, `/cadences?${q({ from, to })}`).then(d => d.cadences),
  createCadence: (id, body) => call(id, '/cadences', { method: 'POST', body }).then(d => d.cadence),
  deleteCadence: (id, cadenceId) => call(id, `/cadences/${cadenceId}`, { method: 'DELETE' }),

  scorecard: (id, month, owner) => call(id, `/scorecard?${q({ month, owner })}`),
  saveTarget: (id, body) => call(id, '/targets', { method: 'PUT', body }).then(d => d.target),
  hero: (id, weekStart, owner, skipMonth) => call(id, `/hero?${q({ week_start: weekStart, owner, skip_month: skipMonth ? 1 : null })}`),

  report: (id, weekStart) => call(id, `/report?${q({ week_start: weekStart })}`),
  kpi: (id, weekStart) => call(id, `/kpi?${q({ week_start: weekStart })}`).then(d => d.rows),
  saveSection: (id, weekStart, key, notes) => call(id, `/report/${weekStart}/sections/${key}`, { method: 'PUT', body: { notes } }).then(d => d.section),
  appendToSection: (id, weekStart, key, line) => call(id, `/report/${weekStart}/sections/${key}/append`, { method: 'POST', body: { line } }),
  finalize: (id, weekStart) => call(id, `/report/${weekStart}/finalize`, { method: 'POST', body: {} }).then(d => d.report),
  reopen: (id, weekStart) => call(id, `/report/${weekStart}/reopen`, { method: 'POST', body: {} }).then(d => d.report),

  createInfra: (id, body) => call(id, '/infra', { method: 'POST', body }).then(d => d.item),
  updateInfra: (id, itemId, body) => call(id, `/infra/${itemId}`, { method: 'PATCH', body }).then(d => d.item),
  deleteInfra: (id, itemId) => call(id, `/infra/${itemId}`, { method: 'DELETE' }),
  carryInfra: (id, weekStart) => call(id, '/infra/carry-forward', { method: 'POST', body: { week_start: weekStart } }),
};
