import { useState, useEffect, useRef } from 'react';
import { SA, SA_TYPE, SA_THEME_CSS, SA_THEME_CLASS, saSans } from '../theme';
import { goalsApi } from './goalsApi';
import { ErrorNote, labelStyle, numStyle } from './goalsUi';
import Button from '../../../ui/Button';

// pipeline-board-v1 Stage 4 - "Update from sheet": pick the joint sheet
// (.csv / .xlsx) -> the server's preview (nothing written) -> tick -> Apply.
// Apply sends the same file back with the ticked keys; the server re-plans and
// refuses any item that changed since this preview. Same drawer shell as
// PlanWeekDrawer.
const WIDTH = 560;
const GROUPS = [['stage', 'Stage changes'], ['fill', 'Field fills (empty → value)'], ['new', 'New rows']];
const TYPE_LABEL = { partner: 'Partner', employer: 'Employer', target: 'Target' };
const linkBtn = { all: 'unset', cursor: 'pointer', color: SA.link, fontSize: 13 };

const toBase64 = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error("Couldn't read that file"));
  r.readAsDataURL(file);
});

export default function SheetUpdateDrawer({ businessId, onClose, onApplied }) {
  const [file, setFile] = useState(null); // { name, data }
  const [preview, setPreview] = useState(null);
  const [ticked, setTicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const pick = async f => {
    if (!f) return;
    setBusy(true); setError(''); setPreview(null); setResult(null);
    try {
      const next = { name: f.name, data: await toBase64(f) };
      const p = await goalsApi.sheetUpdatePreview(businessId, next);
      setFile(next);
      setPreview(p);
      setTicked(new Set(p.items.filter(i => i.tickable).map(i => i.key)));
    } catch (e) { setError(e.message); } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const apply = async () => {
    setBusy(true); setError('');
    try {
      const chosen = preview.items.filter(i => ticked.has(i.key)).map(i => ({ key: i.key, sig: i.sig }));
      const r = await goalsApi.sheetUpdateApply(businessId, file, chosen);
      setResult(r);
      setPreview(null);
      onApplied(r);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const toggle = key => setTicked(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const tickable = preview ? preview.items.filter(i => i.tickable) : [];
  const count = tickable.filter(i => ticked.has(i.key)).length;

  return (
    <>
      <style>{SA_THEME_CSS}</style>
      <div onClick={() => !busy && onClose()} className="no-print" style={{ position: 'fixed', inset: 0, background: '#0006', zIndex: 4003 }} />
      <aside className={`${SA_THEME_CLASS} no-print`} role="dialog" aria-modal="true" aria-labelledby="sheet-update-title"
        style={{ ...saSans, position: 'fixed', top: 0, right: 0, bottom: 0, width: WIDTH, maxWidth: '100vw', boxSizing: 'border-box', zIndex: 4004, background: SA.ground, color: SA.text, borderLeft: `1px solid ${SA.border}`, display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 32px rgba(0,0,0,0.35)' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 12px 16px', borderBottom: `1px solid ${SA.border}` }}>
          <h2 id="sheet-update-title" style={{ ...SA_TYPE.cardTitle, fontSize: 17, margin: 0, color: SA.text, flex: 1 }}>Update from sheet</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close update from sheet"
            style={{ all: 'unset', cursor: 'pointer', width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: SA.muted }}>×</button>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: SA.muted }}>
            Upload the joint sheet (.csv or .xlsx, up to 2 MB / 2,000 rows). Stages are read from the <b>Stage</b> column (or the master sheet's <b>Funnel Stage</b>) — never from Status or cell colors. Nothing changes until you Apply.
          </p>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input ref={inputRef} type="file" accept=".csv,.xlsx" aria-label="Sheet file" disabled={busy} onChange={e => pick(e.target.files?.[0])} />
          </label>
          {busy && <p role="status" style={{ margin: 0, fontSize: 13, color: SA.muted }}>{preview ? 'Applying…' : 'Reading the sheet…'}</p>}
          {error && <ErrorNote message={error} />}
          {result && <ResultNote result={result} />}
          {preview && <Preview preview={preview} ticked={ticked} toggle={toggle} />}
        </div>
        <footer style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: `1px solid ${SA.border}`, flexWrap: 'wrap' }}>
          {preview && tickable.length > 0 && <>
            <button type="button" style={linkBtn} onClick={() => setTicked(new Set(tickable.map(i => i.key)))}>Tick all</button>
            <button type="button" style={linkBtn} onClick={() => setTicked(new Set())}>Untick all</button>
          </>}
          <div style={{ flex: 1 }} />
          <Button onClick={onClose} disabled={busy}>{result ? 'Done' : 'Cancel'}</Button>
          {preview && tickable.length > 0 && <Button variant="primary" onClick={apply} disabled={busy || !count}>Apply {count}</Button>}
        </footer>
      </aside>
    </>
  );
}

function ResultNote({ result }) {
  return (
    <div role="status" style={{ fontSize: 14 }}>
      <p style={{ margin: 0, color: SA.good }}>Updated {result.applied}.</p>
      {result.failed.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: SA.warn, fontSize: 13 }}>
          {result.failed.map(f => <li key={f.key}>{f.name}: {f.error}</li>)}
        </ul>
      )}
    </div>
  );
}

