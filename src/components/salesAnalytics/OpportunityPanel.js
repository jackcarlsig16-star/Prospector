import OwnerPicker from './goals/OwnerPicker';
import { useState } from 'react';
import { SA, SA_TYPE, SA_SHAPE } from './theme';
import { STAGE_ENUM, STAGE_LABELS, ORG_TYPE_ENUM, ORG_TYPE_LABELS, compareStages } from './pipelineStages';
import OwnerPill from './OwnerPill';
import SidePanel from './SidePanel';
import CopyForClaude from './CopyForClaude';
import { savePayload } from './opportunityPayload';
import { CHANNELS, CHANNEL_LABEL, PRIORITIES, PRIORITY_WORD } from '../../constants/salesChannels';
import { priorityColor } from './palette';

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
const textStyle = { ...SA_TYPE.body, fontSize: 13, color: SA.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minHeight: 18 };

function Field({ label, children }) {
  return <div><span style={labelStyle}>{label}</span>{children}</div>;
}

// sales-pipeline-v1 Stage 3 - the full-field side panel ("clicking a row
// opens a side panel with every field"). Opportunity table itself only
// inline-edits 5 fields (stage/next_action/next_action_date/
// expected_close/probability per the SPEC); everything else lives here.
// `opportunity` null = create mode (an empty draft); otherwise edit mode.
// readOnly (pipeline-quick-panel-v1): a Viewer's look at the same fields as
// text, no Save / Archive.
export default function OpportunityPanel({ businessId, opportunity, saving, error, onSave, onArchive, onClose, readOnly = false, members = [] }) {
  const isCreate = !opportunity;
  const [draft, setDraft] = useState(() => ({
    organization: '', cohort: '', org_type: 'employer', covered_lives: '', stage: 'target',
    probability: '', est_value: '', owner: '', next_action: '', next_action_date: '',
    expected_close: '', expected_launch: '', decision_makers: '', champion: '', objections: '',
    competitors: '', needed_to_advance: '', notes: '', is_top: false, lost_reason: '',
    ...opportunity,
  }));

  const set = (field, value) => setDraft(d => ({ ...d, [field]: value }));
  // company-workflow-v1 W3: a new employer's owner person ('' = me; the server defaults to whoever adds it).
  const [ownerPick, setOwnerPick] = useState(null);

  // sales-ia-v2 L3: a stage behind the current one is confirmed here and
  // flagged; the server refuses it otherwise.
  const handleSave = () => {
    if (!draft.organization.trim()) return;
    const payload = savePayload(opportunity, draft);
    if (isCreate && ownerPick) payload.owner_user_id = ownerPick;
    if (payload.stage && opportunity && compareStages(opportunity.stage, payload.stage) === 'back') {
      if (!window.confirm(`Move ${draft.organization} back from ${STAGE_LABELS[opportunity.stage]} to ${STAGE_LABELS[payload.stage]}?`)) return;
      payload.allow_backward = true;
    }
    onSave(payload);
  };

  const text = v => <div style={textStyle}>{v || '—'}</div>;
  const title = readOnly ? 'Opportunity' : isCreate ? 'Add opportunity' : 'Edit opportunity';
  return (
    <SidePanel label={title} onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <p style={{ ...SA_TYPE.cardTitle, color: SA.text, margin: 0 }}>{title}</p>
          <OwnerPill row={opportunity} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!isCreate && businessId && <CopyForClaude businessId={businessId} type="employer" id={opportunity.id} />}
          <span onClick={onClose} style={{ cursor: 'pointer', color: SA.muted, fontSize: 18, lineHeight: 1 }}>×</span>
        </div>
      </div>

      {isCreate && !readOnly && members.length > 0 && <div style={{ marginTop: 8 }}><OwnerPicker members={members} value={ownerPick} onChange={setOwnerPick} /></div>}

      {TEXT_FIELDS.map(([key, label]) => (
        <Field key={key} label={label}>
          {readOnly ? text(draft[key]) : <input style={fieldStyle} value={draft[key] || ''} onChange={e => set(key, e.target.value)} />}
        </Field>
      ))}

      <Field label="Org type">
        {readOnly ? text(ORG_TYPE_LABELS[draft.org_type]) : (
          <select style={fieldStyle} value={draft.org_type} onChange={e => set('org_type', e.target.value)}>
            {ORG_TYPE_ENUM.map(v => <option key={v} value={v}>{ORG_TYPE_LABELS[v]}</option>)}
          </select>
        )}
      </Field>
      <Field label="Stage">
        {readOnly ? text(STAGE_LABELS[draft.stage]) : (
          <select style={fieldStyle} value={draft.stage} onChange={e => set('stage', e.target.value)}>
            {STAGE_ENUM.map(v => <option key={v} value={v}>{STAGE_LABELS[v]}</option>)}
          </select>
        )}
      </Field>
      {/* sales-ia-v2 P2/P3 - where it came from (Jack corrects it here) and its P1-P4. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Channel">
          {readOnly ? text(CHANNEL_LABEL[draft.channel]) : (
            <select style={fieldStyle} value={draft.channel || (isCreate ? 'manual' : 'unknown')} onChange={e => set('channel', e.target.value)}>
              {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
        </Field>
        <Field label="Priority">
          {readOnly ? text(draft.priority ? `P${draft.priority}` : '') : (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {draft.priority && <span className="ui-tag__dot" data-priority-dot aria-hidden="true" style={{ '--tag-color': priorityColor(draft.priority) }} />}
            <select style={fieldStyle} value={draft.priority ?? ''} onChange={e => set('priority', e.target.value)}>
              <option value="">—</option>
              {PRIORITIES.map(p => <option key={p} value={p}>P{p} · {PRIORITY_WORD[p]}</option>)}
            </select>
            </span>
          )}
        </Field>
      </div>
      {draft.stage === 'lost' && (
        <Field label="Lost reason">
          {readOnly ? text(draft.lost_reason) : <input style={fieldStyle} value={draft.lost_reason || ''} onChange={e => set('lost_reason', e.target.value)} />}
        </Field>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Covered lives">
          {readOnly ? text(draft.covered_lives) : <input type="number" style={fieldStyle} value={draft.covered_lives ?? ''} onChange={e => set('covered_lives', e.target.value)} />}
        </Field>
        <Field label={readOnly ? 'Probability' : 'Probability (0-1, blank = stage default)'}>
          {readOnly ? text(draft.probability) : <input type="number" step="0.01" min="0" max="1" style={fieldStyle} value={draft.probability ?? ''} onChange={e => set('probability', e.target.value)} />}
        </Field>
      </div>
      <Field label="Est. value ($)">
        {readOnly ? text(draft.est_value) : <input type="number" style={fieldStyle} value={draft.est_value ?? ''} onChange={e => set('est_value', e.target.value)} />}
      </Field>

      {DATE_FIELDS.map(([key, label]) => (
        <Field key={key} label={label}>
          {readOnly ? text(draft[key]) : <input type="date" style={fieldStyle} value={draft[key] || ''} onChange={e => set(key, e.target.value)} />}
        </Field>
      ))}

      {TEXTAREA_FIELDS.map(([key, label]) => (
        <Field key={key} label={label}>
          {readOnly ? text(draft[key]) : <textarea style={{ ...fieldStyle, minHeight: 56, resize: 'vertical', fontFamily: 'inherit' }} value={draft[key] || ''} onChange={e => set(key, e.target.value)} />}
        </Field>
      ))}

      {readOnly
        ? <Field label="Top opportunity">{text(draft.is_top ? 'Yes' : 'No')}</Field>
        : (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: SA.text, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!draft.is_top} onChange={e => set('is_top', e.target.checked)} />
            Top opportunity
          </label>
        )}

      {error && <div style={{ color: SA.bad, fontSize: 12 }}>⚠ {error}</div>}

      {readOnly && <p style={{ ...SA_TYPE.body, fontSize: 12, color: SA.muted, margin: 0 }}>You have view access, so this is read-only.</p>}
      {!readOnly && <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
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
      </div>}
    </SidePanel>
  );
}
