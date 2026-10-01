import { useState } from 'react';
import { SA, SA_TYPE, SA_SHAPE } from './theme';
import { createCollateral, updateCollateral, deleteCollateral } from './huddleApi';

const EMPTY = { title: '', url: '', type: '', cohort_tags: '', snippet: '' };
const inputStyle = { ...SA_TYPE.body, fontSize: 13, height: 36, padding: '0 10px', background: SA.surface2, border: `1px solid ${SA.border}`, borderRadius: 8, color: SA.text, minWidth: 0 };
const smallButton = { ...SA_TYPE.body, fontSize: 12, height: 30, padding: '0 10px', background: 'transparent', border: `1px solid ${SA.border}`, borderRadius: 8, color: SA.text, cursor: 'pointer' };

async function copy(text) {
  try { await navigator.clipboard.writeText(text); } catch {}
}

export default function CollateralLibrary({ businessId, items, onChanged }) {
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = async e => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const payload = {
      title: form.title.trim(),
      url: form.url.trim(),
      type: form.type.trim() || null,
      cohort_tags: form.cohort_tags.split(',').map(s => s.trim()).filter(Boolean),
      snippet: form.snippet.trim() || null,
    };
    try {
      if (editingId) await updateCollateral(businessId, editingId, payload);
      else await createCollateral(businessId, payload);
      setForm(EMPTY);
      setEditingId(null);
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const edit = item => {
    setEditingId(item.id);
    setForm({ title: item.title, url: item.url, type: item.type || '', cohort_tags: (item.cohort_tags || []).join(', '), snippet: item.snippet || '' });
  };

  const remove = async item => {
    if (!window.confirm(`Delete "${item.title}"?`)) return;
    setError('');
    try {
      await deleteCollateral(businessId, item.id);
      await onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ padding: '20px 22px', background: SA.surface, border: `1px solid ${SA.border}`, borderRadius: SA_SHAPE.radiusCard, marginBottom: 16 }}>
      <p style={{ ...SA_TYPE.cardTitle, color: SA.text, margin: '0 0 12px' }}>Collateral library</p>

      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: SA.muted, margin: '0 0 12px' }}>Nothing here yet. Add the videos, posts and one-pagers you send.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {items.map(item => (
            <div key={item.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', background: SA.surface2, borderRadius: 8 }}>
              <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                <div style={{ fontSize: 14, color: SA.text, fontWeight: 500 }}>{item.title}</div>
                <div style={{ fontSize: 12, color: SA.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[item.type, (item.cohort_tags || []).join(', '), item.url].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button onClick={() => copy(item.url)} style={smallButton}>Copy link</button>
              {item.snippet && <button onClick={() => copy(item.snippet)} style={smallButton}>Copy snippet</button>}
              <button onClick={() => edit(item)} style={smallButton}>Edit</button>
              <button onClick={() => remove(item)} style={{ ...smallButton, color: SA.bad }}>Delete</button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
        <input required placeholder="Title" value={form.title} onChange={set('title')} style={inputStyle} />
        <input required type="url" placeholder="https://…" value={form.url} onChange={set('url')} style={inputStyle} />
        <input placeholder="Type (video, blog, PDF…)" value={form.type} onChange={set('type')} style={inputStyle} />
        <input placeholder="Cohorts, comma-separated" value={form.cohort_tags} onChange={set('cohort_tags')} style={inputStyle} />
        <textarea placeholder="Snippet to paste into an email (optional)" value={form.snippet} onChange={set('snippet')} rows={2}
          style={{ ...inputStyle, height: 'auto', padding: 8, gridColumn: '1 / -1', resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 8, gridColumn: '1 / -1', alignItems: 'center' }}>
          <button type="submit" disabled={saving} style={{ ...SA_TYPE.body, fontSize: 13, fontWeight: 600, height: 40, padding: '0 16px', background: SA.accent, color: SA.ground, border: 0, borderRadius: 8, cursor: 'pointer' }}>
            {editingId ? 'Save changes' : 'Add item'}
          </button>
          {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(EMPTY); }} style={{ ...smallButton, height: 40 }}>Cancel</button>}
          {error && <span style={{ fontSize: 12, color: SA.bad }}>{error}</span>}
        </div>
      </form>
    </div>
  );
}
