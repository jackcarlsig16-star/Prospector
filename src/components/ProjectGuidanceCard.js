import { useState, useEffect } from 'react';
import { C, mono } from '../constants/colors';
import { updateProjectGuidance, getVoiceProfileForEmail } from '../utils/db';
import OutreachExamplesEditor from './shared/OutreachExamplesEditor';

const fmtDate = iso => { try { return new Date(iso).toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }); } catch { return "—"; } };

const FIELD_LABELS = [
  { key: 'objective', label: 'Objective', required: true, placeholder: "What this project is trying to accomplish…" },
  { key: 'target_type', label: 'Target type', placeholder: "Who this project is reaching…" },
  { key: 'ask_type', label: 'Ask / offer / CTA', placeholder: "What the outreach is asking for…" },
  { key: 'project_hook', label: 'Hook', placeholder: "An opening angle specific to this project…" },
  { key: 'exclusions', label: 'Exclusions', placeholder: "Anything outreach for this project should avoid…" },
];

const sectionLabel = { ...mono, fontSize:12, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 };
const inp = { fontSize:12, padding:"7px 10px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", resize:"vertical", ...mono };
const btn = { ...mono, fontSize:11, padding:"6px 14px", background:C.gold, border:`1px solid ${C.gold}`, color:C.bg, fontWeight:700, borderRadius:6, cursor:"pointer" };

// project-guidance-and-creation-flow-v1 — mirrors AssayCriteriaCard's shell
// (structured fields, timestamp, Save) but no generate/regenerate: these are
// direct inputs the person types, not something an LLM distills, so there's
// nothing to protect a manual edit against.
//
// project-scoped-outreach-examples-v1 — added a real multi-example list
// (outreach_examples, up to 20, saved with the rest of this card's fields)
// plus a separate distill-and-cache action (outreach_examples_distilled),
// replacing the old single outreach_example textarea. Distinct from
// voiceExamples (per-AE, unrelated) - do not conflate the two.
//
// campaign-layer-v1 — the examples/distillation block below is now
// OutreachExamplesEditor (shared/OutreachExamplesEditor.js), reused as-is
// by CampaignGuidanceCard scoped to campaign_id instead of project_id.
export default function ProjectGuidanceCard({ project, businessName, userEmail, outreachRules, onUpdated }) {
  const [voiceProfile, setVoiceProfile] = useState(null);
  const [draft, setDraft] = useState({
    objective: project.objective || '', target_type: project.target_type || '', ask_type: project.ask_type || '',
    project_hook: project.project_hook || '', exclusions: project.exclusions || '',
    outreach_examples: project.outreach_examples || [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { getVoiceProfileForEmail(userEmail).then(setVoiceProfile); }, [userEmail]);

  const save = async () => {
    if (!draft.objective.trim() || saving) return;
    setSaving(true);
    setError('');
    const { project: updated, error: err } = await updateProjectGuidance(project.id, draft);
    setSaving(false);
    if (err) { setError(err); return; }
    onUpdated(updated);
    return updated;
  };

  return (
    <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${C.brd}` }}>
      <div style={{ background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, padding:"8px 10px", marginBottom:10 }}>
        <div style={{ ...mono, fontSize:9, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Inherited from {businessName}</div>
        <div style={{ ...mono, fontSize:11, color:C.mut }}>
          Voice: {voiceProfile ? `${voiceProfile.tone || 'learned'} tone, ${(voiceProfile.keyTraits||[]).length} traits` : 'not set'}
        </div>
        <div style={{ ...mono, fontSize:11, color:C.mut }}>
          Outreach rules: {outreachRules?.tone || 'not set'}
        </div>
      </div>

      {FIELD_LABELS.map(f => (
        <div key={f.key} style={{ marginBottom:8 }}>
          <div style={sectionLabel}>{f.label}{f.required && ' *'}</div>
          <textarea rows={2} value={draft[f.key]} onChange={e=>setDraft(d=>({ ...d, [f.key]: e.target.value }))} placeholder={f.placeholder} style={inp} />
        </div>
      ))}

      <OutreachExamplesEditor
        examples={draft.outreach_examples}
        onExamplesChange={next => setDraft(d => ({ ...d, outreach_examples: next }))}
        entity={project}
        apiBase={`/api/projects/${project.id}`}
        onPersist={save}
        onUpdated={onUpdated}
        scopeLabel="project"
      />

      {error && <div style={{ ...mono, fontSize:11, color:C.red, margin:"8px 0" }}>⚠ {error}</div>}
      <div style={{ display:"flex", alignItems:"center", gap:10, margin:"8px 0 0" }}>
        <button onClick={save} disabled={saving || !draft.objective.trim()} style={{ ...btn, opacity: draft.objective.trim() ? 1 : 0.5 }}>{saving ? 'Saving…' : 'Save'}</button>
        {project.guidance_updated_at && <span style={{ ...mono, fontSize:10, color:C.dim }}>Updated {fmtDate(project.guidance_updated_at)}</span>}
      </div>
    </div>
  );
}
