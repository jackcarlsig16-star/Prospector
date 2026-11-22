import { useEffect, useMemo, useRef } from 'react';
import ScoutCommandBar from '../ScoutCommandBar';
import './scoutStyles';
import { StarGlyph, ClearGlyph } from './ScoutParts';
import { isViewerIn } from './scoutModel';
import { OPEN_TASKS, OPEN_ATTENTION } from '../salesAnalytics/goals/goalsApi';

// app-shell-v2 W1 / W2 - Scout under the shell's one field, in the open workspace only (no scope pill: the shell names
// no other workspace). The thread is the day's, in localStorage (scoutModel.js), so both read the same one.
//   ScoutWindow - a right drawer over the page (640 px; a full sheet on a phone): the thread and a follow-up input.
//                 Esc or the close button shuts it (onClose(true) = hand focus back to the field); it stays mounted
//                 while shut, so an ask in flight still lands in the thread.
//   ScoutPage   - the same thread at the page's width; the header's field is its composer (seed).
const useThread = (workspace, me) => {
  const options = useMemo(() => [{ id: workspace.id, name: workspace.name, color: workspace.color || null }], [workspace.id, workspace.name, workspace.color]);
  return { scope: workspace.id, scopeOptions: options, allText: workspace.name, onScope: () => {}, viewer: isViewerIn(me, workspace.id, options) };
};

export default function ScoutWindow({ open, seed, compact, workspace, me, businesses, onOpen, onClose }) {
  const ref = useRef(null);
  const thread = useThread(workspace, me);
  useEffect(() => { if (open) ref.current?.querySelector('.scout-bar input')?.focus(); }, [open, seed?.at]);
  useEffect(() => {
    if (!open) return undefined;
    // a row's menu and the draft panel close on their own Esc first
    const onKey = e => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[data-scout-compose], .scout-menu')) onClose(true); };
    // one drawer at a time on the right edge
    const shut = () => onClose(false);
    window.addEventListener('keydown', onKey); window.addEventListener(OPEN_TASKS, shut); window.addEventListener(OPEN_ATTENTION, shut);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_TASKS, shut); window.removeEventListener(OPEN_ATTENTION, shut); };
  }, [open, onClose]);
  return (
    <div ref={ref} className="scout-win ui-theme-dark no-print" role="dialog" aria-modal={compact ? true : undefined} aria-label="Scout" hidden={!open} data-scout-window={compact ? 'sheet' : 'drawer'}>
      <header className="scout-win__top">
        <span className="scout-neon" style={{ display: 'inline-flex' }}><StarGlyph /></span>
        <h2>Scout</h2>
        <span style={{ flex: 1 }} />
        <button type="button" className="scout-btn" aria-label="Close Scout" onClick={() => onClose(true)}><ClearGlyph /></button>
      </header>
      <ScoutCommandBar mode="window" {...thread} me={me} businesses={businesses} onOpen={onOpen} stacked={compact} seed={seed} onDone={why => onClose(why !== 'open')} />
    </div>
  );
}

export function ScoutPage({ seed, compact, workspace, me, businesses, onOpen }) {
  const thread = useThread(workspace, me);
  return (
    <div style={{ maxWidth: 960, display: 'flex', flexDirection: 'column', gap: 16 }} data-scout-page>
      <h1 className="sh-h1">Scout</h1>
      <ScoutCommandBar mode="page" {...thread} me={me} businesses={businesses} onOpen={onOpen} stacked={compact} seed={seed} />
    </div>
  );
}
