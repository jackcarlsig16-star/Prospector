import { useState, useRef } from 'react';
import { SA } from '../theme';
import { cohortColor } from '../palette';
import Ring, { RingLegend } from '../charts/Ring';
import {
  cardStyle, labelStyle, h2Style, h3Style, subStyle, numStyle, inputStyle, Chip, Dot, Btn, AddButton, ErrorNote, ShowingChip,
  fmt, short, addDays, weekOf, shortWeek,
} from './goalsUi';

const TOP = 12;

function EmployeesCell({ company, canEdit, onSave }) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  if (!canEdit) return <span style={numStyle}>{fmt(company.employees)}</span>;
  if (draft === null) {
    return (
      <button type="button" onClick={() => setDraft(company.employees == null ? '' : String(company.employees))} aria-label={`Employees at ${company.name || company.account_id}`}
        style={{ all: 'unset', cursor: 'pointer', ...numStyle, color: company.employees == null ? SA.link : 'inherit' }}>
        {company.employees == null ? 'add' : fmt(company.employees)}
      </button>
    );
  }
  const save = async () => {
    const v = draft.trim() === '' ? null : Number(draft.replace(/,/g, ''));
    if (v !== null && !(Number.isInteger(v) && v >= 0)) { setError('Whole number'); return; }
    try { await onSave(company.account_id, v); setDraft(null); setError(''); } catch (e) { setError(e.message); }
  };
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <input autoFocus value={draft} inputMode="numeric" aria-label={`Employees at ${company.name || company.account_id}`}
        onChange={e => setDraft(e.target.value)} onBlur={() => setDraft(null)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setDraft(null); }}
        style={{ ...inputStyle, height: 30, width: 110, textAlign: 'right', fontSize: 13 }} />
      {error && <span style={{ fontSize: 11, color: SA.bad }}>{error}</span>}
    </span>
  );
}

// goals-surface-v1 Stage 2 - companies with no headcount, every week, each
// with a field you can type straight into (Enter or leaving the field saves,
// Tab moves to the next). Filled rows stay listed with a tick until the list
// is closed, so you can see what you just did.
function HeadcountInput({ company, onSave }) {
  const [value, setValue] = useState('');
  const [state, setState] = useState('');
  const saving = useRef(false);
  const save = async () => {
    const v = value.trim().replace(/,/g, '');
    if (!v || saving.current) return;
    const n = Number(v);
    if (!(Number.isInteger(n) && n >= 0)) { setState('Whole number'); return; }
    saving.current = true; setState('Saving…');
    try { await onSave(company.account_id, n); setState(''); } catch (e) { setState(e.message); } finally { saving.current = false; }
  };
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <input value={value} inputMode="numeric" placeholder="employees" aria-label={`Employees at ${company.name || company.account_id}`}
        onChange={e => { setValue(e.target.value); setState(''); }} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') save(); }}
        style={{ ...inputStyle, height: 32, width: 120, textAlign: 'right', fontSize: 13 }} />
      {state && <span role={state === 'Saving…' ? undefined : 'alert'} style={{ fontSize: 11, color: state === 'Saving…' ? SA.muted : SA.bad }}>{state}</span>}
    </span>
  );
}

