import React from 'react';
import { mono } from '../constants/colors';

const AMB = '#FFB800';

export default function PendingApprovalBanner({ user, onPing, pinged, pinging }) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 800,
      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px',
      background: '#1a1100',
      borderBottom: `1px solid ${AMB}55`,
      ...mono,
    }}>
      <span style={{ fontSize: 14 }}>⚠</span>
      <span style={{ fontSize: 11, color: AMB, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Access Pending
      </span>
      <span style={{ fontSize: 12, color: '#cfb37a', flex: 1 }}>
        Your account is awaiting admin approval. {user?.email ? `You'll receive an email at ${user.email} once approved.` : "You'll receive an email when approved."} Real data appears here automatically — check back any time.
      </span>
      {!pinged ? (
        <button onClick={onPing} disabled={pinging}
          style={{ ...mono, fontSize: 10, padding: '4px 10px', background: `${AMB}18`, border: `1px solid ${AMB}55`, color: AMB, borderRadius: 4, cursor: pinging ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
          {pinging ? 'Notifying…' : '🔔 Nudge admin'}
        </button>
      ) : (
        <span style={{ fontSize: 10, color: '#86b97a', whiteSpace: 'nowrap' }}>✓ admin notified</span>
      )}
    </div>
  );
}
