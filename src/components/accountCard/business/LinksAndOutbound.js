import { useState } from 'react';
import { mono } from '../../../constants/colors';
import { CARD, RADIUS } from '../tokens';
import { BDR_LIST, URGENCY_OPTIONS } from '../../../utils/assignHelper';
import { getCachedTopContact, getCachedAlternateContacts } from '../../../utils/hunter';
import { fetchSentEmailsForAccount, buildNsPrompt } from '../../../utils/nsCopy';
import { MODELS } from '../../../config/models';

const SF_BASE_AC = "https://your-org.lightning.force.com/lightning/r/Account/";
const toSfdcUrl = v => {
  if (!v || !v.trim()) return null;
  if (v.startsWith("http")) return v.trim();
  if (/^001[A-Za-z0-9]{12,15}$/.test(v.trim())) return `${SF_BASE_AC}${v.trim()}/view`;
  return null;
};

// Tier 3 utility row (links, client ID, email, outbound assignment) plus
// the Tier 2 SFDC-copy action — relocated verbatim from the old
// AccountCardActionBar.js, just no longer sharing a file with everything
// else. Business-only.
export default function LinksAndOutbound({ acc, onUpdate, tasks, activeUser, assignedEntry, onAssign, onUnassign }) {
  const [linksEdit, setLinksEdit] = useState(false);
  const [linksDraft, setLinksDraft] = useState({ web: '', sfdc: '', linkedin: '', clientIds: '' });
  const [clientIdsEdit, setClientIdsEdit] = useState(false);
  const [clientIdsInput, setClientIdsInput] = useState("");
  const [outboundPickerOpen, setOutboundPickerOpen] = useState(false);
  const [sfdcLoading, setSfdcLoading] = useState(false);
  const [sfdcCopied, setSfdcCopied] = useState(false);
  const [sfdcText, setSfdcText] = useState('');

  const webUrl = acc.web ? (acc.web.startsWith("http") ? acc.web : `https://${acc.web}`) : null;
  const liUrl = acc.linkedin || `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(acc.name)}`;

  const openEmail = () => {
    const contact = acc.personas?.[0]?.email || "";
    const subject = encodeURIComponent(`${acc.name} intro`);
    window.open(`https://mail.google.com/mail/?view=cm&to=${contact}&su=${subject}`, "_blank");
  };

  const askSfdc = async () => {
    setSfdcLoading(true); setSfdcCopied(false); setSfdcText('');
    const now = new Date();
    const todayFmt = `${now.getMonth() + 1}/${now.getDate()}`;
    const todayISO = now.toISOString().split('T')[0];
    const twoWeeksOut = (() => { const d = new Date(now); d.setDate(d.getDate() + 14); return `${d.getMonth() + 1}/${d.getDate()}`; })();
    const sentEmails = await fetchSentEmailsForAccount(acc.name);
    const { prompt } = buildNsPrompt({ acc, tasks, activeUser, sentEmails, todayFmt, todayISO, twoWeeksOut });
    try {
      const r = await fetch('/proxy/anthropic/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODELS.STANDARD, max_tokens: 280, messages: [{ role: 'user', content: prompt }] }) });
      const d = await r.json(); const text = d.content?.[0]?.text?.trim() || '';
      setSfdcText(text); navigator.clipboard.writeText(text).catch(() => {}); setSfdcCopied(true); setTimeout(() => setSfdcCopied(false), 2000);
    } catch (e) { console.error('SFDC copy error:', e); }
    setSfdcLoading(false);
  };

  const itemStyle = { ...mono, fontSize: 10, height: 24, padding: "0 9px", display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: `1px solid ${CARD.border}`, color: CARD.textMuted, borderRadius: RADIUS.sm, textDecoration: "none", cursor: "pointer", whiteSpace: "nowrap" };

  return (
    <div onClick={e => e.stopPropagation()}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={askSfdc} disabled={sfdcLoading} title={sfdcLoading ? 'Generating…' : sfdcCopied ? 'Copied to clipboard' : 'Generate an SFDC update note and copy it to clipboard'}
          style={{ ...itemStyle, borderColor: sfdcCopied ? "#3ba0c9" : CARD.border, color: sfdcCopied ? "#3ba0c9" : CARD.textMuted }}>
          {sfdcLoading ? '⟳' : sfdcCopied ? '✓ Copied' : '⎘ SFDC Note'}
        </button>

        {linksEdit ? (
          <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            <input autoFocus value={linksDraft.web} onChange={e => setLinksDraft(d => ({ ...d, web: e.target.value }))} placeholder="Website URL" style={{ ...mono, fontSize: 11, padding: "2px 7px", background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: 4, color: CARD.textPrimary, outline: "none", width: 130 }} />
            <input value={linksDraft.linkedin} onChange={e => setLinksDraft(d => ({ ...d, linkedin: e.target.value }))} placeholder="LinkedIn URL" style={{ ...mono, fontSize: 11, padding: "2px 7px", background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: 4, color: CARD.textPrimary, outline: "none", width: 130 }} />
            <input value={linksDraft.sfdc} onChange={e => setLinksDraft(d => ({ ...d, sfdc: e.target.value }))} placeholder="SFDC URL or ID" style={{ ...mono, fontSize: 11, padding: "2px 7px", background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: 4, color: CARD.textPrimary, outline: "none", width: 130 }} />
            {/* account-card-button-cleanup-v1 — clientIds folded into this
                same form so the dedicated Client ID button can be removed
                in a later pass once this path is confirmed working. */}
            <input value={linksDraft.clientIds} onChange={e => setLinksDraft(d => ({ ...d, clientIds: e.target.value }))} placeholder="Client ID(s), comma-separated" style={{ ...mono, fontSize: 11, padding: "2px 7px", background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: 4, color: CARD.textPrimary, outline: "none", width: 130 }} />
            <button onClick={() => { onUpdate && onUpdate({ ...acc, web: linksDraft.web, sfdc: linksDraft.sfdc, linkedin: linksDraft.linkedin, clientIds: linksDraft.clientIds.split(",").map(s => s.trim()).filter(Boolean) }); setLinksEdit(false); }} style={itemStyle}>Save</button>
            <button onClick={() => setLinksEdit(false)} style={itemStyle}>Cancel</button>
          </span>
        ) : (
          <>
            {webUrl && <a href={webUrl} target="_blank" rel="noreferrer" style={itemStyle}>↗ Website</a>}
            <a href={liUrl} target="_blank" rel="noreferrer" style={itemStyle}>in LinkedIn</a>
            {/* account-card-button-cleanup-v1 — the invalid-state "⬡ SF"
                edit-trigger was removed (redundant with ✏ below, which opens
                the identical form). The valid-state real link is kept — it's
                genuine navigation to a real SFDC record, not redundant with
                anything else on this card. */}
            {toSfdcUrl(acc.sfdc) && <a href={toSfdcUrl(acc.sfdc)} target="_blank" rel="noreferrer" style={itemStyle}>⬡ Salesforce</a>}
            {onUpdate && <button onClick={() => { setLinksDraft({ web: acc.web || '', sfdc: acc.sfdc || '', linkedin: acc.linkedin || '', clientIds: (acc.clientIds || []).join(', ') }); setLinksEdit(true); }} style={itemStyle} title="Edit links">✏</button>}
          </>
        )}

        {clientIdsEdit ? (
          <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
            <input autoFocus value={clientIdsInput} onChange={e => setClientIdsInput(e.target.value)} placeholder="a_xxx, a_yyy…" onKeyDown={e => { if (e.key === "Enter" && clientIdsInput.trim()) { const ids = clientIdsInput.split(",").map(s => s.trim()).filter(Boolean); onUpdate && onUpdate({ ...acc, clientIds: ids }); setClientIdsEdit(false); setClientIdsInput(""); } if (e.key === "Escape") { setClientIdsEdit(false); setClientIdsInput(""); } }} style={{ ...mono, fontSize: 11, padding: "2px 7px", background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: 4, color: CARD.textPrimary, outline: "none", width: 130 }} />
            <button onClick={() => { const ids = clientIdsInput.split(",").map(s => s.trim()).filter(Boolean); if (ids.length) { onUpdate && onUpdate({ ...acc, clientIds: ids }); setClientIdsEdit(false); setClientIdsInput(""); } }} style={itemStyle}>✓</button>
            <button onClick={() => { setClientIdsEdit(false); setClientIdsInput(""); }} style={itemStyle}>✕</button>
          </span>
        ) : (acc.clientIds || []).length > 0 ? (
          <button onClick={() => { if (onUpdate) { setClientIdsInput((acc.clientIds || []).join(", ")); setClientIdsEdit(true); } }} style={itemStyle} title={(acc.clientIds || []).join(", ")}>🪪 {(acc.clientIds || []).length === 1 ? acc.clientIds[0] : `${(acc.clientIds || []).length} IDs`}</button>
        ) : (
          <button onClick={() => { if (onUpdate) { setClientIdsEdit(true); setClientIdsInput(""); } }} style={itemStyle}>🪪 Client ID</button>
        )}

        <button onClick={openEmail} style={itemStyle}>✉ Email</button>

        {onAssign && (
          <div style={{ position: "relative" }}>
            {assignedEntry ? (() => {
              const urg = URGENCY_OPTIONS.find(u => u.id === assignedEntry.urgency) || null;
              return <span style={{ ...itemStyle, color: urg?.color || CARD.textMuted, cursor: onUnassign ? "pointer" : "default" }} onClick={() => onUnassign && onUnassign(acc.name)}>◎{urg ? ` ${urg.label}` : ""}{onUnassign && " ✕"}</span>;
            })() : (
              <>
                <button onClick={() => setOutboundPickerOpen(o => !o)} style={itemStyle}>Outbound →</button>
                {outboundPickerOpen && (() => {
                  const me = activeUser ? { id: activeUser.id, name: 'Me', display: activeUser.name } : null;
                  const bdrs = BDR_LIST || [];
                  const handle = (assignees) => {
                    if (!onAssign || !assignees.length) { setOutboundPickerOpen(false); return; }
                    const bdrAssignee = assignees.find(a => bdrs.some(b => b.id === a.id)) || assignees[0];
                    const note = assignees.length > 1 ? `Co-assigned with ${assignees.map(a => a.display || a.name).join(' + ')}` : '';
                    onAssign(acc, bdrAssignee.id, note, 'warm');
                    queueMicrotask(() => {
                      window.dispatchEvent(new CustomEvent('prospector_outbound_enrich', { detail: { accountId: acc.id, accountName: acc.name, web: acc.web, topContact: getCachedTopContact(acc.web), alternateContacts: getCachedAlternateContacts(acc.web) } }));
                    });
                    setOutboundPickerOpen(false);
                  };
                  return (
                    <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 41, background: CARD.surface2, border: `1px solid ${CARD.borderStrong}`, borderRadius: RADIUS.md, minWidth: 160, marginTop: 4 }}>
                      {me && <button onClick={() => handle([me])} style={{ ...itemStyle, display: "block", width: "100%", border: "none" }}>Assign to me</button>}
                      {bdrs.map(b => <button key={b.id} onClick={() => handle([b])} style={{ ...itemStyle, display: "block", width: "100%", border: "none" }}>{b.name}</button>)}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}
      </div>
      {sfdcText && sfdcCopied === false && (<div style={{ marginTop: 8, padding: "7px 10px", background: CARD.surface2, border: `1px solid ${CARD.border}`, borderRadius: 4 }}><p style={{ ...mono, margin: 0, fontSize: 11, color: CARD.textPrimary, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{sfdcText}</p></div>)}
    </div>
  );
}
