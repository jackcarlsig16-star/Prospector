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
// actions-home-attention-v1 - the Needs attention drawer opening (the Tasks drawer closes: one at a time), and a
// link to the app's Connections page from inside Sales & Marketing.
export const OPEN_ATTENTION = 'prospector:open-attention';
// one-plus-button-v1 - the header "+" added a record: Pipeline › Companies opens with that row highlighted and its window open.
export const OPEN_PIPELINE_RECORD = 'prospector:open-pipeline-record'; // detail { key: '<type>-<id>', section? }
export const OPEN_CONNECTIONS = 'prospector:open-connections';

async function call(businessId, path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/sales/${businessId}/goals${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 500 && MIGRATION_PATTERN.test(data.error || '')) throw new NeedsMigrationError();
    // todo-events-v1 T5: the row changed since the screen read it - every open list reloads, the caller says so
    if (res.status === 409 && data.code === 'changed') { window.dispatchEvent(new Event(TODOS_CHANGED)); throw Object.assign(new Error(data.error), { status: 409, changed: true, goal: data.goal || null }); }
    throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  }
  if (method !== 'GET' && /^\/(week|steps)\b|^\/call-notes$|^\/leads$|^\/prospect-targets\/.+\/(promote|reject|contacted-undo)$|^\/tidy\/run$|^\/waiting\/.+\/nudge$|^\/(partners|company\/[a-z]+)\/.+\/apollo-check$|^\/company\/add-to-pipeline$|^\/suggestions\/.+\/(accept|dismiss|snooze|undo)$|^\/signals\/(scout-import|.+\/(accept|dismiss|undo|auto-create))$|^\/visits\/(pull|people-csv|people-pull)$|^\/people(\/.+\/add-record)?$|^\/targets$|^\/clients(\/undo)?$/.test(path)) window.dispatchEvent(new Event(TODOS_CHANGED));
  return data;
}

const withEvent = d => (d.goal ? { ...d.goal, event_id: d.event?.id || null } : d.goal);
const q = params => new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();

