import React, { useState } from 'react';
import { C, mono } from '../constants/colors';
import { T } from '../constants/tokens';
import { MODELS } from '../config/models';
import { clientDebrief } from '../utils/dealIntel';
import { extractIntelligenceFromCall } from '../utils/intelligenceEngine';
import { FILES_KEY } from '../utils/storageKeys';

const PRODUCT_DOCS = {
  "Core Verify":      { label: "Core Verify",      url: "https://docs.example.com/core-verify/",      desc: "Instantly retrieve bank verified account and routing numbers" },
  "Core Verify Plus": { label: "Core Verify Plus", url: "https://docs.example.com/core-verify-plus/", desc: "Confirm account ownership through name, email, phone number, and physical address" },
  "Balance Insights": { label: "Balance Insights", url: "https://docs.example.com/balance-insights/", desc: "Real time available and current bank account balances" },
};

const PRODUCT_CATEGORIES = [
  { label: "Account Authentication", products: ["Core Verify", "Core Verify Plus"] },
  { label: "Financial Management",   products: ["Balance Insights"] },
];

const BILLING_FIELDS = [
  { key: "billToName",    label: "Bill To Name" },
  { key: "billToStreet",  label: "Bill To Street" },
  { key: "billToCity",    label: "Bill To City" },
  { key: "billToState",   label: "Bill To State" },
  { key: "billToPostal",  label: "Bill To Postal Code" },
  { key: "billToCountry", label: "Bill To Country" },
];

const SYSTEM_PROMPT = `You are writing a follow-up email for {AE_NAME}, an Account Executive.

Here is an example of {AE_FIRST}'s actual writing style. Match this exactly — same sentence length, same level of warmth, same bullet format, same sign-off:

---
Hi Sam,

Thanks again for taking the time yesterday.

I'm excited to work with a founder in the legal space who's focused on innovating within estate planning. Meridian Estates feels incredibly valuable, and I really like your GTM approach.

Recap:
- Building a platform for estate planners to consolidate and manage estate-related financial accounts.
- We can support account connectivity, verification, balances, transactions, identity, and fraud checks.
- For money movement, we support the verification/data layer, with partners handling transfers and payments.

Next Steps:
- I'll share three potential money movement partners aligned to your use case.
- Align on priority solutions for beta.

Happy to discuss more next week!

Thanks,
{AE_FIRST}
---

Notice: short sentences, no corporate language, no phrases like "high-value use case" or "massive edge", genuine personal excitement about the specific business, bullets are crisp and specific not padded.

EMAIL STRUCTURE — follow this exactly:

1. SHORT OPENER
- "Hi {first_name},"
- Thank them for the time
- One sentence of genuine excitement about their specific business/use case (not generic)

2. RECAP (3-6 bullets)
- Their business model in one line
- What they're building
- How we fit (data/connectivity layer — if money movement came up, clarify we support the verification/data layer, partners handle transfers)
- Any compliance, legal, or security topics discussed — frame carefully, no definitive legal conclusions
- If early-stage: acknowledge flexibility and phased implementation

3. COMPLIANCE REVIEW INSTRUCTIONS
Always include this section verbatim when stage is Active Deal or products were discussed:

---
**Compliance Review Instructions**

Please take 5 mins to follow the below instructions to complete the compliance review. Note that this will not contractually commit you to anything and does not initiate billing; this is just a necessary part of the process so my risk team can approve your use case.

1. Sign up for an account: {{Signup URL}}
2. Go to your Dashboard and select "Complete your Risk Diligence Questionnaire"
3. On the Product Select page, only check the boxes for:
{PRODUCTS_LIST}
4. When you reach "Pricing and Contracts", select Custom Plan and type "Speaking with {AE_NAME}, Sales" in the notes section

Upon receiving notice that you've submitted the production request, I will flag the request to our risk team for an expedited review.
---

4. NEXT STEPS (action-oriented bullets)
- Upcoming meeting if one was scheduled
- Items {AE_FIRST} is checking on internally
- Items the prospect needs to do
- Implementation/compliance alignment
- Beta or launch timeline if discussed

5. SIGN-OFF
"Thanks,
{AE_FIRST}"

CRITICAL RULES — follow these exactly:

1. FACTUAL GROUNDING — only include facts explicitly stated in the transcript or account data. Never infer volume numbers, approval statuses, or commitments that weren't confirmed. If something is uncertain, say "discussed" or "exploring" not "confirmed" or "approved".

2. WORKFLOW SPECIFICITY — do not summarize at a surface level. Extract the actual operational pain: specific manual processes, friction points, document workflows, system gaps. "Manual bank statement uploads with OCR delays" is better than "financial automation needs".

3. TONE MATCHING — read the prospect's communication style from the transcript. Fast-moving technical founder = short sentences, no corporate language, execution-oriented. Conservative enterprise buyer = more formal. Match their energy.

4. SALES MOMENTUM LANGUAGE — use language that keeps deals moving without creating pressure:
   GOOD: "I think we have a strong initial framework and I'm comfortable sharing rough numbers based on current assumptions"
   BAD: "I will provide preliminary pricing estimates"
   GOOD: "Happy to discuss further"
   BAD: "Please do not hesitate to reach out"

5. NATURAL INTEGRATION — when adding next steps or new elements (like bringing in a partner or SE), weave them into the narrative naturally. Don't tack them on as disconnected paragraphs.

6. REMOVE AI POLISH — avoid phrases like "I hope this email finds you well", "leveraging", "utilize", "synergy", "streamline", "robust", "cutting-edge". Write like an experienced AE, not a language model.

7. UNSUPPORTED CLAIMS — if the transcript doesn't confirm it, don't say it. Remove any bullet that you're not 100% certain came from the conversation.

8. Never over-explain pricing unless specifically asked. Do not include dollar amounts unless they were explicitly agreed on the call.
9. Keep total email under 400 words.
10. Use markdown formatting (bold headers, bullet points).
11. If attorney/legal topics came up, include appropriate framing: general guidance only, recommend verifying with legal team.
12. If complianceAlreadySubmitted is true in the context, DO NOT include the Compliance Review Instructions section. Instead, if relevant, reference that the production request is already submitted and mention the security questionnaire if it is the next pending step.`;

