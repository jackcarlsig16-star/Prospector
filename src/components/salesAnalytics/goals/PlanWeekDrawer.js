import { useState, useEffect } from 'react';
import { SA, SA_TYPE, SA_SHAPE, SA_THEME_CSS, SA_THEME_CLASS, saSans } from '../theme';
import { goalsApi } from './goalsApi';
import { Chip, ErrorNote, labelStyle, inputStyle, weekOf } from './goalsUi';
import Button from '../../../ui/Button';

// weekly-plan-v1 Stage 2 - "Plan this week": prompt -> ranked proposals ->
// the ticked ones saved as this week's commitments (Focus 5) + to-dos.
// Same fixed-drawer shell as tasks/TaskDrawer.
export const FOCUS_CAP = 5;
const WIDTH = 520;

const linkBtn = { all: 'unset', cursor: 'pointer', color: SA.link, fontSize: 13 };
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function countChips(s) {
  if (!s) return [];
  return [
    `${s.todos ?? 0} to-dos`, `${s.replies_waiting ?? 0} replies waiting`, `${s.partners ?? 0} partners`, `${s.flags ?? 0} flags`,
    s.last_week_total ? `last week ${s.last_week_done}/${s.last_week_total}` : null,
  ].filter(Boolean);
}

function ProposalRow({ p, i, n, readOnly, onTick, onKind, onMove }) {
  return (
    <li style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: `1px solid ${SA.track}` }}>
      {!readOnly && <input type="checkbox" checked={p.ticked} onChange={onTick} aria-label={`Keep ${p.text}`} style={{ width: 18, height: 18, marginTop: 2, accentColor: 'var(--sa-accent)', flex: 'none' }} />}
      <span style={{ ...labelStyle, width: 18, flex: 'none', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{p.rank}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>{p.text}</span>
        {p.reason && <span style={{ fontSize: 13, color: SA.muted }}>{p.reason}</span>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {readOnly ? <Chip>{p.kind}</Chip> : (
            <button type="button" onClick={onKind} title="Switch commitment / to-do" style={{ all: 'unset', cursor: 'pointer' }}>
              <Chip color={p.kind === 'commitment' ? SA.accent : SA.soft}>{p.kind}</Chip>
            </button>
          )}
          {p.link_name && <Chip color={SA.link}>→ {p.link_name}</Chip>}
          {p.existing_todo_id && <Chip color={SA.warn} title={p.existing_text || undefined}>already on your list</Chip>}
          {p.kind === 'todo' && p.due_date && <Chip>due {md(p.due_date)}</Chip>}
        </div>
      </div>
      {!readOnly && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 'none' }}>
          <button type="button" aria-label={`Move ${p.text} up`} disabled={i === 0} onClick={() => onMove(-1)} style={{ all: 'unset', cursor: i === 0 ? 'default' : 'pointer', width: 32, height: 22, textAlign: 'center', color: i === 0 ? SA.faint : SA.muted }}>▲</button>
          <button type="button" aria-label={`Move ${p.text} down`} disabled={i === n - 1} onClick={() => onMove(1)} style={{ all: 'unset', cursor: i === n - 1 ? 'default' : 'pointer', width: 32, height: 22, textAlign: 'center', color: i === n - 1 ? SA.faint : SA.muted }}>▼</button>
        </div>
      )}
    </li>
  );
}

