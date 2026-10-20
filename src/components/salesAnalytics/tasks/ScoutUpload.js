import { useState } from 'react';
import { SA, SA_SHAPE, saSans } from '../theme';
import { goalsApi } from '../goals/goalsApi';
import { ErrorNote, labelStyle, toBase64 } from '../goals/goalsUi';
import { copyBtnStyle } from '../CopyForClaude';
import { linkBtn } from './TaskRow';

// signals-v1 Stage 2 - "Upload Scout file": pick the Signal Scout workbook ->
// the server's dry run (nothing written) -> Apply proposes the new rows.
// The server refuses the whole file if any cell holds an "@" or a phone.
const actBtn = { ...copyBtnStyle, color: SA.text };
const WOULD = { propose: 'New', 'already proposed': 'Already proposed', dismissed: 'Dismissed (7 d)', 'duplicate in file': 'Repeated in file' };
const TYPE = { partner: 'partner', opportunity: 'employer', target: 'target', account: 'Apollo account' };
export const matchText = m => (m ? `${m.possible ? 'Possibly' : 'Already here'}: ${m.name} (${TYPE[m.type] || m.type}${m.archived ? ', archived' : ''})` : '');

export default function ScoutUpload({ businessId, onApplied, onClose }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async fn => { setError(''); setBusy(true); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const pick = f => f && run(async () => {
    setPreview(null);
    const next = { name: f.name, data: await toBase64(f) };
    setFile(next);
    setPreview(await goalsApi.scoutImport(businessId, next, true));
  });
  const apply = () => run(async () => {
    const r = await goalsApi.scoutImport(businessId, file, false);
    onApplied(r.added);
  });
  const fresh = preview?.counts?.propose || 0;
  return (
    <section aria-label="Upload Scout file" style={{ ...saSans, display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: SA_SHAPE.radiusInner, border: `1px solid ${SA.border}`, background: SA.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...labelStyle, color: SA.soft }}>Upload Scout file</span>
        <span style={{ flex: 1 }} />
        <button type="button" style={{ ...linkBtn, color: SA.muted, fontSize: 12 }} onClick={onClose}>Cancel</button>
      </div>
      <input type="file" accept=".xlsx,.csv" aria-label="Signal Scout file" disabled={busy} onChange={e => pick(e.target.files?.[0])} style={{ fontSize: 12, color: SA.soft, maxWidth: '100%' }} />
      {busy && <span style={{ fontSize: 12, color: SA.muted }}>Reading…</span>}
      {error && <ErrorNote message={error} />}
      {preview && (
        <>
          <span style={{ fontSize: 12, color: SA.muted }}>
            {preview.rows.length} row{preview.rows.length === 1 ? '' : 's'} on the Hit List (header on row {preview.header_row}) · {fresh} new
            {preview.also_watch ? ` · ${preview.also_watch} not imported (Also Watch)` : ''}
          </span>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 260, overflowY: 'auto' }}>
            {preview.rows.map(r => (
              <li key={r.row} style={{ borderTop: `1px solid ${SA.track}`, padding: '6px 0', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ color: r.would === 'propose' ? SA.text : SA.muted, fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {r.company} <span style={{ fontWeight: 400 }}>· {r.kind}{r.kind_guessed ? ' (kind guessed)' : ''} · {WOULD[r.would] || r.would}</span>
                </span>
                {r.who && <span style={{ color: SA.soft, overflowWrap: 'anywhere' }}>{r.who}</span>}
                {r.match && <span style={{ color: SA.muted }}>{matchText(r.match)}</span>}
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" style={actBtn} disabled={busy || !fresh} onClick={apply}>{fresh ? `Apply · add ${fresh}` : 'Nothing new to add'}</button>
          </div>
        </>
      )}
    </section>
  );
}
