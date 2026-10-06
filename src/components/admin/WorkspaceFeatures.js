import { useState } from 'react';
import { C, mono } from '../../constants/colors';

// nav-admin-cleanup-v1 Stage 3 - platform owner switches per workspace.
// Goals & Sales here only controls the menu; its data routes are still gated
// by SALES_ANALYTICS_BUSINESS_IDS on Render (one shared Apollo key).
const FEATURES = [
  { key: 'goals_sales', label: 'Goals & Sales', note: 'Menu only. Data also needs the workspace id in SALES_ANALYTICS_BUSINESS_IDS on Render.' },
];

export default function WorkspaceFeatures({ businesses = [], onFeaturesChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const toggle = async (b, key) => {
    setBusy(`${b.id}:${key}`); setError('');
    try {
      const res = await fetch(`/api/businesses/${b.id}/features`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature: key, enabled: !b.features?.[key] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      onFeaturesChanged(b.id, data.business.features);
    } catch (e) { setError(`${b.name}: ${e.message}`); }
    setBusy(null);
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.brd}`, borderRadius: 8, padding: '16px 18px', marginBottom: 16 }}>
      <p style={{ margin: '0 0 4px', fontSize: 14, color: C.txt, fontWeight: 500 }}>Workspace features</p>
      {FEATURES.map(f => <p key={f.key} style={{ ...mono, margin: '0 0 12px', fontSize: 11, color: C.dim }}>{f.label}: {f.note}</p>)}
      {error && <p style={{ ...mono, margin: '0 0 10px', fontSize: 11, color: C.red }}>{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {businesses.map(b => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0', borderTop: `1px solid ${C.brd}` }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: b.color || C.gold }} />
            <span style={{ fontSize: 13, color: C.txt, flex: 1, minWidth: 120 }}>{b.name}</span>
            {FEATURES.map(f => (
              <label key={f.key} style={{ ...mono, fontSize: 12, color: C.mut, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', minHeight: 32 }}>
                <input type="checkbox" checked={!!b.features?.[f.key]} disabled={!!busy} onChange={() => toggle(b, f.key)} />
                {f.label}
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
