// homelover-team-emails-v1 T6 (REV2) - email-safe HTML: tables and inline styles only (Outlook ignores most CSS), no
// images, no tracking, plus a plain-text part with the same content.
export const ORIGIN = process.env.PUBLIC_APP_ORIGIN || 'https://prospector-chtj.onrender.com';
export const FOOTER = 'Sent by Prospector to the HomeLover team · manage recipients in Sales › Settings › Team emails';
export const MAP_URL = `${ORIGIN}/?tab=pipeline&view=priorities`;
// There is no per-visitor link: a company not in Prospector opens the Website visitors list, where Add lives.
export const VISITORS_URL = `${ORIGIN}/?tab=pipeline&view=companies&channel=website_visit`;
export const recordUrl = (type, id) => `${ORIGIN}/?tab=pipeline&view=companies&open=${type}-${id}`;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const INK = '#1f2430', MUTED = '#6b7280', RULE = '#e5e7eb', LINK = '#3D5FD9', ACCENT = '#C97626';
export const link = (href, label, style = '') => `<a href="${esc(href)}" style="color:${LINK};text-decoration:none;${style}">${esc(label)}</a>`;
export const pill = (label, fg, bg) => `<span style="display:inline-block;padding:1px 8px;border-radius:10px;background:${bg};color:${fg};font-size:12px;font-weight:600;white-space:nowrap">${esc(label)}</span>`;
export const dot = (color, dashed = false) => `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;${dashed ? `border:1px dashed ${MUTED}` : `background:${color}`};margin-right:6px;vertical-align:middle"></span>`;
const FONT = 'font-family:-apple-system,Segoe UI,Arial,sans-serif';

// One stat tile row: [[value, label, color?]].
export const tiles = list => `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;border-spacing:8px 0;margin:0 -8px 16px"><tr>${list.map(([v, l, c]) =>
  `<td style="border:1px solid ${RULE};border-radius:8px;padding:10px 12px;width:${Math.floor(100 / list.length)}%"><div style="font-size:22px;font-weight:700;color:${c || INK}">${esc(v)}</div><div style="font-size:12px;color:${MUTED}">${esc(l)}</div></td>`).join('')}</tr></table>`;

// A data table: heads = labels, rows = arrays of ready HTML cells.
export const table = (heads, rows) => `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:13px">
<tr>${heads.map(h => `<th align="left" style="padding:6px 8px;border-bottom:1px solid ${RULE};color:${MUTED};font-weight:500;font-size:12px">${esc(h)}</th>`).join('')}</tr>
${rows.map(r => `<tr>${r.map(c => `<td valign="top" style="padding:8px;border-bottom:1px solid ${RULE};color:${INK}">${c}</td>`).join('')}</tr>`).join('\n')}
</table>`;

export const shell = ({ eyebrow, title, sub, body }) => `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f7f9">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f7f9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" width="680" style="max-width:680px;background:#ffffff;border:1px solid ${RULE};border-radius:10px;${FONT};font-size:14px;line-height:1.5;color:${INK}"><tr><td style="padding:24px">
<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${ACCENT};font-weight:600">${esc(eyebrow)}</div>
<div style="font-size:20px;font-weight:700;margin:4px 0 2px">${esc(title)}</div>
${sub ? `<div style="font-size:13px;color:${MUTED};margin-bottom:16px">${esc(sub)}</div>` : ''}
${body}
<div style="color:${MUTED};font-size:12px;margin-top:24px;border-top:1px solid ${RULE};padding-top:12px">${esc(FOOTER)}</div>
</td></tr></table></td></tr></table></body></html>`;
export const withFooter = text => `${text}\n\n—\n${FOOTER}`;
