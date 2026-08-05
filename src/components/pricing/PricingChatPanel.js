import React, { useState, useRef, useEffect } from 'react';
import { C, mono } from '../../constants/colors';
import { MODELS } from '../../config/models';

const SYSTEM_PROMPT = `You are a sales assistant helping an Account Executive understand and present their pricing model. You have full context of the current deal including account details, MEDPICC, and the exact pricing session data.

Be direct, specific, and use the actual numbers from the pricing context. When asked to write content (slides, emails, talking points), write it ready to use — not a template. Match the AE's voice: confident, knowledgeable, not corporate.

You can help with:
- Explaining the pricing structure in plain language
- Writing slide content (investment overview, ROI summary, monthly ramp narrative)
- Generating talking points for specific personas (CFO, CTO, founder)
- Defending pricing against common objections
- Suggesting how to frame discounts and commitments
- Identifying the strongest and weakest parts of the deal structure
- Drafting follow-up emails that reference specific pricing points`;

const STARTERS = [
  "What are the strongest points to lead with for a CFO?",
  "Write me 3 slides: investment overview, ROI summary, monthly ramp",
  "How do I frame the commitment fee against their expected volume?",
  "What's the weakest part of this structure and how do I defend it?",
  "Draft a follow-up email summarizing this pricing proposal",
];

function renderInline(text) {
  const parts = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m;
  let idx = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={idx++}>{text.slice(last, m.index)}</span>);
    if (m[1] !== undefined) parts.push(<strong key={idx++} style={{ color: C.txt, fontWeight: 700 }}>{m[1]}</strong>);
    if (m[2] !== undefined) parts.push(<code key={idx++} style={{ background: "#1a1a1a", padding: "1px 4px", borderRadius: 3, fontSize: 12 }}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={idx++}>{text.slice(last)}</span>);
  return parts;
}

function renderMarkdown(text) {
  const lines = text.split('\n');
  const elements = [];
  let bulletBuffer = [];
  let k = 0;

  const flushBullets = () => {
    if (!bulletBuffer.length) return;
    elements.push(
      <ul key={k++} style={{ margin: "4px 0 4px 18px", padding: 0, listStyleType: "disc" }}>
        {bulletBuffer.map((b, i) => <li key={i} style={{ marginBottom: 2, color: C.txt }}>{renderInline(b)}</li>)}
      </ul>
    );
    bulletBuffer = [];
  };

  for (const line of lines) {
    const bulletMatch = line.match(/^[-*]\s+(.*)/);
    const headerMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (bulletMatch) {
      bulletBuffer.push(bulletMatch[1]);
    } else if (headerMatch) {
      flushBullets();
      elements.push(
        <div key={k++} style={{ fontWeight: 700, fontSize: headerMatch[1].length === 1 ? 14 : 13, color: C.gold, marginTop: 10, marginBottom: 4 }}>
          {headerMatch[2]}
        </div>
      );
    } else if (line.trim() === '') {
      flushBullets();
      elements.push(<div key={k++} style={{ height: 6 }} />);
    } else {
      flushBullets();
      elements.push(<div key={k++} style={{ color: C.txt }}>{renderInline(line)}</div>);
    }
  }
  flushBullets();
  return <>{elements}</>;
}

