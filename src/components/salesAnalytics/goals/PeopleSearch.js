import { useState, useEffect, useCallback } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { cardStyle, labelStyle, h2Style, subStyle, inputStyle, numStyle, Chip, ErrorNote } from './goalsUi';
import { linkBtn } from '../tasks/TaskRow';

// visitor-to-record-v1 V3 - one People search over every contact Prospector holds (lead lists, partner contacts,
// Apollo sequence people), each with their company and ties. Rows carry has_email as a yes / no only; the address
// stays on the server (mailto lives inside the record windows). Viewers and Members read alike.
export const TIE_OPTIONS = [['', 'Any tie'], ['visit', 'Visited the site'], ['partner_referral', 'Partner referral'], ['campaign', 'Campaign'], ['sequence', 'Apollo sequence'], ['upside', 'Upside / joint']];
const COMPANY_TYPE = { partner: 'Partner', employer: 'Employer', target: 'Target', account: 'Apollo account' };
const md = d => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');
const TIE_COLOR = { visit: SA.warn, partner_referral: SA.accent, campaign: SA.link, sequence: SA.borderStrong, upside: SA.good, company: SA.borderStrong };

export default function PeopleSearch({ businessId, onOpenCompany }) {
  const [q, setQ] = useState('');
  const [company, setCompany] = useState('');
  const [tie, setTie] = useState('');
  const [title, setTitle] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true); setError('');
    try { setResult(await goalsApi.people(businessId, { q, company, tie, title })); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }, [businessId, q, company, tie, title]);
  useEffect(() => { const t = setTimeout(run, q || company || title || tie ? 250 : 0); return () => clearTimeout(t); }, [run, q, company, tie, title]);
  const people = result?.people || [];
  return (
    <div data-people-search style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section aria-label="People search" style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={h2Style}>People</h2>
        <span style={{ ...subStyle, fontSize: 13 }}>Everyone Prospector knows, with their company and how they came in. Names and titles only - open the company for the rest.</span>
        <form onSubmit={e => { e.preventDefault(); run(); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input type="search" aria-label="Search people" placeholder="Name or company" value={q} maxLength={120} onChange={e => setQ(e.target.value)} style={{ ...inputStyle, flex: '2 1 200px', minWidth: 0 }} />
          <input type="search" aria-label="Company" placeholder="Company" value={company} maxLength={160} onChange={e => setCompany(e.target.value)} style={{ ...inputStyle, flex: '1 1 140px', minWidth: 0 }} />
          <input type="search" aria-label="Title" placeholder="Title" value={title} maxLength={120} onChange={e => setTitle(e.target.value)} style={{ ...inputStyle, flex: '1 1 120px', minWidth: 0 }} />
          <select aria-label="Tie" value={tie} onChange={e => setTie(e.target.value)} style={{ ...inputStyle, flex: '1 1 140px' }}>
            {TIE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </form>
        <span role="status" style={{ ...subStyle, fontSize: 12, ...numStyle }}>{busy ? 'Searching…' : result ? `${result.n} of ${result.total} people${result.n >= 50 ? ' (first 50 - narrow the search)' : ''}` : ''}</span>
        {error && <ErrorNote message={error} />}
      </section>
      <section aria-label="People results" style={{ ...cardStyle, padding: 0 }}>
        {result && !people.length && <span style={{ ...subStyle, display: 'block', padding: 16 }}>Nobody matches.</span>}
        <ul style={{ listStyle: 'none', margin: 0, padding: '0 16px' }}>
          {people.map(p => (
            <li key={`${p.source_table}:${p.person_id}`} data-person-row style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderTop: `1px solid ${SA.track}`, fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: SA.text }}>{p.name}</span>
                {p.name_partial && <Chip title="Apollo hides the last name until a reveal">reveal to see full name</Chip>}
                {p.title && <span style={{ color: SA.muted }}>{p.title}</span>}
                {p.company && <Chip color={SA.accent} title={COMPANY_TYPE[p.company.type] || p.company.type}>{p.company.name}</Chip>}
                <span style={{ flex: 1 }} />
                {p.has_email && <span style={{ ...labelStyle, fontSize: 11 }}>has email</span>}
                {p.company && p.company.id && onOpenCompany && <button type="button" style={{ ...linkBtn, fontSize: 12, fontWeight: 600 }} onClick={() => onOpenCompany(p.company)}>Open company</button>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {p.ties.filter(t => t.kind !== 'company').map((t, i) => <Chip key={i} color={TIE_COLOR[t.kind]} style={{ height: 20, fontSize: 11 }}>{t.label}</Chip>)}
                {p.last_activity && <span style={{ ...subStyle, fontSize: 11, ...numStyle }}>last {md(p.last_activity)}</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
