import { useState, useEffect, useRef } from 'react';
import { SA, saSans } from '../theme';
import { PRIORITY_COLORS } from '../palette';
import Ring, { RingLegend } from '../charts/Ring';
import { PIPELINE_STATUSES, TIERS, TOUCH_STATUSES, isStalePartner, daysSinceTouch } from '../../../constants/partnerPipeline';
import { cardStyle, labelStyle, h2Style, h3Style, subStyle, numStyle, inputStyle, Chip, Btn, AddButton, ErrorNote } from './goalsUi';
import PartnerCard, { statusOf, statusLabel, statusColor, tierLabel } from './partners/PartnerCard';

const COLUMNS = [
  { p: 1, title: 'P1', when: 'This week' },
  { p: 2, title: 'P2', when: 'Next 30 days' },
  { p: 3, title: 'P3', when: '60–90 days' },
];
// prospector_partners_mode - per-viewer convenience: last Partners layout.
const MODE_KEY = 'prospector_partners_mode';
const UNDO_MS = 5000; // REVISABLE (spec)
const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'pipeline' ? 'pipeline' : 'priority'; } catch { return 'priority'; } };
const writeMode = m => { try { localStorage.setItem(MODE_KEY, m); } catch { /* private mode */ } };
const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

// What the server will do, applied before it answers (partnerSignals.js is
// the source of truth; its reply replaces this).
function predict(p, s) {
  const now = new Date().toISOString();
  if (s.type === 'status') return { ...p, pipeline_status: s.to, ...(TOUCH_STATUSES.includes(s.to) ? { last_touch_at: now } : {}), ...(s.to === 'first_email_sent' && !p.first_email_at ? { first_email_at: localToday() } : {}) };
  if (s.type === 'deprioritize') return { ...p, pipeline_status: 'paused' };
  if (s.type === 'assign') return { ...p, owner_user_id: s.owner_user_id };
  if (s.type === 'hot') return { ...p, hot: s.hot };
  if (s.type === 'snooze') return { ...p, snoozed_until: new Date(Date.now() + (s.days || 7) * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) };
  return p;
}
const SIGNAL_TEXT = { status: s => `→ ${statusLabel(s.to)}`, deprioritize: () => '→ Paused', assign: () => 'reassigned', hot: s => (s.hot ? 'marked hot' : 'no longer hot'), snooze: () => 'snoozed 7 days', note: () => 'note saved' };

const pill = on => ({ ...saSans, height: 32, padding: '0 12px', borderRadius: 999, fontSize: 13, cursor: 'pointer', border: `1px solid ${on ? SA.accent : SA.border}`, background: on ? 'color-mix(in srgb, var(--sa-accent) 18%, transparent)' : SA.surface2, color: on ? SA.text : SA.soft });

function Column({ title, sub, color, items, collapsed, onCollapse, render }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <button type="button" onClick={onCollapse} disabled={!onCollapse} aria-expanded={onCollapse ? !collapsed : undefined}
        style={{ all: 'unset', display: 'flex', alignItems: 'center', gap: 8, cursor: onCollapse ? 'pointer' : 'default' }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
        <span style={h3Style}>{title}</span><span style={{ ...numStyle, ...subStyle }}>{items.length}</span>
        {onCollapse && <span style={{ ...subStyle, fontSize: 12 }}>{collapsed ? 'Show ▸' : 'Hide ▾'}</span>}
      </button>
      {sub && <span style={{ ...subStyle, fontSize: 12, marginTop: -6 }}>{sub}</span>}
      {!collapsed && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 640, overflowY: 'auto', paddingRight: 2 }}>{items.map(render)}</div>}
    </div>
  );
}