const EMAIL_TYPES = [
  { key: 'post_call', label: '📞 Post-Call',  desc: 'Follow-up after a conversation' },
  { key: 'reply',     label: '✉ Reply',       desc: 'Response to an inbound email'    },
  { key: 'outreach',  label: '🎯 Outreach',   desc: 'Cold or warm prospecting email'  },
];

const EMAIL_PROMPTS = {
  reply: `You are drafting a reply email for {AE_FIRST} responding to an inbound customer email.

CRITICAL: Read the customer's actual email in the pasted context. Respond to what they ACTUALLY said — never invent meeting recaps, summaries, or next steps that are not in their message.

DEFERRAL DETECTION — if the customer's email contains any of: capital raise, funding round, bandwidth, capacity, Q3, Q4, August, September, October, "reconnect later", "not the right time", "reach out in", "circle back", or any explicit push to a future timeline, treat this as a DEFERRAL reply.

DEFERRAL REPLY RULES (4 sentences max, no exceptions):
- Do NOT propose a meeting, suggest a call, or add any near-term CTA.
- Do NOT use bullet points or a recap section.
- Confirm their stated timeline exactly — if they said August, say August. Do not suggest June or July.
- Tone: gracious and brief. Not enthusiastic, not salesy.
- Use this as your gold standard output structure:

  Hey [Name], Totally understood — [acknowledge their reason in 3-4 words]. [One sentence of genuine warmth, specific to them or their situation]. I'll reach back out in [their exact stated timeline]. In the meantime, feel free to loop me in if anything comes up on our side. Thanks again for keeping me posted. {AE_FIRST}

NON-DEFERRAL REPLY RULES:
- Acknowledge what they said specifically.
- Answer their question or address their concern directly.
- Propose a clear next step only if their message warrants one.
- Under 200 words. Sign off: "Thanks,\\n{AE_FIRST}"

NEVER write: fake meeting recaps, "looking forward to our next conversation", bullet summaries of calls that aren't in their message, or any content not grounded in what they actually wrote.`,

  outreach: `You are drafting a prospecting email for an AE.
Tone: confident, concise, not salesy.
Structure: specific hook relevant to their business → one clear value prop → single CTA (15-min call).
Maximum 4 sentences. No buzzwords. No "I hope this email finds you well."
Use the account context (vertical, products, business model) to make it specific.
Sign off: "Thanks,\n{AE_FIRST}"`,
};

