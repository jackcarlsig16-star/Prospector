// hkos-gmail-connect-v1 (G3) - the MIME a HumanKind draft is saved with. Pure: no Gmail call, no DB. The server owns
// the To header (the contact's address never passes through the browser); the browser never sees the raw message.
// Markdown here is the small subset drafts use: blank-line paragraphs, single line breaks, one bare URL hyperlinked.
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
export const DASHES = /[–—]/;

export function markdownToHtml(markdown) {
  const paragraphs = String(markdown || '').replace(/\r\n/g, '\n').trim().split(/\n{2,}/);
  return paragraphs.map(p => {
    const lines = p.split('\n').map(line => escapeHtml(line).replace(URL_RE, url => `<a href="${url}">${url}</a>`));
    return `<p>${lines.join('<br>')}</p>`;
  }).join('\n');
}

// RFC 2047 for a non-ASCII subject; plain otherwise.
const encodeHeader = v => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`);
export const base64url = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const replySubject = s => (/^re:/i.test(String(s || '').trim()) ? String(s).trim() : `Re: ${String(s || '').trim()}`);

// { to?, subject, bodyMarkdown, signatureText?, inReplyTo?, references? } -> { raw, text, html, headers }.
// to is omitted for a test draft (Stage 4's live check) - the draft then has no recipient.
export function buildDraftMime({ to = null, subject, bodyMarkdown, signatureText = null, inReplyTo = null, references = null }) {
  if (DASHES.test(`${subject || ''}\n${bodyMarkdown || ''}\n${signatureText || ''}`)) throw new Error('draft text holds an em or en dash - lint first');
  const body = String(bodyMarkdown || '').replace(/\r\n/g, '\n').trim();
  const sig = signatureText ? String(signatureText).replace(/\r\n/g, '\n').trim() : '';
  const text = sig ? `${body}\n\n${sig}` : body;
  const html = `<div>${markdownToHtml(body)}${sig ? `\n${markdownToHtml(sig)}` : ''}</div>`;
  const boundary = `hk-${Buffer.from(String(subject || '') + body.length).toString('hex').slice(0, 16)}`;
  const headers = [];
  if (to) headers.push(`To: ${to}`);
  headers.push(`Subject: ${encodeHeader(String(subject || ''))}`);
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references || inReplyTo) headers.push(`References: ${references || inReplyTo}`);
  headers.push('MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`);
  const mime = [
    headers.join('\r\n'), '',
    `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', text, '',
    `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', html, '',
    `--${boundary}--`, '',
  ].join('\r\n');
  return { raw: base64url(mime), text, html, headers: Object.fromEntries(headers.filter(h => !/^(MIME-Version|Content-Type)/.test(h)).map(h => { const i = h.indexOf(': '); return [h.slice(0, i), h.slice(i + 2)]; })) };
}

// The link the caller opens: their own tethered mailbox (authuser) at the draft's message id.
export const draftUrl = (mailboxEmail, messageId) => `https://mail.google.com/mail/?authuser=${encodeURIComponent(mailboxEmail)}#drafts/${encodeURIComponent(messageId)}`;

// Gmail metadata helpers for G5: headers come back as [{ name, value }].
export const header = (msg, name) => (msg?.payload?.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || null;
export function parseAddress(v) {
  const s = String(v || '').trim();
  const m = /^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/.exec(s);
  const email = (m ? m[2] : s).trim().toLowerCase();
  const name = m ? m[1].trim() : '';
  const at = email.lastIndexOf('@');
  return { name: name || null, email: at > 0 ? email : null, domain: at > 0 ? email.slice(at + 1) : null };
}
