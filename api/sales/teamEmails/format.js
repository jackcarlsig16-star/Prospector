// homelover-team-emails-v1 T6 - plain HTML, the app's colors as text accents only, no images, no tracking pixels.
export const ORIGIN = process.env.PUBLIC_APP_ORIGIN || 'https://prospector-chtj.onrender.com';
export const FOOTER = 'Sent by Prospector to the HomeLover team · turn off in Settings › Team emails';
export const MAP_URL = `${ORIGIN}/?tab=pipeline&view=priorities`;
export const recordUrl = (type, id) => `${ORIGIN}/?tab=pipeline&view=companies&open=${type}-${id}`;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const link = (href, label) => `<a href="${esc(href)}" style="color:#6F8CF0">${esc(label)}</a>`;
export const page = (title, parts) => `<!DOCTYPE html><html><body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2430">
<h2 style="font-size:17px;margin:0 0 12px">${esc(title)}</h2>
${parts.join('\n')}
<p style="color:#6b7280;font-size:12px;margin-top:24px">${esc(FOOTER)}</p>
</body></html>`;
export const withFooter = text => `${text}\n\n—\n${FOOTER}`;
