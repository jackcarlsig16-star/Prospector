// One request through the REAL wiring: the server.js the script spawned (sessionAuth cookie -> hkGate -> hkRoute(file,
// name), which calls the handler with (req, res) only). An in-process call injects deps and proved the logic but not the
// deployment (FIX inbox-tokenfor-v1: "d.tokenFor is not a function" on prod after 13/13 live). Never prints the body.
import { SESSION_COOKIE } from '../../../api/lib/authUser.js';

export async function realGet({ base, businessId, session, path }) {
  const r = await fetch(`${base}/api/hk/${businessId}${path}`, { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(session.access_token)}` } });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  return { code: r.status, body };
}

export const keysOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().join(',') : typeof v);
