import { useState } from 'react';
import { SA } from '../../theme';
import Button from '../../../../ui/Button';
import { ErrorNote } from '../goalsUi';
import { mergeFields, MERGE_HELP, SAMPLE_CONTACT } from './campaignModel';

// seif-campaign-v1 B2 - each track's steps: subject + body with merge fields
// and a live preview on a real contact of that track (or a sample). Members
// edit and save one step at a time; Viewers read.
const box = { border: `1px solid ${SA.border}`, borderRadius: 10, background: SA.surface, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 };
const preStyle = { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', fontSize: 13, color: SA.text };

function StepEditor({ step, sample, canEdit, onSave }) {
  const [subject, setSubject] = useState(step.subject);
  const [body, setBody] = useState(step.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const dirty = subject !== step.subject || body !== step.body;
  const save = async () => {
    setBusy(true); setError(''); setSaved(false);
    try { await onSave({ subject, body }); setSaved(true); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const id = `step-${step.id}`;
  return (
    <div data-step={step.step_no} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, borderTop: `1px solid ${SA.track}`, paddingTop: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <span className="ui-group-label">Step {step.step_no} · {step.day_offset ? `${step.day_offset} send days after step 1` : 'day 0'}</span>
        {canEdit ? <>
          <label htmlFor={`${id}-s`} style={{ fontSize: 12, color: SA.muted }}>Subject</label>
          <input id={`${id}-s`} className="ui-input" value={subject} maxLength={200} onChange={e => { setSubject(e.target.value); setSaved(false); }} />
          <label htmlFor={`${id}-b`} style={{ fontSize: 12, color: SA.muted }}>Body</label>
          <textarea id={`${id}-b`} className="ui-input" rows={7} value={body} maxLength={5000} onChange={e => { setBody(e.target.value); setSaved(false); }} style={{ resize: 'vertical' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button disabled={!dirty || busy} disabledReason="No changes to save" onClick={save}>{busy ? 'Saving…' : `Save step ${step.step_no}`}</Button>
            {saved && !dirty && <span role="status" style={{ fontSize: 12, color: SA.good }}>Saved</span>}
          </div>
          {error && <ErrorNote message={error} />}
        </> : <>
          <span style={{ fontSize: 13, color: SA.text, fontWeight: 600 }}>{step.subject || <span style={{ color: SA.muted, fontWeight: 400 }}>No subject yet</span>}</span>
          <pre style={preStyle}>{step.body || '—'}</pre>
        </>}
      </div>
      <div aria-label={`Step ${step.step_no} preview`} data-step-preview style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, background: SA.inset, borderRadius: 8, padding: 10 }}>
        <span className="ui-group-label">Preview · {sample.name}{sample.company ? `, ${sample.company}` : ''}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: SA.text, overflowWrap: 'anywhere' }}>{mergeFields(subject, sample) || <span style={{ color: SA.muted, fontWeight: 400 }}>No subject yet</span>}</span>
        <pre style={preStyle}>{mergeFields(body, sample) || '—'}</pre>
      </div>
    </div>
  );
}

export default function CampaignTemplates({ tracks, contacts, canEdit, onSaveStep }) {
  return (
    <section aria-label="Tracks and templates" data-campaign-templates style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 12, color: SA.muted }}>{MERGE_HELP} · steps go out Monday–Thursday; a reply, bounce, opt-out or “not interested” stops them.</span>
      {tracks.map(t => {
        const mine = contacts.filter(c => c.track_id === t.id);
        const sample = mine[0] || SAMPLE_CONTACT;
        return (
          <div key={t.id} data-track={t.id} style={box}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: SA.text }}>{t.name}</h3>
              <span style={{ fontSize: 12, color: SA.muted }}>{mine.length} contact{mine.length === 1 ? '' : 's'}</span>
            </div>
            {t.steps.map(st => <StepEditor key={`${st.id}:${st.updated_at || ''}`} step={st} sample={sample} canEdit={canEdit} onSave={patch => onSaveStep(st, patch)} />)}
          </div>
        );
      })}
    </section>
  );
}
