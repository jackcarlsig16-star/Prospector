import { KIT_DARK, KIT_LIGHT, KIT_RADIUS, KIT_SEGMENTED, KIT_TABLE, KIT_EDITABLE, KIT_DRAWER } from './tokens';

// Every kit component reads var(--ui-*) so dark/light is pure CSS: :root holds
// dark, the app's light mode (body.mode-straight-shooter) swaps to light, and
// .ui-theme-dark / .ui-theme-light pin one theme for a subtree (the gallery
// shows both side by side).
//
// ui-clarity-v1 Stage 1 - one look per role (spec H3), each measurable:
//   R1 .ui-tab       text + 3 px underline (accent when selected, border when not, dashed when disabled)
//   R2 .ui-seg__btn  pressed = solid text-colour fill + ground text; unpressed = border edge
//   R3 .ui-chip      toggle chip: border edge off, accent fill on; counts in tabular numbers
//   R4 .ui-filter    labelled select that shows its value; .ui-chip--active = accent-outlined chip with x
//   R5 .ui-tag       status chip: filled wash + dot + label, no border, no hover, no pointer
//   R6 .ui-btn       primary accent fill / secondary surface2 + border / tertiary link + underline /
//                    danger red text + 3:1 red edge / disabled = no fill, dashed border, not-allowed
//   R7 .ui-group-label  the short label every row of controls carries
// A control with no fill or border is identifiable only as a link: underlined (tertiary, sort headers,
// drawer toggles, editable cells). The verify script measures exactly these rules.
export const ui = Object.fromEntries(Object.keys(KIT_DARK).map(k => [k, `var(--ui-${k})`]));

const vars = values => Object.entries(values).map(([k, v]) => `--ui-${k}: ${v};`).join(' ');
const SANS = "'Geist', ui-sans-serif, system-ui, sans-serif";
const MONO = "'Geist Mono', ui-monospace, monospace";

