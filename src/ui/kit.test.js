import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { KIT_DARK, KIT_LIGHT } from './tokens';
import PageHeader from './PageHeader';
import Card from './Card';
import Button, { ButtonRow } from './Button';
import Field from './Field';
import StatusPill from './StatusPill';
import ToggleRow from './ToggleRow';
import UiKitGallery from './UiKitGallery';
import DataTable from './DataTable';

const lum = hex => {
  const c = hex.replace('#', '').match(/../g).map(h => parseInt(h, 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

describe.each([['dark', KIT_DARK], ['light', KIT_LIGHT]])('%s kit colors', (_, k) => {
  test.each([['surface'], ['surface2'], ['ground']])('text on %s >= 4.5 (text, muted, accent, dangerInk)', s => {
    for (const t of ['text', 'muted', 'accent', 'dangerInk']) expect([t, contrast(k[t], k[s]) >= 4.5]).toEqual([t, true]);
  });
  test('graphics >= 3 on surface + surface2 (status, control, off)', () => {
    for (const s of ['surface', 'surface2']) for (const g of ['good', 'warn', 'bad', 'off', 'control']) expect([s, g, contrast(k[g], k[s]) >= 3]).toEqual([s, g, true]);
  });
  test('primary button label >= 4.5', () => expect(contrast(k.onAccent, k.accent)).toBeGreaterThanOrEqual(4.5));
  test('same token names in both themes', () => expect(Object.keys(k).sort()).toEqual(Object.keys(KIT_DARK).sort()));
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
  render(<ButtonRow><Button variant="primary" onClick={click}>Save</Button><Button variant="danger" disabled onClick={click}>Delete</Button><Button variant="nope">X</Button></ButtonRow>);
  fireEvent.click(screen.getByText('Save')); fireEvent.click(screen.getByText('Delete'));
  expect(click).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Save')).toHaveClass('ui-btn', 'ui-btn--primary');
  expect(screen.getByText('Save')).toHaveAttribute('type', 'button');
  expect(screen.getByText('X')).toHaveClass('ui-btn--secondary');
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
  expect(document.querySelectorAll('[data-theme-panel]')).toHaveLength(2);
  expect(screen.getAllByRole('switch')).toHaveLength(6);
  expect(document.querySelectorAll('[data-status]')).toHaveLength(8);
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
