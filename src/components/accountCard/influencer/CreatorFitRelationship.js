import { useState } from 'react';
import { mono } from '../../../constants/colors';
import { CARD, KIND, RADIUS } from '../tokens';
import { updateInfluencerRelationship } from '../../../utils/db';

const STAGE_OPTIONS = ['not_contacted', 'contacted', 'replied', 'interested', 'negotiating', 'partnered', 'declined', 'do_not_contact'];
const TEMP_OPTIONS = ['warm', 'familiar', 'cold'];
const PRIORITY_OPTIONS = ['low', 'medium', 'high'];
const STAGE_COLOR = { not_contacted: CARD.textMuted, contacted: "#56A8F8", replied: "#56A8F8", interested: "#f5c542", negotiating: "#F5A050", partnered: "#4ade80", declined: "#F06060", do_not_contact: "#F06060" };
const TEMP_COLOR = { warm: "#F5A050", familiar: "#f5c542", cold: "#56A8F8" };
const PRIORITY_COLOR = { low: CARD.textMuted, medium: "#f5c542", high: "#F06060" };
const fitColor = (score) => score == null ? CARD.textMuted : score >= 70 ? "#4ade80" : score >= 40 ? "#f5c542" : "#F06060";
const label = s => (s || '').replace(/_/g, ' ');

const pill = (color) => ({ ...mono, fontSize: 10, padding: "2px 8px", borderRadius: 20, background: `${color}18`, border: `1px solid ${color}55`, color, whiteSpace: "nowrap" });
const select = { ...mono, fontSize: 11, padding: "4px 8px", background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: RADIUS.sm, color: CARD.textPrimary, outline: "none", cursor: "pointer" };
const input = { ...mono, fontSize: 12, padding: "7px 10px", background: CARD.surface, border: `1px solid ${CARD.border}`, borderRadius: RADIUS.md, color: CARD.textPrimary, outline: "none", boxSizing: "border-box", width: "100%" };
const SH = { ...mono, fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: CARD.textSubtle };

export function FitSummary({ detail }) {
  const fit = detail?.fit_score;
  if (detail?.assessment_status !== 'ready') return <p style={{ ...mono, fontSize: 11, color: CARD.textMuted, margin: 0 }}>No fit assessment yet.</p>;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ ...mono, fontSize: 22, fontWeight: 700, color: fitColor(fit) }}>{fit ?? '—'}</span>
        <span style={{ ...mono, fontSize: 10, color: CARD.textMuted }}>/ 100 fit</span>
      </div>
      {detail.fit_rationale && <p style={{ ...mono, fontSize: 12, color: CARD.textSecondary, lineHeight: 1.6, margin: "6px 0 0" }}>{detail.fit_rationale}</p>}
    </div>
  );
}