function Preview({ preview, ticked, toggle }) {
  const { items, info, rows } = preview;
  const nothing = !items.some(i => i.tickable);
  return (
    <>
      <span style={labelStyle}><span style={numStyle}>{rows}</span> rows read</span>
      {nothing && <p style={{ margin: 0, fontSize: 14 }}>Nothing to update — Prospector already matches this sheet.</p>}
      {GROUPS.map(([g, title]) => {
        const list = items.filter(i => i.group === g);
        if (!list.length) return null;
        return (
          <section key={g} aria-label={title}>
            <h3 style={{ ...SA_TYPE.cardTitle, fontSize: 14, margin: '4px 0 6px' }}>{title} <span style={{ ...numStyle, color: SA.muted, fontWeight: 400 }}>{list.length}</span></h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {list.map(i => <ItemRow key={i.key} i={i} on={ticked.has(i.key)} toggle={toggle} />)}
            </ul>
          </section>
        );
      })}
      <Info title="Differences — Prospector kept" rows={info.differences.map(d => `${d.name}: ${d.field} — Prospector "${d.prospector}", sheet "${d.sheet}"`)} />
      <Info title="Not matched / skipped" rows={info.skipped.map(s => `${s.name}${s.record_id ? ` (${s.record_id})` : ''}: ${s.reason}`)} />
      <Info title="Invalid rows" rows={info.invalid.map(s => `${s.name || '—'}${s.record_id ? ` (${s.record_id})` : ''}: ${s.reason}`)} />
      <Info title="Stage not used — it isn't a stage of that row's type" rows={info.stage_mismatches.map(s => `${s.name}: "${s.sheet}" isn't a ${s.type} stage`)} />
      <Info title="Sheet type differs — kept as the partner" rows={info.kind_mismatches.map(s => `${s.name}: sheet ${s.sheet_kind}, Prospector ${s.prospector}`)} />
      <Info title="Primary Contact names 2+ people — not imported" rows={info.multi_person.map(s => s.name)} />
      <Info title="Ignored columns" rows={info.ignored.length ? [info.ignored.join(', ')] : []} />
    </>
  );
}

function ItemRow({ i, on, toggle }) {
  const what = i.group === 'stage' ? `${i.from_label} → ${i.to_label}`
    : i.group === 'new' ? [`New ${TYPE_LABEL[i.type].toLowerCase()}`, i.to_label, ...i.changes.map(c => `${c.label}: ${c.value}`)].filter(Boolean).join(' · ')
      : i.changes.map(c => `${c.label}: ${c.value}`).join(' · ');
  return (
    <li style={{ borderTop: `1px solid ${SA.track}`, opacity: i.tickable ? 1 : 0.55 }}>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', cursor: i.tickable ? 'pointer' : 'default', fontSize: 14 }}>
        <input type="checkbox" checked={i.tickable && on} disabled={!i.tickable} onChange={() => toggle(i.key)} aria-label={`${i.name}: ${what}`} style={{ marginTop: 3 }} />
        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <b>{i.name}</b> <span style={{ fontSize: 11, color: SA.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{TYPE_LABEL[i.type]}</span>
          <br /><span style={{ color: SA.muted, fontSize: 13 }}>{what}{i.note ? ` — ${i.note}` : ''}</span>
        </span>
      </label>
    </li>
  );
}

function Info({ title, rows }) {
  if (!rows.length) return null;
  return (
    <details>
      <summary style={{ cursor: 'pointer', fontSize: 13, color: SA.muted }}>{title} ({rows.length})</summary>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13, color: SA.muted }}>
        {rows.map((r, n) => <li key={n} style={{ overflowWrap: 'anywhere' }}>{r}</li>)}
      </ul>
    </details>
  );
}
