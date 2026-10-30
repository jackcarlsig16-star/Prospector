import React, { useEffect, useRef, useState } from 'react';
import Button from '../../ui/Button';
import { Chip } from '../brands/BrandsScreen';
import { Avatar } from '../HkMarks';
import OwnerChip from '../brands/OwnerChip';
import { hkPost } from '../hkApi';
import { HeatChip, ListButtons } from '../signals/Heat';
import { fmtDate, KIND_LABEL, FIT_LABEL, FIT_TONE, NEXT_LABEL, CHICAGO_LABEL, STATUS_LABEL, REPLY_LABEL, usd } from './inboxPrefs';

// hkos-inbox-v2 L4 / L5, reshaped by hkos-inbox-v2-polish P1 - the intel STRIP over the email: at most two rows, so the
// mail starts right under it. Row 1 = who (brand: name · domain · owner · n of 3 touches · status · reply label · verdict
// pill; a person: name · domain · company · Analyze). Row 2 = one line (the reply summary, or the Analyze one-liner),
// click to open it in place, plus Set status and ⋯ (the rest of the actions). A chevron folds the strip to row 1,
// remembered per browser. Analyze is one click = one Claude call; the cost shown is the server's, never a guess.
const FOLD_KEY = 'prospector_hk_inbox_strip'; // '1' = the strip shows row 1 only (per browser)
const readFolded = () => { try { return localStorage.getItem(FOLD_KEY) === '1'; } catch { return false; } };
const writeFolded = v => { try { localStorage.setItem(FOLD_KEY, v ? '1' : '0'); } catch { /* private mode */ } };
const QUICK = [['meeting', 'Meeting'], ['signed', 'Signed'], ['passed', 'Passed']];

export function IntelBody({ intel }) {
  const c = intel.company || {}, f = intel.fit || {};
  return (
    <div className="hk-intel" data-hk-intel-full>
      {c.what_they_do && <p>{c.what_they_do}</p>}
      <div className="hk-brand__chips">
        {c.category && <Chip tone="lilac">{c.category}</Chip>}
        <Chip tone={c.chicago_presence === 'yes' ? 'green' : 'grey'}>{CHICAGO_LABEL[c.chicago_presence] || CHICAGO_LABEL.unknown}</Chip>
        {c.size_hint && <Chip tone="grey">{c.size_hint}</Chip>}
        {c.hq_city && <Chip tone="grey">{c.hq_city}</Chip>}
      </div>
      {intel.email?.summary && <p className="hk-meta">{intel.email.summary}</p>}
      {f.why && <p className="hk-meta">{FIT_LABEL[f.sponsor_fit] || 'Fit'}: {f.why}</p>}
      {f.challenge_idea && <p className="hk-note">Idea: {f.challenge_idea}</p>}
      {intel.reason && <p className="hk-meta">Next: {intel.reason}</p>}
    </div>
  );
}

function MoreMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!items.length) return null;
  return (
    <span className="hk-more" ref={ref}>
      <button type="button" className="hk-btn hk-more__btn" aria-label="More actions" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(o => !o)} data-hk-more-actions>⋯</button>
      {open && (
        <div role="menu" className="hk-more__menu">
          {items.map(it => <button key={it.key} type="button" role="menuitem" className="hk-btn" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }} {...it.attrs}>{it.label}</button>)}
        </div>
      )}
    </span>
  );
}

const verdictPill = v => (v.ok
  ? <span className="hk-pill hk-pill--green" data-hk-verdict="clear">Clear to draft</span>
  : <span className="hk-pill hk-pill--block" data-hk-verdict={v.reason}>Blocked: {String(v.reason || '').replace(/_/g, ' ')}</span>);

