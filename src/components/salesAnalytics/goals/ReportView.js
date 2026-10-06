import { useState, useEffect, useRef } from 'react';
import { SA, saSans } from '../theme';
import { SEMANTIC } from '../palette';
import Ring from '../charts/Ring';
import KpiTable from './KpiTable';
import {
  cardStyle, labelStyle, h2Style, h3Style, subStyle, numStyle, rowStyle, inputStyle,
  Chip, Dot, Btn, AddButton, SourceBadge, NeedsMigration, ErrorNote, fmt, short, pct, progressColor, weekOf,
} from './goalsUi';

// Seif's weekly report, his section order and labels (specs/design/
// goals-mockup.dc.html). 6-9 are one Pipeline card in the mockup; its notes
// live under s6. Commitments (his section 15) come first.
export const SECTIONS = [
  { n: 1, key: 's1', title: 'Executive summary', expect: 'Last week, biggest win, biggest issue, top priorities for this week.', rows: 8 },
  { n: 2, key: 's2', title: 'Sales infrastructure', expect: 'CRM, data tools, email systems, LinkedIn, reporting, collateral, scheduling: Completed / In progress / Blocked.', list: true },
  { n: 3, key: 's3', title: 'Target market & account lists', expect: 'Targets identified, segmentation, priority accounts, new accounts this week.', link: 'view:companies' },
  { n: 4, key: 's4', title: 'Outreach activity', expect: 'Orgs and decision-makers contacted, emails, calls, LinkedIn, intros, follow-ups.', link: 'overview' },
  { n: 5, key: 's5', title: 'Meetings', expect: 'Held last week, scheduled ahead, who attends, objective of each.' },
  { n: '6–9', key: 's6', title: 'Pipeline, movement, top opportunities & funnel', expect: 'Every opportunity by stage, what moved, top 5–10 deals, funnel conversion.', link: 'overview', placeholder: 'Anything to add beyond the pipeline numbers?' },
  { n: 10, key: 's10', title: 'Sales collateral & messaging', expect: 'What prospects respond to, repeated objections, pitch changes needed.', placeholder: 'What is landing, what is not…' },
  { n: 11, key: 's11', title: 'Lead generation', expect: 'Which sources produce opportunities, what to test next.', placeholder: 'Sources working, next test…' },
  { n: 12, key: 's12', title: 'Forecast', expect: 'Expected closes and launches in 30 / 60 / 90 days, with confidence.', link: 'overview', placeholder: 'Confidence and dependencies…' },
  { n: 13, key: 's13', title: 'Problems & blockers', expect: 'Product, pricing, legal, collateral, tech, data, responsiveness.' },
  { n: 14, key: 's14', title: 'CEO / founder help needed', expect: 'Intros, joining a meeting, approvals, decisions, collateral.' },
];
const LINK_LABELS = { 'view:companies': 'Companies', 'view:partners': 'Partners', 'view:this_week': 'This week', 'view:report': 'Weekly report', overview: 'Pipeline & overview' };
const linkLabel = t => LINK_LABELS[t] || (t?.startsWith('section:') ? `§${t.slice(9).replace(/^s/, '')}` : '');
const METRIC_FORMAT = { outbound_audience: short, open_rate: pct };
const formatMetric = (key, v) => (METRIC_FORMAT[key] || fmt)(v);
const INFRA_STATUS = { completed: { label: 'Completed', color: SEMANTIC.healthy }, in_progress: { label: 'In progress', color: SEMANTIC.warning }, blocked: { label: 'Blocked', color: SEMANTIC.problem } };
const timeOf = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function SectionNotes({ section, notes, editable, onSave, onSaved }) {
  const [value, setValue] = useState(notes);
  const [state, setState] = useState('');
  const dirty = useRef(false);
  const timer = useRef(null);
  useEffect(() => { if (!dirty.current) setValue(notes); }, [notes]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = e => {
    const v = e.target.value;
    setValue(v); dirty.current = true; setState('Saving…');
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { const s = await onSave(section.key, v); dirty.current = false; setState(`Saved ${timeOf(s.updated_at)}`); onSaved(s); }
      catch (err) { setState(err.message); }
    }, 800);
  };
  const id = `goals-notes-${section.key}`;
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
        <label style={labelStyle} htmlFor={id}>Your notes</label>
        <span className="no-print" aria-live="polite" style={{ fontSize: 12, color: state.startsWith('Saved') || state === 'Saving…' ? SA.muted : SEMANTIC.problem }}>{state}</span>
      </div>
      <textarea id={id} className="no-print" rows={section.rows || 3} value={value} readOnly={!editable} placeholder={editable ? section.placeholder || '' : ''} onChange={change}
        style={{ ...saSans, marginTop: 6, width: '100%', boxSizing: 'border-box', background: SA.inset, border: `1px solid ${SA.border}`, borderRadius: 10, padding: '12px 14px', color: SA.text, fontSize: 14, lineHeight: 1.5, resize: 'vertical' }} />
      {/* A textarea prints only its visible rows, so the PDF gets the full text instead. */}
      <div className="print-only" style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5 }}>{value || '—'}</div>
    </>
  );
}

