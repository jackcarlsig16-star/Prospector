import { useState, useEffect } from 'react';
import { SA } from '../theme';
import { OWNER_TEAMS, TEAM_LABEL } from '../../../constants/ownership';
import { labelStyle, inputStyle, Btn, ErrorNote } from '../goals/goalsUi';

// call-notes-targets-v1 Stage 2 - the small confirm panel under a target
// row: name, category (partner only, pre-set from the note's suggestion),
// and the ownership the target carries. Nothing is written until Promote.
const field = { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 160px' };
const input = { ...inputStyle, height: 36, fontSize: 13, width: '100%' };

export default function PromotePanel({ target, to, categories, onLoadCategories, onPromote, onCancel }) {
  const [name, setName] = useState(target.name);
  const [category, setCategory] = useState(target.suggested_category || '');
  const [ownerTeam, setOwnerTeam] = useState(target.owner_team || '');
  const [coOwner, setCoOwner] = useState(target.co_owner_name || '');
  const [noDouble, setNoDouble] = useState(!!target.no_double_touch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (to === 'partner' && !categories) onLoadCategories?.(); }, [to, categories, onLoadCategories]);
  const submit = async e => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError('');
    try {
      await onPromote({ to, name: name.trim(), ...(to === 'partner' ? { category: category.trim() || null } : {}), owner_team: ownerTeam || null, co_owner_name: coOwner.trim() || null, no_double_touch: noDouble });
    } catch (err) { setError(err.message); setBusy(false); }
  };
  const what = to === 'partner' ? 'partner' : 'employer';
  return (
    <form onSubmit={submit} aria-label={`Promote ${target.name} to ${what}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, marginTop: 8, borderRadius: 10, background: SA.inset, border: `1px solid ${SA.borderStrong}` }}>
      <span style={{ fontSize: 13, color: SA.soft }}>{to === 'partner' ? 'Lands in Partners at Not started, with the intake note on its card.' : 'Lands in the Pipeline at Target, with the evidence in its notes.'}</span>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={field}><span style={labelStyle}>Name</span><input value={name} onChange={e => setName(e.target.value)} style={input} required /></label>
        {to === 'partner' && (
          <label style={field}><span style={labelStyle}>Category</span>
            <input value={category} onChange={e => setCategory(e.target.value)} list={`promote-cat-${target.id}`} placeholder="Pick or type" style={input} />
            <datalist id={`promote-cat-${target.id}`}>{(categories || []).map(c => <option key={c} value={c} />)}</datalist>
          </label>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={field}><span style={labelStyle}>Owner team</span>
          <select value={ownerTeam} onChange={e => setOwnerTeam(e.target.value)} style={input}>
            <option value="">Unset</option>
            {OWNER_TEAMS.map(v => <option key={v} value={v}>{TEAM_LABEL[v]}</option>)}
          </select>
        </label>
        <label style={field}><span style={labelStyle}>Co-owner</span><input value={coOwner} onChange={e => setCoOwner(e.target.value)} placeholder="Their person" style={input} /></label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: SA.text, height: 36, cursor: 'pointer' }}>
          <input type="checkbox" checked={noDouble} onChange={e => setNoDouble(e.target.checked)} /> One owner (don't double-touch)
        </label>
      </div>
      {error && <ErrorNote message={error} />}
      <div style={{ display: 'flex', gap: 8 }}>
        <Btn primary type="submit" disabled={busy || !name.trim()} style={{ height: 36, fontSize: 13 }}>{busy ? 'Promoting…' : `Promote to ${what}`}</Btn>
        <Btn type="button" onClick={onCancel} disabled={busy} style={{ height: 36, fontSize: 13 }}>Cancel</Btn>
      </div>
    </form>
  );
}
