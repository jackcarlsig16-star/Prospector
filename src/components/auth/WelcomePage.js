import { useState } from 'react';
import { SA } from '../salesAnalytics/theme';
import { ROLE_LABELS } from '../../constants/roles';
import AuthLayout, { inputStyle, primaryButton, ErrorBanner } from './AuthLayout';

// prospector-auth-v1 addendum - the one screen a person sees the first time
// they're in, then never again (profiles.welcomed_at). Lands on the workspace
// they were just invited to (?business=, set by InvitePage), else their
// newest membership.
export default function WelcomePage({ me, onDone }) {
  const wanted = new URLSearchParams(window.location.search).get('business');
  const newestFirst = [...me.memberships].sort((a, b) => String(b.joined_at).localeCompare(String(a.joined_at)));
  const workspace = me.memberships.find(m => m.business_id === wanted) || newestFirst[0];

  // The profile trigger falls back to the email's local part when the sign-up
  // carried no name - that's the case worth asking about.
  const nameMissing = me.profile.display_name === me.email.split('@')[0];
  const [name, setName] = useState(nameMissing ? '' : me.profile.display_name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstName = name.trim().split(/\s+/)[0];

  const go = async () => {
    setBusy(true);
    setError('');
    const res = await fetch('/api/me/welcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nameMissing ? { display_name: name } : {}),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || `Couldn't save (${res.status})`);
      setBusy(false);
      return;
    }
    onDone(name.trim());
  };

  const row = (label, value) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, padding: '10px 0', borderTop: `1px solid ${SA.border}` }}>
      <span style={{ color: SA.muted }}>{label}</span>
      <span style={{ color: SA.text, textAlign: 'right', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );

  return (
    <AuthLayout title={`Welcome to ${workspace?.name || 'Prospector'}${firstName ? `, ${firstName}` : ''}`}>
      <div>
        {nameMissing ? (
          <label style={{ display: 'block', fontSize: 13, color: SA.muted, marginBottom: 12 }}>
            Your name
            <input value={name} onChange={e => setName(e.target.value)} placeholder="First and last name" autoFocus style={{ ...inputStyle, marginTop: 6 }} />
          </label>
        ) : row('Name', name)}
        {row('Email', me.email)}
        {workspace && row('Role', ROLE_LABELS[workspace.role])}
      </div>
      <ErrorBanner>{error}</ErrorBanner>
      <button type="button" onClick={go} disabled={busy || (nameMissing && !name.trim())}
        style={{ ...primaryButton, opacity: busy || (nameMissing && !name.trim()) ? 0.6 : 1 }}>
        {busy ? 'One moment…' : 'Go to my workspace'}
      </button>
    </AuthLayout>
  );
}