export const goalsApi = {
  members: id => call(id, '/members').then(d => d.members),
  // dashboard-v3 Stage 5 - Home's small cards (employers by stage, partners by status + owner, we owe / they owe).
  homeCards: (id, { owner } = {}) => call(id, `/dashboard?${q({ owner })}`),

  weekGoals: (id, from, to, kind) => call(id, `/week?${q({ from, to, kind })}`).then(d => d.goals),
  // todo-events-v1: a to-do's create / change returns the event it wrote - event_id rides on the goal for Undo
  // (undoTodoEvent). row = what the screen showed: its updated_at goes as expect, a changed row is a 409.
  createWeekGoal: (id, body) => call(id, '/week', { method: 'POST', body }).then(withEvent),
  updateWeekGoal: (id, goalId, body, row = null) => call(id, `/week/${goalId}`, { method: 'PATCH', body: row?.updated_at ? { ...body, expect: { updated_at: row.updated_at } } : body }).then(withEvent),
  deleteWeekGoal: (id, goalId) => call(id, `/week/${goalId}`, { method: 'DELETE' }),
  proposePlan: (id, body) => call(id, '/week/plan/propose', { method: 'POST', body }),
  savePlan: (id, body) => call(id, '/week/plan/save', { method: 'POST', body }),
  weekPlans: (id, ownerId) => call(id, `/week/plans?${q({ owner_user_id: ownerId })}`).then(d => d.plans),
  carryOver: (id, weekStart, kind) => call(id, '/week/carry-over', { method: 'POST', body: { week_start: weekStart, kind } }),

  // call-notes-to-tasks-v1 - extract writes nothing; create stores the note + the kept to-dos.
  extractCallNotes: (id, body) => call(id, '/call-notes/extract', { method: 'POST', body }),
  createFromCallNotes: (id, body) => call(id, '/call-notes', { method: 'POST', body }),
  // lead-upload-v1 - a pasted lead list: one read, then File (all or nothing).
  extractLeads: (id, body) => call(id, '/leads/extract', { method: 'POST', body }),
  fileLeads: (id, body) => call(id, '/leads', { method: 'POST', body }),
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
  // actions-v2 REV2 A4: ownerUserId = accept on a Member's behalf (the to-do is theirs).
  acceptSuggestion: (id, sid, { done = false, ownerUserId = null } = {}) => call(id, `/suggestions/${sid}/accept`, { method: 'POST', body: { ...(done ? { done: true } : {}), ...(ownerUserId ? { owner_user_id: ownerUserId } : {}) } }),
  dismissSuggestion: (id, sid) => call(id, `/suggestions/${sid}/dismiss`, { method: 'POST', body: {} }),
  snoozeSuggestion: (id, sid) => call(id, `/suggestions/${sid}/snooze`, { method: 'POST', body: {} }),
  // sales-ia-v2 A1 - back to proposed within 10 min; todo_id = the to-do Accept returned (deleted if still open).
  undoSuggestion: (id, sid, todoId, touchEventId) => call(id, `/suggestions/${sid}/undo`, { method: 'POST', body: { ...(todoId ? { todo_id: todoId } : {}), ...(touchEventId ? { touch_event_id: touchEventId } : {}) } }),
  // signals-v1 Stage 2 - the Signals review queue. scoutImport: dryRun = preview, nothing written.
  // accept = { signal, todo, via, record }; dismiss parks the company 7 days. 0 AI, 0 Apollo.
  signals: (id, status = 'new') => call(id, `/signals?${q({ status })}`).then(d => d.signals),
  scoutImport: (id, file, dryRun) => call(id, '/signals/scout-import', { method: 'POST', body: { file, dryRun } }),
  acceptSignal: (id, sid, { done = false, ownerUserId = null } = {}) => call(id, `/signals/${sid}/accept`, { method: 'POST', body: { ...(done ? { done: true } : {}), ...(ownerUserId ? { owner_user_id: ownerUserId } : {}) } }),
  dismissSignal: (id, sid) => call(id, `/signals/${sid}/dismiss`, { method: 'POST', body: {} }),
  // sales-ia-v2 A1 - a just-accepted / dismissed signal back to new (its to-do, target or note come off too).
  undoSignal: (id, sid, touchEventId) => call(id, `/signals/${sid}/undo`, { method: 'POST', body: touchEventId ? { touch_event_id: touchEventId } : {} }),
  // sales-ia-v2 A1 - the Actions list: { items, today, week_start }; items ranked overdue -> P1..P4 -> due. 0 AI, 0 Apollo.
  actions: (id, { snoozed = false } = {}) => call(id, `/actions${snoozed ? '?snoozed=1' : ''}`),
  // actions-home-attention-v1 D4 - sync status + counts; fresh = re-read the held partner moves (cached 15 min otherwise).
  attention: (id, { fresh = false } = {}) => call(id, `/attention${fresh ? '?fresh=1' : ''}`),
  // seif-campaign-v1 - outreach campaigns (Pipeline > Campaigns). No response carries a contact's address.
  campaigns: id => call(id, '/campaigns').then(d => d.campaigns),
  campaign: (id, cid) => call(id, `/campaigns/${cid}`),
  campaignSummary: id => call(id, '/campaigns/summary'),
  createCampaign: (id, body) => call(id, '/campaigns', { method: 'POST', body }),
  updateCampaign: (id, cid, body) => call(id, `/campaigns/${cid}`, { method: 'PATCH', body }).then(d => d.campaign),
  updateCampaignStep: (id, cid, stepId, body) => call(id, `/campaigns/${cid}/steps/${stepId}`, { method: 'PATCH', body }).then(d => d.step),
  // dryRun (default) = preview, nothing written; include = sheet rows to add despite Brad / Upside.
  importCampaign: (id, cid, body) => call(id, `/campaigns/${cid}/import`, { method: 'POST', body }),
  // activate | pause | resume | done
  campaignAction: (id, cid, action) => call(id, `/campaigns/${cid}/${action}`, { method: 'POST' }),
  // sent | skip | stop | replied | status | pause | resume | promote | undo -> { contact, event? , record? }
  contactAction: (id, contactId, action, body = {}) => call(id, `/campaign-contacts/${contactId}/${action}`, { method: 'POST', body }),
  contactDraft: (id, contactId) => call(id, `/campaign-contacts/${contactId}/draft`),
  // dashboard-v3 Stage 2 - Home's Pulse (one read per period / person); Stage 3 - the Explorer's one read (layers,
  // by, split; from / to default to 8 weeks + this week) and its saved views (kind 'explorer'; save / delete = Members).
  pulse: (id, { period, owner, scope }) => call(id, `/pulse?${q({ period, owner, scope })}`),
  explorer: (id, { layers, by, split, from, to } = {}) => call(id, `/explorer?${q({ layers, by, split, from, to })}`),
  explorerViews: id => call(id, '/explorer/views').then(d => d.views),
  saveExplorerView: (id, body) => call(id, '/explorer/views', { method: 'POST', body }),
  deleteExplorerView: (id, viewId) => call(id, `/explorer/views/${viewId}`, { method: 'DELETE' }).then(d => d.views),
  // signals-v1 Stage 4 - the daily website-visitor pull (Members) and its status (Viewers too).
  // FIX visit-window-v1 W2: backfillDays (owner/admin) asks Apollo for that many days regardless of history, once per LA day.
  visitPull: (id, { force = false, trigger = 'manual', backfillDays = null } = {}) => call(id, '/visits/pull', { method: 'POST', body: { force, trigger, ...(backfillDays != null ? { backfill_days: backfillDays } : {}) } }),
  visitStatus: id => call(id, '/visits/status'),
  // signals-v1 Stage 5 - the Website visitors report, Brad's .xlsx (fetched as a blob) and the skip list.
  visitReport: id => call(id, '/visits/report'),
  visitorsTrend: (id, { days } = {}) => call(id, `/visitors/trend?${q({ days })}`),
  funnel: (id, { windows, days } = {}) => call(id, `/funnel?${q({ windows, days })}`),
  visitExportUrl: id => `/api/sales/${id}/goals/visits/export`,
  // FIX visitor-email-period-v1 P4 - the fundraising visitors export: the CSV url (fetched as a blob) and the JSON the print area renders.
  visitorsExportUrl: (id, params = {}) => `/api/sales/${id}/goals/visits/export-visitors?${q({ ...params, format: 'csv' })}`,
  visitorsExport: (id, window) => call(id, `/visits/export-visitors?${q({ window, format: 'json' })}`),
  visitSkip: id => call(id, '/visits/skip'),
  addVisitSkip: (id, body) => call(id, '/visits/skip', { method: 'POST', body }),
  removeVisitSkip: (id, skipId) => call(id, `/visits/skip/${skipId}`, { method: 'DELETE' }),
  // sales-ia-v2 P3 - a visitor's P1-P4 / Not a fit; { priority: null } = back to the pull's own score.
  setVisitPriority: (id, body) => call(id, '/visits/priority', { method: 'POST', body }),
  // visitor-to-record-v1 - auto-create a company from a website-visit signal, Apollo's Visited People export (CSV text), the People search.
  autoCreateSignal: (id, sid) => call(id, `/signals/${sid}/auto-create`, { method: 'POST', body: {} }),
  uploadVisitedPeople: (id, text, { preview = false } = {}) => call(id, '/visits/people-csv', { method: 'POST', body: { text, ...(preview ? { preview: true } : {}) } }),
  // visitor-to-record-v1 V2a - the Apollo contacts list "Prospector · Website visitors (export)" pulled into sales_people (Members).
  visitPeoplePull: (id, { force = false } = {}) => call(id, '/visits/people-pull', { method: 'POST', body: { force } }),
  people: (id, params = {}) => call(id, `/people?${q(params)}`),
  // people-v2: the one read behind Pipeline › People.
  // snoozed = 'only' lists the people Scout snoozed until a date (hidden by default; the route counts them).
  peopleActivity: (id, window = 'all', snoozed) => call(id, `/people/activity?${q({ window, snoozed })}`),
  peopleActivityDetail: (id, key) => call(id, `/people/activity/${encodeURIComponent(key)}`),
  peopleViews: id => call(id, '/people/views').then(d => d.views),
  savePeopleView: (id, body) => call(id, '/people/views', { method: 'POST', body }),
  deletePeopleView: (id, viewId) => call(id, `/people/views/${viewId}`, { method: 'DELETE' }).then(d => d.views),
  // V2a follow-up - a parked visitor (no record yet) gets their company filed as an employer target (Members).
  addPersonRecord: (id, personId) => call(id, `/people/${personId}/add-record`, { method: 'POST', body: {} }),
  // FIX pipeline-quick-fixes-v1 A - "+ Add ▾": a person on a record (or parked under a new company name), a target by name.
  addPerson: (id, body) => call(id, '/people', { method: 'POST', body }),
  createTarget: (id, body) => call(id, '/targets', { method: 'POST', body }),
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
  // company-progress-bar-v1 Stage 2 - the Undo of Mark contacted on a target (body = the reply's undo).
  undoContactTarget: (id, targetId, undo) => call(id, `/prospect-targets/${targetId}/contacted-undo`, { method: 'POST', body: undo }),
  // homelover-flow-v1 F7: to = an explicit forward stage (employers); default = the next one.
  advanceStage: (id, type, recordId, expect, to = null) => call(id, `/company/${type}/${recordId}/advance`, { method: 'POST', body: { expect, ...(to ? { to } : {}) } }),
  // homelover-flow-v1 Stage 1 routes - Fit (F2 / F3), Deprioritize (F4), Reached (F6), reply rules (F7), the flow Activity + Undo.
  fitOf: (id, type, recordId) => call(id, `/fit/${type}/${recordId}`),
  reachAll: id => call(id, '/reach').then(d => d.reach),
  flowEvents: (id, type, recordId) => call(id, `/flow/${type}/${recordId}`).then(d => d.events),
  undoFlow: (id, eventId) => call(id, `/flow/${eventId}/undo`, { method: 'POST' }),
  deprioritize: (id, type, recordId, body) => call(id, `/company/${type}/${recordId}/deprioritize`, { method: 'POST', body }),
  bringBack: (id, type, recordId) => call(id, `/company/${type}/${recordId}/bring-back`, { method: 'POST' }),
  theyReplied: (id, recordId, body) => call(id, `/company/employer/${recordId}/they-replied`, { method: 'POST', body }),
  setMemberColor: (id, userId, color) => call(id, `/members/${userId}/color`, { method: 'PATCH', body: { color } }),
  notNow: (id, type, recordId, body = {}) => call(id, `/company/${type}/${recordId}/not-now`, { method: 'POST', body }),
  // lead-source-v1 - type = partner | employer | target. source = { source, history }; edit body = the source fields +
  // expect_set_at (409 when it moved); source_kind: null with every field empty clears it (Undo of a first pick).
  source: (id, type, recordId) => call(id, `/source/${type}/${recordId}`),
  editSource: (id, type, recordId, body) => call(id, `/source/${type}/${recordId}`, { method: 'PATCH', body }).then(d => d.source),
  referredBy: (id, partnerId) => call(id, `/partners/${partnerId}/referred`),
  // homelover-clients-v1 - clients (C3-C5; every write answers event_id for Undo), their files (C6) and the network tree (C9).
  clients: id => call(id, '/clients'),
  // homelover-team-emails-v1 T2 - Sales › Settings › Team emails (every write: the owner).
  teamEmails: id => call(id, '/team-emails'),
  updateTeamEmails: (id, body) => call(id, '/team-emails', { method: 'PATCH', body }),
  addTeamRecipient: (id, body) => call(id, '/team-emails/recipients', { method: 'POST', body }),
  editTeamRecipient: (id, rid, body) => call(id, `/team-emails/recipients/${rid}`, { method: 'PATCH', body }),
  removeTeamRecipient: (id, rid) => call(id, `/team-emails/recipients/${rid}`, { method: 'DELETE' }),
  undoTeamEmailChange: (id, cid) => call(id, `/team-emails/changes/${cid}/undo`, { method: 'POST', body: {} }),
  teamEmailTest: (id, body) => call(id, '/team-emails/test', { method: 'POST', body }),
  // FIX visitor-email-top10-v1 V3b: today's visitor email to the list, now (owner / admin; refused once it went out).
  // { check: true } = only whether today's went out; { again: true } = a second copy (owner, after the explicit confirm).
  teamEmailSendNow: (id, body = {}) => call(id, '/team-emails/send-now', { method: 'POST', body }),
  makeClient: (id, body) => call(id, '/clients', { method: 'POST', body }),
  markClient: (id, oppId, to, body) => call(id, `/clients/${oppId}/${to}`, { method: 'POST', body }),
  undoClient: (id, eventId) => call(id, '/clients/undo', { method: 'POST', body: { event_id: eventId } }),
  clientFiles: (id, oppId, archived = false) => call(id, `/clients/${oppId}/files${archived ? '?archived=1' : ''}`).then(d => d.files),
  clientUploadUrl: (id, oppId, body) => call(id, `/clients/${oppId}/files/upload-url`, { method: 'POST', body }),
  recordClientFile: (id, oppId, body) => call(id, `/clients/${oppId}/files`, { method: 'POST', body }).then(d => d.file),
  clientFileUrl: (id, fileId) => call(id, `/client-files/${fileId}/url`),
  archiveClientFile: (id, fileId) => call(id, `/client-files/${fileId}/archive`, { method: 'POST' }).then(d => d.file),
  restoreClientFile: (id, fileId) => call(id, `/client-files/${fileId}/restore`, { method: 'POST' }).then(d => d.file),
  sourcesNetwork: id => call(id, '/sources/network'),
  // days / team / partner; { totals, by_kind, by_partner, by_person, by_office }.
  sources: (id, { days, team, partner } = {}) => call(id, `/sources?${q({ days, team, partner })}`),
  sourcesFunnel: (id, { days, team, partner, rep, source } = {}) => call(id, `/sources/funnel?${q({ days, team, partner, rep, source })}`),
  // intake-insights-v1: Track & improve + channel links (status PATCH: Members, expect = the status the screen showed).
  insights: (id, status) => call(id, `/insights?${q({ status })}`),
  setInsightStatus: (id, insightId, body) => call(id, `/insights/${insightId}`, { method: 'PATCH', body }),
  channelLinks: (id, { partner, record } = {}) => call(id, `/channel-links?${q({ partner, record })}`).then(d => d.links),
  // Structured fields only (company, type, stage, owner, covered lives, rep, office) - never route_in or notes.
  sourcesExport: (id, partner) => call(id, `/sources/export?${q({ partner })}`),
  sourcesExportCsvUrl: (id, partner) => `/api/sales/${id}/goals/sources/export?${q({ partner, format: 'csv' })}`,
  // Owner / Admin. apply mappings = { [group key]: { source_kind, source_partner_id?, source_person?, source_office? } }.
  sourcesBackfill: id => call(id, '/sources/backfill'),
  applySourcesBackfill: (id, mappings) => call(id, '/sources/backfill/apply', { method: 'POST', body: { mappings } }),
  // company-workflow-v1 - employees / reach (typed = manual) and an employer's / target's owner person.
  editCompanyFields: (id, type, recordId, body) => call(id, `/company/${type}/${recordId}/fields`, { method: 'PATCH', body }).then(d => d.fields),
  // Research + Check Apollo for any record type (same caps as the partner ones below).
  companyResearch: (id, type, recordId) => call(id, `/company/${type}/${recordId}/research`),
  runCompanyResearch: (id, type, recordId) => call(id, `/company/${type}/${recordId}/research`, { method: 'POST' }),
  checkCompanyApollo: (id, type, recordId) => call(id, `/company/${type}/${recordId}/apollo-check`, { method: 'POST' }),
  // REV5 - what counterparts owe us (kind 'waiting' rows; open ones only). No partnerId = every partner.
  // Got it = updateWeekGoal { status: 'done' }; nudge = our own to-do, due today, owned by the clicker.
  waitingRows: (id, partnerId) => call(id, `/tasks?${q({ link_type: 'partner', link_id: partnerId, kind: 'waiting' })}`).then(d => d.tasks.filter(t => t.status === 'open')),
  nudgeWaiting: (id, rowId) => call(id, `/waiting/${rowId}/nudge`, { method: 'POST', body: {} }).then(d => ({ ...d.todo, event_id: d.event?.id || null })),

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
  // todo-events-v1: the to-do event lines (a week, one to-do, or a record's to-dos), Undo of one event or a batch.
  todoEvents: (id, params) => call(id, `/week/events?${q(params)}`).then(d => d.events),
  undoTodoEvent: (id, eventId) => call(id, `/week/events/${eventId}/undo`, { method: 'POST' }),
  undoTodoBatch: (id, batchId) => call(id, `/week/events/batch/${batchId}/undo`, { method: 'POST' }),
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

  // intent-score-v1: the Priorities view.
  scores: (id, params = {}) => call(id, `/scores?${q(params)}`),
  recomputeScores: (id, body = {}) => call(id, '/scores/recompute', { method: 'POST', body }),
  // FIX headcount-auto-v1 REV2 - "Fill headcounts" (owner / admin): the free paths, then enrich under today's N; 0 credits measured so far.
  headcountFill: (id, body = {}) => call(id, '/headcount/fill', { method: 'POST', body }),
  headcountStatus: id => call(id, '/headcount/status'),
  scoresCsvUrl: (id, params = {}) => `/api/sales/${id}/goals/scores/export.csv?${q(params)}`,
  brief: (id, type, recordId) => call(id, `/brief/${type}/${recordId}`),
  scoreOf: (id, type, recordId) => call(id, `/scores/${type}/${recordId}`),
  scoreViews: id => call(id, '/scores/views').then(d => d.views),
  saveScoreView: (id, body) => call(id, '/scores/views', { method: 'POST', body }),
  deleteScoreView: (id, viewId) => call(id, `/scores/views/${viewId}`, { method: 'DELETE' }).then(d => d.views),
  composeStatus: id => call(id, '/compose/status'),
  compose: (id, type, recordId) => call(id, `/compose/${type}/${recordId}`, { method: 'POST', body: {} }),
  composeLint: (id, body) => call(id, '/compose/lint', { method: 'POST', body }),

  companies: (id, from, to) => call(id, `/companies?${q({ from, to })}`),
  updateCompany: (id, accountId, body) => call(id, `/companies/${encodeURIComponent(accountId)}`, { method: 'PATCH', body }).then(d => d.company),

  cadences: (id, from, to) => call(id, `/cadences?${q({ from, to })}`).then(d => d.cadences),
  createCadence: (id, body) => call(id, '/cadences', { method: 'POST', body }).then(d => d.cadence),
  deleteCadence: (id, cadenceId) => call(id, `/cadences/${cadenceId}`, { method: 'DELETE' }),

  scorecard: (id, month, owner) => call(id, `/scorecard?${q({ month, owner })}`),
  saveTarget: (id, body) => call(id, '/targets', { method: 'PUT', body }).then(d => d.target),
  hero: (id, weekStart, owner, skipMonth) => call(id, `/hero?${q({ week_start: weekStart, owner, skip_month: skipMonth ? 1 : null })}`),

  appendToSection: (id, weekStart, key, line) => call(id, `/report/${weekStart}/sections/${key}/append`, { method: 'POST', body: { line } }),

};
