import React, { useState } from 'react';
import { C, mono } from '../constants/colors';
import { T } from '../constants/tokens';
import { MODELS } from '../config/models';
import { clientDebrief } from '../utils/dealIntel';
import { extractIntelligenceFromCall } from '../utils/intelligenceEngine';
import { FILES_KEY } from '../utils/storageKeys';
import EmailModal from './EmailModal';

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

const SECTION_STYLE = {
  background: '#080808',
  border: '0.5px solid #1e1e1e',
  borderRadius: 6,
  padding: '14px 16px',
  marginBottom: 12,
};
const SEC_LBL = { ...mono, fontSize: 9, fontWeight: 700, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 10 };

// generation-engine-consolidation-v1 Stage 1 — the account's own generation
// trigger now opens the real EmailModal (same component AccountCard.js's
// main "Generate Outreach" uses) instead of an independent generator.
// callCount > 0 defaults to 'follow_up' since this panel's real usage was
// always post-call; a bare-new account still gets 'cold_outreach'. business/
// projects are required to reach EmailModal's real project-guidance
// resolution - previously unreachable from here since this panel never had
// them at all.
export default function AccountCardComms({ acc, tasks, activeUser, onUpdate, business, projects = [], campaigns = [] }) {
  const [billingCopied,  setBillingCopied]  = useState(false);
  const [linksCopied,    setLinksCopied]    = useState(false);
  const [billingVals,    setBillingVals]    = useState(() => acc.billing || {});
  const [selectedCallIdx,setSelectedCallIdx]= useState(() => Math.max(0, (acc.calls?.length || 1) - 1));
  const [generateOpen,   setGenerateOpen]   = useState(false);
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

      {/* ── Section 1: Generate Follow-up Email ──────────────────────────── */}
      <div style={SECTION_STYLE}>
        <span style={{ ...SEC_LBL, color: '#f59e0b88' }}>✦ Generate Follow-up Email</span>
        <p style={{ ...mono, fontSize: 11, color: C.dim, margin: '0 0 10px' }}>
          {callCount === 0 ? "No calls logged yet" : `${callCount} call${callCount === 1 ? '' : 's'} logged — generation grounds in the most recent`}
        </p>
        <button
          onClick={() => setGenerateOpen(true)}
          style={{ ...mono, fontSize: 12, padding: '5px 14px', background: '#f59e0b18', border: '1px solid #f59e0b88', borderRadius: 5, color: '#f59e0b', fontWeight: 600, cursor: 'pointer' }}>
          ✦ Generate →
        </button>
      </div>

      {generateOpen && (
        <EmailModal
          account={acc}
          business={business}
          persona={(acc.personas || [])[0] || null}
          accountKind={acc.accountKind}
          autoStart={false}
          initialMessageType={callCount > 0 ? 'follow_up' : 'cold_outreach'}
          projects={projects}
          campaigns={campaigns}
          onClose={() => setGenerateOpen(false)}
        />
      )}

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
