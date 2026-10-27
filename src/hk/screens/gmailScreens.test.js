import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import DraftsScreen, { DISCARD_COPY } from './DraftsScreen';
import RepliesScreen from './RepliesScreen';
import ComposerModal from '../brands/ComposerModal';

// hkos-gmail-connect-v1 Stage 3 - Drafts actions, the Replies drawer's override, the composer's gating, all against a
// recorded fetch. Invented brands; no address anywhere in the fixtures.
const HK = 'biz-hk';
const shell = { me: { user_id: 'u-jack', first_name: 'Jack', role: 'owner' }, members: [{ user_id: 'u-jack', first_name: 'Jack', palette_index: 1 }, { user_id: 'u-pete', first_name: 'Pete', palette_index: 2 }] };
let calls, routes;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
beforeEach(() => {
  calls = []; routes = {};
  global.fetch = jest.fn((url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url, 'http://x'); calls.push(`${method} ${u.pathname}${u.search}`);
    const hit = routes[`${method} ${u.pathname}`]; return hit ? json(200, typeof hit === 'function' ? hit(init.body ? JSON.parse(init.body) : null) : hit) : json(404, { error: `no route ${method} ${u.pathname}` });
  });
});

const draft = over => ({ id: 't-1', brand_id: 'b-1', brand_name: 'Harbor Yoga', contact_name: 'Ana', kind: 'cold', channel: 'email', subject: 'HumanKind x Harbor Yoga - mat time', sender_user_id: 'u-jack', created_by: 'user', lint_passed: true, age_days: 1, mine: true, gmail_draft_url: 'https://mail.google.com/mail/?authuser=x#drafts/d1', ...over });

test('Drafts: table rows with Open in Gmail; another founder\'s draft has no link; Discard asks first then DELETEs; no Send anywhere', async () => {
  routes[`GET /api/hk/${HK}/drafts`] = { drafts: [draft(), draft({ id: 't-2', brand_name: 'Northwind Juice', sender_user_id: 'u-pete', mine: false, gmail_draft_url: null, age_days: 5, lint_passed: false })] };
  routes[`DELETE /api/hk/${HK}/drafts/t-1`] = { ok: true };
  const { container } = render(<DraftsScreen businessId={HK} shell={shell} compact={false} onOpenBrand={() => {}} />);
  await screen.findByText('Harbor Yoga');
  expect(container.querySelectorAll('[data-hk-open-gmail]')).toHaveLength(1);
  expect(screen.getByText('5 d, aging')).toBeInTheDocument();
  expect(container.querySelectorAll('.hk-chip--block')).toHaveLength(1);
  expect(container.innerText || container.textContent).not.toMatch(/\bSend\b(?! button)/);
  expect(container.querySelector('[data-hk-no-send]').textContent).toMatch(/no Send button here/);
  fireEvent.click(screen.getAllByRole('button', { name: 'Discard' })[0]);
  const dlg = container.querySelector('[data-hk-discard-confirm]');
  expect(dlg.textContent).toContain(DISCARD_COPY);
  expect(calls.filter(c => c.startsWith('DELETE'))).toHaveLength(0);
  fireEvent.click(within(dlg).getByRole('button', { name: 'Discard' }));
  await waitFor(() => expect(calls).toContain(`DELETE /api/hk/${HK}/drafts/t-1`));
  expect(calls.filter(c => c.startsWith(`GET /api/hk/${HK}/drafts`))).toHaveLength(2);
});

test('Drafts: empty state names where drafts come from', async () => {
  routes[`GET /api/hk/${HK}/drafts`] = { drafts: [] };
  render(<DraftsScreen businessId={HK} shell={shell} onOpenBrand={() => {}} />);
  expect(await screen.findByText('No drafts waiting.')).toBeInTheDocument();
});

const reply = over => ({ id: 'r-1', brand_id: 'b-1', brand_name: 'Harbor Yoga', from_name: 'Ana', from_domain: 'harboryoga.invalid', label: 'interested', summary: 'Wants a call next week', received_at: '2026-10-26T15:00:00Z', brand_owner_user_id: 'u-jack', handled: false, mine: true, sender_user_id: 'u-jack', open_url: 'https://mail.google.com/mail/?authuser=x#all/m1', ...over });

