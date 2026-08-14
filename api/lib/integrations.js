// Registry of integrations built on the shared callExternalApi() wrapper
// (external-api-foundation-v1). The 8 pre-existing integrations (Anthropic,
// Jina, Hunter, Gmail, SFDC, Databricks, Glean, Slack) are NOT listed here -
// they keep their own hand-rolled fetch calls untouched. Only integrations
// built after this foundation go through it.
//
// Adding a new integration = adding an entry here + its endpoint-specific
// logic, not reimplementing credential checks/timeout/retry/error shape.

export const INTEGRATIONS = [
  {
    name: 'zoom',
    requiredEnvVars: ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET', 'ZOOM_WEBHOOK_SECRET_TOKEN'],
    baseUrl: 'https://api.zoom.us/v2',
    authType: 'oauth2_server_to_server',
    // ZOOM_WEBHOOK_SECRET_TOKEN isn't used by outbound calls (it verifies
    // inbound webhook signatures) but the integration doesn't work without
    // it, so Phase 3's credential check treats it as required too.
    oauth: {
      tokenUrl: 'https://zoom.us/oauth/token',
      accountIdEnvVar: 'ZOOM_ACCOUNT_ID',
      clientIdEnvVar: 'ZOOM_CLIENT_ID',
      clientSecretEnvVar: 'ZOOM_CLIENT_SECRET',
    },
    defaultTimeoutMs: 15000,
    defaultRetries: 2,
  },
];

export function getIntegration(name) {
  const integration = INTEGRATIONS.find(i => i.name === name);
  if (!integration) throw new Error(`Unknown integration: "${name}" is not registered in api/lib/integrations.js`);
  return integration;
}
