import { useState, useEffect, useCallback } from 'react';
import { SA } from '../theme';
import { PRIORITY_COLORS } from '../palette';
import useMediaQuery from '../../../utils/useMediaQuery';
import VisitPullBar from '../tasks/VisitPullBar';
import { linkBtn } from '../tasks/TaskRow';
import { goalsApi } from './goalsApi';
import { cardStyle, labelStyle, h2Style, h3Style, subStyle, numStyle, inputStyle, Chip, Btn, ErrorNote } from './goalsUi';

// signals-v1 Stage 5 (D12) - the daily visitor report from Prospector's own
// pulls (last 7 LA days), "Export for Brad" (.xlsx, P1-P3, Upside first) and
// the skip list. sales-ia-v2: opened from Pipeline > Companies > Website
// visitors; a visitor's priority (and Not a fit) is the Priority dropdown on
// that table, so this report has no row buttons. Members and Viewers both
// read and export; only Members edit the skip list.
// Company data only - no emails, phones or people's names reach this view.
const PRIORITY_COLOR = PRIORITY_COLORS; // FIX priority-colors-v1: the same four hues as every other priority display
const PRIORITY_WORD = { P1: 'Act today', P2: 'This week', P3: 'Watch', P4: 'Noise' };
const md = d => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
const matchText = m => (m ? `${m.label}${m.upside ? ` · ${m.owner_team === 'both' ? 'joint' : 'Upside-owned'}` : ''}${m.record_id ? ` · ${m.record_id}` : ''}` : '—');
const cell = { padding: '10px 12px', borderTop: `1px solid ${SA.track}`, verticalAlign: 'top', fontSize: 13, color: SA.text };
const COLUMNS = ['Priority', 'Company', 'Type', 'Match', 'Visits (7 d)', 'Unique visitors (Apollo)', 'First / last visit', 'Top pages', 'In sequence', 'Next action'];

const PriorityChip = ({ p }) => <Chip color={PRIORITY_COLOR[p]} title={PRIORITY_WORD[p]} style={{ height: 22, fontWeight: 600 }}>{p}</Chip>;

function Stat({ label, value, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 96 }}>
      <span style={labelStyle}>{label}</span>
      <span style={{ ...numStyle, fontSize: 28, fontWeight: 600, color: color || SA.text }}>{value}</span>
    </div>
  );
}

const setNote = r => (r.override ? `Set by hand${r.skipped ? ' · on the skip list' : ''}` : r.skipped ? 'On the skip list' : null);
const RowNote = ({ r }) => (setNote(r) ? <span style={{ ...subStyle, fontSize: 12 }}>{setNote(r)}</span> : null);