export default function PartnersView({ partners, lookup, members, canEdit, error, onUpdate, onCreate, onSignal, onUndo, onReplace }) {
  const [mode, setMode] = useState(readMode);
  const [openId, setOpenId] = useState(null);
  const [filters, setFilters] = useState({ category: '', tiers: [], stale: false, hot: false });
  const [showPaused, setShowPaused] = useState(false);
  const [toast, setToast] = useState(null); // { text, goalId, eventId, busy, error }
  const toastTimer = useRef(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', priority: '1' });
  const [addError, setAddError] = useState('');
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const today = localToday();
  const categories = [...new Set(partners.map(p => p.category).filter(Boolean))].sort();
  const shown = partners.filter(p =>
    (!filters.category || p.category === filters.category)
    && (!filters.tiers.length || filters.tiers.includes(p.tier))
    && (!filters.stale || isStalePartner(p, Date.now(), today))
    && (!filters.hot || p.hot));
  const stale = partners.filter(p => isStalePartner(p, Date.now(), today)).sort((a, b) => daysSinceTouch(b) - daysSinceTouch(a));
  const filtering = filters.category || filters.tiers.length || filters.stale || filters.hot;

  const showToast = t => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), UNDO_MS);
  };
  const signal = async (p, s) => {
    onReplace(predict(p, s));
    try {
      const { goal, event } = await onSignal(p.id, s);
      onReplace(goal);
      showToast({ text: `${p.name} ${SIGNAL_TEXT[s.type](s)}`, goalId: p.id, eventId: event.id });
    } catch (e) { onReplace(p); throw e; }
  };
  const undo = async () => {
    if (!toast) return;
    clearTimeout(toastTimer.current);
    setToast(t => ({ ...t, busy: true }));
    try { const { goal } = await onUndo(toast.goalId, toast.eventId); onReplace(goal); setToast(null); }
    catch (e) { setToast(t => ({ ...t, busy: false, error: e.message })); toastTimer.current = setTimeout(() => setToast(null), UNDO_MS); }
  };
  const setModeSaved = m => { setMode(m); writeMode(m); };
  const toggleTier = t => setFilters(f => ({ ...f, tiers: f.tiers.includes(t) ? f.tiers.filter(x => x !== t) : [...f.tiers, t] }));

  const render = p => (
    <PartnerCard key={p.id} partner={p} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} today={today}
      canEdit={canEdit} members={members} lookup={lookup} onUpdate={onUpdate} onSignal={signal} />
  );

  const ownerParts = [...members.map(m => ({ label: lookup(m.user_id).first, count: partners.filter(p => p.owner_user_id === m.user_id).length, color: lookup(m.user_id).color }))].filter(x => x.count);
  const unowned = partners.filter(p => !p.owner_user_id).length;
  if (unowned) ownerParts.push({ label: 'Unassigned', count: unowned, color: lookup(null).color });
  const statusParts = PIPELINE_STATUSES.map(s => ({ label: s.label, count: partners.filter(p => statusOf(p) === s.id).length, color: statusColor(s.id) })).filter(x => x.count);

  const unprioritized = shown.filter(p => p.priority == null);
  const priorityColumns = [...COLUMNS, ...(unprioritized.length ? [{ p: null, title: 'Unprioritized', when: 'Not placed yet' }] : [])];

  const add = async () => {
    if (!draft.name.trim()) return;
    setAddError('');
    try { await onCreate({ name: draft.name.trim(), priority: draft.priority ? Number(draft.priority) : null }); setDraft({ name: '', priority: '1' }); setAdding(false); }
    catch (e) { setAddError(e.message); }
  };

  return (
    <section style={cardStyle} aria-labelledby="h-part">
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 260px' }}>
          <span style={labelStyle}>Partner goals</span>
          <h2 style={h2Style} id="h-part">Partnerships to land</h2>
          <span style={subStyle}>Click a partner for contacts, sequence, next step and what to watch out for. Buttons log every change.</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Ring parts={ownerParts} center={String(partners.length)} size={80} stroke={12} track={!partners.length} label="Partners by owner" />
            <RingLegend parts={ownerParts} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Ring parts={statusParts} center={String(partners.length)} size={80} stroke={12} track={!partners.length} label="Partners by pipeline status" />
            <RingLegend parts={statusParts} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 20 }}>
        <div role="group" aria-label="Layout" style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 999, background: SA.inset, border: `1px solid ${SA.border}` }}>
          <button type="button" aria-pressed={mode === 'priority'} onClick={() => setModeSaved('priority')} style={{ ...pill(mode === 'priority'), border: 'none' }}>Priority columns</button>
          <button type="button" aria-pressed={mode === 'pipeline'} onClick={() => setModeSaved('pipeline')} style={{ ...pill(mode === 'pipeline'), border: 'none' }}>Pipeline</button>
        </div>
        <select aria-label="Category" value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))} style={{ ...inputStyle, height: 32, width: 'auto', maxWidth: '100%', borderRadius: 999, fontSize: 13 }}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c.replace(/^\d+\.\s*/, '')}</option>)}
        </select>
        {TIERS.map(t => <button key={t} type="button" aria-pressed={filters.tiers.includes(t)} onClick={() => toggleTier(t)} style={pill(filters.tiers.includes(t))}>{tierLabel(t)}</button>)}
        <button type="button" aria-pressed={filters.stale} onClick={() => setFilters(f => ({ ...f, stale: !f.stale }))} style={pill(filters.stale)}>Stale only</button>
        <button type="button" aria-pressed={filters.hot} onClick={() => setFilters(f => ({ ...f, hot: !f.hot }))} style={pill(filters.hot)}>🔥 Hot only</button>
        {filtering && <button type="button" onClick={() => setFilters({ category: '', tiers: [], stale: false, hot: false })} style={{ ...pill(false), border: 'none', background: 'transparent', color: SA.link }}>Clear</button>}
        <span style={{ ...subStyle, ...numStyle, fontSize: 13 }}>{shown.length} of {partners.length}</span>
      </div>

      <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 10, background: SA.inset, border: `1px solid ${stale.length ? SA.bad : SA.border}` }} aria-label="Stale partners">
        <span style={labelStyle}>Stale · 7+ days without a touch</span>
        {!stale.length
          ? <div style={{ ...subStyle, fontSize: 13, marginTop: 4 }}>Nothing stale. Partners you haven't contacted yet don't count.</div>
          : <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {stale.map(p => (
                <Chip key={p.id} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => setOpenId(p.id)} onKeyDown={e => { if (e.key === 'Enter') setOpenId(p.id); }}>
                  <span style={{ color: SA.bad, ...numStyle }}>{daysSinceTouch(p)}d</span>{p.name} · {lookup(p.owner_user_id).first}
                </Chip>
              ))}
            </div>}
      </div>

      {error && <div style={{ marginTop: 12 }}><ErrorNote message={error.message} /></div>}
      {!error && !partners.length && <p style={{ ...subStyle, margin: '20px 0 0' }}>No partners yet{canEdit ? ' — add your first' : ''}.</p>}
      {!error && partners.length > 0 && !shown.length && <p style={{ ...subStyle, margin: '20px 0 0' }}>No partners match these filters.</p>}

      {shown.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 20 }}>
          {mode === 'priority'
            ? priorityColumns.map(c => (
                <Column key={c.title} title={c.title} sub={c.when} color={PRIORITY_COLORS[c.p ?? 'none']} items={shown.filter(x => (x.priority ?? null) === c.p)} render={render} />
              ))
            : PIPELINE_STATUSES.map(s => {
                const items = shown.filter(p => statusOf(p) === s.id);
                if (!items.length) return null;
                const paused = s.id === 'paused';
                return <Column key={s.id} title={s.label} color={statusColor(s.id)} items={items} render={render}
                  collapsed={paused && !showPaused} onCollapse={paused ? () => setShowPaused(v => !v) : null} />;
              })}
        </div>
      )}

      {canEdit && (adding
        ? <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input autoFocus placeholder="Partner name (Enter to save)" aria-label="Partner name" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false); }} style={{ ...inputStyle, flex: '1 1 220px' }} />
            <select aria-label="Priority" value={draft.priority} onChange={e => setDraft(d => ({ ...d, priority: e.target.value }))} style={{ ...inputStyle, width: 'auto' }}>
              <option value="1">P1</option><option value="2">P2</option><option value="3">P3</option><option value="">Unprioritized</option>
            </select>
            <Btn primary style={{ height: 40 }} onClick={add} disabled={!draft.name.trim()}>Add</Btn>
            <Btn style={{ height: 40 }} onClick={() => setAdding(false)}>Cancel</Btn>
          </div>
        : <AddButton onClick={() => setAdding(true)}>+ Add partner</AddButton>)}
      {addError && <div style={{ marginTop: 8 }}><ErrorNote message={addError} /></div>}

      <div aria-live="polite" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 3500, maxWidth: 'calc(100vw - 32px)' }}>
        {toast && (
          <div style={{ ...saSans, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: SA.surface2, border: `1px solid ${SA.borderStrong}`, boxShadow: '0 10px 30px #0008', fontSize: 14, color: SA.text }}>
            <span>{toast.error || toast.text}</span>
            {!toast.error && <Btn style={{ height: 36 }} onClick={undo} disabled={toast.busy}>{toast.busy ? 'Undoing…' : 'Undo'}</Btn>}
          </div>
        )}
      </div>
    </section>
  );
}