function AssessBioForm({ business, acc, detail, onAssessed }) {
  const [bio, setBio] = useState(detail?.bio_snapshot || '');
  const [followerCount, setFollowerCount] = useState(detail?.follower_count || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    if (!bio.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/businesses/${business.id}/influencer/assess`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: acc.id, bioText: bio.trim(), followerCount: followerCount ? Number(followerCount) : null }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Assessment failed');
      onAssessed(data.detail);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 10 }}>
      <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} placeholder="Paste their bio to assess (or re-assess with an updated bio)" style={{ ...input, resize: "vertical", marginBottom: 8 }} disabled={busy} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="number" value={followerCount} onChange={e => setFollowerCount(e.target.value)} placeholder="followers (optional)" style={{ ...input, width: 160 }} disabled={busy} />
        <button onClick={run} disabled={!bio.trim() || busy} style={{ ...mono, fontSize: 11, padding: "7px 14px", background: KIND.influencer.accent, border: `1px solid ${KIND.influencer.accent}`, borderRadius: RADIUS.md, color: CARD.bg, cursor: "pointer", fontWeight: 700, opacity: bio.trim() ? 1 : 0.5 }}>
          {busy ? "Assessing…" : detail?.assessment_status === 'ready' ? "Re-run assessment →" : "Run assessment →"}
        </button>
      </div>
      {error && <p style={{ ...mono, fontSize: 11, color: "#F06060", margin: "8px 0 0" }}>⚠ {error}</p>}
    </div>
  );
}

function RelationshipFields({ acc, detail, userEmail, canEdit, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const [nextAction, setNextAction] = useState(detail?.next_action || '');
  const [declineReason, setDeclineReason] = useState(detail?.decline_reason || '');
  const [tagInput, setTagInput] = useState('');
  const tags = Array.isArray(detail?.tags) ? detail.tags : [];
  const apply = async (patch) => {
    setSaving(true);
    const { detail: updated, error } = await updateInfluencerRelationship(acc.id, userEmail, patch);
    setSaving(false);
    if (!error) onUpdated(updated);
  };
  return (
    <>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        {[['relationship_stage', STAGE_OPTIONS, STAGE_COLOR, 'Stage'], ['relationship_temperature', TEMP_OPTIONS, TEMP_COLOR, 'Temperature'], ['priority', PRIORITY_OPTIONS, PRIORITY_COLOR, 'Priority']].map(([key, opts, colors, lbl]) => (
          <div key={key}>
            <div style={{ ...mono, fontSize: 9, color: CARD.textSubtle, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{lbl}</div>
            {canEdit ? (
              <select value={detail?.[key] || (key === 'relationship_stage' ? 'not_contacted' : '')} disabled={saving} onChange={e => apply({ [key]: e.target.value || null })} style={{ ...select, color: colors[detail?.[key]] || CARD.textPrimary }}>
                {key !== 'relationship_stage' && <option value="">—</option>}
                {opts.map(o => <option key={o} value={o}>{label(o)}</option>)}
              </select>
            ) : <span style={pill(colors[detail?.[key]] || CARD.textMuted)}>{label(detail?.[key] || '—')}</span>}
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ ...mono, fontSize: 9, color: CARD.textSubtle, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Next action</div>
        {canEdit ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input value={nextAction} onChange={e => setNextAction(e.target.value)} placeholder="e.g. Send outreach DM" style={input} disabled={saving} />
            <button onClick={() => apply({ next_action: nextAction.trim() || null })} disabled={saving} style={{ ...mono, fontSize: 11, padding: "0 12px", background: "transparent", border: `1px solid ${CARD.border}`, borderRadius: RADIUS.md, color: CARD.textMuted, cursor: "pointer" }}>Save</button>
          </div>
        ) : <p style={{ ...mono, fontSize: 12, color: CARD.textPrimary, margin: 0 }}>{detail?.next_action || '—'}</p>}
      </div>
      {(detail?.relationship_stage === 'declined' || detail?.relationship_stage === 'do_not_contact') && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ ...mono, fontSize: 9, color: CARD.textSubtle, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Decline reason</div>
          {canEdit ? (
            <div style={{ display: "flex", gap: 6 }}>
              <input value={declineReason} onChange={e => setDeclineReason(e.target.value)} placeholder="Why this didn't work out" style={input} disabled={saving} />
              <button onClick={() => apply({ decline_reason: declineReason.trim() || null })} disabled={saving} style={{ ...mono, fontSize: 11, padding: "0 12px", background: "transparent", border: `1px solid ${CARD.border}`, borderRadius: RADIUS.md, color: CARD.textMuted, cursor: "pointer" }}>Save</button>
            </div>
          ) : <p style={{ ...mono, fontSize: 12, color: CARD.textPrimary, margin: 0 }}>{detail?.decline_reason || '—'}</p>}
        </div>
      )}
      <div>
        <div style={{ ...mono, fontSize: 9, color: CARD.textSubtle, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Tags</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {tags.map(t => <span key={t} style={pill(KIND.influencer.accent)}>{t}{canEdit && <button onClick={() => apply({ tags: tags.filter(x => x !== t) })} disabled={saving} style={{ background: "transparent", border: "none", color: KIND.influencer.accent, cursor: "pointer", marginLeft: 6, padding: 0, fontSize: 11 }}>✕</button>}</span>)}
          {canEdit && <input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && tagInput.trim()) { apply({ tags: [...tags, tagInput.trim()] }); setTagInput(''); } }} placeholder="+ tag" style={{ ...input, width: 100, padding: "3px 8px", fontSize: 11 }} disabled={saving} />}
          {!tags.length && !canEdit && <span style={{ ...mono, fontSize: 11, color: CARD.textMuted }}>—</span>}
        </div>
      </div>
    </>
  );
}

// Section 15's influencer Intelligence module — Creator + Fit + Relationship,
// restyled to design tokens. Internals ported unchanged from the old
// InfluencerCard.js sub-components (relocated during account-card-unification
// -and-outreach-v1, restyled here during -full-redesign-v2).
export default function CreatorFitRelationship({ acc, business, detail, userEmail, canEdit, onAssessed, onUpdated }) {
  return (
    <div>
      <div>
        <p style={SH}>Creator</p>
        <p style={{ ...mono, fontSize: 12, color: CARD.textSecondary, lineHeight: 1.6, margin: "6px 0" }}>{detail?.niche_assessment?.audience_read || '—'}</p>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span style={{ ...mono, fontSize: 11, color: CARD.textMuted }}><b style={{ color: CARD.textSubtle }}>Category:</b> {detail?.niche_assessment?.category || '—'}</span>
          <span style={{ ...mono, fontSize: 11, color: CARD.textMuted }}><b style={{ color: CARD.textSubtle }}>Content:</b> {detail?.niche_assessment?.content_type || '—'}</span>
        </div>
        <AssessBioForm business={business} acc={acc} detail={detail} onAssessed={onAssessed} />
      </div>
      <div style={{ marginTop: 16 }}>
        <p style={SH}>Fit</p>
        <div style={{ marginTop: 6 }}><FitSummary detail={detail} /></div>
      </div>
      <div style={{ marginTop: 16 }}>
        <p style={SH}>Relationship</p>
        <div style={{ marginTop: 6 }}><RelationshipFields acc={acc} detail={detail} userEmail={userEmail} canEdit={canEdit} onUpdated={onUpdated} /></div>
      </div>
    </div>
  );
}
