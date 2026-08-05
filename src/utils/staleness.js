export const today = new Date();
export const staleDays = (d) => (d ? Math.floor((today - new Date(d)) / 86400000) : 999);
export const isStale = (d) => staleDays(d) >= 90;
export const isWarn = (d) => staleDays(d) >= 60 && staleDays(d) < 90;
