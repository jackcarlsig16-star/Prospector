import DOMPurify from 'dompurify';

// hkos-inbox-v1 (I2, planner ruling Oct 26) - email HTML is untrusted and arrives raw from the owner's own mailbox.
// It is cleaned here, in the browser, before it goes into a sandboxed iframe's srcdoc: scripts, styles, frames,
// objects, forms and <base> go; every remote image source is swapped for a 1x1 placeholder and kept in
// data-blocked-src until the reader asks for images (tracking pixels stay blocked by default); links open in a new
// tab without an opener. A fresh DOMPurify instance per call keeps the hooks from stacking.
export const BLOCKED_SRC = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export const FORBID_TAGS = ['script', 'style', 'link', 'meta', 'iframe', 'object', 'embed', 'form', 'base', 'input', 'button', 'textarea', 'select'];
const SRC_TAGS = new Set(['IMG', 'PICTURE', 'SOURCE', 'VIDEO', 'AUDIO']);
const REMOTE_URL = /url\s*\(/i;

export function sanitizeEmailHtml(html, { showImages = false } = {}) {
  if (!html) return '';
  const purify = DOMPurify(window);
  purify.addHook('afterSanitizeAttributes', node => {
    if (SRC_TAGS.has(node.nodeName)) {
      for (const attr of ['src', 'srcset', 'poster']) {
        const v = node.getAttribute(attr);
        if (!v) continue;
        if (showImages) continue;
        node.setAttribute(`data-blocked-${attr}`, v);
        if (attr === 'src') node.setAttribute('src', BLOCKED_SRC); else node.removeAttribute(attr);
      }
    }
    if (!showImages && REMOTE_URL.test(node.getAttribute('style') || '')) node.removeAttribute('style');
    if (!showImages && node.hasAttribute('background')) node.removeAttribute('background');
    if (node.nodeName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return purify.sanitize(html, { FORBID_TAGS, FORBID_ATTR: ['onerror', 'onload', 'formaction'], ADD_ATTR: ['target'], WHOLE_DOCUMENT: false });
}

// The srcdoc for the reading frame: the cleaned html inside a minimal document with our own base styles. The frame
// itself carries sandbox="" (no scripts, no same origin, no forms) - see InboxScreen.
export const frameDoc = body => `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:12px 16px;font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#2B1D14;background:#fff;word-break:break-word}img{max-width:100%}blockquote{border-left:3px solid #ddd;margin:8px 0;padding-left:10px;color:#555}</style></head><body>${body}</body></html>`;
