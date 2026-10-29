import React, { useEffect, useState } from 'react';
import Button from '../../ui/Button';
import { hkPost } from '../hkApi';

// grow-signals-v1 G4 + G7 - the heat chip (the word always beside the color), the 4 px row bar, and the one-click
// + Target / + Pipeline buttons with a 10 s Undo. Viewers get the chip only.
export const HEAT_WORDS = { hot: 'Hot', warm: 'Warm', cool: 'Cool', cold: 'Cold' };
export const UNDO_MS = 10_000;

export function HeatChip({ band, showCold = false }) {
  if (!band || !HEAT_WORDS[band] || (band === 'cold' && !showCold)) return null;
  return <span className={`hk-heat hk-heat--${band}`} data-hk-heat={band}>{HEAT_WORDS[band]}</span>;
}

// rowStyle for DataTable rows: the bar on Hot / Warm / Cool, nothing on Cold.
export const heatBarStyle = band => (band && band !== 'cold' && HEAT_WORDS[band] ? { boxShadow: `inset 4px 0 0 var(--hk-heat-${band}-bar)` } : undefined);

// Why + Pipeline can't claim this brand for the caller - the same rules the server applies (signalsRoutes
// pipelineRefusal), so the button says why before anyone clicks.
export function pipelineBlock(brand, meId, firstName = () => null) {
  if (brand.relationship === 'sponsor') return `${brand.name} is a sponsor`;
  if (brand.relationship === 'founding_partner') return `${brand.name} is a founding partner`;
  if (brand.relationship === 'do_not_contact') return `${brand.name} is marked do not contact`;
  if (brand.owner_unclear) return `${brand.name}'s owner is Unclear`;
  if (brand.owner_user_id && brand.owner_user_id !== meId) return `Owned by ${firstName(brand.owner_user_id) || 'another founder'}`;
  if (brand.status === 'passed') return `${brand.name} was passed on`;
  return null;
}

export function ListButtons({ businessId, brand, meId, members = [], canEdit, onChanged, compact = false }) {
  const [targeted, setTargeted] = useState(!!brand.targeted_at);
  const [inPipe, setInPipe] = useState(brand.owner_user_id === meId && brand.status !== 'candidate');
  const [undo, setUndo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setTargeted(!!brand.targeted_at); setInPipe(brand.owner_user_id === meId && brand.status !== 'candidate'); }, [brand.targeted_at, brand.owner_user_id, brand.status, meId]);
  useEffect(() => { if (!undo) return undefined; const t = setTimeout(() => setUndo(null), UNDO_MS); return () => clearTimeout(t); }, [undo]);
  if (!canEdit) return null;
  const firstName = id => members.find(m => m.user_id === id)?.first_name || null;
  const blocked = inPipe ? null : pipelineBlock(brand, meId, firstName);
  const run = async fn => { setBusy(true); setError(''); try { await fn(); onChanged?.(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const target = on => run(async () => { await hkPost(businessId, `/brands/${brand.id}/target`, { on }); setTargeted(on); setUndo(on ? { kind: 'target', line: `${brand.name} added to Targets.` } : null); });
  const pipe = () => run(async () => { const r = await hkPost(businessId, `/brands/${brand.id}/pipeline`, {}); setInPipe(true); if (!r.already) setUndo({ kind: 'pipeline', line: `${brand.name} is on your Pipeline.`, expect: r.brand.updated_at }); });
  const undoIt = () => run(async () => {
    if (undo.kind === 'target') { await hkPost(businessId, `/brands/${brand.id}/target`, { on: false }); setTargeted(false); }
    else { await hkPost(businessId, `/brands/${brand.id}/pipeline`, { undo: true, expect_updated_at: undo.expect }); setInPipe(false); }
    setUndo(null);
  });
  return (
    <span className="hk-lists" data-hk-lists={brand.id}>
      {targeted ? <span className="hk-chip hk-chip--green" data-hk-targeted>Targeted</span>
        : <Button size="sm" disabled={busy} onClick={() => target(true)} aria-label={`Add ${brand.name} to Targets`} data-hk-target>+ Target</Button>}
      {inPipe ? <span className="hk-chip hk-chip--green" data-hk-in-pipeline>{compact ? 'Pipeline' : 'In Pipeline'}</span>
        : <Button size="sm" disabled={busy || !!blocked} disabledReason={blocked} onClick={pipe} aria-label={`Add ${brand.name} to your Pipeline`} data-hk-pipeline>+ Pipeline</Button>}
      {blocked && !compact && <span className="hk-meta" data-hk-pipeline-why>{blocked}</span>}
      {/* In a table row (compact) the line stays screen-reader only, so the row keeps its height (N2). */}
      {undo && <span className="hk-lists__undo" role="status" data-hk-undo-line><span className={compact ? 'ui-sr-only' : undefined}>{undo.line} </span><button type="button" className="hk-btn hk-link" disabled={busy} onClick={undoIt} data-hk-undo>Undo</button></span>}
      {error && <span className="hk-error" role="alert">{error}</span>}
    </span>
  );
}
