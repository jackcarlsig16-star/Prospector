import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import useMediaQuery from '../utils/useMediaQuery';
import ScoutCommandBar from './ScoutCommandBar';
import './scout/scoutStyles';
import { StarGlyph, ScopePill, ClearGlyph } from './scout/ScoutParts';
import { pickScope, saveScope, allLabel, isViewerIn } from './scout/scoutModel';

// scout-v2 REV3 Stage 2 - Scout's one mount (App.js): compact in a workspace's header row (300 px, 560 focused), the
// content width on a plain page, and on a phone (both mounts) only the neon star, which opens the full-height sheet
// (drag handle · Scout · scope pill · ✕, then the bar). The scope is one of the caller's workspaces or all of them
// ("All workspaces" for the platform owner), remembered per user (prospector_scout_scope) - no confirm step.
export default function PersistentScout({ compact = false, businesses = [], activeBusiness = null, me = null, onOpen }) {
  const phone = useMediaQuery('(max-width: 899px)');
  const userId = me?.profile?.id || 'anon';
  const isOwner = !!me?.profile?.is_platform_owner;
  const options = useMemo(() => businesses.map(b => ({ id: b.id, name: b.name, color: b.color || null })), [businesses]);
  const [scope, setScope] = useState(() => pickScope({ userId, options, activeId: activeBusiness?.id }));
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => { setScope(pickScope({ userId, options, activeId: activeBusiness?.id })); }, [userId, options, activeBusiness?.id]);
  useEffect(() => {
    if (!phone) return undefined;
    const onKey = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSheetOpen(true); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phone]);
  useEffect(() => { if (!phone) setSheetOpen(false); }, [phone]);

  const changeScope = s => { setScope(s); saveScope(userId, s); };
  const allText = allLabel(isOwner);
  const bar = mode => (
    <ScoutCommandBar mode={mode} scope={scope} scopeOptions={options} allText={allText} onScope={changeScope} me={me} businesses={businesses}
      onOpen={onOpen} viewer={isViewerIn(me, scope, options)} autoFocus={mode === 'sheet'} onDone={mode === 'sheet' ? () => setSheetOpen(false) : undefined} />
  );

  if (!phone) return bar(compact ? 'compact' : 'plain');
  return (
    <div className="scout scout--star" data-scout-bar={compact ? 'compact' : 'full'}>
      <button type="button" className="scout-star-btn" aria-label="Search or ask Scout" aria-haspopup="dialog" onClick={() => setSheetOpen(true)}><StarGlyph /></button>
      {sheetOpen && createPortal(
        <div className="scout-sheet ui-theme-dark" role="dialog" aria-modal="true" aria-label="Scout" data-scout-sheet>
          <div className="scout-sheet__handle" aria-hidden="true" />
          <div className="scout-sheet__top" style={{ position: 'relative' }}>
            <span className="scout-lbl">Scout</span>
            {options.length > 0 && <ScopePill value={scope} options={options} allText={allText} onChange={changeScope} />}
            <button type="button" className="scout-btn" aria-label="Close Scout" onClick={() => setSheetOpen(false)}><ClearGlyph /></button>
          </div>
          {bar('sheet')}
        </div>,
        document.body,
      )}
    </div>
  );
}
