import React from 'react';
// grow-sponsor-deals-v1 - the words and tones every deal surface shares (money view, rail, Deal card, labels, Inbox).
// Every color carries its word: Confirmed green, In discussion mustard tint, Declined grey.
export const DEAL_STAGE_WORDS = { prospect: 'Prospect', discussing: 'In discussion', sponsor: 'Sponsor', past_sponsor: 'Past sponsor', founding_partner: 'Founding partner', declined: 'Declined', needs_update: 'Needs update' };
export const DEAL_STAGE_TONE = { prospect: 'grey', discussing: 'mustard', sponsor: 'green', past_sponsor: 'grey', founding_partner: 'lilac', declined: 'grey', needs_update: 'mustard' };
export const STATE_WORDS = { confirmed: 'Confirmed', discussing: 'In discussion', declined: 'Declined' };
export const STATE_TONE = { confirmed: 'green', discussing: 'mustard', declined: 'grey' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthWords = m => (m === 'launch' ? 'Launch' : /^\d{4}-\d{2}$/.test(m) ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : m);
export const usd = v => (v == null ? '—' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
export const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const t = y * 12 + (mo - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
// A past month still In discussion (nobody closed it) - mirrors api/hk/deals.js needsUpdate / moveTarget.
export const needsUpdate = (p, thisMonth) => p.kind === 'monthly' && (p.state || 'confirmed') === 'discussing' && p.period < thisMonth;
export const moveTarget = (p, thisMonth) => { const n = addMonths(p.period, 1); return n < thisMonth ? thisMonth : n; };
export const chicagoMonth = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now).slice(0, 7);

export const DealStageChip = ({ stage }) => (stage && stage !== 'prospect'
  ? <span className={`hk-label hk-label--${DEAL_STAGE_TONE[stage] || 'line'}`} data-hk-label="deal" data-hk-deal-stage={stage}><span className="hk-label__k">Deal</span> {DEAL_STAGE_WORDS[stage] || stage}</span>
  : null);
