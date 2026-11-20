// actions-v2 Stage 2 - the Today list's sheet (specs/design/actions-v2/ActionsToday, ...States, ...Phone). Dark only;
// every colour is a theme variable. The verb is the "generated" look (the Generate orange), never neon.
export const TODAY_CSS = `
.td { display:flex; flex-direction:column; gap:12px; max-width:1100px; min-width:0; font-size:14px; color:var(--sa-text); }
.td button { font-family:inherit; }
.td-note { font-size:12.5px; line-height:1.5; color:var(--sa-soft); }
.td-num { font-variant-numeric:tabular-nums; }
.td-lbl { font-family:var(--ui-mono, ui-monospace, monospace); font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--sa-soft); font-weight:500; }
.td-card { background:var(--sa-surface); border:1px solid var(--sa-border); border-radius:14px; }
.td-bar { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.td-chip { height:28px; padding:0 10px; border-radius:999px; border:1px solid var(--sa-border); background:transparent; color:var(--sa-soft); font-size:13px; display:inline-flex; align-items:center; gap:6px; white-space:nowrap; cursor:pointer; box-sizing:border-box; }
.td-chip b { font-weight:500; color:var(--sa-text); }
.td-chip[aria-pressed="true"] { border-color:var(--sa-accent); color:var(--sa-text); background:color-mix(in srgb, var(--sa-accent) 12%, transparent); }
.td-chip b.td-bad, .td-bad { color:var(--sa-bad); }
.td-sep { width:1px; height:18px; background:var(--sa-border); margin:0 4px; }
.td-sel, .td-search { height:28px; box-sizing:border-box; border:1px solid var(--sa-border-strong); border-radius:8px; background:var(--sa-inset); color:var(--sa-text); font:inherit; font-size:13px; padding:0 10px; }
.td-search { width:200px; margin-left:auto; }
.td-btn { height:28px; padding:0 10px; border-radius:8px; border:1px solid var(--sa-border); background:var(--sa-surface-2); color:var(--sa-text); font-size:12.5px; font-weight:500; display:inline-flex; align-items:center; gap:6px; white-space:nowrap; cursor:pointer; box-sizing:border-box; }
.td-btn--ghost { background:transparent; }
.td-btn--pri { background:var(--sa-accent); border-color:var(--sa-accent); color:var(--sa-ground); }
.td-btn:disabled { opacity:.55; cursor:default; }
.td-link { all:unset; cursor:pointer; color:var(--sa-link); }
.td-link:focus-visible, .td-ck:focus-visible, .td-mb:focus-visible { outline:2px solid var(--sa-accent); outline-offset:2px; }
.td table { border-collapse:separate; border-spacing:0; width:100%; table-layout:fixed; font-size:13px; }
.td th { text-align:left; font-weight:500; height:34px; padding:0 10px; border-bottom:1px solid var(--sa-border-strong); white-space:nowrap; }
.td td { height:42px; padding:0 10px; border-bottom:1px solid var(--sa-track); color:var(--sa-muted); vertical-align:middle; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.td tr.td-g td { height:32px; background:var(--sa-inset); border-bottom:1px solid var(--sa-border); color:var(--sa-text); font-weight:600; font-size:12.5px; }
.td tr.td-g td span.c, .td-gh span.c { color:var(--sa-soft); font-weight:400; margin-left:8px; }
.td tr.td-more td { height:32px; color:var(--sa-soft); font-size:12.5px; }
.td-rk { color:var(--sa-faint); text-align:right; }
.td-task { color:var(--sa-text); font-weight:500; }
.td-dash { color:var(--sa-faint); }
.td-pill { display:inline-flex; align-items:center; gap:5px; height:20px; padding:0 7px; border-radius:999px; border:1px solid; font-size:11px; font-weight:600; margin-left:7px; vertical-align:middle; }
.td-pill small { font-size:11px; font-weight:500; opacity:.85; }
.td-star { color:var(--sa-accent); display:inline-flex; vertical-align:middle; margin-left:4px; }
.td-ow { display:inline-flex; align-items:center; gap:6px; }
.td-ow i { width:8px; height:8px; border-radius:999px; display:inline-block; }
.td-og { color:var(--sa-soft); display:inline-flex; }
.td-ck { all:unset; cursor:pointer; width:20px; height:20px; border-radius:999px; border:1.5px solid var(--sa-border-strong); box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; color:transparent; }
.td-ck:hover, .td-ck:focus-visible { border-color:var(--sa-good); color:var(--sa-good); }
.td-vb { height:26px; padding:0 10px; border-radius:7px; border:1px solid color-mix(in srgb, var(--sa-prio-p1) 55%, transparent); background:color-mix(in srgb, var(--sa-prio-p1) 8%, transparent); color:var(--sa-prio-p1); font-size:12.5px; font-weight:500; display:inline-flex; align-items:center; gap:6px; white-space:nowrap; box-sizing:border-box; }
.td-gen { font-family:var(--ui-mono, ui-monospace, monospace); font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; font-weight:500; color:var(--sa-prio-p1); }
.td-mb { all:unset; cursor:pointer; width:26px; height:26px; border-radius:7px; display:inline-flex; align-items:center; justify-content:center; color:var(--sa-soft); }
.td-mb[aria-expanded="true"] { background:var(--sa-inset); outline:1px solid var(--sa-accent); color:var(--sa-text); }
.td-menu { position:fixed; z-index:4003; width:220px; box-sizing:border-box; background:var(--sa-surface); border:1px solid var(--sa-border-strong); border-radius:10px; padding:4px; box-shadow:0 16px 40px rgba(0,0,0,.55); display:flex; flex-direction:column; text-align:left; }
.td-mi { all:unset; cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:32px; padding:0 9px; border-radius:7px; font-size:13px; color:var(--sa-text); box-sizing:border-box; }
.td-mi:hover, .td-mi:focus-visible { background:var(--sa-surface-2); }
.td-mi em { font-style:normal; font-size:11.5px; color:var(--sa-soft); }
.td-mi--bad { color:var(--sa-bad); }
.td-mh { padding:6px 9px 4px; }
.td-sepr { height:1px; background:var(--sa-border); margin:4px 0; }
.td-date { height:30px; margin:4px; box-sizing:border-box; border:1px solid var(--sa-border-strong); border-radius:7px; background:var(--sa-inset); color:var(--sa-text); font:inherit; font-size:13px; padding:0 8px; color-scheme:dark; }
.td-toast { position:fixed; left:50%; bottom:24px; transform:translateX(-50%); z-index:4004; display:flex; align-items:center; gap:10px; min-height:40px; padding:6px 12px 6px 14px; border-radius:10px; background:var(--sa-surface); border:1px solid var(--sa-border-strong); font-size:13px; color:var(--sa-text); box-shadow:0 10px 30px rgba(0,0,0,.45); max-width:min(640px, calc(100vw - 32px)); box-sizing:border-box; }
.td-toast .u { all:unset; cursor:pointer; color:var(--sa-link); font-weight:500; height:28px; padding:0 8px; display:inline-flex; align-items:center; gap:6px; white-space:nowrap; }
.td-toast .u span { color:var(--sa-soft); font-weight:400; }
.td-strip { padding:12px 14px; display:flex; flex-direction:column; gap:10px; }
.td-slots { display:flex; gap:8px; }
.td-slot { flex:1; min-width:0; height:54px; border-radius:10px; border:1px solid var(--sa-border); background:var(--sa-inset); padding:8px 10px; box-sizing:border-box; display:flex; gap:9px; align-items:flex-start; }
.td-slot .n { font-family:var(--ui-mono, ui-monospace, monospace); font-size:11px; font-weight:500; color:var(--sa-accent); margin-top:1px; }
.td-slot .t { font-size:12.5px; line-height:1.3; color:var(--sa-text); font-weight:500; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.td-slot .s { font-size:11.5px; color:var(--sa-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.td-empty { padding:28px 20px; display:flex; flex-direction:column; align-items:center; gap:8px; text-align:center; }
.td-empty b { font-size:15px; font-weight:600; color:var(--sa-text); }
.td-rule { padding:12px 14px; display:flex; flex-direction:column; gap:4px; }
.td-card.td-confirm { padding:12px 14px; }
.td-ph { display:flex; flex-direction:column; gap:10px; }
.td-ph .td-bar { flex-wrap:nowrap; overflow-x:auto; margin-right:-16px; padding-right:16px; scrollbar-width:none; }
.td-ph .td-chip { height:36px; flex:none; }
.td-gh { margin:8px 2px 0; color:var(--sa-text); display:flex; align-items:center; gap:6px; }
.td-pcard { padding:14px; display:flex; flex-direction:column; gap:8px; min-width:0; }
.td-pcard .td-task { font-size:15px; line-height:1.3; white-space:normal; overflow-wrap:anywhere; }
.td-pline { font-size:13px; display:flex; align-items:center; gap:12px; flex-wrap:wrap; min-width:0; }
.td-pline > .co { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.td-pact { display:flex; gap:8px; margin-top:2px; }
.td-dn { flex:1; height:44px; border-radius:7px; border:1px solid var(--sa-border-strong); background:transparent; color:var(--sa-text); font-size:14px; font-weight:500; display:inline-flex; align-items:center; justify-content:center; gap:6px; cursor:pointer; }
.td-dn svg { color:var(--sa-good); }
.td-ph .td-mb { width:44px; height:44px; border:1px solid var(--sa-border-strong); box-sizing:border-box; }
.td-ph .td-mi { min-height:44px; }
.td-ph .td-fold { height:44px; justify-content:center; }
.td-fix { display:flex; flex-direction:column; gap:6px; padding:10px 0; border-top:1px solid var(--sa-track); }
.td-fix b { font-size:14px; font-weight:600; color:var(--sa-text); }
@media (prefers-reduced-motion: no-preference) { .td-ck, .td-chip, .td-mi { transition:background .12s, border-color .12s, color .12s; } }
`;
