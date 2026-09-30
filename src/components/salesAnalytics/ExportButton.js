import { C, mono } from '../../constants/colors';

export default function ExportButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{ ...mono, fontSize: 10, padding: '3px 9px', borderRadius: 5, background: 'transparent', border: `1px solid ${C.brd}`, color: C.dim, cursor: 'pointer' }}
    >
      Export CSV
    </button>
  );
}
