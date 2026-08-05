// Modular close probability inference.
// Rule-based today. Replace inferCloseProbability with a model endpoint tomorrow.
// All callers (Ledger, Scout, AccountCard, MeetingBrief) call this function only —
// they never need to change when the implementation swaps.

import { daysSinceIso } from './dates';

export function inferCloseProbability(account) {
  const signals = [];
  let score = 30; // base

  // MEDPICC completeness (+30 max)
  const medpiccFields = ["metrics","economic_buyer","decision_criteria","decision_process","identify_pain","champion","competition"];
  const filled = medpiccFields.filter(f => (account.medpicc?.[f] || "").length >= 25).length;
  const medpiccScore = Math.round((filled / medpiccFields.length) * 30);
  score += medpiccScore;
  if (filled >= 5) signals.push("Strong MEDPICC coverage");

  // Deal stage (+20 max)
  const stageScores = { qualify: 2, discovery: 5, evaluation: 10, mutual_alignment: 14, negotiation: 18, contract_execution: 20 };
  const stageScore = stageScores[account.dealStage] || 0;
  score += stageScore;
  if (stageScore >= 14) signals.push("Late stage deal");

  // Call quality (+15 max) — uses gong totalScore on each call record
  const calls = account.calls || [];
  const recentCalls = calls.slice(-3);
  const avgGong = recentCalls.length
    ? recentCalls.reduce((s, c) => s + (c.totalScore || 0), 0) / recentCalls.length
    : 0;
  const callScore = Math.min(15, Math.round(avgGong / 3));
  score += callScore;
  if (avgGong >= 30) signals.push("High Gong scores");

  // Compliance progress (+15 max)
  try {
    const compliance = JSON.parse(localStorage.getItem("prospector_compliance") || "{}")[account.id];
    if (compliance?.steps?.length) {
      const approved = compliance.steps.filter(s => s.status === "Approved").length;
      const compScore = Math.round((approved / compliance.steps.length) * 15);
      score += compScore;
      if (approved === compliance.steps.length) signals.push("All compliance steps approved");
    }
  } catch {}

  // Products identified (+5)
  if ((account.prods || []).length >= 2) {
    score += 5;
    signals.push("Multiple products scoped");
  }

  // Recency penalty (-10 if stale)
  const lastDate = account.lastIntelAt || account.last;
  const stale = daysSinceIso(lastDate) ?? 999;
  if (stale > 21) {
    score -= 10;
    signals.push("No recent activity");
  }

  const probability = Math.min(95, Math.max(5, score));
  const confidence = filled >= 4 && calls.length >= 2 ? "high" : filled >= 2 ? "medium" : "low";

  return { probability, confidence, signals };
}

export function inferDealStage(account) {
  const medpicc = account.medpicc || {};
  const calls = account.calls || [];
  try {
    const compliance = JSON.parse(localStorage.getItem("prospector_compliance") || "{}")[account.id];
    const filledMedpicc = Object.values(medpicc).filter(v => v && v.length >= 25).length;
    const callCount = calls.length;
    const hasEconomicBuyer  = (medpicc.economic_buyer   || "").length >= 25;
    const hasDecisionProcess = (medpicc.decision_process || "").length >= 25;
    const hasMetrics        = (medpicc.metrics           || "").length >= 25;
    const complianceStarted  = compliance?.steps?.some(s => s.status !== "Not Started");
    const complianceApproved = compliance?.steps?.filter(s => s.status === "Approved").length || 0;

    if (complianceApproved >= 2) return "contract_execution";
    if (complianceStarted)       return "negotiation";
    if (hasEconomicBuyer && hasDecisionProcess && hasMetrics) return "mutual_alignment";
    if (filledMedpicc >= 3 && callCount >= 2) return "evaluation";
    if (callCount >= 1 && filledMedpicc >= 1) return "discovery";
  } catch {}
  return "qualify";
}

export function logScore(accountId, inputs, output, aeOverride = null) {
  try {
    const log = JSON.parse(localStorage.getItem("prospector_score_log") || "[]");
    log.push({ accountId, timestamp: new Date().toISOString(), inputs, output, aeOverride });
    if (log.length > 500) log.splice(0, log.length - 500);
    localStorage.setItem("prospector_score_log", JSON.stringify(log));
  } catch {}
}