function MissingHeadcount({ companies, filledIds, lookup, canEdit, onSave }) {
  const rows = companies.filter(c => c.employees == null || filledIds.has(c.account_id))
    .sort((a, b) => b.week_start.localeCompare(a.week_start) || (a.name || '').localeCompare(b.name || ''));
  const th = { ...labelStyle, textAlign: 'left', padding: '0 12px 10px', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: SA.surface };
  const td = { padding: '10px 12px', borderTop: `1px solid ${SA.track}` };
  if (!rows.length) return <p style={{ ...subStyle, margin: '16px 0 0' }}>Every sequenced company has a headcount.</p>;
  return (
    <div style={{ overflow: 'auto', maxHeight: 520, marginTop: 16 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
        <thead><tr>
          <th scope="col" style={{ ...th, paddingLeft: 0 }}>Week</th>
          <th scope="col" style={th}>Company</th>
          <th scope="col" style={{ ...th, textAlign: 'right' }}>Employees</th>
          <th scope="col" style={th}>Sequenced by</th>
        </tr></thead>
        <tbody>
          {rows.map(c => {
            const o = lookup(c.sequenced_by);
            const filled = c.employees != null;
            return (
              <tr key={c.account_id}>
                <td style={{ ...td, paddingLeft: 0, ...numStyle, color: SA.muted, whiteSpace: 'nowrap' }}>{shortWeek(c.week_start)}</td>
                <td style={{ ...td, fontWeight: 500 }}>{c.name || <span style={subStyle}>Unnamed account</span>}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {filled ? <span style={{ ...numStyle, color: SA.good }}>✓ {fmt(c.employees)}</span>
                    : canEdit ? <HeadcountInput company={c} onSave={onSave} /> : <span style={subStyle}>—</span>}
                </td>
                <td style={td}><Chip><Dot color={o.color} />{o.first}</Chip></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlannedCadences({ weekStart, cadences, lookup, members, owner, canEdit, onCreate, onDelete }) {
  const weeks = [weekStart, addDays(weekStart, 7), addDays(weekStart, 14)];
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ week_start: weekStart, name: '', owner_user_id: owner === 'team' ? '' : owner });
  const [error, setError] = useState('');
  const add = async () => {
    if (!draft.name.trim()) return;
    setError('');
    try { await onCreate({ week_start: draft.week_start, name: draft.name.trim(), owner_user_id: draft.owner_user_id || null }); setDraft(d => ({ ...d, name: '' })); setAdding(false); }
    catch (e) { setError(e.message); }
  };
  return (
    <section style={cardStyle} aria-labelledby="h-next">
      <span style={labelStyle}>Up next</span>
      <h2 style={{ ...h2Style, marginTop: 4 }} id="h-next">Planned cadences</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginTop: 16 }}>
        {weeks.map(w => {
          const items = cadences.filter(c => c.week_start === w);
          return (
            <div key={w} style={{ background: SA.inset, border: `1px solid ${SA.border}`, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={h3Style}>{weekOf(w)}</span>
              {!items.length && <span style={{ ...subStyle, fontSize: 12 }}>Nothing planned</span>}
              {items.map(c => {
                const o = lookup(c.owner_user_id);
                return (
                  <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Chip style={{ alignSelf: 'flex-start' }}><Dot color={o.color} />{c.name}</Chip>
                    {canEdit && <button type="button" aria-label={`Remove ${c.name}`} onClick={() => onDelete(c.id).catch(e => setError(e.message))}
                      style={{ all: 'unset', cursor: 'pointer', color: SA.muted, fontSize: 14, padding: '0 6px', minHeight: 24 }}>×</button>}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
      {canEdit && (adding
        ? <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select aria-label="Week" value={draft.week_start} onChange={e => setDraft(d => ({ ...d, week_start: e.target.value }))} style={{ ...inputStyle, width: 'auto' }}>
              {weeks.map(w => <option key={w} value={w}>{shortWeek(w)}</option>)}
            </select>
            <input autoFocus placeholder="Cadence (Enter to save)" aria-label="Cadence name" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false); }} style={{ ...inputStyle, flex: '1 1 200px' }} />
            <select aria-label="Owner" value={draft.owner_user_id} onChange={e => setDraft(d => ({ ...d, owner_user_id: e.target.value }))} style={{ ...inputStyle, width: 'auto' }}>
              <option value="">Unassigned</option>
              {members.map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </select>
            <Btn primary style={{ height: 40 }} onClick={add} disabled={!draft.name.trim()}>Add</Btn>
            <Btn style={{ height: 40 }} onClick={() => setAdding(false)}>Cancel</Btn>
          </div>
        : <AddButton onClick={() => setAdding(true)}>+ Plan a cadence</AddButton>)}
      {error && <div style={{ marginTop: 8 }}><ErrorNote message={error} /></div>}
    </section>
  );
}

const cohortOf = c => c.cohort || 'Other';

// ownerFocus: set by the rail's "companies sequenced by owner" ring - a user
// id, 'unassigned', or null.
// allCompanies: every week (for the missing-headcount list); missingOpen is
// owned by GoalsTab so the scorecard can open the list from another view.
export default function CompaniesView({ weekStart, companies, allCompanies, allError, missingOpen, onMissingOpen, cadences, lookup, members, owner, whoLabel, canEdit, error, onSaveEmployees, onCreateCadence, onDeleteCadence, ownerFocus, onOwnerFocus }) {
  const [showAll, setShowAll] = useState(false);
  const [filledIds, setFilledIds] = useState(() => new Set());
  const missingCount = (allCompanies || []).filter(c => c.employees == null).length;
  const toggleMissing = () => { onMissingOpen(!missingOpen); setFilledIds(new Set()); };
  const saveMissing = async (accountId, employees) => { await onSaveEmployees(accountId, employees); setFilledIds(ids => new Set(ids).add(accountId)); };
  const [cohort, setCohort] = useState(null);
  const rows = [...companies].sort((a, b) => (b.employees ?? -1) - (a.employees ?? -1) || (a.name || '').localeCompare(b.name || ''));
  const isMemberId = id => members.some(m => m.user_id === id);
  const byOwner = c => !ownerFocus || (ownerFocus === 'unassigned' ? !isMemberId(c.sequenced_by) : c.sequenced_by === ownerFocus);
  const filtered = rows.filter(c => byOwner(c) && (!cohort || cohortOf(c) === cohort));
  const shown = showAll ? filtered : filtered.slice(0, TOP);
  const employees = rows.reduce((n, c) => n + (c.employees || 0), 0);
  const missing = rows.filter(c => c.employees == null).length;
  const byCohort = new Map();
  for (const c of rows) if (c.employees) byCohort.set(cohortOf(c), (byCohort.get(cohortOf(c)) || 0) + c.employees);
  const parts = [...byCohort.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, count]) => ({ id: label, label, count, color: cohortColor(label) }));
  const th = { ...labelStyle, textAlign: 'right', padding: '0 12px 10px', whiteSpace: 'nowrap' };
  const td = { padding: '12px', borderTop: `1px solid ${SA.track}`, textAlign: 'right' };

  return (
    <>
      {allCompanies && (missingCount > 0 || missingOpen) && (
        <section id="goals-missing" style={{ ...cardStyle, padding: missingOpen ? 24 : '14px 20px' }} aria-label="Missing headcount">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" aria-expanded={missingOpen} onClick={toggleMissing}
              style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 14px', borderRadius: 999, fontSize: 13, fontWeight: 500,
                border: `1px solid ${missingOpen ? SA.accent : SA.warn}`, color: SA.text, background: missingOpen ? 'color-mix(in srgb, var(--sa-accent) 14%, transparent)' : 'transparent' }}>
              <Dot color={SA.warn} />Missing headcount <span style={numStyle}>({missingCount})</span><span aria-hidden="true" style={{ color: SA.muted }}>{missingOpen ? '▾' : '▸'}</span>
            </button>
            <span style={{ ...subStyle, fontSize: 13 }}>{missingOpen ? 'All weeks, newest first. Type a number and press Enter; audience totals update as you go.' : `Companies sequenced in any week with no employee count${whoLabel !== 'Team' ? ` · ${whoLabel}` : ''}. They add nothing to outbound audience until filled.`}</span>
          </div>
          {missingOpen && (allError ? <div style={{ marginTop: 12 }}><ErrorNote message={allError.message} /></div>
            : <MissingHeadcount companies={allCompanies} filledIds={filledIds} lookup={lookup} canEdit={canEdit} onSave={saveMissing} />)}
        </section>
      )}
      <section style={cardStyle} aria-labelledby="h-seq">
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle}>Sequenced in {shortWeek(weekStart).replace(' · ', ', ')} · {whoLabel}</span>
            <h2 style={h2Style} id="h-seq">{rows.length} compan{rows.length === 1 ? 'y' : 'ies'} · {short(employees)} employees reached</h2>
            <span style={subStyle}>From Apollo when a company’s first email goes out. Employee counts are typed in — Apollo has no free headcount{missing ? ` · ${missing} still need one` : ''}.</span>
          </div>
          {parts.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Ring parts={parts} center={short(employees)} caption="employees" size={104} stroke={16} track={false} label="Employees reached by cohort" onSelect={setCohort} selected={cohort} />
              <RingLegend parts={parts} showPct onSelect={setCohort} selected={cohort} />
            </div>
          )}
        </div>
        {(ownerFocus || cohort) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            {ownerFocus && <ShowingChip label={`Sequenced by ${ownerFocus === 'unassigned' ? 'Unassigned' : lookup(ownerFocus).first}`} count={rows.filter(byOwner).length} onClear={() => onOwnerFocus(null)} />}
            {cohort && <ShowingChip label={cohort} count={rows.filter(c => cohortOf(c) === cohort).length} onClear={() => setCohort(null)} />}
          </div>
        )}
        {error && <div style={{ marginTop: 12 }}><ErrorNote message={error.message} /></div>}
        {!error && !rows.length && <p style={{ ...subStyle, margin: '20px 0 0' }}>No companies entered a sequence this week{owner === 'team' ? '' : ` from ${whoLabel}’s mailbox`}. Weeks fill in on each sync.</p>}
        {filtered.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead><tr>
                <th scope="col" style={{ ...th, textAlign: 'left', paddingLeft: 0 }}>Company</th>
                <th scope="col" style={th}>Employees</th>
                <th scope="col" style={{ ...th, textAlign: 'left' }}>Cadence</th>
                <th scope="col" style={{ ...th, textAlign: 'left' }}>Sequenced by</th>
              </tr></thead>
              <tbody>
                {shown.map(c => {
                  const o = lookup(c.sequenced_by);
                  return (
                    <tr key={c.account_id}>
                      <td style={{ ...td, textAlign: 'left', paddingLeft: 0, fontWeight: 500 }}>{c.name || <span style={subStyle}>Unnamed account</span>}</td>
                      <td style={td}><EmployeesCell company={c} canEdit={canEdit} onSave={onSaveEmployees} /></td>
                      <td style={{ ...td, textAlign: 'left' }}>{c.cohort ? <Chip><Dot square color={cohortColor(c.cohort)} />{c.cohort}</Chip> : <span style={subStyle}>—</span>}</td>
                      <td style={{ ...td, textAlign: 'left' }}><Chip><Dot color={o.color} />{o.first}</Chip></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && !filtered.length && <p style={{ ...subStyle, margin: '16px 0 0' }}>No companies match this filter.</p>}
        {filtered.length > TOP && (
          <p style={{ ...subStyle, margin: '12px 0 0', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            {showAll ? `Showing all ${filtered.length}.` : `Showing the ${TOP} largest. ${filtered.length - TOP} more in the full list.`}
            <button type="button" onClick={() => setShowAll(s => !s)} style={{ all: 'unset', cursor: 'pointer', color: SA.link, minHeight: 24 }}>{showAll ? 'Show fewer' : 'Show all'}</button>
          </p>
        )}
      </section>
      <PlannedCadences weekStart={weekStart} cadences={cadences} lookup={lookup} members={members} owner={owner}
        canEdit={canEdit} onCreate={onCreateCadence} onDelete={onDeleteCadence} />
    </>
  );
}
