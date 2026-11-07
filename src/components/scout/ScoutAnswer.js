import { useMemo, useState } from 'react';
import DataTable from '../../ui/DataTable';
import { StarGlyph, LockGlyph, OpenGlyph, PlusGlyph, ClearGlyph, SortGlyph, WorkspaceTag } from './ScoutParts';
import { answerSort, entityLabel, footerParts, summaryOf, clock } from './scoutModel';

// scout-v2 REV3 B4-B6 + D13 - the panel under the bar: working (the question, a neon sweep, elapsed seconds; the reads
// arrive WITH the answer - ask is not streamed), the answer (prose · list answers as the kit table sorted on Scout's
// field, marked in neon · Open + Task per row · Records with a one-line why · the footer from context_stats and the
// usage row · the thread), and the edge states (one line, at most one way out). Phone: stacked cards, no table.

const fmtDate = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

function Prose({ text }) {
  const blocks = String(text || '').split(/\n{2,}/).map(b => b.split('\n').filter(l => l.trim()));
  const inline = s => s.split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p));
  return (
    <div className="scout-prose" data-scout-prose>
      {blocks.map((lines, i) => (lines.every(l => /^\s*[-*•]\s+/.test(l))
        ? <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>)}</ul>
        : <p key={i}>{inline(lines.join(' '))}</p>))}
    </div>
  );
}

export function WorkingPanel({ q, elapsed }) {
  return (
    <div className="scout-panel" data-scout-working aria-live="polite">
      <div className="scout-q"><span className="scout-neon" style={{ display: 'inline-flex' }}><StarGlyph /></span><span>{q}</span></div>
      <div className="scout-sweep" aria-hidden="true" />
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--ui-muted)' }}>
        <span>Reading your workspace…</span><span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }} data-scout-elapsed>{elapsed} s</span>
      </div>
    </div>
  );
}

function RowActions({ item, canTask, onOpen, onTask, taskState }) {
  return (
    <span className="scout-actions">
      {item.open && <button type="button" className="scout-btn" onClick={() => onOpen(item)} aria-label={`Open ${item.title}`}><OpenGlyph />Open</button>}
      {canTask(item) && (
        <button type="button" className="scout-btn" onClick={() => onTask(item)} disabled={!!taskState} title="Add as task" aria-label={`Add a task for ${item.title}`}>
          <PlusGlyph />{taskState === 'added' ? 'Added' : taskState === 'busy' ? 'Adding…' : 'Task'}
        </button>
      )}
    </span>
  );
}

