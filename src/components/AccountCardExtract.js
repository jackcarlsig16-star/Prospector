import { useState } from 'react';
import { C, mono } from '../constants/colors';
import { buildIntelExport } from '../utils/dealIntel';

// extract-panel-redesign-v1 — was an inline panel that mounted ~719px below
// its own trigger button (outside AccountCard's expanded block), so clicking
// Extract changed nothing in the viewport and read as a dead button. It's a
// modal now, which sidesteps the mount-placement problem entirely rather than
// fixing it in place.
//
// Removed per Jack, 2026-08-21: AM Handoff, Compliance (Chatter Msg, Client
// ID, Nudge PR, Nudge Sec Q), Requests (SE, Credit), Copy SFDC Update, and
// PR Email. The two Nudge actions genuinely sent email rather than copying -
// they are gone from this surface entirely, flagged at the time as the part
// most likely to be missed.
//
// Copy Intel became three targeted copy-types instead of one blob. "Full
// Intel" is the previous Copy Intel behaviour (buildIntelExport) kept intact
// so nothing that worked before is lost.

const PREP_SECTIONS = [
  { key: "objective",  label: "Objective"           },
  { key: "agenda",     label: "Agenda"              },
  { key: "covered",    label: "What's Been Covered" },
  { key: "questions",  label: "Questions to Cover"  },
  { key: "leaveWith",  label: "Leave With"          },
  { key: "attendees",  label: "Attendees"           },
];

function SectionLabel({ children }) {
  return (
    <p style={{ ...mono, fontSize: 10, fontWeight: 600, color: C.mut, textTransform: "uppercase", letterSpacing: "0.08em", margin: "14px 0 6px" }}>
      {children}
    </p>
  );
}

function CopyBtn({ id, copied, onCopy, label, sublabel, accent, disabled }) {
  const isCopied = copied === id;
  return (
    <button
      onClick={onCopy}
      disabled={!!disabled}
      title={disabled ? String(disabled) : undefined}
      style={{
        ...mono, fontSize: 11, textAlign: "left", width: "100%",
        padding: "9px 12px",
        background: isCopied ? `${accent}18` : "transparent",
        border: `1px solid ${isCopied ? accent : C.brd}`,
        color: disabled ? C.dim : isCopied ? accent : C.txt,
        borderRadius: 5, cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1, transition: "all 0.15s",
      }}
    >
      <span style={{ fontWeight: 600 }}>{isCopied ? "✓ Copied" : label}</span>
      {sublabel && <span style={{ display: "block", fontSize: 9, color: C.dim, marginTop: 3 }}>{sublabel}</span>}
    </button>
  );
}

// Composes the fit narrative from account_business_details (the real source
// this card's Intelligence panel reads), falling back to the legacy flat
// fields for accounts not re-assayed since account-business-details-v1.
function buildCompanyContext(acc) {
  const d = acc.businessDetail || {};
  const fs = d.fit_signals || {};
  const L = [];
  L.push(`COMPANY CONTEXT — ${acc.name}`);
  if (acc.web) L.push(`Website: ${acc.web}`);
  if (acc.vert) L.push(`Vertical: ${acc.vert}`);
  if (d.tier || d.score != null) L.push(`Fit: ${d.tier || "—"}${d.score != null ? ` (score ${d.score})` : ""}${fs.confidence ? ` · confidence ${fs.confidence}` : ""}`);
  L.push("");
  const bm = d.business_model || acc.bm;
  const pf = d.fit_rationale || acc.pf;
  if (bm) { L.push("BUSINESS MODEL"); L.push(bm); L.push(""); }
  if (pf) { L.push("PRODUCT FIT"); L.push(pf); L.push(""); }
  if (d.disqualifier) { L.push("DISQUALIFIER"); L.push(d.disqualifier); L.push(""); }
  const sb = fs.signal_breakdown || {};
  const group = (label, arr) => { if (arr?.length) { L.push(label); arr.forEach(s => L.push(`- ${s}`)); L.push(""); } };
  group("DISQUALIFYING SIGNALS", sb.slagSignals);
  group("SCALE SIGNALS", sb.scaleSignals);
  group("FIT SIGNALS", sb.fitSignals);
  group("ADOPTION SIGNALS", sb.adoptionSignals);
  group("KEY SIGNALS", fs.key_signals);
  group("TRACTION SIGNALS", fs.traction_signals);
  if (fs.products?.length) group("PRODUCTS", fs.products);
  return L.join("\n").trim();
}

// Jack's call, 2026-08-21: this button only renders when there is real
// relationship data. Measured at decision time, 1 of 62 HomeLover accounts
// had any calls/emails/personas and none had handoff notes - an
// always-visible button would have produced an empty document almost every
// time and read as broken.
function relationshipParts(acc) {
  const calls = acc.calls || [];
  const emails = acc.emails || [];
  const personas = acc.personas || [];
  const medpicc = acc.medpicc && Object.values(acc.medpicc).some(v => (v || "").trim());
  return { calls, emails, personas, medpicc, has: !!(calls.length || emails.length || personas.length || acc.handoffNotes || medpicc) };
}

