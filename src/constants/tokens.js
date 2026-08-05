// Single source of truth for the HUD palette.
// Import as: import { T } from '../constants/tokens';
// Then reference: T.neon, T.tier.gold, T.bg.base, etc.

export const T = {
  neon:    '#39FF14',
  amber:   '#FFB800',
  amber2:  '#F59E0B',
  cyan:    '#00F5FF',
  magenta: '#FF3DFF',
  red:     '#FF4444',
  tier: {
    gold:   '#FFD700',
    silver: '#7EB8D4',
    tin:    '#8899AA',
    slag:   '#555566',
  },
  bg: {
    base:         '#050f05',
    card:         '#0a0f0a',
    cardExpanded: '#0d150d',
    surface:      '#0a1a0f',
  },
  border: {
    muted:  '#333',
    dim:    '#1a1a1a',
    subtle: 'rgba(255,255,255,0.06)',
    mid:    'rgba(255,255,255,0.12)',
  },
  text: {
    primary: '#e8e8e8',
    muted:   '#888',
    dim:     '#555',
  },
  spacing: {
    pill: '2px 7px',
    row:  '12px 14px',
    gap:  { xs: 4, sm: 6, md: 8 },
  },
};
