import { useState } from 'react';
import { SA } from '../theme';
import { goalsApi } from './goalsApi';
import { inputStyle, ErrorNote } from './goalsUi';
import { needsRecord } from './companyPanelModel';

// company-panel-v3 S - "SETUP n/m" (done over the steps shown; skip steps excluded): done = an outlined green chip
// "✓ Research · Oct 23" (no number), the one primary = a filled accent pill "2 Size & type", later = an outlined chip.
// company-workflow-v1 W1 - the steps strip under the facts row: the server's steps (api/sales/companySteps.js)
// as one row, exactly ONE glowing (the primary), done steps ✓ with their value, later steps plain and still
// clickable; "✓ Ready · last touch <date>" once nothing is left. A step's control opens under the row:
// Research (a visitor / Apollo-only row is added as a target first - the button says so), Confirm site, Size & type
// (employees, and for PEO / HR / platform partners the reach - research values offered with "Use"), Owner (a person),
// Add to pipeline / Promote (opens the Actions row's one control), First touch (Mark contacted). Every write offers
// Undo where one exists. Viewers read the strip, no buttons.
const field = { ...inputStyle, height: 30, fontSize: 13, padding: '0 8px', width: 110 };
const md = d => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const num = v => (v == null || v === '' ? null : Number(String(v).replace(/[,\s]/g, '')));
const fmt = n => Number(n).toLocaleString('en-US');

export function researchNumbers(detail) {
  const r = detail.research?.runs?.find(x => x.status === 'done')?.result || {};
  return { employees: r.employees_count ?? null, reach_employees: r.reach_employees ?? null, reach_clients: r.reach_clients ?? null };
}

