import { useState, useEffect } from 'react';
import { SA } from '../theme';
import { SEMANTIC } from '../palette';
import Button from '../../../ui/Button';
import { laWeekStart } from '../periods';
import { goalsApi } from './goalsApi';
import { fetchMovement } from '../pipelineApi';
import { linkBtn, md } from '../tasks/TaskRow';
import { h2Style, subStyle, numStyle, labelStyle, Dot, ErrorNote, weekLabel, addDays } from './goalsUi';
import { Row, FocusList, GlanceCard, todayCard } from './TodayView';
import { pickNewestFinal, pipelineMoves, focusOf } from './todayModel';

// sales-ia-v1 Stage 2 - Today for a Viewer (Design G): the newest finalized
// weekly report first, then the goal cards, the team's day, this week's
// pipeline moves and every member's Focus 5. Read-only: the only buttons are
// Open report, Download PDF and links (data-link).

// Walks back from this week until a finalized report turns up.
const WEEKS_BACK = 12;
export function useNewestFinalReport(businessId) {
  const [latest, setLatest] = useState(undefined); // undefined = loading, null = none
  const [current, setCurrent] = useState(null); // this week's status
  useEffect(() => {
    let live = true;
    (async () => {
      const seen = [];
      let week = laWeekStart();
      for (let i = 0; i < WEEKS_BACK && live; i++, week = addDays(week, -7)) {
        try {
          const d = await goalsApi.report(businessId, week);
          if (i === 0) setCurrent(d.report?.status || 'draft');
          seen.push({ week_start: week, report: d.report });
          if (d.report?.status === 'final') break;
        } catch { break; }
      }
      if (live) setLatest(pickNewestFinal(seen));
    })();
    return () => { live = false; };
  }, [businessId]);
  return { latest, current };
}

