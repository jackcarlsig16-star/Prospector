import { useState } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { inputStyle, ErrorNote } from './goalsUi';

// FIX pipeline-quick-fixes-v1 A - "+ Add ▾ › Target": a company to research first, with the kind picker (employer or
// partner) and an optional website. POST goals/targets answers with the live record when one already matches.
export default function AddTargetForm({ businessId, onAdded, onCancel }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('employer');
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async e => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setError('');
    try { onAdded(await goalsApi.createTarget(businessId, { name: name.trim(), kind, ...(domain.trim() ? { domain: domain.trim() } : {}) })); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form data-add-target onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 13, color: SA.muted }}>A company to look into before it joins the pipeline.</span>
      <input autoFocus aria-label="Company name" placeholder="Company name" value={name} maxLength={160} onChange={e => setName(e.target.value)} style={inputStyle} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: SA.muted }}>Kind
        <select aria-label="Kind" value={kind} onChange={e => setKind(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
          <option value="employer">Employer</option><option value="partner">Partner</option>
        </select>
      </label>
      <input aria-label="Website" placeholder="Website (optional)" value={domain} maxLength={120} onChange={e => setDomain(e.target.value)} style={inputStyle} />
      {error && <ErrorNote message={error} />}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="ui-btn ui-btn--secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn--primary" disabled={busy || !name.trim()}>{busy ? 'Adding…' : 'Add target'}</button>
      </div>
    </form>
  );
}