export default function CompanyStepsStrip({ businessId, row, detail, canEdit, members, onChanged, onConvert, onToast, setForm }) {
  const [openStep, setOpenStep] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({});
  const s = detail.steps;
  if (!s) return null;
  const rec = detail.record;
  const act = async (what, fn) => { setBusy(what); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(''); } };
  const visitorLike = needsRecord(row.type);
  const label = step => (step.id === 'research' && visitorLike ? 'Research — adds it as a target' : step.label);

  const runResearch = () => act('research', async () => {
    if (visitorLike) {
      const r = await goalsApi.addToPipeline(businessId, { type: row.type, id: row.id, to: 'target' });
      const created = r.created || r.already;
      if (created.type !== 'target') { onConvert(created, true); return; }
      // The window moves to the new target even when research can't start (the cap, a network error) - it says so.
      const failed = await goalsApi.runCompanyResearch(businessId, 'target', created.id).then(() => null, e => e);
      onToast({ text: failed ? `${row.name} added as a target - research didn't start: ${failed.message}` : `${row.name} added as a target - researching it now (one Claude call, about a minute)` });
      onConvert(created, !!r.already);
      return;
    }
    await goalsApi.runCompanyResearch(businessId, row.type, row.id);
    onChanged(); onToast({ text: `Researching ${row.name} - one Claude call, about a minute` });
  });
  const confirmSite = () => act('site', async () => {
    await goalsApi.addPartnerDomain(businessId, row.id, { domain: rec.site.domain });
    onChanged(); onToast({ text: `${rec.site.domain} confirmed for ${row.name}` });
  });
  const reachOn = s.steps.find(x => x.id === 'size')?.reach;
  const SIZE = [['employees', 'Employees'], ...(reachOn ? [['reach_employees', 'Covers (employees)'], ['reach_clients', 'Clients']] : [])];
  const saveSize = () => act('size', async () => {
    const body = Object.fromEntries(SIZE.filter(([k]) => k in draft).map(([k]) => [k, num(draft[k])]));
    if (!Object.keys(body).length) { setOpenStep(null); return; }
    const before = Object.fromEntries(Object.keys(body).map(k => [k, rec[k] ?? null]));
    await goalsApi.editCompanyFields(businessId, row.type, row.id, body);
    setOpenStep(null); setDraft({}); onChanged();
    onToast({ text: `${row.name}: size saved`, undo: async () => { await goalsApi.editCompanyFields(businessId, row.type, row.id, before); onChanged(); } });
  });
  const setOwner = userId => act('owner', async () => {
    const before = rec.owner_user_id || null;
    const write = u => (row.type === 'partner' ? goalsApi.partnerSignal(businessId, row.id, { type: 'assign', owner_user_id: u }) : goalsApi.editCompanyFields(businessId, row.type, row.id, { owner_user_id: u }));
    await write(userId || null);
    setOpenStep(null); onChanged();
    const who = members.find(m => m.user_id === userId);
    onToast({ text: `${row.name}: owner ${who ? who.name.split(' ')[0] : 'nobody'}`, undo: async () => { await write(before); onChanged(); } });
  });
  const firstTouch = () => act('touch', async () => {
    await goalsApi.markContacted(businessId, row.type, row.id, {});
    onChanged(); onToast({ text: `${row.name}: marked contacted` });
  });
  const go = step => {
    setError('');
    if (step.id === 'research') return runResearch();
    if (step.id === 'add') return setForm(row.type === 'target' ? 'promote' : 'add');
    if (step.id === 'touch') return firstTouch();
    if (step.id === 'size' || step.id === 'owner' || step.id === 'site') { setDraft({}); return setOpenStep(o => (o === step.id ? null : step.id)); }
    return undefined;
  };

  if (s.ready && !openStep) {
    return <div data-steps-ready style={{ fontSize: 13, color: SA.good }}>✓ Ready{s.last_touch_at ? <span style={{ color: SA.soft }}> · last touch {md(s.last_touch_at)}</span> : null}</div>;
  }
  const found = researchNumbers(detail);
  const shown = s.steps.filter(x => x.status !== 'skip');
  const doneCount = shown.filter(x => x.status === 'done').length;
  const chip = { display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 10px', borderRadius: 999, fontSize: 12, whiteSpace: 'nowrap', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' };
  const doneChip = { ...chip, color: SA.good, border: `1px solid color-mix(in srgb, ${SA.good} 40%, transparent)` };
  return (
    <section aria-label="Setup" data-steps style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className="ui-group-label" data-setup-count style={{ width: 72, flex: 'none' }}>Setup <span style={{ fontVariantNumeric: 'tabular-nums' }}>{doneCount}/{shown.length}</span></span>
        {shown.map((step, i) => {
          const done = step.status === 'done', next = step.status === 'next', running = step.status === 'running';
          const text = done ? `${label(step)}${step.value ? ` · ${step.value}` : ''}` : `${i + 1} ${label(step)}${running ? ' · running…' : ''}`;
          const blocked = visitorLike && ['size', 'owner'].includes(step.id);
          // A done Size / Owner step stays clickable to change it (an owner defaults to whoever added the company).
          if (!canEdit || running || blocked || (done && !['size', 'owner'].includes(step.id))) {
            return <span key={step.id} data-step={step.id} data-status={step.status} title={blocked ? 'Research or add it to the pipeline first' : step.value || undefined}
              style={done ? doneChip : { ...chip, border: `1px solid ${SA.border}`, color: SA.soft }}>
              {done ? '✓ ' : ''}{text}
            </span>;
          }
          return (
            <button key={step.id} type="button" data-step={step.id} data-status={step.status} title={done ? 'Done - click to change' : undefined} aria-expanded={['size', 'owner', 'site'].includes(step.id) ? openStep === step.id : undefined}
              className={next ? 'ui-btn ui-btn--primary' : 'ui-btn ui-btn--tertiary'} disabled={!!busy}
              style={{ height: 28, fontSize: 12, borderRadius: 999, ...(next ? {} : done ? { ...doneChip, height: 28 } : { border: `1px solid ${SA.border}`, color: SA.soft }) }}
              onClick={() => go(step)}>{busy === step.id ? 'Working…' : `${done ? '✓ ' : ''}${text}`}</button>
          );
        })}
      </div>
      {openStep === 'site' && rec.site?.domain && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: SA.soft }}>
          Research found <b style={{ color: SA.text }}>{rec.site.domain}</b>
          <button type="button" className="ui-btn ui-btn--primary" disabled={!!busy} onClick={confirmSite}>Confirm site</button>
          <span style={{ fontSize: 12, color: SA.muted }}>Wrong site? Fix it in the partner's Sites on its full card.</span>
        </div>
      )}
      {openStep === 'size' && (
        <div role="group" aria-label="Size & type" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {SIZE.map(([k, lb]) => {
            const value = k in draft ? draft[k] : rec[k] ?? '';
            const use = found[k] != null && found[k] !== rec[k] ? found[k] : null;
            return (
              <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: SA.soft }}>
                {lb}{rec[`${k}_source`] ? <span style={{ color: SA.muted }}> · {rec[`${k}_source`] === 'manual' ? 'Typed' : 'Research'}</span> : null}
                <span style={{ display: 'flex', gap: 4 }}>
                  <input aria-label={lb} inputMode="numeric" value={value} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} className="ui-input" style={field} />
                  {use != null && <button type="button" className="ui-btn ui-btn--tertiary" style={{ height: 30, fontSize: 12 }} onClick={() => setDraft(d => ({ ...d, [k]: String(use) }))}>Use {fmt(use)}</button>}
                </span>
              </label>
            );
          })}
          <button type="button" className="ui-btn ui-btn--primary" disabled={!!busy} onClick={saveSize}>{busy === 'size' ? 'Saving…' : 'Save'}</button>
          {reachOn && <span style={{ fontSize: 12, color: SA.muted, flexBasis: '100%' }}>Covers = employees it manages across its clients; Clients = how many client companies. Its own headcount is Employees.</span>}
        </div>
      )}
      {openStep === 'owner' && (
        <div role="group" aria-label="Owner" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {members.filter(m => m.role !== 'viewer').map(m => (
            <button key={m.user_id} type="button" className="ui-btn ui-btn--secondary" aria-pressed={rec.owner_user_id === m.user_id} disabled={!!busy} onClick={() => setOwner(m.user_id)}>{m.name.split(' ')[0]}</button>
          ))}
        </div>
      )}
      {error && <ErrorNote message={error} />}
    </section>
  );
}
