import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ListButtons } from '../signals/Heat';
import { bulkAsking } from './sheetConfirm';

// grow-sheet-owner-respect F3 - the server's sheet-owner question becomes "Take it" / "Leave it"; only Take it sends
// the confirm flag. Invented brand; recorded fetch; no address anywhere.
const HK = 'biz-hk', ME = 'u-me';
const QUESTION = "The sheet lists this as Pete's. Take it anyway?";
let posts;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
beforeEach(() => {
  posts = [];
  global.fetch = jest.fn((url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null; posts.push(body);
    return body?.confirm_sheet_owner ? json(200, { brand: { id: 'b1', updated_at: '2026-10-29T20:00:00Z' } }) : json(409, { error: QUESTION, sheet_owner: 'Pete', confirm_sheet_owner: true });
  });
});
const brand = { id: 'b1', name: 'Zz Sable Socks', status: 'candidate', relationship: 'prospect', owner_user_id: null, owner_hint: 'pete' };

test('+ Pipeline on a brand the sheet lists as Pete\'s: the question shows; Leave it sends nothing more; Take it retries with the flag and offers Undo', async () => {
  render(<ListButtons businessId={HK} brand={brand} meId={ME} canEdit />);
  fireEvent.click(screen.getByRole('button', { name: 'Add Zz Sable Socks to your Pipeline' }));
  const ask = await screen.findByRole('alertdialog', { name: 'Take it anyway?' });
  expect(ask).toHaveTextContent(QUESTION);
  fireEvent.click(screen.getByRole('button', { name: 'Leave it' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(posts).toEqual([{}]);
  expect(screen.queryByText('In Pipeline')).toBeNull();
  const pipe = screen.getByRole('button', { name: 'Add Zz Sable Socks to your Pipeline' });
  await waitFor(() => expect(pipe).not.toBeDisabled());
  fireEvent.click(pipe);
  fireEvent.click(await screen.findByRole('button', { name: 'Take it' }));
  expect(await screen.findByText('In Pipeline')).toBeInTheDocument();
  expect(posts).toEqual([{}, {}, { confirm_sheet_owner: true }]);
  expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
});

test('bulk: brands needing the question are asked about once, together; Take it retries only those; other refusals pass through', async () => {
  const sent = [];
  const run = jest.fn(async (id, x) => {
    sent.push([id, x]);
    if (id === 'bad') throw Object.assign(new Error('Zz Bad is a sponsor'), { status: 409, body: {} });
    if (id.startsWith('sheet') && !x.confirm_sheet_owner) throw Object.assign(new Error(QUESTION), { status: 409, body: { confirm_sheet_owner: true, sheet_owner: 'Pete' } });
  });
  const confirm = jest.fn(async () => true);
  let refused;
  await act(async () => { refused = await bulkAsking(confirm, ['ok', 'sheet1', 'bad', 'sheet2'], run); });
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledWith("The sheet lists 2 of these as Pete's. Take them anyway?");
  expect(sent.filter(([, x]) => x.confirm_sheet_owner).map(([id]) => id)).toEqual(['sheet1', 'sheet2']);
  expect(refused).toEqual(['Zz Bad is a sponsor']);
  const no = jest.fn(async () => false);
  sent.length = 0;
  await act(async () => { await bulkAsking(no, ['sheet1'], run); });
  expect(sent).toEqual([['sheet1', {}]]);
});

test('Draft: Save on a brand the sheet lists as Pete\'s asks first; Leave it saves nothing; Take it retries the draft with the flag', async () => {
  const ComposerModal = require('./ComposerModal').default;
  const sent = [], saved = [];
  global.fetch = jest.fn((url, init = {}) => {
    if (url.includes('/settings')) return json(200, { settings: {} });
    if (url.includes('/drafts/lint')) return json(200, { lint_passed: true, problems: [] });
    const body = JSON.parse(init.body); sent.push(body.confirm_sheet_owner === true);
    return body.confirm_sheet_owner ? json(201, { touch_id: 't1' }) : json(409, { error: QUESTION, sheet_owner: 'Pete', confirm_sheet_owner: true });
  });
  render(<ComposerModal businessId={HK} brand={brand} contacts={[{ id: 'c1', name: 'Ana', email: 'x', is_primary: true }]} touches={[]} gmail={{ mailbox: { linked: true, state: 'ok' } }} onClose={() => {}} onSaved={r => saved.push(r)} />);
  await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('HumanKind x Zz Sable Socks - '));
  fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Hi Ana' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run lint' }));
  const save = await screen.findByRole('button', { name: 'Save to Gmail Drafts' });
  await waitFor(() => expect(save).not.toBeDisabled());
  fireEvent.click(save);
  expect(await screen.findByRole('alertdialog', { name: 'Take it anyway?' })).toHaveTextContent(QUESTION);
  fireEvent.click(screen.getByRole('button', { name: 'Leave it' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect([sent, saved]).toEqual([[false], []]);
  await waitFor(() => expect(save).not.toBeDisabled());
  fireEvent.click(save);
  fireEvent.click(await screen.findByRole('button', { name: 'Take it' }));
  await waitFor(() => expect(saved).toEqual([{ touch_id: 't1' }]));
  expect(sent).toEqual([false, false, true]);
});