function InfraList({ items, editable, onAdd, onUpdate, onDelete, onCarry }) {
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState('');
  const run = async fn => { setMsg(''); try { return await fn(); } catch (e) { setMsg(e.message); return null; } };
  return (
    <div style={{ marginTop: 14 }}>
      {!items.length && <span style={{ ...subStyle, fontSize: 13 }}>No items yet{editable ? ' — add one, or carry last week’s forward' : ''}.</span>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map(i => (
          <li key={i.id} style={{ ...rowStyle, padding: '8px 0', flexWrap: 'wrap' }}>
            {editable
              ? <select aria-label={`Status of ${i.component}`} value={i.status} onChange={e => run(() => onUpdate(i.id, { status: e.target.value }))} style={{ ...inputStyle, height: 32, width: 130, fontSize: 13 }}>
                  {Object.entries(INFRA_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              : <Chip style={{ minWidth: 92, justifyContent: 'center' }}><Dot color={INFRA_STATUS[i.status].color} />{INFRA_STATUS[i.status].label}</Chip>}
            <span>{i.component}</span>
            {i.note && <span style={{ ...subStyle, fontSize: 12 }}>{i.note}</span>}
            {editable && <button type="button" aria-label={`Remove ${i.component}`} onClick={() => run(() => onDelete(i.id))} style={{ all: 'unset', cursor: 'pointer', color: SA.muted, marginLeft: 'auto', padding: '0 6px', minHeight: 24 }}>×</button>}
          </li>
        ))}
      </ul>
      {editable && (draft
        ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <input autoFocus placeholder="Component (Enter to save)" aria-label="Component" value={draft.component} onChange={e => setDraft(d => ({ ...d, component: e.target.value }))}
              onKeyDown={async e => { if (e.key === 'Escape') setDraft(null); if (e.key === 'Enter' && draft.component.trim() && await run(() => onAdd({ component: draft.component.trim(), status: draft.status, note: draft.note.trim() || null }))) setDraft(null); }}
              style={{ ...inputStyle, flex: '1 1 200px' }} />
            <select aria-label="Status" value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value }))} style={{ ...inputStyle, width: 140 }}>
              {Object.entries(INFRA_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input placeholder="Note" aria-label="Note" value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} style={{ ...inputStyle, flex: '1 1 160px' }} />
          </div>
        : <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <Btn style={{ height: 36 }} onClick={() => setDraft({ component: '', status: 'in_progress', note: '' })}>+ Add item</Btn>
            <Btn style={{ height: 36 }} onClick={async () => { const r = await run(onCarry); if (r) setMsg(r.carried.length ? `Carried ${r.carried.length} forward` : 'Nothing to carry forward'); }}>Carry forward from last week</Btn>
          </div>)}
      {msg && <div style={{ fontSize: 12, color: SA.muted, marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

function CommitmentRow({ c, lookup, editable, onOpen, onUpdate }) {
  const owner = lookup(c.owner_user_id);
  const measured = c.metric_key && c.target_value != null;
  const p = measured && c.progress != null ? c.progress / c.target_value : null;
  const done = c.status === 'done';
  const target = c.target_value != null ? formatMetric(c.metric_key, c.target_value) : c.measurable_target;
  return (
    <div style={{ ...rowStyle, flexWrap: 'wrap' }} className="print-avoid-break">
      <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontWeight: 600, textDecoration: c.status === 'dropped' ? 'line-through' : 'none' }}>{c.text}</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {target && <Chip style={numStyle}>Target: {target}</Chip>}
          {c.link_target && <button type="button" onClick={() => onOpen(c.link_target)} style={{ all: 'unset', cursor: 'pointer' }}><Chip color={SA.link}>→ {linkLabel(c.link_target)}</Chip></button>}
          {c.carried_from_id && <Chip color={SA.warn} style={{ height: 20 }}>Carried from last week</Chip>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '0 1 300px', justifyContent: 'flex-end' }}>
        {measured ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 120 }}>
            <span style={{ ...numStyle, fontSize: 13, fontWeight: 600 }}>{c.progress == null ? '—' : formatMetric(c.metric_key, c.progress)} of {formatMetric(c.metric_key, c.target_value)}</span>
            <div style={{ width: 120, height: 4, borderRadius: 999, background: SA.track }}><div style={{ height: 4, borderRadius: 999, width: `${p == null ? 2 : Math.max(2, Math.min(100, Math.round(p * 100)))}%`, background: p == null ? SA.neutral : progressColor(p) }} /></div>
            <span style={{ fontSize: 11, color: SA.muted }}>{c.progress == null ? 'needs the database update for live progress' : 'Live from synced data'}</span>
          </div>
        ) : editable ? (
          <Btn style={{ height: 36 }} aria-pressed={done} onClick={() => onUpdate(c.id, { status: done ? 'open' : 'done' })}>
            <Dot color={done ? SEMANTIC.healthy : SA.neutral} />{done ? 'Done' : 'Open'}
          </Btn>
        ) : <Chip><Dot color={done ? SEMANTIC.healthy : SA.neutral} />{done ? 'Done' : c.status === 'dropped' ? 'Dropped' : 'Open'}</Chip>}
        <Chip><Dot color={owner.color} />{owner.first}</Chip>
      </div>
    </div>
  );
}

