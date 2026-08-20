import { useState, useRef } from 'react';
import { C, mono } from '../../constants/colors';
import { ROLE } from '../accountCard/tokens';

const sectionLabel = { ...mono, fontSize:12, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 };
const inp = { fontSize:12, padding:"7px 10px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", resize:"vertical", ...mono };
const btn = { ...mono, fontSize:11, padding:"6px 14px", background:C.gold, border:`1px solid ${C.gold}`, color:C.bg, fontWeight:700, borderRadius:6, cursor:"pointer" };
const btnGhost = { ...mono, fontSize:11, padding:"6px 14px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.mut, cursor:"pointer" };

// intake-field-extraction-and-bulk-split-v1 Stage 3/4/5 — shared by
// ProjectGuidanceCard and CampaignGuidanceCard (built shared from the
// start, same discipline as OutreachExamplesEditor, since both callers
// exist in the same SPEC). Extraction runs via the async fire-and-
// forget-then-poll pattern (beginFieldExtractionSync/
// runFieldExtractionSync, api/businesses/shared.js) - this component
// owns the polling, mirroring SmartIntakeBox.js's pollSyncStatus
// (3s interval, 40 attempts ~ 2min headroom) exactly, confirmed as the
// real client precedent before writing this.
//
// Decision #1 (locked): extraction NEVER writes a field directly. It
// only populates entity.field_extraction_result (a staging column) for
// this panel to diff against the current draft; onAcceptField pulls one
// field's extracted value into the draft, same as if the person had
// typed it - the existing Save button on the parent card is still what
// actually persists it. Decision #2: on failure, rawText stays exactly
// as typed, nothing is auto-filed.
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 40;

export default function FieldExtractionPanel({ entity, apiBase, fields, getEntity, draft, onAcceptField, onEntityUpdated, scopeLabel = 'project' }) {
  const [open, setOpen] = useState(false);
  const [rawText, setRawText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState('');
  const [dismissedResult, setDismissedResult] = useState(false);
  const cancelledRef = useRef(false);

  const extractionResult = !dismissedResult && entity.field_extraction_status === 'ready' ? entity.field_extraction_result : null;
  const extractionFailed = entity.field_extraction_status === 'error';
  // project-guidance-textarea-and-callout-polish-v1 — the callout used the
  // same yellow/warning border whether real differing values were found or
  // the result was a genuine no-op (confirmed live via screenshot: reads as
  // more alarming than it needs to). Dismiss stays the same either way.
  const isNoOp = extractionResult && fields.every(f => !extractionResult[f.key] || extractionResult[f.key] === draft[f.key]);

  const pollStatus = async () => {
    cancelledRef.current = false;
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      if (cancelledRef.current) return;
      const updated = await getEntity(entity.id);
      if (updated?.field_extraction_status && updated.field_extraction_status !== 'syncing') {
        onEntityUpdated(updated);
        return;
      }
    }
    setError('Extraction is taking longer than expected — check back shortly.');
  };

  const startExtraction = async () => {
    if (!rawText.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    setDismissedResult(false);
    try {
      const res = await fetch(`${apiBase}/extract-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start extraction');
      setSubmitting(false);
      setPolling(true);
      await pollStatus();
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    } finally {
      setPolling(false);
    }
  };

  const acceptField = (key) => {
    onAcceptField(key, extractionResult[key]);
  };

  return (
    <div style={{ marginBottom:8 }}>
      {!open && (
        // project-guidance-textarea-and-callout-polish-v1 — reuses the same
        // accent as Generate Outreach (AccountCard.js), not a new color.
        <button onClick={()=>setOpen(true)} style={{ ...mono, fontSize:11, padding:"4px 10px", background:`${ROLE.generateAccent}16`, border:`1px solid ${ROLE.generateAccent}`, color:ROLE.generateAccent, borderRadius:6, cursor:"pointer" }}>⇱ Paste deck or notes to auto-fill</button>
      )}
      {open && (
        <div style={{ background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, padding:10, marginBottom:8 }}>
          <div style={sectionLabel}>Paste deck or notes to auto-fill — fields are shown for review, nothing is overwritten automatically</div>
          <textarea rows={8} value={rawText} onChange={e=>setRawText(e.target.value)} style={{ ...inp, marginBottom:8 }}
            placeholder={`Paste a deck's text, notes, or a brief describing this ${scopeLabel}…`} />
          {error && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:8 }}>⚠ {error}</div>}
          {extractionFailed && !error && (
            <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:8 }}>⚠ Couldn't extract fields from this text — edit fields manually below, or try again. {entity.field_extraction_error ? `(${entity.field_extraction_error})` : ''}</div>
          )}
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={startExtraction} disabled={!rawText.trim() || submitting || polling} style={{ ...btn, opacity: rawText.trim() ? 1 : 0.5 }}>
              {submitting ? 'Starting…' : polling ? 'Extracting…' : 'Extract & Auto-Fill'}
            </button>
            <button onClick={()=>{ setOpen(false); cancelledRef.current = true; setPolling(false); setError(''); }} style={btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {extractionResult && (
        <div style={{ background:C.bg, border:`1px solid ${isNoOp ? C.brd : C.gold + '66'}`, borderRadius:6, padding:10, marginBottom:8 }}>
          <div style={{ ...sectionLabel, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span>Extracted — review each field</span>
            <button onClick={()=>setDismissedResult(true)} style={{ ...mono, fontSize:10, color:C.dim, background:"transparent", border:"none", cursor:"pointer" }}>✕ Dismiss</button>
          </div>
          {fields.map(f => {
            const extracted = extractionResult[f.key];
            const current = draft[f.key];
            if (!extracted || extracted === current) return null;
            return (
              <div key={f.key} style={{ marginBottom:10, paddingBottom:10, borderBottom:`1px solid ${C.brd}` }}>
                <div style={{ ...mono, fontSize:11, color:C.txt, fontWeight:600, marginBottom:4 }}>{f.label}</div>
                {current && <p style={{ ...mono, fontSize:11, color:C.dim, margin:"0 0 4px", whiteSpace:"pre-wrap" }}>Current: {current}</p>}
                <p style={{ ...mono, fontSize:12, color:C.txt, margin:"0 0 6px", whiteSpace:"pre-wrap" }}>Extracted: {extracted}</p>
                <button onClick={()=>acceptField(f.key)} style={{ ...mono, fontSize:10, padding:"4px 10px", background:C.gold, border:`1px solid ${C.gold}`, color:C.bg, fontWeight:700, borderRadius:5, cursor:"pointer" }}>Accept</button>
              </div>
            );
          })}
          {isNoOp && (
            <p style={{ ...mono, fontSize:11, color:C.dim, margin:0 }}>Nothing new found that differs from the current fields.</p>
          )}
        </div>
      )}
    </div>
  );
}
