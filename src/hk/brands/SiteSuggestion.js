import React, { useEffect, useState } from 'react';
import { hkPost } from '../hkApi';
import { UNDO_MS } from '../signals/Heat';

// grow-owner-chip F2 - a website found by research, on the Briefing card and the brand page. "Save as website" is the
// use-domain route (duplicate-domain check, Activity row); "Wrong site" clears the suggestion and keeps the sweep off
// the brand for 30 days, with a 10 s Undo. Viewers see the line only. onSaved runs only after a save, so a parent that
// remounts on a brand change doesn't drop the Undo.
export default function SiteSuggestion({ businessId, brandId, brandName, suggestion, canEdit, className = 'hk-meta', onChanged, onSaved, setNote, ...attrs }) {
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState(null);
  useEffect(() => { if (!undo) return undefined; const t = setTimeout(() => setUndo(null), UNDO_MS); return () => clearTimeout(t); }, [undo]);
  const run = async fn => { setBusy(true); setNote(''); try { await fn(); await onChanged?.(); } catch (e) { setNote(e.message); } finally { setBusy(false); } };
  const save = () => run(async () => { await hkPost(businessId, `/brands/${brandId}/use-domain`, {}); setNote(`${brandName ? `${brandName}: website` : 'Website'} saved as ${suggestion.domain}.`); await onSaved?.(); });
  const wrong = () => run(async () => { await hkPost(businessId, `/brands/${brandId}/wrong-site`, {}); setUndo(suggestion.domain); });
  const undoIt = () => run(async () => { await hkPost(businessId, `/brands/${brandId}/wrong-site`, { undo: true }); setUndo(null); });
  if (undo) {
    return (
      <p className={className} role="status" data-hk-site-undo>
        {undo} marked wrong. Not researched again for 30 days. <button type="button" className="hk-btn hk-link" disabled={busy} onClick={undoIt} data-hk-undo-wrong-site>Undo</button>
      </p>
    );
  }
  if (!suggestion) return null;
  return (
    <p className={className} {...attrs}>
      {suggestion.confidence === 'high' ? `Website (suggested): ${suggestion.domain}` : `Possible website: ${suggestion.domain}?`}
      {canEdit && <> · <button type="button" className="hk-btn hk-link" disabled={busy} onClick={save} data-hk-use-site>Save as website</button>
        {' · '}<button type="button" className="hk-btn hk-link" disabled={busy} onClick={wrong} data-hk-wrong-site>Wrong site</button></>}
    </p>
  );
}
