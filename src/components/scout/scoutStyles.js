import '../../ui/kitTheme';
import { T, KIT_MAX_WIDTH } from '../../ui/tokens';

// scout-v2 REV3 Stage 2 - the bar's look, from specs/design/scout-v2 (ScoutBar / ScoutAsk / ScoutPhone). Neon (D8) only
// on Scout's own parts: the star, the focus ring + glow, the sweep, matched text, the sort Scout chose, the keyboard
// row's bar + wash and the popover edge. Never a button fill. Scout's surfaces carry .ui-theme-dark, so neon text
// always sits on a dark ground (light mode included). The sweep is CSS; reduced motion keeps it still.
const N = T.neon;
const n = a => `color-mix(in srgb, ${N} ${a}%, transparent)`;
const edge = a => `color-mix(in srgb, var(--ui-border) ${a}%, transparent)`;

const SCOUT_CSS = `
.scout { --scout-neon:${N}; position:relative; display:flex; justify-content:flex-end; min-width:0; font-family:'Geist', ui-sans-serif, system-ui, sans-serif; }
.scout--sheet { display:block; }
.scout--plain { display:block; max-width:${KIT_MAX_WIDTH}px; margin:0 auto 12px; }
.scout--compact { flex:0 0 300px; width:300px; height:36px; }
@media (max-width: 1199px) { .scout--compact { flex-shrink:1; min-width:220px; } }
.scout--compact .scout-bar { position:absolute; top:0; right:0; z-index:412; }
.scout-bar { display:flex; align-items:center; gap:8px; height:36px; padding:0 6px 0 10px; box-sizing:border-box; width:300px; max-width:100%; border:1px solid ${edge(70)}; border-radius:10px; background:var(--ui-inset); color:var(--ui-muted); position:relative; transition:width .18s ease, border-color .12s, box-shadow .12s; }
.scout--plain .scout-bar, .scout--sheet .scout-bar { width:100%; }
.scout--compact .scout-bar { width:100%; }
.scout--compact.is-open .scout-bar { width:560px; max-width:calc(100vw - 32px); }
.scout-bar.is-focus { border-color:${N}; box-shadow:0 0 0 3px ${n(14)}, 0 0 24px ${n(18)}; }
.scout-bar input { flex:1; min-width:0; background:transparent; border:0; outline:0; color:var(--ui-text); font:13.5px 'Geist', ui-sans-serif, system-ui, sans-serif; }
.scout-bar input::placeholder { color:var(--ui-muted); opacity:1; }
.scout-glyph { display:inline-flex; color:var(--ui-muted); flex:none; }
.scout-bar.is-focus .scout-glyph, .scout-neon { color:${N}; }
.scout kbd, .scout-pop kbd { font:10.5px 'Geist Mono', ui-monospace, monospace; color:var(--ui-muted); border:1px solid ${edge(45)}; border-radius:4px; padding:1px 5px; }
.scout-think { position:absolute; left:10px; right:10px; bottom:-1px; height:2px; border-radius:2px; background:linear-gradient(90deg, transparent, ${N}, transparent) no-repeat; background-size:40% 100%; animation:scout-sweep 1.2s linear infinite; }
.scout-sweep { height:3px; border-radius:3px; background:${edge(25)}; overflow:hidden; position:relative; }
.scout-sweep::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg, transparent, ${N}, transparent) no-repeat; background-size:45% 100%; animation:scout-sweep 1.2s linear infinite; }
@keyframes scout-sweep { from { background-position:-45% 0; } to { background-position:145% 0; } }
@media (prefers-reduced-motion: reduce) { .scout-think, .scout-sweep::after { animation:none; background-position:50% 0; } }
.scout-scope { display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 8px; border-radius:999px; border:1px solid ${edge(45)}; background:var(--ui-surface2); color:var(--ui-soft); font:500 12px 'Geist', ui-sans-serif, system-ui, sans-serif; white-space:nowrap; cursor:pointer; flex:none; max-width:190px; }
.scout-scope > span:not(.scout-dot) { overflow:hidden; text-overflow:ellipsis; }
.scout-scope:focus-visible, .scout-btn:focus-visible { outline:2px solid ${N}; outline-offset:2px; }
.scout-scope[data-static] { cursor:default; }
.scout-dot { width:7px; height:7px; border-radius:999px; display:inline-block; flex:none; }
.scout-scope-list { position:absolute; z-index:420; margin:0; padding:4px; list-style:none; min-width:220px; background:var(--ui-surface); border:1px solid ${edge(45)}; border-radius:10px; box-shadow:0 18px 48px rgba(0,0,0,.55); }
.scout-scope-list:focus { outline:none; }
.scout-scope-list li { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px; border-radius:6px; font-size:13px; color:var(--ui-text); cursor:pointer; }
.scout-scope-list li[aria-selected="true"] { font-weight:600; }
.scout-scope-list li.is-active { background:${n(8)}; box-shadow:inset 3px 0 0 ${N}; }
.scout-pop { position:absolute; top:calc(100% + 6px); right:0; z-index:410; width:560px; max-width:calc(100vw - 32px); box-sizing:border-box; background:var(--ui-surface); color:var(--ui-text); border:1px solid ${n(35)}; border-radius:12px; box-shadow:0 18px 48px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.4); overflow:hidden; text-align:left; }
.scout--plain .scout-pop { left:0; right:auto; width:100%; }
.scout-pop--answer { width:880px; }
/* The popover hangs off the sticky header, so the page can't scroll it: a long answer scrolls inside itself. */
.scout-pop--answer { max-height:calc(100vh - 96px); overflow-y:auto; }
.scout--sheet .scout-pop--answer { max-height:none; overflow:visible; }
.scout--sheet .scout-pop { position:static; width:100%; max-width:none; margin-top:10px; }
.scout-gh { display:flex; align-items:center; gap:8px; height:28px; padding:0 14px; background:var(--ui-inset); border-top:1px solid ${edge(45)}; }
.scout-gh:first-child { border-top:0; }
.scout-lbl { font:500 11px 'Geist Mono', ui-monospace, monospace; letter-spacing:.08em; text-transform:uppercase; color:var(--ui-muted); display:inline-flex; align-items:center; gap:6px; }
.scout-gh .scout-lbl svg { color:${N}; }
.scout-lbl.scout-neon { color:${N}; }
.scout-count { font-size:11px; color:var(--ui-muted); font-variant-numeric:tabular-nums; }
.scout-row { display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:12px; min-height:38px; padding:0 14px; font-size:13px; color:var(--ui-text); cursor:pointer; }
.scout-row.is-active { background:${n(8)}; box-shadow:inset 3px 0 0 ${N}; }
.scout-row .scout-t { display:flex; align-items:baseline; gap:8px; min-width:0; overflow:hidden; white-space:nowrap; }
.scout-row .scout-t b { font-weight:600; overflow:hidden; text-overflow:ellipsis; }
.scout-row .scout-t span { color:var(--ui-muted); font-size:12px; overflow:hidden; text-overflow:ellipsis; }
.scout-row mark, .scout-mark { background:transparent; color:${N}; font-weight:600; }
.scout-dest { font-size:12px; color:var(--ui-muted); white-space:nowrap; }
.scout-more { display:block; padding:6px 14px 8px; font-size:12px; color:var(--ui-link); }
.scout-ws { display:inline-flex; align-items:center; gap:5px; height:18px; padding:0 7px; border-radius:999px; border:1px solid ${edge(45)}; font-size:10.5px; color:var(--ui-muted); white-space:nowrap; }
.scout-ws .scout-dot { width:6px; height:6px; }
.scout-foot { display:flex; align-items:center; gap:14px; min-height:36px; padding:0 14px; border-top:1px solid ${edge(45)}; font-size:12px; color:var(--ui-muted); flex-wrap:wrap; }
.scout-ask-row { display:inline-flex; align-items:center; gap:6px; color:${N}; cursor:pointer; margin-left:auto; padding:4px 6px; border-radius:6px; }
.scout-ask-row.is-active { background:${n(8)}; box-shadow:inset 3px 0 0 ${N}; }
.scout-panel { padding:14px 18px; display:flex; flex-direction:column; gap:10px; }
.scout-q { display:flex; align-items:center; gap:10px; font-size:13px; color:var(--ui-soft); min-width:0; }
.scout-q > span:nth-child(2) { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.scout-head { padding:14px 18px 10px; border-bottom:1px solid ${edge(45)}; }
.scout-head .scout-scope { margin-left:auto; }
.scout-prose { font-size:14px; line-height:1.55; color:var(--ui-text); }
.scout-prose p { margin:0 0 6px; }
.scout-prose ul { margin:0 0 6px; padding-left:18px; }
.scout-why { font-size:12px; color:var(--ui-muted); }
.scout-records { display:flex; flex-direction:column; gap:4px; margin:0; padding:0; list-style:none; }
.scout-records li { font-size:12px; color:var(--ui-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.scout-records li b { color:var(--ui-soft); font-weight:500; }
.scout-records li.is-inline { white-space:normal; color:var(--ui-soft); }
.scout-answer .ui-table-box { max-height:340px !important; min-height:0; height:auto; }
.scout-answer .ui-table__group { display:none; }
.scout-answer .ui-table__sort:has(.scout-sortmark) { color:${N}; }
.scout-sortmark { display:inline-flex; align-items:center; gap:4px; color:${N}; }
.scout-actions { display:flex; justify-content:flex-end; gap:2px; }
.scout-btn { display:inline-flex; align-items:center; gap:6px; height:26px; padding:0 8px; border-radius:8px; border:1px solid transparent; background:transparent; color:var(--ui-soft); font:500 12px 'Geist', ui-sans-serif, system-ui, sans-serif; cursor:pointer; white-space:nowrap; }
.scout-btn:hover { color:var(--ui-text); border-color:${edge(45)}; }
.scout-btn--neon { color:${N}; border-color:${n(60)}; height:30px; padding:0 11px; font-size:13px; }
.scout-btn--plain { border-color:${edge(45)}; background:var(--ui-surface2); color:var(--ui-text); height:30px; padding:0 11px; font-size:13px; }
.scout-footer { padding:10px 18px; border-top:1px solid ${edge(45)}; display:flex; align-items:center; gap:14px; flex-wrap:wrap; font-size:12px; color:var(--ui-muted); font-variant-numeric:tabular-nums; }
.scout-footer b { color:var(--ui-soft); font-weight:600; }
.scout-thread { padding:10px 18px 12px; border-top:1px solid ${edge(45)}; display:flex; flex-direction:column; gap:8px; }
.scout-turn { display:flex; gap:10px; align-items:flex-start; font-size:12.5px; color:var(--ui-muted); }
.scout-turn b { font-weight:500; color:var(--ui-soft); white-space:nowrap; }
.scout-turn.is-now { color:var(--ui-text); }
.scout-turn.is-now b { color:${N}; }
.scout-turn .ui-link { font-size:12.5px; }
.scout-edge { padding:14px 16px; display:flex; flex-direction:column; gap:8px; font-size:13px; color:var(--ui-text); }
.scout-edge .scout-lbl { color:var(--ui-muted); }
.scout-edge-line { display:flex; align-items:flex-start; gap:8px; }
.scout-edge-line > svg { color:${N}; margin-top:2px; }
.scout-note { font-size:12px; color:var(--ui-muted); }
.scout-cards { display:flex; flex-direction:column; }
.scout-card { display:flex; flex-direction:column; gap:3px; padding:10px 0; border-top:1px solid ${edge(25)}; }
.scout-card > span { font-size:13px; font-weight:500; }
.scout-card > div { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--ui-muted); }
.scout-card > div > span:first-child { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.scout-star-btn { width:34px; height:30px; display:inline-flex; align-items:center; justify-content:center; border-radius:8px; border:1px solid transparent; background:transparent; color:${N}; cursor:pointer; flex:none; }
.scout-star-btn:focus-visible { outline:2px solid ${N}; outline-offset:2px; }
.scout-sheet { position:fixed; inset:0; z-index:4600; background:var(--ui-ground); color:var(--ui-text); overflow-y:auto; overflow-x:hidden; padding:6px 16px 24px; box-sizing:border-box; }
.scout-sheet__handle { width:36px; height:4px; border-radius:2px; background:var(--ui-border); margin:4px auto 10px; }
.scout-sheet__top { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
.scout-sheet__top .scout-lbl { margin-right:auto; }
.scout-sheet .scout-pop--answer .scout-panel { padding:14px; }
`;

if (typeof document !== 'undefined' && !document.getElementById('scout-css')) {
  const el = document.createElement('style');
  el.id = 'scout-css';
  el.textContent = SCOUT_CSS;
  document.head.appendChild(el);
}
