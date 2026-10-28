import React from 'react';

// priorities-v2 / company-panel-v3 D5 - the shared inline icons: a 16 box, 1.5 stroke, currentColor (so an icon takes the
// text color of its button), aria-hidden - the word beside it carries the meaning. No icon library. Paths from the
// design handoff (specs/design/priorities-v2). size = the rendered px.
const Svg = ({ size = 14, fill = 'none', children, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={fill} stroke={fill === 'none' ? 'currentColor' : 'none'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flex: 'none' }} {...rest}>{children}</svg>
);

export const IconDots = p => <Svg fill="currentColor" {...p}><circle cx="3.5" cy="11" r="2" /><circle cx="8" cy="6" r="2" /><circle cx="12.5" cy="9" r="2" /></Svg>;
export const IconBars = p => <Svg fill="currentColor" {...p}><rect x="2" y="7" width="3" height="7" rx=".5" /><rect x="6.5" y="3" width="3" height="11" rx=".5" /><rect x="11" y="9" width="3" height="5" rx=".5" /></Svg>;
export const IconTable = p => <Svg {...p}><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M2 7h12M2 10h12M7 3v10" /></Svg>;
export const IconIntent = p => <Svg {...p}><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" /></Svg>;
export const IconSize = p => <Svg {...p}><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M5.5 10.5l5-5M7 5.5h3.5V9" /></Svg>;
export const IconActivity = p => <Svg {...p}><path d="M1.5 9h3l2-5 3 8 2-3h3" /></Svg>;
export const IconHeightCompact = p => <Svg fill="currentColor" {...p}><rect x="2" y="10" width="12" height="4" rx=".5" /></Svg>;
export const IconHeightStandard = p => <Svg fill="currentColor" {...p}><rect x="2" y="6" width="12" height="8" rx=".5" /></Svg>;
export const IconHeightTall = p => <Svg fill="currentColor" {...p}><rect x="2" y="2" width="12" height="12" rx=".5" /></Svg>;
export const IconRings = p => <Svg {...p}><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" /></Svg>;
export const IconTrend = p => <Svg {...p}><path d="M2 11l4-4 3 3 5-5" /><path d="M10 5h4v4" /></Svg>;
export const IconRefresh = p => <Svg {...p}><path d="M13 8a5 5 0 1 1-1.5-3.6" /><path d="M13 3v3h-3" /></Svg>;
export const IconSearch = p => <Svg {...p}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></Svg>;
export const IconLabel = p => <Svg {...p}><path d="M2.5 4.5h7l4 3.5-4 3.5h-7z" /></Svg>;
export const IconStar = p => <Svg {...p}><path d="M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z" /></Svg>;
export const IconExternal = p => <Svg {...p}><path d="M9 3h4v4M13 3l-6 6M11 9.5V13H3V5h3.5" /></Svg>;
export const IconMore = p => <Svg fill="currentColor" {...p}><circle cx="3.5" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="12.5" cy="8" r="1.3" /></Svg>;
export const IconClose = p => <Svg {...p}><path d="M4 4l8 8M12 4l-8 8" /></Svg>;
export const IconPlus = p => <Svg {...p}><path d="M8 3v10M3 8h10" /></Svg>;
