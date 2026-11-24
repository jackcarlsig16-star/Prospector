// Microsoft's error_description can quote the signed-in address, so only the AADSTS code and the error token are ever
// read from it; every word shown to a person comes from this file.
const NEEDS_ADMIN = new Set(['65001', '90094', '900941']);
const OTHER_ORG = new Set(['50020', '90072']);
const SIGN_IN = new Set(['50076', '50078', '50079', '50158', '53003']);
const CONFIG = {
  700016: 'the app is not registered in this Microsoft organization',
  90002: 'the Microsoft organization id is wrong',
  50011: 'the redirect address is not registered on the Microsoft app',
  7000215: 'the client secret is wrong',
  7000222: 'the client secret expired',
};
const CONFIG_TOKENS = new Set(['invalid_client', 'unauthorized_client', 'redirect_uri_mismatch']);

export const OTHER_ORG_TEXT = 'this mailbox is in a different Microsoft organization than Prospector is registered to';
export const permissionsOf = scopes => (scopes || []).filter(s => !/^(openid|offline_access)$/i.test(s));

export function errorFamily({ error, description, codes } = {}, asked = []) {
  const code = String((String(description || '').match(/AADSTS(\d+)/) || [])[1] || (codes || [])[0] || '');
  const token = String(error || '').toLowerCase().replace(/[^a-z_]/g, '').slice(0, 40);
  const out = (family, text) => ({ family, text, code: code ? `AADSTS${code}` : token || null });
  if (NEEDS_ADMIN.has(code) || token === 'consent_required' || token === 'admin_consent_required') return out('needs_admin', `needs admin approval for: ${permissionsOf(asked).join(', ') || 'this app'}`);
  if (OTHER_ORG.has(code)) return out('other_org', OTHER_ORG_TEXT);
  if (CONFIG[code] || CONFIG_TOKENS.has(token)) return out('config', `Prospector's Microsoft setup is wrong on the server (${CONFIG[code] || token.replace(/_/g, ' ')})`);
  if (SIGN_IN.has(code) || token === 'interaction_required' || token === 'login_required') return out('sign_in', 'Microsoft wants a fresh sign-in (password or sign-in rules changed)');
  if (token === 'invalid_grant') return out('expired', 'expired (90 days unused / revoked)');
  if (token === 'access_denied') return out('declined', 'access was not granted on Microsoft\'s screen (if it said "Need admin approval", an admin has to approve first)');
  return out('unknown', `Microsoft error ${code ? `AADSTS${code}` : token || 'with no code'}`);
}

// A grant row's stored error back to its family (rows written before the families existed say "expired or was revoked").
export function storedFamily(text) {
  if (!text) return null;
  const family = /admin approval/i.test(text) ? 'needs_admin' : /fresh sign-in/i.test(text) ? 'sign_in' : /expired/i.test(text) ? 'expired' : 'unknown';
  return { family, text: family === 'expired' ? 'expired (90 days unused / revoked)' : text.replace(/^Microsoft access /, '').replace(/ - reconnect$/, '') };
}
