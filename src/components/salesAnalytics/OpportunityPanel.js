import { useState } from 'react';
import { SA, SA_TYPE, SA_SHAPE } from './theme';
import { STAGE_ENUM, STAGE_LABELS, ORG_TYPE_ENUM, ORG_TYPE_LABELS } from './pipelineStages';

const TEXT_FIELDS = [
  ['organization', 'Organization'], ['cohort', 'Cohort'], ['owner', 'Owner'],
  ['next_action', 'Next action'], ['champion', 'Champion'],
];
const TEXTAREA_FIELDS = [
  ['decision_makers', 'Decision makers'], ['objections', 'Objections'],
  ['competitors', 'Competitors'], ['needed_to_advance', 'Needed to advance'], ['notes', 'Notes'],
];
const DATE_FIELDS = [
  ['next_action_date', 'Next action date'], ['expected_close', 'Expected close'], ['expected_launch', 'Expected launch'],
];

const fieldStyle = { ...SA_TYPE.body, fontSize: 13, width: '100%', padding: '7px 9px', background: SA.ground, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, color: SA.text, boxSizing: 'border-box' };
const labelStyle = { ...SA_TYPE.label, fontSize: 10, color: SA.muted, display: 'block', marginBottom: 4 };

function Field({ label, children }) {
  return <div><span style={labelStyle}>{label}</span>{children}</div>;
}

// sales-pipeline-v1 Stage 3 - the full-field side panel ("clicking a row
// opens a side panel with every field"). Opportunity table itself only
// inline-edits 5 fields (stage/next_action/next_action_date/
// expected_close/probability per the SPEC); everything else lives here.
// `opportunity` null = create mode (an empty draft); otherwise edit mode.
export default function OpportunityPanel({ opportunity, saving, error, onSave, onArchive, onClose }) {
  const isCreate = !opportunity;
  const [draft, setDraft] = useState(() => ({
    organization: '', cohort: '', org_type: 'employer', covered_lives: '', stage: 'target',
    probability: '', est_value: '', owner: '', next_action: '', next_action_date: '',
    expected_close: '', expected_launch: '', decision_makers: '', champion: '', objections: '',
    competitors: '', needed_to_advance: '', notes: '', is_top: false, lost_reason: '',
    ...opportunity,
  }));

  const set = (field, value) => setDraft(d => ({ ...d, [field]: value }));

  const handleSave = () => {
    if (!draft.organization.trim()) return;
    const payload = {};
    for (const key of Object.keys(draft)) {
      if (['id', 'business_id', 'source', 'archived_at', 'created_at', 'updated_at'].includes(key)) continue;
      let v = draft[key];
      if (v === '') v = null;
      if (['covered_lives', 'probability', 'est_value'].includes(key) && v !== null) v = Number(v);
      payload[key] = v;
    }
    onSave(payload);
  };

  return (
    <div className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
      <div style={{ position: 'relative', width: 420, maxWidth: '100%', height: '100%', overflowY: 'auto', background: SA.surface, borderLeft: `1px solid ${SA.border}`, padding: 20, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ ...SA_TYPE.cardTitle, color: SA.text, margin: 0 }}>{isCreate ? 'Add opportunity' : 'Edit opportunity'}</p>
          <span onClick={onClose} style={{ cursor: 'pointer', color: SA.muted, fontSize: 18, lineHeight: 1 }}>×</span>
        </div>

        {TEXT_FIELDS.map(([key, label]) => (
          <Field key={key} label={label}>
            <input style={fieldStyle} value={draft[key] || ''} onChange={e => set(key, e.target.value)} />
          </Field>
        ))}

        <Field label="Org type">
          <select style={fieldStyle} value={draft.org_type} onChange={e => set('org_type', e.target.value)}>
            {ORG_TYPE_ENUM.map(v => <option key={v} value={v}>{ORG_TYPE_LABELS[v]}</option>)}
          </select>
        </Field>
        <Field label="Stage">
          <select style={fieldStyle} value={draft.stage} onChange={e => set('stage', e.target.value)}>
            {STAGE_ENUM.map(v => <option key={v} value={v}>{STAGE_LABELS[v]}</option>)}
          </select>
        </Field>
        {draft.stage === 'lost' && (
          <Field label="Lost reason">
            <input style={fieldStyle} value={draft.lost_reason || ''} onChange={e => set('lost_reason', e.target.value)} />
          </Field>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Covered lives">
            <input type="number" style={fieldStyle} value={draft.covered_lives ?? ''} onChange={e => set('covered_lives', e.target.value)} />
          </Field>
          <Field label="Probability (0-1, blank = stage default)">
            <input type="number" step="0.01" min="0" max="1" style={fieldStyle} value={draft.probability ?? ''} onChange={e => set('probability', e.target.value)} />
          </Field>
        </div>
        <Field label="Est. value ($)">
          <input type="number" style={fieldStyle} value={draft.est_value ?? ''} onChange={e => set('est_value', e.target.value)} />
        </Field>

        {DATE_FIELDS.map(([key, label]) => (
          <Field key={key} label={label}>
            <input type="date" style={fieldStyle} value={draft[key] || ''} onChange={e => set(key, e.target.value)} />
          </Field>
        ))}

        {TEXTAREA_FIELDS.map(([key, label]) => (
          <Field key={key} label={label}>
            <textarea style={{ ...fieldStyle, minHeight: 56, resize: 'vertical', fontFamily: 'inherit' }} value={draft[key] || ''} onChange={e => set(key, e.target.value)} />
          </Field>
        ))}

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SA.text, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!draft.is_top} onChange={e => set('is_top', e.target.checked)} />
          Top opportunity
        </label>

        {error && <div style={{ color: SA.bad, fontSize: 12 }}>⚠ {error}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={handleSave} disabled={saving || !draft.organization.trim()}
            style={{ ...SA_TYPE.body, fontSize: 13, fontWeight: 600, flex: 1, padding: '9px 0', background: SA.accent, color: SA.ground, border: 0, borderRadius: SA_SHAPE.radiusInner, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {!isCreate && (
            <button
              onClick={onArchive} disabled={saving}
              style={{ ...SA_TYPE.body, fontSize: 13, padding: '9px 14px', background: 'transparent', color: SA.bad, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusInner, cursor: saving ? 'default' : 'pointer' }}
            >
              Archive
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
