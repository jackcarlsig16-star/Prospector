import React, { useMemo, useState } from 'react';
import { sanitizeEmailHtml, frameDoc } from './sanitizeEmail';
import { gmailThreadUrl, fmtDate, CHIP_TONE, STATUS_LABEL } from './inboxPrefs';

// hkos-inbox-v1 (I2 / I3 middle + right panes). Messages newest at the bottom, older ones collapsed; html renders only
// inside <iframe sandbox=""> (no scripts, no same origin, no forms) from srcdoc the browser sanitized; remote images
// stay blocked until Show images, for this render only. There is no compose box, no Send and no mark-read here.
export const SANDBOX = '';

function Message({ m, open, showImages, onToggle, onShowImages }) {
  const clean = useMemo(() => (open && m.html ? sanitizeEmailHtml(m.html, { showImages }) : ''), [m.html, open, showImages]);
  const who = `${m.is_mine ? 'You' : m.from_name}${!m.is_mine && m.from_domain ? ` · ${m.from_domain}` : ''}`;
  return (
    <article className={`hk-inbox__msg${open ? '' : ' hk-inbox__msg--closed'}`} data-hk-message={m.id}>
      <button type="button" className="hk-btn hk-inbox__msg-head" onClick={onToggle} aria-expanded={open}>
        <span className="hk-inbox__msg-from">{who}</span>
        <span className="hk-meta hk-inbox__msg-to">to {m.to_names.length ? m.to_names.join(', ') : 'nobody'}</span>
        <span className="hk-meta">{fmtDate(m.date)}</span>
      </button>
      {open && m.html && !showImages && /<(img|picture|video|source)\b/i.test(m.html) && (
        <p className="hk-inbox__imgline" data-hk-images-hidden>Images are hidden. <button type="button" className="hk-btn hk-link" onClick={onShowImages} data-hk-show-images>Show images</button></p>
      )}
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
  const shown = older || msgs.length <= 2 ? msgs : msgs.slice(-1);
  const toggle = id => setExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="hk-inbox__messages" data-hk-messages>
      {!older && msgs.length > 2 && <button type="button" className="hk-btn hk-link hk-inbox__older" onClick={() => setOlder(true)} data-hk-older>Show {msgs.length - 1} earlier message{msgs.length - 1 === 1 ? '' : 's'}</button>}
      {shown.map(m => <Message key={m.id} m={m} open={expanded.has(m.id)} showImages={showImages} onToggle={() => toggle(m.id)} onShowImages={onShowImages} />)}
      {gmailEmail && msgs.some(m => m.attachments.length) && <p className="hk-meta">Attachments open in Gmail: <a className="hk-link" href={gmailThreadUrl(gmailEmail, thread.thread_id)} target="_blank" rel="noopener noreferrer">Open in Gmail</a></p>}
    </div>
  );
}

// hkos-inbox-v2-polish P5: "You" (the caller's own accounts) and "Calendar" (Google Calendar notifications).
export const chipLabel = chip => {
  if (chip.kind === 'tracked') return `Tracked · ${STATUS_LABEL[chip.status] || chip.status || 'brand'}`;
  if (chip.kind === 'matches') return `Matches ${chip.brand_name}`;
  if (chip.kind === 'team') return 'Team';
  if (chip.kind === 'self') return 'You';
  if (chip.kind === 'calendar') return 'Calendar';
  if (chip.kind === 'not_tracked') return 'Not tracked';
  return 'New sender';
};
export const chipTone = chip => CHIP_TONE[chip.kind] || 'grey';
