import React, { useState } from 'react';
import Button from '../../ui/Button';
import { hkPatch, hkPost, hkDelete } from '../hkApi';
import { DEAL_STAGE_WORDS, DEAL_STAGE_TONE, STATE_WORDS, STATE_TONE, monthWords, usd, addMonths, chicagoMonth, needsUpdate, moveTarget } from './dealWords';

// grow-sponsor-deals-v1 S6 - the Brand page Deal card: the deal stage, the months newest first (state chip with its word,
// amount, Paid, Details), Add month, edits in place with Undo, Copy to next month on a confirmed month (the renewal ask),
// Remove = archive (owner role) with Undo. Ruling 3: what linked email threads say shows as suggestions, never written here
// without a click. Every write logs Activity server-side.
const STATES = ['confirmed', 'discussing', 'declined'];
const toAmount = s => (String(s).trim() === '' ? null : Number(String(s).replace(/[$,\s]/g, '')));

function Month({ p, canEdit, isOwnerRole, busy, run, thisMonth }) {
  const [amount, setAmount] = useState(p.amount_usd == null ? '' : String(Number(p.amount_usd)));
  const label = p.kind === 'launch' ? 'Launch' : monthWords(p.period);
  const cur = p.amount_usd == null ? null : Number(p.amount_usd);
  const saveAmount = () => { const v = toAmount(amount); if (v !== null && !Number.isFinite(v)) { setAmount(cur == null ? '' : String(cur)); return; } if (v !== cur) run('patch', p, { amount_usd: v }, `${label} amount → ${usd(v)}`); };
  const details = Object.entries(p.details || {});
  return (
    <li className="hk-month" data-hk-month={p.period}>
      <div className="hk-month__top">
        <span className="hk-month__name">{label}</span>
        <span className={`hk-chip hk-chip--${STATE_TONE[p.state || 'confirmed']}`} data-hk-month-state={p.state || 'confirmed'}>{STATE_WORDS[p.state || 'confirmed']}</span>
        <span>{usd(cur)}</span>
        {(p.state || 'confirmed') === 'confirmed' && <span className={`hk-chip hk-chip--${p.paid ? 'green' : 'grey'}`} data-hk-month-paid={p.paid ? 'yes' : 'no'}>{p.paid ? 'Paid' : 'Not paid yet'}</span>}
        {p.source === 'email' && <span className="hk-meta">from email</span>}
      </div>
      {needsUpdate(p, thisMonth) && (
        <p className="hk-banner hk-banner--mustard hk-month__stale" data-hk-month-stale>
          <span className="hk-banner__title">Needs update · {label} ended and is still in discussion.</span>
          {canEdit && <span className="hk-banner__actions">
            <button type="button" className="hk-btn hk-link" disabled={busy} onClick={() => run('patch', p, { period: moveTarget(p, thisMonth) }, `${label} moved to ${monthWords(moveTarget(p, thisMonth))}`)} data-hk-month-move>Move to {monthWords(moveTarget(p, thisMonth))}</button>
            <button type="button" className="hk-btn hk-link" disabled={busy} onClick={() => run('patch', p, { state: 'declined' }, `${label} → Declined`)} data-hk-month-decline>Mark declined</button>
          </span>}
        </p>
      )}
      {canEdit && (
        <div className="hk-month__acts">
          <select className="ui-input ui-input--sm" aria-label={`${label} state`} value={p.state || 'confirmed'} disabled={busy} onChange={e => run('patch', p, { state: e.target.value }, `${label} → ${STATE_WORDS[e.target.value]}`)} data-hk-month-state-pick>
            {STATES.map(s => <option key={s} value={s}>{STATE_WORDS[s]}</option>)}
          </select>
          <input className="ui-input ui-input--sm hk-month__amount" aria-label={`${label} amount in dollars`} inputMode="decimal" placeholder="Amount" value={amount} disabled={busy}
            onChange={e => setAmount(e.target.value)} onBlur={saveAmount} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveAmount(); } }} data-hk-month-amount />
          {(p.state || 'confirmed') === 'confirmed' && <label className="hk-inline"><input type="checkbox" checked={!!p.paid} disabled={busy} onChange={e => run('patch', p, { paid: e.target.checked }, `${label} ${e.target.checked ? 'marked paid' : 'marked not paid'}`)} data-hk-month-paid-toggle /> Paid</label>}
          {p.kind === 'monthly' && (p.state || 'confirmed') === 'confirmed' && <button type="button" className="hk-btn hk-link" disabled={busy} onClick={() => run('copy', p, null, `${monthWords(addMonths(p.period, 1))} added as In discussion`)} data-hk-month-copy>Copy to next month</button>}
          {isOwnerRole && <button type="button" className="hk-btn hk-link" disabled={busy} onClick={() => run('remove', p, null, `${label} removed`)} data-hk-month-remove>Remove</button>}
        </div>
      )}
      {(details.length > 0 || p.deal_type || p.note) && (
        <details>
          <summary className="hk-link">Details</summary>
          <dl className="hk-kv">
            {p.deal_type && <div className="hk-kv__row"><dt>Deal type</dt><dd>{p.deal_type}</dd></div>}
            {details.map(([k, v]) => <div key={k} className="hk-kv__row"><dt>{k}</dt><dd>{v}</dd></div>)}
            {p.note && <div className="hk-kv__row"><dt>Note</dt><dd>{p.note}</dd></div>}
          </dl>
        </details>
      )}
    </li>
  );
}

