import React from 'react';

// hkos-project-shell-v1 appendix A - 24x24 line icons (stroke 2, round caps/joins, no fill, currentColor), the sprout
// mark, and the member avatar. Decorative marks are aria-hidden; icon-only buttons carry their own aria-label.
const PATHS = {
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  inbox: <><path d="M3 13l3-8h12l3 8v6a1 1 0 01-1 1H4a1 1 0 01-1-1z" /><path d="M3 13h5l1 3h6l1-3h5" /></>,
  replies: <path d="M4 5h16v11H9l-5 4z" />,
  drafts: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13 7l4 4" /></>,
  pipeline: <><rect x="3" y="4" width="5" height="16" rx="2" /><rect x="10" y="4" width="5" height="10" rx="2" /><rect x="17" y="4" width="4" height="13" rx="2" /></>,
  brands: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 10h18M9 10v10" /></>,
  sponsors: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />,
  review: <><circle cx="9" cy="9" r="5" /><circle cx="15" cy="15" r="5" /></>,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2L10 21h4l.5-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" /></>,
  chevron: <path d="M6 9l6 6 6-6" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  more: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
  // grow-nav-filters-v1 - the rail's bucket glyphs.
  star: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />,
  flow: <><circle cx="5" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="12" r="2" /><path d="M7 6h4l6 6M7 18h4l6-6" /></>,
  trend: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0" /><path d="M16 4.5a3.5 3.5 0 010 7M21.5 20a6.5 6.5 0 00-4-6" /></>,
  link: <><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  label: <><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.5" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  radar: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="M12 12l6-6" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  map: <><path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  send: <path d="M21 3L3 11l7 2 2 7z" />,
  rail: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  filter: <path d="M4 5h16l-6 8v5l-4 2v-7z" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  pencil: <><path d="M4 20h4L19 9l-4-4L4 16z" /></>,
};

export function Icon({ name, size = 18, label }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={label ? undefined : 'true'} aria-label={label} role={label ? 'img' : undefined}>
      {PATHS[name]}
    </svg>
  );
}

export function Sprout({ size = 28 }) {
  return (
    <svg width={size} height={(size * 30) / 28} viewBox="0 0 28 30" aria-hidden="true">
      <path d="M14 29V12" stroke="#2D8F4E" strokeWidth="3" strokeLinecap="round" />
      <path d="M14 16C14 9 9 5 3 5c0 7 4 11 11 11z" fill="#2D8F4E" />
      <path d="M14 13C14 7 19 3 25 3c0 7-4 10-11 10z" fill="#E6B23A" />
    </svg>
  );
}

// palette_index 1-4 from GET /api/hk/:id/shell (join order); the initial is the name's first letter.
export function Avatar({ name, index = 1, size = 34 }) {
  return (
    <span className="hk-avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.44), background: `var(--hk-member-${index})` }}>
      {(name || '?').charAt(0).toUpperCase()}
    </span>
  );
}
