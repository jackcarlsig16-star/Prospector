import React from 'react';
import Button from '../../ui/Button';
import { Icon } from '../HkMarks';
import InboxScreen from '../screens/InboxScreen';
import RepliesScreen from '../screens/RepliesScreen';
import DraftsScreen from '../screens/DraftsScreen';
import ActiveFilters from '../nav/ActiveFilters';
import { MAIL_LANES, REPLY_ITEMS, DRAFT_ITEMS } from '../nav/filterState';

// grow-nav-filters-v1 N4 / N5 - the Inbox space: the rail picks ONE thing - a lane of your own Gmail (live, the lanes
// the Inbox already has), Tracked replies (the old Replies screen, workspace data under the owner toggle) or Queued
// drafts (the old Drafts screen). Gmail lanes and the database lists never mix in one list.
const LINES = { lane: 'Your own HumanKind Gmail, read live. Only you see it.', replies: 'Brands that wrote back, labeled and summarized.', drafts: 'Drafts waiting in Gmail to send. Nothing is sent from here.' };
const nameOf = (list, v) => list.find(([id]) => id === v)?.[1] || v;
const titleOf = sel => (sel.kind === 'lane' ? 'Inbox' : sel.kind === 'replies' ? 'Tracked replies' : 'Queued drafts');
export const selLabel = sel => (sel.kind === 'lane' ? `My mail: ${nameOf(MAIL_LANES, sel.value)}` : sel.kind === 'replies' ? `Tracked replies: ${nameOf(REPLY_ITEMS, sel.value)}` : `Queued drafts: ${nameOf(DRAFT_ITEMS, sel.value)}`);

export default function InboxSpace({ sel, setSel, savedName, onSaveView, onOpenFilters, onCountsChanged, onLaneCounts, owner, canEdit, compact, ...inbox }) {
  const chips = sel.kind === 'lane' && sel.value === 'briefing' ? [] : [{ key: 'sel', label: selLabel(sel), onRemove: () => setSel({ kind: 'lane', value: 'briefing' }) }];
  return (
    <div data-hk-inbox-space={sel.kind}>
      <header className="hk-space__head">
        <div><h1 className="hk-head__title">{savedName || titleOf(sel)}</h1><p className="hk-head__line">{LINES[sel.kind]}</p></div>
        <span className="hk-spacer" />
        {compact && <Button size="sm" onClick={onOpenFilters} data-hk-open-filters><Icon name="filter" size={16} /> Filters</Button>}
      </header>
      {sel.kind !== 'lane' && <ActiveFilters chips={chips} count="" savedAs={savedName} onClear={() => setSel({ kind: 'lane', value: 'briefing' })} onSave={onSaveView} />}
      {sel.kind === 'replies'
        ? <RepliesScreen businessId={inbox.businessId} shell={inbox.shell} owner={owner} compact={compact} onOpenBrand={inbox.onOpenBrand} filter={sel.value} openId={sel.reply} canEdit={canEdit} onChanged={onCountsChanged} />
        : sel.kind === 'drafts'
          ? <DraftsScreen businessId={inbox.businessId} shell={inbox.shell} compact={compact} onOpenBrand={inbox.onOpenBrand} filter={sel.value} owner={owner} canEdit={canEdit} onChanged={onCountsChanged} />
          : <InboxScreen {...inbox} owner={owner} canEdit={canEdit} compact={compact} lane={sel.value} onLane={v => setSel({ kind: 'lane', value: v })} onLaneCounts={onLaneCounts} />}
    </div>
  );
}