const KIT_CSS = `
:root, .ui-theme-dark { ${vars(KIT_DARK)} }
body.mode-straight-shooter, .ui-theme-light { ${vars(KIT_LIGHT)} }
.ui-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:32px; padding:0 12px; border-radius:${KIT_RADIUS.control}px; border:1px solid transparent; font:500 13px ${SANS}; cursor:pointer; white-space:nowrap; transition:background .12s, border-color .12s, color .12s; }
.ui-btn:focus-visible, .ui-switch:focus-visible, .ui-input:focus-visible, .ui-link:focus-visible, .ui-chip:focus-visible, .ui-tab:focus-visible, .ui-filter__select:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
.ui-btn--primary { background:var(--ui-accent); color:var(--ui-onAccent); border-color:var(--ui-accent); }
.ui-btn--primary:hover:not(:disabled) { background:color-mix(in srgb, var(--ui-accent) 88%, var(--ui-text)); }
.ui-btn--secondary { background:var(--ui-surface2); color:var(--ui-text); border-color:var(--ui-border); }
.ui-btn--secondary:hover:not(:disabled) { border-color:var(--ui-control); background:color-mix(in srgb, var(--ui-surface2) 80%, var(--ui-text)); }
.ui-btn--tertiary { background:transparent; color:var(--ui-link); padding:0 4px; text-decoration:underline; text-underline-offset:3px; text-decoration-thickness:1px; }
.ui-btn--tertiary:hover:not(:disabled) { color:var(--ui-text); text-decoration-thickness:2px; }
.ui-btn--danger { background:transparent; color:var(--ui-dangerInk); border-color:color-mix(in srgb, var(--ui-dangerInk) 82%, var(--ui-surface)); }
.ui-btn--danger:hover:not(:disabled) { background:color-mix(in srgb, var(--ui-dangerInk) 10%, transparent); }
.ui-btn:disabled { background:transparent; color:var(--ui-muted); border:1px dashed var(--ui-border); text-decoration:none; cursor:not-allowed; }
.ui-btn--sm { height:24px; padding:0 8px; font-size:12px; border-radius:6px; }
.ui-btn--sm.ui-btn--tertiary { padding:0 2px; }
.ui-btn--icon { width:24px; padding:0; font-size:14px; line-height:1; }
.ui-btn--block { width:100%; justify-content:flex-start; }
.ui-link { color:var(--ui-link); text-decoration:underline; text-underline-offset:3px; text-decoration-thickness:1px; cursor:pointer; background:none; border:0; padding:0; font:inherit; }
.ui-link:hover { color:var(--ui-text); text-decoration-thickness:2px; }
.ui-link--cell { display:block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left; }
.ui-link--quiet { color:var(--ui-text); text-decoration-style:dotted; text-decoration-color:var(--ui-control); }
.ui-input { box-sizing:border-box; width:100%; min-height:34px; padding:6px 10px; border-radius:${KIT_RADIUS.control}px; border:1px solid var(--ui-control); background:var(--ui-inset); color:var(--ui-text); font:400 14px ${SANS}; }
.ui-input::placeholder { color:var(--ui-muted); opacity:1; }
.ui-input:disabled { background:transparent; color:var(--ui-muted); border-style:dashed; cursor:not-allowed; }
.ui-input--sm { width:auto; min-height:32px; height:32px; padding:0 10px; font-size:13px; flex:none; }
.ui-switch { position:relative; flex-shrink:0; width:36px; height:20px; padding:0; border-radius:999px; border:1px solid var(--ui-control); background:var(--ui-inset); cursor:pointer; transition:background .12s, border-color .12s; }
.ui-switch::after { content:''; position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:var(--ui-control); transition:transform .12s, background .12s; }
.ui-switch[aria-checked="true"] { background:var(--ui-accent); border-color:var(--ui-accent); }
.ui-switch[aria-checked="true"]::after { transform:translateX(16px); background:var(--ui-onAccent); }
.ui-switch:disabled { cursor:not-allowed; border:1px dashed var(--ui-border); background:transparent; }
.ui-switch:disabled::after { background:var(--ui-border); }
.ui-switch:disabled[aria-checked="true"] { background:color-mix(in srgb, var(--ui-accent) 55%, var(--ui-inset)); }
.ui-card { padding:24px; }
.ui-group-label { font:500 11px ${MONO}; letter-spacing:.08em; text-transform:uppercase; color:var(--ui-muted); white-space:nowrap; }
.ui-group { display:inline-flex; align-items:center; gap:8px; flex-wrap:wrap; max-width:100%; }
.ui-tabs { display:flex; align-items:flex-end; gap:4px; max-width:100%; overflow-x:auto; border-bottom:1px solid var(--ui-divider); }
.ui-tab { all:unset; box-sizing:border-box; display:inline-flex; align-items:center; gap:8px; flex:none; height:36px; padding:0 10px; margin-bottom:-1px; border-bottom:3px solid var(--ui-border); color:var(--ui-muted); font:500 14px ${SANS}; cursor:pointer; white-space:nowrap; transition:color .12s, border-color .12s; }
.ui-tab:hover:not(:disabled) { color:var(--ui-text); }
.ui-tab[aria-selected="true"], .ui-tab[aria-current="page"] { color:var(--ui-text); font-weight:700; border-bottom-color:var(--ui-accent); }
.ui-tab:disabled { color:var(--ui-muted); border-bottom-style:dashed; cursor:not-allowed; }
.ui-seg { display:inline-flex; gap:${KIT_SEGMENTED.gap}px; padding:${KIT_SEGMENTED.inset}px; max-width:100%; box-sizing:border-box; overflow-x:auto; border-radius:${KIT_RADIUS.control}px; border:1px solid var(--ui-border); background:var(--ui-inset); }
.ui-seg__btn { display:inline-flex; align-items:center; gap:6px; flex:none; box-sizing:border-box; height:${KIT_SEGMENTED.height}px; padding:${KIT_SEGMENTED.padding}; border:1px solid var(--ui-border); border-radius:${KIT_SEGMENTED.radius}px; background:transparent; color:var(--ui-soft); font:500 13px ${SANS}; cursor:pointer; white-space:nowrap; transition:background .12s, color .12s, border-color .12s; }
.ui-seg__btn:hover:not([aria-pressed="true"]) { color:var(--ui-text); border-color:var(--ui-control); }
.ui-seg__btn[aria-pressed="true"] { background:var(--ui-text); border-color:var(--ui-text); color:var(--ui-ground); }
.ui-seg__btn:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
.ui-seg__meta { color:var(--ui-muted); font-variant-numeric:tabular-nums; }
.ui-seg__btn[aria-pressed="true"] .ui-seg__meta { color:inherit; }
.ui-chip { display:inline-flex; align-items:center; gap:6px; flex:none; box-sizing:border-box; height:28px; padding:0 10px; border-radius:${KIT_RADIUS.pill}px; border:1px solid var(--ui-border); background:transparent; color:var(--ui-text); font:500 13px ${SANS}; cursor:pointer; white-space:nowrap; transition:background .12s, color .12s, border-color .12s; }
.ui-chip:hover:not(:disabled) { border-color:var(--ui-control); }
.ui-chip[aria-pressed="true"] { background:var(--ui-accent); border-color:var(--ui-accent); color:var(--ui-onAccent); }
.ui-chip__count { color:var(--ui-muted); font-variant-numeric:tabular-nums; min-width:2ch; text-align:right; }
.ui-chip[aria-pressed="true"] .ui-chip__count { color:inherit; }
.ui-chip--active { border-color:var(--ui-accent); color:var(--ui-text); }
.ui-chip--active .ui-chip__x { color:var(--ui-accent); font-size:14px; line-height:1; }
.ui-chip:disabled { border-style:dashed; color:var(--ui-muted); cursor:not-allowed; }
.ui-filter { display:inline-flex; align-items:stretch; flex:none; height:32px; max-width:100%; }
.ui-filter__label { display:inline-flex; align-items:center; padding:0 8px; border:1px solid var(--ui-control); border-right:0; border-radius:${KIT_RADIUS.control}px 0 0 ${KIT_RADIUS.control}px; background:var(--ui-surface2); font:500 11px ${MONO}; letter-spacing:.08em; text-transform:uppercase; color:var(--ui-muted); white-space:nowrap; }
.ui-filter__select { box-sizing:border-box; height:32px; min-width:0; padding:0 8px; border:1px solid var(--ui-control); border-radius:0 ${KIT_RADIUS.control}px ${KIT_RADIUS.control}px 0; background:var(--ui-inset); color:var(--ui-text); font:500 13px ${SANS}; cursor:pointer; }
.ui-filter__select:disabled { border-style:dashed; color:var(--ui-muted); background:transparent; cursor:not-allowed; }
.ui-tag { display:inline-flex; align-items:center; gap:6px; height:22px; padding:0 8px; border-radius:6px; background:color-mix(in srgb, var(--tag-color) 22%, var(--ui-surface)); color:var(--ui-text); font:500 12px ${SANS}; white-space:nowrap; cursor:default; vertical-align:middle; }
.ui-tag__dot { width:8px; height:8px; border-radius:999px; background:var(--tag-color); flex:none; }
.ui-tag--sm { height:20px; padding:0 6px; font-size:11px; gap:5px; }
.ui-tag--sm .ui-tag__dot { width:6px; height:6px; }
.ui-table-box { overflow:auto; min-height:${KIT_TABLE.minHeight}px; border:1px solid var(--ui-border); border-radius:${KIT_RADIUS.card}px; background:var(--ui-surface); }
.ui-table { border-collapse:separate; border-spacing:0; width:100%; table-layout:fixed; font:400 ${KIT_TABLE.fontSize}px ${SANS}; color:var(--ui-soft); }
.ui-table th { position:sticky; top:0; z-index:2; box-sizing:border-box; height:${KIT_TABLE.headHeight}px; padding:0 10px; background:var(--ui-surface); border-bottom:1px solid var(--ui-control); text-align:left; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ui-table th.ui-table__sticky { z-index:3; }
.ui-table__sort { all:unset; cursor:pointer; display:inline-flex; align-items:center; gap:4px; max-width:100%; font:500 10.5px ${MONO}; letter-spacing:.08em; text-transform:uppercase; color:var(--ui-muted); text-decoration:underline dotted; text-decoration-color:var(--ui-control); text-underline-offset:3px; }
.ui-table__sort:hover { color:var(--ui-text); }
.ui-table__sort:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
.ui-table th[aria-sort="ascending"] .ui-table__sort, .ui-table th[aria-sort="descending"] .ui-table__sort { color:var(--ui-text); text-decoration-style:solid; text-decoration-color:var(--ui-accent); }
.ui-table__label { font:500 10.5px ${MONO}; letter-spacing:.08em; text-transform:uppercase; color:var(--ui-muted); }
.ui-table td { box-sizing:border-box; height:${KIT_TABLE.rowHeight}px; padding:0 10px; border-bottom:1px solid var(--ui-divider); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; background:var(--ui-row-tint, transparent); }
.ui-table tr[data-row]:hover td { background:linear-gradient(var(--ui-row-tint, transparent), var(--ui-row-tint, transparent)), var(--ui-surface2); }
.ui-table tr[data-row] td:first-child { box-shadow:inset 3px 0 0 var(--ui-row-bar, transparent); }
.ui-table td.ui-table__sticky { position:sticky; left:0; z-index:1; background:linear-gradient(var(--ui-row-tint, transparent), var(--ui-row-tint, transparent)), var(--ui-surface); color:var(--ui-text); font-weight:500; }
.ui-table tr[data-row]:hover td.ui-table__sticky { background:linear-gradient(var(--ui-row-tint, transparent), var(--ui-row-tint, transparent)), var(--ui-surface2); }
.ui-table th.ui-table__sticky-end { position:sticky; right:0; z-index:3; }
.ui-table td.ui-table__sticky-end { position:sticky; right:0; z-index:1; background:linear-gradient(var(--ui-row-tint, transparent), var(--ui-row-tint, transparent)), var(--ui-surface); box-shadow:-1px 0 0 var(--ui-divider); }
.ui-table__group td { height:${KIT_TABLE.groupHeight}px; background:var(--ui-inset); color:var(--ui-text); font-weight:600; }
.ui-table--dense td { height:${KIT_TABLE.denseRowHeight}px; }
.ui-table--dense th { height:${KIT_TABLE.denseHeadHeight}px; }
.ui-table--dense .ui-table__group td { height:${KIT_TABLE.denseGroupHeight}px; }
.ui-table__group h3 { display:inline-flex; align-items:center; gap:8px; margin:0; font-size:13px; font-weight:600; color:inherit; }
.ui-table__toggle { all:unset; cursor:pointer; display:inline-flex; align-items:center; gap:8px; box-sizing:border-box; height:22px; padding:0 8px 0 6px; border:1px solid var(--ui-border); border-radius:6px; background:var(--ui-surface2); }
.ui-table__toggle:hover { border-color:var(--ui-control); }
.ui-table__gh { display:inline-flex; align-items:center; gap:8px; }
.ui-table__toggle::before { content:'▾'; color:var(--ui-muted); font-size:12px; }
.ui-table__toggle[aria-expanded="false"]::before { content:'▸'; }
.ui-table__toggle:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
.ui-table__count { color:var(--ui-muted); font-weight:400; font-variant-numeric:tabular-nums; }
.ui-table__dim { color:var(--ui-faint); }
.ui-table__empty { padding:12px 10px; color:var(--ui-muted); }
.ui-table__detail-cell { cursor:pointer; }
.ui-table__detail-wrap { display:flex; align-items:center; gap:6px; height:100%; min-width:0; }
.ui-table__detail-wrap > :last-child { flex:1 1 auto; min-width:0; }
.ui-table__disclose { all:unset; flex:none; box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border:1px solid var(--ui-border); border-radius:5px; background:var(--ui-surface2); cursor:pointer; color:var(--ui-soft); }
.ui-table__disclose::before { content:''; width:5px; height:5px; margin-left:-2px; border-right:1.5px solid currentColor; border-bottom:1.5px solid currentColor; transform:rotate(-45deg); }
.ui-table__disclose[aria-expanded="true"]::before { margin:-3px 0 0; transform:rotate(45deg); }
.ui-table__disclose:hover, .ui-table__disclose[aria-expanded="true"] { color:var(--ui-text); border-color:var(--ui-control); }
.ui-table__disclose:focus-visible { outline:2px solid var(--ui-accent); outline-offset:1px; }
.ui-table tr.ui-table__detail-row td { height:auto; padding:6px 8px 8px; white-space:normal; overflow:visible; background:var(--ui-surface); }
.ui-detail { box-sizing:border-box; padding:10px 12px; border:1px solid var(--ui-border); border-radius:${KIT_RADIUS.control}px; background:var(--ui-surface2); color:var(--ui-text); font:400 13px ${SANS}; line-height:1.5; white-space:normal; overflow-wrap:anywhere; }
.ui-cell { all:unset; display:flex; align-items:center; gap:4px; width:100%; height:100%; box-sizing:border-box; cursor:text; overflow:hidden; }
.ui-cell > span { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-decoration:underline dotted; text-decoration-color:var(--ui-control); text-underline-offset:3px; }
.ui-cell::after { content:'✎'; flex:none; font-size:${KIT_EDITABLE.pencil}px; line-height:1; color:var(--ui-muted); opacity:0; transition:opacity .12s; }
.ui-table tr[data-row]:hover .ui-cell::after, .ui-cell:focus-visible::after { opacity:1; }
.ui-cell:focus-visible { outline:2px solid var(--ui-accent); outline-offset:-2px; border-radius:4px; }
.ui-cell--saving { opacity:.45; cursor:progress; }
.ui-cell-input { box-sizing:border-box; display:block; width:100%; height:${KIT_EDITABLE.height}px; padding:0 ${KIT_EDITABLE.padX}px; border-radius:${KIT_RADIUS.control - 2}px; border:1px solid var(--ui-accent); background:var(--ui-inset); color:var(--ui-text); font:inherit; outline:none; color-scheme:dark; }
body.mode-straight-shooter :where(.ui-cell-input), .ui-theme-light .ui-cell-input { color-scheme:light; }
.ui-theme-dark .ui-cell-input { color-scheme:dark; }
.ui-list { list-style:none; margin:0; padding:0; border:1px solid var(--ui-border); border-radius:${KIT_RADIUS.card}px; background:var(--ui-surface); overflow:hidden; font:400 14px ${SANS}; color:var(--ui-text); }
.ui-list__group { display:flex; align-items:center; min-height:${KIT_TABLE.compactGroupHeight}px; padding:0 12px; background:var(--ui-inset); border-top:1px solid var(--ui-divider); }
.ui-list__group:first-child { border-top:0; }
.ui-list__group h3 { display:inline-flex; align-items:center; gap:8px; margin:0; font-size:14px; font-weight:600; }
.ui-list__row { display:flex; align-items:center; gap:10px; min-height:${KIT_TABLE.compactRowMinHeight}px; padding:6px 4px 6px 12px; box-sizing:border-box; border-top:1px solid var(--ui-divider); background:var(--ui-row-tint, transparent); box-shadow:inset 3px 0 0 var(--ui-row-bar, transparent); }
.ui-list__row--detail { cursor:pointer; }
.ui-list__row--detail > .ui-table__disclose { align-self:flex-start; margin-top:2px; }
.ui-list__detail { padding:0 8px 8px 12px; background:var(--ui-surface); }
.ui-detail-list { margin:0; display:flex; flex-direction:column; gap:6px; }
.ui-detail-list__row { display:grid; grid-template-columns:136px minmax(0, 1fr); gap:12px; align-items:baseline; }
.ui-detail-list__row dd { margin:0; min-width:0; }
.ui-detail-list__actions { display:inline-flex; flex-wrap:wrap; gap:10px; align-items:baseline; }
@media (max-width: 600px) { .ui-detail-list__row { grid-template-columns:1fr; gap:2px; } }
.ui-drawer { display:flex; flex-direction:column; gap:${KIT_DRAWER.gap}px; min-width:0; }
.ui-drawer + .ui-drawer { border-top:1px solid var(--ui-divider); }
.ui-drawer__head { all:unset; box-sizing:border-box; display:flex; align-items:center; gap:10px; width:100%; min-height:${KIT_DRAWER.headHeight}px; padding:0 2px; border-radius:${KIT_RADIUS.control}px; cursor:pointer; font:400 13px ${SANS}; color:var(--ui-soft); }
.ui-drawer__head:hover .ui-drawer__toggle { color:var(--ui-text); text-decoration-thickness:2px; }
.ui-drawer__head:focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }
.ui-drawer__label { flex:none; font:500 11px ${MONO}; letter-spacing:.08em; text-transform:uppercase; color:var(--ui-muted); }
.ui-drawer__summary { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; color:var(--ui-muted); }
.ui-drawer__count { flex:none; display:inline-flex; align-items:center; justify-content:center; min-width:20px; height:20px; padding:0 6px; border-radius:999px; border:1px solid var(--ui-border); background:var(--ui-surface2); font-size:12px; color:var(--ui-text); font-variant-numeric:tabular-nums; }
.ui-drawer__toggle { flex:none; margin-left:auto; white-space:nowrap; color:var(--ui-link); text-decoration:underline; text-underline-offset:3px; text-decoration-thickness:1px; }
.ui-drawer__body { display:flex; flex-direction:column; gap:10px; min-width:0; padding-bottom:12px; }
@media (max-width: 600px) { .ui-card { padding:16px; } }
`;

if (typeof document !== 'undefined' && !document.getElementById('ui-kit-css')) {
  const el = document.createElement('style');
  el.id = 'ui-kit-css';
  el.textContent = KIT_CSS;
  document.head.appendChild(el);
}
