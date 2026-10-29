import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DataTable from '../../ui/DataTable';
import { Avatar } from '../HkMarks';
import { hkGet } from '../hkApi';

// hkos-data-foundation-v1 D6 - Activity: read-only table (Time, Actor, Brand, Action, Detail) + filters. The owner
// toggle (D7) narrows actors to the chosen member.
const ACTIONS = [['', 'All actions'], ['brand.', 'Brands'], ['contact.', 'Contacts'], ['sponsor.', 'Sponsors'], ['review.', 'Review'], ['settings.', 'Settings'], ['connector.', 'Claude connector']];
const WORDS = { 'brand.created': 'Added brand', 'brand.claimed': 'Claimed', 'brand.released': 'Released', 'brand.status': 'Set status', 'brand.relationship': 'Changed relationship', 'brand.updated': 'Edited', 'brand.merged': 'Merged duplicate', 'contact.added': 'Added contact', 'contact.updated': 'Edited contact', 'sponsor.period_added': 'Added sponsor period', 'sponsor.period_removed': 'Removed sponsor period', 'review.not_duplicate': 'Not a duplicate', 'settings.updated': 'Updated settings', 'settings.stats_confirmed': 'Confirmed stats', 'connector.hk_settings': 'Read settings', 'connector.hk_check': 'Checked brands', 'connector.hk_claim': 'Claimed', 'connector.hk_brand': 'Opened brand', 'connector.hk_draft_save': 'Saved draft', 'connector.hk_due': "Read what's due", 'connector.hk_update': 'Set status', 'connector.revoked': 'Revoked Claude connector' };
const fmt = iso => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const detailText = d => { if (!d || typeof d !== 'object') return ''; const parts = []; if (d.name) parts.push(d.name); if (d.changed?.length) parts.push(d.changed.join(', ')); if (d.prev && 'status' in d.prev) parts.push(`was ${d.prev.status}`); if (d.reason) parts.push(`reason: ${d.reason}`); if (d.period) parts.push(`${d.period} ${d.kind || ''}`.trim()); if (d.loser_name) parts.push(`${d.loser_name} archived`); if (d.verdict) parts.push(`verdict ${d.verdict}`); if (d.via === 'connector') parts.push(d.ok ? 'ok' : `refused${d.code ? ` (${d.code})` : ''}`); return parts.join(' · '); };

export default function ActivityScreen({ businessId, shell, owner, compact, onOpenBrand }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ actor: '', action: '', brand: '', from: '', to: '' });
  const members = shell?.members || [];
  const member = id => members.find(m => m.user_id === id);
  const actor = f.actor || (owner === 'me' ? shell?.me?.user_id : owner !== 'all' ? owner : '');
  const load = useCallback(async () => {
    setError('');
    try { const { events } = await hkGet(businessId, '/activity', { actor, action: f.action, from: f.from ? new Date(f.from).toISOString() : '', to: f.to ? new Date(new Date(f.to).getTime() + 86400e3).toISOString() : '' }); setRows(events); }
    catch (e) { setError(e.message); setRows([]); }
  }, [businessId, actor, f.action, f.from, f.to]);
  useEffect(() => { load(); }, [load]);
  const shown = useMemo(() => (rows || []).filter(e => !f.brand.trim() || (e.brand_name || '').toLowerCase().includes(f.brand.trim().toLowerCase())), [rows, f.brand]);
  const columns = useMemo(() => [
    { id: 'time', label: 'Time', width: 150, sticky: true, sortValue: r => r.created_at, render: r => fmt(r.created_at) },
    { id: 'actor', label: 'Actor', width: 150, render: r => { const m = member(r.actor_user_id); if (r.detail?.via === 'connector') return <span className="hk-owner" data-hk-actor-connector><span className="hk-avatar hk-avatar--system" style={{ width: 22, height: 22 }}>C</span>Claude via connector{m ? ` (${m.first_name})` : ''}</span>; return m ? <span className="hk-owner"><Avatar name={m.first_name} index={m.palette_index} size={22} />{m.first_name}</span> : <span className="hk-owner"><span className="hk-avatar hk-avatar--system" style={{ width: 22, height: 22 }}>{r.actor_kind === 'claude' ? 'C' : 'S'}</span>{r.actor_kind === 'claude' ? 'Claude' : 'System'}</span>; } },
    { id: 'brand', label: 'Brand', width: 200, sortValue: r => r.brand_name || '', render: r => (r.brand_name ? <button type="button" className="hk-btn hk-table__title" onClick={() => onOpenBrand(r.entity_id)}>{r.brand_name}</button> : <span className="hk-meta">·</span>) },
    { id: 'action', label: 'Action', width: 170, sortValue: r => r.action, render: r => WORDS[r.action] || r.action },
    { id: 'detail', label: 'Detail', minWidth: 240, render: r => <span className="hk-meta">{detailText(r.detail)}</span> },
  ], [members, onOpenBrand]);
  return (
    <div data-hk-activity>
      <div className="hk-toolbar">
        <select className="ui-input ui-input--sm hk-filter" aria-label="Actor" value={f.actor} onChange={e => setF({ ...f, actor: e.target.value })}>
          <option value="">{owner === 'all' ? 'All actors' : owner === 'me' ? 'Me (owner toggle)' : 'Owner toggle'}</option>
          {members.filter(m => m.user_id).map(m => <option key={m.user_id} value={m.user_id}>{m.first_name}</option>)}
          <option value="claude">Claude</option><option value="system">System</option>
        </select>
        <select className="ui-input ui-input--sm hk-filter" aria-label="Action" value={f.action} onChange={e => setF({ ...f, action: e.target.value })}>{ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input className="ui-input ui-input--sm hk-filter" type="search" aria-label="Brand" placeholder="Brand" value={f.brand} onChange={e => setF({ ...f, brand: e.target.value })} />
        <input className="ui-input ui-input--sm hk-filter" type="date" aria-label="From" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} />
        <input className="ui-input ui-input--sm hk-filter" type="date" aria-label="To" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} />
      </div>
      {error && <p className="hk-error" role="alert">{error}</p>}
      {rows === null ? <p className="hk-meta">Loading activity…</p> : !shown.length ? <p className="hk-meta" data-hk-empty>No activity matches.</p> : (
        <DataTable label="Activity" columns={columns} rowKey={r => r.id} compact={compact} groups={[{ id: 'all', header: `${shown.length} event${shown.length === 1 ? '' : 's'}`, rows: shown }]}
          renderCompact={r => <div className="hk-card-row" data-hk-event><span className="hk-table__title">{WORDS[r.action] || r.action}{r.brand_name ? ` · ${r.brand_name}` : ''}</span><span className="hk-meta">{fmt(r.created_at)} · {r.detail?.via === 'connector' ? 'Claude via connector · ' : ''}{detailText(r.detail)}</span></div>} />
      )}
    </div>
  );
}
