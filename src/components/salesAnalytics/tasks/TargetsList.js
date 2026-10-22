import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { SA, SA_SHAPE, saSans } from '../theme';
import { SEMANTIC } from '../palette';
import { goalsApi } from '../goals/goalsApi';
import { labelStyle, Chip, Dot, ErrorNote } from '../goals/goalsUi';
import OwnerPill from '../OwnerPill';
import CopyForClaude, { copyBtnStyle } from '../CopyForClaude';
import PromotePanel from './PromotePanel';
import { linkBtn } from './TaskRow';

// call-notes-targets-v1 Stage 2 - the targets Intake proposed, newest first:
// promote one to a partner or employer, mark it not a fit (its research
// to-do is dropped, undo for 10 s), or copy it for Claude. Promoted and
// not-a-fit rows are closed: hidden behind one toggle. Viewers see the list
// and may copy; the buttons are Member+. Lives in the Tasks drawer; the Today
// chip opens the same list.
const UNDO_MS = 10000;
export const OPEN_STATUSES = ['proposed', 'researching'];
export const openTargets = targets => targets.filter(t => OPEN_STATUSES.includes(t.status));
const STATUS = { proposed: ['Proposed', SA.neutral], researching: ['Researching', SA.accent], accepted: ['Promoted', SEMANTIC.healthy], rejected: ['Not a fit', SA.faint] };
const md = d => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const actBtn = { ...copyBtnStyle, color: SA.text };

// FIX loop-quickfixes Q8: the evidence line is one clipped line; "more" opens the whole of it in place (only shown
// when it is actually cut off). The list keeps one open at a time; Esc closes it.
function Evidence({ id, text, open, onToggle }) {
  const ref = useRef(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return undefined;
    const measure = () => setClipped(el.scrollWidth > el.clientWidth);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [text, open]);
  const one = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0 }}>
      <span ref={ref} id={`ev-${id}`} title={open ? undefined : text} style={{ fontSize: 12, color: SA.muted, minWidth: 0, ...(open ? { whiteSpace: 'normal', overflowWrap: 'anywhere' } : one) }}>“{text}”</span>
      {(clipped || open) && <button type="button" id={`ev-btn-${id}`} aria-expanded={open} aria-controls={`ev-${id}`} onClick={onToggle} style={{ ...linkBtn, fontSize: 12, flex: 'none' }}>{open ? 'less' : 'more'}</button>}
    </span>
  );
}

