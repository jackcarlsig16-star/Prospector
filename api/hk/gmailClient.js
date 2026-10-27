// hkos-gmail-connect-v1 - the few Gmail REST calls the HumanKind loop makes, over fetch (no client library). Every
// method is a read, a draft create or a draft delete. There is no send path here and none may be added: the only
// writes are POST /drafts and DELETE /drafts/<id>. fetchFn is injected so tests run against a fake.
import { cleanText } from '../sales/scrubText.js';
import { header, parseAddress } from './gmailMime.js';

export const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const META = 'format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=Subject';
export class GmailError extends Error { constructor(status, message) { super(message); this.status = status; } }

export function gmailClient(fetchFn = (...a) => fetch(...a)) {
  const call = async (token, method, path, body) => {
    const r = await fetchFn(`${GMAIL}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 204) return null;
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!r.ok) throw new GmailError(r.status, String(data?.error?.message || text || r.status).slice(0, 200));
    return data;
  };
  return {
    createDraft: (token, { raw, threadId = null }) => call(token, 'POST', '/drafts', { message: { raw, ...(threadId ? { threadId } : {}) } }),
    getDraft: (token, id) => call(token, 'GET', `/drafts/${encodeURIComponent(id)}?format=metadata`),
    deleteDraft: (token, id) => call(token, 'DELETE', `/drafts/${encodeURIComponent(id)}`),
    listDrafts: async token => { const out = []; let pageToken = null; do { const d = await call(token, 'GET', `/drafts?maxResults=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`); out.push(...(d?.drafts || [])); pageToken = d?.nextPageToken || null; } while (pageToken && out.length < 500); return out; },
    getMessage: (token, id) => call(token, 'GET', `/messages/${encodeURIComponent(id)}?${META}`),
    getThread: (token, id) => call(token, 'GET', `/threads/${encodeURIComponent(id)}?${META}`),
    listThreads: (token, { labelIds = [], q = null, pageToken = null, maxResults = 50 } = {}) => call(token, 'GET', `/threads?maxResults=${maxResults}${labelIds.map(l => `&labelIds=${encodeURIComponent(l)}`).join('')}${q ? `&q=${encodeURIComponent(q)}` : ''}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`),
    getThreadMeta: (token, id) => call(token, 'GET', `/threads/${encodeURIComponent(id)}?${META}&metadataHeaders=List-Unsubscribe`),
    getThreadFull: (token, id) => call(token, 'GET', `/threads/${encodeURIComponent(id)}?format=full`),
    listHistory: async (token, startHistoryId) => { const history = []; let pageToken = null, historyId = null; do { const d = await call(token, 'GET', `/history?startHistoryId=${encodeURIComponent(startHistoryId)}&historyTypes=messageAdded&maxResults=500${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`); history.push(...(d?.history || [])); historyId = d?.historyId || historyId; pageToken = d?.nextPageToken || null; } while (pageToken && history.length < 2000); return { history, historyId }; },
    getProfile: token => call(token, 'GET', '/profile'),
    searchMessages: (token, q, maxResults = 1) => call(token, 'GET', `/messages?q=${encodeURIComponent(q)}&maxResults=${maxResults}`),
  };
}

// A Gmail message resource (metadata format) -> the flat shape syncRules reads. Snippet scrubbed and capped; nothing
// else of the body is ever kept.
export function toMeta(msg) {
  const dateHeader = header(msg, 'Date');
  const parsed = dateHeader ? Date.parse(dateHeader) : NaN;
  const date = !Number.isNaN(parsed) ? new Date(parsed).toISOString() : msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString();
  return { id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds || [], messageIdHeader: header(msg, 'Message-ID'), from: parseAddress(header(msg, 'From')), subject: header(msg, 'Subject'), date, snippet: cleanText(msg.snippet || '', 200) };
}