export function AnswerPanel({ turn, scopeChip, phone, scopeAll, colorOf, canTask, viewer, onOpen, onTask, taskStates, taskNote, inlineKey, turns, onReopen, onClear }) {
  const items = useMemo(() => turn.items || [], [turn.items]);
  const sortSpec = useMemo(() => answerSort(turn.ask, items), [turn.ask, items]);
  const [sort, setSort] = useState(() => (sortSpec ? { id: sortSpec.id, dir: sortSpec.dir } : null));
  const foot = footerParts(turn);
  const keyOf = it => `${it.entity}:${it.id}`;
  const valueCol = sortSpec || (items.some(i => i.score != null) ? { id: 'score', label: 'Score' } : items.some(i => i.date) ? { id: 'date', label: 'Date' } : null);
  const columns = [
    { id: 'title', label: 'Record', sortValue: r => r.title, render: r => <span title={r.title} style={{ color: 'var(--ui-text)', fontWeight: 500 }}>{r.title}</span>, title: r => r.title },
    { id: 'kind', label: 'Kind', width: 210, sortValue: r => entityLabel(r.entity), render: r => <span title={[entityLabel(r.entity), r.subtitle].filter(Boolean).join(' · ')}>{[entityLabel(r.entity), r.subtitle].filter(Boolean).join(' · ')}</span> },
    ...(scopeAll ? [{ id: 'ws', label: 'Workspace', width: 150, sortValue: r => r.workspace_name, render: r => <WorkspaceTag name={r.workspace_name} color={colorOf(r.workspace_id)} /> }] : []),
    ...(valueCol ? [{
      id: valueCol.id, width: 110,
      label: sortSpec ? <span className="scout-sortmark" data-scout-sort={sortSpec.id}><SortGlyph />{sortSpec.label}</span> : valueCol.label,
      sortValue: r => (valueCol.id === 'score' ? r.score : r.date),
      render: r => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{valueCol.id === 'score' ? (r.score ?? '—') : fmtDate(r.date) || '—'}</span>,
    }] : []),
    { id: 'act', label: 'Actions', width: canTask(items[0] || {}) ? 150 : 84, render: r => <RowActions item={r} canTask={canTask} onOpen={onOpen} onTask={onTask} taskState={taskStates[keyOf(r)]} /> },
  ];
  const list = items.length >= 2;
  return (
    <div className="scout-answer" data-scout-answer>
      <div className="scout-head scout-q"><span className="scout-neon" style={{ display: 'inline-flex' }}><StarGlyph /></span><span>{turn.q}</span>{scopeChip}</div>
      <div className="scout-panel" style={{ gap: 12 }}>
        <Prose text={turn.answer_md} />
        {list && !phone && (
          <DataTable label="Scout's records" columns={columns} rowKey={keyOf} sort={sort} onSort={setSort} groups={[{ id: 'records', header: 'Records', rows: items }]} />
        )}
        {list && phone && (
          <>
            {sortSpec && <span className="scout-lbl scout-neon" data-scout-sort={sortSpec.id}><SortGlyph />by {sortSpec.label.toLowerCase()}</span>}
            <div className="scout-cards" data-scout-cards>
              {items.map(r => (
                <div key={keyOf(r)} className="scout-card">
                  <span>{r.title}</span>
                  <div><span>{[r.subtitle || entityLabel(r.entity), r.date ? fmtDate(r.date) : r.score != null ? r.score : null].filter(Boolean).join(' · ')}</span><RowActions item={r} canTask={canTask} onOpen={onOpen} onTask={onTask} taskState={taskStates[keyOf(r)]} /></div>
                </div>
              ))}
            </div>
          </>
        )}
        {items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="scout-lbl">Records ({items.length})</span>
            <ul className="scout-records" data-scout-records>
              {items.map(r => (
                <li key={keyOf(r)} className={inlineKey === keyOf(r) ? 'is-inline' : undefined} title={r.why || r.title}>
                  <b>{r.title}</b>{r.why ? ` — ${r.why}` : ''}
                  {items.length === 1 && <> <RowActions item={r} canTask={canTask} onOpen={onOpen} onTask={onTask} taskState={taskStates[keyOf(r)]} /></>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {taskNote && <span className="scout-note" role="status">{taskNote}</span>}
        {viewer && <span className="scout-note" data-scout-viewer>Search and ask work read-only. Open goes to the record; there is no Add as task.</span>}
      </div>
      <div className="scout-footer" data-scout-footer>
        <span><b>{foot.records}</b> records read · {foot.reads}</span>
        {foot.cost && <span data-scout-cost>{foot.cost}</span>}
        {turn.elapsed != null && <span>{turn.elapsed} s</span>}
        <span style={{ flex: 1 }} />
        {foot.asks && <span data-scout-asks>{foot.asks}</span>}
      </div>
      <div className="scout-thread" data-scout-thread>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="scout-lbl">{phone ? `Thread · ${turns.length}` : 'Thread · last 6'}</span>
          <button type="button" className="scout-btn" onClick={onClear}><ClearGlyph />Clear</button>
        </div>
        {!phone && turns.map(t => (t.at === turn.at
          ? <div key={t.at} className="scout-turn is-now"><b>now</b><span>{t.q}</span></div>
          : <div key={t.at} className="scout-turn"><b>{clock(t.at)}</b><span>{t.q} → {summaryOf(t.answer_md)} · <button type="button" className="ui-link" onClick={() => onReopen(t)}>reopen</button></span></div>))}
      </div>
    </div>
  );
}

// B5 - one panel each: no hits · withheld · daily cap · empty scope · offline / 5xx (the Viewer's line rides in the answer).
export function EdgePanel({ kind, q, cap, message, onAsk, onRetry }) {
  const line = (glyph, children) => <div className="scout-edge-line">{glyph}<span>{children}</span></div>;
  const star = <StarGlyph size={14} />;
  const body = {
    nohits: { label: 'No hits', text: <>Nothing matches <b>“{q}”</b>. Try fewer letters, a person's last name, or ask it as a question.</>,
      action: <button type="button" className="scout-btn scout-btn--neon" onClick={onAsk}><StarGlyph size={13} />Ask “{q}” anyway</button> },
    withheld: { label: 'Answer withheld', glyph: <LockGlyph />, text: "The answer contained an email address, so Scout didn't show it. Ask for the person or company instead; names and titles are fine.",
      action: <button type="button" className="scout-btn scout-btn--plain" onClick={onRetry}>Retry without contact details</button> },
    cap: { label: 'Daily cap', text: <>You've used <b>{cap?.used ?? 40} of {cap?.max ?? 40}</b> asks today. Search still works; asking opens again at midnight PT.</> },
    empty: { label: 'No workspace', text: 'No workspace yet — ask the owner to add you.' },
    error: { label: 'Scout', text: message },
    offline: { label: 'Offline', text: "Scout can't reach the server · try again.", action: <button type="button" className="scout-btn scout-btn--plain" onClick={onRetry}>Retry</button> },
  }[kind];
  return (
    <div className="scout-edge" data-scout-edge={kind} role={kind === 'nohits' ? undefined : 'status'}>
      <span className="scout-lbl">{body.label}</span>
      {line(body.glyph || star, body.text)}
      {body.action && <div>{body.action}</div>}
    </div>
  );
}

