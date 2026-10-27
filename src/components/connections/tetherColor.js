// mailbox-connections-v1 REV2 (M6) - a workspace color as a 2 px line must read at 3:1 on the card surface. Too light
// or too dark a color is nudged toward the opposite of the surface until it passes (computed, never guessed).
const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim()); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null; };
const toHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lum = rgb => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [l1, l2] = [lum(hex(a) || [0, 0, 0]), lum(hex(b) || [0, 0, 0])].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
const mix = (rgb, to, t) => rgb.map((v, i) => v + (to[i] - v) * t);

export function lineColor(color, surface, min = 3) {
  const rgb = hex(color);
  if (!rgb) return { color: '#888888', adjusted: false, ratio: contrast('#888888', surface) };
  if (contrast(color, surface) >= min) return { color: toHex(rgb), adjusted: false, ratio: contrast(color, surface) };
  const target = lum(hex(surface) || [0, 0, 0]) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = toHex(mix(rgb, target, t));
    if (contrast(c, surface) >= min) return { color: c, adjusted: true, ratio: contrast(c, surface) };
  }
  return { color: toHex(target), adjusted: true, ratio: contrast(toHex(target), surface) };
}