function detectEmailType(text) {
  const t = (text || "").toLowerCase();
  // Strong call transcript signals
  if (t.includes("transcript") || t.includes("0:00") || t.includes("jack:")) return "post_call";
  // Inbound email signals — checked before length fallback so plain-text customer emails don't default to post_call
  const inboundSignals = [
    "kind regards", "best regards", "many thanks", "warm regards",
    "as we discussed", "i suggest we reconnect", "happy for you to",
    "reconnect in", "reconnect later", "not the right time",
    "bandwidth", "capital raise", "funding round",
    "from:", "subject:", "wrote:", "replied",
  ];
  if (inboundSignals.some(s => t.includes(s))) return "reply";
  return t.length < 300 ? "outreach" : "post_call";
}

const buildCommsContext = (acc, pFile, selectedCall, selectedCallIdx, pasteContext) => {
  const recentCall = selectedCall ?? acc.calls?.[acc.calls.length - 1];
  const contactName = typeof recentCall?.contact === 'string' ? recentCall.contact : (recentCall?.contact?.name || '');
  const firstName = contactName.split(" ")[0] || acc.name.split(" ")[0];
  const includedProducts = (pFile?.products || []).filter(p => p.included);

  const compliance = (() => {
    try { return JSON.parse(localStorage.getItem("prospector_compliance") || "{}")[acc.id] || null; }
    catch { return null; }
  })();
  const prStatus  = compliance?.steps?.find(s => s.id === "prod_request")?.status;
  const sqStatus  = compliance?.steps?.find(s => s.id === "security_q")?.status;
  const complianceAlreadySubmitted = ["Submitted", "Approved"].includes(prStatus);
  const totalCalls = acc.calls?.length || 1;
  const callNum    = selectedCallIdx != null ? selectedCallIdx + 1 : totalCalls;

  const allPricing = (() => { try { return JSON.parse(localStorage.getItem("prospector_pricing_files") || "{}"); } catch { return {}; } })();
  const pricingFile = pFile || allPricing[acc.id] || null;
  const pricingLine = pricingFile
    ? `Quote exists — products: ${(pricingFile.products || []).filter(p => p.included).map(p => p.name).join(", ") || "see file"}`
    : "No quote yet";

  return `
ACCOUNT: ${acc.name}
Contact first name: ${firstName}
Vertical: ${acc.vert || "—"}
Stage: ${acc.stage || "—"}
Total calls with this account: ${totalCalls}
This follow-up is for call #${callNum}
complianceAlreadySubmitted: ${complianceAlreadySubmitted}
Compliance status (production request): ${prStatus || "Not started"}
Security questionnaire: ${sqStatus || "Not started"}

MEDPICC:
Pain / Objective: ${acc.medpicc?.identify_pain?.slice(0, 300) || "not captured"}
Economic Buyer: ${acc.medpicc?.economic_buyer || "not identified"}
Champion: ${acc.medpicc?.champion || "not identified"}
Competition: ${acc.medpicc?.competition || "unknown"}
Decision Criteria: ${acc.medpicc?.decision_criteria || "not stated"}

PRICING: ${pricingLine}

BUSINESS MODEL:
${acc.bm?.slice(0, 400) || "—"}

PRODUCT FIT:
${acc.pf?.slice(0, 300) || "—"}

SELECTED CALL (${recentCall?.date || "unknown"}):
Summary: ${recentCall?.summary?.slice(0, 500) || "no summary"}
Pain points: ${(recentCall?.painPoints || []).map(p => `${p.topic || p}: ${p.solution || ""}`).join(" | ") || "none"}
Next steps: ${(recentCall?.nextSteps || []).map(n => `${n.owner || ""}: ${n.text || n}`).join(" | ") || "none"}
Blockers: ${(recentCall?.blockers || []).map(b => b.text || b).join(" | ") || "none"}
Products discussed: ${(recentCall?.productsDiscussed || []).filter(p => !p.interestLevel || p.interestLevel !== "None").map(p => p.product || p).join(", ") || "none"}

CONFIRMED PRODUCTS (for RQ):
${(acc.prods || []).length > 0 ? acc.prods.join(", ") : includedProducts.map(p => p.name).join(", ") || "none confirmed yet"}

USE CASES: ${(acc.ucs || []).join(", ") || "—"}
KEY SIGNALS: ${(acc.sigs || []).join(", ") || "—"}
PATH TO CLOSE: ${acc.pathToClose || "—"}
${(acc.sentEmails || []).length > 0 ? `\nPREVIOUSLY SENT EMAILS (do not repeat this content — reference it naturally if relevant):\n${(acc.sentEmails).slice(-2).map(e => `Sent ${new Date(e.date).toLocaleDateString()}:\n${e.content.slice(0, 500)}`).join("\n\n")}` : ""}
${pasteContext?.trim() ? `\nADDITIONAL CONTEXT (treat as primary source of truth — use this over other fields if there is any conflict):\n${pasteContext.trim()}` : ""}
  `.trim();
};

