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

/* hkos-data-foundation-v1 Stage 3 - Brands, Add brand, Brand page. Tint text tokens only (never mustard / orange / faint as text). */
.hk-theme .hk-toolbar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin:16px 0 12px; }
.hk-theme .hk-search-input { width:260px; }
.hk-theme .hk-bulk { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 12px; margin-bottom:10px; border-radius:var(--hk-radius-block); background:var(--hk-sand); font-size:13px; }
.hk-theme .hk-chip { display:inline-flex; align-items:center; gap:6px; padding:2px 10px; border-radius:var(--hk-radius-chip); font:500 12px var(--hk-font-body); white-space:nowrap; }
.hk-theme .hk-chip--grey { background:var(--hk-tint-grey); color:var(--hk-tint-grey-text); }
.hk-theme .hk-chip--green { background:var(--hk-tint-green); color:var(--hk-tint-green-text); }
.hk-theme .hk-chip--blue { background:var(--hk-tint-blue); color:var(--hk-tint-blue-text); }
.hk-theme .hk-chip--lilac { background:var(--hk-tint-lilac); color:var(--hk-tint-lilac-text); }
.hk-theme .hk-chip--mustard { background:var(--hk-tint-mustard); color:var(--hk-tint-mustard-text); }
.hk-theme .hk-chip--orange { background:var(--hk-tint-orange); color:var(--hk-tint-orange-text); }
.hk-theme .hk-chip--block { background:var(--hk-tint-block); color:var(--hk-tint-block-text); }
.hk-theme .hk-owner { display:inline-flex; align-items:center; gap:6px; }
.hk-theme .hk-table__name { display:flex; flex-direction:column; align-items:flex-start; gap:1px; text-align:left; }
.hk-theme .hk-table__title { font-weight:600; color:var(--hk-cocoa); }
.hk-theme .hk-table__name:hover .hk-table__title { text-decoration:underline; text-underline-offset:3px; }
.hk-theme .ui-table-box { background:var(--hk-surface); border-color:var(--hk-line); border-radius:var(--hk-radius-card); }
.hk-theme .ui-table, .hk-theme .ui-table th, .hk-theme .ui-table td { font-family:var(--hk-font-body); }
.hk-theme .ui-table__sort { font-family:var(--hk-font-body); letter-spacing:.04em; text-transform:none; font-size:12px; }
.hk-theme .ui-input { font-family:var(--hk-font-body); border-radius:var(--hk-radius-control); background:var(--hk-surface); color:var(--hk-cocoa); border-color:var(--hk-muted); }
.hk-theme .ui-btn--secondary, .hk-theme .ui-btn--danger { border-color:var(--hk-muted); }
.hk-theme .ui-tab { font-family:var(--hk-font-body); }
.hk-theme .hk-card-row { display:flex; flex-direction:column; gap:6px; width:100%; padding:12px 14px; border-radius:var(--hk-radius-card); background:var(--hk-surface); box-shadow:var(--hk-shadow-card); text-align:left; }
.hk-theme .hk-card-row__chips { display:flex; gap:6px; flex-wrap:wrap; }
.hk-theme .hk-banner { display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:12px 16px; border-radius:var(--hk-radius-block); margin:12px 0; }
.hk-theme .hk-banner__text { display:flex; flex-direction:column; gap:2px; flex:1; min-width:200px; }
.hk-theme .hk-banner__title { font:600 15px var(--hk-font-display); }
.hk-theme .hk-banner__line { font-size:13px; }
.hk-theme .hk-banner__actions { display:inline-flex; gap:8px; }
.hk-theme .hk-banner--green { background:var(--hk-tint-green); color:var(--hk-tint-green-text); }
.hk-theme .hk-banner--blue { background:var(--hk-tint-blue); color:var(--hk-tint-blue-text); }
.hk-theme .hk-banner--mustard { background:var(--hk-tint-mustard); color:var(--hk-tint-mustard-text); }
.hk-theme .hk-banner--orange { background:var(--hk-tint-orange); color:var(--hk-tint-orange-text); }
.hk-theme .hk-banner--block { background:var(--hk-tint-block); color:var(--hk-tint-block-text); }
.hk-theme .hk-banner--grey { background:var(--hk-tint-grey); color:var(--hk-tint-grey-text); }
.hk-theme .hk-modal { position:fixed; z-index:71; top:6vh; left:50%; transform:translateX(-50%); width:min(560px, calc(100vw - 32px)); max-height:88vh; overflow-y:auto; padding:20px 22px 18px; border-radius:var(--hk-radius-card); background:var(--hk-surface); border:1px solid var(--hk-line); box-shadow:0 12px 40px rgba(43,29,20,.18); }
.hk-theme .hk-modal__title { margin:0 0 14px; font:600 22px var(--hk-font-display); color:var(--hk-cocoa); }
.hk-theme .hk-form { display:flex; flex-direction:column; gap:12px; }
.hk-theme .hk-inline-form { display:flex; flex-direction:column; gap:10px; padding:14px 16px; margin:10px 0; border-radius:var(--hk-radius-block); background:var(--hk-sand); }
.hk-theme .hk-error { margin:6px 0; font-size:13px; color:var(--hk-tint-block-text); }
.hk-theme .hk-brand__head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin:10px 0 4px; }
.hk-theme .hk-brand__chips { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:10px; }
.hk-theme .hk-brand__actions { display:inline-flex; align-items:center; gap:8px; }
.hk-theme .hk-brand__body { margin-top:16px; }
.hk-theme .hk-timeline { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
.hk-theme .hk-timeline__item { display:flex; align-items:center; gap:12px; padding:10px 14px; border-radius:var(--hk-radius-block); background:var(--hk-surface); box-shadow:var(--hk-shadow-card); }
.hk-theme .hk-timeline__text { flex:1; min-width:0; }
.hk-theme .hk-details { display:grid; grid-template-columns:140px minmax(0, 1fr); gap:8px 16px; margin:0; }
.hk-theme .hk-details dd { margin:0; }
.hk-theme .hk-avatar--system { display:inline-flex; align-items:center; justify-content:center; border-radius:50%; background:var(--hk-muted); color:#FFFFFF; font:600 11px var(--hk-font-display); }
.hk-theme.hk-shell--phone .hk-toolbar .ui-tabs { width:100%; }
.hk-theme.hk-shell--phone .hk-search-input { width:100%; }
.hk-theme.hk-shell--phone .hk-details { grid-template-columns:minmax(0, 1fr); }

/* hkos-data-foundation-v1 Stage 4 - Sponsors, Review, Activity, Settings > Pitch */
.hk-theme .hk-note { margin:12px 0 4px; padding:10px 14px; border-radius:var(--hk-radius-block); background:var(--hk-tint-mustard); color:var(--hk-tint-mustard-text); font-size:13px; }
.hk-theme .hk-section { margin-top:18px; }
.hk-theme .hk-section__head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
.hk-theme .hk-section__head .hk-section-title { margin:0; }
.hk-theme .hk-row--wrap { flex-wrap:wrap; row-gap:8px; }
.hk-theme .hk-period-chips { display:inline-flex; gap:6px; flex-wrap:wrap; }
.hk-theme .hk-chip__x { margin-left:4px; padding:0 2px; font-size:14px; line-height:1; color:inherit; }
.hk-theme .hk-chip__x:hover { text-decoration:underline; }
.hk-theme .hk-truncate { max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hk-theme .hk-inline-form--row { flex-direction:row; flex-wrap:wrap; align-items:center; width:100%; }
.hk-theme .hk-inline-form--row .ui-input { width:auto; min-width:160px; }
.hk-theme .hk-picker__list { display:flex; flex-direction:column; gap:4px; max-height:40vh; overflow-y:auto; margin:10px 0; }
.hk-theme .hk-picker__item { display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:var(--hk-radius-control); cursor:pointer; }
.hk-theme .hk-picker__item:hover, .hk-theme .hk-picker__item--on { background:var(--hk-sand); }
.hk-theme .hk-dup { padding:14px 16px; border-radius:var(--hk-radius-card); background:var(--hk-surface); box-shadow:var(--hk-shadow-card); }
.hk-theme .hk-dup__cards { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); gap:12px; align-items:center; }
.hk-theme .hk-dup-card { padding:10px 12px; border-radius:var(--hk-radius-block); background:var(--hk-sand); }
.hk-theme .hk-dup__vs { font:500 12px var(--hk-font-body); color:var(--hk-muted); text-align:center; max-width:120px; }
.hk-theme .hk-dup__actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
.hk-theme .hk-filter { width:auto; min-width:120px; }
.hk-theme .hk-locked { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
.hk-theme .hk-locked__item { display:flex; align-items:flex-start; gap:8px; padding:8px 12px; border-radius:var(--hk-radius-block); background:var(--hk-surface); box-shadow:var(--hk-shadow-card); font-size:13px; color:var(--hk-cocoa); }
.hk-theme .hk-locked__item svg { color:var(--hk-muted); margin-top:1px; }
.hk-theme.hk-shell--phone .hk-dup__cards { grid-template-columns:minmax(0,1fr); }
.hk-theme.hk-shell--phone .hk-filter { min-width:0; flex:1 1 45%; }

/* hkos-gmail-connect-v1 Stage 3 - sync pill, drafts / replies, drawer, composer */
.hk-theme .hk-sync { gap:8px; }
.hk-theme .hk-sync--green .hk-pill__dot { background:var(--hk-green-fill); }
.hk-theme .hk-sync--amber { background:var(--hk-tint-mustard); color:var(--hk-tint-mustard-text); box-shadow:none; }
.hk-theme .hk-sync--amber .hk-pill__dot { background:var(--hk-tint-mustard-text); }
.hk-theme .hk-sync--grey { color:var(--hk-muted); }
.hk-theme .hk-sync--grey .hk-pill__dot { background:var(--hk-muted); }
.hk-theme .hk-sync:disabled { cursor:default; }
.hk-theme .hk-strip { margin:14px 0 0; padding:10px 14px; border-radius:var(--hk-radius-block); background:var(--hk-sand); color:var(--hk-cocoa); font-size:13px; }
.hk-theme .hk-pre { white-space:pre-wrap; font:400 14px var(--hk-font-body); color:var(--hk-cocoa); margin:0 0 14px; }
.hk-theme .hk-problems { list-style:none; margin:6px 0 10px; padding:0; display:flex; flex-direction:column; gap:6px; }
.hk-theme .hk-problem { padding:8px 12px; border-radius:var(--hk-radius-block); background:var(--hk-tint-block); color:var(--hk-tint-block-text); font-size:13px; }
.hk-theme .hk-problem--warn { background:var(--hk-tint-mustard); color:var(--hk-tint-mustard-text); }
.hk-theme .hk-modal--wide { width:min(720px, calc(100vw - 32px)); }
.hk-theme .hk-drawer { position:fixed; top:0; right:0; bottom:0; z-index:71; width:min(460px, 100vw); overflow-y:auto; padding:20px 22px; background:var(--hk-surface); box-shadow:-8px 0 30px rgba(43,29,20,.18); display:flex; flex-direction:column; gap:10px; }
.hk-theme .hk-drawer__head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.hk-theme .hk-drawer__title { font:600 20px var(--hk-font-display); color:var(--hk-cocoa); }
.hk-theme .hk-drawer__summary { margin:0; font-size:15px; color:var(--hk-cocoa); }
.hk-theme .hk-drawer__row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.hk-theme .hk-drawer .hk-form label { display:flex; flex-direction:column; gap:4px; }
.hk-theme.hk-shell--phone .hk-drawer { width:100vw; }
.hk-theme .hk-phone-top .hk-sync { font-size:12px; padding:5px 10px; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* hkos-daily-check-v1 - Today's cards */
.hk-theme .hk-today { display:flex; flex-direction:column; gap:14px; }
.hk-theme .hk-today .hk-toolbar { margin:0; }
.hk-theme .hk-today__card { padding:14px 16px; border-radius:var(--hk-radius-card); background:var(--hk-surface); box-shadow:var(--hk-shadow-card); border-left:4px solid var(--hk-line); }
.hk-theme .hk-today__card--urgent { border-left-color:var(--hk-orange); }
.hk-theme .hk-today__card--mustard { border-left-color:var(--hk-mustard); }
.hk-theme .hk-today__card .hk-row { background:var(--hk-sand); box-shadow:none; }
.hk-theme .hk-today__summary { flex:1 1 220px; min-width:0; }
.hk-theme .hk-today__actions { display:inline-flex; gap:6px; flex-wrap:wrap; align-items:center; width:100%; }
.hk-theme .hk-today__strip { width:100%; margin:0; }
.hk-theme .hk-today__foot { margin:4px 0 0; }
.hk-theme.hk-shell--phone .hk-today__card { padding:12px; }
.hk-theme.hk-shell--phone .hk-today__actions .ui-btn, .hk-theme.hk-shell--phone .hk-today__actions .ui-input { flex:1 1 auto; }
/* hkos-sheet-import-v1 - "+ New" and Review > Imports */
.hk-theme .hk-new { display:inline-flex; align-items:center; gap:6px; padding:7px 14px; border-radius:var(--hk-radius-control); background:var(--hk-green-fill); color:#fff; font:600 14px var(--hk-font-body); }
.hk-theme .hk-new:hover { background:var(--hk-forest); }
.hk-theme .hk-new--compact { padding:7px 9px; }
.hk-theme .hk-import-cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:10px; margin:12px 0 14px; }
.hk-theme .hk-import-card { padding:10px 12px; border-radius:var(--hk-radius-block); background:var(--hk-surface); box-shadow:var(--hk-shadow-card); }
.hk-theme .hk-import-card--skipped { background:var(--hk-sand); box-shadow:none; }
.hk-theme .hk-import-card__line { margin-top:6px; font-size:13px; color:var(--hk-cocoa); }
.hk-theme .hk-import-warnings { margin:0 0 12px; padding-left:18px; }
.hk-theme.hk-shell--phone .hk-import-cards { grid-template-columns:minmax(0,1fr); }

.hk-theme .hk-palette { position:fixed; z-index:71; top:14vh; left:50%; transform:translateX(-50%); width:min(520px, calc(100vw - 32px)); padding:8px; border-radius:var(--hk-radius-card); background:var(--hk-surface); border:1px solid var(--hk-line); box-shadow:0 12px 40px rgba(43,29,20,.18); }
.hk-theme .hk-palette__input { all:unset; box-sizing:border-box; width:100%; padding:10px 12px; font:400 15px var(--hk-font-body); color:var(--hk-cocoa); border-bottom:1px solid var(--hk-line); }
.hk-theme .hk-palette__input::placeholder { color:var(--hk-muted); }
.hk-theme .hk-palette__list { list-style:none; margin:6px 0 0; padding:0; max-height:50vh; overflow-y:auto; }
.hk-theme .hk-palette__item { display:flex; align-items:center; gap:10px; width:100%; padding:9px 12px; border-radius:10px; font:500 14px var(--hk-font-body); color:var(--hk-cocoa); }
.hk-theme .hk-palette__item[data-selected="true"] { background:var(--hk-sand); }
.hk-theme .hk-palette__none { padding:10px 12px; color:var(--hk-muted); }
/* hkos-inbox-v2 L2 - lanes on top; from 1100 px the list and the reader each scroll inside the window-high panes (the
   page does not), 760-1099 the reader is a drawer over the list, under 760 one pane at a time. */
.hk-theme .hk-inbox { display:flex; flex-direction:column; gap:12px; min-width:0; }
.hk-theme .hk-inbox__panes { display:grid; grid-template-columns:minmax(300px, 380px) minmax(0, 1fr); gap:18px; min-height:0; }
.hk-theme .hk-inbox--split .hk-inbox__list, .hk-theme .hk-inbox--split .hk-inbox__thread { overflow-y:auto; min-height:0; overscroll-behavior:contain; padding-right:4px; }
.hk-theme .hk-inbox--drawer .hk-inbox__panes { grid-template-columns:minmax(0, 1fr); position:relative; }
.hk-theme .hk-inbox--drawer .hk-inbox__list { overflow-y:auto; min-height:0; overscroll-behavior:contain; }
.hk-theme .hk-inbox__drawer { position:absolute; top:0; right:0; bottom:0; width:min(640px, 90%); overflow-y:auto; overscroll-behavior:contain; padding:14px 16px; background:var(--hk-surface); border-radius:var(--hk-radius-card) 0 0 var(--hk-radius-card); box-shadow:-8px 0 24px rgba(43,29,20,.14); z-index:5; }
.hk-theme .hk-inbox--phone .hk-inbox__panes { grid-template-columns:minmax(0, 1fr); }
.hk-theme .hk-inbox__list { display:flex; flex-direction:column; gap:10px; min-width:0; }
.hk-theme .hk-inbox__date { margin-left:auto; flex:none; white-space:nowrap; }
.hk-theme .hk-inbox__line { display:block; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:14px; }
.hk-theme .hk-inbox__line .hk-inbox__snippet { display:inline; }
.hk-theme .hk-inbox__row--compact { flex-direction:row; align-items:center; gap:10px; padding:6px 12px 6px 14px; }
.hk-theme .hk-inbox__row--compact .hk-inbox__subject { flex:1 1 auto; min-width:0; }
.hk-theme .hk-inbox__group { display:flex; flex-direction:column; gap:2px; padding:8px 0 4px; border-top:1px solid var(--hk-line); }
.hk-theme .hk-inbox__group-head { display:flex; align-items:center; gap:8px; padding:0 4px; min-width:0; }
.hk-theme .hk-inbox__group-head .ui-btn { margin-left:auto; }
.hk-theme .hk-inbox__panel--muted { box-shadow:none; background:var(--hk-cream); }
.hk-theme .hk-intel { display:flex; flex-direction:column; gap:6px; }
.hk-theme .hk-intel p { margin:0; }
.hk-theme .hk-inbox__tools { display:flex; flex-direction:column; gap:8px; }
.hk-theme .hk-inbox__search { display:flex; gap:8px; align-items:center; }
.hk-theme .hk-inbox__search .hk-search-input { flex:1 1 auto; min-width:0; }
.hk-theme .hk-inbox__rows { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:4px; }
.hk-theme .hk-inbox__row { display:flex; flex-direction:column; gap:3px; width:100%; text-align:left; padding:10px 12px 10px 14px; border-radius:var(--hk-radius-block); border-left:4px solid transparent; color:var(--hk-cocoa); }
.hk-theme .hk-inbox__row:hover { background:var(--hk-sand); }
.hk-theme .hk-inbox__row--on { background:var(--hk-cream); border-left-color:var(--hk-green); }
.hk-theme .hk-inbox__row--dim .hk-inbox__from, .hk-theme .hk-inbox__row--dim .hk-inbox__subject { color:var(--hk-muted); font-weight:400; }
.hk-theme .hk-inbox__row-top { display:flex; align-items:center; gap:8px; min-width:0; }
.hk-theme .hk-inbox__dot { width:8px; height:8px; border-radius:999px; background:var(--hk-green); flex:none; }
.hk-theme .hk-inbox__from { font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hk-theme .hk-inbox__row--unread .hk-inbox__from, .hk-theme .hk-inbox__row--unread .hk-inbox__subject { font-weight:700; }
.hk-theme .hk-inbox__hint { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:40%; }
.hk-theme .hk-inbox__subject { font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hk-theme .hk-inbox__snippet { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hk-theme .hk-inbox__chips { display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:2px; }
.hk-theme .hk-inbox__foot { margin:8px 4px 0; }
.hk-theme .hk-inbox__thread { min-width:0; display:flex; flex-direction:column; gap:12px; }
.hk-theme .hk-inbox__thread--empty { padding:24px 0; }
.hk-theme .hk-inbox__thread-head { display:flex; flex-direction:column; gap:8px; }
.hk-theme .hk-inbox__subject-title { margin:0; font:600 20px var(--hk-font-display); color:var(--hk-cocoa); }
.hk-theme .hk-inbox__actions { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
.hk-theme .hk-inbox__messages { display:flex; flex-direction:column; gap:10px; }
.hk-theme .hk-inbox__strip { margin:0; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.hk-theme .hk-inbox__older { align-self:flex-start; }
.hk-theme .hk-inbox__msg { border:1px solid var(--hk-line); border-radius:var(--hk-radius-block); background:var(--hk-surface); overflow:hidden; }
.hk-theme .hk-inbox__msg-head { display:flex; gap:10px; align-items:center; width:100%; text-align:left; padding:10px 14px; color:var(--hk-cocoa); }
.hk-theme .hk-inbox__msg--closed .hk-inbox__msg-head { background:var(--hk-cream); }
.hk-theme .hk-inbox__msg-from { font-weight:600; white-space:nowrap; }
.hk-theme .hk-inbox__msg-to { flex:1 1 auto; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hk-theme .hk-inbox__frame { display:block; width:100%; height:min(560px, 60vh); border:0; border-top:1px solid var(--hk-line); background:#fff; }
.hk-theme .hk-inbox__text { padding:12px 14px; margin:0; border-top:1px solid var(--hk-line); }
.hk-theme .hk-inbox__attachments { margin:0; padding:8px 14px 12px; list-style:none; display:flex; gap:12px; flex-wrap:wrap; border-top:1px solid var(--hk-line); }
.hk-theme .hk-inbox__panel { display:flex; flex-direction:column; gap:10px; padding:14px 16px; border-radius:var(--hk-radius-card); background:var(--hk-surface); box-shadow:var(--hk-shadow-card); min-width:0; }
.hk-theme .hk-inbox__panel--empty { box-shadow:none; background:transparent; }
.hk-theme .hk-inbox__panel-title { margin:0; font:600 18px var(--hk-font-display); color:var(--hk-cocoa); }
.hk-theme .hk-inbox__panel-actions { display:flex; gap:8px; flex-wrap:wrap; }
.hk-theme .hk-inbox__panel .hk-banner { margin:0; }
.hk-theme.hk-shell--phone .hk-inbox__panes { grid-template-columns:minmax(0, 1fr); }
.hk-theme.hk-shell--phone .hk-inbox__frame { height:min(420px, 55vh); }
.hk-theme .hk-ignored { list-style:none; margin:8px 0 0; padding:0; display:flex; flex-direction:column; gap:6px; }
.hk-theme .hk-ignored li { display:flex; gap:10px; align-items:center; }

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
