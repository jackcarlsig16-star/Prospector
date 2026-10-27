import { sanitizeEmailHtml, frameDoc, BLOCKED_SRC } from './sanitizeEmail';

// hkos-inbox-v1 Stage 1 - the browser-side sanitizer (planner ruling: option 3). Invented markup only.
const DIRTY = `<p>Hi Jack,</p><script>alert(1)</script><style>body{display:none}</style><link rel="stylesheet" href="https://evil.invalid/x.css"><meta http-equiv="refresh" content="0"><iframe src="https://evil.invalid"></iframe><object data="x"></object><embed src="x"><form action="https://evil.invalid/steal"><input name="pw"><button>Go</button></form><base href="https://evil.invalid/">
<img src="https://track.invalid/pixel.gif" width="1" height="1" onerror="alert(2)"><picture><source srcset="https://cdn.invalid/a.webp" type="image/webp"><img src="https://cdn.invalid/a.jpg" alt="Deck"></picture><video src="https://cdn.invalid/v.mp4" poster="https://cdn.invalid/p.jpg"></video>
<div style="background:url(https://track.invalid/bg.png)">text</div><td background="https://track.invalid/td.png">cell</td>
<a href="https://rumpl.invalid/deck" onclick="steal()">See the deck</a><a href="javascript:alert(3)">bad</a>`;

test('strips scripts, styles, frames, objects, forms and base; keeps the text', () => {
  const out = sanitizeEmailHtml(DIRTY);
  for (const tag of ['<script', '<style', '<link', '<meta', '<iframe', '<object', '<embed', '<form', '<input', '<button', '<base']) expect(out).not.toContain(tag);
  expect(out).not.toMatch(/on(error|click|load)=/i);
  expect(out).not.toContain('javascript:');
  expect(out).toContain('Hi Jack');
  expect(out).toContain('See the deck');
});

test('blocks every remote image source by default and keeps the original in data-blocked-src', () => {
  const out = sanitizeEmailHtml(DIRTY);
  expect(out).not.toMatch(/(?<![-\w])src="https:\/\/track\.invalid\/pixel\.gif"/);
  expect(out).toContain(`src="${BLOCKED_SRC}"`);
  expect(out).toContain('data-blocked-src="https://track.invalid/pixel.gif"');
  expect(out).toContain('data-blocked-src="https://cdn.invalid/a.jpg"');
  expect(out).toContain('data-blocked-srcset="https://cdn.invalid/a.webp"');
  expect(out).not.toMatch(/(?<![-\w])srcset="https:/);
  expect(out).toContain('data-blocked-poster="https://cdn.invalid/p.jpg"');
  expect(out).not.toMatch(/(?<![-\w])poster="https:/);
  expect(out).not.toContain('url(https://track.invalid/bg.png)');
  expect(out).not.toMatch(/(?<![-\w])background="https:/);
  expect(out.match(/(?<![-\w])src="https:/g)).toBeNull();
});

test('Show images restores the sources for that render only', () => {
  const shown = sanitizeEmailHtml(DIRTY, { showImages: true });
  expect(shown).toMatch(/(?<![-\w])src="https:\/\/track\.invalid\/pixel\.gif"/);
  expect(shown).toMatch(/(?<![-\w])src="https:\/\/cdn\.invalid\/a\.jpg"/);
  expect(shown).not.toContain('data-blocked-src');
  expect(shown).not.toContain('<script');
  expect(sanitizeEmailHtml(DIRTY)).toContain('data-blocked-src=');
});

test('links open in a new tab with no opener', () => {
  const out = sanitizeEmailHtml('<a href="https://rumpl.invalid/deck">Deck</a>');
  expect(out).toContain('target="_blank"');
  expect(out).toContain('rel="noopener noreferrer"');
});

test('frameDoc wraps the body in a self-contained document and empty input renders nothing', () => {
  expect(sanitizeEmailHtml('')).toBe('');
  expect(sanitizeEmailHtml(null)).toBe('');
  const doc = frameDoc('<p>x</p>');
  expect(doc.startsWith('<!doctype html>')).toBe(true);
  expect(doc).toContain('<p>x</p>');
});
