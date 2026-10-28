import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import AssayBanner, { OFFER_MIN } from './AssayBanner';

// FIX auto-assay-on-click-v1 - the bulk assay waits for a click: AssayBanner offers it, App never starts it on its own.
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

test('App.js starts the bulk assay only from the offer\'s click (no effect calls startBulkAssay on mount)', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
  expect(app.match(/startBulkAssay\(/g)).toHaveLength(1);
  expect(app).toMatch(/const scoreUnscored = \(\) => startBulkAssay\(\{ accounts, onSaveAccounts: setAccounts \}\);/);
  expect(app).not.toMatch(/autoAssayRan/);
});

test('more than 10 unscored: one quiet line + "Score <n>"; mounting calls nothing; the click starts it once and sets the cooldown', () => {
  const onScore = jest.fn();
  render(<AssayBanner unscored={12} onScore={onScore} canScore />);
  expect(onScore).not.toHaveBeenCalled();
  expect(document.querySelector('[data-assay-offer]')).toHaveTextContent("12 accounts haven't been scored · Score them (one AI call each)");
  fireEvent.click(screen.getByRole('button', { name: 'Score 12' }));
  expect(onScore).toHaveBeenCalledTimes(1);
  expect(Number(localStorage.getItem('prospector_auto_assay_last'))).toBeGreaterThan(0);
  expect(document.querySelector('[data-assay-offer]')).toBeNull();
});

test(`${OFFER_MIN} or fewer unscored, a Viewer / goals_sales workspace (canScore false), or no handler -> no line`, () => {
  const { rerender } = render(<AssayBanner unscored={OFFER_MIN} onScore={jest.fn()} canScore />);
  expect(document.querySelector('[data-assay-offer]')).toBeNull();
  rerender(<AssayBanner unscored={40} onScore={jest.fn()} canScore={false} />);
  expect(document.querySelector('[data-assay-offer]')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Score/ })).toBeNull();
});

test('"Not now" hides it for 24 h (a remount stays hidden); the opt-out key hides it entirely', () => {
  const onScore = jest.fn();
  const { unmount } = render(<AssayBanner unscored={12} onScore={onScore} canScore />);
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
  expect(onScore).not.toHaveBeenCalled();
  expect(document.querySelector('[data-assay-offer]')).toBeNull();
  unmount();
  render(<AssayBanner unscored={12} onScore={onScore} canScore />);
  expect(document.querySelector('[data-assay-offer]')).toBeNull();
  localStorage.clear();
  localStorage.setItem('prospector_auto_assay_disabled', '1');
  render(<AssayBanner unscored={12} onScore={onScore} canScore />);
  expect(document.querySelector('[data-assay-offer]')).toBeNull();
});
