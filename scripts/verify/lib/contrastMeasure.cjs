// ui-clarity-v1 - the in-page contrast measurement (Stage 0's MEASURE, shared by the Stage 1 and Stage 2 checks).
// Composites every rendered text node and control through its ancestors (opacity groups, rgba, single-colour gradients)
// and reports text < 4.5:1 (3:1 for >= 24 px or >= 18.5 px bold) and control boundaries < 3:1. A control's boundary is
// the best of fill / any-side border / non-inset box-shadow / outline against what is outside it. A control with no
// edge at all passes only as a tertiary link: it (or a descendant carrying its label) is underlined ("via underline").
// Form controls draw their value / placeholder themselves: measured against the control's own fill. A select inside a
// .ui-filter--pill is measured by the pill's edge (the pill is the control the eye sees).
//
//   measureScript({ scope: '[data-ui-gallery]', exclude: '[data-before]' })  -> string for page.evaluate
//   summarize(result)                                                        -> counts + dedupedworst lists
module.exports.measureScript = function measureScript({ scope = '#sales-analytics-root', exclude = '' } = {}) {
  return `(() => {
  const scope = document.querySelector(${JSON.stringify(scope)});
  if (!scope) return { error: 'no scope ' + ${JSON.stringify(scope)} };
  const excluded = el => ${exclude ? `!!el.closest(${JSON.stringify(exclude)})` : 'false'};
  const cv = document.createElement('canvas').getContext('2d');
  const cache = new Map();
  const parse = s => {
    if (cache.has(s)) return cache.get(s);
    let m = /^rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)$/.exec(s), out;
    if (m) out = [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]];
    else { m = /^color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)(?: \\/ ([\\d.]+))?\\)$/.exec(s);
      if (m) out = [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] == null ? 1 : +m[4]];
      else { cv.fillStyle = '#000'; cv.fillStyle = s; const f = cv.fillStyle;
        if (/^#/.test(f)) out = [parseInt(f.slice(1, 3), 16), parseInt(f.slice(3, 5), 16), parseInt(f.slice(5, 7), 16), 1];
        else { const n = /rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/.exec(f); out = n ? [+n[1], +n[2], +n[3], n[4] == null ? 1 : +n[4]] : [0, 0, 0, 0]; } } }
    if (s === 'transparent' || s === 'none' || s === '') out = [0, 0, 0, 0];
    cache.set(s, out); return out;
  };
  const over = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
  const mix = (a, b, t) => [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t, a[2] * (1 - t) + b[2] * t, 1];
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const hex = c => '#' + [0, 1, 2].map(i => Math.round(c[i]).toString(16).padStart(2, '0')).join('');
  // A gradient is measured at every colour stop (a two-colour ombre counts as its worst stop).
  const gradStops = img => { if (!/^linear-gradient\\(/.test(img)) return []; const stops = img.match(/rgba?\\([^)]*\\)|color\\([^)]*\\)/g) || []; return [...new Set(stops)].map(parse); };
  const bgOf = (el, cs) => { const c = parse(cs.backgroundColor); const stops = cs.backgroundImage !== 'none' ? gradStops(cs.backgroundImage) : []; return { bg: stops.length ? over(stops[0], c) : c, alts: stops.slice(1).map(s => over(s, c)) }; };
  const chainOf = el => { const chain = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); const b = bgOf(e, cs); chain.push({ el: e, bg: b.bg, alts: b.alts, op: +cs.opacity }); } return chain.reverse(); };
  // Every chain variant: the nearest ancestor with extra gradient stops swapped in, one at a time.
  const variants = chain => { const i = chain.findLastIndex(x => x.alts.length); if (i < 0) return [chain]; return [chain, ...chain[i].alts.map(a => chain.map((x, j) => (j === i ? { ...x, bg: a } : x)))]; };
  const worstRatio = (chain, fgRaw) => { let best = null; for (const ch of variants(chain)) { const fg = paint(ch, 0, CANVAS, parse(fgRaw)); const bg = paint(ch, 0, CANVAS, null); const r = ratio(fg, bg); if (!best || r < best.r) best = { r, fg, bg }; } return best; };
  const CANVAS = [255, 255, 255, 1];
  const paint = (chain, i, under, text) => { const base = over(chain[i].bg, under); const inner = i === chain.length - 1 ? (text ? over(text, base) : base) : paint(chain, i + 1, base, text); return mix(under, inner, chain[i].op); };
  const visible = el => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const HOOKS = ['data-role', 'data-theme-panel', 'data-chart', 'data-section', 'data-company-panel', 'data-center-window', 'data-row', 'data-filter-row', 'data-channel-row', 'data-sales-tabrow', 'data-sales-subviews', 'data-actions', 'data-pipeline-people', 'data-pipeline-companies', 'data-goals-section'];
  const hook = el => { for (let e = el; e; e = e.parentElement) { if (e.id) return '#' + e.id; for (const a of HOOKS) if (e.hasAttribute(a)) return '[' + a + (e.getAttribute(a) ? '="' + e.getAttribute(a) + '"' : '') + ']'; } return ''; };
  const sel = el => { const t = el.tagName.toLowerCase(); const cls = [...el.classList].slice(0, 2).map(c => '.' + c).join(''); const al = el.getAttribute('aria-label'); const role = el.getAttribute('role'); return (hook(el) ? hook(el) + ' ' : '') + t + cls + (role ? '[role=' + role + ']' : '') + (al ? '[aria-label="' + al.slice(0, 28) + '"]' : '') + (el.hasAttribute('aria-pressed') ? '[aria-pressed=' + el.getAttribute('aria-pressed') + ']' : '') + (el.disabled || el.getAttribute('aria-disabled') === 'true' ? ':disabled' : ''); };
  const isDisabled = el => { for (let e = el; e; e = e.parentElement) if (e.disabled || e.getAttribute('aria-disabled') === 'true') return true; return false; };
  const px = v => parseFloat(v) || 0;
  const bigText = cs => { const s = px(cs.fontSize), w = +cs.fontWeight || 400; return s >= 24 || (s >= 18.5 && w >= 700); };
  const panelOf = el => { const p = el.closest('[data-theme-panel]'); return p ? p.getAttribute('data-theme-panel') : 'page'; };
  const texts = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const s = n.textContent.replace(/\\s+/g, ' ').trim(); if (!s) continue;
    const el = n.parentElement; if (!el || ['SCRIPT', 'STYLE', 'TITLE', 'OPTION', 'NOSCRIPT'].includes(el.tagName)) continue;
    if (!visible(el) || excluded(el)) continue;
    const rg = document.createRange(); rg.selectNodeContents(n); const r = rg.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    const isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
    const fgRaw = isSvg && cs.fill && cs.fill !== 'none' ? cs.fill : cs.color;
    const w = worstRatio(chainOf(el), fgRaw);
    texts.push({ sel: sel(el), panel: panelOf(el), text: s.slice(0, 26), fg: hex(w.fg), bg: hex(w.bg), ratio: Math.round(w.r * 100) / 100, size: px(cs.fontSize), big: bigText(cs), disabled: isDisabled(el), kind: 'text' });
  }
  for (const el of scope.querySelectorAll('input, select, textarea')) {
    if (!visible(el) || excluded(el) || ['checkbox', 'radio', 'range', 'color', 'file', 'hidden'].includes(el.type)) continue;
    const cs = getComputedStyle(el); const chain = chainOf(el);
    const hasValue = el.tagName === 'SELECT' ? true : !!el.value;
    const fgRaw = hasValue ? cs.color : getComputedStyle(el, '::placeholder').color;
    const label = el.tagName === 'SELECT' ? (el.selectedOptions[0]?.textContent || '') : (el.value || el.placeholder || '');
    if (!label) continue;
    const w = worstRatio(chain, fgRaw);
    texts.push({ sel: sel(el), panel: panelOf(el), text: (hasValue ? '' : '(placeholder) ') + label.slice(0, 22), fg: hex(w.fg), bg: hex(w.bg), ratio: Math.round(w.r * 100) / 100, size: px(cs.fontSize), big: false, disabled: isDisabled(el), kind: 'text' });
  }
  const controls = [];
  const seen = new Set();
  const underlined = el => { const has = e => /underline/.test(getComputedStyle(e).textDecorationLine); if (has(el)) return true; for (const d of el.querySelectorAll('*')) if (d.textContent.trim() && has(d)) return true; return false; };
  for (const el of scope.querySelectorAll('button, input, select, textarea, a[href], [role=button], [role=tab], [role=switch], [role=checkbox], [role=menuitem], summary')) {
    if (!visible(el) || excluded(el) || seen.has(el)) continue; seen.add(el);
    if (el.tagName === 'INPUT' && ['checkbox', 'radio'].includes(el.type)) continue; // drawn by the browser, no CSS edge to read
    // A select drawn inside a one-piece pill (FilterSelect variant="pill") has no edge of its own: the pill's is its edge.
    const box = (el.tagName === 'SELECT' && el.closest('.ui-filter--pill')) || el;
    const cs = getComputedStyle(box); const chain = chainOf(box);
    const outside = chain.length > 1 ? paint(chain.slice(0, -1), 0, CANVAS, null) : CANVAS;
    const own = chain[chain.length - 1];
    const cands = [];
    const fill = own.bg; if (fill[3] > 0) cands.push(['fill', mix(outside, over(fill, outside), own.op)]);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (px(cs['border' + side + 'Width']) > 0 && cs['border' + side + 'Style'] !== 'none') { const bc = parse(cs['border' + side + 'Color']); if (bc[3] > 0) cands.push(['border', mix(outside, over(bc, over(fill, outside)), own.op)]); }
    }
    if (cs.boxShadow && cs.boxShadow !== 'none') { const m = /(rgba?\\([^)]*\\)|color\\([^)]*\\))/.exec(cs.boxShadow); if (m) { const sc = parse(m[1]); if (sc[3] > 0 && !/inset/.test(cs.boxShadow)) cands.push(['shadow', mix(outside, over(sc, outside), own.op)]); } }
    if (cs.outlineStyle !== 'none' && px(cs.outlineWidth) > 0) { const oc = parse(cs.outlineColor); if (oc[3] > 0) cands.push(['outline', over(oc, outside)]); }
    let best = ['none', 1];
    for (const [k, c] of cands) { const r = ratio(c, outside); if (r > best[1]) best = [k, r]; }
    if (best[1] < 3 && underlined(el)) { const fg = paint(chain, 0, CANVAS, parse(cs.color)); best = ['underline', ratio(fg, paint(chain, 0, CANVAS, null))]; }
    const label = (el.getAttribute('aria-label') || el.textContent || el.value || el.placeholder || '').replace(/\\s+/g, ' ').trim().slice(0, 26);
    controls.push({ sel: sel(el), panel: panelOf(el), text: label, via: best[0], ratio: Math.round(best[1] * 100) / 100, bg: hex(outside), disabled: isDisabled(el), kind: 'control', textOnly: best[0] === 'none' });
  }
  return { texts, controls, url: location.href, scrollW: document.documentElement.scrollWidth, vw: innerWidth };
})()`;
};

