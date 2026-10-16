import { useState, useEffect } from 'react';
import { SA, SA_TYPE } from '../theme';
import { goalsApi } from './goalsApi';
import SidePanel from '../SidePanel';
import OwnerPill from '../OwnerPill';
import { statusLabel, statusColor, tierLabel } from './partners/PartnerCard';
import { eventText } from './partners/activityTimeline';
import { labelStyle, subStyle, inputStyle, Chip, Dot, Btn, ErrorNote } from './goalsUi';
import { nextStepFor, TOUCH_STATUSES } from '../../../constants/partnerPipeline';
import { boardStage } from '../../../constants/pipelineBoard';

// pipeline-quick-panel-v1 - act on a Pipeline board partner row without
// leaving the table: next step, a note, the one forward stage step, ★.
// `row` is the board row (GET goals/pipeline-board), not the full partner;
// every write patches it in place through onChange. Viewers get text only.
const RECENT = 3;
const when = at => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const textStyle = { ...SA_TYPE.body, fontSize: 13, color: SA.text, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

export default function PartnerQuickPanel({ businessId, row, canEdit, onChange, onStar, onClose, onOpenFull }) {
  const [nextStep, setNextStep] = useState(row.next_step || '');
  const [note, setNote] = useState('');
  const [events, setEvents] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [eventsError, setEventsError] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => { setNextStep(row.next_step || ''); }, [row.id, row.next_step]);
  useEffect(() => {
    let live = true;
    goalsApi.partnerEvents(businessId, { goal_id: row.id })
      .then(ev => { if (live) { setEvents(ev.filter(e => e.event === 'note' || e.event === 'touch').slice(0, RECENT)); setEventsError(''); } })
      .catch(e => live && setEventsError(e.message));
    return () => { live = false; };
  }, [businessId, row.id, version]);

  const run = async (what, fn) => {
    setBusy(what); setError('');
    try { await fn(); return true; } catch (e) { setError(e.message); return false; } finally { setBusy(''); }
  };
  const saveNextStep = () => {
    const value = nextStep.trim();
    if (value === (row.next_step || '')) return;
    return run('next', async () => { await goalsApi.updatePartner(businessId, row.id, { next_step: value || null }); onChange({ next_step: value || null }); });
  };
  const saveNote = async () => {
    if (!note.trim()) return;
    if (await run('note', () => goalsApi.partnerSignal(businessId, row.id, { type: 'note', note: note.trim() }))) { setNote(''); setVersion(v => v + 1); }
  };
  const next = row.stage === 'paused' ? null : nextStepFor(row.stage);
  const moveForward = () => run('stage', async () => {
    await goalsApi.partnerSignal(businessId, row.id, { type: 'status', to: next.to, expect: row.stage });
    const patch = boardStage('partner', { pipeline_status: next.to, category: row.category });
    if (TOUCH_STATUSES.includes(next.to)) patch.last_touch_at = new Date().toISOString();
    onChange(patch);
    setVersion(v => v + 1);
  });

  return (
    <SidePanel label={row.name} onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <p style={{ ...SA_TYPE.cardTitle, color: SA.text, margin: 0, overflowWrap: 'anywhere' }}>{row.name}</p>
          {row.category && <span style={{ ...subStyle, fontSize: 12 }}>{row.category.replace(/^\d+\.\s*/, '')}</span>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip><Dot color={statusColor(row.stage)} />{statusLabel(row.stage) || row.stage_label}</Chip>
            {row.tier && <Chip>{tierLabel(row.tier)}</Chip>}
            {row.owner && <Chip>{row.owner}</Chip>}
            <OwnerPill row={row} style={{ height: 24 }} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
          {canEdit
            ? <button type="button" aria-pressed={row.top} aria-label={`${row.top ? 'Unstar' : 'Star'} ${row.name}`} disabled={busy === 'star'} onClick={() => run('star', onStar)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 20, lineHeight: 1, color: row.top ? SA.warn : SA.faint }}>{row.top ? '★' : '☆'}</button>
            : <span aria-label={row.top ? 'Top' : undefined} style={{ fontSize: 20, lineHeight: 1, color: row.top ? SA.warn : SA.faint }}>{row.top ? '★' : '☆'}</span>}
          <button type="button" aria-label="Close panel" onClick={onClose} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: SA.muted, fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
      </div>

      <div>
        <label htmlFor="pqp-next-step" style={labelStyle}>Next step</label>
        {canEdit
          ? <input id="pqp-next-step" value={nextStep} disabled={busy === 'next'} onChange={e => setNextStep(e.target.value)} onBlur={saveNextStep}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveNextStep(); } if (e.key === 'Escape') { e.stopPropagation(); setNextStep(row.next_step || ''); } }}
            placeholder="e.g. Send the one-pager" style={{ ...inputStyle, width: '100%', marginTop: 4 }} />
          : <div style={{ ...textStyle, marginTop: 4 }}>{row.next_step || '—'}</div>}
      </div>

      {canEdit && (
        <div>
          <label htmlFor="pqp-note" style={labelStyle}>Add note</label>
          <textarea id="pqp-note" value={note} disabled={busy === 'note'} onChange={e => setNote(e.target.value)} placeholder="e.g. Called, left voicemail" rows={2}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveNote(); } }}
            style={{ ...inputStyle, width: '100%', height: 'auto', padding: '8px 12px', marginTop: 4, resize: 'vertical', fontFamily: 'inherit' }} />
          <Btn primary style={{ height: 36, marginTop: 6 }} disabled={!note.trim() || busy === 'note'} onClick={saveNote}>{busy === 'note' ? 'Saving…' : 'Save note'}</Btn>
        </div>
      )}

      <div>
        <span style={labelStyle}>Recent notes &amp; touches</span>
        {eventsError && <ErrorNote message={eventsError} />}
        {events && !events.length && <div style={{ ...subStyle, fontSize: 13, marginTop: 4 }}>Nothing yet.</div>}
        {events && events.length > 0 && (
          <ol aria-label="Recent notes and touches" style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {events.map(e => (
              <li key={e.id} style={{ display: 'flex', gap: 10, fontSize: 13, alignItems: 'baseline' }}>
                <span style={{ color: SA.muted, minWidth: 48, fontVariantNumeric: 'tabular-nums' }}>{when(e.at)}</span>
                <span style={{ ...textStyle, flex: 1, minWidth: 0 }}>{eventText(e)}{e.event === 'touch' && e.note && <span style={{ display: 'block', color: SA.soft, fontSize: 12 }}>{e.note}</span>}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div>
        <span style={labelStyle}>Stage</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
          <span style={textStyle}>{statusLabel(row.stage) || row.stage_label}</span>
          {canEdit && next && <Btn primary style={{ height: 36 }} disabled={busy === 'stage'} onClick={moveForward}>{busy === 'stage' ? 'Saving…' : `Next: ${next.label}`}</Btn>}
          {canEdit && !next && <span style={{ ...subStyle, fontSize: 12 }}>{row.stage === 'paused' ? 'Paused - resume in Partner workflow' : '✓ Live'}</span>}
        </div>
      </div>

      {error && <ErrorNote message={error} />}
      {!canEdit && <p style={{ ...SA_TYPE.body, fontSize: 12, color: SA.muted, margin: 0 }}>You have view access, so this is read-only.</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 8 }}>
        <Btn style={{ height: 40 }} onClick={onOpenFull}>Open full card →</Btn>
        <Btn style={{ height: 40, marginLeft: 'auto' }} onClick={onClose}>Close</Btn>
      </div>
    </SidePanel>
  );
}
