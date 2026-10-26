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
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
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
