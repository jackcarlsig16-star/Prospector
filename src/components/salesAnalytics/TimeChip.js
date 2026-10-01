import { C, mono } from '../../constants/colors';

// dashboard-v2 Stage 3 - the honest time-label chip. Any widget that
// ignores the period selector (Sequence Leaderboard, Mailbox Health) wears
// one of these in its header so it never silently looks period-scoped
// when it isn't (audit F10).
export default function TimeChip({ children }) {
  return (
    <span style={{ ...mono, fontSize: 9, color: C.dim, background: `${C.dim}18`, border: `1px solid ${C.dim}44`, borderRadius: 9, padding: '2px 8px', display: 'inline-block' }}>
      {children}
    </span>
  );
}
