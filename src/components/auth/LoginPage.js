import { useState } from 'react';
import { SA } from '../salesAnalytics/theme';
import { supabase } from '../../utils/supabase';
import AuthLayout, { inputStyle, primaryButton, linkButton, ErrorBanner, Notice, Divider, GoogleButton } from './AuthLayout';

// Only same-origin paths survive as a post-login destination.
export function safeNextPath(raw) {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
}

const FRIENDLY = {
  'Invalid login credentials': 'Wrong email or password.',
  'Email not confirmed': 'Confirm your email first — check your inbox for the link.',
};

export default function LoginPage({ next = '/', initialError = '' }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState('');

  const google = async () => {
    setError('');
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}${next}` } });
    if (err) { setError(err.message); setBusy(false); }
  };

  const submit = async e => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    if (mode === 'forgot') {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
      setBusy(false);
      if (err) setError(err.message);
      else setNotice('If that email has an account, a reset link is on its way. It can take a few minutes.');
      return;
    }
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) { setError(FRIENDLY[err.message] || err.message); setBusy(false); return; }
    window.location.assign(next);
  };

  return (
    <AuthLayout
      title={mode === 'forgot' ? 'Reset your password' : 'Sign in'}
      subtitle={mode === 'forgot' ? "Enter your email and we'll send you a link to set a new password." : 'Use the email your invite was sent to.'}>
      {mode === 'signin' && (
        <>
          <GoogleButton onClick={google} disabled={busy} />
          <Divider />
        </>
      )}
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input aria-label="Email" type="email" autoComplete="email" required placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} />
        {mode === 'signin' && (
          <input aria-label="Password" type="password" autoComplete="current-password" required placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />
        )}
        <ErrorBanner>{error}</ErrorBanner>
        <Notice>{notice}</Notice>
        <button type="submit" disabled={busy} style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Working…' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
        </button>
      </form>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '6px 16px', fontSize: 13, color: SA.faint }}>
        {mode === 'signin'
          ? <button type="button" style={linkButton} onClick={() => { setMode('forgot'); setError(''); }}>Forgot password?</button>
          : <button type="button" style={linkButton} onClick={() => { setMode('signin'); setError(''); setNotice(''); }}>Back to sign in</button>}
        <span>No account? Ask your admin for an invite.</span>
      </div>
    </AuthLayout>
  );
}
