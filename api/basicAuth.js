'use strict';
const crypto = require('crypto');

// Third parties call these server-to-server and can't send Basic credentials.
// Exact path matches only - additions need Jack's OK (prospector-basic-auth-v1).
const EXEMPT_PATHS = new Set(['/api/zoom/webhook']);

// Hashing both sides gives equal-length buffers, so timingSafeEqual never
// throws and a length mismatch can't leak through timing.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function basicAuth(req, res, next) {
  if (EXEMPT_PATHS.has(req.path)) return next();

  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (!user || !pass) {
    if (process.env.NODE_ENV !== 'production' && process.env.BASIC_AUTH_DISABLED_LOCAL === '1') return next();
    return res.status(503).send('Auth not configured');
  }

  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  let given = '';
  if (scheme === 'Basic' && encoded) given = Buffer.from(encoded, 'base64').toString('utf8');
  const sep = given.indexOf(':');
  const givenUser = sep === -1 ? '' : given.slice(0, sep);
  const givenPass = sep === -1 ? '' : given.slice(sep + 1);

  // Evaluate both compares unconditionally so a correct username isn't
  // distinguishable by timing.
  const userOk = safeEqual(givenUser, user);
  const passOk = safeEqual(givenPass, pass);
  if (userOk && passOk) return next();

  res.set('WWW-Authenticate', 'Basic realm="Prospector"');
  return res.status(401).send('Authentication required');
}

module.exports = { basicAuth };