test('Replies: unhandled by default; the drawer opens; a label change PATCHes {label}; Mark handled PATCHes {handled:true}; another founder\'s reply shows whose inbox, no link', async () => {
  const patched = [];
  routes[`GET /api/hk/${HK}/replies`] = { replies: [reply(), reply({ id: 'r-2', brand_name: 'Northwind Juice', label: 'pricing', mine: false, sender_user_id: 'u-pete', open_url: null, brand_owner_user_id: 'u-pete' })] };
  routes[`PATCH /api/hk/${HK}/replies/r-1`] = b => { patched.push(b); return { reply: reply(b) }; };
  const { container } = render(<RepliesScreen businessId={HK} shell={shell} owner="all" compact={false} onOpenBrand={() => {}} />);
  await screen.findByText('Harbor Yoga');
  expect(calls[0]).toBe(`GET /api/hk/${HK}/replies?handled=false&owner=all`);
  fireEvent.click(container.querySelector('[data-hk-reply="r-1"]'));
  const drawer = container.querySelector('[data-hk-reply-drawer]');
  expect(drawer).toBeTruthy();
  expect(drawer.querySelector('[data-hk-open-reply]')).toBeTruthy();
  fireEvent.change(within(drawer).getByLabelText('Reply label'), { target: { value: 'referral' } });
  await waitFor(() => expect(patched).toEqual([{ label: 'referral' }]));
  fireEvent.click(within(drawer).getByRole('button', { name: 'Mark handled' }));
  await waitFor(() => expect(patched).toHaveLength(2));
  expect(patched[1]).toEqual({ handled: true });
  fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
  fireEvent.click(container.querySelector('[data-hk-reply="r-2"]'));
  const other = container.querySelector('[data-hk-reply-drawer]');
  expect(other.querySelector('[data-hk-open-reply]')).toBeNull();
  expect(other.querySelector('[data-hk-other-inbox]').textContent).toMatch(/In Pete's inbox/);
  expect(other.textContent).toMatch(/Do not quote pricing/);
  expect(container.textContent).not.toMatch(/@/);
});

test('Composer: Save is closed until Run lint passes on the current text; a clean lint opens it; editing closes it again; nothing sends', async () => {
  routes[`GET /api/hk/${HK}/settings`] = { settings: { subject_format: 'HumanKind x [Brand] - [descriptor]' }, locked_rules: [{ rule: 'No em dashes.' }] };
  const lints = [];
  routes[`POST /api/hk/${HK}/drafts/lint`] = b => { lints.push(b); return b.body_markdown.includes('—') ? { lint_passed: false, problems: [{ rule: 'dash', level: 'reject', message: 'em dash', excerpt: '—' }] } : { lint_passed: true, problems: [] }; };
  const brand = { id: 'b-1', name: 'Harbor Yoga' };
  const gmail = { mailbox: { linked: true, state: 'ok' } };
  const { container } = render(<ComposerModal businessId={HK} brand={brand} contacts={[{ id: 'c-1', name: 'Ana', title: 'Owner', email: 'x', is_primary: true }]} touches={[]} gmail={gmail} onClose={() => {}} onSaved={() => {}} />);
  await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue('HumanKind x Harbor Yoga - '));
  expect(screen.getByLabelText('To')).toHaveValue('Ana (Owner)');
  expect(screen.getAllByRole('option')).toHaveLength(1);
  const save = container.querySelector('[data-hk-save-draft]');
  expect(save).toBeDisabled(); expect(save.title).toBe('Run lint first.');
  fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Hi Ana — quick one.' } });
  fireEvent.click(container.querySelector('[data-hk-run-lint]'));
  await waitFor(() => expect(container.querySelector('[data-hk-lint-result]')).toBeTruthy());
  expect(container.querySelector('[data-hk-lint-result]').textContent).toMatch(/1 rule to fix/);
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Hi Ana - quick one. Worth a call?' } });
  expect(save.title).toMatch(/changed since the last lint/);
  fireEvent.click(container.querySelector('[data-hk-run-lint]'));
  await waitFor(() => expect(container.querySelector('[data-hk-lint-result]').textContent).toMatch(/Lint passed/));
  expect(save).not.toBeDisabled();
  fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Hi Ana - quick one. Worth a call?!' } });
  expect(save).toBeDisabled();
  expect(lints).toHaveLength(2); expect(lints[1].kind).toBe('cold');
  expect(container.textContent).toMatch(/Nothing here sends/);
  expect(container.textContent).not.toMatch(/@/);
  expect(calls.some(c => /\/drafts(\?|$)/.test(c) && c.startsWith('POST'))).toBe(false);
});
