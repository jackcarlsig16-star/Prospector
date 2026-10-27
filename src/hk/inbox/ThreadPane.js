import React, { useMemo, useState } from 'react';
import Button from '../../ui/Button';
import { Chip } from '../brands/BrandsScreen';
import { sanitizeEmailHtml, frameDoc } from './sanitizeEmail';
import { gmailThreadUrl, fmtDate, CHIP_TONE, STATUS_LABEL, REPLY_LABEL } from './inboxPrefs';

// hkos-inbox-v1 (I2 / I3 middle + right panes). Messages newest at the bottom, older ones collapsed; html renders only
// inside <iframe sandbox=""> (no scripts, no same origin, no forms) from srcdoc the browser sanitized; remote images
// stay blocked until Show images, for this render only. There is no compose box, no Send and no mark-read here.
export const SANDBOX = '';

function Message({ m, open, showImages, onToggle }) {
  const clean = useMemo(() => (open && m.html ? sanitizeEmailHtml(m.html, { showImages }) : ''), [m.html, open, showImages]);
  const who = `${m.is_mine ? 'You' : m.from_name}${!m.is_mine && m.from_domain ? ` · ${m.from_domain}` : ''}`;
  return (
    <article className={`hk-inbox__msg${open ? '' : ' hk-inbox__msg--closed'}`} data-hk-message={m.id}>
      <button type="button" className="hk-btn hk-inbox__msg-head" onClick={onToggle} aria-expanded={open}>
        <span className="hk-inbox__msg-from">{who}</span>
        <span className="hk-meta hk-inbox__msg-to">to {m.to_names.length ? m.to_names.join(', ') : 'nobody'}</span>
        <span className="hk-meta">{fmtDate(m.date)}</span>
      </button>
      {open && (m.html
        ? <iframe className="hk-inbox__frame" title={`Message from ${m.is_mine ? 'you' : m.from_name}`} sandbox={SANDBOX} srcDoc={frameDoc(clean)} data-hk-frame referrerPolicy="no-referrer" />
        : <pre className="hk-pre hk-inbox__text">{m.text || '(no text)'}</pre>)}
      {open && m.attachments.length > 0 && (
        <ul className="hk-inbox__attachments" aria-label="Attachments">{m.attachments.map((a, i) => <li key={i} className="hk-meta">{a.name}{a.size ? ` · ${Math.max(1, Math.round(a.size / 1024))} KB` : ''}</li>)}</ul>
      )}
    </article>
  );
}

export function Messages({ thread, showImages, onShowImages, gmailEmail }) {
  const msgs = thread.messages;
  const [expanded, setExpanded] = useState(() => new Set([msgs[msgs.length - 1]?.id]));
  const [older, setOlder] = useState(false);
  const hasImages = msgs.some(m => m.html && /<(img|picture|video|source)\b/i.test(m.html));
  const shown = older || msgs.length <= 2 ? msgs : msgs.slice(-1);
  const toggle = id => setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="hk-inbox__messages" data-hk-messages>
      {hasImages && !showImages && <p className="hk-strip hk-inbox__strip" data-hk-images-hidden>Images are hidden until you ask. <button type="button" className="hk-btn hk-link" onClick={onShowImages} data-hk-show-images>Show images</button></p>}
      {!older && msgs.length > 2 && <button type="button" className="hk-btn hk-link hk-inbox__older" onClick={() => setOlder(true)} data-hk-older>Show {msgs.length - 1} earlier message{msgs.length - 1 === 1 ? '' : 's'}</button>}
      {shown.map(m => <Message key={m.id} m={m} open={expanded.has(m.id)} showImages={showImages} onToggle={() => toggle(m.id)} />)}
      {gmailEmail && msgs.some(m => m.attachments.length) && <p className="hk-meta">Attachments open in Gmail: <a className="hk-link" href={gmailThreadUrl(gmailEmail, thread.thread_id)} target="_blank" rel="noopener noreferrer">Open in Gmail</a></p>}
    </div>
  );
}

const QUICK = [['meeting', 'Meeting'], ['signed', 'Signed'], ['passed', 'Passed']];

