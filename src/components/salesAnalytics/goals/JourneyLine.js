import { useState } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { ErrorNote } from './goalsUi';
import FilterSelect from '../../../ui/FilterSelect';

// brad-attribution-v1 F5 / F6 - the company window's Journey line under Source: "Referred by Brad (Upside) Oct 22 →
// Visited Oct 24 → Replied — …", a reached stage in the text color (its title says what dated it), a missing one greyed
// (its title says what sets it). "Mark stage" (Members; F3) dates a stage Prospector never saw - one mark per stage, a
// second replaces it, Undo for 8 s; it never moves the record's stage. Upside-owned + no double touch = read-only (F7).
const STAGES = [['referred', 'Referred'], ['visited', 'Visited'], ['replied', 'Replied'], ['meeting', 'Meeting'], ['pilot', 'Pilot'], ['lost', 'Lost']];
const HOW = {
  referred: 'Set when the source is a partner or person referral',
  visited: 'Set when a website visit is matched to this company',
  replied: 'Set when a contact replies (not a "wrong person" reply) or the status moves to Replied',
  meeting: 'Set when the stage moves to Meeting, or a meeting touch or to-do is logged',
  pilot: 'Set when the stage moves to Pilot / live',
};
const md = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const laToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const field = { height: 32, fontSize: 13, padding: '0 8px', colorScheme: 'dark' };

export function referredByText(source) {
  if (!source || !['partner_referral', 'person_referral'].includes(source.source_kind)) return null;
  return source.source_person ? `${source.source_person}${source.partner_name ? ` (${source.partner_name})` : ''}` : source.partner_name || null;
}

export default function JourneyLine({ businessId, row, journey, source, canEdit, onMarked, onToast }) {
  const [form, setForm] = useState(null); // { stage, at, note }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!journey) return null;
  const f = journey.funnel;
  const by = referredByText(source);
  const canMark = canEdit && !journey.locked;
  const shown = STAGES.filter(([s]) => s !== 'lost' || f.lost);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const r = await goalsApi.markStage(businessId, row.type, row.id, form);
      const label = STAGES.find(([s]) => s === form.stage)[1];
      const stage = form.stage;
      setForm(null);
      onMarked();
      onToast({
        text: `${row.name}: ${label} marked ${md(form.at)}`,
        undo: async () => {
          if (r.previous) await goalsApi.markStage(businessId, row.type, row.id, r.previous);
          else await goalsApi.unmarkStage(businessId, row.type, row.id, stage);
          onMarked();
        },
      });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const unmark = async m => {
    setBusy(true); setError('');
    try {
      await goalsApi.unmarkStage(businessId, row.type, row.id, m.stage);
      onMarked();
      onToast({ text: `${row.name}: ${STAGES.find(([s]) => s === m.stage)[1]} mark removed`, undo: async () => { await goalsApi.markStage(businessId, row.type, row.id, { stage: m.stage, at: m.at, note: m.note }); onMarked(); } });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div role="group" aria-label="Journey" data-journey style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="ui-group-label">Journey</span>
        <span data-journey-line style={{ fontSize: 13, display: 'inline-flex', flexWrap: 'wrap', gap: '2px 6px', alignItems: 'baseline' }}>
          {shown.map(([s, label], i) => (
            <span key={s} data-journey-stage={s} data-reached={f[s] ? 'true' : 'false'} title={f[s] ? `${md(f[s])} · ${f.src?.[s] || ''}` : `${HOW[s]}${canMark ? ' - or Mark stage' : ''}`}
              style={{ color: f[s] ? SA.text : SA.muted, whiteSpace: 'nowrap' }}>
              {i > 0 && <span aria-hidden="true" style={{ color: SA.muted }}>{' → '}</span>}
              {s === 'referred' && by ? `Referred by ${by}` : label} {f[s] ? md(f[s]) : '—'}
            </span>
          ))}
        </span>
        {canMark && !form && <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm" onClick={() => setForm({ stage: 'meeting', at: laToday(), note: '' })}>Mark stage</button>}
        {journey.locked && <span style={{ fontSize: 12, color: SA.muted }}>Upside-owned, no double touch · read-only</span>}
      </div>
      {journey.marks.length > 0 && (
        <div data-journey-marks style={{ display: 'flex', gap: '4px 12px', flexWrap: 'wrap', fontSize: 12, color: SA.muted }}>
          {journey.marks.map(m => (
            <span key={m.stage} data-mark={m.stage} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {STAGES.find(([s]) => s === m.stage)[1]} marked {md(m.at)}{m.by ? ` by ${m.by}` : ''}{m.note ? ` · ${m.note}` : ''}
              {canMark && <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm" disabled={busy} aria-label={`Remove the ${m.stage} mark`} onClick={() => unmark(m)}>✕</button>}
            </span>
          ))}
        </div>
      )}
      {form && (
        <div role="group" aria-label="Mark stage" data-mark-form style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 10px', border: `1px solid ${SA.border}`, borderRadius: 10, background: SA.surface2 }}>
          <FilterSelect label="Stage" value={form.stage} disabled={busy} options={STAGES.map(([value, label]) => ({ value, label }))} onChange={v => setForm(x => ({ ...x, stage: v }))} />
          <input type="date" aria-label="Date it happened" max={laToday()} value={form.at} disabled={busy} onChange={e => setForm(x => ({ ...x, at: e.target.value }))} className="ui-input" style={field} />
          <input aria-label="Note" placeholder="What happened (optional)" maxLength={200} value={form.note} disabled={busy} onChange={e => setForm(x => ({ ...x, note: e.target.value }))} className="ui-input" style={{ ...field, flex: '1 1 200px', minWidth: 0 }} />
          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={busy || !form.at} onClick={save}>{busy ? 'Saving…' : 'Save mark'}</button>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={busy} onClick={() => { setForm(null); setError(''); }}>Cancel</button>
          <span style={{ fontSize: 12, color: SA.muted, flexBasis: '100%' }}>Dates the stage in the funnel only - the record's stage doesn't move. No emails or phone numbers in the note.</span>
        </div>
      )}
      {error && <ErrorNote message={error} />}
    </div>
  );
}
