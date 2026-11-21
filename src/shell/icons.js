// app-shell-v2 - the shell's icons: 16-px strokes on currentColor (the mockups' own paths). Icon({ name, size }).
const P = {
  home: <path d="M2.5 7.5 8 3l5.5 4.5V13h-4V9.5h-3V13h-4z" />,
  today: <><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /><path d="M5.5 8.2l1.8 1.8 3.4-3.8" /></>,
  pipeline: <><rect x="2" y="3" width="3" height="10" rx="1" /><rect x="6.5" y="3" width="3" height="7" rx="1" /><rect x="11" y="3" width="3" height="4.5" rx="1" /></>,
  dashboard: <path d="M2.5 13.5v-11M2.5 13.5h11M5 10.5l2.5-3 2 1.5 3-4" />,
  marketing: <path d="M2.5 6.5v3h2l5 3v-9l-5 3zM12 6.2a2.5 2.5 0 0 1 0 3.6" />,
  ideas: <path d="M5.5 10.5a4 4 0 1 1 5 0V12h-5zM6.5 14h3" />,
  settings: <><circle cx="8" cy="8" r="2" /><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" /></>,
  bell: <path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3zM6.5 14h3" />,
  plus: <path d="M8 3v10M3 8h10" />,
  company: <><rect x="3" y="2.5" width="10" height="11" rx="1" /><path d="M6 5.5h1M9 5.5h1M6 8h1M9 8h1M7 13.5v-2.5h2v2.5" /></>,
  person: <><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c.5-2.8 2.5-4 5-4s4.5 1.2 5 4" /></>,
  switch: <path d="M5 6.5 8 3.5l3 3M5 9.5l3 3 3-3" />,
  collapse: <path d="M9.5 4.5 6 8l3.5 3.5" />,
  expand: <path d="M6.5 4.5 10 8l-3.5 3.5" />,
  more: <><circle cx="3.5" cy="8" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="12.5" cy="8" r="1" /></>,
  mail: <><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="M2.5 4.5 8 9l5.5-4.5" /></>,
  voice: <><rect x="6" y="2" width="4" height="7.5" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2" /></>,
  team: <><circle cx="6" cy="6" r="2.2" /><path d="M2 13c.4-2.2 2-3.2 4-3.2s3.6 1 4 3.2M10.5 4.2a2.2 2.2 0 0 1 0 3.9M11.5 9.9c1.4.3 2.3 1.3 2.5 3.1" /></>,
  link: <path d="M6.8 9.2a2.5 2.5 0 0 0 3.5 0l2.2-2.2a2.5 2.5 0 0 0-3.5-3.5l-.7.7M9.2 6.8a2.5 2.5 0 0 0-3.5 0L3.5 9a2.5 2.5 0 0 0 3.5 3.5l.7-.7" />,
  refresh: <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v2.5h-2.5" />,
  log: <path d="M4 3h8v10H4zM6 6h4M6 8.5h4M6 11h2" />,
  dot: <circle cx="8" cy="8" r="2.5" />,
  grid: <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></>,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
};
const STAR = 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z';

export default function Icon({ name, size = 16 }) {
  if (name === 'scout' || name === 'star') return <svg width={size} height={size} viewBox="0 0 16 16" fill={name === 'star' ? 'currentColor' : 'none'} stroke={name === 'star' ? 'none' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={STAR} /></svg>;
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name] || P.dot}</svg>;
}
export const ICON_NAMES = [...Object.keys(P), 'scout', 'star'];
