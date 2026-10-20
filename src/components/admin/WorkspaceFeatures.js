import { useState } from 'react';
import { ui } from '../../ui/kitTheme';
import { KIT_SPACE, KIT_TYPE } from '../../ui/tokens';
import Card from '../../ui/Card';
import ToggleRow from '../../ui/ToggleRow';

// nav-admin-cleanup-v1 Stage 3 - platform owner switches per workspace.
// Sales & Marketing here only controls the menu; its data routes are still gated
// by SALES_ANALYTICS_BUSINESS_IDS on Render (one shared Apollo key).
// The three Outlook keys (microsoft-connect-v1 Stage 4) each gate one
// read-only use of a member's connected mailbox; off by default.
const FEATURES = [
  { key: 'goals_sales', label: 'Sales & Marketing', note: 'Menu only. Data also needs the workspace id in SALES_ANALYTICS_BUSINESS_IDS on Render.' },
  { key: 'outlook_voice', label: 'Outlook voice', note: 'Voice Profile can learn from a member\'s own Outlook Sent Items (click only, bodies never stored).' },
  { key: 'outlook_meetings', label: 'Outlook meetings', note: 'Meetings held / booked counted from synced calendar events beside the typed number.' },
  { key: 'outlook_reply_times', label: 'Outlook reply times', note: 'Exact reply times from synced Outlook mail on the feed and heat.' },
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
    <Card title="Workspace features" subtitle="Per workspace · hover ⓘ for what each switch does">
      {error && <p role="alert" style={{ ...KIT_TYPE.small, color: ui.dangerInk, margin: `0 0 ${KIT_SPACE[2]}px` }}>{error}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))', gap: `${KIT_SPACE[4]}px ${KIT_SPACE[5]}px` }}>
        {businesses.map(b => (
          <div key={b.id} data-workspace={b.id} style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: KIT_SPACE[1], ...KIT_TYPE.body, fontWeight: 500, color: ui.text, paddingBottom: KIT_SPACE[1], borderBottom: `1px solid ${ui.border}` }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: b.color || ui.accent, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
            </div>
            {FEATURES.map(f => (
              <ToggleRow key={f.key} label={f.label} help={f.note} checked={!!b.features?.[f.key]} disabled={!!busy} onChange={() => toggle(b, f.key)} />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}
