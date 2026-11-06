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
<table role="presentation" cellpadding="0" cellspacing="0" width="680" style="width:100%;max-width:680px;background:#ffffff;border:1px solid ${RULE};border-radius:10px;${FONT};font-size:14px;line-height:1.5;color:${INK}"><tr><td style="padding:24px">
<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${ACCENT};font-weight:600">${esc(eyebrow)}</div>
<div style="font-size:20px;font-weight:700;margin:4px 0 2px">${esc(title)}</div>
${sub ? `<div style="font-size:13px;color:${MUTED};margin-bottom:16px">${esc(sub)}</div>` : ''}
${body}
<div style="color:${MUTED};font-size:12px;margin-top:24px;border-top:1px solid ${RULE};padding-top:12px">${esc(FOOTER)}</div>
</td></tr></table></td></tr></table></body></html>`;
export const withFooter = text => `${text}\n\n—\n${FOOTER}`;

// FIX visitor-email-v2 - the dark visitor email: the app's tokens, tables + inline styles only, no fixed px widths on
// the data tables (a 390 phone keeps every column), the stat tiles as two rows of 50 % cells. The client alert keeps
// the light shell above.
export const DARK = { ground: '#0B0D10', card: '#12161B', surface: '#1E242C', text: '#E9ECF0', soft: '#C9D0D9', muted: '#A8B2C0', faint: '#6B7480', link: '#AFC0FF', rule: 'rgba(120,130,144,.35)', accent: '#FF8A3D', good: '#3DD68C', bad: '#FF7878' };
export const BAND_HUE = { P1: '#FF9F57', P2: '#F2C94C', P3: '#4FD1C5', P4: '#94A3B8' };
export const SANS = 'Geist,Arial,sans-serif';
export const MONO = 'Geist Mono,Menlo,Courier,monospace';
export const dlink = (href, label, bold = false) => `<a href="${esc(href)}" style="color:${DARK.link};text-decoration:none${bold ? ';font-weight:600' : ''}">${esc(label)}</a>`;
// A filled tag (NEW / RETURNING): ground-colored 10 px bold text on the hue.
export const tagPill = (label, hue) => `<span style="display:inline-block;padding:1px 7px;border-radius:999px;background:${hue};color:${DARK.ground};font:700 10px ${SANS};letter-spacing:.06em;vertical-align:2px;margin-left:6px">${esc(label)}</span>`;
// An outlined pill in the band's hue (the intent and the intent counts).
export const outlinePill = (label, hue) => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid ${hue};color:${hue};font:600 12px ${SANS};white-space:nowrap">${esc(label)}</span>`;
export const memberDot = color => `<span style="white-space:nowrap"><span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${color || BAND_HUE.P4};margin-right:5px;vertical-align:0"></span>`;
// Stat tiles: [[value, label, sub, hue?]] as two <tr>s of 50 % cells, so a phone shows 2 × 2 and nothing clips.
export const tileGrid = list => {
  const cell = ([v, l, s, hue]) => `<td width="50%" style="padding:0 4px;vertical-align:top"><div style="background:${DARK.surface};border:1px solid ${DARK.rule};border-radius:10px;padding:12px 14px"><div style="font:600 26px ${SANS};letter-spacing:-.02em;color:${hue || DARK.text}">${esc(v)}</div><div style="font:600 12px ${SANS};color:${DARK.text};margin-top:2px">${esc(l)}</div><div style="font:11.5px ${SANS};color:${DARK.muted};line-height:1.35">${esc(s)}</div></div></td>`;
  const rows = [];
  for (let i = 0; i < list.length; i += 2) rows.push(`<tr>${list.slice(i, i + 2).map(cell).join('')}</tr>`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 8px;margin:0 -4px">${rows.join('')}</table>`;
};
// A data table: heads = labels, widths = % per column (they sum to 100), rows = arrays of ready HTML cells. Fixed layout, so
// the table never grows past its container on a phone; a long word breaks inside its cell instead.
export const dataTable = (heads, widths, rows) => {
  const th = (h, i) => `<th width="${widths[i]}%" style="text-align:left;padding:0 ${i === widths.length - 1 ? 0 : 6}px 6px ${i ? 6 : 0}px;font:500 10.5px ${MONO};letter-spacing:.08em;text-transform:uppercase;color:${DARK.faint}">${esc(h)}</th>`;
  const td = (c, i) => `<td width="${widths[i]}%" style="padding:10px ${i === widths.length - 1 ? 0 : 6}px 10px ${i ? 6 : 0}px;vertical-align:top;border-top:1px solid ${DARK.rule};font-size:12.5px;line-height:1.4;color:${DARK.soft};overflow-wrap:anywhere">${c}</td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;margin-top:12px;font-family:${SANS};color:${DARK.text}">
<tr>${heads.map(th).join('')}</tr>
${rows.map(r => `<tr>${r.map(td).join('')}</tr>`).join('\n')}
</table>`;
};
export const darkShell = ({ eyebrow, title, sub, body }) => `<!DOCTYPE html><html><body style="margin:0;padding:0;background:${DARK.ground}">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${DARK.ground}"><tr><td align="center" style="padding:24px 8px">
<table role="presentation" cellpadding="0" cellspacing="0" width="640" style="width:100%;max-width:640px;background:${DARK.card};border:1px solid ${DARK.rule};border-radius:14px;font-family:${SANS};font-size:14px;line-height:1.5;color:${DARK.text}"><tr><td style="padding:28px 20px">
<div style="font:600 11px ${MONO};letter-spacing:.1em;text-transform:uppercase;color:${DARK.accent}">${esc(eyebrow)}</div>
<div style="font:600 24px ${SANS};letter-spacing:-.02em;line-height:1.2;margin-top:8px">${esc(title)}</div>
<div style="font:13px ${SANS};color:${DARK.muted};margin-top:6px">${sub}</div>
${body}
</td></tr></table></td></tr></table></body></html>`;
