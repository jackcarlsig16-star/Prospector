import { useState, useEffect } from 'react';
import { SA, SA_SHAPE, saSans } from '../theme';
import { goalsApi } from '../goals/goalsApi';
import { labelStyle, Chip, ErrorNote } from '../goals/goalsUi';
import { copyBtnStyle } from '../CopyForClaude';
import { linkBtn } from './TaskRow';
import ScoutUpload, { matchText } from './ScoutUpload';
import VisitPullBar from './VisitPullBar';

// signals-v1 Stage 2 - outside signals waiting for a person (D1, D8): the
// Signal Scout rows (and, from Stage 4, website visits). Accept = ONE open
// to-do (+ a new target, a partner note or an employer notes line - the
// server decides from the match); Dismiss parks the company 7 days.
// Members act and upload; Viewers see the list only.
const actBtn = { ...copyBtnStyle, color: SA.text };
const SOURCE = { scout: 'Scout', web_visit: 'Website visit' };
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

function CopyLine({ text }) {
  const [done, setDone] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ } };
  return <button type="button" style={{ ...copyBtnStyle, height: 24 }} onClick={copy} aria-label="Copy the suggested first line">{done ? 'Copied' : 'Copy'}</button>;
}

export default function SignalsList({ businessId, signals, canEdit, onChanged, onOpenRecord }) {
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  // visitor-to-record-v1 V1 / V6: companies the visitor pull created on its own (signal accepted + auto) with Undo.
  const [autoCreated, setAutoCreated] = useState([]);
  useEffect(() => {
    let live = true;
    goalsApi.signals(businessId, 'accepted').then(rows => { if (live) setAutoCreated(rows.filter(r => r.auto)); }).catch(() => {});
    return () => { live = false; };
  }, [businessId, signals]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const run = async fn => { setError(''); try { await fn(); } catch (e) { setError(e.message); } };
  const accept = s => run(async () => {
    const r = await goalsApi.acceptSignal(businessId, s.id);
    onChanged();
    const where = r.via === 'new_target' ? ' · new target' : r.via === 'partner' ? ` · note on ${r.record.name}` : r.via === 'employer' ? ` · line added to ${r.record.name}` : '';
    setToast(`To-do added: ${r.todo.text} · due ${md(r.todo.due_date)}${where}`);
  });
  const dismiss = s => run(async () => {
    await goalsApi.dismissSignal(businessId, s.id);
    onChanged();
    setToast(`Dismissed for 7 days: ${s.company_name}`);
  });
  const applied = n => { setUploading(false); onChanged(); setToast(n ? `${n} new signal${n === 1 ? '' : 's'} to review` : '0 new'); };
  const createCompany = s => run(async () => {
    const r = await goalsApi.autoCreateSignal(businessId, s.id);
    onChanged();
    setToast(`Created ${r.record.name} as an employer target${r.people ? ` · ${r.people} ${r.people === 1 ? 'person' : 'people'} found via Apollo` : ''}`);
  });
  const undoAuto = s => run(async () => {
    const r = await goalsApi.undoSignal(businessId, s.id);
    onChanged();
    setToast(`Undone: ${s.company_name} archived${r.archived?.people ? ` with ${r.archived.people} ${r.archived.people === 1 ? 'person' : 'people'}` : ''} · signal back to review`);
  });

  return (
    <section aria-label="Signals" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...labelStyle, color: SA.soft }}>Signals · {signals.length} new</span>
        <span style={{ flex: 1 }} />
        {canEdit && !uploading && <button type="button" onClick={() => setUploading(true)} style={{ ...linkBtn, fontSize: 12, fontWeight: 600 }}>Upload Scout file</button>}
      </div>
      <VisitPullBar businessId={businessId} canEdit={canEdit} onPulled={onChanged} />
      {uploading && <ScoutUpload businessId={businessId} onApplied={applied} onClose={() => setUploading(false)} />}
      {error && <ErrorNote message={error} />}
      {!signals.length && <p style={{ fontSize: 14, color: SA.muted, margin: '8px 0' }}>No signals to review.{canEdit ? ' Upload this week’s Signal Scout file to add some.' : ''}</p>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {signals.map(s => (
          <li key={s.id} data-signal-id={s.id} style={{ borderTop: `1px solid ${SA.track}`, padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: SA.text, overflowWrap: 'anywhere' }}>{s.company_name}</span>
              <Chip>{s.kind}{s.kind_guessed ? ' · kind guessed' : ''}</Chip>
              {s.score != null && <Chip title="Scout score">★ {s.score}</Chip>}
              {s.upside_joint && <Chip>Upside joint</Chip>}
              <span style={{ fontSize: 11, color: SA.muted }}>{SOURCE[s.source] || s.source}</span>
            </div>
            {s.who && <span style={{ fontSize: 12, color: SA.soft, overflowWrap: 'anywhere' }}>{s.who}</span>}
            {s.signal && <span style={{ fontSize: 13, color: SA.text, overflowWrap: 'anywhere' }}>{s.signal}</span>}
            {s.why_now && <span style={{ fontSize: 12, color: SA.muted, overflowWrap: 'anywhere' }}>Why now: {s.why_now}</span>}
            {s.first_line && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: SA.soft, fontStyle: 'italic', overflowWrap: 'anywhere' }}>“{s.first_line}”</span>
                <CopyLine text={s.first_line} />
              </div>
            )}
            {s.match && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12, color: SA.text, padding: '6px 10px', borderRadius: SA_SHAPE.radiusInner, background: SA.surface2, border: `1px solid ${SA.border}` }}>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{matchText(s.match)}</span>
                {onOpenRecord && <button type="button" style={{ ...linkBtn, fontWeight: 600, fontSize: 12 }} onClick={() => onOpenRecord(s.match)}>Open</button>}
              </div>
            )}
            {canEdit && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" style={actBtn} onClick={() => accept(s)}>Accept → to-do</button>
                {s.source === 'web_visit' && !s.match && <button type="button" style={actBtn} title="Create the company as an employer target now, with the people Apollo finds at its domain" onClick={() => createCompany(s)}>Create company</button>}
                <button type="button" style={{ ...actBtn, color: SA.muted }} onClick={() => dismiss(s)}>Dismiss · 7 d</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {autoCreated.length > 0 && (
        <section aria-label="Auto-created" data-auto-created style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          <span style={{ ...labelStyle, color: SA.soft }}>Auto-created from website visits · {autoCreated.length}</span>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {autoCreated.map(s => (
              <li key={s.id} data-signal-id={s.id} style={{ borderTop: `1px solid ${SA.track}`, padding: '8px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: SA.text, overflowWrap: 'anywhere' }}>{s.company_name}</span>
                <Chip color={SA.good}>Auto-created</Chip>
                <span style={{ fontSize: 12, color: SA.muted }}>{s.decided_at ? md(s.decided_at.slice(0, 10)) : ''}</span>
                <span style={{ flex: 1 }} />
                {onOpenRecord && s.match && <button type="button" style={{ ...linkBtn, fontWeight: 600, fontSize: 12 }} onClick={() => onOpenRecord(s.match)}>Open</button>}
                {canEdit && <button type="button" style={{ ...actBtn, color: SA.muted }} title="Archives the company and its people (nothing is deleted) and puts the signal back to review" onClick={() => undoAuto(s)}>Undo</button>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {toast && (
        <div role="status" style={{ ...saSans, padding: '10px 12px', borderRadius: SA_SHAPE.radiusInner, background: SA.surface2, border: `1px solid ${SA.border}`, fontSize: 13, overflowWrap: 'anywhere' }}>{toast}</div>
      )}
    </section>
  );
}
