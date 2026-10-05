import { C, mono } from '../constants/colors';

export default function StaleSfdcBanner({ onDismiss }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: `${C.gold}0d`, border: `1px solid ${C.gold}33`, borderRadius: 7, marginBottom: 12 }}>
      <span style={{ fontSize: 16 }}>⚠️</span>
      <span style={{ ...mono, fontSize: 12, color: C.txt, flex: 1 }}>SFDC data may be stale — reconnect to refresh your territory. Takes ~30 seconds.</span>
      <button onClick={() => { window.location.href = '/api/sfdc/auth'; }} style={{ ...mono, fontSize: 11, padding: '4px 12px', background: `${C.gold}18`, border: `1px solid ${C.gold}55`, color: C.gold, borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        Reconnect SFDC →
      </button>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
    </div>
  );
}