export default function TargetsList({ businessId, targets, canEdit, onChanged, onOpenRecord }) {
  const [showClosed, setShowClosed] = useState(false);
  const [panel, setPanel] = useState(null); // { id, to }
  const [categories, setCategories] = useState(null);
  const [toast, setToast] = useState(null); // { text, undo? }
  const [already, setAlready] = useState(null); // { targetId, type, id, name }
  const [error, setError] = useState('');
  const [openEvidence, setOpenEvidence] = useState(null); // one target id
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? UNDO_MS : 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const loadCategories = useCallback(() => goalsApi.partners(businessId)
    .then(ps => setCategories([...new Set(ps.map(p => p.category).filter(Boolean))].sort())).catch(() => setCategories([])), [businessId]);

  const run = async fn => { setError(''); try { await fn(); } catch (e) { setError(e.message); } };
  const promote = (t, body) => (async () => {
    const r = await goalsApi.promoteTarget(businessId, t.id, body);
    setPanel(null);
    if (r.already) { setAlready({ targetId: t.id, ...r.already }); return; }
    setAlready(null);
    setToast({ text: `${r.created.name} → ${r.created.type === 'partner' ? 'Partners (Not started)' : 'Pipeline (Target)'}${r.relinked ? ` · ${r.relinked} to-do${r.relinked === 1 ? '' : 's'} moved` : ''}` });
    onChanged();
  })();
  const reject = t => run(async () => {
    const r = await goalsApi.rejectTarget(businessId, t.id);
    onChanged();
    setToast({ text: `Not a fit: ${t.name}${r.dropped.length ? ` · ${r.dropped.length} to-do${r.dropped.length === 1 ? '' : 's'} dropped` : ''}`,
      undo: () => run(async () => { await goalsApi.rejectTarget(businessId, t.id, { undo: true, reopen: r.dropped }); onChanged(); }) });
  });

  const shown = targets.filter(t => showClosed || OPEN_STATUSES.includes(t.status));
  const closed = targets.length - openTargets(targets).length;
  const typeLabel = { partner: 'partner', opportunity: 'employer', target: 'target' };
  return (
    <section aria-label="Targets" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      onKeyDown={e => { if (e.key !== 'Escape' || !openEvidence) return; e.stopPropagation(); const id = openEvidence; setOpenEvidence(null); document.getElementById(`ev-btn-${id}`)?.focus(); }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...labelStyle, color: SA.soft }}>Targets · {openTargets(targets).length} open</span>
        <span style={{ flex: 1 }} />
        {closed > 0 && (
          <button type="button" aria-pressed={showClosed} onClick={() => setShowClosed(v => !v)} style={{ ...linkBtn, fontSize: 12, color: SA.soft }}>
            {showClosed ? 'Hide' : 'Show'} closed (promoted · not a fit) · {closed}
          </button>
        )}
      </div>
      {error && <ErrorNote message={error} />}
      {!shown.length && <p style={{ fontSize: 14, color: SA.muted, margin: '8px 0' }}>{closed ? 'No open targets.' : 'No targets yet. Paste notes that name a new company and tick it as a target.'}</p>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {shown.map(t => {
          const [label, color] = STATUS[t.status] || [t.status, SA.neutral];
          const open = OPEN_STATUSES.includes(t.status);
          return (
            <li key={t.id} data-target-id={t.id} style={{ borderTop: `1px solid ${SA.track}`, padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: t.status === 'rejected' ? SA.muted : SA.text, textDecoration: t.status === 'rejected' ? 'line-through' : 'none' }}>{t.name}</span>
                <Chip>{t.kind}</Chip>
                <Chip><Dot color={color} />{label}</Chip>
                {t.research_notes && <span title="Research notes on file" aria-label="Has research notes" style={{ width: 8, height: 8, borderRadius: 999, background: SEMANTIC.healthy, display: 'inline-block' }} />}
                <OwnerPill row={t} />
              </div>
              {t.suggested_category && <span style={{ fontSize: 12, color: SA.soft }}>{t.suggested_category.replace(/^\d+\.\s*/, '')}</span>}
              {t.evidence && <Evidence id={t.id} text={t.evidence} open={openEvidence === t.id} onToggle={() => setOpenEvidence(o => (o === t.id ? null : t.id))} />}
              <span style={{ fontSize: 11, color: SA.muted }}>
                {t.source ? `From ${t.source.label || 'notes'}${t.source.date ? ` · ${md(t.source.date)}` : ''}` : `Added ${md(t.created_at?.slice(0, 10))}`}
              </span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {canEdit && t.status !== 'accepted' && <>
                  <button type="button" style={actBtn} onClick={() => { setAlready(null); setPanel(p => (p?.id === t.id && p.to === 'partner' ? null : { id: t.id, to: 'partner' })); }} aria-pressed={panel?.id === t.id && panel.to === 'partner'}>Promote → partner</button>
                  <button type="button" style={actBtn} onClick={() => { setAlready(null); setPanel(p => (p?.id === t.id && p.to === 'employer' ? null : { id: t.id, to: 'employer' })); }} aria-pressed={panel?.id === t.id && panel.to === 'employer'}>Promote → employer</button>
                  {open && <button type="button" style={{ ...actBtn, color: SA.muted }} onClick={() => reject(t)}>Not a fit</button>}
                </>}
                <CopyForClaude businessId={businessId} type="target" id={t.id} />
              </div>
              {already?.targetId === t.id && (
                <div role="status" style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: SA.text, padding: '8px 10px', borderRadius: SA_SHAPE.radiusInner, background: SA.surface2, border: `1px solid ${SA.border}` }}>
                  <span>Already here: {already.name} ({typeLabel[already.type]})</span>
                  {onOpenRecord && <button type="button" style={{ ...linkBtn, fontWeight: 600 }} onClick={() => onOpenRecord(already)}>Open</button>}
                  <button type="button" style={{ ...linkBtn, color: SA.muted }} onClick={() => setAlready(null)}>Dismiss</button>
                </div>
              )}
              {panel?.id === t.id && (
                <PromotePanel key={`${t.id}-${panel.to}`} target={t} to={panel.to} categories={categories} onLoadCategories={loadCategories}
                  onPromote={body => promote(t, body)} onCancel={() => setPanel(null)} />
              )}
            </li>
          );
        })}
      </ul>
      {toast && (
        <div role="status" style={{ ...saSans, padding: '10px 12px', borderRadius: SA_SHAPE.radiusInner, background: SA.surface2, border: `1px solid ${SA.border}`, display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{toast.text}</span>
          {toast.undo && <button type="button" style={{ ...linkBtn, fontWeight: 600 }} onClick={() => { const undo = toast.undo; setToast(null); undo(); }}>Undo</button>}
        </div>
      )}
    </section>
  );
}
