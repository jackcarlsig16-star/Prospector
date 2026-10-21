import { useEffect } from 'react';
import { SA } from './theme';

// pipeline-quick-panel-v1 - the one right-hand drawer shell for the sales
// module: fixed right, 420px, backdrop or Esc closes, page scroll locked
// while it's open (useOverlayShell, shared with CenterWindow). The table behind stays mounted. z-index matches the
// module's other drawers (SheetUpdateDrawer, PlanWeekDrawer) so the shell's
// Tasks side tab (3000) sits under the backdrop, not over the drawer's edge.
export function useOverlayShell(onClose) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', onKey); };
  }, [onClose]);
}

export default function SidePanel({ label, onClose, children, width = 420 }) {
  useOverlayShell(onClose);
  return (
    <div className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 4003, display: 'flex', justifyContent: 'flex-end' }}>
      <div data-testid="side-panel-backdrop" onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
      <aside aria-label={label} style={{ position: 'relative', width, maxWidth: '100%', height: '100%', overflowY: 'auto', background: SA.surface, borderLeft: `1px solid ${SA.border}`, padding: 20, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {children}
      </aside>
    </div>
  );
}
