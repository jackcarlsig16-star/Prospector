import React, { useState } from 'react';
import { Icon } from '../HkMarks';
import { VIEW_NAME_MAX } from './ActiveFilters';
import { VIEW_LABELS, BRAND_BUCKETS, valueLabel, valueTone, ownerValueOf, MAIL_LANES, REPLY_ITEMS, DRAFT_ITEMS } from './filterState';

// grow-nav-filters-v1 N3 / N4 - the rail's buckets for the active space, built from what the server counted.
// Brands: Views (the nine built-ins always, even at 0 - ruling 2 - then your saved views), then every filter bucket
// with its values; a value with 0 rows is left out unless it is on, and a bucket with no values hides itself.

// Rename a saved view in place: Enter saves, Esc cancels. Same rules as PUT /me/prefs (spaces collapsed, 1-40
// characters); anything else the server refuses (an email or phone in the name) shows under the field.
export function ViewNameField({ view, onSave, onCancel }) {
  const [name, setName] = useState(view.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const clean = name.replace(/\s+/g, ' ').trim();
  const submit = async e => {
    e.preventDefault();
    if (!clean || busy) return;
    if (clean === view.name) { onCancel(); return; }
    setBusy(true); setError('');
    try { await onSave(view, clean); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <form className="hk-bucket__rename" onSubmit={submit} data-hk-rename-form={view.id}>
      <input className="ui-input ui-input--sm" aria-label={`New name for ${view.name}`} maxLength={VIEW_NAME_MAX} autoFocus value={name} disabled={busy}
        onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } }} data-hk-rename-input />
      {error && <p className="hk-error" role="alert">{error}</p>}
    </form>
  );
}

export function brandBuckets({ facets, state, meId, members, savedViews = [], onRename, onRemove, renaming = null, onRenameSave, onRenameCancel }) {
  const views = (facets?.view || Object.keys(VIEW_LABELS).map(v => [v, null])).map(([v, n]) => ({ id: v, label: VIEW_LABELS[v] || v, count: n, active: !state.saved && state.view === v }));
  const saved = savedViews.filter(v => v.space === 'brands').map(v => ({
    id: `saved:${v.id}`, label: v.name, active: state.saved === v.id,
    edit: renaming === v.id && <ViewNameField view={v} onSave={onRenameSave} onCancel={onRenameCancel} />,
    extra: (onRename || onRemove) && (
      <span className="hk-bucket__tools">
        {onRename && <button type="button" className="hk-btn hk-icon-btn" aria-label={`Rename ${v.name}`} onClick={() => onRename(v)} data-hk-rename-view={v.id}><Icon name="pencil" size={14} /></button>}
        {onRemove && <button type="button" className="hk-btn hk-icon-btn" aria-label={`Remove ${v.name} from your views`} onClick={() => onRemove(v)} data-hk-remove-view={v.id}><Icon name="close" size={14} /></button>}
      </span>
    ),
  }));
  const out = [{ key: 'views', label: 'Views', icon: 'star', items: [...views, ...saved] }];
  for (const b of BRAND_BUCKETS) {
    const items = (facets?.[b.key] || []).map(([v, n]) => {
      const id = b.key === 'owner' ? ownerValueOf(v, meId) : v;
      return { id, label: valueLabel(b.key, v, { meId, members }), count: n, tone: valueTone(b.key, v), active: !!state.filters[b.key]?.includes(id) };
    });
    if (items.length) out.push({ ...b, items });
  }
  return out;
}

// counts: { replies: { open, snoozed, handled, <label>: n }, drafts: { all, email, ig_dm, lint_failed, older } } from the DB;
// laneCounts: what the loaded Gmail list already knows (Needs you), never a Gmail call of its own.
export function inboxBuckets({ sel, laneCounts = {}, counts = null }) {
  const on = (kind, v) => sel.kind === kind && sel.value === v;
  const mail = MAIL_LANES.map(([v, l]) => ({ id: v, label: l, count: v === 'needs_you' && typeof laneCounts.needs_you === 'number' ? laneCounts.needs_you : null, active: on('lane', v) }));
  const always = new Set(['open', 'snoozed', 'handled']);
  const replies = REPLY_ITEMS.map(([v, l]) => ({ id: v, label: l, count: counts ? counts.replies[v] || 0 : null, active: on('replies', v) }))
    .filter(it => always.has(it.id) || it.active || !counts || it.count > 0);
  const drafts = DRAFT_ITEMS.map(([v, l]) => ({ id: v, label: l, count: counts ? counts.drafts[v] || 0 : null, active: on('drafts', v) }));
  return [
    { key: 'my_mail', label: 'My mail', icon: 'mail', items: mail },
    { key: 'tracked_replies', label: 'Tracked replies', icon: 'label', items: replies },
    { key: 'queued_drafts', label: 'Queued drafts', icon: 'send', items: drafts },
  ];
}

// Tracked replies + queued drafts counted from the two DB lists (owner toggle applied by the server).
export function inboxCounts(replies, drafts, now = Date.now()) {
  const r = { open: 0, snoozed: 0, handled: 0 };
  for (const x of replies) {
    if (x.handled) { r.handled++; continue; }
    if (x.snoozed_until && Date.parse(x.snoozed_until) > now) { r.snoozed++; continue; }
    r.open++; r[x.label || 'other'] = (r[x.label || 'other'] || 0) + 1;
  }
  const d = { all: drafts.length, email: 0, ig_dm: 0, lint_failed: 0, older: 0 };
  for (const x of drafts) { d[x.channel === 'ig_dm' ? 'ig_dm' : 'email']++; if (x.lint_passed === false) d.lint_failed++; if (x.age_days > 3) d.older++; }
  return { replies: r, drafts: d };
}
