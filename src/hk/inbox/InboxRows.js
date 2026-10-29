import React from 'react';
import Button from '../../ui/Button';
import { Chip } from '../brands/BrandsScreen';
import { chipLabel, chipTone } from './ThreadPane';
import { fmtDate, REPLY_LABEL, FIT_LABEL, FIT_TONE } from './inboxPrefs';

// hkos-inbox-v2 L6 - a Needs you / Brands / Sent / Drafts row: sender + company chip + date, then subject + snippet,
// the unread dot, the reply label and "Analyzed · <fit>" when the domain has intel.
export function ThreadRow({ t, on, onOpen }) {
  const dim = t.chip.kind === 'not_tracked';
  return (
    <li>
      <button type="button" className={`hk-btn hk-inbox__row${on ? ' hk-inbox__row--on' : ''}${dim ? ' hk-inbox__row--dim' : ''}${t.unread ? ' hk-inbox__row--unread' : ''}`}
        aria-current={on ? 'true' : undefined} onClick={() => onOpen(t.thread_id)} data-hk-thread={t.thread_id} data-hk-lane={t.lane}>
        <span className="hk-inbox__row-top">
          {t.unread && <span className="hk-inbox__dot" aria-label="Unread" />}
          <span className="hk-inbox__from">{t.from_name}</span>
          {t.from_hint && t.from_hint !== t.from_name && <span className="hk-meta hk-inbox__hint">{t.from_hint}</span>}
          <span className="hk-meta hk-inbox__date">{fmtDate(t.date)}</span>
        </span>
        <span className="hk-inbox__line"><span className="hk-inbox__subject">{t.subject}</span><span className="hk-meta hk-inbox__snippet"> {t.snippet}</span></span>
        <span className="hk-inbox__chips">
          {dim ? <span className="hk-meta">Not tracked</span> : <Chip tone={chipTone(t.chip)}>{chipLabel(t.chip)}</Chip>}
          {t.chip.kind === 'tracked' && t.chip.label && <Chip tone="lilac">{REPLY_LABEL[t.chip.label] || t.chip.label}</Chip>}
          {t.intel_fit && <Chip tone={FIT_TONE[t.intel_fit] || 'grey'}><span data-hk-row-intel>Analyzed · {FIT_LABEL[t.intel_fit] || t.intel_fit}</span></Chip>}
          {t.has_attachments && <span className="hk-meta">Attachment</span>}
        </span>
      </button>
    </li>
  );
}

// hkos-inbox-v2 L1 - Other: one group per sender domain (the sender name when there is no domain), newest group first,
// a count, Ignore sender on the group, and compact one-line rows.
export function groupOther(rows) {
  const groups = new Map();
  for (const t of rows) {
    const key = t.from_domain || `name:${t.from_name}`;
    if (!groups.has(key)) groups.set(key, { key, domain: t.from_domain || null, name: t.from_name, rows: [] });
    groups.get(key).rows.push(t);
  }
  return [...groups.values()];
}

export function OtherGroups({ groups, openId, onOpen, canEdit, busy, onIgnore }) {
  return groups.map(g => (
    <li key={g.key} className="hk-inbox__group" data-hk-group={g.domain || g.name}>
      <div className="hk-inbox__group-head">
        <span className="hk-inbox__from">{g.name}</span>
        <span className="hk-meta">· {g.rows.length}</span>
        {g.domain && g.domain !== g.name && <span className="hk-meta hk-inbox__hint">{g.domain}</span>}
        {canEdit && g.domain && <Button size="sm" variant="tertiary" disabled={busy} onClick={() => onIgnore(g.domain)} data-hk-ignore-group={g.domain}>Ignore sender</Button>}
      </div>
      <ul className="hk-inbox__rows">
        {g.rows.map(t => (
          <li key={t.thread_id}>
            <button type="button" className={`hk-btn hk-inbox__row hk-inbox__row--compact${t.thread_id === openId ? ' hk-inbox__row--on' : ''}${t.unread ? ' hk-inbox__row--unread' : ''}`}
              aria-current={t.thread_id === openId ? 'true' : undefined} onClick={() => onOpen(t.thread_id)} data-hk-thread={t.thread_id} data-hk-lane={t.lane}>
              <span className="hk-inbox__subject">{t.subject}</span>
              <span className="hk-meta hk-inbox__date">{fmtDate(t.date)}</span>
            </button>
          </li>
        ))}
      </ul>
    </li>
  ));
}
