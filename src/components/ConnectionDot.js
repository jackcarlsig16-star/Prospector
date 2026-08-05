import { useState, useRef, useEffect } from 'react';
import { mono } from '../constants/colors';

const NEON  = '#39FF14';
const AMBER = '#FFB800';
const RED   = '#FF4444';

const COLOR_BY_STATUS = { connected: NEON, expiring: AMBER, disconnected: RED };

export default function ConnectionDot({
  service,             // "SF" or "Gmail"
  status,              // "connected" | "expiring" | "disconnected"
  tooltip,             // string
  onClick,             // status === 'expiring' or 'disconnected' triggers reconnect
  onDisconnect,        // only used by popover when connected
  detail,              // string shown in popover when connected (email / org)
  lastSync,            // ISO string optional
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const close = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setPopoverOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [popoverOpen]);

  const color = COLOR_BY_STATUS[status] || RED;
  const pulse = status === 'connected';

  const handleClick = () => {
    if (status === 'connected') setPopoverOpen(o => !o);
    else if (onClick) onClick();
  };

  const lastSyncLabel = (() => {
    if (!lastSync) return '';
    try {
      const ms = Date.now() - new Date(lastSync).getTime();
      const mins = Math.floor(ms / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      return `${Math.floor(hrs / 24)}d ago`;
    } catch { return ''; }
  })();

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={handleClick}>
      <style>{`@keyframes connDotPulse{0%,100%{box-shadow:0 0 0 0 currentColor;opacity:1}50%{box-shadow:0 0 10px 1px currentColor;opacity:.85}}`}</style>
      <span style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        background: color, color, // color used by box-shadow currentColor in keyframes
        boxShadow: pulse ? `0 0 6px ${color}88` : 'none',
        animation: pulse ? 'connDotPulse 3s ease-in-out infinite' : 'none',
      }}/>
      <span style={{ ...mono, fontSize: 11, color: color, letterSpacing: '0.04em' }}>{service}</span>

      {/* Hover tooltip — only when popover closed */}
      {hover && !popoverOpen && tooltip && (
        <div style={{ ...mono, position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100, padding: '5px 9px', fontSize: 10, color: '#cfe8d4', background: '#0a1a0f', border: `1px solid ${color}55`, borderRadius: 4, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
          {tooltip}
        </div>
      )}

      {/* Connected popover */}
      {popoverOpen && status === 'connected' && (
        <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 100, padding: '10px 12px', background: '#0a1a0f', border: `1px solid ${NEON}44`, borderRadius: 6, minWidth: 220, boxShadow: '0 6px 20px rgba(0,0,0,0.5)' }}>
          <p style={{ ...mono, margin: 0, fontSize: 11, color: NEON, fontWeight: 600, letterSpacing: '0.06em' }}>● {service} CONNECTED</p>
          {detail && <p style={{ ...mono, margin: '6px 0 0', fontSize: 11, color: '#cfe8d4', wordBreak: 'break-all' }}>{detail}</p>}
          {lastSyncLabel && <p style={{ ...mono, margin: '4px 0 0', fontSize: 10, color: '#5a6a5a' }}>Last sync: {lastSyncLabel}</p>}
          {onDisconnect && (
            <button onClick={() => { setPopoverOpen(false); onDisconnect(); }}
              style={{ ...mono, marginTop: 8, fontSize: 10, padding: '3px 10px', background: 'transparent', border: `1px solid ${RED}55`, color: RED, borderRadius: 3, cursor: 'pointer' }}>
              Disconnect
            </button>
          )}
        </div>
      )}
    </div>
  );
}
