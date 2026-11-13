// The Top targets page's own classes (tt-*), to the mockup's measurements on the sales theme's tokens. Global on
// purpose: the phone sheet and the toast are portalled out of the section.
export const TT_CSS = `
.tt-num { font-variant-numeric: tabular-nums; }
.tt-lbl { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--sa-muted); font-weight: 500; }
.tt-chip { height: 28px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--sa-border); background: transparent; color: var(--sa-muted); font: inherit; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; box-sizing: border-box; cursor: pointer; flex: none; }
.tt-chip b { font-weight: 500; color: var(--sa-text); }
.tt-chip i { width: 7px; height: 7px; border-radius: 999px; display: inline-block; }
.tt-chip[aria-pressed="true"] { border-color: var(--sa-accent); color: var(--sa-text) !important; background: color-mix(in srgb, var(--sa-accent) 12%, transparent); }
.tt-chip:focus-visible, .tt-star--btn:focus-visible, .tt-barbtn:focus-visible, .tt-name:focus-visible, .tt-link:focus-visible, .tt-mi:focus-visible, .tt-btn:focus-visible { outline: 2px solid var(--sa-accent); outline-offset: 2px; }
.tt-sep { width: 1px; height: 18px; background: var(--sa-border); margin: 0 4px; flex: none; }
.tt-search { display: flex; align-items: center; gap: 8px; width: 200px; height: 28px; padding: 0 10px; box-sizing: border-box; border: 1px solid var(--sa-border-strong); border-radius: 8px; background: var(--sa-inset); color: var(--sa-muted); }
.tt-search input { all: unset; flex: 1 1 auto; min-width: 0; font-size: 13px; color: var(--sa-text); }
.tt-search:focus-within { border-color: var(--sa-accent); }
.tt-legend { display: inline-flex; align-items: center; gap: 5px; margin-left: 12px; }
.tt-legend i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.tt-card { background: var(--sa-surface); border: 1px solid var(--sa-border); border-radius: 14px; }
.tt table { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: fixed; font-size: 13px; }
.tt th { position: sticky; top: 0; z-index: 2; background: var(--sa-surface); text-align: left; font-weight: 500; height: 34px; padding: 0 12px; border-bottom: 1px solid var(--sa-border-strong); white-space: nowrap; }
.tt th:first-child { border-top-left-radius: 14px; } .tt th:last-child { border-top-right-radius: 14px; }
.tt td { height: 50px; padding: 0 12px; border-bottom: 1px solid var(--sa-track); color: var(--sa-soft); vertical-align: middle; overflow: hidden; }
.tt tr:last-child td { border-bottom: 0; }
.tt-co { display: flex; flex-direction: column; gap: 2px; line-height: 1.2; min-width: 0; }
.tt-name { all: unset; cursor: pointer; color: var(--sa-link); font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tt-name:hover { text-decoration: underline; }
.tt-co span { font: 500 10px 'Geist Mono', ui-monospace, monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--sa-muted); display: inline-flex; align-items: center; gap: 6px; }
.tt-co i { width: 7px; height: 7px; border-radius: 999px; display: inline-block; }
.tt-band { display: inline-flex; align-items: center; gap: 7px; height: 22px; padding: 0 9px; border-radius: 999px; border: 1px solid; font-weight: 600; font-size: 12px; background: rgba(0,0,0,.2); box-sizing: border-box; }
.tt-band small { font-weight: 500; font-size: 12px; opacity: .85; }
.tt-pinl { font-size: 11.5px; color: var(--sa-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 3px; }
.tt-pinl b { color: var(--sa-accent); font-weight: 500; }
.tt-link { all: unset; cursor: pointer; color: var(--sa-link); }
.tt-link:hover { text-decoration: underline; }
.tt-bar { display: flex; gap: 2px; height: 8px; width: 160px; background: var(--sa-inset); border-radius: 3px; overflow: hidden; }
.tt-bar i { display: block; height: 8px; flex: none; }
.tt-barbtn { all: unset; display: block; cursor: default; border-radius: 3px; }
.tt-nums { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11.5px; color: var(--sa-muted); margin-top: 6px; font-variant-numeric: tabular-nums; }
.tt-nums b { color: var(--sa-text); font-weight: 500; }
.tt-why { font-size: 12.5px; line-height: 1.35; color: var(--sa-soft); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tt-nx { display: flex; align-items: flex-start; gap: 7px; font-size: 12.5px; line-height: 1.3; color: var(--sa-soft); }
.tt-nx svg { color: var(--sa-faint); flex: none; margin-top: 2px; }
.tt-nx span { color: var(--sa-muted); }
.tt-nx > div { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tt-star { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; }
.tt-star--btn { all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; }
.tt-star--btn:hover { background: var(--sa-surface-2); }
.tt-pop { position: absolute; background: var(--sa-surface); border: 1px solid var(--sa-border-strong); border-radius: 12px; padding: 14px 16px; box-shadow: 0 16px 40px rgba(0,0,0,.55); z-index: 5; font-size: 12.5px; line-height: 1.45; color: var(--sa-soft); text-align: left; box-sizing: border-box; white-space: normal; }
.tt-pop--menu { padding: 6px; }
.tt-pop, .tt-sheet, .tt-pop textarea, .tt-sheet textarea, .tt-pop button, .tt-sheet button { font-family: Geist, system-ui, sans-serif; }
.tt-pop h4, .tt-sheet h4 { margin: 0 0 8px; font-weight: 600; font-size: 13px; color: var(--sa-text); }
.tt-pr { display: grid; grid-template-columns: 10px 62px 26px 1fr; align-items: baseline; gap: 8px; padding: 3px 0; }
.tt-pr i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; align-self: center; }
.tt-pr b { color: var(--sa-text); font-weight: 500; }
.tt-pr em { font-style: normal; color: var(--sa-text); text-align: right; font-variant-numeric: tabular-nums; }
.tt-pr span { color: var(--sa-muted); }
.tt-popfoot { border-top: 1px solid var(--sa-border); margin-top: 8px; padding-top: 8px; color: var(--sa-muted); }
.tt-ta { width: 100%; height: 64px; box-sizing: border-box; background: var(--sa-inset); border: 1px solid var(--sa-border-strong); border-radius: 8px; padding: 8px 10px; color: var(--sa-text); font: inherit; font-size: 13px; line-height: 1.4; resize: none; }
.tt-btn { height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--sa-border); background: var(--sa-surface-2); color: var(--sa-text); font: inherit; font-weight: 500; font-size: 12.5px; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; cursor: pointer; }
.tt-btn--pri { background: var(--sa-accent); border-color: var(--sa-accent); color: var(--sa-ground); }
.tt-btn:disabled { opacity: .5; cursor: default; }
.tt-mi { all: unset; cursor: pointer; display: flex; align-items: center; justify-content: space-between; height: 32px; padding: 0 10px; border-radius: 8px; color: var(--sa-text); font-size: 13px; }
.tt-mi:hover { background: var(--sa-surface-2); }
.tt-mi span { color: var(--sa-muted); font-size: 12px; }
.tt-mi--bad { color: var(--sa-bad); }
.tt-sheet { background: var(--sa-surface); border: 1px solid var(--sa-border-strong); border-radius: 18px 18px 0 0; padding: 10px 16px 20px; display: flex; flex-direction: column; gap: 10px; color: var(--sa-soft); font-size: 14px; }
.tt-sheet .tt-mi { height: 44px; font-size: 15px; }
.tt-grip { width: 36px; height: 4px; border-radius: 999px; background: var(--sa-faint); align-self: center; }
`;
