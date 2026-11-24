import { getGrant, microsoftConfigured, canSendTeamEmail, MICROSOFT_SCOPES } from '../lib/microsoftGrants.js';
import { storedFamily, permissionsOf, OTHER_ORG_TEXT } from './errorFamily.js';
import { isOwner } from './connect.js';
import { redirectUri } from './oauth.js';

export const SEND_NEEDED = 'Sending needs the owner\'s Mail.Send grant';
export const ADMIN_NOTE = 'Please open this link signed in as a Microsoft 365 admin and click Accept. It approves Prospector to read mail and calendar and to send our internal team emails. You may land on a Prospector sign-in page afterwards - the approval is already saved by then.';

const GRAPH = 'https://graph.microsoft.com/';

// Client id and tenant id are identifiers, not secrets; the link is still owner-only.
export function adminConsentUrl({ tenantId, clientId, redirect }) {
  const scope = permissionsOf(MICROSOFT_SCOPES).map(s => GRAPH + s).join(' ');
  return `https://login.microsoftonline.com/${tenantId}/v2.0/adminconsent?${new URLSearchParams({ client_id: clientId, scope, redirect_uri: redirect })}`;
}

export function statusBody({ grant, configured, owner, tenantId, clientId, redirect }) {
  const otherOrg = !!grant && !!tenantId && !!grant.tenant_id && grant.tenant_id !== tenantId;
  const canSend = canSendTeamEmail(grant);
  return {
    configured,
    connected: !!grant,
    email: grant?.account_email || null,
    domain: grant?.account_email?.split('@')[1] || null,
    organization: grant?.tenant_id ? `…${grant.tenant_id.slice(-4)}` : null,
    scopes: grant?.scopes || [],
    connected_at: grant?.connected_at || null,
    last_used_at: grant?.last_used_at || null,
    error: grant?.error || null,
    problem: storedFamily(grant?.error) || (otherOrg ? { family: 'other_org', text: OTHER_ORG_TEXT } : null),
    last_refresh: !grant ? null : grant.error ? { ok: false, at: grant.updated_at || null } : grant.last_used_at ? { ok: true, at: grant.last_used_at } : null,
    is_owner: owner,
    can_send: canSend,
    team_email: !grant ? null : canSend ? 'ready' : owner ? SEND_NEEDED : null,
    admin_consent: owner && configured ? { url: adminConsentUrl({ tenantId, clientId, redirect }), note: ADMIN_NOTE } : null,
  };
}

// GET /api/microsoft/status - which Microsoft account the signed-in user connected, and what is wrong with it.
export default async function handler(req, res) {
  res.json(statusBody({
    grant: await getGrant(req.auth.user.id),
    configured: microsoftConfigured(),
    owner: isOwner(req.auth),
    tenantId: process.env.MICROSOFT_TENANT_ID,
    clientId: process.env.MICROSOFT_CLIENT_ID,
    redirect: redirectUri(req),
  }));
}