const copyEmail = async (markdownText) => {
  const html = markdownText
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>')
    .replace(/^### (.*)/gm, '<h3>$1</h3>')
    .replace(/^## (.*)/gm, '<h2>$1</h2>')
    .replace(/^\* (.*)/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<)(.+)/gm, '<p>$1</p>');
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([`<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${html}</div>`], { type: 'text/html' }),
      'text/plain': new Blob([markdownText], { type: 'text/plain' }),
    }),
  ]);
};

const SECTION_STYLE = {
  background: '#080808',
  border: '0.5px solid #1e1e1e',
  borderRadius: 6,
  padding: '14px 16px',
  marginBottom: 12,
};
const SEC_LBL = { ...mono, fontSize: 9, fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 10 };

export default function AccountCardComms({ acc, tasks, activeUser, onUpdate }) {
  const [emailText,      setEmailText]      = useState("");
  const [emailLoading,   setEmailLoading]   = useState(false);
  const [emailCopied,    setEmailCopied]    = useState(false);
  const [billingCopied,  setBillingCopied]  = useState(false);
  const [linksCopied,    setLinksCopied]    = useState(false);
  const [billingVals,    setBillingVals]    = useState(() => acc.billing || {});
  const [selectedCallIdx,setSelectedCallIdx]= useState(() => Math.max(0, (acc.calls?.length || 1) - 1));
  const [pasteContext,   setPasteContext]   = useState("");
  const [emailType,      setEmailType]      = useState("post_call");
  const [sentDraft,      setSentDraft]      = useState("");
  const [sentLogged,     setSentLogged]     = useState(false);
  const [intelExtracting,setIntelExtracting]=useState(false);
  const [intelDoneFlash, setIntelDoneFlash] = useState(false);

  const pFile = (() => {
    try { return JSON.parse(localStorage.getItem(FILES_KEY) || "{}")[acc.id] || null; }
    catch { return null; }
  })();

  const confirmedProds  = acc.prods || [];
  const pFileProds      = (pFile?.products || []).filter(p => p.included).map(p => p.name);
  const allProds        = [...new Set([...confirmedProds, ...pFileProds])];
  const relevantDocs    = allProds.map(p => PRODUCT_DOCS[p]).filter(Boolean);
  const activeCategories = PRODUCT_CATEGORIES
    .map(cat => ({ ...cat, matches: cat.products.filter(p => allProds.includes(p) && PRODUCT_DOCS[p]) }))
    .filter(cat => cat.matches.length > 0);

  const calls     = acc.calls || [];
  const callCount = calls.length;
  const selectedCall = calls[selectedCallIdx] ?? null;
  const emailSubhead = callCount === 0 ? "No calls logged" : selectedCallIdx === 0 ? "First call follow-up" : `Follow-up #${selectedCallIdx + 1}`;

  const generateEmail = async () => {
    setEmailLoading(true);
    setEmailText("");
    const productsList = relevantDocs.length
      ? relevantDocs.map(d => `- [${d.label}](${d.url})`).join("\n")
      : "- (no products confirmed yet — check with account)";
    const aeName  = activeUser?.name || "AE";
    const aeFirst = aeName.split(" ")[0];
    const basePrompt = EMAIL_PROMPTS[emailType] || SYSTEM_PROMPT;
    const system  = basePrompt
      .replace(/{AE_NAME}/g,  aeName)
      .replace(/{AE_FIRST}/g, aeFirst)
      .replace("{PRODUCTS_LIST}", productsList);
    const context = buildCommsContext(acc, pFile, selectedCall, selectedCallIdx, pasteContext);
    const _comp = (() => { try { return JSON.parse(localStorage.getItem("prospector_compliance") || "{}")[acc.id] || null; } catch { return null; } })();
    const _prStatus = _comp?.steps?.find(s => s.id === "prod_request")?.status;
    try {
      const res = await fetch("/proxy/anthropic/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODELS.STANDARD,
          max_tokens: 1200,
          system,
          messages: [{ role: "user", content: context }],
        }),
      });
      const data = await res.json();
      setEmailText(data.content?.[0]?.text || "Error: empty response");
    } catch {
      setEmailText("Error generating email. Please try again.");
    }
    setEmailLoading(false);
  };

  const saveBillingField = (key, val) => {
    if (!onUpdate) return;
    const updated = { ...billingVals, [key]: val };
    onUpdate({ ...acc, billing: updated });
  };

  const copyBillingBlock = () => {
    const lines = BILLING_FIELDS
      .map(f => `${f.label}: ${billingVals[f.key] || ""}`)
      .join("\n");
    navigator.clipboard.writeText(lines);
    setBillingCopied(true);
    setTimeout(() => setBillingCopied(false), 1500);
  };

  const copyAllLinks = () => {
    const always = `- [API Docs](https://docs.example.com/)\n- [SDK and Libraries](https://docs.example.com/libraries/)`;
    const catLinks = activeCategories
      .map(cat => `**${cat.label}**\n${cat.matches.map(p => `- [${PRODUCT_DOCS[p].label}](${PRODUCT_DOCS[p].url}) — ${PRODUCT_DOCS[p].desc}`).join("\n")}`)
      .join("\n\n");
    navigator.clipboard.writeText([always, catLinks].filter(Boolean).join("\n\n"));
    setLinksCopied(true);
    setTimeout(() => setLinksCopied(false), 1500);
  };

  return (
    <div style={{ paddingBottom: 8 }}>

      {/* ── Section 1: Follow-up Email Generator ─────────────────────────── */}
      <div style={SECTION_STYLE}>
        <span style={{ ...SEC_LBL, color: '#f59e0b88' }}>✦ Generate Follow-up Email</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ ...mono, fontSize: 11, color: C.dim }}>{emailSubhead}</span>
          {callCount > 1 && (
            <select
              value={selectedCallIdx}
              onChange={e => { setSelectedCallIdx(Number(e.target.value)); setEmailText(""); }}
              style={{ ...mono, fontSize: 11, background: '#0a0a0f', border: '1px solid #1e2030', borderRadius: 4, color: '#c8cdd8', padding: '2px 6px', cursor: 'pointer', outline: 'none' }}>
              {[...calls].map((c, i) => (
                <option key={i} value={i}>
                  {c.date} · {(typeof c.contact === 'string' ? c.contact : c.contact?.name) || 'Unknown contact'}{i === calls.length - 1 ? ' (most recent)' : ''}
                </option>
              )).reverse()}
            </select>
          )}
        </div>
        {/* Email type toggle */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
          {EMAIL_TYPES.map(t => (
            <button key={t.key} onClick={() => setEmailType(t.key)} title={t.desc}
              style={{ ...mono, fontSize: 10, padding: '3px 10px', borderRadius: 4, cursor: 'pointer', transition: 'all 0.15s',
                background: emailType === t.key ? '#2dd4bf18' : 'transparent',
                border: `1px solid ${emailType === t.key ? '#2dd4bf66' : '#1e2030'}`,
                color: emailType === t.key ? '#2dd4bf' : '#6b7280',
                fontWeight: emailType === t.key ? 600 : 400,
              }}>
              {t.label}
            </button>
          ))}
        </div>
        <textarea
          value={pasteContext}
          onChange={e => { setPasteContext(e.target.value); setEmailType(detectEmailType(e.target.value)); }}
          placeholder="Paste additional context (optional) — transcript, Gong notes, Slack, emails. Treated as primary source of truth."
          style={{ width: '100%', boxSizing: 'border-box', minHeight: 80, background: '#0a0a0f', border: '1px solid #1e2030', borderRadius: 5, color: '#c8cdd8', fontSize: 12, lineHeight: 1.5, padding: '8px 10px', fontFamily: 'ui-monospace,"SF Mono",Menlo,monospace', outline: 'none', resize: 'vertical', marginBottom: 10 }}
        />
        <div style={{ display: 'flex', gap: 8, marginBottom: emailText ? 12 : 0 }}>
          <button
            onClick={generateEmail}
            disabled={emailLoading}
            style={{ ...mono, fontSize: 12, padding: '5px 14px', background: emailLoading ? 'transparent' : '#f59e0b18', border: `1px solid ${emailLoading ? C.brd : '#f59e0b88'}`, borderRadius: 5, color: emailLoading ? C.dim : '#f59e0b', fontWeight: 600, cursor: emailLoading ? 'default' : 'pointer' }}>
            {emailLoading ? 'Generating in your voice…' : emailText ? '↺ Regenerate' : '✦ Generate →'}
          </button>
        </div>
        {emailText && (
          <>
            <textarea
              value={emailText}
              onChange={e => setEmailText(e.target.value)}
              rows={16}
              style={{ width: '100%', boxSizing: 'border-box', background: '#0a0a0f', border: `1px solid #1e2030`, borderRadius: 5, color: '#c8cdd8', fontSize: 12, lineHeight: 1.65, padding: '10px 12px', fontFamily: 'ui-monospace,"SF Mono",Menlo,monospace', outline: 'none', resize: 'vertical', marginBottom: 8 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={async () => { await copyEmail(emailText); setEmailCopied(true); setTimeout(() => setEmailCopied(false), 1500); }}
                style={{ ...mono, fontSize: 11, padding: '4px 12px', background: emailCopied ? '#4ade8018' : '#00b4d810', border: `1px solid ${emailCopied ? '#4ade8044' : '#00b4d844'}`, borderRadius: 4, color: emailCopied ? '#4ade80' : '#00b4d8', cursor: 'pointer' }}>
                {emailCopied ? '✓ Copied' : 'Copy →'}
              </button>
              <button
                onClick={generateEmail}
                disabled={emailLoading}
                style={{ ...mono, fontSize: 11, padding: '4px 12px', background: 'transparent', border: `1px solid ${C.brd}`, borderRadius: 4, color: C.dim, cursor: emailLoading ? 'default' : 'pointer' }}>
                ↺ Regenerate
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Section 1b: Sent Emails Log ──────────────────────────────────── */}
      <div style={SECTION_STYLE}>
        <span style={{ ...SEC_LBL, color: '#4ade8088' }}>Sent Emails</span>
        <textarea
          value={sentDraft}
          onChange={e => setSentDraft(e.target.value)}
          placeholder="Paste the email you actually sent..."
          style={{ width: '100%', boxSizing: 'border-box', minHeight: 80, background: '#0a0a0f', border: '1px solid #1e2030', borderRadius: 5, color: '#c8cdd8', fontSize: 12, lineHeight: 1.5, padding: '8px 10px', fontFamily: 'ui-monospace,"SF Mono",Menlo,monospace', outline: 'none', resize: 'vertical', marginBottom: 8 }}
        />
        <button
          onClick={async () => {
            if (!sentDraft.trim() || !onUpdate) return;
            const emailText = sentDraft.trim();
            const today = new Date().toISOString().split('T')[0];
            const entry = { date: new Date().toISOString(), content: emailText, callIdx: selectedCallIdx, source: "manual" };
            const accWithEmail = { ...acc, sentEmails: [...(acc.sentEmails || []), entry] };
            onUpdate(accWithEmail);
            setSentDraft("");
            setSentLogged(true);
            setTimeout(() => setSentLogged(false), 1500);

            // Background intel extraction — runs after save so user sees instant feedback
            setIntelExtracting(true);
            try {
              const result = await clientDebrief(emailText, accWithEmail, today, { model: MODELS.STANDARD });
              const intel = extractIntelligenceFromCall(result, accWithEmail);
              const updatedMedpicc = { ...(accWithEmail.medpicc || {}) };
              if (result.medpiccUpdates) {
                Object.entries(result.medpiccUpdates).forEach(([k, v]) => {
                  if (v && (!updatedMedpicc[k] || updatedMedpicc[k].length < v.length)) {
                    updatedMedpicc[k] = v;
                  }
                });
              }
              onUpdate({
                ...accWithEmail,
                medpicc: updatedMedpicc,
                lastIntelAt: new Date().toISOString(),
                ...(intel.mergedProds    ? { prods:    intel.mergedProds    } : {}),
                ...(intel.mergedUcs      ? { ucs:      intel.mergedUcs      } : {}),
                ...(intel.mergedSigs     ? { sigs:     intel.mergedSigs     } : {}),
                ...(intel.mergedPersonas ? { personas: intel.mergedPersonas } : {}),
              });
              setIntelDoneFlash(true);
              setTimeout(() => setIntelDoneFlash(false), 2500);
            } catch {
              // Email already saved; silent intel-extraction failure
            } finally {
              setIntelExtracting(false);
            }
          }}
          disabled={!sentDraft.trim() || intelExtracting}
          style={{ ...mono, fontSize: 11, padding: '4px 12px', background: intelDoneFlash ? `${T.neon}18` : sentLogged ? '#4ade8018' : 'transparent', border: `1px solid ${intelDoneFlash ? `${T.neon}44` : sentLogged ? '#4ade8044' : C.brd}`, borderRadius: 4, color: intelDoneFlash ? T.neon : sentLogged ? '#4ade80' : C.dim, cursor: sentDraft.trim() && !intelExtracting ? 'pointer' : 'default', opacity: sentDraft.trim() ? 1 : 0.5 }}>
          {intelExtracting ? '⟳ Extracting intel…' : intelDoneFlash ? '✦ Intel updated' : sentLogged ? '✓ Logged' : '+ Log sent email'}
        </button>
        {(acc.sentEmails || []).length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ ...mono, fontSize: 9, color: '#333', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{acc.sentEmails.length} logged</span>
            {[...acc.sentEmails].reverse().slice(0, 3).map((e, i) => (
              <div key={i} style={{ background: '#0a0a0f', border: '0.5px solid #1e1e1e', borderRadius: 4, padding: '7px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ ...mono, fontSize: 10, color: '#4ade80' }}>{new Date(e.date).toLocaleDateString()}</span>
                  {e.callIdx != null && <span style={{ ...mono, fontSize: 10, color: C.dim }}>after call #{e.callIdx + 1}</span>}
                  <button
                    onClick={() => onUpdate && onUpdate({ ...acc, sentEmails: acc.sentEmails.filter((_, j) => acc.sentEmails.length - 1 - j !== i) })}
                    style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: C.dim, fontSize: 11, cursor: 'pointer', padding: '0 2px' }}>✕</button>
                </div>
                <p style={{ ...mono, fontSize: 11, color: '#888', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                  {e.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Section 2: Resource Links ─────────────────────────────────────── */}
      <div style={SECTION_STYLE}>
        <span style={{ ...SEC_LBL, color: '#00b4d888' }}>API Docs for this account</span>
        {/* Always-present links */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: activeCategories.length ? 12 : 0 }}>
          {[
            { label: 'API Docs',           url: 'https://docs.example.com/',              desc: 'Full API reference and quickstart guides' },
            { label: 'SDK and Libraries',  url: 'https://docs.example.com/libraries/',    desc: 'Official client libraries for all languages' },
          ].map(link => (
            <div key={link.url} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <a href={link.url} target="_blank" rel="noopener noreferrer"
                style={{ ...mono, fontSize: 12, color: '#f59e0b', textDecoration: 'none', flexShrink: 0 }}
                onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                onMouseLeave={e => e.target.style.textDecoration = 'none'}>
                {link.label}
              </a>
              <span style={{ ...mono, fontSize: 11, color: C.dim }}>{link.desc}</span>
            </div>
          ))}
        </div>
        {/* Product-specific links by category */}
        {activeCategories.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {activeCategories.map(cat => (
              <div key={cat.label}>
                <span style={{ ...mono, fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: 5 }}>{cat.label}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {cat.matches.map(p => {
                    const doc = PRODUCT_DOCS[p];
                    return (
                      <div key={p} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <a href={doc.url} target="_blank" rel="noopener noreferrer"
                          style={{ ...mono, fontSize: 12, color: '#f59e0b', textDecoration: 'none', flexShrink: 0 }}
                          onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                          onMouseLeave={e => e.target.style.textDecoration = 'none'}>
                          {doc.label}
                        </a>
                        <span style={{ ...mono, fontSize: 11, color: C.dim }}>{doc.desc}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <span style={{ ...mono, fontSize: 11, color: '#444', marginTop: 4, display: 'block' }}>
            Add confirmed products in Settings to see filtered docs.
          </span>
        )}
        <button
          onClick={copyAllLinks}
          style={{ ...mono, fontSize: 11, padding: '4px 12px', background: linksCopied ? '#4ade8018' : 'transparent', border: `1px solid ${linksCopied ? '#4ade8044' : C.brd}`, borderRadius: 4, color: linksCopied ? '#4ade80' : C.dim, cursor: 'pointer', marginTop: 12 }}>
          {linksCopied ? '✓ Copied' : 'Copy all links →'}
        </button>
      </div>

      {/* ── Section 3: Billing Info ───────────────────────────────────────── */}
      <div style={SECTION_STYLE}>
        <span style={{ ...SEC_LBL, color: '#c084fc88' }}>Billing Info</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 10 }}>
          {BILLING_FIELDS.map(f => (
            <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ ...mono, fontSize: 11, color: C.dim, width: 130, flexShrink: 0 }}>{f.label}</span>
              <input
                type="text"
                value={billingVals[f.key] || ""}
                onChange={e => setBillingVals(v => ({ ...v, [f.key]: e.target.value }))}
                onBlur={e => saveBillingField(f.key, e.target.value)}
                style={{ ...mono, flex: 1, fontSize: 12, padding: '4px 8px', background: '#0a0a0f', border: `1px solid #1e2030`, borderRadius: 4, color: '#c8cdd8', outline: 'none' }}
              />
            </div>
          ))}
        </div>
        <button
          onClick={copyBillingBlock}
          style={{ ...mono, fontSize: 11, padding: '4px 12px', background: billingCopied ? '#4ade8018' : 'transparent', border: `1px solid ${billingCopied ? '#4ade8044' : C.brd}`, borderRadius: 4, color: billingCopied ? '#4ade80' : C.dim, cursor: 'pointer' }}>
          {billingCopied ? '✓ Copied' : 'Copy billing block →'}
        </button>
      </div>

    </div>
  );
}