function SkipList({ businessId, canEdit, onChanged }) {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(() => goalsApi.visitSkip(businessId).then(d => setRows(d.skip)).catch(e => setNote(e.message)), [businessId]);
  useEffect(() => { load(); }, [load]);
  const act = async fn => {
    setNote('');
    try { await fn(); await load(); onChanged(); } catch (e) { setNote(e.message); }
  };
  return (
    <section aria-label="Skip list" style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={h3Style}>Skip list</h3>
      <span style={{ ...subStyle, fontSize: 13 }}>Companies here count as noise (P4): HomeLover's own vendors and anything marked Not a fit. Shows in this report at once; the next pull scores them P4 too.</span>
      {canEdit && (
        <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} onSubmit={e => { e.preventDefault(); if (name.trim()) act(async () => { await goalsApi.addVisitSkip(businessId, { name: name.trim(), reason: 'Added by hand' }); setName(''); }); }}>
          <input aria-label="Company to skip" placeholder="Company name" value={name} maxLength={160} onChange={e => setName(e.target.value)} style={{ ...inputStyle, flex: '1 1 200px', minWidth: 0 }} />
          <Btn type="submit" disabled={!name.trim()}>Add</Btn>
        </form>
      )}
      {note && <ErrorNote message={note} />}
      {rows && !rows.length && <span style={subStyle}>Nothing on the skip list yet.</span>}
      {rows && rows.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map(s => (
            <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: `1px solid ${SA.track}`, fontSize: 13 }}>
              <span style={{ color: SA.text, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{s.company_key}</span>
              <span style={{ color: SA.muted }}>{s.reason || ''}</span>
              {canEdit && <button type="button" style={{ ...linkBtn, fontSize: 12 }} aria-label={`Remove ${s.company_key} from the skip list`} onClick={() => act(() => goalsApi.removeVisitSkip(businessId, s.id))}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function VisitorReport({ businessId, canEdit }) {
  const narrow = useMediaQuery('(max-width: 899px)');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showNoise, setShowNoise] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const load = useCallback(() => goalsApi.visitReport(businessId).then(d => { setReport(d); setError(''); }).catch(e => setError(e.message)), [businessId]);
  useEffect(() => { load(); }, [load]);

  const exportSheet = async () => {
    setExporting(true); setNotice('');
    try {
      const res = await fetch(goalsApi.visitExportUrl(businessId));
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Export failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'website-visitors.xlsx';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { setNotice(e.message); } finally { setExporting(false); }
  };

  if (error) return <ErrorNote message={error} />;
  if (!report) return <span style={subStyle}>Loading website visitors…</span>;
  const c = report.counts;
  const actToday = report.rows.filter(r => r.priority === 'P1');
  const rows = report.rows.filter(r => showNoise || r.priority !== 'P4');

  return (
    <div data-visitor-report style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <section aria-label="Website visitors summary" style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <h2 style={h2Style}>Website visitors</h2>
            <span style={{ ...subStyle, fontSize: 13 }}>Companies Apollo saw on homelover.ai / homelover.com, {md(report.since)} – {md(report.today)}. Prospector drafts; Jack sends.</span>
            <VisitPullBar businessId={businessId} canEdit={canEdit} onPulled={load} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} className="no-print">
            <Btn onClick={() => setSkipOpen(o => !o)} aria-expanded={skipOpen}>Skip list</Btn>
            <Btn primary disabled={exporting || !report.rows.length} onClick={exportSheet}>{exporting ? 'Exporting…' : 'Export for Brad (.xlsx)'}</Btn>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Stat label="Companies (7 d)" value={c.companies} />
          {['P1', 'P2', 'P3', 'P4'].map(p => <Stat key={p} label={`${p} · ${PRIORITY_WORD[p]}`} value={c[p]} color={PRIORITY_COLOR[p]} />)}
          <Stat label="On Brad's list" value={c.on_brads_list} />
        </div>
        <span style={{ ...subStyle, fontSize: 12 }}>Export: P1–P3, Upside-owned and joint records first. "Unique visitors (Apollo)" is Apollo's own count; its time window isn't stated.</span>
        {notice && <span role="status" style={{ fontSize: 13, color: SA.soft }}>{notice}</span>}
      </section>

      {skipOpen && <SkipList businessId={businessId} canEdit={canEdit} onChanged={load} />}

      <section aria-label="Act today" style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={h3Style}>Act today ({actToday.length})</h3>
        {!actToday.length && <span style={subStyle}>No P1 visitors in the last 7 days.</span>}
        {actToday.map(r => (
          <div key={r.company_key} style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', padding: '8px 0', borderTop: `1px solid ${SA.track}`, fontSize: 13 }}>
            <span style={{ fontWeight: 600, color: SA.text }}>{r.company_name}</span>
            <span style={{ color: SA.muted }}>{r.type} · {r.size}{r.match ? ` · ${matchText(r.match)}` : ''}</span>
            <span style={{ color: SA.soft, flex: '1 1 240px' }}>{r.priority_rule}</span>
            <span style={{ color: SA.text }}>{r.next_action}</span>
          </div>
        ))}
      </section>

      <section aria-label="Visitors, last 7 days" style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12, padding: narrow ? 16 : 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <h3 style={h3Style}>Last 7 days</h3>
          {c.P4 > 0 && <button type="button" style={linkBtn} onClick={() => setShowNoise(s => !s)}>{showNoise ? 'Hide P4 noise' : `Show P4 noise (${c.P4})`}</button>}
        </div>
        {!rows.length && <span style={subStyle}>No website visitors pulled in the last 7 days.</span>}
        {rows.length > 0 && (narrow ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map(r => (
              <li key={r.company_key} data-visit-row={r.priority} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 0', borderTop: `1px solid ${SA.track}`, fontSize: 13 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <PriorityChip p={r.priority} />
                  <span style={{ fontWeight: 600, color: SA.text, overflowWrap: 'anywhere' }}>{r.company_name}</span>
                </div>
                <span style={{ color: SA.muted }}>{r.type} · {r.size} · {matchText(r.match)}</span>
                <span style={{ color: SA.soft, ...numStyle }}>{r.visits_7d} visits (7 d) · {r.unique_visitors_apollo} unique visitors (Apollo) · {md(r.first_visit)} – {md(r.last_visit)}</span>
                {r.top_pages.length > 0 && <span style={{ color: SA.muted, overflowWrap: 'anywhere' }}>{r.top_pages.join(', ')}</span>}
                {r.sources.length > 0 && <span style={{ color: SA.muted }}>In sequence: {r.sources.join('; ')}</span>}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: SA.text }}>{r.next_action}</span>
                  <RowNote r={r} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{COLUMNS.map(h => <th key={h} scope="col" style={{ ...labelStyle, textAlign: 'left', padding: '8px 12px', whiteSpace: h.length > 14 ? 'normal' : 'nowrap' }}>{h}</th>)}<th aria-label="Actions" /></tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.company_key} data-visit-row={r.priority}>
                    <td style={cell}><PriorityChip p={r.priority} /></td>
                    <td style={cell}><div style={{ fontWeight: 600 }}>{r.company_name}</div><div style={{ color: SA.muted, fontSize: 12 }}>{r.domain || ''}</div></td>
                    <td style={cell}><div>{r.type}</div><div style={{ color: SA.muted, fontSize: 12 }}>{r.size}</div></td>
                    <td style={cell}>{matchText(r.match)}</td>
                    <td style={{ ...cell, ...numStyle }}>{r.visits_7d}</td>
                    <td style={{ ...cell, ...numStyle }}>{r.unique_visitors_apollo}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>{md(r.first_visit)} – {md(r.last_visit)}</td>
                    <td style={{ ...cell, color: SA.soft, maxWidth: 220, overflowWrap: 'anywhere' }}>{r.top_pages.join(', ') || '—'}</td>
                    <td style={{ ...cell, color: SA.soft, maxWidth: 200 }}>{r.sources.join('; ') || '—'}</td>
                    <td style={cell}><div>{r.next_action}</div>{r.priority !== 'P4' && <div style={{ color: SA.muted, fontSize: 12 }}>{r.priority_rule}</div>}</td>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}><RowNote r={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    </div>
  );
}
