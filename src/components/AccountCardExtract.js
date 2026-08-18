import { useState } from 'react';
import { C, mono } from '../constants/colors';
import { buildIntelExport } from '../utils/dealIntel';
import RequestModal from './RequestModal';
import { MODELS } from '../config/models';
import { fetchSentEmailsForAccount, buildNsPrompt } from '../utils/nsCopy';

const PREP_SECTIONS = [
  { key: "objective",  label: "Objective"           },
  { key: "agenda",     label: "Agenda"              },
  { key: "covered",    label: "What's Been Covered" },
  { key: "questions",  label: "Questions to Cover"  },
  { key: "leaveWith",  label: "Leave With"          },
  { key: "attendees",  label: "Attendees"           },
];

const PR_EMAIL_KEY       = "prospector_pr_email_template";
const DEFAULT_PR_TEMPLATE = `Subject: Next Step: Submit Your Production Request\n\nHi [First Name],\n\nThanks for creating your dashboard account — you're one step closer to going live!\n\nThe next step is to submit your Production Request, which kicks off the due diligence review. This is a straightforward process, but I'm happy to walk you through it if it would be helpful.\n\nJust reply to this email and we can find a time, or I can send over a quick guide.`;

function getTemplate() { return localStorage.getItem(PR_EMAIL_KEY) || DEFAULT_PR_TEMPLATE; }

function buildChatterText(acc) {
  const prods = [...new Set((acc?.calls || []).flatMap(c =>
    (c.productsDiscussed || []).map(p => typeof p === "string" ? p : p?.product)
  ).filter(Boolean))].join(", ") || "N/A";
  return [
    `🚀 PR Review — ${acc?.name || ""}`,
    `SFDC: ${acc?.sfdc || "N/A"}`,
    `Website: ${acc?.web || "N/A"}`,
    `Products: ${prods}`,
    `Use Case: ${(acc?.ucs || []).join(", ") || "N/A"}`,
    `Business Model: ${acc?.bm || "N/A"}`,
    `Timing: ${acc?.medpicc?.timeline || "N/A"}`,
  ].join("\n");
}

