import React, { useState, useEffect } from 'react';
import { mono } from '../../constants/colors';
import { T } from '../../constants/tokens';
import { MODELS } from '../../config/models';

// Shared Tier-2 "Ask" primitive, used by both business and influencer
// cards. Context is branched on account_kind; the LLM call and
// MODELS.FAST usage are unchanged from the original implementation
// (account-card-unification-and-outreach-v1, relocated out of the retired
// AccountCardActionBar.js during -full-redesign-v2).
export function QuickAskBar({ acc }) {
  const [quickQuery, setQuickQuery] = useState("");
  const [quickAnswer, setQuickAnswer] = useState(null);
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickFocus, setQuickFocus] = useState(false);
  const [quickGhostIdx, setQuickGhostIdx] = useState(0);
  const [quickCopied, setQuickCopied] = useState(false);
  const isInfluencer = acc.accountKind === 'influencer';
  const QUICK_GHOSTS = React.useMemo(() => isInfluencer ? [
    `Ask anything about ${acc.name}…`,
    `Draft an outreach angle…`,
    `What's their fit rationale?`,
    `Summarize their niche…`,
  ] : [
    `Ask anything about ${acc.name}…`,
    `Draft a follow-up email…`,
    `What's blocking this deal?`,
    `Summarize last call…`,
  ], [acc.name, isInfluencer]);
  useEffect(() => {
    if (quickFocus || quickQuery) return;
    const t = setInterval(() => setQuickGhostIdx(i => (i + 1) % QUICK_GHOSTS.length), 4000);
    return () => clearInterval(t);
  }, [quickFocus, quickQuery, QUICK_GHOSTS.length]);

  const askQuick = async () => {
    if (!quickQuery.trim()) return;
    setQuickLoading(true); setQuickAnswer(null);
    let contextBlock;
    if (isInfluencer) {
      const d = acc.influencerDetail || {};
      contextBlock = `Creator: ${acc.name} | Relationship stage: ${d.relationship_stage || "not_contacted"} | Fit score: ${d.fit_score ?? "?"}\nBio: ${d.bio_snapshot || "unknown"}\nNiche: ${d.niche_assessment?.category || "unknown"} | Content type: ${d.niche_assessment?.content_type || "unknown"}\nFit rationale: ${d.fit_rationale || "none"}\nFit signals: ${(d.fit_signals || []).map(s => `${s.axis}: ${s.note}`).join("; ") || "none"}`;
    } else {
      const callSummaries = (acc.calls || []).slice(-3).map((c, i) => `Call ${i + 1} (${c.date}): ${c.summary}`).join("\n");
      contextBlock = `Account: ${acc.name} | Stage: ${acc.stage || "Prospecting"} | Tier: ${acc.tier || "?"} | Vertical: ${acc.vert || "?"}\nBusiness model: ${acc.bm || "unknown"} | product fit: ${acc.pf || "unknown"}\nProducts: ${(acc.prods || []).join(", ") || "none"} | Use cases: ${(acc.ucs || []).join(", ") || "none"}\nCall history:\n${callSummaries || "None"}`;
    }
    try {
      const r = await fetch("/proxy/anthropic/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: MODELS.FAST, max_tokens: 400, messages: [{ role: "user", content: `${contextBlock}\n\nQ: ${quickQuery}\n\nAnswer in 2-3 sentences max, specific to this account.` }] }) });
      const d = await r.json(); setQuickAnswer(d.content?.[0]?.text || "No answer.");
    } catch (e) { setQuickAnswer("Error: " + e.message); }
    setQuickLoading(false);
  };

  return (
    <>
      <style>{`@keyframes prospectorBlink{50%{opacity:0}} @keyframes prospectorPulse{0%,100%{opacity:.35}50%{opacity:1}}`}</style>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid #1a3a1a`, background: '#050f05', margin: '-12px -14px 12px' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', position: 'relative' }}>
          <span style={{ ...mono, fontSize: 12, color: T.neon, flexShrink: 0, opacity: 0.7 }}>▸</span>
          <div style={{ flex: 1, position: 'relative' }}>
            <input
              value={quickQuery}
              onChange={e => setQuickQuery(e.target.value)}
              onFocus={() => setQuickFocus(true)}
              onBlur={() => setQuickFocus(false)}
              onKeyDown={e => e.key === 'Enter' && askQuick()}
              placeholder=""
              style={{ ...mono, width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '6px 10px', background: T.bg.base, border: `1px solid ${quickFocus ? T.neon : `${T.neon}33`}`, borderRadius: 4, color: '#cfe8d4', outline: 'none', transition: 'border-color 0.15s', caretColor: T.neon }}
            />
            {!quickQuery && !quickFocus && (
              <span style={{ ...mono, position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: `${T.neon}66`, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                {QUICK_GHOSTS[quickGhostIdx]}
                <span style={{ marginLeft: 2, color: T.neon, animation: 'prospectorBlink 1s steps(2) infinite' }}>▊</span>
              </span>
            )}
          </div>
          <button onClick={askQuick} disabled={!quickQuery.trim() || quickLoading}
            style={{ ...mono, fontSize: 11, height: 28, padding: '0 14px', background: quickQuery.trim() ? `${T.neon}14` : 'transparent', border: `1px solid ${quickQuery.trim() ? T.neon : '#1a3a1a'}`, color: quickQuery.trim() ? T.neon : '#5a6a5a', borderRadius: 4, cursor: quickQuery.trim() && !quickLoading ? 'pointer' : 'default', letterSpacing: '0.08em', textShadow: quickQuery.trim() ? `0 0 6px ${T.neon}55` : 'none', flexShrink: 0 }}>
            {quickLoading ? '⬡' : 'ASK →'}
          </button>
          {quickAnswer && <button onClick={() => { setQuickAnswer(null); setQuickQuery(''); setQuickCopied(false); }} style={{ background: 'transparent', border: 'none', color: '#5a6a5a', fontSize: 14, cursor: 'pointer', padding: '0 2px' }}>✕</button>}
        </div>
        {quickLoading && !quickAnswer && (
          <div style={{ ...mono, marginTop: 8, padding: '8px 12px', background: T.bg.surface, border: `1px solid ${T.neon}33`, borderRadius: 4, color: T.neon, fontSize: 14, letterSpacing: '0.4em' }}>
            <span style={{ animation: 'prospectorPulse 1.2s ease-in-out infinite' }}>·</span>
            <span style={{ animation: 'prospectorPulse 1.2s ease-in-out infinite', animationDelay: '.2s' }}> ·</span>
            <span style={{ animation: 'prospectorPulse 1.2s ease-in-out infinite', animationDelay: '.4s' }}> ·</span>
          </div>
        )}
        {quickAnswer && (
          <div style={{ marginTop: 8, padding: '10px 12px', background: T.bg.surface, border: `1px solid ${T.neon}44`, borderRadius: 4, position: 'relative' }}>
            <p style={{ ...mono, margin: 0, fontSize: 11, color: '#cfe8d4', lineHeight: 1.7, whiteSpace: 'pre-wrap', paddingRight: 60 }}>{quickAnswer}</p>
            <button
              onClick={() => { navigator.clipboard.writeText(quickAnswer); setQuickCopied(true); setTimeout(() => setQuickCopied(false), 1500); }}
              style={{ ...mono, position: 'absolute', top: 6, right: 6, fontSize: 10, padding: '2px 8px', background: quickCopied ? `${T.neon}18` : 'transparent', border: `1px solid ${quickCopied ? `${T.neon}66` : `${T.neon}33`}`, color: quickCopied ? T.neon : '#5a6a5a', borderRadius: 3, cursor: 'pointer' }}>
              {quickCopied ? '✓' : '⎘ COPY'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export default QuickAskBar;
