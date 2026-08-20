import { useState } from 'react';
import { C, mono } from '../constants/colors';
import { updateCampaign, getCampaign } from '../utils/db';
import OutreachExamplesEditor from './shared/OutreachExamplesEditor';
import FieldExtractionPanel from './shared/FieldExtractionPanel';

const fmtDate = iso => { try { return new Date(iso).toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }); } catch { return "—"; } };

const FIELD_LABELS = [
  { key: 'recipient_description', label: 'Recipient description', rows: 3, placeholder: "Who this campaign targets — a specific pitch angle to a specific type of recipient…" },
  { key: 'doctrine', label: 'Doctrine', rows: 8, placeholder: "What should drive messaging for this recipient — paste a deck's text, key talking points, anything specific to this pitch…" },
];

const sectionLabel = { ...mono, fontSize:12, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 };
// project-guidance-textarea-and-callout-polish-v1 — same fix as
// ProjectGuidanceCard.js: fixed rows (2/3/8 here) clipped long content.
const inp = { fontSize:12, padding:"7px 10px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", resize:"vertical", fieldSizing:"content", ...mono };
const btn = { ...mono, fontSize:11, padding:"6px 14px", background:C.gold, border:`1px solid ${C.gold}`, color:C.bg, fontWeight:700, borderRadius:6, cursor:"pointer" };

// campaign-layer-v1 — mirrors ProjectGuidanceCard's shell (structured
// fields, timestamp, Save; reuses OutreachExamplesEditor for the same
// manual-add + bulk-paste-and-segment + distill-and-cache mechanism,
// scoped to campaign_id instead of project_id, per decision #4). Name is
// set at creation only, not editable here — same precedent as Project's
// own name.
export default function CampaignGuidanceCard({ campaign, onUpdated }) {
  const [draft, setDraft] = useState({
    recipient_description: campaign.recipient_description || '', doctrine: campaign.doctrine || '',
    outreach_examples: campaign.outreach_examples || [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    const { campaign: updated, error: err } = await updateCampaign(campaign.id, draft);
    setSaving(false);
    if (err) { setError(err); return; }
    onUpdated(updated);
    return updated;
  };

  return (
    <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${C.brd}` }}>
      <FieldExtractionPanel
        entity={campaign}
        apiBase={`/api/campaigns/${campaign.id}`}
        fields={FIELD_LABELS}
        getEntity={getCampaign}
        draft={draft}
        onAcceptField={(key, value) => setDraft(d => ({ ...d, [key]: value }))}
        onEntityUpdated={onUpdated}
        scopeLabel="campaign"
      />

      {FIELD_LABELS.map(f => (
        <div key={f.key} style={{ marginBottom:8 }}>
          <div style={sectionLabel}>{f.label}</div>
          <textarea rows={f.rows} value={draft[f.key]} onChange={e=>setDraft(d=>({ ...d, [f.key]: e.target.value }))} placeholder={f.placeholder} style={inp} />
        </div>
      ))}

      <OutreachExamplesEditor
        examples={draft.outreach_examples}
        onExamplesChange={next => setDraft(d => ({ ...d, outreach_examples: next }))}
        entity={campaign}
        apiBase={`/api/campaigns/${campaign.id}`}
        onPersist={save}
        onUpdated={onUpdated}
        scopeLabel="campaign"
      />

      {error && <div style={{ ...mono, fontSize:11, color:C.red, margin:"8px 0" }}>⚠ {error}</div>}
      <div style={{ display:"flex", alignItems:"center", gap:10, margin:"8px 0 0" }}>
        <button onClick={save} disabled={saving} style={btn}>{saving ? 'Saving…' : 'Save'}</button>
        {campaign.updated_at && <span style={{ ...mono, fontSize:10, color:C.dim }}>Updated {fmtDate(campaign.updated_at)}</span>}
      </div>
    </div>
  );
}
