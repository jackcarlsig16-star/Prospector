import React, { useState, useRef } from 'react';
import { C, mono } from '../constants/colors';
import { MODELS } from '../config/models';

const TEAL = '#00C9A7';

// ── Lookup maps ───────────────────────────────────────────────────────────────
const PROCESS_STATE_LABELS = {
  unqualified: 'Unqualified',
  qualifying: 'Qualifying',
  solution_fit_confirmed: 'Solution Fit',
  technical_win_in_progress: 'Tech Win',
  risk_win_in_progress: 'Risk Win',
  commercial_win_in_progress: 'Commercial Win',
  awaiting_signature: 'Awaiting Signature',
  closeable: 'Closeable',
  stalled: 'Stalled',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
};

const BLOCKER_LABELS = {
  no_pain: 'No pain stated',
  no_metric: 'No impact metrics',
  no_champion: 'No champion identified',
  no_decision_process: 'Buying process unclear',
  no_technical_validation: 'No technical validation',
  no_production_request: 'Production request not started',
  risk_pending: 'Risk review pending',
  pricing_misalignment: 'Pricing misalignment',
  legal_redlines: 'Legal redlines open',
  unresponsive: 'Prospect unresponsive',
  timeline_slipped: 'Timeline slipped',
  internal_approval: 'Internal approval needed',
  funding_pending: 'Waiting on funding close',
  none: 'None',
};

const TRACK_STATE_LABELS = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  blocked: 'Blocked',
  pricing_shared: 'Pricing Shared',
  quote_created: 'Quote Created',
  order_form_sent: 'Order Form Sent',
  legal: 'Legal',
  signed: 'Signed',
};

const DISCOVERY_SIGNAL_LABELS = {
  pain_confirmed: 'Pain',
  impact_dollarized: 'Impact $',
  timeline_stated: 'Timeline',
  buying_process_clarified: 'Buy Process',
  technical_owner_identified: 'Tech Owner',
};

function processStateColor(s) {
  if (s === 'closeable' || s === 'closed_won' || s === 'awaiting_signature') return C.green;
  if (s === 'stalled' || s === 'closed_lost') return C.red;
  return TEAL;
}

function trackStateColor(s) {
  if (s === 'approved' || s === 'signed') return C.green;
  if (s === 'blocked') return C.red;
  if (!s || s === 'not_started') return '#444';
  return C.gold;
}

function closeConfColor(v) {
  if (v >= 0.7) return C.green;
  if (v >= 0.4) return C.gold;
  return C.red;
}

