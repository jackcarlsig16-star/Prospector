import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ClaudeConnector from './ClaudeConnector';
import ActivityScreen, { detailText } from './ActivityScreen';

// hkos-mcp-connector-v1 Stage 3 - Settings › Claude connector (URL + Copy, steps, active connections, Revoke, viewer
// note) and Activity's "Claude via connector" rows + action filter, against a recorded fetch. Invented ids only.
const HK = 'biz-hk';
const shell = { me: { user_id: 'u-jack', first_name: 'Jack', role: 'owner' }, members: [{ user_id: 'u-jack', first_name: 'Jack', palette_index: 1 }, { user_id: 'u-pete', first_name: 'Pete', palette_index: 2 }] };
let calls, routes;
const json = (status, body) => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
beforeEach(() => {
  calls = []; routes = {};
  global.fetch = jest.fn((url, init = {}) => {
    const method = init.method || 'GET'; const u = new URL(url, 'http://x'); calls.push(`${method} ${u.pathname}`);
    const hit = routes[`${method} ${u.pathname}`]; if (!hit) return json(404, { error: `no route ${method} ${u.pathname}` });
    return json(200, typeof hit === 'function' ? hit() : hit);
  });
  Object.assign(navigator, { clipboard: { writeText: jest.fn(() => Promise.resolve()) } });
});
const CONN = { family_id: 'fam-1', client_name: 'Claude', created_at: '2026-10-28T18:00:00Z', last_used_at: '2026-10-28T19:00:00Z' };

test('connector card: URL from the server + Copy, the claude.ai steps, active connections, Revoke reloads the list', async () => {
  let list = [CONN];
  routes[`GET /api/hk/${HK}/connector`] = () => ({ mcp_url: 'https://prospector.example/mcp', connections: list, last_call_at: list.length ? CONN.last_used_at : null });
  routes[`POST /api/hk/${HK}/connector/fam-1/revoke`] = () => { list = []; return { revoked: 2 }; };
  const { container } = render(<ClaudeConnector businessId={HK} canEdit />);
  await screen.findByText('https://prospector.example/mcp');
  fireEvent.click(container.querySelector('[data-hk-connector-copy]'));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://prospector.example/mcp');
  expect(container.querySelector('[data-hk-connector-steps]').textContent).toMatch(/Add custom connector/);
  expect(container.querySelector('[data-hk-connection="fam-1"]').textContent).toMatch(/Claude/);
  fireEvent.click(container.querySelector('[data-hk-connector-revoke]'));
  await waitFor(() => expect(container.querySelector('[data-hk-connector-empty]')).toBeTruthy());
  expect(calls).toContain(`POST /api/hk/${HK}/connector/fam-1/revoke`);
  expect(container.textContent).not.toMatch(/[–—]/);
});

test('connector card: a viewer gets a note, no URL, no call', () => {
  const { container } = render(<ClaudeConnector businessId={HK} canEdit={false} />);
  expect(container.querySelector('[data-hk-connector-viewer]')).toBeTruthy();
  expect(container.querySelector('[data-hk-connector-url]')).toBeNull();
  expect(calls).toEqual([]);
});

test('Activity: connector rows read "Claude via connector (Jack)", get words, and the action filter offers Claude connector', async () => {
  routes[`GET /api/hk/${HK}/activity`] = { events: [{ id: 'e1', created_at: '2026-10-28T19:00:00Z', actor_user_id: 'u-jack', actor_kind: 'claude', entity_type: 'brand', entity_id: 'b1', brand_name: 'Bluefin Run Club', action: 'connector.hk_check', detail: { via: 'connector', tool: 'hk_check', ok: true } }, { id: 'e2', created_at: '2026-10-28T19:01:00Z', actor_user_id: 'u-jack', actor_kind: 'claude', entity_type: 'connector', entity_id: null, brand_name: null, action: 'connector.hk_draft_save', detail: { via: 'connector', tool: 'hk_draft_save', ok: false, code: 422 } }] };
  const { container } = render(<ActivityScreen businessId={HK} shell={shell} owner="all" compact={false} onOpenBrand={jest.fn()} />);
  await screen.findByText('Checked brands');
  expect(container.querySelectorAll('[data-hk-actor-connector]').length).toBe(2);
  expect(container.querySelector('[data-hk-actor-connector]').textContent).toBe('CClaude via connector (Jack)');
  expect(screen.getByText('Saved draft')).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Claude connector' }).value).toBe('connector.');
  expect(detailText({ via: 'connector', ok: false, code: 422 })).toBe('refused (422)');
});
