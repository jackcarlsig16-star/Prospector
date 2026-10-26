// A browser session as the platform owner (Jack) for read-only verify runs on localhost. A one-time magic-link token
// minted with the service key (no email is sent; Jack approved 2026-10-25). release() signs that one session out
// (scope 'local', so his other sessions stay) and restores profiles.last_seen_at exactly. Sign-in rows that /api/me
// adds to auth_events are KEPT: real sign-ins stay logged (Jack 2026-10-26); release() reports how many.
// Never prints the address.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

export async function ownerSession(svc) {
  const { data: owners, error } = await svc.from('profiles').select('id,email,last_seen_at').eq('is_platform_owner', true);
  if (error || owners?.length !== 1) throw new Error('expected exactly one platform owner profile');
  const owner = owners[0];
  const { data: lastEvt } = await svc.from('auth_events').select('id').order('id', { ascending: false }).limit(1);
  const maxEvt = lastEvt?.[0]?.id || 0;
  const anon = () => createClient(process.env.SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: link, error: lErr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: owner.email });
  if (lErr) throw new Error(`generateLink: ${lErr.message}`);
  const { data: v, error: vErr } = await anon().auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (vErr) throw new Error(`verifyOtp: ${vErr.message}`);
  let session = v.session;
  return {
    userId: owner.id,
    session,
    async release() {
      const out = [];
      if (session) {
        const c = anon();
        await c.auth.setSession(session).catch(() => {});
        const { error: sErr } = await c.auth.signOut({ scope: 'local' });
        out.push(`session signed out (local): ${sErr ? sErr.message : 'ok'}`);
        session = null;
      }
      const r = await svc.from('profiles').update({ last_seen_at: owner.last_seen_at }).eq('id', owner.id);
      const { count } = await svc.from('auth_events').select('*', { count: 'exact', head: true }).eq('user_id', owner.id).eq('event', 'sign_in').gt('id', maxEvt);
      out.push(`last_seen_at restored: ${r.error ? r.error.message : 'ok'}`, `sign_in rows added (kept, by rule): ${count}`);
      return out.join(' · ');
    },
  };
}
