import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { KIT_DARK, KIT_LIGHT, KIT_PRIORITY } from './tokens';
import Tabs from './Tabs';
import Tag from './Tag';
import FilterSelect from './FilterSelect';
import { IconTable, IconMap } from './icons';
import { ToggleChip, ActiveFilterChip, Group } from './Chip';
import PageHeader from './PageHeader';
import Card from './Card';
import Button, { ButtonRow } from './Button';
import Field from './Field';
import StatusPill from './StatusPill';
import ToggleRow from './ToggleRow';
import UiKitGallery from './UiKitGallery';
import DataTable from './DataTable';
import EditableCell from './EditableCell';

const lum = hex => {
  const c = hex.replace('#', '').match(/../g).map(h => parseInt(h, 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const rgb = hex => hex.replace('#', '').match(/../g).map(h => parseInt(h, 16));
const hue = hex => { const [r, g, b] = rgb(hex).map(v => v / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; if (!d) return 0; let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h = Math.round(h * 60); return h < 0 ? h + 360 : h; };
const saturation = hex => { const [r, g, b] = rgb(hex).map(v => v / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b); return max ? (max - min) / max : 0; };
// color-mix(in srgb, c p%, surface) as the browser paints a 22% wash.
const mix = (c, s, p) => '#' + rgb(c).map((v, i) => Math.round(v * p + rgb(s)[i] * (1 - p)).toString(16).padStart(2, '0')).join('');

describe.each([['dark', KIT_DARK], ['light', KIT_LIGHT]])('%s kit colors', (_, k) => {
  test.each([['surface'], ['surface2'], ['ground']])('text on %s >= 4.5 (text, muted, accent, dangerInk)', s => {
    for (const t of ['text', 'muted', 'accent', 'dangerInk']) expect([t, contrast(k[t], k[s]) >= 4.5]).toEqual([t, true]);
  });
  test('graphics >= 3 on surface + surface2 (status, control, off)', () => {
    for (const s of ['surface', 'surface2']) for (const g of ['good', 'warn', 'bad', 'off', 'control']) expect([s, g, contrast(k[g], k[s]) >= 3]).toEqual([s, g, true]);
  });
  test('primary button label >= 4.5', () => expect(contrast(k.onAccent, k.accent)).toBeGreaterThanOrEqual(4.5));
  test('same token names in both themes', () => expect(Object.keys(k).sort()).toEqual(Object.keys(KIT_DARK).sort()));
  // ui-clarity-v1 Stage 1 (H1/H2): faint is readable text, border is a visible edge, surfaces step.
  test('faint >= 4.5 on surface + surface2; border + control >= 3 on surface2; divider is below 3', () => {
    for (const s of ['surface', 'surface2']) expect([s, contrast(k.faint, k[s]) >= 4.5]).toEqual([s, true]);
    for (const g of ['border', 'control']) expect([g, contrast(k[g], k.surface2) >= 3]).toEqual([g, true]);
    expect(contrast(k.divider, k.surface)).toBeLessThan(3);
  });
  test('text on accent is the ground colour, never white', () => expect(k.onAccent).toBe(k.ground));
  // FIX priority-colors-v1: four hue families (orange, amber, teal, slate), not one ramp.
  test('P1-P4 >= 3 on surface, four distinct hue families, label text >= 4.5 on a 22% wash, none the danger red or the Generate orange', () => {
    const ramp = ['P1', 'P2', 'P3', 'P4'].map(p => k[`prio${p}`]);
    for (const c of ramp) expect([c, contrast(c, k.surface) >= 3]).toEqual([c, true]);
    const hues = ramp.map(hue);
    expect(hues[0]).toBeGreaterThanOrEqual(15); expect(hues[0]).toBeLessThanOrEqual(35); // orange
    expect(hues[1]).toBeGreaterThanOrEqual(38); expect(hues[1]).toBeLessThanOrEqual(55); // amber
    expect(hues[2]).toBeGreaterThanOrEqual(160); expect(hues[2]).toBeLessThanOrEqual(190); // teal
    expect(saturation(ramp[3])).toBeLessThan(0.3); // slate: the grey one
    for (const c of ramp.slice(0, 3)) expect(saturation(c)).toBeGreaterThan(0.4);
    for (const c of ramp) { expect(contrast(k.text, mix(c, k.surface, 0.22)) >= 4.5).toBe(true); expect(c.toUpperCase()).not.toBe(k.bad.toUpperCase()); expect(c.toUpperCase()).not.toBe('#FF8A3D'); }
  });
  test('generated ombre tokens', () => { expect(k.generatedFrom).toBe(k.accent); expect(k.generatedTo).toBe('#FF8A3D'); });
});

test('dark surfaces are three visible steps (>= 1.2 each) and the ramp is the sales priority ramp', () => {
  expect(contrast(KIT_DARK.surface, KIT_DARK.ground)).toBeGreaterThanOrEqual(1.2);
  expect(contrast(KIT_DARK.surface2, KIT_DARK.surface)).toBeGreaterThanOrEqual(1.2);
  expect(KIT_DARK.prioP4).toBe(KIT_PRIORITY.P4[0]);
  expect(KIT_LIGHT.prioP4).toBe(KIT_PRIORITY.P4[1]);
});

test('kit CSS is injected once with dark on :root and light on the app light mode', () => {
  const css = document.getElementById('ui-kit-css').textContent;
  expect(css).toContain(`:root, .ui-theme-dark { --ui-ground: ${KIT_DARK.ground};`);
  expect(css).toContain(`body.mode-straight-shooter, .ui-theme-light { --ui-ground: ${KIT_LIGHT.ground};`);
  expect(document.querySelectorAll('#ui-kit-css')).toHaveLength(1);
});

test('PageHeader + Card render title, subtitle, actions, footer', () => {
  render(<><PageHeader title="Connections" subtitle="Google · Microsoft · Apollo" actions={<Button>Check</Button>} /><Card title="Google" subtitle="Calendar" footer={<span>foot</span>}>body</Card></>);
  expect(screen.getByRole('heading', { level: 1, name: 'Connections' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Google' })).toBeInTheDocument();
  for (const t of ['Google · Microsoft · Apollo', 'Calendar', 'body', 'foot', 'Check']) expect(screen.getByText(t)).toBeInTheDocument();
});

test('Button variants, default type, disabled, click', () => {
  const click = jest.fn();
  render(<ButtonRow><Button variant="primary" onClick={click}>Save</Button><Button variant="danger" disabled disabledReason="Viewers cannot" onClick={click}>Delete</Button><Button variant="nope">X</Button><Button variant="tertiary" size="sm">Old</Button><Button variant="tertiary">Clear</Button></ButtonRow>);
  fireEvent.click(screen.getByText('Save')); fireEvent.click(screen.getByText('Delete'));
  expect(click).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Save')).toHaveClass('ui-btn', 'ui-btn--primary');
  expect(screen.getByText('Save')).toHaveAttribute('type', 'button');
  expect(screen.getByText('Delete')).toHaveAttribute('title', 'Viewers cannot');
  expect(screen.getByText('X')).toHaveClass('ui-btn--secondary');
  expect(screen.getByText('Old')).toHaveClass('ui-btn--tertiary', 'ui-btn--sm');
  expect(screen.getByText('Clear')).toHaveClass('ui-btn--tertiary');
  const css = document.getElementById('ui-kit-css').textContent;
  expect(css).toMatch(/\.ui-btn:disabled \{[^}]*border:1px dashed var\(--ui-border\)[^}]*cursor:not-allowed/);
  expect(css).toMatch(/\.ui-btn--tertiary \{[^}]*text-decoration:underline/);
  expect(css).toMatch(/\.ui-seg__btn\[aria-pressed="true"\] \{ background:var\(--ui-text\); border-color:var\(--ui-text\); color:var\(--ui-ground\); \}/);
});

test('Tabs: one selected tab, a disabled tab says why and keeps its note', () => {
  const onChange = jest.fn();
  render(<Tabs label="Sales" items={[{ id: 'a', label: 'Dashboard' }, { id: 'b', label: 'Pipeline' }, { id: 'm', label: 'Marketing', disabled: true, note: 'Coming soon' }]} value="b" onChange={onChange} />);
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map(t => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
  expect(tabs[2]).toBeDisabled();
  expect(tabs[2]).toHaveAttribute('title', 'Coming soon');
  expect(tabs[2].querySelector('.ui-tag')).toHaveTextContent('Coming soon');
  fireEvent.click(tabs[0]); expect(onChange).toHaveBeenCalledWith('a');
  fireEvent.click(tabs[2]); expect(onChange).toHaveBeenCalledTimes(1);
});

test('Tabs level="sub" (companies-v2 C1): tablist + tabs, icon + word, one tab stop, arrows / Home / End move and select; main level unchanged', () => {
  const Harness = () => {
    const [v, setV] = React.useState('b');
    return <Tabs level="sub" label="Pipeline views" value={v} onChange={setV} items={[{ id: 'a', label: 'Companies', icon: IconTable }, { id: 'b', label: 'Map', icon: IconMap }, { id: 'c', label: 'People' }]} />;
  };
  render(<Harness />);
  const list = screen.getByRole('tablist', { name: 'Pipeline views' });
  expect(list).toHaveClass('ui-tabs', 'ui-tabs--sub');
  const tabs = () => screen.getAllByRole('tab');
  expect(tabs().map(t => t.textContent)).toEqual(['Companies', 'Map', 'People']);
  expect(tabs()[0].querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  expect(tabs()[2].querySelector('svg')).toBeNull();
  expect(tabs().map(t => [t.getAttribute('aria-selected'), t.tabIndex])).toEqual([['false', -1], ['true', 0], ['false', -1]]);
  tabs()[1].focus();
  fireEvent.keyDown(tabs()[1], { key: 'ArrowRight' });
  expect(tabs()[2]).toHaveAttribute('aria-selected', 'true'); expect(tabs()[2]).toHaveFocus();
  fireEvent.keyDown(tabs()[2], { key: 'ArrowRight' });
  expect(tabs()[0]).toHaveAttribute('aria-selected', 'true'); expect(tabs()[0]).toHaveFocus();
  fireEvent.keyDown(tabs()[0], { key: 'ArrowLeft' });
  expect(tabs()[2]).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(tabs()[2], { key: 'Home' });
  expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(tabs()[0], { key: 'End' });
  expect(tabs()[2]).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(tabs()[1]);
  expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
});

test('Tabs main level (HK screens use it) keeps no roving tabindex, no arrow handling and no icon', () => {
  const onChange = jest.fn();
  render(<Tabs label="Sales" items={[{ id: 'a', label: 'Dashboard', icon: IconTable }, { id: 'b', label: 'Pipeline' }]} value="a" onChange={onChange} />);
  const tabs = screen.getAllByRole('tab');
  expect(screen.getByRole('tablist')).not.toHaveClass('ui-tabs--sub');
  expect(tabs.map(t => t.hasAttribute('tabindex'))).toEqual([false, false]);
  expect(tabs[0].querySelector('svg')).toBeNull();
  fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
  expect(onChange).not.toHaveBeenCalled();
});

test('FilterSelect variant="pill" (companies-v2 C3): one labelled pill with a caret; accent edge only off the default; same onChange', () => {
  const change = jest.fn();
  const opts = [{ value: '', label: 'All' }, { value: 'cyrus', label: 'Cyrus' }];
  const { rerender } = render(<FilterSelect variant="pill" label="Owner" value="" options={opts} onChange={change} />);
  const sel = screen.getByLabelText('Owner');
  const pill = sel.closest('.ui-filter');
  expect(pill).toHaveClass('ui-filter--pill');
  expect(pill).not.toHaveAttribute('data-active');
  expect(pill.querySelector('svg.ui-filter__caret[aria-hidden="true"]')).not.toBeNull();
  fireEvent.change(sel, { target: { value: 'cyrus' } });
  expect(change).toHaveBeenCalledWith('cyrus');
  rerender(<FilterSelect variant="pill" label="Owner" value="cyrus" options={opts} onChange={change} />);
  expect(screen.getByLabelText('Owner').closest('.ui-filter')).toHaveAttribute('data-active');
  rerender(<FilterSelect label="Owner" value="cyrus" options={opts} onChange={change} />);
  const plain = screen.getByLabelText('Owner').closest('.ui-filter');
  expect(plain).not.toHaveClass('ui-filter--pill');
  expect(plain).not.toHaveAttribute('data-active');
  expect(plain.querySelector('svg')).toBeNull();
});

test('ToggleChip / ActiveFilterChip / Group / Tag / FilterSelect', () => {
  const on = jest.fn(), remove = jest.fn(), change = jest.fn();
  render(<>
    <Group label="Channel"><ToggleChip pressed count={12} onClick={on}>Call notes</ToggleChip><ToggleChip count={3}>Scout</ToggleChip></Group>
    <ActiveFilterChip onRemove={remove}>Owner: Cyrus</ActiveFilterChip>
    <Tag color="#3DD68C">Meeting set</Tag>
    <FilterSelect label="Owner" value="jack" options={[{ value: 'jack', label: 'Jack' }, { value: 'cyrus', label: 'Cyrus' }]} onChange={change} />
  </>);
  const group = screen.getByRole('group', { name: 'Channel' });
  const chips = group.querySelectorAll('button.ui-chip');
  expect(chips[0]).toHaveAttribute('aria-pressed', 'true');
  expect(chips[0].querySelector('.ui-chip__count')).toHaveTextContent('12');
  expect(chips[1]).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(chips[0]); expect(on).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove filter Owner: Cyrus' })); expect(remove).toHaveBeenCalled();
  const tag = screen.getByText('Meeting set');
  expect(tag).toHaveClass('ui-tag');
  expect(tag.querySelector('.ui-tag__dot')).not.toBeNull();
  expect(tag.tagName).toBe('SPAN');
  const sel = screen.getByLabelText('Owner');
  expect(sel).toHaveClass('ui-filter__select');
  fireEvent.change(sel, { target: { value: 'cyrus' } }); expect(change).toHaveBeenCalledWith('cyrus');
});

test('Field ties its label to the control and shows error over hint', () => {
  render(<Field label="Name" htmlFor="n" hint="h" error="bad value"><input id="n" className="ui-input" /></Field>);
  expect(screen.getByLabelText('Name')).toHaveClass('ui-input');
  expect(screen.getByRole('alert')).toHaveTextContent('bad value');
  expect(screen.queryByText('h')).toBeNull();
});

test('StatusPill always has a glyph and a label', () => {
  render(<>{['ok', 'warn', 'bad', 'off'].map(s => <StatusPill key={s} status={s}>{s}-label</StatusPill>)}</>);
  for (const [s, g] of [['ok', '✓'], ['warn', '!'], ['bad', '✕'], ['off', '–']]) {
    const pill = screen.getByText(`${s}-label`);
    expect(pill).toHaveAttribute('data-status', s);
    expect(pill.querySelector('[aria-hidden="true"]').textContent).toBe(g);
  }
});

test('ToggleRow is a labelled switch with one-line help; disabled never fires', () => {
  const change = jest.fn();
  render(<><ToggleRow label="Voice" help="Learn from Outlook." checked={false} onChange={change} /><ToggleRow label="Locked" checked disabled onChange={change} /></>);
  const sw = screen.getByRole('switch', { name: 'Voice' });
  expect(sw).toHaveAttribute('aria-checked', 'false');
  expect(sw).toHaveAccessibleDescription('Learn from Outlook.');
  fireEvent.click(sw); expect(change).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole('switch', { name: 'Locked' })); expect(change).toHaveBeenCalledTimes(1);
});

test('gallery shows every component in both themes', () => {
  render(<UiKitGallery />);
  expect(document.querySelector('[data-ui-gallery]')).not.toBeNull();
  expect(document.querySelectorAll('[data-theme-panel]')).toHaveLength(3);
  expect(screen.getAllByRole('switch')).toHaveLength(6);
  expect(document.querySelectorAll('[data-status]')).toHaveLength(10);
  expect(document.querySelectorAll('[data-role]')).toHaveLength(7);
  for (const el of document.querySelectorAll('[data-before] button, [data-before] a, [data-before] select')) expect(el).toBeNull();
  expect(document.querySelectorAll('[data-after] button').length).toBeGreaterThan(10);
  fireEvent.click(screen.getAllByRole('switch', { name: /Meetings from Outlook/ })[0]);
  expect(screen.getAllByRole('switch', { name: /Meetings from Outlook/ })[0]).toHaveAttribute('aria-checked', 'true');
});

test('Segmented: one pressed item, sentence-case label, dot + meta optional', () => {
  const Segmented = require('./Segmented').default;
  const onChange = jest.fn();
  render(<Segmented label="Pipeline views" items={[{ id: 'board', label: 'Board' }, { id: 'partners', label: 'Partner workflow', meta: 3 }, { id: 'jack', label: 'Jack', color: '#6F8CF0' }]} value="board" onChange={onChange} />);
  const group = screen.getByRole('group', { name: 'Pipeline views' });
  const buttons = group.querySelectorAll('button');
  expect(buttons.length).toBe(3);
  expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
  expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
  expect(buttons[1].textContent).toBe('Partner workflow3');
  expect(buttons[2].querySelector('span[aria-hidden]')).toBeTruthy();
  fireEvent.click(buttons[1]);
  expect(onChange).toHaveBeenCalledWith('partners');
  expect(document.getElementById('ui-kit-css').textContent).toMatch(/\.ui-seg__btn \{[^}]*font:500 13px 'Geist', ui-sans-serif/);
});

// pipeline-wide-table-v1 - DataTable.
const T_COLS = [
  { id: 'name', label: 'Company', width: 120, sticky: true, sortValue: r => r.name, render: r => r.name },
  { id: 'due', label: 'Due', width: 80, sortValue: r => r.due, render: r => r.due || '—' },
  { id: 'star', label: 'Top', width: 30, render: () => '☆' },
];
const T_ROW = (name, due) => ({ name, due });
const T_GROUPS = (collapsed = false, onToggle) => [
  { id: 'a', header: <>Alpha <span className="ui-table__count">3</span></>, rows: [T_ROW('Mango', '2026-10-20'), T_ROW('Apple', null), T_ROW('Kiwi', '2026-10-05')] },
  { id: 'b', header: 'Beta', rows: [T_ROW('Zed', '2026-10-01'), T_ROW('Bob', '2026-10-02')], collapsed, onToggle },
];
const names = () => [...document.querySelectorAll('tr[data-row] td:first-child')].map(td => td.textContent);

test('DataTable: a header click cycles asc -> desc -> off inside each group; off = the given order', () => {
  render(<DataTable columns={T_COLS} groups={T_GROUPS()} rowKey={r => r.name} />);
  expect(names()).toEqual(['Mango', 'Apple', 'Kiwi', 'Zed', 'Bob']);
  const due = screen.getByRole('button', { name: /^Due/ });
  fireEvent.click(due);
  expect(names()).toEqual(['Kiwi', 'Mango', 'Apple', 'Zed', 'Bob']);
  fireEvent.click(due);
  expect(names()).toEqual(['Mango', 'Kiwi', 'Apple', 'Bob', 'Zed']);
  fireEvent.click(due);
  expect(names()).toEqual(['Mango', 'Apple', 'Kiwi', 'Zed', 'Bob']);
});

test('DataTable: groups keep their order whatever the sort', () => {
  render(<DataTable columns={T_COLS} groups={T_GROUPS()} rowKey={r => r.name} />);
  fireEvent.click(screen.getByRole('button', { name: /^Company/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Company/ }));
  expect([...document.querySelectorAll('tr[data-group]')].map(tr => tr.dataset.group)).toEqual(['a', 'b']);
  expect(names()).toEqual(['Mango', 'Kiwi', 'Apple', 'Zed', 'Bob']);
  expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Alpha 3', 'Beta']);
});

test('DataTable: a collapsed group renders only its header; the toggle expands it', () => {
  const Wrap = () => { const [c, setC] = React.useState(true); return <DataTable columns={T_COLS} groups={T_GROUPS(c, () => setC(x => !x))} rowKey={r => r.name} />; };
  render(<Wrap />);
  expect(names()).toEqual(['Mango', 'Apple', 'Kiwi']);
  const toggle = screen.getByRole('button', { name: 'Beta' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(names()).toEqual(['Mango', 'Apple', 'Kiwi', 'Zed', 'Bob']);
});

test('DataTable: aria-sort follows the sorted column; unsortable headers carry none', () => {
  render(<DataTable columns={T_COLS} groups={T_GROUPS()} rowKey={r => r.name} />);
  const th = label => screen.getByRole('columnheader', { name: label });
  expect(th(/^Company/)).toHaveAttribute('aria-sort', 'none');
  expect(th(/^Due/)).toHaveAttribute('aria-sort', 'none');
  expect(th('Top')).not.toHaveAttribute('aria-sort');
  fireEvent.click(screen.getByRole('button', { name: /^Due/ }));
  expect(th(/^Due/)).toHaveAttribute('aria-sort', 'ascending');
  expect(th(/^Company/)).toHaveAttribute('aria-sort', 'none');
  fireEvent.click(screen.getByRole('button', { name: /^Due/ }));
  expect(th(/^Due/)).toHaveAttribute('aria-sort', 'descending');
  fireEvent.click(screen.getByRole('button', { name: /^Company/ }));
  expect(th(/^Due/)).toHaveAttribute('aria-sort', 'none');
  expect(th(/^Company/)).toHaveAttribute('aria-sort', 'ascending');
});

test('DataTable: the sticky first column keeps a solid surface under the row tint; the head is sticky', () => {
  render(<DataTable columns={T_COLS} groups={T_GROUPS()} rowKey={r => r.name} rowStyle={() => ({ '--ui-row-tint': 'rgba(0,255,0,.06)' })} />);
  const css = document.getElementById('ui-kit-css').textContent;
  const sticky = css.match(/\.ui-table td\.ui-table__sticky \{[^}]*\}/)[0];
  expect(sticky).toMatch(/position:sticky; left:0/);
  expect(sticky).toMatch(/var\(--ui-surface\)/);
  expect(css).toMatch(/\.ui-table th \{[^}]*position:sticky; top:0/);
  expect(document.querySelector('tr[data-row] td:first-child')).toHaveClass('ui-table__sticky');
  expect(document.querySelector('thead th:first-child')).toHaveClass('ui-table__sticky');
  expect(document.querySelector('tr[data-row]').style.getPropertyValue('--ui-row-tint')).toBe('rgba(0,255,0,.06)');
});

test('EditableCell: read mode is a button with the rendered value and a label when empty; the editor selects, Enter commits trimmed, blur unchanged cancels, Esc cancels, saving dims', () => {
  const on = { onEdit: jest.fn(), onCommit: jest.fn(), onCancel: jest.fn() };
  const base = { label: 'Next step for Acme', render: v => v || '—', ...on };
  const { rerender } = render(<EditableCell value={null} {...base} />);
  const empty = screen.getByRole('button', { name: 'Next step for Acme' });
  expect(empty.textContent).toBe('—');
  expect(empty.className).toBe('ui-cell');
  rerender(<EditableCell value="Call back" {...base} />);
  fireEvent.click(screen.getByRole('button', { name: 'Call back' }));
  expect(on.onEdit).toHaveBeenCalledTimes(1);
  rerender(<EditableCell value="Call back" editing {...base} />);
  const input = screen.getByRole('textbox', { name: 'Next step for Acme' });
  expect(document.activeElement).toBe(input);
  expect(input.selectionEnd - input.selectionStart).toBe('Call back'.length);
  fireEvent.blur(input);
  expect(on.onCancel).toHaveBeenCalledTimes(1);
  expect(on.onCommit).not.toHaveBeenCalled();
  rerender(<EditableCell value="Call back" {...base} />);
  rerender(<EditableCell value="Call back" editing {...base} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Send deck ' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  fireEvent.blur(screen.getByRole('textbox'));
  expect(on.onCommit).toHaveBeenCalledTimes(1);
  expect(on.onCommit).toHaveBeenCalledWith('Send deck');
  rerender(<EditableCell value="Call back" {...base} />);
  rerender(<EditableCell value="Call back" editing {...base} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(on.onCommit).toHaveBeenLastCalledWith(null);
  rerender(<EditableCell value="Call back" {...base} />);
  rerender(<EditableCell value="Call back" editing {...base} />);
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  expect(on.onCancel).toHaveBeenCalledTimes(2);
  rerender(<EditableCell value="Call back" saving="Send deck" {...base} />);
  const busy = screen.getByRole('button', { name: 'Send deck' });
  expect(busy.className).toBe('ui-cell ui-cell--saving');
  expect(busy).toHaveAttribute('aria-busy', 'true');
  fireEvent.click(busy);
  expect(on.onEdit).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(busy);
});

// partner-details-drawers-v1 - Drawer.
describe('Drawer', () => {
  const Drawer = require('./Drawer').default;
  beforeEach(() => localStorage.clear());

  test('closed by default: header is a button with label + summary + count, body absent; click / Enter / Space toggle; aria-expanded + aria-controls follow', () => {
    const onToggle = jest.fn();
    render(<Drawer label="People" summary="3 people · Brad +2" count={3} onToggle={onToggle}><span>body here</span></Drawer>);
    const head = screen.getByRole('button', { name: /^People/ });
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(head.textContent).toBe('People3 people · Brad +23Show ▸');
    expect(screen.getByRole('region', { name: 'People' })).toBeInTheDocument();
    expect(screen.queryByText('body here')).toBeNull();
    fireEvent.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(head.textContent).toBe('People3Hide ▾');
    expect(document.getElementById(head.getAttribute('aria-controls'))).toHaveTextContent('body here');
    fireEvent.keyDown(head, { key: 'Enter' });
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('body here')).toBeNull();
    fireEvent.keyDown(head, { key: ' ' });
    expect(head).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(head, { key: 'a' });
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(onToggle.mock.calls.map(c => c[0])).toEqual([true, false, true]);
    expect(document.getElementById('ui-kit-css').textContent).toMatch(/\.ui-drawer__head:focus-visible \{ outline:2px solid var\(--ui-accent\)/);
  });

  test('defaultOpen opens; persistKey round-trips through localStorage and a stored choice beats defaultOpen', () => {
    const { unmount } = render(<Drawer label="Tasks" defaultOpen><span>t</span></Drawer>);
    expect(screen.getByRole('button', { name: /^Tasks/ })).toHaveAttribute('aria-expanded', 'true');
    unmount();
    const { unmount: u2 } = render(<Drawer label="Activity" persistKey="prospector_test_drawer"><span>a</span></Drawer>);
    fireEvent.click(screen.getByRole('button', { name: /^Activity/ }));
    expect(localStorage.getItem('prospector_test_drawer')).toBe('open');
    u2();
    const { unmount: u3 } = render(<Drawer label="Activity" persistKey="prospector_test_drawer"><span>a</span></Drawer>);
    expect(screen.getByRole('button', { name: /^Activity/ })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^Activity/ }));
    expect(localStorage.getItem('prospector_test_drawer')).toBe('closed');
    u3();
    render(<Drawer label="Activity" persistKey="prospector_test_drawer" defaultOpen><span>a</span></Drawer>);
    expect(screen.getByRole('button', { name: /^Activity/ })).toHaveAttribute('aria-expanded', 'false');
  });

  test('a throwing localStorage never breaks the drawer: it still toggles in memory', () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('private mode'); });
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('private mode'); });
    try {
      render(<Drawer label="Intel" persistKey="prospector_test_drawer"><span>i</span></Drawer>);
      const head = screen.getByRole('button', { name: /^Intel/ });
      expect(head).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(head);
      expect(head).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('i')).toBeInTheDocument();
      fireEvent.click(head);
      expect(head).toHaveAttribute('aria-expanded', 'false');
    } finally { get.mockRestore(); set.mockRestore(); }
  });
});

// FIX actions-row-detail-v1 - DataTable renderDetail.
const D_COLS = [
  { id: 'name', label: 'Company', width: 120, sticky: true, render: r => r.name },
  { id: 'text', label: 'What', width: 100, detail: true, render: r => r.text, title: r => r.text },
  { id: 'act', label: 'Actions', width: 80, render: r => <button type="button" onClick={() => r.onAct?.()}>Act {r.name}</button> },
];
const D_GROUPS = rows => [{ id: 'a', header: 'A', rows }];
const D_ROWS = act => [{ name: 'Mango', text: 'Call the long-winded buyer back', onAct: act }, { name: 'Kiwi', text: 'Send the deck' }];
const detail = r => <p>Full: {r.text}</p>;

test('DataTable renderDetail: the disclosure or the text cell opens one panel under its row; aria wired; one at a time', () => {
  render(<DataTable columns={D_COLS} groups={D_GROUPS(D_ROWS())} rowKey={r => r.name} renderDetail={detail} />);
  const mango = screen.getByRole('button', { name: 'Show details for Call the long-winded buyer back' });
  expect(mango).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(mango);
  expect(mango).toHaveAttribute('aria-expanded', 'true');
  const panel = document.getElementById(mango.getAttribute('aria-controls'));
  expect(panel).toHaveTextContent('Full: Call the long-winded buyer back');
  expect(panel.closest('tr').previousSibling).toHaveAttribute('data-key', 'Mango');
  expect(panel).toHaveAttribute('colspan', '3');
  expect(document.querySelectorAll('tr[data-row]')).toHaveLength(2);
  fireEvent.click(screen.getByText('Send the deck'));
  expect(document.querySelectorAll('[data-detail]')).toHaveLength(1);
  expect(document.querySelector('[data-detail]')).toHaveAttribute('data-detail', 'Kiwi');
  expect(mango).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: 'Hide details for Send the deck' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Hide details for Send the deck' }));
  expect(document.querySelectorAll('[data-detail]')).toHaveLength(0);
});

test('DataTable renderDetail: Esc closes and focus stays on the button; row buttons never toggle', () => {
  const act = jest.fn();
  render(<DataTable columns={D_COLS} groups={D_GROUPS(D_ROWS(act))} rowKey={r => r.name} renderDetail={detail} />);
  fireEvent.click(screen.getByRole('button', { name: 'Act Mango' }));
  expect(act).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll('[data-detail]')).toHaveLength(0);
  const btn = screen.getByRole('button', { name: /details for Call/ });
  fireEvent.click(screen.getByText('Call the long-winded buyer back'));
  expect(document.querySelectorAll('[data-detail]')).toHaveLength(1);
  fireEvent.keyDown(btn, { key: 'Escape' });
  expect(document.querySelectorAll('[data-detail]')).toHaveLength(0);
  expect(btn).toHaveFocus();
  expect(btn).toHaveAttribute('aria-expanded', 'false');
});

test('DataTable renderDetail: the phone list opens the same panel under the item; without renderDetail there is no disclosure', () => {
  const { unmount } = render(<DataTable compact columns={D_COLS} groups={D_GROUPS(D_ROWS(jest.fn()))} rowKey={r => r.name} renderCompact={r => <span>{r.text} <button type="button">Do {r.name}</button></span>} renderDetail={detail} />);
  fireEvent.click(screen.getByRole('button', { name: 'Do Mango' }));
  expect(document.querySelectorAll('[data-detail]')).toHaveLength(0);
  fireEvent.click(screen.getByText(/Call the long-winded/));
  const li = document.querySelector('li[data-detail]');
  expect(li).toHaveTextContent('Full: Call the long-winded buyer back');
  expect(li.previousSibling).toHaveAttribute('data-key', 'Mango');
  fireEvent.keyDown(li, { key: 'Escape' });
  expect(document.querySelectorAll('[data-detail]')).toHaveLength(0);
  unmount();
  render(<DataTable columns={D_COLS} groups={D_GROUPS(D_ROWS())} rowKey={r => r.name} />);
  expect(document.querySelector('.ui-table__disclose')).toBeNull();
});