const dedupe = list => { const map = new Map(); for (const x of list) { const k = x.sel + '|' + (x.fg || x.via) + '|' + x.bg; const e = map.get(k); if (e) e.n++; else map.set(k, { ...x, n: 1 }); } return [...map.values()].sort((a, b) => a.ratio - b.ratio); };

module.exports.summarize = function summarize(m) {
  const failT = m.texts.filter(t => t.ratio < (t.big ? 3 : 4.5));
  const failC = m.controls.filter(c => c.ratio < 3);
  const perPanel = {};
  for (const x of [...m.texts, ...m.controls]) {
    const p = perPanel[x.panel] ||= { texts: 0, textFails: 0, controls: 0, controlFails: 0 };
    if (x.kind === 'text') { p.texts++; if (x.ratio < (x.big ? 3 : 4.5)) p.textFails++; } else { p.controls++; if (x.ratio < 3) p.controlFails++; }
  }
  return {
    url: m.url, scrollW: m.scrollW, vw: m.vw,
    texts: m.texts.length, textFails: failT.length, textFailsDisabled: failT.filter(t => t.disabled).length, textDistinctFails: dedupe(failT).length,
    controls: m.controls.length, controlFails: failC.length, controlFailsTextOnly: failC.filter(c => c.textOnly).length, controlFailsDisabled: failC.filter(c => c.disabled).length,
    perPanel,
    worst: dedupe([...failT, ...failC]).slice(0, 10),
    worstText: dedupe(failT).slice(0, 10), worstControls: dedupe(failC).slice(0, 10),
  };
};

module.exports.formatWorst = (key, s) => [`== ${key} - ${s.worst.length ? '10 worst' : 'no failures'} (ratio · kind · selector · sample)`, ...s.worst.map(w => `  ${String(w.ratio).padEnd(5)} ${w.kind === 'text' ? `T ${w.fg} on ${w.bg}` : `C via ${w.via} on ${w.bg}`} x${w.n}${w.disabled ? ' disabled' : ''}  ${w.sel}  "${w.text}"`)].join('\n');