export default function DealCard({ businessId, brand, deal, canEdit, isOwnerRole, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [undo, setUndo] = useState(null);
  const [form, setForm] = useState(null);
  const base = `/sponsors/${brand.id}/periods`;
  const months = deal?.months || [];
  const sugg = deal?.suggestions || { confirm: [], use_amount: [], notes: [] };
  const go = async (fn, after) => {
    setBusy(true); setError('');
    try { const r = await fn(); after?.(r); await onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const run = (kind, p, body, words) => {
    if (kind === 'patch') return go(() => hkPatch(businessId, `${base}/${p.id}`, body), r => r.changed?.length && setUndo({ words, fn: () => hkPatch(businessId, `${base}/${p.id}`, { ...Object.fromEntries(r.changed.map(k => [k, r.prev[k]])), source: r.prev.source, expect: Object.fromEntries(r.changed.map(k => [k, r.period[k]])) }) }));
    if (kind === 'copy') return go(() => hkPost(businessId, `${base}/${p.id}/copy-next`, {}), r => setUndo({ words, fn: () => hkDelete(businessId, `${base}/${r.undo.archive}`) }));
    return go(() => hkDelete(businessId, `${base}/${p.id}`), r => setUndo({ words, fn: () => hkPost(businessId, `${base}/${r.undo.restore}/restore`, {}) }));
  };
  const add = e => {
    e.preventDefault();
    const v = toAmount(form.amount);
    if (v !== null && !Number.isFinite(v)) { setError('Amount must be blank or a dollar amount, like 150'); return; }
    const body = { period: form.period, state: form.state, ...(form.amount.trim() !== '' || form.touched ? { amount_usd: v } : {}) };
    go(() => hkPost(businessId, base, body), r => { setForm(null); setUndo({ words: `${monthWords(form.period)} added`, fn: () => hkDelete(businessId, `${base}/${r.undo.archive}`) }); });
  };
  const stage = deal?.stage || 'prospect';
  const thisMonth = chicagoMonth();
  return (
    <section className="hk-bcard" aria-label="Deal" data-hk-deal>
      <div className="hk-bcard__head">
        <h3 className="hk-kicker">Deal</h3><span className="hk-spacer" />
        <span className={`hk-chip hk-chip--${DEAL_STAGE_TONE[stage]}`} data-hk-deal-stage={stage}>{DEAL_STAGE_WORDS[stage]}</span>
      </div>
      {[...sugg.confirm.map(s => ({ ...s, kind: 'confirm' })), ...sugg.use_amount.map(s => ({ ...s, kind: 'amount' }))].map(s => {
        const p = months.find(m => m.id === s.period_id);
        if (!p) return null;
        return (
          <p key={`${s.kind}:${s.period_id}`} className="hk-banner hk-banner--blue" data-hk-deal-suggest={s.kind}>
            <span className="hk-banner__title">{s.kind === 'confirm' ? `Email says ${monthWords(s.month)} is confirmed.` : `Email says ${usd(s.amount_usd)} for ${monthWords(s.month)}.`}</span>
            {canEdit && <button type="button" className="hk-btn hk-link" disabled={busy} onClick={() => run('patch', p, s.kind === 'confirm' ? { state: 'confirmed' } : { amount_usd: s.amount_usd }, s.kind === 'confirm' ? `${monthWords(s.month)} → Confirmed` : `${monthWords(s.month)} amount → ${usd(s.amount_usd)}`)}>{s.kind === 'confirm' ? 'Confirm?' : `Use ${usd(s.amount_usd)}`}</button>}
          </p>
        );
      })}
      {sugg.notes.map(n => <p key={`${n.thread_id}:${n.month}`} className="hk-meta" data-hk-deal-note>{n.words}</p>)}
      {!months.length && <p className="hk-meta">No sponsor months yet.</p>}
      <ul className="hk-plain">{months.map(p => <Month key={`${p.id}:${p.period}:${p.state}:${p.amount_usd}:${p.paid}`} p={p} canEdit={canEdit} isOwnerRole={isOwnerRole} busy={busy} run={run} thisMonth={thisMonth} />)}</ul>
      {undo && (
        <p className="hk-note" role="status" data-hk-deal-undo>{undo.words}. <button type="button" className="hk-btn hk-link" disabled={busy} onClick={() => go(undo.fn, () => setUndo(null))}>Undo</button></p>
      )}
      {canEdit && !form && brand.relationship !== 'do_not_contact' && <button type="button" className="hk-btn hk-link" onClick={() => setForm({ period: thisMonth, state: 'discussing', amount: deal?.default_monthly_usd == null ? '' : String(deal.default_monthly_usd), touched: false })} data-hk-month-add>+ Add month</button>}
      {form && (
        <form className="hk-form" onSubmit={add} data-hk-month-form>
          <label className="hk-inline">Month <input className="ui-input ui-input--sm" type="month" aria-label="Month" value={form.period} required onChange={e => setForm({ ...form, period: e.target.value })} /></label>
          <label className="hk-inline">State <select className="ui-input ui-input--sm" aria-label="State" value={form.state} onChange={e => setForm({ ...form, state: e.target.value })}>{STATES.map(s => <option key={s} value={s}>{STATE_WORDS[s]}</option>)}</select></label>
          <label className="hk-inline">Amount <input className="ui-input ui-input--sm hk-month__amount" aria-label="Amount in dollars" inputMode="decimal" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value, touched: true })} /></label>
          <span style={{ display: 'inline-flex', gap: 8 }}><Button type="submit" variant="primary" size="sm" disabled={busy || !/^\d{4}-\d{2}$/.test(form.period)}>Add month</Button><Button size="sm" variant="tertiary" onClick={() => setForm(null)}>Cancel</Button></span>
        </form>
      )}
      {error && <p className="hk-error" role="alert">{error}</p>}
    </section>
  );
}
