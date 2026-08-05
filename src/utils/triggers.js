import { extractHunterDomain } from './hunter';
import { daysSinceIso } from './dates';

// Derive a unified, prioritized list of "why now" triggers for an account:
//   - intent (6sense buying-stage activity)
//   - engagement (positive thread sentiment + signals)
//   - signal (assay-derived signals on the account)
//   - manual (BDR-added triggers on the outbound entry)
// Output: array of { type, label, ageInDays, source } truncated to max.
export function getTriggersForAccount(acc, { intentHistory = [], threadCache = {}, frontierEntry = null, max = 5 } = {}) {
  const triggers = [];
  const domain = extractHunterDomain(acc?.web);

  // 1. 6sense intent — surface buyingStage + most recent date
  if (domain) {
    const rows = intentHistory.filter(r => r.domain === domain);
    rows.slice(0, 2).forEach(r => {
      const age = daysSinceIso(r.date);
      const stage = r.buyingStage ? `${r.buyingStage} intent` : 'Intent activity';
      const acts = Array.isArray(r.activities) ? r.activities.filter(Boolean) : [];
      const detail = acts[0]?.topic || acts[0]?.name || null;
      const label = detail ? `${stage} · ${detail}` : stage;
      triggers.push({ type: 'intent', label, ageInDays: age, source: '6sense' });
    });
  }

  // 2. Thread engagement — only when positive
  if (domain) {
    const t = threadCache[domain];
    if (t?.sentiment === 'positive') {
      (t.signals || []).slice(0, 1).forEach(s => {
        triggers.push({ type: 'engagement', label: s, ageInDays: daysSinceIso(t.cachedAt ? new Date(t.cachedAt).toISOString() : null), source: 'email' });
      });
    }
  }

  // 3. Account signals from the assay
  (acc?.signals || acc?.sigs || []).forEach(s => {
    triggers.push({ type: 'signal', label: s, ageInDays: null, source: 'assay' });
  });

  // 4. Manual triggers — BDR-added on the frontier entry
  (frontierEntry?.outbound?.manualTriggers || []).forEach(t => {
    triggers.push({
      type: 'manual',
      label: t.label || String(t),
      ageInDays: daysSinceIso(t.addedAt),
      source: 'manual',
    });
  });

  const order = { intent: 0, engagement: 1, signal: 2, manual: 3 };
  return triggers
    .filter(t => t.label)
    .sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9))
    .slice(0, max);
}

export const TRIGGER_C = {
  intent:     '#00F5FF',
  engagement: '#FFD700',
  signal:     '#5A9A5A',
  manual:     '#CFCFCF',
};
