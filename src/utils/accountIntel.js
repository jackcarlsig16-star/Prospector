// generation-engine-consolidation-v1 Stage 4 — the account's own stored
// context, formalized as api/email.js's "accountIntel" provider. Confirmed
// via audit that this reached scoring/reassay (AccountsPage.js/bulkAssay.js
// merge handoffNotes into customIntel before calling clientAssay) but never
// reached generation - EmailModal.js's customIntel was always just the AE's
// global getActiveIntel(), with no per-account data at all. Scoped to what's
// already attached to the account object client-side (no new fetch): the
// same handoffNotes reassay resends, plus MEDPICC and the most recent call's
// summary/next-steps, since those are real, already-loaded, and the
// single highest-value addition for grounding a follow-up. Deliberately not
// pulling in compliance status (prospector_compliance, a separate localStorage
// path) or sentEmails history - narrower scope than AccountCardComms.js's
// old buildCommsContext, a disclosed trade-off from consolidating onto this
// one shared builder rather than a call-history-specific one.
export function buildAccountIntel(acc) {
  if (!acc) return null;
  const parts = [];

  if (acc.handoffNotes) parts.push(`Notes: ${acc.handoffNotes}`);

  const m = acc.medpicc || {};
  const medpiccLine = [
    m.identify_pain    ? `pain: ${m.identify_pain}`         : null,
    m.champion          ? `champion: ${m.champion}`          : null,
    m.economic_buyer    ? `economic buyer: ${m.economic_buyer}` : null,
    m.competition        ? `competition: ${m.competition}`    : null,
  ].filter(Boolean).join(" · ");
  if (medpiccLine) parts.push(`MEDPICC — ${medpiccLine}`);

  const recentCall = (acc.calls || [])[acc.calls?.length - 1];
  if (recentCall) {
    const nextSteps = (recentCall.nextSteps || []).map(ns => typeof ns === 'string' ? ns : (ns?.text || '')).filter(Boolean);
    const callLine = [
      recentCall.summary ? `Most recent call (${recentCall.date || 'undated'}): ${recentCall.summary.slice(0, 400)}` : null,
      nextSteps.length ? `Next steps from that call: ${nextSteps.join('; ')}` : null,
    ].filter(Boolean).join('\n');
    if (callLine) parts.push(callLine);
  }

  return parts.length ? parts.join('\n\n') : null;
}
