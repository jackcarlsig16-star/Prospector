import { KIT_DARK, KIT_LIGHT, KIT_RADIUS, KIT_SEGMENTED, KIT_TABLE, KIT_EDITABLE, KIT_DRAWER } from './tokens';

// Every kit component reads var(--ui-*) so dark/light is pure CSS: :root holds
// dark, the app's light mode (body.mode-straight-shooter) swaps to light, and
// .ui-theme-dark / .ui-theme-light pin one theme for a subtree (the gallery
// shows both side by side).
export const ui = Object.fromEntries(Object.keys(KIT_DARK).map(k => [k, `var(--ui-${k})`]));

const vars = values => Object.entries(values).map(([k, v]) => `--ui-${k}: ${v};`).join(' ');

const KIT_CSS = `
:root, .ui-theme-dark { ${vars(KIT_DARK)} }
body.mode-straight-shooter, .ui-theme-light { ${vars(KIT_LIGHT)} }
.ui-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:32px; padding:0 12px; border-radius:${KIT_RADIUS.control}px; border:1px solid transparent; font:500 13px 'Geist', ui-sans-serif, system-ui, sans-serif; cursor:pointer; white-space:nowrap; transition:background .12s, border-color .12s, color .12s; }
.ui-btn:focus-visible, .ui-switch:focus-visible, .ui-input:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
.ui-btn:disabled { opacity:.45; cursor:not-allowed; }
.ui-btn--primary { background:var(--ui-accent); color:var(--ui-onAccent); }
.ui-btn--primary:hover:not(:disabled) { background:color-mix(in srgb, var(--ui-accent) 88%, var(--ui-text)); }
.ui-btn--secondary { background:var(--ui-surface2); color:var(--ui-text); border-color:var(--ui-border); }
.ui-btn--secondary:hover:not(:disabled) { border-color:var(--ui-control); }
.ui-btn--ghost { background:transparent; color:var(--ui-muted); }
.ui-btn--ghost:hover:not(:disabled) { color:var(--ui-text); background:var(--ui-surface2); }
.ui-btn--danger { background:transparent; color:var(--ui-dangerInk); border-color:color-mix(in srgb, var(--ui-dangerInk) 45%, transparent); }
.ui-btn--danger:hover:not(:disabled) { background:color-mix(in srgb, var(--ui-dangerInk) 10%, transparent); }
.ui-input { box-sizing:border-box; width:100%; min-height:34px; padding:6px 10px; border-radius:${KIT_RADIUS.control}px; border:1px solid var(--ui-control); background:var(--ui-inset); color:var(--ui-text); font:400 14px 'Geist', ui-sans-serif, system-ui, sans-serif; }
.ui-input::placeholder { color:var(--ui-muted); }
.ui-input:disabled { opacity:.55; cursor:not-allowed; }
.ui-switch { position:relative; flex-shrink:0; width:36px; height:20px; padding:0; border-radius:999px; border:1px solid var(--ui-control); background:var(--ui-inset); cursor:pointer; transition:background .12s, border-color .12s; }
.ui-switch::after { content:''; position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:var(--ui-control); transition:transform .12s, background .12s; }
.ui-switch[aria-checked="true"] { background:var(--ui-accent); border-color:var(--ui-accent); }
.ui-switch[aria-checked="true"]::after { transform:translateX(16px); background:var(--ui-onAccent); }
.ui-switch:disabled { opacity:.45; cursor:not-allowed; }
.ui-card { padding:24px; }
.ui-seg { display:inline-flex; gap:${KIT_SEGMENTED.gap}px; padding:${KIT_SEGMENTED.inset}px; max-width:100%; box-sizing:border-box; overflow-x:auto; border-radius:${KIT_RADIUS.control}px; border:1px solid var(--ui-border); background:var(--ui-inset); }
.ui-seg__btn { display:inline-flex; align-items:center; gap:6px; flex:none; height:${KIT_SEGMENTED.height}px; padding:${KIT_SEGMENTED.padding}; border:0; border-radius:${KIT_SEGMENTED.radius}px; background:transparent; color:var(--ui-muted); font:500 13px 'Geist', ui-sans-serif, system-ui, sans-serif; cursor:pointer; white-space:nowrap; transition:background .12s, color .12s; }
.ui-seg__btn:hover:not([aria-pressed="true"]) { color:var(--ui-text); }
.ui-seg__btn[aria-pressed="true"] { background:var(--ui-surface); color:var(--ui-text); box-shadow:0 0 0 1px var(--ui-border); }
.ui-seg__btn:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
.ui-seg__meta { color:var(--ui-muted); font-variant-numeric:tabular-nums; }
.ui-table-box { overflow:auto; min-height:${KIT_TABLE.minHeight}px; border:1px solid var(--ui-border); border-radius:${KIT_RADIUS.card}px; background:var(--ui-surface); }
.ui-table { border-collapse:separate; border-spacing:0; width:100%; table-layout:fixed; font:400 ${KIT_TABLE.fontSize}px 'Geist', ui-sans-serif, system-ui, sans-serif; color:var(--ui-soft); }
.ui-table th { position:sticky; top:0; z-index:2; box-sizing:border-box; height:${KIT_TABLE.headHeight}px; padding:0 10px; background:var(--ui-surface); border-bottom:1px solid var(--ui-control); text-align:left; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ui-table th.ui-table__sticky { z-index:3; }
.ui-table__sort { all:unset; cursor:pointer; display:inline-flex; align-items:center; gap:4px; max-width:100%; font:500 10.5px 'Geist Mono', ui-monospace, monospace; letter-spacing:.08em; text-transform:uppercase; color:var(--ui-muted); }
.ui-table__sort:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
.ui-table th[aria-sort="ascending"] .ui-table__sort, .ui-table th[aria-sort="descending"] .ui-table__sort { color:var(--ui-text); }
.ui-table__label { font:500 10.5px 'Geist Mono', ui-monospace, monospace; letter-spacing:.08em; text-transform:uppercase; color:var(--ui-muted); }
.ui-table td { box-sizing:border-box; height:${KIT_TABLE.rowHeight}px; padding:0 10px; border-bottom:1px solid var(--ui-border); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; background:var(--ui-row-tint, transparent); }
.ui-table tr[data-row] td:first-child { box-shadow:inset 3px 0 0 var(--ui-row-bar, transparent); }
.ui-table td.ui-table__sticky { position:sticky; left:0; z-index:1; background:linear-gradient(var(--ui-row-tint, transparent), var(--ui-row-tint, transparent)), var(--ui-surface); color:var(--ui-text); font-weight:500; }
.ui-table__group td { height:${KIT_TABLE.groupHeight}px; background:var(--ui-inset); color:var(--ui-text); font-weight:600; }
.ui-table__group h3 { display:inline-flex; align-items:center; gap:8px; margin:0; font-size:13px; font-weight:600; color:inherit; }
.ui-table__toggle { all:unset; cursor:pointer; display:inline-flex; align-items:center; gap:8px; }
.ui-table__gh { display:inline-flex; align-items:center; gap:8px; }
.ui-table__toggle::before { content:'▾'; color:var(--ui-muted); font-size:12px; }
.ui-table__toggle[aria-expanded="false"]::before { content:'▸'; }
.ui-table__toggle:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
.ui-table__count { color:var(--ui-muted); font-weight:400; font-variant-numeric:tabular-nums; }
.ui-table__dim { color:var(--ui-faint); }
.ui-table__empty { padding:12px 10px; color:var(--ui-muted); }
.ui-cell { all:unset; display:flex; align-items:center; gap:4px; width:100%; height:100%; box-sizing:border-box; cursor:text; overflow:hidden; }
.ui-cell > span { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ui-cell::after { content:'✎'; flex:none; font-size:${KIT_EDITABLE.pencil}px; line-height:1; color:var(--ui-muted); opacity:0; transition:opacity .12s; }
.ui-table tr[data-row]:hover .ui-cell::after, .ui-cell:focus-visible::after { opacity:.7; }
.ui-cell:focus-visible { outline:2px solid var(--ui-accent); outline-offset:-2px; border-radius:4px; }
.ui-cell--saving { opacity:.45; cursor:progress; }
.ui-cell-input { box-sizing:border-box; display:block; width:100%; height:${KIT_EDITABLE.height}px; padding:0 ${KIT_EDITABLE.padX}px; border-radius:${KIT_RADIUS.control - 2}px; border:1px solid var(--ui-accent); background:var(--ui-inset); color:var(--ui-text); font:inherit; outline:none; color-scheme:dark; }
body.mode-straight-shooter :where(.ui-cell-input), .ui-theme-light .ui-cell-input { color-scheme:light; }
.ui-theme-dark .ui-cell-input { color-scheme:dark; }
.ui-list { list-style:none; margin:0; padding:0; border:1px solid var(--ui-border); border-radius:${KIT_RADIUS.card}px; background:var(--ui-surface); overflow:hidden; font:400 14px 'Geist', ui-sans-serif, system-ui, sans-serif; color:var(--ui-text); }
.ui-list__group { display:flex; align-items:center; min-height:${KIT_TABLE.compactGroupHeight}px; padding:0 12px; background:var(--ui-inset); border-top:1px solid var(--ui-border); }
.ui-list__group:first-child { border-top:0; }
.ui-list__group h3 { display:inline-flex; align-items:center; gap:8px; margin:0; font-size:14px; font-weight:600; }
.ui-list__row { display:flex; align-items:center; gap:10px; min-height:${KIT_TABLE.compactRowMinHeight}px; padding:6px 4px 6px 12px; box-sizing:border-box; border-top:1px solid var(--ui-border); background:var(--ui-row-tint, transparent); box-shadow:inset 3px 0 0 var(--ui-row-bar, transparent); }
.ui-drawer { display:flex; flex-direction:column; gap:${KIT_DRAWER.gap}px; min-width:0; }
.ui-drawer + .ui-drawer { border-top:1px solid var(--ui-border); }
.ui-drawer__head { all:unset; box-sizing:border-box; display:flex; align-items:center; gap:10px; width:100%; min-height:${KIT_DRAWER.headHeight}px; padding:0 2px; border-radius:${KIT_RADIUS.control}px; cursor:pointer; font:400 13px 'Geist', ui-sans-serif, system-ui, sans-serif; color:var(--ui-soft); }
.ui-drawer__head:hover .ui-drawer__toggle { color:var(--ui-text); }
.ui-drawer__head:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
.ui-drawer__label { flex:none; font:500 11px 'Geist Mono', ui-monospace, monospace; letter-spacing:.08em; text-transform:uppercase; color:var(--ui-muted); }
.ui-drawer__summary { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; color:var(--ui-muted); }
.ui-drawer__count { flex:none; display:inline-flex; align-items:center; justify-content:center; min-width:20px; height:20px; padding:0 6px; border-radius:999px; border:1px solid var(--ui-border); background:var(--ui-surface2); font-size:12px; color:var(--ui-text); font-variant-numeric:tabular-nums; }
.ui-drawer__toggle { flex:none; margin-left:auto; white-space:nowrap; color:var(--ui-muted); }
.ui-drawer__body { display:flex; flex-direction:column; gap:10px; min-width:0; padding-bottom:12px; }
@media (max-width: 600px) { .ui-card { padding:16px; } }
`;

if (typeof document !== 'undefined' && !document.getElementById('ui-kit-css')) {
  const el = document.createElement('style');
  el.id = 'ui-kit-css';
  el.textContent = KIT_CSS;
  document.head.appendChild(el);
}
