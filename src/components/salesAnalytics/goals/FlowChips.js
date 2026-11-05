import { SA } from '../theme';
import { ownerChip, kindStageWord } from './flowModel';

// homelover-flow-v1 F1 / F9 - the live partner's head chips (mockup C): kind + category, owner (member color; "Me" for
// the viewer's own; dashed = unassigned), Live since. Each chip is text + a dot, so color never carries the meaning
// alone. A chip with onClick is a button (menu opener), else a plain span.
const TONE = { good: SA.good, accent: SA.accent, muted: SA.muted, bad: SA.bad, warn: SA.warn };
const base = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', border: `1px solid ${SA.border}`, color: SA.text, background: 'transparent', font: 'inherit', boxSizing: 'border-box', maxWidth: '100%' };

export function Chip({ color = null, dashed = false, tone = null, dot = true, title, onClick, expanded, children, testId, style }) {
  const edge = color || (tone ? TONE[tone] : SA.border);
  const st = { ...base, borderColor: color || tone ? `color-mix(in srgb, ${edge} 55%, ${SA.border})` : SA.border, borderStyle: dashed ? 'dashed' : 'solid', color: tone === 'muted' ? SA.muted : SA.text, cursor: onClick ? 'pointer' : 'default', ...style };
  const inner = <>{dot && (color || tone) && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: dashed ? 'transparent' : edge, border: dashed ? `1.5px dashed ${edge}` : 'none', flex: 'none' }} />}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>{onClick && <span aria-hidden="true" style={{ color: SA.muted, fontSize: 10 }}>▾</span>}</>;
  return onClick
    ? <button type="button" data-chip={testId} title={title} aria-haspopup="menu" aria-expanded={expanded} onClick={onClick} className="ui-fact-btn" style={st}>{inner}</button>
    : <span data-chip={testId} title={title} style={st}>{inner}</span>;
}

export const KindStageChip = ({ row }) => <Chip testId="kind" dot={false}>{kindStageWord(row)}</Chip>;

export function OwnerChip({ row, members, meId, onClick, expanded }) {
  const o = ownerChip({ ownerUserId: row.owner_user_id, ownerTeam: row.owner_team, coOwnerName: row.co_owner_name, members, meId });
  return <Chip testId="owner" color={o.color} dashed={o.dashed} title={o.title} onClick={onClick} expanded={expanded} style={{ '--owner-color': o.color }}>{o.word}</Chip>;
}

export const LiveChip = ({ since }) => <Chip testId="live" tone="good" title="Live partner">{since ? `Live since ${since}` : 'Live'}</Chip>;
