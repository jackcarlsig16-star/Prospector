// Prospector stage order — used by Urgency scoring. "Discovery" and "Proposal"
// in the spec map to Prospector's actual stage names below.
const STAGE_RANK = {
  'Prospecting':     0,
  'Engaged':         1,
  'Needs Follow-up': 1,
  'Discovery':       1,
  'Active Deal':     2,
  'Qualified':       2,
  'Proposal':        3,
  'Closed Won':      4,
  'Closed Lost':    -1,
};

const GONG_MAX = 41;

export function extractDomain(acc) {
  const raw = (acc?.web || '').toLowerCase().trim();
  if (!raw) return null;
  return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0] || null;
}

const nonEmpty = v => {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
};

const clamp = v => Math.max(0, Math.min(100, v));

function scoreAuthority(acc) {
  const signals = [];
  let raw = 0, inputs = 0;
  const m = acc.medpicc || {};
  if (nonEmpty(m.economic_buyer)) { raw += 40; inputs++; signals.push('Economic buyer identified'); }
  if (nonEmpty(m.champion))       { raw += 25; inputs++; signals.push('Champion identified'); }
  const calls = acc.calls || [];
  if (calls.some(c => c?.decisionMaker)) { raw += 20; inputs++; signals.push('Decision maker on a call'); }
  const personas = acc.personas || [];
  if (personas.some(p => /economic|champion/i.test(`${p?.role || ''} ${p?.title || ''}`))) {
    raw += 15; inputs++; signals.push('Persona tagged economic/champion');
  }
  return { score: clamp(raw), signals, inputs };
}

function scoreBudget(acc) {
  const signals = [];
  let raw = 0, inputs = 0;
  if ((acc.acv || 0) > 0) { raw += 40; inputs++; signals.push(`ACV $${Math.round(acc.acv).toLocaleString()}`); }
  if ((acc.prods || []).length > 0) {
    raw += 20; inputs++; signals.push(`${acc.prods.length} product${acc.prods.length > 1 ? 's' : ''} attached`);
  }
  const m = acc.medpicc || {};
  if (nonEmpty(m.metrics)) { raw += 25; inputs++; signals.push('Metrics defined'); }
  const calls = acc.calls || [];
  // Spec says gongScore.budget >= 7. Prospector's GONG rubric has no 'budget' key —
  // mapped to 'commercial' (max 5 in rubric, threshold ≥ 4 = "covered well").
  if (calls.some(c => (c?.gongScore?.commercial ?? 0) >= 4)) {
    raw += 15; inputs++; signals.push('Commercial overview covered on a call');
  }
  return { score: clamp(raw), signals, inputs };
}

function scoreUrgency(acc) {
  const signals = [];
  let raw = 0, inputs = 0;
  if (nonEmpty(acc.timeline)) { raw += 30; inputs++; signals.push('Timeline set'); }
  const curRank = STAGE_RANK[acc.stage] ?? 0;
  if (curRank >= 3)      { raw += 40; inputs++; signals.push(`${acc.stage} stage (Proposal+)`); }
  else if (curRank >= 1) { raw += 20; inputs++; signals.push(`${acc.stage} stage (Engaged+)`); }
  const m = acc.medpicc || {};
  if (nonEmpty(m.decision_process)) { raw += 25; inputs++; signals.push('Decision process documented'); }
  const calls = acc.calls || [];
  if (calls.length) {
    const latest = calls[calls.length - 1];
    const suggRank = STAGE_RANK[latest?.suggestedStage] ?? -99;
    if (suggRank > curRank) { raw += 15; inputs++; signals.push(`Latest call suggests → ${latest.suggestedStage}`); }
  }
  return { score: clamp(raw), signals, inputs };
}

function scoreNeed(acc) {
  const signals = [];
  let raw = 0, inputs = 0;
  const m = acc.medpicc || {};
  if (nonEmpty(m.identify_pain))     { raw += 30; inputs++; signals.push('Pain identified'); }
  if (nonEmpty(m.decision_criteria)) { raw += 20; inputs++; signals.push('Decision criteria documented'); }
  const calls = acc.calls || [];
  if (calls.some(c => (c?.painPoints || []).length > 0)) {
    raw += 25; inputs++; signals.push('Pain points captured on calls');
  }
  // Spec: avg gongScore mean ≥ 7. Prospector rubric maxes at 41 across 10 fields
  // (mean of 7 unreachable). Reinterpreted: avg totalScore ≥ 70% of max.
  if (calls.length) {
    const avgPct = calls.reduce((s, c) => s + (c?.totalScore || 0), 0) / calls.length / GONG_MAX;
    if (avgPct >= 0.7) { raw += 15; inputs++; signals.push('Strong avg call score (≥70%)'); }
  }
  if ((acc.sigs || []).length > 2) { raw += 10; inputs++; signals.push(`${acc.sigs.length} signals tagged`); }
  return { score: clamp(raw), signals, inputs };
}