function buildRelationshipContext(acc) {
  const { calls, emails, personas, medpicc } = relationshipParts(acc);
  const L = [];
  L.push(`RELATIONSHIP CONTEXT — ${acc.name}`);
  L.push(`Stage: ${acc.stage || "Prospecting"}${acc.relationshipType ? ` · ${acc.relationshipType}` : ""}`);
  if (acc.lastTouchedAt) L.push(`Last touched: ${acc.lastTouchedAt}${acc.lastTouchedBy ? ` by ${acc.lastTouchedBy}` : ""}`);
  L.push("");
  if (personas.length) {
    L.push("CONTACTS");
    personas.forEach(p => L.push(`- ${p.name || "?"}${p.title ? `, ${p.title}` : ""}${p.email ? ` <${p.email}>` : ""}${p.angle ? ` — ${p.angle}` : ""}`));
    L.push("");
  }
  if (calls.length) {
    L.push("CALL HISTORY");
    calls.slice(-5).forEach((c, i) => {
      L.push(`Call ${i + 1} (${c.date || "unknown date"}): ${c.summary || "no summary"}`);
      const ns = (c.nextSteps || []).map(s => typeof s === "string" ? s : s?.text).filter(Boolean);
      if (ns.length) L.push(`  Next steps: ${ns.join("; ")}`);
    });
    L.push("");
  }
  if (emails.length) {
    L.push("RECENT EMAILS");
    emails.slice(0, 5).forEach(e => L.push(`- ${e.date || ""} ${e.subject ? `"${e.subject}"` : ""}`.trim()));
    L.push("");
  }
  if (medpicc) {
    L.push("MEDPICC");
    Object.entries(acc.medpicc).forEach(([k, v]) => { if ((v || "").trim()) L.push(`${k}: ${v}`); });
    L.push("");
  }
  if (acc.handoffNotes) { L.push("HANDOFF NOTES"); L.push(acc.handoffNotes); }
  return L.join("\n").trim();
}

export default function AccountCardExtract({ acc, activeUser, onClose }) {
  const [copied, setCopied] = useState(null);
  const [extractError, setExtractError] = useState(null);
  const flashError = (msg) => { setExtractError(msg); setTimeout(() => setExtractError(null), 5000); };

  const copy = (key, text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => flashError("Copy failed — clipboard permission blocked?"));
  };

  const rel = relationshipParts(acc);
  const hasBrief = !!(() => { try { return localStorage.getItem(`prospector_meeting_prep_${acc.id}`) || acc.meetingPrepData; } catch { return null; } })();

  const copyBrief = () => {
    const stored = (() => { try { const s = localStorage.getItem(`prospector_meeting_prep_${acc.id}`); return s ? JSON.parse(s) : acc.meetingPrepData || null; } catch { return null; } })();
    if (!stored) { flashError("No pre-call brief generated for this account yet."); return; }
    const lines = PREP_SECTIONS.filter(s => stored[s.key]).map(s => `${s.label.toUpperCase()}\n${stored[s.key]}`);
    if (!lines.length) { flashError("Pre-call brief is empty."); return; }
    copy("brief", `★ Pre-Call Brief — ${acc.name}\n\n${lines.join("\n\n")}`);
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#00000099", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: 460, maxHeight: "85vh", overflowY: "auto", background: C.card, border: `1px solid ${C.brd}`, borderRadius: 10, padding: "18px 20px", boxShadow: "0 20px 60px #000c" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ ...mono, fontSize: 12, fontWeight: 700, color: C.green, textTransform: "uppercase", letterSpacing: "0.08em" }}>⬡ Extract — {acc.name}</span>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "transparent", border: "none", color: C.dim, fontSize: 16, cursor: "pointer", padding: 0 }}>✕</button>
        </div>
        <p style={{ ...mono, fontSize: 10, color: C.dim, margin: 0 }}>Copy context for this account into a chat, email, or doc.</p>

        {extractError && (
          <div style={{ ...mono, fontSize: 10, color: C.red, background: `${C.red}12`, border: `1px solid ${C.red}44`, borderRadius: 4, padding: "6px 9px", marginTop: 10 }}>
            ⚠ {extractError}
          </div>
        )}

        <SectionLabel>Intel</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <CopyBtn id="company" copied={copied} accent={C.gold}
            onCopy={() => copy("company", buildCompanyContext(acc))}
            label="⎘ Company Context"
            sublabel="Business model, product fit, disqualifier, signals" />
          {rel.has && (
            <CopyBtn id="relationship" copied={copied} accent={C.blue}
              onCopy={() => copy("relationship", buildRelationshipContext(acc))}
              label="⎘ Relationship Context"
              sublabel="Contacts, call history, emails, MEDPICC, handoff notes" />
          )}
          <CopyBtn id="full" copied={copied} accent={C.purple}
            onCopy={() => copy("full", buildIntelExport(acc, activeUser))}
            label="⎘ Full Intel"
            sublabel="Everything above plus scoring, tasks and deal signals" />
        </div>

        <SectionLabel>Outreach</SectionLabel>
        <CopyBtn id="brief" copied={copied} accent={C.green}
          onCopy={copyBrief}
          label="⎘ Pre-Call Brief"
          sublabel={hasBrief ? "Objective, agenda, questions, leave-with" : undefined}
          disabled={!hasBrief && "Generate a Pre-Call Brief first (☎ Call Prep)"} />
      </div>
    </div>
  );
}
