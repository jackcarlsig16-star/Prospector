// sales-analytics-design-v1 Stage 2 - the bounce thresholds the Sequences table's health rule reads (the alerts row
// itself is gone: dashboard-v3 merged it into Insights).

// Exported - the leaderboard's row-tint rule ("rows with bounce > 5% get
// a faint red tint", design-v1 Stage 3) is the SAME 5% line, not a
// separately-tuned copy.
export const BOUNCE_ALERT_THRESHOLD = 0.05; // SPEC: "bounce > 5%"
// Exported - the leaderboard's own "status-colored when delivered >= 20,
// otherwise faint" and "Low volume" health pill (design-v1 Stage 3) share
// this same floor.
export const BOUNCE_ALERT_MIN_DELIVERED = 20; // SPEC: "≥20 delivered"