function daysSinceLast(acc) {
  if (!acc.last) return null;
  return Math.floor((Date.now() - new Date(acc.last).getTime()) / 86400000);
}

function scoreEngagement(acc, frontierEntry, threadCache) {
  const signals = [];
  let raw = 0, inputs = 0;

  const days = daysSinceLast(acc);
  if (days != null) {
    if (days <= 14)      { raw += 35; inputs++; signals.push(`Touched ${days}d ago`); }
    else if (days <= 30) { raw += 20; inputs++; signals.push(`Touched ${days}d ago`); }
    else if (days <= 60) { raw += 10; inputs++; signals.push(`Touched ${days}d ago`); }
  }

  const domain = extractDomain(acc);
  const tc = domain ? threadCache?.[domain] : null;
  if (tc) {
    if (tc.last_contact_direction === 'inbound') {
      raw += 25; inputs++; signals.push('Last Gmail contact inbound');
    }
    if (tc.sentiment === 'positive')     { raw += 15; inputs++; signals.push('Positive thread sentiment'); }
    else if (tc.sentiment === 'at_risk') { raw -= 10; inputs++; signals.push('At-risk thread sentiment'); }
    else if (tc.sentiment === 'stalled') { raw -= 20; inputs++; signals.push('Stalled thread sentiment'); }
  }

  const calls = acc.calls || [];
  if (calls.length >= 2) { raw += 15; inputs++; signals.push(`${calls.length} calls logged`); }

  const cad = frontierEntry?.outbound?.cadence;
  if (cad?.state === 'reply_waiting' || cad?.state === 'replied') {
    raw += 10; inputs++; signals.push(`Cadence: ${cad.state}`);
  }

  return { score: clamp(raw), signals, inputs };
}

function scoreRelationship(acc, frontierEntry) {
  const signals = [];
  let raw = 0, inputs = 0;
  const calls = acc.calls || [];
  if (calls.length >= 3)       { raw += 50; inputs++; signals.push(`${calls.length} calls (deep)`); }
  else if (calls.length === 2) { raw += 35; inputs++; signals.push('2 calls'); }
  else if (calls.length === 1) { raw += 20; inputs++; signals.push('1 call'); }
  const personas = acc.personas || [];
  if (personas.length >= 2) { raw += 20; inputs++; signals.push(`Multi-threaded (${personas.length} personas)`); }
  const m = acc.medpicc || {};
  if (nonEmpty(m.champion)) { raw += 20; inputs++; signals.push('Champion engaged'); }
  const steps = frontierEntry?.outbound?.cadence?.steps || [];
  if (steps.length >= 3) { raw += 10; inputs++; signals.push(`${steps.length} cadence touches`); }
  return { score: clamp(raw), signals, inputs };
}

const confidenceOf = inputs => inputs >= 3 ? 'scored' : inputs >= 1 ? 'partial' : 'empty';

const WEIGHTS = {
  need: 0.20,
  engagement: 0.20,
  authority: 0.18,
  urgency: 0.17,
  budget: 0.15,
  relationship: 0.10,
};

export function scoreAccount(acc, frontierEntry, threadCache) {
  if (!acc) return { axes: {}, overall: 0 };

  const authority    = scoreAuthority(acc);
  const budget       = scoreBudget(acc);
  const urgency      = scoreUrgency(acc);
  const need         = scoreNeed(acc);
  const engagement   = scoreEngagement(acc, frontierEntry, threadCache);
  const relationship = scoreRelationship(acc, frontierEntry);

  const axes = {
    authority:    { score: authority.score,    confidence: confidenceOf(authority.inputs),    signals: authority.signals },
    budget:       { score: budget.score,       confidence: confidenceOf(budget.inputs),       signals: budget.signals },
    urgency:      { score: urgency.score,      confidence: confidenceOf(urgency.inputs),      signals: urgency.signals },
    need:         { score: need.score,         confidence: confidenceOf(need.inputs),         signals: need.signals },
    engagement:   { score: engagement.score,   confidence: confidenceOf(engagement.inputs),   signals: engagement.signals },
    relationship: { score: relationship.score, confidence: confidenceOf(relationship.inputs), signals: relationship.signals },
  };

  const overall = Math.round(
    axes.need.score         * WEIGHTS.need +
    axes.engagement.score   * WEIGHTS.engagement +
    axes.authority.score    * WEIGHTS.authority +
    axes.urgency.score      * WEIGHTS.urgency +
    axes.budget.score       * WEIGHTS.budget +
    axes.relationship.score * WEIGHTS.relationship
  );

  return { axes, overall };
}