export function LatestReportCard({ latest, current, lookup, onOpen, onDownload }) {
  if (latest === undefined) return <section aria-label="Latest report" style={todayCard}><span style={subStyle}>Loading the latest report…</span></section>;
  const week = laWeekStart();
  const inProgress = current !== 'final' ? `${weekLabel(week).split(' · ')[0]} report is in progress` : null;
  if (!latest) {
    return (
      <section aria-label="Latest report" style={todayCard}>
        <span style={labelStyle}>Weekly report</span>
        <span style={{ fontSize: 14, color: SA.text }}>No finalized report yet{inProgress ? ` · ${inProgress.toLowerCase()}` : ''}.</span>
      </section>
    );
  }
  const r = latest.report;
  return (
    <section aria-label="Latest report" style={{ ...todayCard, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
      <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 10, background: SA.surface2, border: `1px solid ${SA.border}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: SA.soft, fontSize: 18 }}>▤</span>
      <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: SA.text }}>{weekLabel(latest.week_start)} report</span>
        <span style={{ fontSize: 12, color: SA.muted }}>
          <span style={{ color: SEMANTIC.healthy }}>✓ Finalized</span>{r.finalized_by ? ` by ${lookup(r.finalized_by).first}` : ''}{r.finalized_at ? ` · ${new Date(r.finalized_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}
          {inProgress ? ` · ${inProgress}` : ''}
        </span>
      </div>
      <div className="ui-theme-dark" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="secondary" onClick={() => onDownload(latest.week_start)}>Download PDF</Button>
        <Button variant="primary" onClick={() => onOpen(latest.week_start)}>Open report</Button>
      </div>
    </section>
  );
}

export function TeamTodayCard({ team, top, lookup, links, today, moves, movesError, onPipeline }) {
  return (
    <section aria-label="The team today" style={todayCard}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h2 style={h2Style}>The team today</h2>
        <span style={{ ...subStyle, fontSize: 12 }}>read-only</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
        {team.map(row => (
          <li key={row.member.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 40, borderTop: `1px solid ${SA.track}`, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: SA.text }}><Dot color={lookup(row.member.user_id).color} />{lookup(row.member.user_id).first}</span>
            <span style={{ ...numStyle, fontSize: 13, color: SA.soft }}>
              <span style={{ color: row.overdue ? SA.bad : SA.muted }}>{row.overdue ? '! ' : '✓ '}{row.overdue} overdue</span> · {row.due} due today · <span style={{ color: row.flags ? SA.warn : SA.muted }}>⚑ {row.flags} flag{row.flags === 1 ? '' : 's'}</span>
            </span>
          </li>
        ))}
      </ul>
      {moves !== null && (
        <div>
          <span style={labelStyle}>Pipeline moves this week</span>
          {movesError && <ErrorNote message={movesError} />}
          {moves === undefined && !movesError && <p style={{ ...subStyle, fontSize: 13, margin: '6px 0 0' }}>Loading…</p>}
          {Array.isArray(moves) && !moves.length && <p style={{ ...subStyle, fontSize: 13, margin: '6px 0 0' }}>No stage moves yet this week.</p>}
          {Array.isArray(moves) && moves.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
              {moves.map(m => (
                <li key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36, borderTop: `1px solid ${SA.track}`, fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: SA.text }}>{m.name} <span style={{ color: SA.muted }}>· {m.kind}</span></span>
                  <span style={{ color: SA.soft, whiteSpace: 'nowrap' }}>→ {m.to}</span>
                  <span style={{ ...numStyle, color: SA.muted, whiteSpace: 'nowrap', minWidth: 48, textAlign: 'right' }}>{m.at ? md(m.at.slice(0, 10)) : '—'}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" data-link="" style={{ ...linkBtn, marginTop: 6 }} onClick={onPipeline}>See the whole pipeline →</button>
        </div>
      )}
      <div>
        <span style={labelStyle}>Top of the list</span>
        {!top.length && <p style={{ ...subStyle, fontSize: 13, margin: '6px 0 0' }}>Nothing due today.</p>}
        <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
          {top.map(t => <Row key={t.id} t={t} today={today} dim meta={[t.link_type ? links.labelFor(t.link_type, t.link_id) : null, lookup(t.owner_user_id).first].filter(Boolean).join(' · ')} />)}
        </ul>
      </div>
    </section>
  );
}

export default function TodayViewer({ businessId, hero, compact, weekStart, members, lookup, links, today, partners, commitments, team, top, glance, onOpenReport, onDownload, onPipeline }) {
  const { latest, current } = useNewestFinalReport(businessId);
  const [moves, setMoves] = useState(undefined);
  const [movesError, setMovesError] = useState('');
  useEffect(() => {
    let live = true;
    setMoves(undefined); setMovesError('');
    Promise.all([fetchMovement(businessId, weekStart, addDays(weekStart, 6)), goalsApi.partnerEvents(businessId, { from: weekStart, to: addDays(weekStart, 7) })])
      .then(([movement, events]) => { if (live) setMoves(pipelineMoves({ events, partnersById: new Map(partners.map(p => [p.id, p])), movement })); })
      .catch(e => { if (live) { setMoves([]); setMovesError(e.message); } });
    return () => { live = false; };
  }, [businessId, weekStart, partners]);

  return (
    <>
      <LatestReportCard latest={latest} current={current} lookup={lookup} onOpen={onOpenReport} onDownload={onDownload} />
      {hero}
      <div style={{ display: 'grid', gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 340px', gap: 20, alignItems: 'start' }}>
        <TeamTodayCard team={team} top={top} lookup={lookup} links={links} today={today} moves={moves} movesError={movesError} onPipeline={onPipeline} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <section aria-label="Focus 5" style={todayCard}>
            <h2 style={h2Style}>Focus 5</h2>
            {members.map(m => {
              const items = focusOf(commitments, m.user_id);
              const done = items.filter(c => c.status === 'done').length;
              return (
                <div key={m.user_id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: SA.text }}><Dot color={lookup(m.user_id).color} />{lookup(m.user_id).first}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ ...numStyle, ...subStyle, fontSize: 12 }}>{items.length ? `${done} of ${items.length} done` : '– Not planned yet'}</span>
                  </div>
                  <FocusList readOnly items={items} label={`Focus 5 progress · ${lookup(m.user_id).first}`} />
                </div>
              );
            })}
          </section>
          <GlanceCard {...glance} />
        </div>
      </div>
    </>
  );
}
