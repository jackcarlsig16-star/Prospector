import { useEffect, useRef } from 'react';
import { SA } from './theme';
import { useOverlayShell } from './SidePanel';
import useMediaQuery from '../../utils/useMediaQuery';

// FIX company-panel-promote-research-v1 Part B - the company panel's shell:
// a window centered over the page, min(1040px, 92vw) wide and 88vh tall at
// most, `head` pinned at the top and the body scrolling inside. Under 760px
// it is a full-screen sheet. Backdrop or Esc closes, page scroll is locked
// while it's open. The window takes focus on open; the caller puts focus
// back on the row when it closes. Same z-index and backdrop as SidePanel.
export default function CenterWindow({ label, head, onClose, children }) {
  useOverlayShell(onClose);
  const phone = useMediaQuery('(max-width: 760px)');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  const frame = phone
    ? { width: '100%', height: '100%', borderRadius: 0 }
    : { width: 'min(1040px, 92vw)', maxHeight: '88vh', borderRadius: 12, border: `1px solid ${SA.border}`, boxShadow: '0 24px 64px rgba(0, 0, 0, 0.55)' };
  return (
    <div className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 4003, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div data-testid="side-panel-backdrop" onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
      <aside aria-label={label} tabIndex={-1} ref={ref} data-center-window={phone ? 'sheet' : 'window'} className="ui-theme-dark"
        style={{ position: 'relative', ...frame, background: SA.surface, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: 'none' }}>
        <div data-window-head style={{ flex: 'none', padding: '20px 20px 14px', display: 'flex', flexDirection: 'column', gap: 14, borderBottom: `1px solid ${SA.border}` }}>{head}</div>
        <div data-window-body style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
      </aside>
    </div>
  );
}
