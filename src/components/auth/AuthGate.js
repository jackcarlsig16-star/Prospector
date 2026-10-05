import { useState, useEffect } from 'react';
import { authClient } from '../../utils/supabase';
import { syncSessionCookie, fetchMe, signOut } from '../../utils/authSession';
import AuthLayout, { primaryButton, ErrorBanner } from './AuthLayout';
import LoginPage, { safeNextPath } from './LoginPage';
import InvitePage from './InvitePage';
import ResetPasswordPage from './ResetPasswordPage';
import WelcomePage from './WelcomePage';

// prospector-auth-v1 Stage 2 - sits in front of the whole app (index.js).
// Owns the Supabase session and the three public auth routes; everything
// else needs a session plus at least one workspace (or platform owner).
// First time in: the Welcome screen. Then children(me) - the app gets the
// signed-in person from here, not from localStorage.
export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [me, setMe] = useState(undefined);
  const [meError, setMeError] = useState('');
  const path = window.location.pathname;

  useEffect(() => {
    authClient.auth.getSession().then(({ data }) => {
      syncSessionCookie(data.session);
      setSession(data.session);
    });
    const { data: sub } = authClient.auth.onAuthStateChange((_event, s) => {
      syncSessionCookie(s);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;
  const isPublicRoute = path.startsWith('/invite/') || path === '/reset-password' || path === '/login';
  useEffect(() => {
    if (!userId || isPublicRoute) return;
    // null = the browser holds a session the server rejects (expired/revoked).
    fetchMe().then(m => (m === null ? signOut() : setMe(m))).catch(e => setMeError(e.message));
  }, [userId, isPublicRoute]);

  if (session === undefined) return <AuthLayout title="Loading…" />;

  if (path.startsWith('/invite/')) return <InvitePage token={path.slice('/invite/'.length)} session={session} />;
  if (path === '/reset-password') return <ResetPasswordPage session={session} />;

  const params = new URLSearchParams(window.location.search);
  if (!session) {
    const next = path === '/login' ? safeNextPath(params.get('next')) : `${path}${window.location.search}`;
    if (path !== '/login') window.history.replaceState({}, '', `/login?next=${encodeURIComponent(next)}`);
    return <LoginPage next={next} />;
  }
  if (path === '/login') {
    window.location.replace(safeNextPath(params.get('next')));
    return <AuthLayout title="Signing you in…" />;
  }

  if (meError) {
    return (
      <AuthLayout title="Couldn't load your account" subtitle="Reload to try again.">
        <ErrorBanner>{meError}</ErrorBanner>
      </AuthLayout>
    );
  }
  if (me === undefined) return <AuthLayout title="Loading…" />;
  if (!me.profile?.is_platform_owner && me.memberships.length === 0) {
    return (
      <AuthLayout title="No workspace yet" subtitle={`You're signed in as ${me.email}, but you haven't been added to a workspace. Ask an admin for an invite link.`}>
        <button type="button" onClick={signOut} style={primaryButton}>Sign out</button>
      </AuthLayout>
    );
  }
  if (!me.profile.welcomed_at) {
    return <WelcomePage me={me} onDone={name => setMe({ ...me, profile: { ...me.profile, display_name: name || me.profile.display_name, welcomed_at: new Date().toISOString() } })} />;
  }
  return children(me);
}
