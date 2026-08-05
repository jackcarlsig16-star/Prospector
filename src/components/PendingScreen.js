import React, { useState, useEffect, useCallback } from 'react';

// Shown while the user's status in Supabase is 'pending' (or 'loading' during initial fetch).
// Phase 3 will swap this for an in-app sandboxed view; Phase 1 keeps the existing UX.

async function pingAdmin(u) {
  try {
    await fetch('/api/notify-pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: u?.name || 'Unknown', email: u?.email || '', role: u?.role || 'AE' }),
    });
  } catch {}
}

export default function PendingScreen({ user, isLoading }) {
  const [pinged, setPinged] = useState(() => {
    try { return !!localStorage.getItem('prospector_admin_pinged'); } catch { return false; }
  });
  const [pinging, setPinging] = useState(false);

  // Auto-ping on first render once we've confirmed pending (not still loading)
  useEffect(() => {
    if (isLoading || pinged) return;
    pingAdmin(user).then(() => {
      try { localStorage.setItem('prospector_admin_pinged', '1'); } catch {}
      setPinged(true);
    });
  }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleManualPing = useCallback(async () => {
    setPinging(true);
    await pingAdmin(user);
    try { localStorage.setItem('prospector_admin_pinged', '1'); } catch {}
    setPinged(true);
    setPinging(false);
  }, [user]);

  const mono = { fontFamily: "'Courier New', monospace" };

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#050a0f', ...mono }}>
      <div style={{ textAlign:'center', padding:'40px 32px', maxWidth:440 }}>
        {isLoading ? (
          <>
            <div style={{ fontSize:32, marginBottom:20, opacity:0.6 }}>⛏️</div>
            <p style={{ margin:0, fontSize:14, color:'#3A3020' }}>Loading…</p>
          </>
        ) : (
          <>
            <div style={{ fontSize:36, marginBottom:20 }}>⏳</div>
            <p style={{ margin:'0 0 6px', fontSize:20, fontWeight:700, color:'#D4A96A', letterSpacing:'0.1em' }}>ACCESS PENDING</p>
            <p style={{ margin:'0 0 6px', fontSize:13, color:'#8C7A5A' }}>
              {user?.name ? `Hey ${user.name.split(' ')[0]} —` : ''} your account is awaiting admin approval.
            </p>
            <p style={{ margin:'0 0 24px', fontSize:13, color:'#5A4A30', lineHeight:1.6 }}>
              You'll be let in automatically once approved.<br/>This page checks every 30 seconds.
            </p>
            <div style={{ background:'#0d0a00', border:'1px solid #2a1f00', borderRadius:8, padding:'14px 18px', marginBottom:20, textAlign:'left' }}>
              <p style={{ margin:'0 0 4px', fontSize:11, color:'#6b5a30', textTransform:'uppercase', letterSpacing:'0.08em' }}>Requesting access</p>
              <p style={{ margin:'0 0 2px', fontSize:13, color:'#D4A96A', fontWeight:600 }}>{user?.name || '—'}</p>
              <p style={{ margin:0, fontSize:12, color:'#8C7A5A' }}>{user?.email || '—'} · {user?.role || 'AE'}</p>
            </div>
            {!pinged ? (
              <button onClick={handleManualPing} disabled={pinging}
                style={{ ...mono, fontSize:12, padding:'8px 20px', background:'#1a1200', border:'1px solid #D4A96A55', color:'#D4A96A', borderRadius:6, cursor:'pointer', marginBottom:16 }}>
                {pinging ? 'Notifying…' : '🔔 Notify admin'}
              </button>
            ) : (
              <p style={{ fontSize:12, color:'#4a6a30', marginBottom:16 }}>✓ Admin notified — sit tight</p>
            )}
            <p style={{ margin:0, fontSize:11, color:'#2a2010' }}>Checking every 30 seconds…</p>
          </>
        )}
      </div>
    </div>
  );
}
