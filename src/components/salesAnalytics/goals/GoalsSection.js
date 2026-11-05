import { useState, useEffect } from 'react';
import { SA } from '../theme';
import { SEMANTIC } from '../palette';
import { goalsApi } from './goalsApi';
import { pipelineMoves } from './todayModel';
import { fetchMovement } from '../pipelineApi';
import { labelStyle, h2Style, h3Style, subStyle, numStyle, cardStyle, Chip, Dot, addDays, weekOf, progressColor } from './goalsUi';

// sales-ia-v2 D1, moved under Actions by dashboard-v3 Stage 2: this week's commitments per person with Focus 5 progress
// and this week's Pipeline moves, for the week the frame row shows (the week nav is the frame's; the hero cards, the
// report card, the Scorecard and the Weekly report are gone). Viewers read all of it.
const timeOf = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function PersonCommitments({ person, commitments }) {
  const planned = commitments.filter(c => c.plan_id);
  const done = planned.filter(c => c.status === 'done').length;
  const p = planned.length ? done / planned.length : null;
  return (
    <div data-person-goals={person.user_id || 'unassigned'} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0', borderTop: `1px solid ${SA.track}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Chip><Dot color={person.color} />{person.first}</Chip>
        {planned.length
          ? <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: SA.muted }}>
              <span style={numStyle}>Focus 5 · {done} of {planned.length} done</span>
              <span style={{ width: 96, height: 4, borderRadius: 999, background: SA.track }}><span style={{ display: 'block', height: 4, borderRadius: 999, width: `${Math.max(p ? 2 : 0, Math.round((p || 0) * 100))}%`, background: progressColor(p) }} /></span>
            </span>
          : <span style={{ fontSize: 12, color: SA.faint }}>No Focus 5 planned</span>}
      </div>
      {!commitments.length && <span style={{ ...subStyle, fontSize: 13 }}>No commitments this week.</span>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {commitments.map(c => (
          <li key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Dot color={c.status === 'done' ? SEMANTIC.healthy : c.status === 'dropped' ? SA.faint : SA.neutral} />
            {c.plan_id && <span aria-label="Planned" title={c.plan_reason || 'Focus 5'} style={{ color: SA.accent }}>✦</span>}
            <span style={{ textDecoration: c.status === 'dropped' ? 'line-through' : 'none', color: c.status === 'done' ? SA.muted : SA.text }}>{c.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// members: the people shown (one filtered person, or everyone); commitments: this week's, already person-filtered.
export default function GoalsSection({ businessId, weekStart, members, lookup, commitments, partners }) {
  const [moves, setMoves] = useState(null);
  useEffect(() => {
    let live = true;
    const end = addDays(weekStart, 6);
    Promise.all([goalsApi.partnerEvents(businessId, { from: weekStart, to: end }).catch(() => []), fetchMovement(businessId, weekStart, end).catch(() => null)])
      .then(([events, movement]) => { if (live) setMoves(pipelineMoves({ events, partnersById: new Map(partners.map(p => [p.id, p])), movement })); });
    return () => { live = false; };
  }, [businessId, weekStart, partners]);

  const people = members.map(m => ({ ...lookup(m.user_id), commitments: commitments.filter(c => c.owner_user_id === m.user_id) }));
  const unowned = commitments.filter(c => !members.some(m => m.user_id === c.owner_user_id));
  if (unowned.length) people.push({ ...lookup(null), commitments: unowned });
  const card = { ...cardStyle, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 };

  return (
    <section id="goals-section" aria-labelledby="h-goals" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={labelStyle}>Goals</span>
        <h2 id="h-goals" style={h2Style}>{weekOf(weekStart)}</h2>
      </div>
      <div className="no-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 12 }}>
        <section aria-labelledby="h-commit-people" style={card}>
          <span style={labelStyle}>This week · commitments and Focus 5</span>
          <h3 id="h-commit-people" style={h3Style}>Per person</h3>
          {people.map(p => <PersonCommitments key={p.user_id || 'unassigned'} person={p} commitments={p.commitments} />)}
        </section>
        <section aria-labelledby="h-moves" style={card}>
          <span style={labelStyle}>Pipeline moves this week</span>
          <h3 id="h-moves" style={h3Style}>{moves ? `${moves.length} move${moves.length === 1 ? '' : 's'}` : 'Loading…'}</h3>
          {moves && !moves.length && <span style={{ ...subStyle, fontSize: 13 }}>No stage moves yet this week.</span>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(moves || []).map(m => (
              <li key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, minWidth: 0 }}>
                <Chip style={{ height: 20, fontSize: 11 }}>{m.kind}</Chip>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                <span style={{ color: SA.muted, whiteSpace: 'nowrap', marginLeft: 'auto' }}>→ {m.to}{m.at ? ` · ${timeOf(m.at)}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}
