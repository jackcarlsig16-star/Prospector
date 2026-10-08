import { GRAPH_URL } from './graphSync.js';

// microsoft-connect-v1 Stage 4c - Voice Profile samples from the caller's own
// Outlook Sent Items. Bodies are read for the one Claude request and never
// stored anywhere (the Stage 2 sync still selects no body).
export const SENT_SAMPLES_PATH = '/me/mailFolders/sentitems/messages?$top=50&$orderby=sentDateTime%20desc&$select=subject,sentDateTime,toRecipients,body';
export const MAX_SAMPLES = 25, MIN_SAMPLES = 3, BODY_CHARS = 800;

export async function fetchOutlookSentMessages(token, fetchImpl = fetch) {
  const r = await fetchImpl(`${GRAPH_URL()}${SENT_SAMPLES_PATH}`, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Microsoft Graph ${r.status}: ${data.error?.code || 'request failed'}`);
  return data.value || [];
}

// Same trim as the Gmail path (api/learn-voice.js) plus Outlook's own quoted
// headers, so only the sender's words reach the prompt.
export function extractOutlookSample(msg) {
  const to = (msg.toRecipients || []).map(r => String(r?.emailAddress?.address || '').toLowerCase().trim()).filter(Boolean);
  const body = String(msg.body?.content || '')
    .replace(/^On .+wrote:[\s\S]*/m, '')
    .replace(/^-+ ?Original Message ?-+[\s\S]*/mi, '')
    .replace(/^From: .+\n(Sent|Date): [\s\S]*/m, '')
    .replace(/^>.*$/mg, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, BODY_CHARS);
  return { to, subject: String(msg.subject || ''), date: msg.sentDateTime || '', body };
}

// External-only via the mailbox owners' domains (ownership() in graphSync.js),
// never a COMPANY_DOMAIN env: a mail with any own or noreply recipient is
// dropped, like the Gmail path.
export function externalSamples(messages, isOwn) {
  return messages.map(extractOutlookSample)
    .filter(e => e.body.length > 40 && e.to.length && !e.to.some(a => isOwn(a) || a.includes('noreply') || a.includes('no-reply')))
    .slice(0, MAX_SAMPLES);
}