// ── buildContext ──────────────────────────────────────────────────────────────
function buildContext(acc) {
  const calls = [...(acc.calls || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const recentCalls = calls.slice(-3);
  const daysInStage = acc.activeDealAt
    ? Math.round((Date.now() - new Date(acc.activeDealAt)) / 86400000)
    : null;

  const callSummary = !recentCalls.length ? 'No calls logged.' : recentCalls.map(c => {
    const steps = (c.nextSteps || []).map(ns => typeof ns === 'string' ? ns : (ns?.text || '')).filter(Boolean);
    const committed = (c.committedActions || []).map(ca => `${ca.owner || '?'}: ${ca.action || ''}${ca.dueDate ? ` by ${ca.dueDate}` : ''}`).filter(Boolean);
    return `--- Call: ${c.date || 'unknown'} ---
Summary: ${(c.summary || 'none').slice(0, 1500)}${c.transcript ? `\nTranscript excerpt: ${c.transcript.slice(0, 2000)}` : ''}
Next steps: ${steps.length ? steps.join('; ') : 'none'}
Committed: ${committed.length ? committed.join('; ') : 'none'}`;
  }).join('\n\n');

  const med = acc.medpicc || {};
  const medpiccLines = Object.entries(med).filter(([, v]) => v).map(([k, v]) => `  ${k}: ${String(v).slice(0, 100)}`).join('\n') || '  (none filled in)';

  const latestCall = calls[calls.length - 1] || {};
  const openActions = [
    ...(latestCall.nextSteps || []).map(ns => typeof ns === 'string' ? ns : (ns?.text || '')),
    ...(latestCall.committedActions || []).map(ca => `${ca.owner}: ${ca.action}${ca.dueDate ? ` by ${ca.dueDate}` : ''}`),
  ].filter(Boolean);

  const allProds = [
    ...(acc.prods || []),
    ...calls.flatMap(c => (c.productsDiscussed || []).map(p => typeof p === 'string' ? p : (p?.product || ''))),
  ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

  // Compliance
  let compliance = null;
  try {
    const raw = localStorage.getItem('prospector_compliance');
    if (raw) compliance = (JSON.parse(raw) || {})[acc.id] || null;
  } catch {}

  const complianceSection = compliance ? `Type: ${compliance.type} (${compliance.type === 'partner' ? '4-step' : '3-step'} track)
  Steps:
  ${(compliance.steps || []).map(s =>
    `- ${s.id}: ${s.status}${s.startedAt ? ` (started ${s.startedAt.slice(0, 10)})` : ''}${s.completedAt ? ` (completed ${s.completedAt.slice(0, 10)})` : ''}${s.notes ? ` | notes: ${s.notes}` : ''}`
  ).join('\n  ')}
  Production Request: ${compliance.steps?.find(s => s.id === 'prod_request')?.status || 'Not Started'}
  Security Questionnaire: ${compliance.steps?.find(s => s.id === 'security_q')?.status || 'Not Started'}`
    : 'No compliance record on file — treat as Not Started across all steps.';

  // Pricing
  let pricing = null;
  let pricingIntel = null;
  try {
    const pRaw = localStorage.getItem('prospector_pricing_files');
    if (pRaw) pricing = (JSON.parse(pRaw) || {})[acc.id] || null;
  } catch {}
  try {
    const iRaw = localStorage.getItem('prospector_pricing_intel');
    if (iRaw) pricingIntel = (JSON.parse(iRaw) || {})[acc.id] || null;
  } catch {}

  const pricingSection = pricing
    ? `Products quoted: ${pricing.products?.filter(p => p.included).map(p => p.name).join(', ') || pricing.products?.map(p => p.name).join(', ') || 'none'}
  Commit ramp: ${pricing.commitRamp ? 'yes' : 'no'}
  Partner deal: ${pricing.isPartner ? 'yes' : 'no'}
  Billing start: ${pricing.billingStart || 'not set'}
  Quote exists: yes`
    : 'No pricing session on file — quote not yet created.';

  const pricingIntelSection = pricingIntel ? [
    pricingIntel.convRate != null && `Conv rate: ${pricingIntel.convRate}%`,
    pricingIntel.annualValuePerUser != null && `Value/user: $${pricingIntel.annualValuePerUser}/yr`,
  ].filter(Boolean).join(', ') || 'no data points confirmed' : null;

  const totalCallChars = recentCalls.reduce((sum, c) => sum + (c.summary?.length || 0) + (c.transcript?.length || 0), 0);

  let aeContext = '';
  try { aeContext = (JSON.parse(localStorage.getItem('prospector_timeline_context') || '{}'))[acc.id] || ''; } catch {}

  let ctx = `ACCOUNT: ${acc.name}
Vertical: ${acc.vert || '—'} | Stage: ${acc.stage || '—'} | Days in stage: ${daysInStage != null ? daysInStage + 'd' : 'unknown'}
Today: ${new Date().toISOString().slice(0, 10)}

CALL HISTORY (${calls.length} total; showing 3 most recent):
${callSummary}

MEDPICC:
${medpiccLines}

OPEN ACTION ITEMS:
${openActions.length ? openActions.map(a => `  - ${a}`).join('\n') : '  None'}

PRODUCTS DISCUSSED: ${allProds.join(', ') || '—'}

NOTES: ${(acc.notes || '').slice(0, 400) || '—'}

COMPLIANCE TRACK:
  ${complianceSection}

PRICING & QUOTE STATE:
  ${pricingSection}${pricingIntelSection ? `\n  Pricing intelligence: ${pricingIntelSection}` : ''}

ACCOUNT SIGNAL SCORE:
  Tier: ${acc.tier || 'unknown'} (score: ${acc.signalBreakdown?.signalScore ?? acc.score ?? 'unknown'})
  Top signal: ${acc.signalBreakdown?.topSignal || 'none'}
  Payment signals: ${acc.signalBreakdown?.paymentSignals?.join(', ') || 'none'}
  Onboarding signals: ${acc.signalBreakdown?.onboardingSignals?.join(', ') || 'none'}
  Scale signals: ${acc.signalBreakdown?.scaleSignals?.join(', ') || 'none'}

CONTEXT QUALITY:
  Recent call data: ${totalCallChars > 3000 ? 'rich (transcript available)' : totalCallChars > 500 ? 'moderate (summaries only)' : 'sparse (limited call history)'}
  Number of logged calls: ${calls.length}`;

  if (aeContext) {
    ctx += `\n\nAE CONTEXT (AE-provided annotation — treat as high-confidence signal):\n${aeContext}`;
  }

  return ctx;
}

// ── Prompt instructions ───────────────────────────────────────────────────────
const INSTRUCTIONS = `You are the deal timeline engine for an AE sales tool.

Your job is to produce a milestone-based project tracker, not a deal analysis. Be concise. Do not write narratives or explanations. Surface milestones and dates.

OUTPUT PHILOSOPHY:
- timeline_summary: 1-2 sentences maximum. State process state and the single most important fact.
- milestone_timeline: list key milestones only — completed, in progress, and the next 2-3 pending. Do not list every possible step. Skip milestones that are not yet relevant.
- primary_blocker: ONE blocker only — the single thing most likely to prevent close. If nothing is blocking, type = "none".
- Do not inflate routine in-progress items into blockers. A standard attestation with a future deadline is not a blocker. An open RFI with no response is a blocker. Use judgment.
- recommended_actions: maximum 3 actions. Each action title should be under 10 words. No explanation in the title — put brief context in why_now only.
- predictions: close_confidence and days_to_signature are the most important fields. Be realistic.

MILESTONE PHILOSOPHY:
- Treat production request / risk approval as one track. If PR is submitted and approved, mark the track complete — do not surface attestation details unless they are explicitly blocking approval.
- Treat commercial (pricing → quote → OF → Ironclad → signature) as one track. Standard legal steps are not individual milestones unless one is specifically stalled.
- Discovery quality matters for early-stage deals. For deals past Active Deal stage with PR approved, discovery gaps are lower priority than commercial progression.
- Target dates matter more than gap explanations. If a deal has a known close date, every milestone should have a target date working backward from it.

SALES PROCESS — gated workflow (use to identify what's actually missing):

Track 1 — RISK/COMPLIANCE (start early, runs parallel):
  Production Request submitted → Risk tagged in Chatter → RFI resolved (if any) → Risk approved

Track 2 — COMMERCIAL (runs parallel with risk):
  Pricing discussed → Quote in CPQ → Order form generated → Ironclad launched → Signature

Track 3 — CLOSE:
  Risk approved + Signature = closeable → Closed Won → BizOps lock

CRITICAL RULES:
- Risk and commercial are parallel. A deal blocked on risk is not blocked on commercial unless explicitly stated.
- Do not recommend starting commercial after risk is done. They should run simultaneously.
- If PR is submitted and approved, risk track = complete. Do not add sub-steps unless there is an explicit open RFI.
- Standard attestation items with future deadlines are NOT blockers unless Risk has explicitly said they are required before approval.
- Use explicit evidence only. Do not invent blockers.
- If calls, notes, or MEDPICC mention funding, investment round, capital raise, runway, or similar financial gating events — set primary_blocker.type = "funding_pending" if the deal cannot realistically advance without it. Estimate the funding timeline from context if mentioned (e.g. "Q3 close", "60 days", "Series A") and include the estimate in the explanation field.
- When primary_blocker.type is funding_pending: suppress commercial track urgency — do not recommend pricing, quote, or contract actions as next steps. Instead recommend staying warm and scheduling a check-in at the expected funding date. funding_pending overrides all other commercial recommendations.

AE CONTEXT RULES (when AE CONTEXT section is present):
- Treat it as authoritative. If it contradicts an inferred blocker, defer to AE context.
- If AE context defines exit criteria for a trial or milestone, use that definition — do not infer from general process.
- If AE context states a close target date, use it as the anchor for all target_date fields.

TARGET DATE LOGIC:
- If acc has a known close date or the AE mentioned a timeline, work all milestone targets backward from it
- Days to signature should reflect realistic remaining work, not just calendar days to stated close date
- Flag if milestone targets are incompatible with stated close date (but do this in timeline_summary only — one sentence)

Return ONLY valid JSON. No preamble, no markdown, no explanation outside the JSON.

{
  "process_state": "unqualified|qualifying|solution_fit_confirmed|technical_win_in_progress|risk_win_in_progress|commercial_win_in_progress|awaiting_signature|closeable|stalled|closed_won|closed_lost",
  "timeline_summary": "",
  "milestone_timeline": [
    {
      "milestone": "",
      "track": "discovery|risk|commercial|close",
      "status": "completed|in_progress|missing|blocked",
      "evidence": [],
      "target_date": "",
      "confidence": 0.0
    }
  ],
  "missing_milestones": [],
  "primary_blocker": {
    "type": "no_pain|no_metric|no_champion|no_decision_process|no_technical_validation|no_production_request|risk_pending|pricing_misalignment|legal_redlines|unresponsive|timeline_slipped|internal_approval|funding_pending|none",
    "explanation": ""
  },
  "risk_track": {
    "state": "not_started|in_progress|pending_approval|approved|blocked",
    "production_request": "",
    "security_questionnaire": "",
    "gaps": []
  },
  "commercial_track": {
    "state": "not_started|pricing_shared|quote_created|order_form_sent|legal|signed",
    "gaps": []
  },
  "discovery_quality": {
    "pain_confirmed": true,
    "impact_dollarized": true,
    "timeline_stated": true,
    "buying_process_clarified": true,
    "technical_owner_identified": true,
    "score": "low|medium|high"
  },
  "next_best_milestone": {
    "milestone": "",
    "track": "discovery|risk|commercial|close",
    "why_now": ""
  },
  "predictions": {
    "close_confidence": 0.0,
    "stall_risk": 0.0,
    "days_to_next_milestone": null,
    "days_to_signature": null
  },
  "recommended_actions": [
    {
      "action": "",
      "owner": "AE|Prospect|Internal",
      "priority": "high|medium|low"
    }
  ]
}`;

// ── Sub-components ────────────────────────────────────────────────────────────
function MilestoneViz({ milestones }) {
  const SLOT_W = 92;
  const CONN_W = 24;

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4, marginBottom: 12 }}>
      <div style={{ display: 'inline-flex', alignItems: 'flex-start', userSelect: 'none' }}>
        {milestones.map((m, i) => {
          const isLast = i === milestones.length - 1;
          const isDone = m.status === 'completed';
          const isCurrent = m.status === 'in_progress';
          const isBlocked = m.status === 'blocked';
          const nextForward = ['missing', 'blocked'].includes(milestones[i + 1]?.status);

          const dotSz = isCurrent ? 14 : 10;
          const dotBg = isDone ? '#222' : isCurrent ? C.gold : 'transparent';
          const dotBrd = isDone ? '#3a3a3a' : isCurrent ? C.gold : isBlocked ? C.red : TEAL;
          const textColor = isDone ? '#555' : isCurrent ? C.gold : isBlocked ? C.red : TEAL;
          const trackColor = isDone ? '#3a3a3a' : isCurrent ? C.gold + '99' : '#444';

          const lineColor = isDone ? '#282828' : isBlocked ? C.red : TEAL;
          const lineDash = m.status === 'missing' || (isCurrent && nextForward);
          const connPt = 16 + 4 + Math.floor(dotSz / 2) - 1;

          return (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', flexShrink: 0 }}>
              <div style={{ width: SLOT_W, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ ...mono, fontSize: 9, color: trackColor, height: 16, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {m.track}
                </span>
                <div style={{ width: dotSz, height: dotSz, borderRadius: '50%', background: dotBg, border: `2px solid ${dotBrd}`, marginTop: 4, flexShrink: 0, boxShadow: isCurrent ? `0 0 10px ${C.gold}44` : isBlocked ? `0 0 6px ${C.red}44` : undefined }} />
                <span style={{ ...mono, fontSize: 10, color: textColor, textAlign: 'center', marginTop: 6, lineHeight: 1.3, width: SLOT_W - 6, display: 'block' }}>
                  {m.milestone}
                </span>
              </div>
              {!isLast && (
                <div style={{ width: CONN_W, paddingTop: connPt, flexShrink: 0, boxSizing: 'border-box' }}>
                  <div style={{ height: 0, borderTop: `2px ${lineDash ? 'dashed' : 'solid'} ${lineColor}` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function truncateSentences(text, max) {
  if (!text) return text;
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  if (sentences.length <= max) return text;
  return sentences.slice(0, max).join('') + '…';
}

function TrackRow({ label, state, gaps, showGaps }) {
  const col = trackStateColor(state);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <span style={{ ...mono, fontSize: 10, color: '#444', width: 86, flexShrink: 0 }}>{label}</span>
      <span style={{ ...mono, fontSize: 10, padding: '1px 6px', borderRadius: 3, background: col + '14', border: `1px solid ${col}33`, color: col }}>
        {TRACK_STATE_LABELS[state] || state || '—'}
      </span>
      {showGaps && gaps?.length > 0 && (
        <span style={{ ...mono, fontSize: 10, color: '#555' }}>{gaps.join(' · ')}</span>
      )}
    </div>
  );
}

function DiscoveryBadges({ dq }) {
  const keys = Object.keys(DISCOVERY_SIGNAL_LABELS);
  const scoreColor = dq.score === 'high' ? C.green : dq.score === 'medium' ? C.gold : C.red;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 10, flexWrap: 'wrap' }}>
      <span style={{ ...mono, fontSize: 10, color: '#444', marginRight: 2, flexShrink: 0 }}>Discovery</span>
      {keys.map(k => (
        <span key={k} style={{ ...mono, fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 5px', borderRadius: 3, background: dq[k] ? `${C.green}10` : '#111', border: `1px solid ${dq[k] ? C.green + '33' : '#222'}`, color: dq[k] ? C.green : '#3a3a3a' }}>
          <span style={{ fontSize: 6, lineHeight: 1 }}>{dq[k] ? '●' : '○'}</span>
          {DISCOVERY_SIGNAL_LABELS[k]}
        </span>
      ))}
      <span style={{ ...mono, fontSize: 10, color: scoreColor, marginLeft: 2 }}>{dq.score}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DealTimeline({ acc, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [aeContext, setAeContext] = useState(() => {
    try { return (JSON.parse(localStorage.getItem('prospector_timeline_context') || '{}'))[acc.id] || ''; } catch { return ''; }
  });
  const saveTimer = useRef(null);
  const timeline = acc.dealTimeline || null;

  const handleAeContext = (val) => {
    setAeContext(val);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        const all = JSON.parse(localStorage.getItem('prospector_timeline_context') || '{}');
        all[acc.id] = val;
        localStorage.setItem('prospector_timeline_context', JSON.stringify(all));
      } catch {}
    }, 500);
  };

  const clearAeContext = () => {
    handleAeContext('');
    clearTimeout(saveTimer.current);
    try {
      const all = JSON.parse(localStorage.getItem('prospector_timeline_context') || '{}');
      delete all[acc.id];
      localStorage.setItem('prospector_timeline_context', JSON.stringify(all));
    } catch {}
  };

  const callAPI = async (messages) => {
    const res = await fetch('/proxy/anthropic/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODELS.REASONING,
        max_tokens: 2500,
        messages,
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || '';
  };

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = buildContext(acc);
      const prompt = `${ctx}\n\n${INSTRUCTIONS}`;
      const messages = [{ role: 'user', content: prompt }];

      let text = await callAPI(messages);
      let parsed;

      try {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('no json');
        parsed = JSON.parse(match[0]);
      } catch {
        const retryMessages = [
          ...messages,
          { role: 'assistant', content: text },
          { role: 'user', content: 'Your previous response was not valid JSON. Return only the JSON object, no other text.' },
        ];
        const retryText = await callAPI(retryMessages);
        const m2 = retryText.match(/\{[\s\S]*\}/);
        if (!m2) throw new Error('No JSON returned');
        parsed = JSON.parse(m2[0]);
      }

      if (!parsed.process_state) throw new Error('Invalid response shape');
      onUpdate && onUpdate({ ...acc, dealTimeline: { ...parsed, generatedAt: new Date().toISOString() } });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const stateColor = timeline ? processStateColor(timeline.process_state) : TEAL;

  return (
    <div style={{ background: '#080808', border: '1px solid #1a1a1a', borderRadius: 7, padding: '14px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: timeline ? 14 : 0 }}>
        <span style={{ ...mono, fontSize: 12, fontWeight: 600, color: TEAL, textTransform: 'uppercase', letterSpacing: '0.08em' }}>⊟ Deal Timeline</span>
        {timeline && (
          <>
            <span style={{ ...mono, fontSize: 10, color: '#3a3a3a' }}>
              {new Date(timeline.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
            <span style={{ ...mono, fontSize: 10, padding: '1px 6px', borderRadius: 3, background: stateColor + '18', border: `1px solid ${stateColor}44`, color: stateColor }}>
              {PROCESS_STATE_LABELS[timeline.process_state] || timeline.process_state}
            </span>
          </>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={() => setContextOpen(o => !o)}
            style={{ ...mono, fontSize: 10, padding: '3px 8px', background: 'transparent', border: `1px solid ${aeContext ? TEAL + '55' : '#2a2a2a'}`, color: aeContext ? TEAL : '#444', borderRadius: 4, cursor: 'pointer' }}>
            {contextOpen ? '▾ AE Context' : `▸ AE Context${aeContext ? ' ●' : ''}`}
          </button>
          <button onClick={generate} disabled={loading}
            style={{ ...mono, fontSize: 11, padding: '3px 10px', background: loading ? 'transparent' : `${TEAL}14`, border: `1px solid ${loading ? '#333' : TEAL + '55'}`, color: loading ? '#555' : TEAL, borderRadius: 4, cursor: loading ? 'default' : 'pointer', transition: 'all 0.15s' }}>
            {loading ? '…generating' : timeline ? '↺ Regenerate' : '✦ Generate timeline'}
          </button>
        </div>
      </div>

      {contextOpen && (
        <div style={{ marginBottom: 12 }}>
          <textarea
            value={aeContext}
            onChange={e => handleAeContext(e.target.value)}
            rows={3}
            placeholder="Add context the AI might miss — e.g. 'Trial is confidence-building, not a hard gate. Close target June 30. Javon needs marketing traction before signing.'"
            style={{ ...mono, width: '100%', fontSize: 11, padding: '7px 10px', background: '#0d0d0d', border: `1px solid ${aeContext ? TEAL + '44' : '#222'}`, borderRadius: 4, color: '#aaa', resize: 'vertical', outline: 'none', boxSizing: 'border-box', lineHeight: 1.5 }}
          />
          {aeContext && (
            <button onClick={clearAeContext} style={{ ...mono, fontSize: 10, color: '#3a3a3a', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginTop: 2 }}>
              Clear
            </button>
          )}
        </div>
      )}

      {error && <div style={{ ...mono, fontSize: 11, color: C.red, marginBottom: 8 }}>Error: {error}</div>}

      {timeline && (
        <>
          {/* Summary */}
          {timeline.timeline_summary && (
            <p style={{ ...mono, fontSize: 11, color: '#888', margin: '0 0 14px', lineHeight: 1.6 }}>
              {truncateSentences(timeline.timeline_summary, 3)}
            </p>
          )}

          {/* Milestone viz */}
          {timeline.milestone_timeline?.length > 0 && (
            <MilestoneViz milestones={timeline.milestone_timeline} />
          )}

          {/* Track rows */}
          {(() => {
            const bt = timeline.primary_blocker?.type;
            const riskBlockers = ['risk_pending', 'no_production_request', 'no_technical_validation'];
            const commercialBlockers = ['pricing_misalignment', 'legal_redlines', 'internal_approval'];
            return (
              <>
                <TrackRow label="Risk / Compliance" state={timeline.risk_track?.state} gaps={timeline.risk_track?.gaps} showGaps={riskBlockers.includes(bt)} />
                <TrackRow label="Commercial" state={timeline.commercial_track?.state} gaps={timeline.commercial_track?.gaps} showGaps={commercialBlockers.includes(bt)} />
              </>
            );
          })()}

          {/* Discovery quality */}
          {timeline.discovery_quality && (
            <DiscoveryBadges dq={timeline.discovery_quality} />
          )}

          {/* Primary blocker */}
          {timeline.primary_blocker?.type && timeline.primary_blocker.type !== 'none' && (
            <div style={{ ...mono, fontSize: 11, color: C.red, marginTop: 10, padding: '6px 10px', background: `${C.red}0a`, border: `1px solid ${C.red}22`, borderRadius: 4 }}>
              ⚠ {BLOCKER_LABELS[timeline.primary_blocker.type] || timeline.primary_blocker.type}
              {timeline.primary_blocker.explanation && (
                <span style={{ color: '#666', marginLeft: 6 }}>{timeline.primary_blocker.explanation}</span>
              )}
            </div>
          )}

          {/* Next best milestone */}
          {timeline.next_best_milestone?.milestone && (
            <div style={{ marginTop: 10, padding: '7px 10px', background: `${TEAL}0a`, border: `1px solid ${TEAL}22`, borderRadius: 4, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ ...mono, fontSize: 10, color: TEAL + '88', flexShrink: 0 }}>NEXT</span>
              <span style={{ ...mono, fontSize: 11, color: TEAL }}>{timeline.next_best_milestone.milestone}</span>
              {timeline.next_best_milestone.why_now && (
                <span style={{ ...mono, fontSize: 10, color: '#555' }}>{timeline.next_best_milestone.why_now}</span>
              )}
            </div>
          )}

          {/* Predictions */}
          <div style={{ display: 'flex', gap: 16, marginTop: 12, paddingTop: 12, borderTop: '1px solid #1a1a1a', flexWrap: 'wrap' }}>
            {timeline.predictions?.close_confidence != null && (
              <span style={{ ...mono, fontSize: 11, color: '#555' }}>
                Close confidence:{' '}
                <span style={{ color: closeConfColor(timeline.predictions.close_confidence) }}>
                  {Math.round(timeline.predictions.close_confidence * 100)}%
                </span>
              </span>
            )}
            {timeline.predictions?.days_to_signature != null && (
              <span style={{ ...mono, fontSize: 11, color: '#555' }}>
                Est. to signature:{' '}
                <span style={{ color: TEAL }}>{timeline.predictions.days_to_signature}d</span>
              </span>
            )}
            {timeline.predictions?.stall_risk != null && timeline.predictions.stall_risk > 0.4 && (
              <span style={{ ...mono, fontSize: 11, color: C.red }}>
                Stall risk: {Math.round(timeline.predictions.stall_risk * 100)}%
              </span>
            )}
          </div>

          {/* Recommended actions */}
          {timeline.recommended_actions?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {timeline.recommended_actions.slice(0, 3).map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', padding: '3px 0' }}>
                  <span style={{ ...mono, fontSize: 10, color: a.priority === 'high' ? C.gold : '#3a3a3a', flexShrink: 0 }}>
                    {a.priority === 'high' ? '●' : '○'}
                  </span>
                  <span style={{ ...mono, fontSize: 11, color: a.priority === 'high' ? '#ccc' : '#666', flex: 1 }}>
                    {a.action}
                  </span>
                  <span style={{ ...mono, fontSize: 10, color: '#3a3a3a', flexShrink: 0 }}>{a.owner}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
