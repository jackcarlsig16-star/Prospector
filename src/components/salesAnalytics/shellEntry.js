// app-shell-v2 - the sales module's shell entry (src/shell/shellRegistry.js): what the left nav, the Settings groups,
// the Connections page and the phone tabs show in a workspace with the sales module on. `to` is where an item lands:
// page = the workspace page, tab / view = the sales page's own selection (salesNav.js - nothing renamed here).
// The Admin pages are the surfaces that exist today, each behind its own gate: Team = Admin's members list, Switches =
// the platform's workspace switches, Recompute = the Map's recompute control, Send logs = the last sends under Team emails.
export const SALES_SHELL = {
  id: 'sales',
  appliesTo: b => !!b?.features?.goals_sales,
  home: 'today',
  search: true,
  // Three asks Scout answers from this workspace's own reads (its intents' examples), shown under the empty field.
  tryAsking: ['who visited this week', 'my overdue to-dos', 'my top targets'],
  items: [
    { id: 'home', label: 'Home', icon: 'home', to: { page: 'sales-analytics', tab: 'dashboard', view: 'overview' } },
    { id: 'today', label: 'Today', icon: 'today', badge: 'today', to: { page: 'sales-analytics', tab: 'actions' } },
    { id: 'pipeline', label: 'Pipeline', icon: 'pipeline', to: { page: 'sales-analytics', tab: 'pipeline' } },
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', to: { page: 'sales-analytics', tab: 'dashboard', view: 'analytics' } },
    { id: 'scout', label: 'Scout', icon: 'scout', to: { page: 'scout' } },
    { id: 'marketing', label: 'Marketing', icon: 'marketing', group: 'Grow', soon: true, to: { page: 'marketing' } },
    { id: 'ideas', label: 'Ideas', icon: 'ideas', group: 'Grow', badge: 'ideas', to: { page: 'ideas' } },
  ],
  settings: {
    workspace: [
      { id: 'team-emails', label: 'Team emails', icon: 'mail', to: { page: 'sales-analytics', tab: 'settings', view: 'team-emails' } },
      { id: 'voice-profile', label: 'Voice profile', icon: 'voice', to: { page: 'voice-profile' } },
    ],
    admin: [
      { id: 'team', label: 'Team', icon: 'team', gate: 'owner', to: { page: 'admin', section: 'users' } },
      { id: 'connections', label: 'Connections', icon: 'link', gate: 'owner', to: { page: 'connections' } },
      { id: 'switches', label: 'Switches', icon: 'switch', gate: 'platform', to: { page: 'admin', section: 'settings' } },
      { id: 'recompute', label: 'Recompute', icon: 'refresh', gate: 'owner', to: { page: 'sales-analytics', tab: 'pipeline', view: 'priorities' } },
      { id: 'send-logs', label: 'Send logs', icon: 'log', gate: 'owner', to: { page: 'sales-analytics', tab: 'settings', view: 'team-emails', anchor: 'sends' } },
    ],
  },
  feeds: [
    { id: 'microsoft', label: 'Microsoft', note: 'Outlook mail, calendar and sent items for the team' },
    { id: 'fathom', label: 'Fathom', note: 'Call recordings and notes into call-note intake' },
    { id: 'apollo', label: 'Apollo', note: 'People, sequences, opens and replies' },
    { id: 'visitors', label: 'Site visitors', note: 'Company visits to the website' },
  ],
  phone: ['today', 'pipeline', 'dashboard'],
};
