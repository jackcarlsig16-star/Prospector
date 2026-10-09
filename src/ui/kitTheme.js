import { KIT_DARK, KIT_LIGHT, KIT_RADIUS } from './tokens';

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
@media (max-width: 600px) { .ui-card { padding:16px; } }
`;

if (typeof document !== 'undefined' && !document.getElementById('ui-kit-css')) {
  const el = document.createElement('style');
  el.id = 'ui-kit-css';
  el.textContent = KIT_CSS;
  document.head.appendChild(el);
}