function AddCommitment({ members, defaultOwner, onSubmit, onCancel }) {
  const [f, setF] = useState({ text: '', measurable_target: '', owner_user_id: defaultOwner || '', link_target: '', metric_key: '', target_value: '' });
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const submit = async () => {
    if (!f.text.trim()) return;
    setBusy(true);
    try {
      await onSubmit({
        text: f.text.trim(), measurable_target: f.measurable_target.trim() || null, owner_user_id: f.owner_user_id || null,
        link_target: f.link_target || null, metric_key: f.metric_key || null,
        target_value: f.metric_key && f.target_value !== '' ? Number(f.target_value) : null,
      });
    } finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
      <input autoFocus placeholder="Commitment (Enter to save)" aria-label="Commitment" value={f.text} onChange={set('text')} disabled={busy}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }} style={{ ...inputStyle, gridColumn: '1 / -1' }} />
      <input placeholder="Measurable target (e.g. 5 partners)" aria-label="Measurable target" value={f.measurable_target} onChange={set('measurable_target')} disabled={busy} style={inputStyle} />
      <select aria-label="Owner" value={f.owner_user_id} onChange={set('owner_user_id')} disabled={busy} style={inputStyle}>
        <option value="">Unassigned</option>{members.map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
      </select>
      <select aria-label="Moves" value={f.link_target} onChange={set('link_target')} disabled={busy} style={inputStyle}>
        <option value="">Links to… (optional)</option>
        <option value="view:this_week">This week</option><option value="view:partners">Partners</option><option value="view:companies">Companies</option>
        {SECTIONS.map(s => <option key={s.key} value={`section:${s.key}`}>§{s.n} {s.title}</option>)}
      </select>
      <select aria-label="Live metric" value={f.metric_key} onChange={set('metric_key')} disabled={busy} style={inputStyle}>
        <option value="">No live metric (tick it done)</option>
        <option value="outbound_audience">Outbound audience</option><option value="total_in_sequence">Total in sequence</option>
        <option value="sequences_running">Sequences running</option><option value="meetings_set">Meetings set</option>
      </select>
      {f.metric_key && <input placeholder="Target number" aria-label="Target number" inputMode="numeric" value={f.target_value} onChange={set('target_value')} disabled={busy} style={inputStyle} />}
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn primary style={{ height: 40 }} onClick={submit} disabled={busy || !f.text.trim()}>Add</Btn>
        <Btn style={{ height: 40 }} onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

export default function ReportView(props) {
  const {
    weekStart, report, reportError, sections, infra, commitments, commitmentsError, kpiRows, kpiError, autoChips,
    canEdit, lookup, members, defaultOwner, onOpen, onSaveSection, onSectionSaved, onFinalize, onReopen,
    onAddCommitment, onUpdateCommitment, onCarryCommitments, onSaveTarget, infraHandlers,
  } = props;
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const final = report?.status === 'final';
  const loaded = !!report && !reportError;
  const editable = canEdit && loaded && !final;
  const commitEditable = canEdit && !final;
  const notesByKey = Object.fromEntries((sections || []).map(s => [s.key ?? s.section_key, s.notes]));
  const written = SECTIONS.filter(s => (notesByKey[s.key] || '').trim()).length + (commitments.length ? 1 : 0);
  const lastSaved = (sections || []).map(s => s.updated_at).filter(Boolean).sort().pop();
  const frozenKpi = final ? report.snapshot?.kpi : null;
  const run = async fn => { setMsg(''); setBusy(true); try { return await fn(); } catch (e) { setMsg(e.message); return null; } finally { setBusy(false); } };

  return (
    <div id="sales-analytics-print-area" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section style={cardStyle} aria-labelledby="h-rep">
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle}>Seif &amp; Jack weekly meeting · {weekOf(weekStart)}</span>
            <h2 style={h2Style} id="h-rep">Weekly report</h2>
            <span style={subStyle}>Live numbers fill in on their own. You write the story and the commitments. Each commitment links to the section it moves.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <Ring parts={[{ label: 'Written', count: written, color: SEMANTIC.healthy }, { label: 'To write', count: 12 - written, color: SA.neutral }]} center={`${written}/12`} caption="sections" label="Report sections written" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {loaded && (final
                ? <Chip color={SEMANTIC.healthy}><Dot color={SEMANTIC.healthy} />Final · {new Date(report.finalized_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {timeOf(report.finalized_at)} · {lookup(report.finalized_by).first}</Chip>
                : <Chip color={SA.warn}><Dot color={SEMANTIC.warning} />Draft{lastSaved ? ` · autosaved ${timeOf(lastSaved)}` : ''}</Chip>)}
              {loaded && report.reopened_at && !final && <span style={{ fontSize: 11, color: SA.muted }}>Reopened by {lookup(report.reopened_by).first} {new Date(report.reopened_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
              {canEdit && loaded && (final
                ? <Btn className="no-print" disabled={busy} onClick={() => run(onReopen)}>Reopen</Btn>
                : <Btn primary className="no-print" disabled={busy} onClick={async () => {
                    if (!window.confirm('Finalize this week? The report, commitments, to-dos and numbers freeze until someone reopens it. The PDF opens next.')) return;
                    if (await run(onFinalize)) setTimeout(() => window.print(), 300);
                  }}>Finalize &amp; send to Seif</Btn>)}
              {final && <Btn className="no-print" onClick={() => window.print()}>Open PDF</Btn>}
            </div>
          </div>
        </div>
        {reportError?.needsMigration && <div style={{ marginTop: 16 }}><NeedsMigration what="Section notes, the infrastructure list, live commitment progress and finalize" /></div>}
        {reportError && !reportError.needsMigration && <div style={{ marginTop: 16 }}><ErrorNote message={reportError.message} /></div>}
        {msg && <div style={{ marginTop: 12 }}><ErrorNote message={msg} /></div>}
      </section>

      <section style={{ ...cardStyle, borderColor: 'color-mix(in srgb, var(--sa-accent) 22%, var(--sa-border))' }} aria-labelledby="h-commit">
        <span style={labelStyle}>15 · Commitments for this week</span>
        <h2 style={{ ...h2Style, marginTop: 4 }} id="h-commit">What we committed to Seif</h2>
        <span style={subStyle}>First thing reviewed next Monday. Progress updates live wherever the app can measure it.</span>
        <div style={{ marginTop: 8 }}>
          {commitmentsError && <ErrorNote message={commitmentsError.message} />}
          {!commitmentsError && !commitments.length && <p style={{ ...subStyle, margin: '12px 0 0' }}>No commitments for this week yet{commitEditable ? ' — add your first, or carry over last week’s unfinished ones' : ''}.</p>}
          {commitments.map(c => <CommitmentRow key={c.id} c={c} lookup={lookup} editable={commitEditable} onOpen={onOpen} onUpdate={(id, body) => run(() => onUpdateCommitment(id, body))} />)}
          {commitEditable && (adding
            ? <AddCommitment members={members} defaultOwner={defaultOwner} onCancel={() => setAdding(false)} onSubmit={async body => { if (await run(() => onAddCommitment(body))) setAdding(false); }} />
            : <div className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 300px' }}><AddButton onClick={() => setAdding(true)}>+ Add commitment</AddButton></div>
                <Btn style={{ marginTop: 8 }} disabled={busy} onClick={async () => { const r = await run(onCarryCommitments); if (r) setMsg(r.carried.length ? '' : 'No unfinished commitments to carry over'); }}>Carry over unfinished</Btn>
              </div>)}
        </div>
      </section>

      {SECTIONS.map(s => {
        const notes = notesByKey[s.key] || '';
        const chips = autoChips[s.key] || [];
        const state = notes.trim() ? 'Written' : chips.length || s.list ? 'Auto only' : 'Empty';
        const stateColor = state === 'Written' ? SEMANTIC.healthy : state === 'Auto only' ? SEMANTIC.warning : SA.neutral;
        return (
          <section key={s.key} id={`goals-sec-${s.key}`} className="print-avoid-break" style={{ ...cardStyle, padding: '20px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 360px', minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ ...numStyle, minWidth: 26, height: 26, padding: '0 4px', boxSizing: 'border-box', borderRadius: 8, background: SA.track, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>{s.n}</span>
                  <h3 style={{ ...h3Style, fontSize: 16 }}>{s.title}</h3>
                  <Chip style={{ height: 20 }}><Dot color={stateColor} />{state}</Chip>
                </div>
                <span style={{ ...subStyle, fontSize: 12 }}>{s.expect}</span>
              </div>
              {s.link && <Btn className="no-print" style={{ height: 36, fontSize: 13 }} onClick={() => onOpen(s.link)}>Open {linkLabel(s.link)} →</Btn>}
            </div>
            {chips.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                {chips.map(a => (
                  <div key={a.k} style={{ background: SA.inset, border: `1px solid ${SA.border}`, borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 120 }}>
                    <span style={{ ...numStyle, fontSize: 18, fontWeight: 600 }}>{a.v}</span>
                    <span style={{ fontSize: 12, color: SA.muted }}>{a.k}</span>
                    <span style={{ alignSelf: 'flex-start', marginTop: 4 }}><SourceBadge source={a.src} /></span>
                  </div>
                ))}
              </div>
            )}
            {s.list && loaded && <InfraList items={infra || []} editable={editable} {...infraHandlers} />}
            {loaded
              ? <SectionNotes section={s} notes={notes} editable={editable} onSave={onSaveSection} onSaved={onSectionSaved} />
              : <p style={{ ...subStyle, fontSize: 12, margin: '14px 0 0' }}>Notes load once the report does.</p>}
          </section>
        );
      })}

      <KpiTable rows={frozenKpi || kpiRows} error={frozenKpi ? null : kpiError} weekStart={weekStart} editable={editable} frozen={!!frozenKpi} onSaveTarget={onSaveTarget} />
    </div>
  );
}
