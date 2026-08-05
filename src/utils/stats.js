// Global stat trackers — use these instead of inline localStorage helpers

export const trackStat = (key, by = 1) => {
  try {
    const s = JSON.parse(localStorage.getItem("prospector_stats") || "{}");
    s[key] = (s[key] || 0) + by;
    localStorage.setItem("prospector_stats", JSON.stringify(s));
    window.dispatchEvent(new Event("prospector_stats_changed"));
  } catch {}
};

export const trackDailyStat = (key, by = 1) => {
  try {
    const t = new Date().toISOString().slice(0, 10);
    const s = JSON.parse(localStorage.getItem(`prospector_daily_${t}`) || "{}");
    s[key] = (s[key] || 0) + by;
    localStorage.setItem(`prospector_daily_${t}`, JSON.stringify(s));
    window.dispatchEvent(new Event("prospector_daily_changed"));
  } catch {}
};