export default function IntelStrip({ businessId, thread, members, meId, canEdit, busy, onOpenBrand, onStatus, onLink, onTrack, onTrackTarget, onIgnore, onUnignore, onAnalyzed }) {
  const [folded, setFolded] = useState(readFolded);
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState({ state: 'idle' });
  const { chip, sender, brand } = thread;
  const fold = () => setFolded(f => { writeFolded(!f); return !f; });
  const chevron = <button type="button" className="hk-btn hk-istrip__chev" aria-expanded={!folded} aria-label={folded ? 'Show the second line' : 'Hide the second line'} onClick={fold} data-hk-strip-toggle>{folded ? '▸' : '▾'}</button>;
  const strip = (kind, row1, row2, muted = false) => (
    <div className={`hk-istrip${muted ? ' hk-istrip--muted' : ''}`} data-hk-intel-strip data-hk-brand-panel={kind} aria-label={`About ${brand?.name || sender.name}`}>
      <div className="hk-istrip__row">{row1}</div>
      {row2 && !folded && <div className="hk-istrip__row">{row2}</div>}
    </div>
  );

  if (brand) {
    const owner = members.find(m => m.user_id === brand.owner_user_id);
    const v = brand.verdict;
    const line = brand.last_reply_summary || (brand.challenge_idea ? `Idea: ${brand.challenge_idea}` : 'No reply logged yet.');
    const menu = [
      { key: 'open', label: 'Open brand page', onClick: () => onOpenBrand(brand.id), attrs: { 'data-hk-open-brand-menu': '' } },
      ...(chip.kind === 'matches' && canEdit ? [{ key: 'link', label: `Link this thread to ${brand.name}`, onClick: onLink, disabled: busy, attrs: { 'data-hk-link-brand': '' } }] : []),
    ];
    return strip(chip.kind, <>
      {chevron}
      <span className="hk-istrip__facts">
        <button type="button" className="hk-btn hk-link hk-istrip__name" onClick={() => onOpenBrand(brand.id)} data-hk-open-brand>{brand.name}</button>
        <span className="hk-meta">{brand.domain || 'no domain'}</span>
        {owner ? <span className="hk-istrip__owner"><Avatar name={owner.first_name} index={owner.palette_index || 1} size={20} />{owner.first_name}</span> : <OwnerChip hint={brand.owner_hint} />}
        <span className="hk-meta">{brand.touch_count} of {brand.max_email_touches || 3} touches{brand.last_touch_at ? ` · last ${fmtDate(brand.last_touch_at)}` : ''}</span>
        <HeatChip band={brand.heat_band} />
        <Chip tone={chip.kind === 'tracked' ? 'green' : 'blue'}>{STATUS_LABEL[brand.status] || brand.status}</Chip>
        {brand.last_reply_label && <Chip tone="lilac">{REPLY_LABEL[brand.last_reply_label] || brand.last_reply_label}</Chip>}
        {v && verdictPill(v)}
      </span>
    </>, <>
      <button type="button" className={`hk-btn hk-istrip__line${open ? ' hk-istrip__line--open' : ''}`} aria-expanded={open} onClick={() => setOpen(o => !o)} data-hk-reply-summary>{line}</button>
      <span className="hk-istrip__push">
        {canEdit && (
          <select className="hk-istrip__status" aria-label="Set status" value="" disabled={busy} onChange={e => e.target.value && onStatus(brand.id, e.target.value)} data-hk-set-status>
            <option value="">Set status</option>
            {QUICK.map(([s, l]) => <option key={s} value={s} disabled={brand.status === s}>{l}</option>)}
          </select>
        )}
        {brand.relationship === 'prospect' && <ListButtons businessId={businessId} brand={brand} meId={meId} members={members} canEdit={canEdit} compact />}
        <MoreMenu items={menu} />
      </span>
    </>);
  }
  if (chip.kind === 'team' && !thread.team_notice) return strip('team', <span className="hk-meta">Your team.</span>);
  if (chip.kind === 'self') return strip('self', <span className="hk-meta">You{sender.domain ? ` · ${sender.domain}` : ''}. Your own mail.</span>, null, true);
  if (chip.kind === 'calendar') return strip('calendar', <span className="hk-meta">Calendar notification.</span>, null, true);
  if (chip.kind === 'not_tracked' && chip.reason === 'ignored') {
    return strip('ignored', <><span className="hk-meta hk-istrip__facts">You ignore mail from {sender.domain}.</span>
      {canEdit && <span className="hk-istrip__push"><Button size="sm" variant="tertiary" disabled={busy} onClick={onUnignore} data-hk-unignore>Stop ignoring</Button></span>}</>, null, true);
  }
  if (chip.kind === 'not_tracked' || chip.kind === 'team') {
    return strip(chip.kind === 'team' ? 'notice' : 'bulk', <><span className="hk-meta hk-istrip__facts">Marketing / automated mail{sender.domain ? ` from ${sender.domain}` : ''}.</span>
      <span className="hk-istrip__push"><MoreMenu items={canEdit && sender.domain ? [{ key: 'ignore', label: 'Ignore sender', onClick: onIgnore, disabled: busy, attrs: { 'data-hk-ignore-sender': '' } }] : []} /></span></>, null, true);
  }

  const saved = thread.intel;
  const analyze = async confirm => {
    setRun({ state: 'running' });
    try {
      const r = await hkPost(businessId, `/inbox/threads/${thread.thread_id}/analyze`, { click: true, ...(confirm ? { confirm: true } : {}) });
      setRun(r.needs_confirm ? { state: 'confirm', cost: r.cost_usd, at: r.researched_at } : { state: 'done', cost: r.cost_usd });
      onAnalyzed({ intel: r.intel, cost_usd: r.cost_usd, researched_at: r.researched_at, prefill: r.prefill });
    } catch (e) { setRun({ state: 'error', message: e.message }); }
  };
  const cost = run.state === 'done' ? run.cost : saved?.cost_usd;
  const i = saved?.intel;
  const menu = canEdit ? [
    { key: 'track', label: 'Track as brand', onClick: onTrack, disabled: busy, attrs: { 'data-hk-track-brand': '' } },
    { key: 'track_target', label: 'Track as brand + Target', onClick: onTrackTarget, disabled: busy, attrs: { 'data-hk-track-target': '' } },
    ...(sender.domain ? [{ key: 'ignore', label: 'Ignore sender', onClick: onIgnore, disabled: busy, attrs: { 'data-hk-ignore-sender': '' } }] : []),
  ] : [];
  const row2 = run.state === 'confirm'
    ? <p className="hk-istrip__line hk-istrip__line--note" role="status" data-hk-analyze-confirm>Researched {fmtDate(run.at)}. This is the saved card. Analyze again{run.cost != null ? ` for about ${usd(run.cost)}` : ''}?{' '}
      {canEdit && <button type="button" className="hk-btn hk-link" onClick={() => analyze(true)} data-hk-analyze-again>Analyze again</button>}</p>
    : run.state === 'error' ? <p className="hk-istrip__line hk-error" role="alert" data-hk-analyze-error>{run.message}</p>
      : i ? (
        <>
          <button type="button" className={`hk-btn hk-istrip__line${open ? ' hk-istrip__line--open' : ''}`} aria-expanded={open} onClick={() => setOpen(o => !o)} data-hk-intel>
            <strong data-hk-intel-company>{i.company?.name || 'Unknown company'}</strong>
            {' · '}<span data-hk-intel-kind>{KIND_LABEL[i.email?.kind] || 'Other'}{i.email?.urgency === 'high' ? ' (urgent)' : ''}</span>
            {' · '}<span data-hk-intel-fit>{FIT_LABEL[i.fit?.sponsor_fit] || 'Fit unknown'}</span>
            {' · Next: '}<span data-hk-intel-next>{NEXT_LABEL[i.next_step] || 'No action'}</span>
            <span className="hk-meta" data-hk-intel-when> · researched {fmtDate(saved.researched_at)}{saved.cost_usd != null ? ` · ${usd(saved.cost_usd)}` : ''}</span>
          </button>
        </>
      ) : null;
  return (
    <div className="hk-istrip-wrap">
      {strip('untracked', <>
        {(row2 || i) && chevron}
        <span className="hk-istrip__facts">
          <span className="hk-istrip__name">{sender.name}</span>
          {sender.domain && <a className="hk-link hk-meta" href={`https://${sender.domain}`} target="_blank" rel="noopener noreferrer" data-hk-sender-site>{sender.domain}</a>}
          {i ? <Chip tone={FIT_TONE[i.fit?.sponsor_fit] || 'grey'}>{i.company?.name || 'Company'}</Chip> : <span className="hk-meta" data-hk-unknown-company>Unknown company</span>}
          {thread.relayed && <span className="hk-meta">via your group</span>}
        </span>
        <span className="hk-istrip__push">
          {canEdit && sender.domain && (
            <Button size="sm" variant={i ? 'secondary' : 'primary'} disabled={busy || run.state === 'running'} onClick={() => analyze(false)} data-hk-analyze>
              {run.state === 'running' ? 'Analyzing…' : i ? `Analyze again${cost != null ? ` · ${usd(cost)}` : ''}` : 'Analyze'}
            </Button>
          )}
          <MoreMenu items={menu} />
        </span>
      </>, row2)}
      {open && i && !folded && <IntelBody intel={i} />}
    </div>
  );
}