// ownerId: the person planned for; teamDefault: Goals shows Team, so this
// falls back to the signed-in user. hasPlanned: open planned commitments exist.
export default function PlanWeekDrawer({ businessId, weekStart, ownerId, ownerName, teamDefault, hasPlanned, compact, onClose, onSaved }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // propose reply
  const [rows, setRows] = useState([]);
  const [replace, setReplace] = useState(false);
  const [history, setHistory] = useState(null); // null = closed, [] = list
  const [viewing, setViewing] = useState(null); // a past plan, read-only

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  const commitCount = ranked.filter(r => r.ticked && r.kind === 'commitment').length;
  const ticked = ranked.filter(r => r.ticked);

  const propose = async () => {
    setBusy(true); setError('');
    try {
      const r = await goalsApi.proposePlan(businessId, { week_start: weekStart, owner_user_id: ownerId, prompt });
      setResult(r);
      setRows(r.proposals.map((p, i) => ({ ...p, ticked: i < FOCUS_CAP })));
    } catch (e) {
      setError(e.status === 429 ? 'Daily plan limit reached — tomorrow' : e.message);
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setError('');
    try {
      // Proposals are saved in the order shown, so plan_rank = proposal rank.
      const proposals = ranked.map(({ ticked: _t, ...p }) => p);
      const chosen = ticked.map(r => ({ rank: r.rank, text: r.text, reason: r.reason, as: r.kind, link_type: r.link_type, link_id: r.link_id, due_date: r.due_date, existing_todo_id: r.existing_todo_id }));
      const saved = await goalsApi.savePlan(businessId, { week_start: weekStart, owner_user_id: ownerId, prompt, inputs: result.inputs, proposals, chosen, replace_open_planned: hasPlanned && replace });
      onSaved(saved);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const openHistory = () => { setHistory([]); goalsApi.weekPlans(businessId, ownerId).then(setHistory).catch(e => { setHistory(null); setError(e.message); }); };
  const move = (i, d) => setRows(rs => { const next = rs.slice(); [next[i], next[i + d]] = [next[i + d], next[i]]; return next; });
  const patchRow = (i, patch) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const body = viewing ? (
    <>
      <button type="button" style={linkBtn} onClick={() => setViewing(null)}>← Previous plans</button>
      <span style={{ ...labelStyle, marginTop: 12 }}>{weekOf(viewing.week_start)} · {viewing.chosen_count} chosen</span>
      <p style={{ fontSize: 14, whiteSpace: 'pre-wrap', margin: '6px 0 8px' }}>{viewing.prompt}</p>
      <Button onClick={() => { setPrompt(viewing.prompt); setViewing(null); setHistory(null); }}>Re-use prompt</Button>
      <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
        {(viewing.proposals || []).map((p, i) => <ProposalRow key={i} p={p} i={i} n={viewing.proposals.length} readOnly />)}
      </ul>
    </>
  ) : history ? (
    <>
      <button type="button" style={linkBtn} onClick={() => setHistory(null)}>← Back to this week</button>
      <span style={{ ...labelStyle, marginTop: 12 }}>Previous plans</span>
      {!history.length && <p style={{ fontSize: 13, color: SA.muted }}>No plans yet.</p>}
      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
        {history.map(h => (
          <li key={h.id} style={{ borderTop: `1px solid ${SA.track}` }}>
            <button type="button" onClick={() => setViewing(h)} style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 10, width: '100%', padding: '10px 0', fontSize: 13 }}>
              <span style={{ color: SA.muted, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{md(h.created_at.slice(0, 10))}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.prompt.split('\n')[0] || '(no prompt)'}</span>
              <span style={{ color: SA.muted, flex: 'none' }}>{h.chosen_count} chosen</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  ) : (
    <>
      <span style={{ fontSize: 13, color: SA.muted }}>
        Planning for {ownerName} · {weekOf(weekStart).replace('Week', 'week')}{teamDefault ? ' (Show is Team, so this plans your week)' : ''}
      </span>
      <label htmlFor="plan-week-prompt" style={{ ...labelStyle, marginTop: 14 }}>What needs to happen this week?</label>
      <textarea id="plan-week-prompt" value={prompt} onChange={e => setPrompt(e.target.value)} disabled={busy} maxLength={4000} rows={5}
        placeholder="Upside intros, Solidcore December call, 100 cold, pause Cyrus's Marriott sequence…"
        style={{ ...inputStyle, height: 'auto', minHeight: 112, flex: 'none', padding: '10px 12px', marginTop: 6, resize: 'vertical', lineHeight: 1.45 }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <Button variant={result ? 'secondary' : 'primary'} onClick={propose} disabled={busy || !prompt.trim()}>{busy && !result ? 'Planning…' : result ? 'Propose again' : 'Propose'}</Button>
        {countChips(result?.inputs_summary).map(c => <Chip key={c}>{c}</Chip>)}
      </div>
      {error && <div style={{ marginTop: 10 }}><ErrorNote message={error} /></div>}
      {result && (
        <>
          <ul aria-label="Proposals" style={{ listStyle: 'none', margin: '14px 0 0', padding: 0 }}>
            {ranked.map((p, i) => (
              <ProposalRow key={p.text} p={p} i={i} n={ranked.length} onTick={() => patchRow(i, { ticked: !p.ticked })}
                onKind={() => patchRow(i, { kind: p.kind === 'commitment' ? 'todo' : 'commitment' })} onMove={d => move(i, d)} />
            ))}
          </ul>
          {hasPlanned && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--sa-accent)' }} />
              Replace this week's planned commitments
            </label>
          )}
        </>
      )}
    </>
  );

  return (
    <>
      <style>{SA_THEME_CSS}</style>
      {compact && <div onClick={() => !busy && onClose()} className="no-print" style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 4003 }} />}
      <aside className={`${SA_THEME_CLASS} no-print`} role="dialog" aria-modal="true" aria-labelledby="plan-week-title"
        style={{ ...saSans, position: 'fixed', top: 0, right: 0, bottom: 0, width: compact ? '100vw' : WIDTH, maxWidth: '100vw', boxSizing: 'border-box', zIndex: 4004, background: SA.ground, color: SA.text, borderLeft: `1px solid ${SA.border}`, display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 32px rgba(0,0,0,0.35)' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 12px 16px', borderBottom: `1px solid ${SA.border}` }}>
          <h2 id="plan-week-title" style={{ ...SA_TYPE.cardTitle, fontSize: 17, margin: 0, color: SA.text, flex: 1 }}>Plan this week</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close plan"
            style={{ all: 'unset', cursor: 'pointer', width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: SA.muted }}>×</button>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column' }}>{body}</div>
        <footer style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: `1px solid ${SA.border}`, flexWrap: 'wrap' }}>
          {!history && !viewing && <button type="button" style={linkBtn} onClick={openHistory}>Previous plans</button>}
          <div style={{ flex: 1 }} />
          {result && !history && !viewing && <>
            <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: commitCount > FOCUS_CAP ? SA.bad : SA.muted }}>{commitCount} of {FOCUS_CAP}</span>
            <Button variant="primary" onClick={save} disabled={busy || !ticked.length || commitCount > FOCUS_CAP}>{busy ? 'Saving…' : 'Save'}</Button>
          </>}
        </footer>
        {commitCount > FOCUS_CAP && !history && !viewing && (
          <div role="alert" style={{ margin: '0 16px 12px', fontSize: 13, color: SA.bad, borderRadius: SA_SHAPE.radiusInner }}>At most {FOCUS_CAP} commitments a week — untick one or make it a to-do.</div>
        )}
      </aside>
    </>
  );
}
