import { useState } from 'react';
import { SA } from '../theme';
import { Box, linkBtn } from '../tasks/TaskRow';
import { cardStyle, labelStyle, h2Style, subStyle, numStyle, Dot, ErrorNote } from './goalsUi';
import { dueText, thingsCount } from './todayModel';

// sales-ia-v1 Stage 2 - Today for a Member (Design F): "Your day" from
// buildTaskGroups (todayModel.yourDaySections), Focus 5 and "This week at a
// glance". Writes: a tick = the Tasks drawer's path, Mark contacted = the
// Huddle's; both come in as callbacks from GoalsTab.
// Status is never color-only: overdue rows say "Nd late", flags carry ⚑,
// done rows are struck through with a check.

export const todayCard = { ...cardStyle, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 };
const sectionHead = (glyph, label, count, tone) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
    <span style={{ ...labelStyle, color: tone || SA.soft }}>{glyph ? `${glyph} ` : ''}{label}</span>
    <span style={{ ...numStyle, fontSize: 12, color: SA.muted }}>{count}</span>
  </div>
);
const metaOf = (t, lookup, links, teamView) => [
  t.link_type ? links.labelFor(t.link_type, t.link_id) : null,
  teamView ? lookup(t.owner_user_id).first : null,
].filter(Boolean).join(' · ');

export function Row({ t, today, meta, action, canEdit, onDone, dim }) {
  const done = t.st === 'done';
  const late = !done && t.due_date && t.due_date < today;
  return (
    <li data-task-id={t.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: `1px solid ${SA.track}`, minHeight: 44, boxSizing: 'border-box' }}>
      {onDone ? <div style={{ paddingTop: 1 }}><Box checked={done} disabled={!canEdit} label={`Done: ${t.text}`} onClick={() => onDone(t, !done)} /></div>
        : <span aria-hidden="true" style={{ width: 22, textAlign: 'center', color: dim ? SA.muted : SA.warn, flex: 'none' }}>{dim ? '•' : '⚑'}</span>}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: done ? SA.muted : SA.text, textDecoration: done ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>
          {done && <span aria-label="done">✓ </span>}{t.text}
        </span>
        {meta && <span style={{ fontSize: 12, color: SA.muted, overflowWrap: 'anywhere' }}>{meta}</span>}
      </div>
      {t.due_date && <span style={{ ...numStyle, fontSize: 12, color: late ? SA.bad : SA.muted, whiteSpace: 'nowrap', paddingTop: 2 }}>{dueText(t, today)}</span>}
      {action}
    </li>
  );
}

