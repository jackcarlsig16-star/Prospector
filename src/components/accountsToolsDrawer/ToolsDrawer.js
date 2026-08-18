import { useState, useRef, useEffect } from 'react';
import { C, mono } from '../../constants/colors';

// account-taxonomy-gaps-fix-v1 Stage 3 - Add Account/Dedupe/Assay/SF+Gmail
// status/Import CSV/Add Influencer(s) are creation/import/utility actions,
// not filters - they don't need to be always-visible taking up permanent
// bar space. Collapsed by default, opens as a right-side slide-out panel,
// closes on outside click or Escape. Deliberately not a third always-
// visible row - this is what makes the row reduction genuine rather than
// a relabeling (Row 3 in the SPEC's own numbering is this drawer, not a
// third visible bar).
export default function ToolsDrawer({ children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title="Tools & actions" style={{
        ...mono, fontSize: 11, height: 26, padding: '0 10px', borderRadius: 4,
        border: `1px solid ${open ? '#39FF14' : '#333'}`,
        background: open ? '#39FF1418' : 'transparent',
        color: open ? '#39FF14' : '#888',
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
      }}>
        ⚙ Tools {open ? '▴' : '▾'}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 200,
          minWidth: 240, background: C.sur, border: `1px solid ${C.brd}`, borderRadius: 8,
          padding: 12, boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {children}
        </div>
      )}
    </div>
  );
}
