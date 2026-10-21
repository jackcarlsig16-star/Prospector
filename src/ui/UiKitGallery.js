import React, { useState } from 'react';
import { ui } from './kitTheme';
import { KIT_DARK, KIT_LIGHT, KIT_MAX_WIDTH, KIT_SPACE, KIT_TYPE, KIT_TABLE, KIT_PRIORITY } from './tokens';
import PageHeader from './PageHeader';
import Card from './Card';
import SectionLabel from './SectionLabel';
import Button, { ButtonRow, Link } from './Button';
import Field from './Field';
import StatusPill from './StatusPill';
import ToggleRow from './ToggleRow';
import DataTable from './DataTable';
import Drawer from './Drawer';
import Segmented from './Segmented';
import Tabs from './Tabs';
import Tag from './Tag';
import FilterSelect from './FilterSelect';
import { ToggleChip, ActiveFilterChip, Group } from './Chip';

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
const TABS = [{ id: 'dashboard', label: 'Dashboard' }, { id: 'pipeline', label: 'Pipeline' }, { id: 'actions', label: 'Actions' }, { id: 'marketing', label: 'Marketing', disabled: true, note: 'Coming soon' }];
const VIEWS = [{ id: 'companies', label: 'Companies' }, { id: 'people', label: 'People' }, { id: 'partners', label: 'Partner workflow', meta: 12 }];
const CHANNELS = [['call_note', 'Call notes', 12], ['import', 'Imports', 40], ['referral', 'Referrals', 3], ['scout', 'Scout', 7]];
const OWNERS = [{ value: 'all', label: 'Everyone' }, { value: 'jack', label: 'Jack' }, { value: 'cyrus', label: 'Cyrus' }];
const STAGES = [{ value: 'all', label: 'Any stage' }, { value: 'replied', label: 'Replied' }, { value: 'meeting', label: 'Meeting set' }];
const PRIORITIES = [{ value: '', label: '—' }, ...['P1', 'P2', 'P3', 'P4'].map(p => ({ value: p, label: p }))];

