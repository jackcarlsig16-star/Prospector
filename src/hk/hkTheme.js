// hkos-project-shell-v1 S8 - the HumanKind look, scoped: every rule starts with .hk-theme, so nothing outside the
// Sales OS shell changes (index.css, tokens.js, kitTheme.js and theme.js are untouched). Injected once on the first
// HkShell mount, never removed, same pattern as kitTheme.js.
// Contrast (WCAG, deliberate deviations from the mockup hexes): text or icons on green use --hk-green-fill (white
// 4.81), never #2D8F4E (4.08); text on orange uses --hk-orange-text (white 5.99); --hk-faint is never text; meta
// text is --hk-muted (cream 5.07, sand 4.68); mustard and orange are never text on cream. Small green text on sand
// (the "SALES OS" line) is --hk-forest: --hk-green-fill there is 3.88.
// Shared kit pieces (Button, Segmented, Tabs, Tag) take the look through their --ui-* variables, re-pinned under
// .hk-theme so they out-rank .ui-theme-dark / .sa-theme pins, plus descendant rules for font and radius.

export const HK_FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Jost:wght@400;500;600;700&display=swap';

const PINNED = ['', ' .ui-theme-dark', ' .ui-theme-light', ' .sa-theme', ' #sales-analytics-root'].map(s => `.hk-theme${s}`).join(', ');

