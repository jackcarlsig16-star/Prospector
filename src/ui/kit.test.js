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
