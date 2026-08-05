import { T } from './tokens';

export const C = {
  bg: "var(--c-bg)", sur: "var(--c-sur)", card: "var(--c-card)", brd: "#2E3548", brdM: "#3A4258",
  txt: "var(--c-txt)", mut: "var(--c-mut)", dim: "var(--c-dim)",
  gold: T.tier.gold, goldBg: "#1A1500", goldBdr: "#4A3800", goldTxt: "#FFE066",
  silver: T.tier.silver, silverBg: "#15191E", silverBdr: "#3A4250",
  tin: T.tier.tin, tinBg: "#111418", tinBdr: "#2A3340",
  slag: T.tier.slag, slagBg: "#0E0E12", slagBdr: "#26262E",
  green: "#42E890", red: "#F06060", orange: "#F5A050", purple: "#A878F0", blue: "#56A8F8",
};
export const TS = {
  Gold: { c: C.gold, bg: C.goldBg, b: C.goldBdr, t: C.goldTxt, i: "◆" },
  Silver: { c: C.silver, bg: C.silverBg, b: C.silverBdr, t: C.silver, i: "◇" },
  Tin: { c: C.tin, bg: C.tinBg, b: C.tinBdr, t: C.tin, i: "○" },
  Slag: { c: C.slag, bg: C.slagBg, b: C.slagBdr, t: C.slag, i: "×" },
};
export const mono = { fontFamily: "'SF Mono', ui-monospace, monospace" };