const HK_CSS = `
.hk-theme {
  --hk-cream:#F6EFE0; --hk-surface:#FFFCF5; --hk-sand:#EFE6D3; --hk-line:#E4D9C3; --hk-green:#2D8F4E;
  --hk-green-fill:#278245; --hk-forest:#1F5E35; --hk-mustard:#E6B23A; --hk-orange:#D9622B; --hk-orange-text:#A8441A;
  --hk-cocoa:#2B1D14; --hk-muted:#6E6455; --hk-faint:#9A8F7E;
  --hk-tint-green:#D9EBD4; --hk-tint-green-text:#1F5E35; --hk-tint-mustard:#F7E6B5; --hk-tint-mustard-text:#6E4F0A;
  --hk-tint-orange:#F8D9C7; --hk-tint-orange-text:#8A3A12; --hk-tint-blue:#D6E8F2; --hk-tint-blue-text:#1F4E6B;
  --hk-tint-lilac:#E4D6EC; --hk-tint-lilac-text:#5A3D72; --hk-tint-grey:#E9E3D7; --hk-tint-grey-text:#6E6455;
  --hk-tint-block:#F6D5CC; --hk-tint-block-text:#8E2A14;
  --hk-font-display:'Fredoka', sans-serif; --hk-font-body:'Jost', sans-serif;
  --hk-radius-card:18px; --hk-radius-block:14px; --hk-radius-control:12px; --hk-radius-chip:999px;
  --hk-shadow-card:0 2px 10px rgba(43,29,20,.06);
  --hk-member-1:var(--hk-green-fill); --hk-member-2:var(--hk-orange-text); --hk-member-3:#1F4E6B; --hk-member-4:#5A3D72;
}
${PINNED} {
  --ui-ground:#F6EFE0; --ui-surface:#FFFCF5; --ui-surface2:#FFFCF5; --ui-inset:#EFE6D3; --ui-border:#E4D9C3;
  --ui-divider:#E4D9C3; --ui-control:#6E6455; --ui-text:#2B1D14; --ui-soft:#2B1D14; --ui-muted:#6E6455; --ui-faint:#6E6455;
  --ui-accent:#278245; --ui-onAccent:#FFFFFF; --ui-link:#1F5E35; --ui-good:#278245; --ui-warn:#E6B23A; --ui-bad:#8E2A14;
  --ui-off:#9A8F7E; --ui-dangerInk:#8E2A14;
}
.hk-theme .ui-btn, .hk-theme .ui-seg__btn, .hk-theme .ui-tab, .hk-theme .ui-tag, .hk-theme .ui-group-label { font-family:var(--hk-font-body); }
.hk-theme .ui-btn { border-radius:var(--hk-radius-control); }
.hk-theme .ui-seg, .hk-theme .ui-seg__btn, .hk-theme .ui-tag { border-radius:var(--hk-radius-chip); }

.hk-theme.hk-shell { display:flex; min-height:100vh; background:var(--hk-cream); color:var(--hk-cocoa); font:400 14px var(--hk-font-body); }
.hk-theme .hk-btn { all:unset; box-sizing:border-box; cursor:pointer; }
.hk-theme .hk-btn:focus-visible { outline:2px solid var(--hk-green-fill); outline-offset:2px; }
.hk-theme svg { flex:none; }

.hk-theme .hk-nav { width:228px; flex:none; box-sizing:border-box; position:sticky; top:0; height:100vh; overflow-y:auto; display:flex; flex-direction:column; gap:14px; padding:20px 14px 16px; background:var(--hk-sand); }
.hk-theme .hk-logo { display:flex; align-items:center; gap:10px; padding:2px 6px 4px; }
.hk-theme .hk-logo__name { font:700 19px/1.1 var(--hk-font-display); color:var(--hk-cocoa); }
.hk-theme .hk-logo__sub { font:700 11px/1.2 var(--hk-font-body); letter-spacing:.1em; text-transform:uppercase; color:var(--hk-forest); }
.hk-theme .hk-nav__list { display:flex; flex-direction:column; gap:2px; }
.hk-theme .hk-nav__item { display:flex; align-items:center; gap:10px; width:100%; padding:9px 12px; border-radius:var(--hk-radius-control); font:500 14px var(--hk-font-body); color:var(--hk-cocoa); }
.hk-theme .hk-nav__item:hover:not([aria-current="page"]) { background:rgba(43,29,20,.06); }
.hk-theme .hk-nav__item[aria-current="page"] { background:var(--hk-green-fill); color:#FFFFFF; font-weight:600; }
.hk-theme .hk-nav__badge { margin-left:auto; min-width:20px; padding:1px 7px; border-radius:var(--hk-radius-chip); background:var(--hk-orange-text); color:#FFFFFF; font:600 11px var(--hk-font-body); text-align:center; }
.hk-theme .hk-nav__divider { height:1px; background:var(--hk-line); margin:6px 4px; }
.hk-theme .hk-nav__foot { margin-top:auto; padding:0 6px; font-size:10px; color:var(--hk-muted); }

.hk-theme .hk-main { flex:1; min-width:0; display:flex; flex-direction:column; }
.hk-theme .hk-top { display:flex; align-items:center; gap:12px; padding:14px 28px; border-bottom:1px solid var(--hk-line); background:var(--hk-cream); }
.hk-theme .hk-spacer { flex:1; }
.hk-theme .hk-pill { display:inline-flex; align-items:center; gap:8px; padding:7px 12px; border-radius:var(--hk-radius-chip); background:var(--hk-surface); box-shadow:inset 0 0 0 1px var(--hk-line); font:600 14px var(--hk-font-body); color:var(--hk-cocoa); }
.hk-theme .hk-pill__dot { width:8px; height:8px; border-radius:2px; background:var(--hk-green-fill); }
.hk-theme .hk-search { display:inline-flex; align-items:center; gap:8px; width:300px; padding:8px 14px; border-radius:var(--hk-radius-chip); background:var(--hk-surface); box-shadow:inset 0 0 0 1px var(--hk-line); font:400 14px var(--hk-font-body); color:var(--hk-muted); }
.hk-theme .hk-kbd { margin-left:auto; padding:1px 6px; border-radius:6px; background:var(--hk-sand); font:500 11px var(--hk-font-body); color:var(--hk-muted); }
.hk-theme .hk-avatar { display:inline-flex; align-items:center; justify-content:center; flex:none; border-radius:50%; color:#FFFFFF; font-family:var(--hk-font-display); font-weight:600; }

.hk-theme .hk-anchor { position:relative; }
.hk-theme .hk-menu { position:absolute; top:calc(100% + 6px); z-index:60; min-width:230px; padding:6px; border-radius:var(--hk-radius-block); background:var(--hk-surface); border:1px solid var(--hk-line); box-shadow:var(--hk-shadow-card); }
.hk-theme .hk-menu--left { left:0; } .hk-theme .hk-menu--right { right:0; }
.hk-theme .hk-menu__head { padding:8px 10px 6px; }
.hk-theme .hk-menu__label { padding:8px 10px 2px; font:600 11px var(--hk-font-body); letter-spacing:.08em; text-transform:uppercase; color:var(--hk-muted); }
.hk-theme .hk-menu__item { display:flex; align-items:center; gap:8px; width:100%; min-height:36px; padding:8px 10px; border-radius:10px; font:500 14px var(--hk-font-body); color:var(--hk-cocoa); }
.hk-theme .hk-menu__item:hover { background:var(--hk-sand); }
.hk-theme .hk-menu__rule { height:1px; background:var(--hk-line); margin:4px 2px; }
.hk-theme .hk-meta { font-size:13px; color:var(--hk-muted); }

.hk-theme .hk-content { padding:20px 28px 24px; }
.hk-theme .hk-head__title { margin:0; font:600 28px/1.2 var(--hk-font-display); color:var(--hk-cocoa); }
.hk-theme .hk-head__line { margin:4px 0 0; font-size:13px; color:var(--hk-muted); }
.hk-theme .hk-empty { display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px; max-width:440px; margin:72px auto 0; }
.hk-theme .hk-empty__title { margin:6px 0 0; font:600 18px/1.3 var(--hk-font-display); color:var(--hk-cocoa); }
.hk-theme .hk-empty__line { margin:0; font-size:14px; color:var(--hk-muted); }

.hk-theme .hk-settings { display:grid; grid-template-columns:200px minmax(0, 1fr); gap:24px; margin-top:20px; }
.hk-theme .hk-subnav { display:flex; flex-direction:column; gap:2px; }
.hk-theme .hk-subnav__item { padding:9px 12px; border-radius:var(--hk-radius-control); font:500 14px var(--hk-font-body); color:var(--hk-cocoa); }
.hk-theme .hk-subnav__item[aria-current="page"] { background:var(--hk-sand); font-weight:600; box-shadow:inset 3px 0 0 var(--hk-green-fill); }
.hk-theme .hk-subnav__item:hover:not([aria-current="page"]) { background:rgba(43,29,20,.05); }
.hk-theme .hk-rows { display:flex; flex-direction:column; gap:10px; }
.hk-theme .hk-row { display:flex; align-items:center; gap:12px; padding:12px 16px; border-radius:var(--hk-radius-card); background:var(--hk-surface); box-shadow:var(--hk-shadow-card); }
.hk-theme .hk-row__name { font-weight:600; }
.hk-theme .hk-row__end { margin-left:auto; display:inline-flex; align-items:center; gap:8px; }
.hk-theme .hk-link { color:var(--hk-forest); font:500 14px var(--hk-font-body); text-decoration:underline; text-underline-offset:3px; }
.hk-theme .hk-section-title { margin:0 0 12px; font:600 18px var(--hk-font-display); }

.hk-theme .hk-phone-top { display:flex; align-items:center; gap:8px; padding:12px 16px; border-bottom:1px solid var(--hk-line); }
.hk-theme .hk-phone-top__name { font:700 18px var(--hk-font-display); color:var(--hk-cocoa); }
.hk-theme.hk-shell--phone { flex-direction:column; }
.hk-theme.hk-shell--phone .hk-content { padding:16px 16px 104px; }
.hk-theme.hk-shell--phone .hk-settings { grid-template-columns:minmax(0, 1fr); gap:14px; }
.hk-theme.hk-shell--phone .hk-subnav { flex-direction:row; }
.hk-theme.hk-shell--phone .hk-search { width:auto; }
.hk-theme .hk-tabbar { position:fixed; left:0; right:0; bottom:0; z-index:50; display:grid; grid-template-columns:repeat(5, 1fr); padding:6px 6px calc(6px + env(safe-area-inset-bottom)); background:var(--hk-surface); border-radius:24px 24px 0 0; box-shadow:0 -6px 20px rgba(43,29,20,.06); }
.hk-theme .hk-tab { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; min-height:52px; border-radius:var(--hk-radius-control); font:500 11px var(--hk-font-body); color:var(--hk-muted); }
.hk-theme .hk-tab[aria-current="page"] { color:var(--hk-green-fill); font-weight:600; }
.hk-theme .hk-backdrop { position:fixed; inset:0; z-index:70; background:rgba(43,29,20,.35); }
.hk-theme .hk-sheet { position:fixed; left:0; right:0; bottom:0; z-index:71; padding:10px 12px calc(16px + env(safe-area-inset-bottom)); background:var(--hk-surface); border-radius:24px 24px 0 0; box-shadow:0 -6px 20px rgba(43,29,20,.12); }
.hk-theme .hk-sheet__item { display:flex; align-items:center; gap:12px; width:100%; min-height:48px; padding:0 12px; border-radius:var(--hk-radius-control); font:500 15px var(--hk-font-body); color:var(--hk-cocoa); }
.hk-theme .hk-sheet__item:hover { background:var(--hk-sand); }

.hk-theme .hk-palette { position:fixed; z-index:71; top:14vh; left:50%; transform:translateX(-50%); width:min(520px, calc(100vw - 32px)); padding:8px; border-radius:var(--hk-radius-card); background:var(--hk-surface); border:1px solid var(--hk-line); box-shadow:0 12px 40px rgba(43,29,20,.18); }
.hk-theme .hk-palette__input { all:unset; box-sizing:border-box; width:100%; padding:10px 12px; font:400 15px var(--hk-font-body); color:var(--hk-cocoa); border-bottom:1px solid var(--hk-line); }
.hk-theme .hk-palette__input::placeholder { color:var(--hk-muted); }
.hk-theme .hk-palette__list { list-style:none; margin:6px 0 0; padding:0; max-height:50vh; overflow-y:auto; }
.hk-theme .hk-palette__item { display:flex; align-items:center; gap:10px; width:100%; padding:9px 12px; border-radius:10px; font:500 14px var(--hk-font-body); color:var(--hk-cocoa); }
.hk-theme .hk-palette__item[data-selected="true"] { background:var(--hk-sand); }
.hk-theme .hk-palette__none { padding:10px 12px; color:var(--hk-muted); }
`;

export function ensureHkTheme() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('hk-theme-css')) {
    const el = document.createElement('style');
    el.id = 'hk-theme-css';
    el.textContent = HK_CSS;
    document.head.appendChild(el);
  }
  if (!document.getElementById('hk-fonts')) {
    const link = document.createElement('link');
    link.id = 'hk-fonts';
    link.rel = 'stylesheet';
    link.href = HK_FONTS_HREF;
    document.head.appendChild(link);
  }
}
