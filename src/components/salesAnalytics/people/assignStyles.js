// FIX people-assign-design-v1 - the Assign control's styles (specs/design/people-assign/*.dc.html): the text-at-rest
// trigger, the 200-px list, the phone sheet and the done line. Dark only; every colour is a --sa token.
const HAIR = 'color-mix(in srgb, var(--sa-border) 35%, transparent)';
export const ASSIGN_CSS = `
.asg-mark { display:inline-flex; align-items:center; gap:5px; min-width:0; }
.asg-mark > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.asg-dot { display:inline-block; flex:none; box-sizing:border-box; border-radius:999px; }
.asg-dot--none { border:1.5px solid var(--sa-faint); }
.asg-dash { color:var(--sa-faint); }
.asg-ow { all:unset; box-sizing:border-box; cursor:pointer; display:inline-flex; align-items:center; gap:4px; height:26px; padding:0 6px; margin-left:-6px; border-radius:7px; border:1px solid transparent; color:var(--sa-soft); font:inherit; font-size:13px; max-width:none; vertical-align:middle; }
.asg-ow .asg-c { display:none; color:var(--sa-faint); }
.asg-ow:hover, .asg-ow.is-open, .asg-ow--big { background:var(--sa-inset); border-color:${HAIR}; color:var(--sa-text); }
.asg-ow:hover .asg-c, .asg-ow:focus-visible .asg-c, .asg-ow.is-open .asg-c, .asg-ow--big .asg-c { display:inline-flex; }
.asg-ow:focus-visible { outline:2px solid var(--sa-accent); outline-offset:1px; color:var(--sa-text); }
.asg-ow.is-open { border-color:var(--sa-accent); position:relative; z-index:2; }
.asg-ow:hover { position:relative; z-index:2; }
.asg-ow.is-open .asg-c { color:var(--sa-accent); }
.asg-ow--cell { padding:0 4px; margin-left:-4px; }
.asg-ow--cell .asg-mark > span { max-width:40px; }
.asg-ow--big { height:44px; padding:0 12px; margin:0; gap:6px; }
.ui-table td:has(> .asg-ow) { overflow:visible; }
.asg-menu { width:200px; box-sizing:border-box; background:var(--sa-surface); border:1px solid var(--sa-border); border-radius:10px; padding:4px; box-shadow:0 16px 40px rgba(0,0,0,.55); display:flex; flex-direction:column; }
.asg-menu--inline { box-shadow:none; }
.asg-box { display:flex; flex-direction:column; outline:none; }
.asg-mi { display:grid; grid-template-columns:8px 1fr auto 14px; align-items:center; gap:8px; height:32px; padding:0 8px; border-radius:7px; font-size:13px; color:var(--sa-text); cursor:pointer; box-sizing:border-box; }
.asg-mi em { font-style:normal; font-size:11.5px; color:var(--sa-muted); }
.asg-mi .asg-k { color:var(--sa-accent); display:inline-flex; }
.asg-mi[data-active] { background:var(--sa-surface-2); }
.asg-box:focus-visible .asg-mi[data-active] { outline:2px solid var(--sa-accent); outline-offset:-2px; }
.asg-mi--un { margin-top:9px; position:relative; color:var(--sa-muted); }
.asg-mi--un::before { content:''; position:absolute; left:0; right:0; top:-5px; height:1px; background:${HAIR}; }
.asg-back { all:unset; box-sizing:border-box; cursor:pointer; display:flex; align-items:center; gap:6px; height:28px; padding:0 8px; border-radius:7px; font:500 10.5px 'Geist Mono', ui-monospace, monospace; letter-spacing:.08em; text-transform:uppercase; color:var(--sa-muted); }
.asg-back:hover { color:var(--sa-text); }
.asg-back:focus-visible { outline:2px solid var(--sa-accent); outline-offset:-2px; }
.asg-sheet-wrap { position:fixed; inset:0; z-index:4004; }
.asg-scrim { position:absolute; inset:0; background:rgba(0,0,0,.5); }
.asg-sheet { position:absolute; left:0; right:0; bottom:0; background:var(--sa-surface); border-top:1px solid var(--sa-border); border-radius:18px 18px 0 0; padding:10px 16px 28px; display:flex; flex-direction:column; color:var(--sa-text); }
.asg-grip { width:36px; height:4px; border-radius:999px; background:var(--sa-faint); align-self:center; margin-bottom:12px; }
.asg-sheet-title { font-weight:600; font-size:16px; }
.asg-sheet-note { font-size:12.5px; line-height:1.5; color:var(--sa-muted); margin:2px 0 8px; }
.asg-sheet .asg-mi { grid-template-columns:10px 1fr auto 18px; gap:12px; height:52px; padding:0 6px; border-radius:0; border-bottom:1px solid color-mix(in srgb, var(--sa-border) 18%, transparent); font-size:16px; }
.asg-sheet .asg-mi em { font-size:13px; }
.asg-sheet .asg-mi--un { margin-top:0; }
.asg-sheet .asg-mi--un::before { display:none; }
.asg-cancel { all:unset; box-sizing:border-box; cursor:pointer; height:48px; margin-top:10px; border-radius:10px; border:1px solid ${HAIR}; background:var(--sa-surface-2); text-align:center; font-weight:500; font-size:15px; color:var(--sa-text); }
.asg-cancel:focus-visible { outline:2px solid var(--sa-accent); outline-offset:1px; }
.asg-done { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); z-index:4005; box-sizing:border-box; display:flex; align-items:center; gap:10px; min-height:40px; padding:0 12px 0 14px; border-radius:10px; background:var(--sa-surface); border:1px solid var(--sa-border); font-size:13px; color:var(--sa-text); box-shadow:0 10px 30px rgba(0,0,0,.45); width:max-content; max-width:min(520px, calc(100vw - 32px)); }
.asg-done--phone { left:16px; right:16px; transform:none; width:auto; max-width:none; min-height:48px; justify-content:space-between; }
.asg-done > svg { flex:none; }
.asg-u { all:unset; box-sizing:border-box; cursor:pointer; color:var(--sa-link); font-weight:500; margin-left:6px; height:28px; padding:0 8px; border-radius:7px; display:inline-flex; align-items:center; gap:6px; white-space:nowrap; }
.asg-u span { color:var(--sa-muted); font-weight:400; font-variant-numeric:tabular-nums; }
.asg-u:focus-visible { outline:2px solid var(--sa-accent); outline-offset:1px; }
.asg-u[disabled] { opacity:.6; cursor:default; }
`;
