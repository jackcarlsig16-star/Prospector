// top-targets-v1 Stage 2 (rulings S1-S7) - the page's pure pieces: the five-segment bar, the breakdown lines, the pin
// line under the score, the star's three states and the route params the chips send.
export const GROUP_ORDER = ['heat', 'fit', 'impact', 'recency', 'pin'];
export const GROUP_LABEL = { heat: 'Heat', fit: 'Fit', impact: 'Impact', recency: 'Recency', pin: 'Pin' };
// S1: four greys and the accent for the pin (the mockup's values; they sit on the dark surface only).
export const GROUP_COLOR = { heat: '#E9ECF0', fit: '#A8B2C0', impact: '#7C8694', recency: '#535C69', pin: 'var(--sa-accent)' };
const PARTS = {
  heat: [['visits', 'visits'], ['pages', 'pages'], ['apollo_intent', 'Apollo intent'], ['people', 'people'], ['engagement', 'engagement']],
  fit: [['fit', 'fit'], ['research', 'research']],
  impact: [['source', 'source'], ['stage', 'stage']],
  recency: [['recency', 'last signal']],
};
export const SIZE_OPTIONS = [{ value: '', label: 'All' }, { value: '5000', label: '5,000+' }, { value: '1000', label: '1,000–4,999' }, { value: '200', label: '200–999' }, { value: 'small', label: 'Under 200' }, { value: 'unknown', label: 'Unknown' }];
export const BANDS = ['P1', 'P2', 'P3', 'P4'];
export const REASON_MAX = 140;

// The filled length is the score out of 100. A group that takes points away (recency, a held band) draws nothing and
// the others shrink by the same share, so the drawn parts still add up to the score.
export function segments(groups = {}, score = 0) {
  const pos = GROUP_ORDER.map(k => [k, Math.max(0, Number(groups[k]) || 0)]);
  const sum = pos.reduce((n, [, v]) => n + v, 0);
  const scale = sum > 0 ? Math.max(0, score) / sum : 0;
  return pos.filter(([, v]) => v > 0).map(([key, v]) => ({ key, points: Number(groups[key]) || 0, pct: v * scale }));
}
export const barLabel = groups => GROUP_ORDER.map(k => `${GROUP_LABEL[k]} ${Number(groups?.[k]) || 0}`).join(' · ');

export function breakdownTitle(row) {
  const pin = Number(row.groups?.pin) || 0;
  return pin > 0 ? `${row.name} · ${row.score} = ${row.score - pin} scored + ${pin} pin` : `${row.name} · ${row.score}`;
}
export function breakdownLines(row) {
  const pin = Number(row.groups?.pin) || 0;
  const pinText = pin > 0 ? `lifts ${row.score - pin} to the ${row.band} floor of ${row.score} until the pin ends`
    : pin < 0 ? `holds ${row.score - pin} at ${row.band} until the pin ends` : 'no pin lift';
  return GROUP_ORDER.map(key => ({
    key, label: GROUP_LABEL[key], points: Number(row.groups?.[key]) || 0,
    text: key === 'pin' ? pinText : PARTS[key].map(([k, word]) => `${word} ${Number(row.parts?.[k]) || 0}`).join(' · '),
  }));
}

const md = d => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const shortDate = d => (d ? md(d) : null);

// 'pinned' | 'expired' | 'none'
export const starState = row => (row.pin ? 'pinned' : row.pin_expired ? 'expired' : 'none');
export const starLabel = row => ({ pinned: `Pinned: ${row.name}. Edit, renew or unpin`, expired: `Pin expired: ${row.name}. Renew or unpin`, none: `Pin ${row.name}` }[starState(row)]);

// -> { lead, rest } | null. "Pinned · 18 d left · <reason>" / "Held at P3 · …" / "Pin expired Nov 9".
export function pinLine(row) {
  if (row.pin) return { lead: row.pin.held ? `Held at P${row.pin.level}` : 'Pinned', rest: [`${row.pin.days_left} d left`, row.pin.reason].filter(Boolean).join(' · '), live: true };
  if (row.pin_expired) return { lead: `Pin expired ${md(row.pin_expired.until)}`, rest: '', live: false };
  return null;
}

// owner: 'me' | <user id> | 'team'
export function routeParams({ owner, band, pinned, size, q }) {
  return { limit: '1000', ...(owner && owner !== 'team' ? { owner } : {}), ...(band ? { band } : {}), ...(pinned ? { pinned: 'true' } : {}), ...(size ? { size } : {}), ...(q ? { q } : {}) };
}

// The owner chips: Mine first (S3 - it replaces the signed-in member's own name), the other members, then Team.
export function ownerChips(members = [], meId, data) {
  const n = id => data?.counts?.owners?.[id] || 0;
  return [
    { id: 'me', label: 'Mine', count: n(meId), color: null },
    ...members.filter(m => m.user_id !== meId).map(m => ({ id: m.user_id, label: String(m.name || '').trim().split(/\s+/)[0], count: n(m.user_id), color: m.color || null })),
    { id: 'team', label: 'Team', count: data?.book ?? 0, color: null },
  ];
}