async function fetchSfdcUpdate(acc, tasks, activeUser) {
  const now         = new Date();
  const todayFmt    = `${now.getMonth() + 1}/${now.getDate()}`;
  const todayISO    = now.toISOString().split('T')[0];
  const twoWeeksOut = (()=>{ const d=new Date(now); d.setDate(d.getDate()+14); return `${d.getMonth()+1}/${d.getDate()}`; })();
  const sentEmails  = await fetchSentEmailsForAccount(acc.name);
  const { prompt }  = buildNsPrompt({ acc, tasks, activeUser, sentEmails, todayFmt, todayISO, twoWeeksOut });
  const r = await fetch("/proxy/anthropic/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: MODELS.STANDARD, max_tokens: 280, messages: [{ role: "user", content: prompt }] }) });
  const d = await r.json();
  return d.content?.[0]?.text?.trim() || "";
}

async function sendNudgeEmail(acc, stepLabel) {
  const contactFirst = (acc?.personas || [])[0]?.name?.split(" ")[0] || "";
  const subject      = `Re: ${acc.name} — ${stepLabel} Update`;
  const body         = `Hi${contactFirst ? ` ${contactFirst}` : ""},\n\nJust checking in on the status of your ${stepLabel} — happy to help if there are any blockers on your end. Let me know!\n\nBest,\n[Your Name]`;
  const token        = localStorage.getItem("gmail_access_token");
  if (token) {
    try {
      const raw = btoa(unescape(encodeURIComponent(
        `Subject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
      ))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { raw } }),
      });
      if (r.ok) return { sent: true };
    } catch {}
  }
  navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).catch(() => {});
  return { sent: false };
}

function SectionLabel({ children }) {
  return (
    <div style={{ ...mono, fontSize: 9, color: C.mut, textTransform: "uppercase", letterSpacing: "0.09em", fontWeight: 600, marginBottom: 6, marginTop: 12 }}>
      {children}
    </div>
  );
}

function ExtractBtn({ id, copied, onCopy, label, loading, disabled, accent = C.blue }) {
  const active = copied === id;
  return (
    <button
      onClick={() => !loading && !disabled && onCopy(id)}
      disabled={!!loading || !!disabled}
      style={{
        ...mono, fontSize: 10, height: 26, padding: "0 10px",
        background: active ? `${accent}18` : "transparent",
        border: `1px solid ${active ? accent + "55" : C.brd}`,
        color: active ? accent : disabled ? C.dim + "55" : C.dim,
        borderRadius: 4, cursor: loading || disabled ? "default" : "pointer",
        whiteSpace: "nowrap", opacity: loading ? 0.6 : 1,
        transition: "all 0.15s",
      }}
    >
      {active ? "✓ Copied" : loading === id ? "…" : label}
    </button>
  );
}

export default function AccountCardExtract({ acc, tasks = [], activeUser, onClose }) {
  const [copied,  setCopied]  = useState(null);
  const [loading, setLoading] = useState(null);
  const [nudged,  setNudged]  = useState(null);
  const [requestModal, setRequestModal] = useState(null);
  // account-card-cleanup-v1 Stage 3 - the real bug here was silent error
  // swallowing (console.error only, no visible state) on the LLM-backed
  // handlers below, not the panel toggle itself (that already worked).
  const [extractError, setExtractError] = useState(null);
  const flashError = (msg) => { setExtractError(msg); setTimeout(() => setExtractError(null), 5000); };

  // AM Handoff state
  const [amName,       setAmName]       = useState('');
  const [planType,     setPlanType]     = useState('custom');
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [loadingSlack, setLoadingSlack] = useState(false);
  const [emailCopied,  setEmailCopied]  = useState(false);
  const [slackCopied,  setSlackCopied]  = useState(false);

  const allCompliance = (() => { try { return JSON.parse(localStorage.getItem('prospector_compliance') || '{}'); } catch { return {}; } })();
  const compliance    = allCompliance[acc.id] || {};
  const prStatus      = compliance?.steps?.find?.(s => s.id === 'prod_request')?.status || 'Not Started';
  const sqStatus      = compliance?.steps?.find?.(s => s.id === 'security_q')?.status   || 'Not Started';

  const copy = (key, text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => flashError("Copy failed — clipboard permission blocked?"));
  };

  const handlers = {
    intel: () => copy("intel", buildIntelExport(acc)),

    sfdc: async () => {
      setLoading("sfdc");
      try {
        const text = await fetchSfdcUpdate(acc, tasks, activeUser);
        if (text) copy("sfdc", text);
        else flashError("SFDC update came back empty — try again.");
      } catch (e) { console.error("[Extract] SFDC error:", e); flashError(`SFDC update failed: ${e.message}`); }
      setLoading(null);
    },

    brief: () => {
      const stored = (() => { try { const s = localStorage.getItem(`prospector_meeting_prep_${acc.id}`); return s ? JSON.parse(s) : acc.meetingPrepData || null; } catch { return null; } })();
      if (!stored) { copy("brief", "(none)"); return; }
      const lines = PREP_SECTIONS.filter(s => stored[s.key]).map(s => `${s.label.toUpperCase()}\n${stored[s.key]}`);
      if (!lines.length) return;
      copy("brief", `★ Pre-Call Brief — ${acc.name}\n\n${lines.join("\n\n")}`);
    },

    chatter: () => copy("chatter", buildChatterText(acc)),

    clientId: () => {
      const id = (acc.clientIds || [])[0];
      if (id) copy("clientId", id);
    },

    nudgePr: async () => {
      setLoading("nudgePr");
      const res = await sendNudgeEmail(acc, "Production Request");
      setLoading(null);
      if (res.sent) { setNudged("nudgePr"); setTimeout(() => setNudged(null), 2000); }
      else { setCopied("nudgePr"); setTimeout(() => setCopied(null), 2000); }
    },

    nudgeSecQ: async () => {
      setLoading("nudgeSecQ");
      const res = await sendNudgeEmail(acc, "Security Questionnaire");
      setLoading(null);
      if (res.sent) { setNudged("nudgeSecQ"); setTimeout(() => setNudged(null), 2000); }
      else { setCopied("nudgeSecQ"); setTimeout(() => setCopied(null), 2000); }
    },
  };

  // AM Handoff — Customer Email
  // Remember: CC ${amName}, BCC your growth/AM distribution list
  const handleCustomerEmail = async () => {
    setLoadingEmail(true);
    const launchDate = acc.dealTimeline?.predictions?.days_to_signature
      ? (() => { const d = new Date(); d.setDate(d.getDate() + acc.dealTimeline.predictions.days_to_signature); return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); })()
      : '{{Launch Date}}';
    const champion  = acc.medpicc?.champion || '';
    const firstName = champion.split(' ')[0] || 'there';
    const context = `Account: ${acc.name}
Champion / Primary Contact: ${champion || 'unknown'}
Plan type: ${planType} (${planType === 'growth' ? 'standardized self-serve, click-through MSA, dashboard-driven' : 'negotiated contract, DocuSign/Ironclad, custom pricing'})
Products purchased: ${acc.prods?.join(', ') || 'unknown'}
Launch date: ${launchDate}
AM Name: ${amName}
Compliance state:
  Production Request: ${prStatus}
  Security Q: ${sqStatus}
Use case: ${acc.medpicc?.identify_pain || 'unknown'}
ACV: ${acc.acvOverride ? '$' + acc.acvOverride.toLocaleString() : 'unknown'}`;

    const prompt = `${context}

Generate a personalized AE → Customer intro/handoff email using this template as the base:

---
Hi {{first_name}},

Excited to get you to the finish line! A few things need to happen before {{Launch Date}} and I want to make sure nothing slips.

1. Compliance Center (Do this First!) - {{Compliance Center URL}}
   This is required to unlock full access to our network.
2. Privacy Policy (Required)
   Per Section 1.4 of the MSA (attached), you'll need to update your privacy policy to disclose our data usage and obtain end-user consent.
3. Technical support
   For technical or integration questions, submit a support ticket through our dashboard for fastest resolution.
4. Billing & production access
   Billing starts on {{Launch Date}} per your agreement. Production access turns on automatically that day. If you're ready early, we can enable it up to 30 days ahead.

Lastly, I'd like to introduce you to {{AM Name}}, cc'd here. They will be your main point of contact from here on out. {{AM Name}} will be reaching out shortly to schedule a kickoff call and ensure you have everything you need to hit {{Launch Date}}.

Looking forward to seeing you live.
Best,
${activeUser?.name || '{{Your Name}}'}
---

Rules:
- Replace {{first_name}} with ${firstName}
- Replace {{Launch Date}} with ${launchDate}
- Replace {{AM Name}} with ${amName}
- Replace {{Compliance Center URL}} with your compliance center URL
- Personalize the opening line to reference their specific use case (${acc.medpicc?.identify_pain || acc.prods?.[0] || 'our integration'})
- If compliance items are already done (status Submitted or Approved), skip or shorten those steps
- ${planType === 'growth' ? 'This is a Growth plan — standard self-serve, no custom contract to reference' : 'This is a Custom plan — reference the MSA and Order Form as attached documents'}
- Keep the structure but make it feel personal, not templated
- Output the email only, no preamble`;

    try {
      const res = await fetch('/proxy/anthropic/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODELS.STANDARD, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
      });
      const data = await res.json();
      const text = data.content?.[0]?.text?.trim() || '';
      if (text) { await navigator.clipboard.writeText(text); setEmailCopied(true); setTimeout(() => setEmailCopied(false), 2000); }
      else flashError("Customer email came back empty — try again.");
    } catch (e) { console.error('[Extract] Customer email error:', e); flashError(`Customer email failed: ${e.message}`); }
    setLoadingEmail(false);
  };

  // AM Handoff — Slack Brief
  // Remember: CC ${amName}, BCC your growth/AM distribution list
  const handleSlackBrief = async () => {
    setLoadingSlack(true);
    const context = `Account: ${acc.name}
Website: ${acc.web || 'not captured'}
ACV: ${acc.acvOverride ? '$' + acc.acvOverride.toLocaleString() : 'not captured'}
Plan type: ${planType}
Products: ${acc.prods?.join(', ') || 'not captured'}
Use case / pain: ${acc.medpicc?.identify_pain || 'not captured'}
Champion: ${acc.medpicc?.champion || 'not captured'}
Economic Buyer: ${acc.medpicc?.economic_buyer || 'not captured'}
Decision Process: ${acc.medpicc?.decision_process || 'not captured'}
Decision Criteria: ${acc.medpicc?.decision_criteria || 'not captured'}
Competition: ${acc.medpicc?.competition || 'none mentioned'}
Metrics / success criteria: ${acc.medpicc?.metrics || 'not captured'}
Tier: ${acc.tier || 'unscored'}
Stage: ${acc.stage || 'unknown'}
Compliance:
  Production Request: ${prStatus}
  Security Q: ${sqStatus}
Recent call context: ${acc.calls?.slice(0, 2).map(c => c.summary?.slice(0, 200)).filter(Boolean).join(' | ') || 'none'}
Next steps from last call: ${(acc.calls?.[0]?.nextSteps || []).map(ns => typeof ns === 'string' ? ns : ns?.text || '').filter(Boolean).join('; ') || 'none'}
AM Name: ${amName}
Salesforce: ${acc.sfdc || 'not linked'}`;

    const sfdcUrl = acc.sfdc
      ? (/^006/.test(acc.sfdc) ? `https://your-org.lightning.force.com/lightning/r/Opportunity/${acc.sfdc}/view` : acc.sfdc)
      : 'not linked';

    const prompt = `${context}

Generate an internal AE → AM Slack handoff brief. Be specific and concise — this is for an Account Manager taking over the relationship.

Format exactly as:

🚨 *AE → AM HANDOFF: ${acc.name}*

*ACV:* $X | *Plan:* ${planType === 'growth' ? 'Growth (self-serve)' : 'Custom (negotiated)'} | *Risk:* Low/Medium/High

*👥 Key Stakeholders*
• Champion: [name, title, support level 1-5, communication style]
• Economic Buyer: [name/title or not captured]
• Technical Lead: [if known]

*🎯 Why They Bought*
• Use case: [specific, not generic]
• Business urgency: [why now]
• Success metric: [what does win look like for them]

*⚠️ Risks / Watchouts*
• [2-3 specific risks based on context — compliance gaps, competition, engineering bandwidth, etc]

*🛠 Implementation Notes*
• Products: [list]
• Compliance: PR ${prStatus} | Security Q ${sqStatus}
• Integration complexity: [low/medium/high + one line why]

*💰 Commercial*
• ACV: [amount] | ${planType === 'growth' ? 'Growth plan — standard terms' : 'Custom contract — negotiated terms'}
• Expansion signals: [any future use cases mentioned]

*📞 Recommended AM Motion*
• [2-3 specific recommendations based on deal context]

*📂 Links*
• SFDC: ${sfdcUrl}

Rules:
- Be specific, not generic
- Infer risk level from compliance state, competition, and call context
- If data is unknown, say "not captured" not "unknown"
- Output the brief only, no preamble`;

    try {
      const res = await fetch('/proxy/anthropic/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODELS.STANDARD, max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
      });
      const data = await res.json();
      const text = data.content?.[0]?.text?.trim() || '';
      if (text) { await navigator.clipboard.writeText(text); setSlackCopied(true); setTimeout(() => setSlackCopied(false), 2000); }
      else flashError("Slack brief came back empty — try again.");
    } catch (e) { console.error('[Extract] Slack brief error:', e); flashError(`Slack brief failed: ${e.message}`); }
    setLoadingSlack(false);
  };

  const hasBrief   = !!(() => { try { return localStorage.getItem(`prospector_meeting_prep_${acc.id}`) || acc.meetingPrepData; } catch { return null; } })();
  const clientId   = (acc.clientIds || [])[0];
  const prTemplate = getTemplate().replace(/\[First Name\]/g, (acc?.personas || [])[0]?.name?.split(" ")[0] || "[First Name]");

  return (
    <div style={{ marginBottom: 12, background: `${C.green}06`, border: `1px solid ${C.green}22`, borderRadius: 7, padding: "12px 14px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ ...mono, fontSize: 11, fontWeight: 600, color: C.green, textTransform: "uppercase", letterSpacing: "0.08em" }}>⬡ Extract — {acc.name}</span>
        <button onClick={onClose} style={{ marginLeft: "auto", background: "transparent", border: "none", color: C.dim, fontSize: 14, cursor: "pointer", padding: 0 }}>✕</button>
      </div>

      {extractError && (
        <div style={{ ...mono, fontSize: 10, color: C.red, background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 4, padding: "5px 9px", marginBottom: 8 }}>
          ⚠ {extractError}
        </div>
      )}

      {/* Two-column layout */}
      <div style={{ display: "flex", gap: 0, alignItems: "flex-start" }}>

        {/* ── Left column: existing sections ── */}
        <div style={{ flex: 1, minWidth: 0, paddingRight: 14 }}>

          {/* INTEL */}
          <SectionLabel>Intel</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <ExtractBtn id="intel" copied={copied} onCopy={handlers.intel} label="⎘ Copy Intel"       accent={C.gold}  loading={loading} />
            <ExtractBtn id="sfdc"  copied={copied} onCopy={handlers.sfdc}  label="⎘ Copy SFDC Update" accent={C.green} loading={loading} />
          </div>

          {/* OUTREACH */}
          <SectionLabel>Outreach</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <ExtractBtn id="brief" copied={copied} onCopy={handlers.brief} label="⎘ Pre-Call Brief" accent={C.purple} loading={loading} disabled={!hasBrief && "brief"} />
            <button
              onClick={() => copy("prEmail", prTemplate)}
              style={{ ...mono, fontSize: 10, height: 26, padding: "0 10px", background: copied === "prEmail" ? `${C.orange}18` : "transparent", border: `1px solid ${copied === "prEmail" ? C.orange + "55" : C.brd}`, color: copied === "prEmail" ? C.orange : C.dim, borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap", transition: "all 0.15s" }}>
              {copied === "prEmail" ? "✓ Copied" : "⎘ PR Email"}
            </button>
          </div>
          {!hasBrief && (
            <div style={{ ...mono, fontSize: 9, color: C.dim, marginTop: 4, fontStyle: "italic" }}>Generate Pre-Call Brief first (★ Pre-Call button)</div>
          )}

          {/* COMPLIANCE */}
          <SectionLabel>Compliance</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <ExtractBtn id="chatter"  copied={copied} onCopy={handlers.chatter}  label="⎘ Chatter Msg" accent={C.blue} loading={loading} />
            <ExtractBtn id="clientId" copied={copied} onCopy={handlers.clientId} label="⎘ Client ID"    accent={C.blue} loading={loading} disabled={!clientId && "clientId"} />
            <button
              onClick={handlers.nudgePr}
              disabled={!!loading}
              style={{ ...mono, fontSize: 10, height: 26, padding: "0 10px", background: nudged === "nudgePr" ? `${C.green}18` : copied === "nudgePr" ? `${C.orange}18` : "transparent", border: `1px solid ${nudged === "nudgePr" ? C.green + "55" : copied === "nudgePr" ? C.orange + "55" : C.brd}`, color: nudged === "nudgePr" ? C.green : copied === "nudgePr" ? C.orange : C.dim, borderRadius: 4, cursor: loading ? "default" : "pointer", whiteSpace: "nowrap", transition: "all 0.15s", opacity: loading === "nudgePr" ? 0.6 : 1 }}>
              {nudged === "nudgePr" ? "✓ Sent" : copied === "nudgePr" ? "⚠ Not sent — copied" : loading === "nudgePr" ? "…" : "📧 Nudge PR"}
            </button>
            <button
              onClick={handlers.nudgeSecQ}
              disabled={!!loading}
              style={{ ...mono, fontSize: 10, height: 26, padding: "0 10px", background: nudged === "nudgeSecQ" ? `${C.green}18` : copied === "nudgeSecQ" ? `${C.orange}18` : "transparent", border: `1px solid ${nudged === "nudgeSecQ" ? C.green + "55" : copied === "nudgeSecQ" ? C.orange + "55" : C.brd}`, color: nudged === "nudgeSecQ" ? C.green : copied === "nudgeSecQ" ? C.orange : C.dim, borderRadius: 4, cursor: loading ? "default" : "pointer", whiteSpace: "nowrap", transition: "all 0.15s", opacity: loading === "nudgeSecQ" ? 0.6 : 1 }}>
              {nudged === "nudgeSecQ" ? "✓ Sent" : copied === "nudgeSecQ" ? "⚠ Not sent — copied" : loading === "nudgeSecQ" ? "…" : "📧 Nudge Sec Q"}
            </button>
          </div>
          {!clientId && (
            <div style={{ ...mono, fontSize: 9, color: C.dim, marginTop: 4, fontStyle: "italic" }}>No client ID on file</div>
          )}

          {/* REQUESTS */}
          <SectionLabel>Requests</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button onClick={() => setRequestModal({ type: "se",     account: acc })}
              style={{ ...mono, fontSize: 10, height: 26, padding: "0 10px", background: `${C.blue}12`,   border: `1px solid ${C.blue}44`,   color: C.blue,   borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap" }}>
              ⚙ SE Request
            </button>
            <button onClick={() => setRequestModal({ type: "credit", account: acc })}
              style={{ ...mono, fontSize: 10, height: 26, padding: "0 10px", background: `${C.purple}12`, border: `1px solid ${C.purple}44`, color: C.purple, borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap" }}>
              💳 Credit Request
            </button>
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, background: '#1e293b', opacity: 0.6, alignSelf: 'stretch', margin: '4px 0', flexShrink: 0 }} />

        {/* ── Right column: AM Handoff ── */}
        <div style={{ flex: 1, minWidth: 0, paddingLeft: 14, background: '#0d1117', borderRadius: 6, padding: '10px 14px' }}>
          <SectionLabel>AM Handoff</SectionLabel>

          {/* AM Name input */}
          <input
            type="text"
            placeholder="AM Name"
            value={amName}
            onChange={e => setAmName(e.target.value)}
            style={{ ...mono, fontSize: 11, width: '100%', boxSizing: 'border-box', background: '#0f172a', border: '1px solid #475569', borderRadius: 4, color: '#e2e8f0', padding: '4px 8px', outline: 'none', marginBottom: 8 }}
          />

          {/* Plan type toggle */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {[['custom', 'Custom'], ['growth', 'Growth']].map(([key, label]) => (
              <button key={key} onClick={() => setPlanType(key)}
                style={{ ...mono, fontSize: 10, flex: 1, height: 26, padding: '0 8px', borderRadius: 4, cursor: 'pointer', transition: 'all 0.15s',
                  background: planType === key ? '#2dd4bf30' : '#1e293b',
                  border: `1px solid ${planType === key ? '#2dd4bf' : '#475569'}`,
                  color: planType === key ? '#2dd4bf' : '#94a3b8',
                  fontWeight: planType === key ? 600 : 400,
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* Generate buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              onClick={handleCustomerEmail}
              disabled={!amName.trim() || loadingEmail}
              style={{ ...mono, fontSize: 10, height: 28, padding: '0 10px', borderRadius: 4, cursor: !amName.trim() || loadingEmail ? 'default' : 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
                background: emailCopied ? `${C.gold}18` : '#1e293b',
                border: `1px solid ${emailCopied ? C.gold + '55' : '#475569'}`,
                color: emailCopied ? C.gold : !amName.trim() ? '#475569' : '#e2e8f0',
                opacity: loadingEmail ? 0.6 : 1,
              }}>
              {loadingEmail ? '⟳ Generating…' : emailCopied ? '✓ Copied!' : '✉ Customer Email'}
            </button>
            <button
              onClick={handleSlackBrief}
              disabled={!amName.trim() || loadingSlack}
              style={{ ...mono, fontSize: 10, height: 28, padding: '0 10px', borderRadius: 4, cursor: !amName.trim() || loadingSlack ? 'default' : 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
                background: slackCopied ? '#2dd4bf18' : '#1e293b',
                border: `1px solid ${slackCopied ? '#2dd4bf' : '#475569'}`,
                color: slackCopied ? '#2dd4bf' : !amName.trim() ? '#475569' : '#e2e8f0',
                opacity: loadingSlack ? 0.6 : 1,
              }}>
              {loadingSlack ? '⟳ Generating…' : slackCopied ? '✓ Copied!' : '💬 AM Slack Brief'}
            </button>
          </div>

          {!amName.trim() && (
            <div style={{ ...mono, fontSize: 9, color: '#94a3b8', marginTop: 6, fontStyle: 'italic' }}>Enter AM name to enable</div>
          )}

          {/* BCC reminder */}
          {amName.trim() && (
            <div style={{ ...mono, fontSize: 9, color: '#94a3b8', marginTop: 8, lineHeight: 1.5 }}>
              Remember: CC {amName}<br />BCC your growth/AM distribution list
            </div>
          )}
        </div>
      </div>

      <RequestModal
        type={requestModal?.type}
        account={requestModal?.account}
        isOpen={!!requestModal}
        onClose={() => setRequestModal(null)}
      />
    </div>
  );
}
