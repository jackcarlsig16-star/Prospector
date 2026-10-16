import React, { useState } from 'react';
import { ui } from './kitTheme';
import { KIT_DARK, KIT_LIGHT, KIT_MAX_WIDTH, KIT_SPACE, KIT_TYPE, KIT_TABLE } from './tokens';
import PageHeader from './PageHeader';
import Card from './Card';
import SectionLabel from './SectionLabel';
import Button, { ButtonRow } from './Button';
import Field from './Field';
import StatusPill from './StatusPill';
import ToggleRow from './ToggleRow';
import DataTable from './DataTable';

// Invented companies, no contacts.
const TABLE_ROWS = [
  { id: 'a1', band: 'live', name: 'Northwind Benefits', stage: 'Replied', tier: 1, due: '2026-10-21', next: 'Send the pilot outline' },
  { id: 'a2', band: 'live', name: 'Lakeshore Mutual', stage: 'Meeting set', tier: 2, due: '2026-10-18', next: 'Confirm attendees' },
  { id: 'a3', band: 'live', name: 'Blue Harbor Brokers', stage: 'Proposal / pilot', tier: 1, due: null, next: null },
  { id: 'b1', band: 'parked', name: 'Old Mill Union', stage: 'Paused', tier: null, due: null, next: 'Revisit in Q1' },
];
const TABLE_COLUMNS = [
  { id: 'name', label: 'Company', width: 180, sticky: true, sortValue: r => r.name, render: r => r.name, title: r => r.name },
  { id: 'stage', label: 'Stage', width: 130, sortValue: r => r.stage, render: r => r.stage },
  { id: 'tier', label: 'Tier', width: 60, sortValue: r => r.tier, render: r => (r.tier ? `T${r.tier}` : <span className="ui-table__dim">—</span>) },
  { id: 'next', label: 'Next step', minWidth: 160, sortValue: r => r.next, render: r => r.next || <span className="ui-table__dim">—</span>, title: r => r.next },
  { id: 'due', label: 'Due', width: 90, sortValue: r => r.due, render: r => r.due || <span className="ui-table__dim">—</span> },
];
const BAND_COLOR = { live: ui.good, parked: ui.off };

function ThemePanel({ theme }) {
  const [toggles, setToggles] = useState({ voice: true, meetings: false });
  const [parkedOpen, setParkedOpen] = useState(false);
  const tableGroups = [
    { id: 'live', header: <>Live <span className="ui-table__count">3</span></>, icon: <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: ui.good }} />, rows: TABLE_ROWS.filter(r => r.band === 'live') },
    { id: 'parked', header: <>Parked <span className="ui-table__count">1</span></>, icon: <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: ui.off }} />, rows: TABLE_ROWS.filter(r => r.band === 'parked'), collapsed: !parkedOpen, onToggle: () => setParkedOpen(o => !o) },
  ];
  const values = theme === 'light' ? KIT_LIGHT : KIT_DARK;
  const p = theme;
  return (
    <div className={`ui-theme-${theme}`} data-theme-panel={theme} style={{ background: ui.ground, borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <SectionLabel>{theme}</SectionLabel>
      <Card title="Buttons" subtitle="primary · secondary · ghost · danger, then disabled">
        <ButtonRow align="start">
          <Button variant="primary">Save</Button>
          <Button>Preview</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Disconnect</Button>
        </ButtonRow>
        <div style={{ height: 12 }} />
        <ButtonRow align="start">
          <Button variant="primary" disabled>Save</Button>
          <Button disabled>Preview</Button>
          <Button variant="ghost" disabled>Cancel</Button>
          <Button variant="danger" disabled>Disconnect</Button>
        </ButtonRow>
      </Card>
      <Card title="Status" subtitle="glyph + label on every pill">
        <ButtonRow align="start">
          <StatusPill status="ok">Connected</StatusPill>
          <StatusPill status="warn">Stale</StatusPill>
          <StatusPill status="bad">Reconnect</StatusPill>
          <StatusPill status="off">Not connected</StatusPill>
        </ButtonRow>
      </Card>
      <Card title="Fields" subtitle="label · control · hint or error">
        <div style={{ display: 'grid', gap: 16 }}>
          <Field label="Workspace name" htmlFor={`${p}-name`} hint="Shown in the sidebar and on every page.">
            <input id={`${p}-name`} className="ui-input" defaultValue="HomeLover" />
          </Field>
          <Field label="Default owner" htmlFor={`${p}-owner`}>
            <select id={`${p}-owner`} className="ui-input" defaultValue="jack"><option value="jack">Jack</option><option value="cyrus">Cyrus</option></select>
          </Field>
          <Field label="Sample" htmlFor={`${p}-sample`} error="Paste at least 3 emails.">
            <textarea id={`${p}-sample`} className="ui-input" rows={3} placeholder="Paste sent emails here" />
          </Field>
          <Field label="Read only" htmlFor={`${p}-ro`}>
            <input id={`${p}-ro`} className="ui-input" defaultValue="Viewer sees this, cannot change it" disabled />
          </Field>
        </div>
      </Card>
      <Card title="Workspace features" subtitle="ToggleRow - one-line help on hover" footer={<ButtonRow><Button variant="ghost">Reset</Button><Button variant="primary">Save</Button></ButtonRow>}>
        <ToggleRow label="Voice from Outlook" help="Lets members learn their Voice Profile from Outlook Sent Items." checked={toggles.voice} onChange={v => setToggles(t => ({ ...t, voice: v }))} />
        <ToggleRow label="Meetings from Outlook" help="Counts held / booked meetings from the Outlook calendar." checked={toggles.meetings} onChange={v => setToggles(t => ({ ...t, meetings: v }))} />
        <ToggleRow label="Disabled (viewer)" checked disabled />
      </Card>
      <Card title="DataTable" subtitle={`sticky header + first column · sort asc → desc → off per group · ${KIT_TABLE.rowHeight}px rows`}>
        <DataTable label={`${theme} table`} columns={TABLE_COLUMNS} groups={tableGroups} rowKey={r => r.id}
          rowStyle={r => ({ '--ui-row-tint': `color-mix(in srgb, ${BAND_COLOR[r.band]} 6%, transparent)`, '--ui-row-bar': BAND_COLOR[r.band] })} />
      </Card>
      <Card title="Tokens" subtitle={`spacing ${KIT_SPACE.join(' / ')} · content max-width ${KIT_MAX_WIDTH}px`}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {KIT_SPACE.map(s => <div key={s} style={{ textAlign: 'center' }}><div style={{ width: s, height: s, background: ui.accent, borderRadius: 2, margin: '0 auto 4px' }} /><span style={{ ...KIT_TYPE.label, color: ui.muted }}>{s}</span></div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
          {Object.entries(values).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, background: ui[k], border: `1px solid ${ui.border}`, flexShrink: 0 }} />
              <span style={{ ...KIT_TYPE.small, fontSize: 12, color: ui.soft, overflow: 'hidden', textOverflow: 'ellipsis' }}>{k} <span style={{ color: ui.muted }}>{v}</span></span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default function UiKitGallery() {
  return (
    <div data-ui-gallery style={{ maxWidth: KIT_MAX_WIDTH, margin: '0 auto', minWidth: 0 }}>
      <PageHeader title="UI kit" subtitle="shell-facelift-v1 · every component, dark and light" actions={<><Button>Secondary</Button><Button variant="primary">Primary</Button></>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', gap: 16 }}>
        <ThemePanel theme="dark" />
        <ThemePanel theme="light" />
      </div>
    </div>
  );
}