export function YourDay({ sections, today, lookup, links, teamView, canEdit, onDone, onContacted, onAllTasks, chips }) {
  const [error, setError] = useState('');
  const run = async fn => { setError(''); try { await fn(); } catch (e) { setError(e.message); } };
  const n = thingsCount(sections);
  const empty = sections.every(s => !s.items.length);
  return (
    <section aria-labelledby="h-your-day" style={todayCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 id="h-your-day" style={h2Style}>Your day</h2>
        <span style={{ ...numStyle, ...subStyle, fontSize: 13 }}>{n} thing{n === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        {/* Reserved: later specs put "Targets (n)" and "Suggested (n)" chips here. */}
        <span data-today-chips="" style={{ display: 'inline-flex', gap: 6 }}>{chips}</span>
        <button type="button" style={linkBtn} onClick={onAllTasks}>All tasks →</button>
      </div>
      {error && <ErrorNote message={error} />}
      {empty && <p style={{ ...subStyle, margin: 0, fontSize: 14 }}>Nothing overdue, due today or flagged. Open All tasks for the rest of the week.</p>}
      {sections.filter(s => s.items.length).map(s => (
        <div key={s.id} aria-label={s.label}>
          {sectionHead(s.glyph, s.label, s.items.length, s.id === 'overdue' ? SA.bad : s.id === 'flagged' ? SA.warn : null)}
          <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
            {s.items.map(t => (s.id === 'flagged'
              ? <Row key={t.id} t={t} today={today} meta={`Flagged by ${lookup(t.flagged_by).first}${t.flag_note ? ` · “${t.flag_note}”` : ''}`}
                  action={canEdit && <button type="button" onClick={() => run(() => onContacted(t))} style={{ ...linkBtn, border: `1px solid ${SA.border}`, borderRadius: 999, padding: '0 10px', height: 28, color: SA.text, fontSize: 12 }}>Mark contacted</button>} />
              : <Row key={t.id} t={t} today={today} meta={metaOf(t, lookup, links, teamView)} canEdit={canEdit} onDone={(x, d) => run(() => onDone(x, d))} />))}
          </ul>
        </div>
      ))}
    </section>
  );
}

// The planned commitments as a progress bar + list. readOnly = glyphs, no
// checkboxes (the viewer's Today).
export function FocusList({ items, readOnly, canEdit, onToggle, label = 'Focus 5 progress' }) {
  const [error, setError] = useState('');
  const done = items.filter(c => c.status === 'done').length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  if (!items.length) return null;
  return (
    <>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ height: 6, borderRadius: 999, background: SA.track, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: SA.good }} />
      </div>
      {error && <ErrorNote message={error} />}
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(c => {
          const isDone = c.status === 'done';
          return (
            <li key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minHeight: 36, padding: '6px 0' }}>
              {readOnly ? <span aria-hidden="true" style={{ width: 22, textAlign: 'center', color: isDone ? SA.good : SA.muted, flex: 'none' }}>{isDone ? '✓' : '○'}</span>
                : <Box checked={isDone} disabled={!canEdit} label={`Done: ${c.text}`} onClick={async () => { setError(''); try { await onToggle(c); } catch (e) { setError(e.message); } }} />}
              <span style={{ fontSize: 14, color: isDone ? SA.muted : SA.text, textDecoration: isDone ? 'line-through' : 'none', overflowWrap: 'anywhere', paddingTop: 2 }}>
                {readOnly && isDone && <span aria-label="done">✓ </span>}{c.text}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export function FocusCard({ items, ownerName, plannedAt, canEdit, onToggle, onEdit, onPlan }) {
  const done = items.filter(c => c.status === 'done').length;
  return (
    <section aria-label={`Focus 5${ownerName ? ` · ${ownerName}` : ''}`} style={todayCard}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h2 style={h2Style}>Focus 5</h2>
        {ownerName && <span style={{ ...subStyle, fontSize: 13 }}>{ownerName}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ ...numStyle, ...subStyle, fontSize: 13 }}>{items.length ? `${done} of ${items.length} done` : 'Not planned yet'}</span>
      </div>
      <FocusList items={items} canEdit={canEdit} onToggle={onToggle} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: SA.muted }}>
        {plannedAt && <span>Planned {plannedAt}</span>}
        <span style={{ flex: 1 }} />
        {canEdit && (items.length ? <button type="button" style={linkBtn} onClick={onEdit}>Edit plan</button> : <button type="button" style={linkBtn} onClick={onPlan}>Plan this week</button>)}
      </div>
    </section>
  );
}

// rows: [{ id, label, value (node), onOpen? }]
export function GlanceCard({ rows, onReport, title = 'This week at a glance' }) {
  const line = (r, inner) => (
    <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 36, borderTop: `1px solid ${SA.track}`, padding: '4px 0' }}>
      <span style={{ fontSize: 13, color: SA.soft }}>{r.label}</span>
      <span style={{ ...numStyle, fontSize: 14, fontWeight: 500, color: SA.text, display: 'inline-flex', alignItems: 'center', gap: 8 }}>{inner}</span>
    </div>
  );
  return (
    <section aria-label={title} style={todayCard}>
      <h2 style={h2Style}>{title}</h2>
      <div>
        {rows.map(r => (r.onOpen
          ? <button key={r.id} type="button" data-link="" onClick={r.onOpen} title={r.title} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', boxSizing: 'border-box' }}>{line(r, r.value)}</button>
          : line(r, r.value)))}
      </div>
      {onReport && <button type="button" data-link="" style={linkBtn} onClick={onReport}>Open weekly report →</button>}
    </section>
  );
}
export const partsInline = parts => parts.map(p => <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Dot color={p.color} />{p.label} {p.count}</span>);

export default function TodayView({ hero, compact, yourDay, focus, glance }) {
  return (
    <>
      {hero}
      <div style={{ display: 'grid', gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 340px', gap: 20, alignItems: 'start' }}>
        <YourDay {...yourDay} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <FocusCard {...focus} />
          <GlanceCard {...glance} />
        </div>
      </div>
    </>
  );
}
