import { useState, useEffect, useMemo } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { inputStyle, numStyle, ErrorNote } from './goalsUi';
import { normName } from '../../../utils/normAccount';

// FIX pipeline-quick-fixes-v1 A - "+ Add ▾ › Person": name, title, company (a typeahead over the partners, employers
// and targets on the board plus the parked company names People search knows; or "New company" -> a parked person),
// optional LinkedIn URL. NO email or phone field, by rule. Files through POST goals/people.
const MAX_SUGGESTIONS = 8;
const TYPE_LABEL = { partner: 'Partner', employer: 'Employer', target: 'Target', parked: 'No record yet' };

export default function AddPersonForm({ businessId, companies = [], onAdded, onCancel }) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null); // { type, id, name }
  const [parked, setParked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (query.trim().length < 2 || picked) { setParked([]); return undefined; }
    let live = true;
    const t = setTimeout(() => goalsApi.people(businessId, { q: query.trim() }).then(r => { if (live) setParked([...new Map((r.people || []).filter(p => p.no_record && p.company?.name).map(p => [normName(p.company.name), p.company.name])).values()]); }).catch(() => {}), 250);
    return () => { live = false; clearTimeout(t); };
  }, [businessId, query, picked]);
  const suggestions = useMemo(() => {
    const q = normName(query);
    if (!q || picked) return [];
    const hits = companies.filter(c => normName(c.name).includes(q)).slice(0, MAX_SUGGESTIONS).map(c => ({ type: c.type, id: c.id, name: c.name }));
    const names = new Set(hits.map(h => normName(h.name)));
    for (const n of parked) if (!names.has(normName(n)) && hits.length < MAX_SUGGESTIONS) { hits.push({ type: 'parked', id: null, name: n }); names.add(normName(n)); }
    return hits;
  }, [companies, parked, query, picked]);
  const typed = query.trim();
  const exact = suggestions.find(s => normName(s.name) === normName(typed));
  const company = picked || exact || (typed ? { type: 'new', id: null, name: typed } : null);
  const submit = async e => {
    e.preventDefault();
    if (!name.trim() || !company || busy) return;
    setBusy(true); setError('');
    try {
      const body = { name: name.trim(), ...(title.trim() ? { title: title.trim() } : {}), ...(linkedin.trim() ? { linkedin_url: linkedin.trim() } : {}),
        company: company.id ? { type: company.type, id: company.id } : { name: company.name } };
      const r = await goalsApi.addPerson(businessId, body);
      onAdded(r);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form data-add-person onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 13, color: SA.muted }}>Name, title and company. No email or phone here - those stay out of Prospector by rule.</span>
      <input autoFocus aria-label="Name" placeholder="Full name" value={name} maxLength={120} onChange={e => setName(e.target.value)} style={inputStyle} />
      <input aria-label="Title" placeholder="Title (optional)" value={title} maxLength={160} onChange={e => setTitle(e.target.value)} style={inputStyle} />
      <div style={{ position: 'relative' }}>
        <input aria-label="Company" placeholder="Company - start typing" value={picked ? picked.name : query} maxLength={160} autoComplete="off" aria-autocomplete="list" aria-expanded={suggestions.length > 0}
          onChange={e => { setPicked(null); setQuery(e.target.value); }} onKeyDown={e => { if (e.key === 'Escape' && picked) { setPicked(null); setQuery(''); } }} style={inputStyle} />
        {suggestions.length > 0 && (
          <ul role="listbox" aria-label="Company suggestions" style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 5, margin: 0, padding: 4, listStyle: 'none', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: 8, maxHeight: 220, overflowY: 'auto' }}>
            {suggestions.map(s => (
              <li key={`${s.type}-${s.id || s.name}`} role="option" aria-selected={false}>
                <button type="button" className="ui-btn ui-btn--tertiary ui-btn--sm" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => { setPicked(s); setQuery(s.name); }}>
                  <span>{s.name}</span><span style={{ fontSize: 11, color: SA.muted }}>{TYPE_LABEL[s.type]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {company && <span data-company-choice style={{ fontSize: 12, color: SA.muted, ...numStyle }}>{company.type === 'new' ? `New company "${company.name}" - filed as a person with no record yet (Add the record later from People search)` : `${TYPE_LABEL[company.type]}: ${company.name}`}</span>}
      <input aria-label="LinkedIn URL" placeholder="linkedin.com/in/name (optional)" value={linkedin} maxLength={300} onChange={e => setLinkedin(e.target.value)} style={inputStyle} />
      {error && <ErrorNote message={error} />}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="ui-btn ui-btn--secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn--primary" disabled={busy || !name.trim() || !company}>{busy ? 'Adding…' : 'Add person'}</button>
      </div>
    </form>
  );
}
