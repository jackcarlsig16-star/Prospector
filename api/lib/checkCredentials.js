// Phase 3 (external-api-foundation-v1) - direct fix for the Jina failure
// mode: JINA_API_KEY sat unset/unwired for an entire session with no signal
// anywhere that it was missing. Scans the registry at startup and logs
// clearly which integrations are fully configured vs. missing env vars,
// so a broken credential is loud and immediate, never silent.
import { INTEGRATIONS } from './integrations.js';

export function checkCredentials() {
  const report = INTEGRATIONS.map(integration => {
    const missing = integration.requiredEnvVars.filter(v => !process.env[v]);
    return { name: integration.name, configured: missing.length === 0, missing };
  });

  for (const r of report) {
    if (r.configured) {
      console.log(`[integrations] ${r.name}: configured`);
    } else {
      console.error(`[integrations] ${r.name}: NOT configured — missing ${r.missing.join(', ')}`);
    }
  }
  return report;
}