export default function PricingChatPanel({ buildContext, accName, annualTotal }) {
  const [chatHistory, setChatHistory] = useState([]);
  const [inputVal, setInputVal] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, loading]);

  const sendMessage = async (userMessage) => {
    const msg = userMessage.trim();
    if (!msg || loading) return;
    const context = buildContext();
    const newMessages = [...chatHistory, { role: "user", content: msg }];
    setChatHistory(newMessages);
    setInputVal("");
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/proxy/anthropic/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODELS.STANDARD,
          max_tokens: 1000,
          system: SYSTEM_PROMPT + "\n\n" + context,
          messages: newMessages,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error?.message || "Request failed");
      const reply = data.content?.[0]?.text || "Sorry, something went wrong.";
      setChatHistory(prev => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      setError(e.message || "Something went wrong");
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputVal);
    }
  };

  const copyResponse = (text, idx) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  };

  const fmtAcv = n => `$${Math.round(n).toLocaleString()}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 500 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 12, borderBottom: `1px solid ${C.brd}`, marginBottom: 16, flexShrink: 0 }}>
        <span style={{ ...mono, fontSize: 13, color: C.gold, fontWeight: 700 }}>✦ Ask Claude about this deal</span>
        {accName && (
          <span style={{ ...mono, fontSize: 11, color: C.mut }}>
            {accName}{annualTotal > 0 ? ` · ${fmtAcv(annualTotal)} ACV` : ""}
          </span>
        )}
        {chatHistory.length > 0 && (
          <button onClick={() => setChatHistory([])}
            style={{ marginLeft: "auto", background: "transparent", border: "none", ...mono, fontSize: 11, color: C.dim, cursor: "pointer", padding: "2px 6px", textDecoration: "underline" }}>
            Clear chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingBottom: 8 }}>
        {chatHistory.length === 0 && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <p style={{ ...mono, fontSize: 10, color: C.dim, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Starter prompts</p>
            {STARTERS.map((s, i) => (
              <button key={i} onClick={() => setInputVal(s)}
                onMouseOver={e => e.currentTarget.style.background = `${C.gold}1a`}
                onMouseOut={e => e.currentTarget.style.background = `${C.gold}0d`}
                style={{ textAlign: "left", background: `${C.gold}0d`, border: `1px solid ${C.goldBdr}`, borderRadius: 8, padding: "9px 13px", ...mono, fontSize: 12, color: C.mut, cursor: "pointer", lineHeight: 1.5 }}>
                {s}
              </button>
            ))}
          </div>
        )}

        {chatHistory.map((msg, i) => (
          <div key={i} style={{ display: "flex", flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
            <div style={{
              position: "relative",
              maxWidth: "82%",
              background: msg.role === "user" ? "#1a1200" : "#0d0d0d",
              border: `1px solid ${msg.role === "user" ? "#a8620055" : C.brd}`,
              borderLeft: msg.role === "assistant" ? `3px solid ${C.blue}` : undefined,
              borderRadius: 8,
              padding: msg.role === "assistant" ? "10px 42px 10px 13px" : "10px 13px",
            }}>
              {msg.role === "assistant" && (
                <button onClick={() => copyResponse(msg.content, i)}
                  style={{ position: "absolute", top: 7, right: 8, background: "transparent", border: "none", ...mono, fontSize: 10, color: copiedIdx === i ? C.green : C.dim, cursor: "pointer", padding: "2px 4px", whiteSpace: "nowrap" }}>
                  {copiedIdx === i ? "✓" : "Copy ↗"}
                </button>
              )}
              <div style={{ ...mono, fontSize: 13, lineHeight: 1.6 }}>
                {msg.role === "assistant" ? renderMarkdown(msg.content) : <span style={{ color: C.txt }}>{msg.content}</span>}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex" }}>
            <div style={{ background: "#0d0d0d", border: `1px solid ${C.brd}`, borderLeft: `3px solid ${C.blue}`, borderRadius: 8, padding: "10px 13px" }}>
              <span style={{ ...mono, fontSize: 13, color: C.mut, opacity: 0.7 }}>✦ thinking...</span>
            </div>
          </div>
        )}

        {error && (
          <div style={{ ...mono, fontSize: 12, color: C.red, padding: "8px 12px", background: "#1a0000", border: `1px solid ${C.red}44`, borderRadius: 6 }}>
            Error: {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${C.brd}`, paddingTop: 12, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about pricing, objections, slides, emails…"
          rows={2}
          style={{ flex: 1, background: "#111", border: `1px solid ${C.brd}`, borderRadius: 8, ...mono, fontSize: 13, color: C.txt, padding: "9px 12px", resize: "none", lineHeight: 1.5, outline: "none", boxSizing: "border-box" }}
        />
        <button
          onClick={() => sendMessage(inputVal)}
          disabled={!inputVal.trim() || loading}
          style={{
            background: inputVal.trim() && !loading ? C.gold : C.goldBg,
            border: `1px solid ${inputVal.trim() && !loading ? C.gold : C.goldBdr}`,
            borderRadius: 8,
            ...mono,
            fontSize: 12,
            fontWeight: 700,
            color: inputVal.trim() && !loading ? "#000" : C.dim,
            cursor: inputVal.trim() && !loading ? "pointer" : "default",
            padding: "10px 16px",
            whiteSpace: "nowrap",
          }}>
          Send →
        </button>
      </div>
    </div>
  );
}