export function BrandPanel({ thread, members, canEdit, busy, onOpenBrand, onStatus, onLink, onTrack, onIgnore, onUnignore }) {
  const { chip, brand, sender } = thread;
  const owner = brand ? members.find(m => m.user_id === brand.owner_user_id) : null;
  if (chip.kind === 'team') return <aside className="hk-inbox__panel" data-hk-brand-panel="team"><p className="hk-meta">Team mail. Nothing to track here.</p></aside>;
  if (brand) {
    const v = brand.verdict;
    return (
      <aside className="hk-inbox__panel" data-hk-brand-panel={chip.kind} aria-label={`Brand ${brand.name}`}>
        <h3 className="hk-inbox__panel-title">{brand.name}</h3>
        <p className="hk-meta">{brand.domain || 'no domain'} · {owner ? owner.first_name : 'Unclaimed'} · {brand.touch_count} touch{brand.touch_count === 1 ? '' : 'es'}</p>
        <div className="hk-brand__chips">
          <Chip tone={chip.kind === 'tracked' ? 'green' : 'blue'}>{STATUS_LABEL[brand.status] || brand.status}</Chip>
          {brand.last_reply_label && <Chip tone="lilac">{REPLY_LABEL[brand.last_reply_label] || brand.last_reply_label}</Chip>}
        </div>
        {v && <p className={`hk-banner ${v.ok ? 'hk-banner--green' : 'hk-banner--block'}`} data-hk-verdict={v.ok ? 'clear' : v.reason}><span className="hk-banner__title">{v.ok ? 'Clear to draft' : `Blocked: ${String(v.reason || '').replace(/_/g, ' ')}`}</span></p>}
        {brand.challenge_idea && <p className="hk-note">Idea: {brand.challenge_idea}</p>}
        <div className="hk-inbox__panel-actions">
          <Button size="sm" variant="primary" onClick={() => onOpenBrand(brand.id)} data-hk-open-brand>Open brand page</Button>
          {chip.kind === 'matches' && canEdit && <Button size="sm" disabled={busy} onClick={onLink} data-hk-link-brand>Link this thread to {brand.name}</Button>}
        </div>
        {canEdit && <div className="hk-inbox__panel-actions" aria-label="Quick status">{QUICK.map(([s, l]) => <Button key={s} size="sm" variant="tertiary" disabled={busy || brand.status === s} onClick={() => onStatus(brand.id, s)}>{l}</Button>)}</div>}
      </aside>
    );
  }
  if (chip.kind === 'not_tracked' && chip.reason === 'ignored') {
    return <aside className="hk-inbox__panel" data-hk-brand-panel="ignored"><p className="hk-meta">You ignore mail from {sender.domain}.</p>{canEdit && <Button size="sm" disabled={busy} onClick={onUnignore} data-hk-unignore>Stop ignoring</Button>}</aside>;
  }
  return (
    <aside className="hk-inbox__panel" data-hk-brand-panel="untracked">
      <h3 className="hk-inbox__panel-title">Not a brand yet</h3>
      <p className="hk-meta">{sender.name}{sender.domain ? ` · ${sender.domain}` : ''}{chip.reason === 'bulk' ? ' · looks like bulk mail' : ''}</p>
      {canEdit && (
        <div className="hk-inbox__panel-actions">
          <Button size="sm" variant="primary" disabled={busy} onClick={onTrack} data-hk-track-brand>Track as brand</Button>
          {sender.domain && <Button size="sm" variant="tertiary" disabled={busy} onClick={onIgnore} data-hk-ignore-sender>Ignore this sender</Button>}
        </div>
      )}
    </aside>
  );
}

export const chipLabel = chip => {
  if (chip.kind === 'tracked') return `Tracked · ${STATUS_LABEL[chip.status] || chip.status || 'brand'}`;
  if (chip.kind === 'matches') return `Matches ${chip.brand_name}`;
  if (chip.kind === 'team') return 'Team';
  if (chip.kind === 'not_tracked') return 'Not tracked';
  return 'New sender';
};
export const chipTone = chip => CHIP_TONE[chip.kind] || 'grey';
