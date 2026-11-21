// app-shell-v2 - the shell's one stylesheet (dark only), from the four mockups. --sh-hue is the workspace's own colour
// (the active nav bar, the header rule, the avatar); neon (#39FF14) appears ONLY on the focused search field.
export const SHELL_RAIL_KEY = 'prospector_shell_rail'; // localStorage, per user: { [userId]: 'rail' | 'wide' }
export const NAV_WIDE = 232, NAV_RAIL = 60, HEADER_H = 56, PHONE_TOP = 52, PHONE_TABS = 64;
export const SHELL_CSS = `
.sh-root{--sh-bg:#0B0D10;--sh-nav:#12161B;--sh-card:#1E242C;--sh-raise:#2E3540;--sh-text:#E9ECF0;--sh-mut:#A8B2C0;--sh-dim:#8892A0;--sh-line:rgba(120,130,144,.35);--sh-line2:rgba(120,130,144,.6);--sh-accent:#8FA8FF;--sh-neon:#39FF14;--sh-hue:#8FA8FF;
  display:flex;height:100vh;height:100dvh;width:100%;background:var(--sh-bg);color:var(--sh-text);font-family:'Geist',ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:14px;overflow:hidden}
.sh-root *{box-sizing:border-box}
.sh-root button{font-family:inherit}
.sh-lbl{font-family:'Geist Mono',ui-monospace,monospace;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--sh-mut);font-weight:500}
.sh-num{font-variant-numeric:tabular-nums}
.sh-note{font-size:12.5px;line-height:1.5;color:var(--sh-mut)}
.sh-nav{width:${NAV_WIDE}px;flex:none;background:var(--sh-nav);border-right:1px solid var(--sh-line);display:flex;flex-direction:column;height:100%;overflow-y:auto;overflow-x:hidden}
.sh-nav--rail{width:${NAV_RAIL}px}
.sh-ws{all:unset;box-sizing:border-box;cursor:pointer;height:${HEADER_H}px;flex:none;display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid var(--sh-line);width:100%}
.sh-nav--rail .sh-ws{padding:0;justify-content:center}
.sh-ws:focus-visible,.sh-ni:focus-visible,.sh-si:focus-visible,.sh-ua:focus-visible,.sh-icon:focus-visible,.sh-btn:focus-visible,.sh-row:focus-visible,.sh-tab:focus-visible,.sh-chip:focus-visible{outline:2px solid var(--sh-accent);outline-offset:-2px}
.sh-av{width:26px;height:26px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font:600 13px 'Geist',sans-serif;color:#0B0D10;flex:none;background:var(--sh-hue)}
.sh-items{display:flex;flex-direction:column;gap:2px}
.sh-ni{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:11px;height:36px;padding:0 12px;margin:0 8px;border-radius:8px;color:var(--sh-mut);font:500 13.5px 'Geist',sans-serif;position:relative}
.sh-ni:hover{color:var(--sh-text);background:rgba(120,130,144,.1)}
.sh-ni svg{flex:none}
.sh-ni[aria-current=page]{background:var(--sh-card);color:var(--sh-text)}
.sh-ni[aria-current=page] svg,.sh-ni[aria-current=page] .sh-glyph{color:var(--sh-hue)}
.sh-ni[aria-current=page]::before{content:"";position:absolute;left:-8px;top:6px;bottom:6px;width:3px;border-radius:0 3px 3px 0;background:var(--sh-hue)}
.sh-nav--rail .sh-ni{margin:0 10px;padding:0;justify-content:center;width:40px}
.sh-nav--rail .sh-ni[aria-current=page]::before{left:-10px}
.sh-glyph{width:16px;text-align:center;font-size:13px;line-height:1;flex:none}
.sh-bd{margin-left:auto;font:500 11px 'Geist',sans-serif;color:var(--sh-text);background:var(--sh-raise);border-radius:999px;padding:1px 7px}
.sh-nav--rail .sh-bd{position:absolute;top:2px;right:0;margin:0;padding:0 5px;font-size:10px}
.sh-soon{margin-left:auto;font:500 9.5px 'Geist Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--sh-dim);border:1px solid var(--sh-line);border-radius:999px;padding:1px 6px}
.sh-grp{padding:14px 20px 6px}
.sh-navfoot{margin-top:auto;padding:8px 0 10px;border-top:1px solid var(--sh-line);display:flex;flex-direction:column;gap:2px}
.sh-brand{display:flex;align-items:center;justify-content:space-between;padding:6px 20px 0}
.sh-nav--rail .sh-brand{justify-content:center;padding:6px 0 0}
.sh-brand span{font:600 11px 'Geist Mono',monospace;letter-spacing:.14em;color:var(--sh-dim)}
.sh-icon{all:unset;box-sizing:border-box;cursor:pointer;color:var(--sh-dim);display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center;border-radius:6px}
.sh-icon:hover{color:var(--sh-text)}
.sh-col{flex:1;min-width:0;display:flex;flex-direction:column;height:100%}
.sh-hdr{height:${HEADER_H}px;flex:none;display:flex;align-items:center;gap:12px;padding:0 24px;border-bottom:2px solid var(--sh-hue);background:var(--sh-bg);position:relative;z-index:60}
.sh-main{flex:1;min-height:0;overflow-y:auto;overflow-x:clip;position:relative}
.sh-pad{padding:18px 24px 32px}
.sh-btn{height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--sh-line);background:var(--sh-raise);color:var(--sh-text);font:500 13px 'Geist',sans-serif;display:inline-flex;align-items:center;gap:7px;white-space:nowrap;cursor:pointer;flex:none}
.sh-btn:hover{border-color:var(--sh-line2)}
.sh-btn--pri{background:var(--sh-accent);border-color:var(--sh-accent);color:#0B0D10}
.sh-btn--ghost{background:transparent}
.sh-ua{width:32px;height:32px;border-radius:999px;background:#6F8CF0;color:#0B0D10;font:600 12px 'Geist',sans-serif;display:inline-flex;align-items:center;justify-content:center;border:0;cursor:pointer;flex:none}
.sh-search{flex:1;max-width:620px;min-width:0;position:relative}
.sh-sf{height:38px;border-radius:10px;border:1px solid var(--sh-line2);background:var(--sh-nav);display:flex;align-items:center;gap:10px;padding:0 10px 0 12px;color:var(--sh-dim);font-size:14px}
.sh-sf input{all:unset;flex:1;min-width:0;color:var(--sh-text);font:14px 'Geist',sans-serif;caret-color:var(--sh-neon)}
.sh-sf input::placeholder{color:var(--sh-dim)}
.sh-sf.is-focus{border-color:var(--sh-neon);box-shadow:0 0 0 3px rgba(57,255,20,.14),0 0 24px rgba(57,255,20,.12);color:var(--sh-text)}
.sh-sf.is-focus .sh-sfglyph{color:var(--sh-neon)}
.sh-sfglyph{display:inline-flex;color:var(--sh-dim)}
.sh-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 5px;border-radius:5px;border:1px solid var(--sh-line2);background:var(--sh-card);font:500 11px 'Geist Mono',monospace;color:var(--sh-mut)}
.sh-scrim{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:55}
.sh-nav{position:relative;z-index:58}
.sh-pan{background:var(--sh-card);border:1px solid var(--sh-line2);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.6);overflow:hidden}
.sh-search .sh-pan{position:absolute;top:calc(100% + 15px);left:0;width:620px;max-width:calc(100vw - 48px);z-index:70;max-height:calc(100vh - 96px);overflow-y:auto}
.sh-rg{padding:10px 14px 4px;display:flex;justify-content:space-between}
.sh-row{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:11px;height:40px;padding:0 10px;margin:0 6px;border-radius:8px;font-size:13.5px;color:var(--sh-text);width:calc(100% - 12px);min-width:0}
.sh-row[aria-selected=true],.sh-row:hover{background:var(--sh-raise)}
.sh-row .sh-ico{width:24px;height:24px;border-radius:7px;background:var(--sh-nav);display:inline-flex;align-items:center;justify-content:center;color:var(--sh-mut);flex:none}
.sh-row .sh-ttl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;min-width:0}
.sh-row .sh-sub{color:var(--sh-mut);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 0;min-width:0}
.sh-row .sh-r{margin-left:auto;display:inline-flex;align-items:center;gap:8px;color:var(--sh-mut);font-size:12px;flex:none}
.sh-row mark{background:transparent;color:var(--sh-text);font-weight:600;border-bottom:1.5px solid var(--sh-accent)}
.sh-row--ask[aria-selected=true]{background:rgba(57,255,20,.06);outline:1px solid rgba(57,255,20,.35)}
.sh-row--ask .sh-ico{color:var(--sh-neon)}
.sh-ask-q{color:var(--sh-mut)}
.sh-pill{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 7px;border-radius:999px;border:1px solid;font:600 11px 'Geist',sans-serif;background:rgba(0,0,0,.2)}
.sh-pill small{font:500 11px 'Geist',sans-serif;opacity:.85}
.sh-ow{display:inline-flex;align-items:center;gap:6px}
.sh-ow i{width:8px;height:8px;border-radius:999px;display:inline-block}
.sh-foot{display:flex;gap:16px;align-items:center;padding:9px 16px;border-top:1px solid var(--sh-line);font-size:12px;color:var(--sh-mut);flex-wrap:wrap}
.sh-foot span{display:inline-flex;align-items:center;gap:6px}
.sh-sep{height:1px;background:var(--sh-line);margin:6px 0}
.sh-chip{all:unset;box-sizing:border-box;cursor:pointer;height:28px;padding:0 10px;border-radius:999px;border:1px solid var(--sh-line);color:var(--sh-mut);font:13px 'Geist',sans-serif;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.sh-chip:hover{color:var(--sh-text);border-color:var(--sh-line2)}
.sh-answer{padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.sh-answer p{margin:0;font-size:14px;line-height:1.5;overflow-wrap:anywhere}
.sh-menu{position:absolute;z-index:80;padding:6px;width:240px}
.sh-menu .sh-row{height:34px;margin:0;width:100%}
.sh-menuhead{padding:8px 10px 10px;border-bottom:1px solid var(--sh-line);margin-bottom:4px}
.sh-settings{display:grid;grid-template-columns:200px minmax(0,1fr);gap:28px;align-items:start}
.sh-si{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:10px;height:34px;padding:0 10px;border-radius:8px;color:var(--sh-mut);font-size:13.5px;width:100%}
.sh-si:hover{color:var(--sh-text)}
.sh-si[aria-current=page]{background:var(--sh-card);color:var(--sh-text);font-weight:500}
.sh-h1{margin:0;font-size:28px;font-weight:600;letter-spacing:-.025em;color:var(--sh-text)}
.sh-card{background:var(--sh-card);border:1px solid var(--sh-line);border-radius:14px}
.sh-phonetop{height:${PHONE_TOP}px;flex:none;display:flex;align-items:center;gap:10px;padding:0 12px 0 14px;border-bottom:2px solid var(--sh-hue);background:var(--sh-bg);position:relative;z-index:60}
.sh-tabs{height:${PHONE_TABS}px;flex:none;border-top:1px solid var(--sh-line);background:var(--sh-nav);display:flex;align-items:center;justify-content:space-around;padding:0 6px;position:relative;z-index:60}
.sh-tab{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;width:64px;height:52px;font-size:10.5px;color:var(--sh-mut);position:relative}
.sh-tab[aria-current=page]{color:var(--sh-text)}
.sh-tab[aria-current=page] svg{color:var(--sh-hue)}
.sh-centre{all:unset;box-sizing:border-box;cursor:pointer;width:52px;height:52px;border-radius:16px;background:var(--sh-nav);border:1px solid var(--sh-line2);display:inline-flex;align-items:center;justify-content:center;color:var(--sh-text);margin-top:-14px}
.sh-centre:focus-visible{outline:2px solid var(--sh-accent)}
.sh-full{position:fixed;inset:0;z-index:90;background:var(--sh-bg);display:flex;flex-direction:column}
.sh-full .sh-search{max-width:none}
.sh-full .sh-pan{position:static;width:auto;max-width:none;border:0;border-radius:0;box-shadow:none;background:transparent;max-height:none}
.sh-full .sh-row{height:48px}
.sh-sheet{position:fixed;left:0;right:0;bottom:0;z-index:95;background:var(--sh-card);border-top:1px solid var(--sh-line2);border-radius:18px 18px 0 0;padding:10px 16px 20px;max-height:86dvh;overflow-y:auto}
.sh-sheetrow{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:12px;height:50px;border-bottom:1px solid rgba(120,130,144,.18);font-size:16px;width:100%;color:var(--sh-text)}
.sh-sheetrow svg{color:var(--sh-mut)}
.sh-sheetrow small{margin-left:auto;font-size:13px;color:var(--sh-mut)}
.sh-wscard{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:10px;min-height:56px;border:1px solid var(--sh-line);border-radius:12px;padding:0 12px;margin-bottom:8px;width:100%}
@media (max-width:899px){
  .sh-root{flex-direction:column}
  .sh-pad{padding:12px 12px 24px}
  .sh-settings{grid-template-columns:minmax(0,1fr);gap:16px}
  .sh-h1{font-size:22px}
  .sh-btn{min-height:40px}
}
@media print{
  .sh-root,.sh-col,.sh-main{display:block;height:auto;overflow:visible;position:static}
  .sh-nav,.sh-hdr,.sh-phonetop,.sh-tabs{display:none !important}
}
`;
