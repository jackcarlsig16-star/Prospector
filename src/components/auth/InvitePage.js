import { useState, useEffect } from 'react';
import { SA } from '../salesAnalytics/theme';
import { authClient } from '../../utils/supabase';
import { signOut } from '../../utils/authSession';
import AuthLayout, { inputStyle, primaryButton, secondaryButton, linkButton, ErrorBanner, Notice, Divider, GoogleButton } from './AuthLayout';

const DEAD_LINK = {
  expired: ['This invite has expired', 'Invite links last 7 days. Ask whoever invited you to send a new one.'],
  used: ['This invite was already used', 'If that was you, just sign in.'],
  revoked: ['This invite was cancelled', 'Ask whoever invited you to send a new one.'],
};

export default function InvitePage({ token, session }) {
  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState('signup'); // 'signup' | 'signin'
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    fetch(`/api/invites/${encodeURIComponent(token)}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Couldn't load this invite (${res.status})`);
        setInvite(data);
      })
      .catch(e => setLoadError(e.message));
  }, [token]);

  if (loadError) {
    return (
      <AuthLayout title="Invite not found" subtitle={loadError}>
        <a href="/login" style={{ ...secondaryButton, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Go to sign in</a>
      </AuthLayout>
    );
  }
  if (!invite) return <AuthLayout title="Loading invite…" />;

  if (invite.status !== 'valid') {
    const [title, subtitle] = DEAD_LINK[invite.status];
    return (
      <AuthLayout title={title} subtitle={subtitle}>
        <a href="/login" style={{ ...secondaryButton, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Go to sign in</a>
      </AuthLayout>
    );
  }

  const returnHere = `${window.location.origin}/invite/${token}`;
  const headline = `You've been invited to ${invite.business.name} as ${invite.role_label}${invite.invited_by ? ` by ${invite.invited_by}` : ''}.`;
  const signedInEmail = (session?.user?.email || '').toLowerCase();

  const accept = async () => {
    setBusy(true);
    setError('');
    const res = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || `Couldn't accept (${res.status})`); setBusy(false); return; }
    window.location.assign(`/?business=${data.business_id}`);
  };

  const google = async () => {
    setBusy(true);
    const { error: err } = await authClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnHere, queryParams: { login_hint: invite.email } } });
    if (err) { setError(err.message); setBusy(false); }
  };

  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    if (mode === 'signup') {
      if (password.length < 8) { setError('Use at least 8 characters.'); setBusy(false); return; }
      const { data, error: err } = await authClient.auth.signUp({
        email: invite.email, password,
        options: { emailRedirectTo: returnHere, data: { full_name: name.trim() } },
      });
      setBusy(false);
      if (err) return setError(err.message);
      if (!data.session) setNotice(`Check ${invite.email} for a confirmation link — it brings you back here to accept. It can take a few minutes.`);
      return;
    }
    const { error: err } = await authClient.auth.signInWithPassword({ email: invite.email, password });
    setBusy(false);
    if (err) setError(err.message === 'Invalid login credentials' ? 'Wrong password for this email.' : err.message);
  };

  if (session && signedInEmail !== invite.email) {
    return (
      <AuthLayout title="Wrong account" subtitle={`${headline} It's for ${invite.email}, but you're signed in as ${session.user.email}.`}>
        <button type="button" onClick={signOut} style={primaryButton}>Sign out and switch account</button>
      </AuthLayout>
    );
  }

  if (session) {
    return (
      <AuthLayout title={`Join ${invite.business.name}`} subtitle={headline}>
        <ErrorBanner>{error}</ErrorBanner>
        <button type="button" onClick={accept} disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>{busy ? 'Joining…' : 'Accept invite'}</button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={`Join ${invite.business.name}`} subtitle={headline}>
      <GoogleButton onClick={google} disabled={busy} />
      <Divider />
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input aria-label="Email" type="email" value={invite.email} readOnly style={{ ...inputStyle, color: SA.muted }} />
        {mode === 'signup' && (
          <input aria-label="Your name" required placeholder="Your name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
        )}
        <input aria-label="Password" type="password" required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          placeholder={mode === 'signup' ? 'Create a password (8+ characters)' : 'Password'} value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />
        <ErrorBanner>{error}</ErrorBanner>
        <Notice>{notice}</Notice>
        <button type="submit" disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <button type="button" style={{ ...linkButton, alignSelf: 'flex-start' }} onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); setNotice(''); }}>
        {mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </button>
    </AuthLayout>
  );
}
