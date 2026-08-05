// Frontier row status enum + display tables.
// Shared by FrontierPage (filter pills, counts) and OutboundCard (per-row dropdown).
// Lives in /constants to avoid a circular import (FrontierPage already
// imports OutboundCard).

export const ALL_STATUSES = [
  "Have not touched yet",
  "Cold",
  "Outbounded",
  "Partly Outbounded",
  "Positive Reply",
  "Negative Reply",
  "Meeting Booked",
  "NO SHOW",
  "Reach back out later",
  "Handoff complete",
  "Not interested",
];

export const STATUS_C = {
  "Have not touched yet": "#9CA3AF",
  "Cold":                 "#7DD3FC",
  "Outbounded":           "#4A9AE8",
  "Partly Outbounded":    "#5AA8E8",
  "Positive Reply":       "#4ADE80",
  "Negative Reply":       "#F87171",
  "Meeting Booked":       "#00C9A7",
  "NO SHOW":              "#F87171",
  "Reach back out later": "#9CA3AF",
  "Handoff complete":     "#4ADE80",
  "Not interested":       "#F87171",
};

export const STATUS_EMOJI = {
  "Have not touched yet": "⚪",
  "Cold":                 "🔵",
  "Outbounded":           "📤",
  "Partly Outbounded":    "📨",
  "Positive Reply":       "✅",
  "Negative Reply":       "❌",
  "Meeting Booked":       "📅",
  "NO SHOW":              "⛔",
  "Handoff complete":     "🤝",
  "Reach back out later": "⏰",
  "Not interested":       "🚫",
};

export const STATUS_BOLD = new Set(["Meeting Booked", "NO SHOW"]);
