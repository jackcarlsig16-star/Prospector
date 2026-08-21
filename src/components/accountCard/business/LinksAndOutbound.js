import { useState } from 'react';
import { mono } from '../../../constants/colors';
import { CARD, RADIUS } from '../tokens';
import { BDR_LIST, URGENCY_OPTIONS } from '../../../utils/assignHelper';
import { getCachedTopContact, getCachedAlternateContacts } from '../../../utils/hunter';

const SF_BASE_AC = "https://your-org.lightning.force.com/lightning/r/Account/";
const toSfdcUrl = v => {
  if (!v || !v.trim()) return null;
  if (v.startsWith("http")) return v.trim();
  if (/^001[A-Za-z0-9]{12,15}$/.test(v.trim())) return `${SF_BASE_AC}${v.trim()}/view`;
  return null;
};

// Tier 3 utility row (links, email, outbound assignment) plus the grouped
// editable-fields section below — relocated verbatim from the old
// AccountCardActionBar.js, just no longer sharing a file with everything
// else. Business-only.
//
// account-card-cleanup-v1 Stage 4 - the "⎘ SFDC Note" copy button (askSfdc
// + its sfdcLoading/sfdcCopied/sfdcText state) and the standalone "🪪 Client
// ID" badge/edit control (clientIdsEdit/clientIdsInput) were removed
// entirely - clientIds is still editable, just folded into the Website/
// LinkedIn edit form below (already the plan per the account-card-button-
// cleanup-v1 comment this replaces).
export default function LinksAndOutbound({ acc, onUpdate, tasks, activeUser, assignedEntry, onAssign, onUnassign }) {
  const [linksEdit, setLinksEdit] = useState(false);
  const [linksDraft, setLinksDraft] = useState({ web: '', sfdc: '', linkedin: '', clientIds: '' });
  const [outboundPickerOpen, setOutboundPickerOpen] = useState(false);

  const webUrl = acc.web ? (acc.web.startsWith("http") ? acc.web : `https://${acc.web}`) : null;
  const liUrl = acc.linkedin || `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(acc.name)}`;

  const openEmail = () => {
    const contact = acc.personas?.[0]?.email || "";
    const subject = encodeURIComponent(`${acc.name} intro`);
    window.open(`https://mail.google.com/mail/?view=cm&to=${contact}&su=${subject}`, "_blank");
  };

  const itemStyle = { ...mono, fontSize: 10, height: 24, padding: "0 9px", display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: `1px solid ${CARD.border}`, color: CARD.textMuted, borderRadius: RADIUS.sm, textDecoration: "none", cursor: "pointer", whiteSpace: "nowrap" };
  // account-card-density-v1 — square icon-only variant for the field links,
  // per the mockup's 27x27 boxes. Every one carries a title, since dropping
  // the text label takes the affordance with it.
  const iconStyle = { ...itemStyle, width: 27, height: 27, padding: 0, justifyContent: "center", color: "#7d8a7d", fontSize: 11 };

  return (
    <div onClick={e => e.stopPropagation()} style={{ display: "contents" }}>
      <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
        {/* account-card-button-cleanup-v1 — the invalid-state "⬡ SF"
            edit-trigger was removed (redundant with the ✏ below, which
            opens the identical form). The valid-state real link is kept —
            it's genuine navigation to a real SFDC record, not redundant
            with anything else on this card. */}
        {toSfdcUrl(acc.sfdc) && <a href={toSfdcUrl(acc.sfdc)} target="_blank" rel="noreferrer" style={itemStyle}>⬡ Salesforce</a>}

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

      {/* account-card-density-v1 — the bordered "Fields" panel and its
          section label are gone; these sit in the shared action strip now,
          icon-only, as the approved mockup shows. The ✏ trigger stays: it
          opens the only editor for web/linkedin/sfdc/clientIds, and the
          mockup omitting it was a mockup simplification, not a decision to
          drop field editing. */}
      <span style={{ width: 1, height: 16, background: CARD.borderStrong, margin: "0 3px" }} />
      <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
          {linksEdit ? (
            <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
              <input autoFocus value={linksDraft.web} onChange={e => setLinksDraft(d => ({ ...d, web: e.target.value }))} placeholder="Website URL" style={{ ...mono, fontSize: 11, padding: "2px 7px", background: CARD.surface2, border: `1px solid ${CARD.border}`, borderRadius: 4, color: CARD.textPrimary, outline: "none", width: 130 }} />
              <input value={linksDraft.linkedin} onChange={e => setLinksDraft(d => ({ ...d, linkedin: e.target.value }))} placeholder="LinkedIn URL" style={{ ...mono, fontSize: 11, padding: "2px 7px", background: CARD.surface2, border: `1px solid ${CARD.border}`, borderRadius: 4, color: CARD.textPrimary, outline: "none", width: 130 }} />
              <input value={linksDraft.sfdc} onChange={e => setLinksDraft(d => ({ ...d, sfdc: e.target.value }))} placeholder="SFDC URL or ID" style={{ ...mono, fontSize: 11, padding: "2px 7px", background: CARD.surface2, border: `1px solid ${CARD.border}`, borderRadius: 4, color: CARD.textPrimary, outline: "none", width: 130 }} />
              {/* account-card-cleanup-v1 Stage 4 — clientIds stays in this
                  form (the dedicated "🪪 Client ID" button was removed). */}
              <input value={linksDraft.clientIds} onChange={e => setLinksDraft(d => ({ ...d, clientIds: e.target.value }))} placeholder="Client ID(s), comma-separated" style={{ ...mono, fontSize: 11, padding: "2px 7px", background: CARD.surface2, border: `1px solid ${CARD.border}`, borderRadius: 4, color: CARD.textPrimary, outline: "none", width: 130 }} />
              <button onClick={() => { onUpdate && onUpdate({ ...acc, web: linksDraft.web, sfdc: linksDraft.sfdc, linkedin: linksDraft.linkedin, clientIds: linksDraft.clientIds.split(",").map(s => s.trim()).filter(Boolean) }); setLinksEdit(false); }} style={itemStyle}>Save</button>
              <button onClick={() => setLinksEdit(false)} style={itemStyle}>Cancel</button>
            </span>
          ) : (
            <>
              {webUrl
                ? <a href={webUrl} target="_blank" rel="noreferrer" style={iconStyle} title={acc.web}>↗</a>
                : <span style={{ ...iconStyle, cursor: "default", opacity: 0.45 }} title="No website">↗</span>}
              <a href={liUrl} target="_blank" rel="noreferrer" style={iconStyle} title="LinkedIn">in</a>
              <button onClick={openEmail} style={iconStyle} title="Email">✉</button>
              {onUpdate && <button onClick={() => { setLinksDraft({ web: acc.web || '', sfdc: acc.sfdc || '', linkedin: acc.linkedin || '', clientIds: (acc.clientIds || []).join(', ') }); setLinksEdit(true); }} style={iconStyle} title="Edit fields">✏</button>}
            </>
          )}
      </div>
    </div>
  );
}
