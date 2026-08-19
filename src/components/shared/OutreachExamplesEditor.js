import { useState } from 'react';
import { C, mono } from '../../constants/colors';

const MAX_EXAMPLES = 20;

// addendum point 3 - cheap, explainable normalize-and-exact-match, not a
// fuzzy-matching library. Catches true duplicates, whitespace/casing
// reposts, and the most common real "near-exact variant" - the same
// templated message re-sent to a different recipient with only the
// greeting name changed (live-verified against a real segmented paste:
// "Hi Sarah," / "Hi Marcus," followed by identical bodies) - by dropping
// the leading greeting line before comparing.
const normalizeForDedup = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/^(hi|hey|hello)\s+[a-z][\w'-]*,?\s*/i, '');

const fmtDate = iso => { try { return new Date(iso).toLocaleString("en-US", { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }); } catch { return "—"; } };

const sectionLabel = { ...mono, fontSize:12, color:C.dim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 };
const inp = { fontSize:12, padding:"7px 10px", background:C.bg, border:`1.5px solid ${C.brdM}`, borderRadius:6, color:C.txt, outline:"none", width:"100%", boxSizing:"border-box", resize:"vertical", ...mono };
const btn = { ...mono, fontSize:11, padding:"6px 14px", background:C.gold, border:`1px solid ${C.gold}`, color:C.bg, fontWeight:700, borderRadius:6, cursor:"pointer" };
const btnGhost = { ...mono, fontSize:11, padding:"6px 14px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:6, color:C.mut, cursor:"pointer" };
const iconBtn = { ...mono, fontSize:11, padding:"2px 6px", background:"transparent", border:`1px solid ${C.brd}`, borderRadius:4, color:C.mut, cursor:"pointer" };

// campaign-layer-v1 — extracted from ProjectGuidanceCard.js (previously
// inline there, project_scoped_outreach_examples_v1) so campaigns can reuse
// the exact same manual-add + bulk-paste-and-segment + distill-and-cache UI
// without a second copy (spec decision #4). `apiBase` picks the real
// server routes (/api/projects/:id/... or /api/campaigns/:id/...) — both
// mirror each other 1:1 (see api/campaigns/outreach-examples-*.js). The
// caller owns the `examples` draft array (so it can be saved together with
// its own other fields, exactly as ProjectGuidanceCard's `save` already
// does) and supplies `onPersist`, an async function with the same
// semantics as that `save` — examples must be persisted before distilling
// since the server re-reads from the row rather than trusting a
// client-held copy.
export default function OutreachExamplesEditor({ examples, onExamplesChange, entity, apiBase, onPersist, onUpdated, scopeLabel = 'project' }) {
  const [newExample, setNewExample] = useState('');

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [segmenting, setSegmenting] = useState(false);
  const [segmentError, setSegmentError] = useState('');
  // addendum point 1 - segmentation failure (0 found, or the call itself
  // fails) never discards the paste: segmentError + bulkText staying set
  // together is what surfaces the "add whole paste as one example" escape
  // hatch in the render below, until the person clears or retries it.
  const [reviewCandidates, setReviewCandidates] = useState(null); // [{text, include, dup}] | null

  const [distilling, setDistilling] = useState(false);
  const [distillError, setDistillError] = useState('');
  const [editingDistilled, setEditingDistilled] = useState(false);
  const [distilledDraft, setDistilledDraft] = useState(entity.outreach_examples_distilled || '');

  const addExample = () => {
    if (!newExample.trim() || examples.length >= MAX_EXAMPLES) return;
    onExamplesChange([...examples, newExample.trim()]);
    setNewExample('');
  };
  const removeExample = i => onExamplesChange(examples.filter((_, idx) => idx !== i));
  const moveExample = (i, dir) => {
    const next = [...examples];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onExamplesChange(next);
  };

  const runSegment = async () => {
    if (!bulkText.trim() || segmenting) return;
    setSegmenting(true);
    setSegmentError('');
    try {
      const res = await fetch(`${apiBase}/outreach-examples/segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pastedText: bulkText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to segment paste');
      if (!data.examples || data.examples.length === 0) {
        // addendum point 1 - found nothing splittable, not an error; the
        // "add whole paste as one example" fallback below covers this.
        setSegmentError("Couldn't find clear separate examples in this paste.");
        return;
      }
      // addendum point 3 - flag duplicates (within this batch, and against
      // the existing list) rather than silently storing them; pre-
      // unchecked, not pre-excluded, so a real near-duplicate the person
      // actually wants can still be included with one click.
      const existingNorm = examples.map(normalizeForDedup);
      const seenInBatch = new Set();
      const candidates = data.examples.map(text => {
        const norm = normalizeForDedup(text);
        const dupExisting = existingNorm.includes(norm);
        const dupInBatch = seenInBatch.has(norm);
        seenInBatch.add(norm);
        const dup = dupExisting || dupInBatch;
        return { text, dup, dupReason: dupExisting ? `already in this ${scopeLabel}` : (dupInBatch ? 'duplicate within this paste' : null), include: !dup };
      });
      setReviewCandidates(candidates);
    } catch (e) {
      setSegmentError(e.message);
    } finally {
      setSegmenting(false);
    }
  };

  const confirmReview = () => {
    const toAdd = reviewCandidates.filter(c => c.include).map(c => c.text);
    onExamplesChange([...examples, ...toAdd].slice(0, MAX_EXAMPLES));
    setReviewCandidates(null);
    setBulkOpen(false);
    setBulkText('');
    setSegmentError('');
  };

  const addWholePasteAsOne = () => {
    if (!bulkText.trim() || examples.length >= MAX_EXAMPLES) return;
    onExamplesChange([...examples, bulkText.trim()]);
    setBulkOpen(false);
    setBulkText('');
    setSegmentError('');
    setReviewCandidates(null);
  };

  const distill = async () => {
    if (distilling || examples.length === 0) return;
    setDistilling(true);
    setDistillError('');
    try {
      const saved = await onPersist();
      if (!saved) { setDistilling(false); return; }
      const res = await fetch(`${apiBase}/outreach-examples/generate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to distill examples');
      const merged = { ...saved, outreach_examples_distilled: data.outreach_examples_distilled, outreach_examples_distilled_at: new Date().toISOString(), outreach_examples_distilled_edited_manually: false };
      onUpdated(merged);
      setDistilledDraft(data.outreach_examples_distilled || '');
    } catch (e) {
      setDistillError(e.message);
    } finally {
      setDistilling(false);
    }
  };

  const saveDistilledManually = async () => {
    setDistilling(true);
    setDistillError('');
    try {
      const res = await fetch(`${apiBase}/outreach-examples-distilled`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outreach_examples_distilled: distilledDraft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onUpdated({ ...entity, outreach_examples_distilled: data.outreach_examples_distilled, outreach_examples_distilled_at: new Date().toISOString(), outreach_examples_distilled_edited_manually: true });
      setEditingDistilled(false);
    } catch (e) {
      setDistillError(e.message);
    } finally {
      setDistilling(false);
    }
  };

  return (
    <>
      <div style={{ marginBottom:8 }}>
        <div style={sectionLabel}>Examples ({examples.length}/{MAX_EXAMPLES})</div>
        {examples.map((ex, i) => (
          <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:6, marginBottom:6 }}>
            <p style={{ ...mono, fontSize:11, color:C.txt, margin:0, flex:1, background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, padding:"6px 8px", whiteSpace:"pre-wrap" }}>{ex}</p>
            <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
              <button onClick={()=>moveExample(i,-1)} disabled={i===0} style={{ ...iconBtn, opacity:i===0?0.3:1 }}>↑</button>
              <button onClick={()=>moveExample(i,1)} disabled={i===examples.length-1} style={{ ...iconBtn, opacity:i===examples.length-1?0.3:1 }}>↓</button>
              <button onClick={()=>removeExample(i)} style={{ ...iconBtn, color:C.red }}>✕</button>
            </div>
          </div>
        ))}
        {examples.length < MAX_EXAMPLES && (
          <div style={{ display:"flex", gap:6, marginBottom:8 }}>
            <textarea rows={2} value={newExample} onChange={e=>setNewExample(e.target.value)}
              placeholder={`A real past sent/approved message for this ${scopeLabel}…`} style={{ ...inp, flex:1 }} />
            <button onClick={addExample} disabled={!newExample.trim()} style={{ ...btnGhost, opacity:newExample.trim()?1:0.5, alignSelf:"flex-start" }}>+ Add</button>
          </div>
        )}

        {!bulkOpen && !reviewCandidates && examples.length < MAX_EXAMPLES && (
          <button onClick={()=>setBulkOpen(true)} style={{ ...iconBtn, padding:"4px 10px" }}>⇱ Paste multiple examples</button>
        )}

        {bulkOpen && !reviewCandidates && (
          <div style={{ marginTop:8, background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, padding:10 }}>
            <div style={sectionLabel}>Paste multiple messages — they'll be split into individual examples</div>
            <textarea rows={8} value={bulkText} onChange={e=>setBulkText(e.target.value)} style={{ ...inp, marginBottom:8 }}
              placeholder="Paste several past sent/approved messages here, one after another…" />
            {segmentError && (
              <div style={{ marginBottom:8 }}>
                <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:6 }}>⚠ {segmentError}</div>
                <button onClick={addWholePasteAsOne} style={btnGhost}>Add whole paste as one example instead</button>
              </div>
            )}
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={runSegment} disabled={segmenting || !bulkText.trim()} style={{ ...btn, opacity: bulkText.trim() ? 1 : 0.5 }}>{segmenting ? 'Splitting…' : 'Split into examples'}</button>
              <button onClick={()=>{ setBulkOpen(false); setBulkText(''); setSegmentError(''); }} style={btnGhost}>Cancel</button>
            </div>
          </div>
        )}

        {reviewCandidates && (
          <div style={{ marginTop:8, background:C.bg, border:`1px solid ${C.brd}`, borderRadius:6, padding:10 }}>
            <div style={sectionLabel}>Review {reviewCandidates.length} found — duplicates unchecked by default</div>
            {reviewCandidates.map((c, i) => (
              <label key={i} style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:6, cursor:"pointer" }}>
                <input type="checkbox" checked={c.include} onChange={()=>setReviewCandidates(cs => cs.map((x,idx)=>idx===i?{...x,include:!x.include}:x))} style={{ marginTop:4 }} />
                <div style={{ flex:1 }}>
                  <p style={{ ...mono, fontSize:11, color:C.txt, margin:0, whiteSpace:"pre-wrap" }}>{c.text}</p>
                  {c.dup && <p style={{ ...mono, fontSize:10, color:C.gold, margin:"2px 0 0" }}>⚠ possible duplicate — {c.dupReason}</p>}
                </div>
              </label>
            ))}
            <div style={{ display:"flex", gap:8, marginTop:8 }}>
              <button onClick={confirmReview} disabled={!reviewCandidates.some(c=>c.include)} style={{ ...btn, opacity: reviewCandidates.some(c=>c.include) ? 1 : 0.5 }}>
                Add {reviewCandidates.filter(c=>c.include).length} selected
              </button>
              <button onClick={()=>{ setReviewCandidates(null); }} style={btnGhost}>Back</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ paddingTop:10, borderTop:`1px solid ${C.brd}` }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:8 }}>
          <div>
            <div style={sectionLabel}>Distilled example pattern</div>
            <p style={{ ...mono, fontSize:10, color:C.dim, margin:0 }}>
              {entity.outreach_examples_distilled
                ? `${entity.outreach_examples_distilled_edited_manually ? 'Manually edited' : 'Distilled from the examples above'}${entity.outreach_examples_distilled_at ? ` · last updated ${fmtDate(entity.outreach_examples_distilled_at)}` : ''}`
                : 'Not yet distilled — add examples above, then distill them into a cached pattern generation will actually use.'}
            </p>
          </div>
        </div>

        {editingDistilled ? (
          <div>
            <textarea rows={4} value={distilledDraft} onChange={e=>setDistilledDraft(e.target.value)} style={{ ...inp, marginBottom:8 }} />
            {distillError && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:8 }}>⚠ {distillError}</div>}
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={saveDistilledManually} disabled={distilling} style={btn}>{distilling ? 'Saving…' : 'Save'}</button>
              <button onClick={()=>{ setEditingDistilled(false); setDistilledDraft(entity.outreach_examples_distilled || ''); setDistillError(''); }} style={btnGhost}>Cancel</button>
            </div>
          </div>
        ) : (
          <div>
            {entity.outreach_examples_distilled && (
              <p style={{ ...mono, fontSize:12, color:C.txt, margin:"0 0 10px", lineHeight:1.6 }}>{entity.outreach_examples_distilled}</p>
            )}
            {distillError && <div style={{ ...mono, fontSize:11, color:C.red, marginBottom:8 }}>⚠ {distillError}</div>}
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={distill} disabled={distilling || examples.length===0} style={{ ...btnGhost, color:C.gold, borderColor:`${C.gold}66`, opacity: examples.length===0 ? 0.5 : 1 }}>
                {distilling ? 'Distilling…' : (entity.outreach_examples_distilled ? 'Redistill' : 'Distill examples')}
              </button>
              {entity.outreach_examples_distilled && <button onClick={()=>{ setDistilledDraft(entity.outreach_examples_distilled || ''); setEditingDistilled(true); }} style={btnGhost}>Edit manually</button>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
