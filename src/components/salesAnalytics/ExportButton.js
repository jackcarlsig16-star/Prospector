import { C, mono } from '../../constants/colors';

// dashboard-v2 Stage 5 - no-print here covers every widget's Export CSV
// button in one place ("nav and buttons are hidden" in the PDF).
export default function ExportButton({ onClick }) {
  return (
    <button
      className="no-print"
      onClick={onClick}
      style={{ ...mono, fontSize: 10, padding: '3px 9px', borderRadius: 5, background: 'transparent', border: `1px solid ${C.brd}`, color: C.dim, cursor: 'pointer' }}
    >
      Export CSV
    </button>
  );
}
