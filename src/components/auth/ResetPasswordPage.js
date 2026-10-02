import { useState } from 'react';
import { authClient } from '../../utils/supabase';
import AuthLayout, { inputStyle, primaryButton, ErrorBanner } from './AuthLayout';

// Landing page for the "forgot password" email. The link signs the person in
// with a recovery session (picked up by AuthGate), so updateUser can set the
// new password directly.
export default function ResetPasswordPage({ session }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async e => {
    e.preventDefault();
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError("Those passwords don't match.");
    setBusy(true);
    setError('');
    const { error: err } = await authClient.auth.updateUser({ password });
    if (err) { setError(err.message); setBusy(false); return; }
    window.location.assign('/');
  };

  if (!session) {
    return (
      <AuthLayout title="Link expired" subtitle="This reset link is no longer valid. Request a new one from the sign-in page.">
        <a href="/login" style={{ ...primaryButton, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Go to sign in</a>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set a new password" subtitle={`For ${session.user.email}`}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input aria-label="New password" type="password" autoComplete="new-password" required placeholder="New password (8+ characters)" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />
        <input aria-label="Confirm password" type="password" autoComplete="new-password" required placeholder="Confirm new password" value={confirm} onChange={e => setConfirm(e.target.value)} style={inputStyle} />
        <ErrorBanner>{error}</ErrorBanner>
        <button type="submit" disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </AuthLayout>
  );
}
