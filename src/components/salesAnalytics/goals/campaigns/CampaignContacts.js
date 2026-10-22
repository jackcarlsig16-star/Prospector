import { useMemo, useState } from 'react';
import { SA } from '../../theme';
import DataTable from '../../../../ui/DataTable';
import DetailList from '../../../../ui/DetailList';
import FilterSelect from '../../../../ui/FilterSelect';
import Button from '../../../../ui/Button';
import Tag from '../../../../ui/Tag';
import { md } from '../../tasks/TaskRow';
import { laDay } from '../../huddleView';
import { numStyle } from '../goalsUi';
import ContactActions from './ContactActions';
import {
  CONTACT_STATUS, CONTACT_STATUS_COLOR, SEGMENT_LABEL, WARMTH_LABEL, LINK_LABEL, EMPTY_FILTERS, DUE_OPTIONS,
  activeFilterCount, filterContacts, contactLink,
} from './campaignModel';

// seif-campaign-v1 B7 - one campaign's people: filters (track, owner, status,
// due), the kit table with its row detail, and each person's buttons for
// Members. No address anywhere - the server never sends one.
const rowBar = { height: 36, display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', overflowY: 'hidden', flexWrap: 'nowrap', minWidth: 0 };
const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' };
const Dim = () => <span className="ui-table__dim">—</span>;
const day = d => (!d ? null : String(d).length > 10 ? md(laDay(d)) : md(d));

export default function CampaignContacts({ contacts, tracks, steps, today, canEdit, phone, members, lookup, onAct, onCopy, onOpenCompany }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const shown = useMemo(() => filterContacts(contacts, filters, today), [contacts, filters, today]);
  const trackName = id => tracks.find(t => t.id === id)?.name || null;
  const n = activeFilterCount(filters);
  const owners = [...new Set(contacts.map(c => c.owner_user_id).filter(Boolean))];

  const statusCell = c => <Tag color={CONTACT_STATUS_COLOR[c.status]}>{CONTACT_STATUS[c.status] || c.status}</Tag>;
  const companyCell = c => {
    const link = contactLink(c);
    if (!c.company) return <Dim />;
    return link ? <button type="button" className="ui-link ui-link--cell" title={`Open ${c.company}`} onClick={() => onOpenCompany(c, link)}>{c.company}</button> : <span style={ellipsis}>{c.company}</span>;
  };
  const stepText = c => (c.status === 'active' || c.status === 'queued' ? `${c.current_step} of ${steps(c.track_id) || '?'}` : null);
  const columns = [
    { id: 'name', label: 'Name', width: 160, sticky: true, detail: true, sortValue: c => c.name, render: c => <span style={{ ...ellipsis, fontWeight: 500 }}>{c.name}</span>, title: c => c.name },
    { id: 'title', label: 'Title', width: 140, sortValue: c => c.title, render: c => (c.title ? <span style={{ ...ellipsis, color: SA.soft }}>{c.title}</span> : <Dim />), title: c => c.title },
    { id: 'company', label: 'Company', width: 150, sortValue: c => c.company, render: companyCell, title: c => c.company },
    { id: 'track', label: 'Track', width: 170, sortValue: c => trackName(c.track_id), render: c => (c.track_id ? <span style={ellipsis}>{trackName(c.track_id)}</span> : <span style={{ color: SA.warn }}>No track</span>), title: c => trackName(c.track_id) },
    { id: 'owner', label: 'Owner', width: 80, sortValue: c => (c.owner_user_id ? lookup(c.owner_user_id).first : null), render: c => (c.owner_user_id ? lookup(c.owner_user_id).first : <Dim />) },
    { id: 'status', label: 'Status', width: 120, sortValue: c => CONTACT_STATUS[c.status], render: statusCell },
    { id: 'step', label: 'Step', width: 56, sortValue: c => c.current_step, render: c => <span style={numStyle}>{stepText(c) || '—'}</span> },
    { id: 'due', label: 'Next due', width: 76, sortValue: c => c.next_due_date, render: c => <span style={{ ...numStyle, color: c.next_due_date && c.next_due_date < today ? SA.bad : SA.text }}>{c.next_due_date ? (c.next_due_date === today ? 'Today' : day(c.next_due_date)) : '—'}</span> },
    { id: 'sent', label: 'Last sent', width: 76, sortValue: c => c.last_sent_at, render: c => <span style={numStyle}>{day(c.last_sent_at) || '—'}</span> },
    { id: 'replied', label: 'Replied', width: 70, sortValue: c => c.replied_at, render: c => <span style={numStyle}>{day(c.replied_at) || '—'}</span> },
    ...(canEdit ? [{ id: 'actions', label: 'Actions', width: 250, stickyEnd: true, render: c => <span role="group" aria-label={`Actions for ${c.name}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}>
      <ContactActions contact={c} members={members} lookup={lookup} onAct={(a, b) => onAct(c, a, b)} onCopy={() => onCopy(c)} /></span> }] : []),
  ];
  const renderDetail = c => {
    const link = contactLink(c);
    return (
      <DetailList data-contact-detail rows={[
        ['Person', [c.name, c.title, c.company].filter(Boolean).join(' · ')],
        ['Segment', [SEGMENT_LABEL[c.segment], WARMTH_LABEL[c.warmth]].filter(Boolean).join(' · ') || 'Not set - the import had no segment / warmth'],
        ['Track', trackName(c.track_id)],
        ['Heads-up', c.conflict],
        ['In Pipeline', link && <span className="ui-detail-list__actions"><span>{LINK_LABEL[link.type]}</span><button type="button" className="ui-link" onClick={() => onOpenCompany(c, link)}>Open company →</button></span>],
        ['Notes', c.notes],
        ['From the sheet', c.import_row ? `row ${c.import_row} · email on file` : 'email on file'],
      ]} />
    );
  };
  const compactRow = c => (
    <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>{statusCell(c)}<span style={{ ...ellipsis, fontWeight: 500 }}>{c.name}</span></span>
      <span style={{ fontSize: 12, color: SA.muted, ...ellipsis }}>{[c.title, c.company, trackName(c.track_id)].filter(Boolean).join(' · ')}</span>
      <span style={{ fontSize: 12, color: SA.soft, ...numStyle }}>{[stepText(c) && `step ${stepText(c)}`, c.next_due_date && `due ${c.next_due_date === today ? 'today' : day(c.next_due_date)}`, c.last_sent_at && `sent ${day(c.last_sent_at)}`].filter(Boolean).join(' · ')}</span>
      {canEdit && <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}><ContactActions contact={c} members={members} lookup={lookup} onAct={(a, b) => onAct(c, a, b)} onCopy={() => onCopy(c)} /></span>}
    </div>
  );
  return (
    <section aria-label="Campaign contacts" data-campaign-contacts style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div role="group" aria-label="Filters" data-filter-row style={rowBar}>
        <FilterSelect label="Track" value={filters.track} onChange={v => set('track', v)} options={[{ value: '', label: 'All' }, ...tracks.map(t => ({ value: t.id, label: t.name }))]} />
        <FilterSelect label="Owner" value={filters.owner} onChange={v => set('owner', v)} options={[{ value: '', label: 'All' }, ...owners.map(o => ({ value: o, label: lookup(o).first }))]} />
        <FilterSelect label="Status" value={filters.status} onChange={v => set('status', v)} options={[{ value: '', label: 'All' }, ...Object.entries(CONTACT_STATUS).map(([value, label]) => ({ value, label }))]} />
        <FilterSelect label="Due" value={filters.due} onChange={v => set('due', v)} options={[{ value: '', label: 'Any' }, ...DUE_OPTIONS.map(([value, label]) => ({ value, label }))]} />
        <input type="search" className="ui-input ui-input--sm" aria-label="Search contacts" placeholder="Search" value={filters.q} onChange={e => set('q', e.target.value)} style={{ width: 150 }} />
        {n > 0 && <Button variant="tertiary" onClick={() => setFilters(EMPTY_FILTERS)}>Clear ({n})</Button>}
      </div>
      <div className="ui-theme-dark">
        <DataTable label="Campaign contacts" columns={columns} rowKey={c => c.id} compact={phone} renderCompact={compactRow} renderDetail={renderDetail}
          groups={[{ id: 'all', header: <>{n ? 'Filtered' : 'Everyone'} <span className="ui-table__count">{shown.length}</span></>, rows: shown, emptyText: contacts.length ? 'Nobody matches these filters.' : 'No contacts yet - import a sheet.' }]}
          dense pinUnder="[data-workspace-header]" emptyText="No contacts yet." />
      </div>
    </section>
  );
}