// ui-clarity-v1 Stage 1 - the pre-Stage-1 sales-module values, kept only so the
// Roles section can draw each role the way the screens draw it today (the
// "before" column). Not tokens: nothing else may import these.
const OLD = { surface: '#12161B', surface2: '#171C22', inset: '#0F1317', border: '#232A33', text: '#E9ECF0', muted: '#8B95A3', faint: '#5E6773', accent: '#8FA8FF', neutral: '#4A5462', warn: '#F2B544', link: '#AFC0FF' };
const sans = { fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif" };
const oldMono = { fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.08em' };
const oldPill = on => ({ ...sans, display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 999, fontSize: 13, border: `1px solid ${on ? OLD.accent : OLD.border}`, background: on ? OLD.surface2 : 'transparent', color: on ? OLD.text : OLD.muted, whiteSpace: 'nowrap' });
const oldTab = on => ({ ...sans, display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 14px', borderRadius: 7, fontSize: 13, background: on ? OLD.surface : 'transparent', color: on ? OLD.text : OLD.muted, whiteSpace: 'nowrap' });
const oldSeg = on => ({ ...sans, display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 12px', borderRadius: 7, fontSize: 13, fontWeight: 500, background: on ? OLD.surface : 'transparent', color: on ? OLD.text : OLD.muted, boxShadow: on ? `0 0 0 1px ${OLD.border}` : 'none', whiteSpace: 'nowrap' });
const oldSelect = { ...sans, display: 'inline-flex', alignItems: 'center', height: 30, padding: '0 8px', borderRadius: 8, fontSize: 13, border: `1px solid ${OLD.border}`, background: OLD.inset, color: OLD.text, whiteSpace: 'nowrap' };
const oldBtn = (kind, disabled) => ({ ...sans, display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 12px', borderRadius: 8, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', opacity: disabled ? 0.45 : 1,
  ...(kind === 'primary' ? { background: OLD.accent, color: '#0B0D10' } : kind === 'secondary' ? { background: OLD.surface2, color: OLD.text, border: `1px solid ${OLD.border}` } : { background: 'transparent', color: OLD.muted }) });
const oldTypeChip = (color, wash) => ({ ...sans, display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 999, fontSize: 11, fontWeight: 500, letterSpacing: '0.02em', color, border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`, background: wash ? `color-mix(in srgb, ${color} 10%, transparent)` : 'transparent', whiteSpace: 'nowrap' });
const oldGroupBox = { display: 'inline-flex', alignItems: 'center', background: OLD.surface2, border: `1px solid ${OLD.border}`, borderRadius: 10, padding: 3 };
const oldRow = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };

// Static drawings of today's look: nothing here is a control.
function Before({ role }) {
  switch (role) {
    case 'R1': return (
      <div style={oldRow}>
        <span style={oldGroupBox}><span style={{ ...oldMono, color: OLD.muted, padding: '0 8px 0 6px' }}>Sales</span><span style={oldTab(true)}>Dashboard</span><span style={oldTab(false)}>Pipeline</span><span style={oldTab(false)}>Actions</span></span>
        <span style={oldGroupBox}><span style={{ ...oldTab(false), color: OLD.faint }}>Marketing <span style={{ ...oldMono, fontSize: 10, marginLeft: 6 }}>Coming soon</span></span></span>
      </div>);
    case 'R2': return (
      <span style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 8, border: `1px solid ${OLD.border}`, background: OLD.inset }}>
        <span style={oldSeg(true)}>Companies</span><span style={oldSeg(false)}>People</span><span style={oldSeg(false)}>Partner workflow <span style={{ color: OLD.muted }}>12</span></span>
      </span>);
    case 'R3': return <div style={oldRow}>{CHANNELS.map(([id, label, n], i) => <span key={id} style={oldPill(i === 0)}>{label}<span style={{ minWidth: '3ch', textAlign: 'right', color: OLD.muted, fontVariantNumeric: 'tabular-nums' }}>{n}</span></span>)}</div>;
    case 'R4': return (
      <div style={oldRow}>
        <span style={oldSelect}>All owners ▾</span><span style={oldSelect}>Any stage ▾</span><span style={oldPill(true)}>Visited 7 d</span><span style={oldPill(false)}>Has open to-do</span><span style={{ ...sans, fontSize: 13, color: OLD.muted }}>Clear</span>
      </div>);
    case 'R5': return (
      <div style={oldRow}>
        <span style={oldTypeChip(OLD.accent, true)}>Employer</span><span style={oldTypeChip(OLD.neutral, false)}>Target</span><span style={oldTypeChip(OLD.faint, false)}>Visitor</span>
        <span style={{ ...oldSelect, height: 26, fontSize: 12, padding: '0 4px' }}>P2 · This week ▾</span>
        <span style={{ ...sans, display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: 999, background: OLD.accent, color: OLD.text, fontSize: 12 }}>Meeting set <span style={{ background: '#FFFFFF', color: OLD.accent, borderRadius: 999, minWidth: 18, textAlign: 'center', fontWeight: 700, fontSize: 11 }}>3</span></span>
        <span style={{ fontSize: 15, color: OLD.faint }}>☆</span>
      </div>);
    case 'R6': return (
      <div style={oldRow}>
        <span style={oldBtn('primary')}>Next: Pilot / proposal</span><span style={oldBtn('secondary')}>Add note</span><span style={oldBtn('ghost')}>Cancel</span><span style={oldBtn('secondary', true)}>Mark contacted</span>
        <span style={{ ...sans, fontSize: 13, color: OLD.text }}>Open the report ↓</span><span style={{ ...sans, fontSize: 13, color: OLD.link }}>uic0.example.com</span>
      </div>);
    default: return (
      <div style={oldRow}>
        <span style={oldPill(true)}>All <span style={{ color: OLD.muted }}>62</span></span><span style={oldPill(false)}>Call notes <span style={{ color: OLD.muted }}>12</span></span><span style={oldPill(false)}>Imports <span style={{ color: OLD.muted }}>40</span></span>
        <span style={{ ...sans, fontSize: 12, color: OLD.faint }}>(no label - which row is this?)</span>
      </div>);
  }
}

const ROLES = [
  ['R1', 'Main tabs', 'text tabs, 3 px underline: accent + bold when selected; disabled = dashed edge + "Coming soon"'],
  ['R2', 'View switch', 'segmented: pressed = solid light fill + dark text; unpressed keeps a visible edge'],
  ['R3', 'Channel buttons', 'one labelled group; on = accent fill + dark text; counts in tabular numbers'],
  ['R4', 'Filters', 'labelled dropdowns that show their value; an active filter is an accent-outlined chip with ×; Clear is a text link'],
  ['R5', 'Status chips', 'filled wash + dot + label, no border, no pointer - never a button; priority is a labelled select'],
  ['R6', 'Buttons', 'primary · secondary · tertiary (underlined link) · danger · disabled = no fill, dashed 3:1 edge, not-allowed'],
  ['R7', 'Group labels', 'every row of controls carries a short label'],
];

function After({ role, state, set }) {
  switch (role) {
    case 'R1': return <Tabs label="Sales" items={TABS} value={state.tab} onChange={v => set({ tab: v })} />;
    case 'R2': return <Segmented label="Pipeline views" items={VIEWS} value={state.view} onChange={v => set({ view: v })} />;
    case 'R3': return <Group label="Channel">{CHANNELS.map(([id, label, n]) => <ToggleChip key={id} pressed={state.channel === id} count={n} onClick={() => set({ channel: id })}>{label}</ToggleChip>)}</Group>;
    case 'R4': return (
      <Group label="Filters">
        <FilterSelect label="Owner" value={state.owner} options={OWNERS} onChange={v => set({ owner: v })} />
        <FilterSelect label="Stage" value={state.stage} options={STAGES} onChange={v => set({ stage: v })} />
        {state.owner !== 'all' && <ActiveFilterChip onRemove={() => set({ owner: 'all' })}>Owner: {OWNERS.find(o => o.value === state.owner).label}</ActiveFilterChip>}
        <Button variant="tertiary" onClick={() => set({ owner: 'all', stage: 'all' })}>Clear</Button>
      </Group>);
    case 'R5': return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Group label="Stage"><Tag color={ui.good}>Meeting set</Tag><Tag color={ui.warn}>Waiting</Tag><Tag color={ui.off}>Not started</Tag><Tag color={ui.bad}>Lost</Tag></Group>
        <Group label="Priority">{Object.keys(KIT_PRIORITY).map(p => <Tag key={p} color={ui[`prio${p}`]}>{p}</Tag>)}<FilterSelect label="Priority" value={state.priority} options={PRIORITIES} onChange={v => set({ priority: v })} /></Group>
        <Group label="Type"><Tag color={ui.accent}>Employer</Tag><Tag color={ui.off}>Target</Tag><Tag color={ui.faint}>Visitor</Tag><StatusPill status="ok">Connected</StatusPill><StatusPill status="off">Not connected</StatusPill></Group>
      </div>);
    case 'R6': return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ButtonRow align="start"><Button variant="primary">Next: Pilot / proposal</Button><Button>Add note</Button><Button variant="tertiary">Cancel</Button><Button variant="danger">Drop</Button><Link href="https://example.com" target="_blank" rel="noreferrer">uic0.example.com</Link></ButtonRow>
        <ButtonRow align="start"><Button variant="primary" disabled disabledReason="Viewers can't move a partner">Next: Pilot / proposal</Button><Button disabled disabledReason="Already contacted today">Mark contacted</Button><Button variant="tertiary" disabled>Cancel</Button><Button variant="danger" disabled>Drop</Button></ButtonRow>
      </div>);
    default: return <Group label="Channel"><ToggleChip pressed count={62}>All</ToggleChip><ToggleChip count={12}>Call notes</ToggleChip><ToggleChip count={40}>Imports</ToggleChip></Group>;
  }
}

function RolesPanel() {
  const [state, setState] = useState({ tab: 'pipeline', view: 'companies', channel: 'call_note', owner: 'cyrus', stage: 'all', priority: 'P2' });
  const set = patch => setState(s => ({ ...s, ...patch }));
  const head = { ...KIT_TYPE.label, color: ui.muted };
  return (
    <div className="ui-theme-dark" data-theme-panel="roles" style={{ background: ui.ground, borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, marginBottom: 16 }}>
      <SectionLabel>Roles R1–R7 · before → after (ui-clarity-v1 Stage 1, tokens + kit only)</SectionLabel>
      {ROLES.map(([id, name, rule]) => (
        <Card key={id} title={`${id} ${name}`} subtitle={rule}>
          <div data-role={id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 16 }}>
            <div data-before aria-hidden="true" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 10, background: OLD.surface, border: `1px dashed ${ui.divider}` }}>
              <span style={head}>Before</span>
              <Before role={id} />
            </div>
            <div data-after style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 10, background: ui.surface, border: `1px solid ${ui.border}` }}>
              <span style={head}>After</span>
              <After role={id} state={state} set={set} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ThemePanel({ theme }) {
  const [toggles, setToggles] = useState({ voice: true, meetings: false });
  const [parkedOpen, setParkedOpen] = useState(false);
  const [view, setView] = useState('companies');
  const [channel, setChannel] = useState('call_note');
  const [owner, setOwner] = useState('jack');
  const tableGroups = [
    { id: 'live', header: <>Live <span className="ui-table__count">3</span></>, icon: <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: ui.good }} />, rows: TABLE_ROWS.filter(r => r.band === 'live') },
    { id: 'parked', header: <>Parked <span className="ui-table__count">1</span></>, icon: <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: ui.off }} />, rows: TABLE_ROWS.filter(r => r.band === 'parked'), collapsed: !parkedOpen, onToggle: () => setParkedOpen(o => !o) },
  ];
  const values = theme === 'light' ? KIT_LIGHT : KIT_DARK;
  const p = theme;
  return (
    <div className={`ui-theme-${theme}`} data-theme-panel={theme} style={{ background: ui.ground, borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <SectionLabel>{theme}</SectionLabel>
      <Card title="Buttons" subtitle="primary · secondary · tertiary · danger, then disabled">
        <ButtonRow align="start">
          <Button variant="primary">Save</Button>
          <Button>Preview</Button>
          <Button variant="tertiary">Cancel</Button>
          <Button variant="danger">Disconnect</Button>
        </ButtonRow>
        <div style={{ height: 12 }} />
        <ButtonRow align="start">
          <Button variant="primary" disabled>Save</Button>
          <Button disabled>Preview</Button>
          <Button variant="tertiary" disabled>Cancel</Button>
          <Button variant="danger" disabled>Disconnect</Button>
        </ButtonRow>
      </Card>
      <Card title="Choosers" subtitle="tabs · segmented view switch · channel chips · labelled filters">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Tabs label={`${p} sales tabs`} items={TABS} value="pipeline" onChange={() => {}} />
          <Segmented label={`${p} pipeline views`} items={VIEWS} value={view} onChange={setView} />
          <Group label="Channel">{CHANNELS.map(([id, label, n]) => <ToggleChip key={id} pressed={channel === id} count={n} onClick={() => setChannel(id)}>{label}</ToggleChip>)}</Group>
          <Group label="Filters"><FilterSelect label="Owner" value={owner} options={OWNERS} onChange={setOwner} />{owner !== 'all' && <ActiveFilterChip onRemove={() => setOwner('all')}>Owner: {OWNERS.find(o => o.value === owner).label}</ActiveFilterChip>}<Button variant="tertiary" onClick={() => setOwner('all')}>Clear</Button></Group>
        </div>
      </Card>
      <Card title="Status" subtitle="glyph + label on every pill · a Tag is a wash + dot + label">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ButtonRow align="start">
            <StatusPill status="ok">Connected</StatusPill>
            <StatusPill status="warn">Stale</StatusPill>
            <StatusPill status="bad">Reconnect</StatusPill>
            <StatusPill status="off">Not connected</StatusPill>
          </ButtonRow>
          <Group label="Priority">{Object.keys(KIT_PRIORITY).map(k => <Tag key={k} color={ui[`prio${k}`]}>{k}</Tag>)}<Tag color={ui.good}>Meeting set</Tag><Tag color={ui.off}>Not started</Tag></Group>
        </div>
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
      <Card title="Workspace features" subtitle="ToggleRow - one-line help on hover" footer={<ButtonRow><Button variant="tertiary">Reset</Button><Button variant="primary">Save</Button></ButtonRow>}>
        <ToggleRow label="Voice from Outlook" help="Lets members learn their Voice Profile from Outlook Sent Items." checked={toggles.voice} onChange={v => setToggles(t => ({ ...t, voice: v }))} />
        <ToggleRow label="Meetings from Outlook" help="Counts held / booked meetings from the Outlook calendar." checked={toggles.meetings} onChange={v => setToggles(t => ({ ...t, meetings: v }))} />
        <ToggleRow label="Disabled (viewer)" checked disabled />
      </Card>
      <Card title="DataTable" subtitle={`sticky header + first column · sort asc → desc → off per group · ${KIT_TABLE.rowHeight}px rows · hover band`}>
        <DataTable label={`${theme} table`} columns={TABLE_COLUMNS} groups={tableGroups} rowKey={r => r.id}
          rowStyle={r => ({ '--ui-row-tint': `color-mix(in srgb, ${BAND_COLOR[r.band]} 6%, transparent)`, '--ui-row-bar': BAND_COLOR[r.band] })} />
      </Card>
      <Card title="Drawer" subtitle="label · summary · count · Show ▸ / Hide ▾ · Enter / Space · persistKey remembers the choice">
        <Drawer label="People" summary="3 people · Brad (counterpart) +2" count={3}>
          <span style={{ ...KIT_TYPE.small, color: ui.soft }}>Brad · Dana · Sam</span>
        </Drawer>
        <Drawer label="Activity" summary="Called · Oct 2" persistKey={`prospector_ui_gallery_drawer_${p}`}>
          <span style={{ ...KIT_TYPE.small, color: ui.soft }}>Remembered on this browser (prospector_ui_gallery_drawer_{p}).</span>
        </Drawer>
        <Drawer label="Tasks" summary="none this week" defaultOpen>
          <span style={{ ...KIT_TYPE.small, color: ui.muted }}>Open by default; nothing remembered.</span>
        </Drawer>
      </Card>
      <Card title="Tokens" subtitle={`spacing ${KIT_SPACE.join(' / ')} · content max-width ${KIT_MAX_WIDTH}px · ground < surface < surface2`}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {KIT_SPACE.map(s => <div key={s} style={{ textAlign: 'center' }}><div style={{ width: s, height: s, background: ui.accent, borderRadius: 2, margin: '0 auto 4px' }} /><span style={{ ...KIT_TYPE.label, color: ui.muted }}>{s}</span></div>)}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[['ground', ui.ground], ['surface', ui.surface], ['surface2', ui.surface2], ['generated', `linear-gradient(90deg, ${ui.generatedFrom}, ${ui.generatedTo})`]].map(([k, bg]) => (
            <div key={k} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}><div style={{ height: 32, borderRadius: 8, background: bg, border: `1px solid ${ui.border}`, marginBottom: 4 }} /><span style={{ ...KIT_TYPE.label, color: ui.muted }}>{k}</span></div>
          ))}
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
      <PageHeader title="UI kit" subtitle="ui-clarity-v1 · roles R1–R7 before → after, then every component dark and light" actions={<><Button>Secondary</Button><Button variant="primary">Primary</Button></>} />
      <RolesPanel />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', gap: 16 }}>
        <ThemePanel theme="dark" />
        <ThemePanel theme="light" />
      </div>
    </div>
  );
}
