import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MicrosoftConnection, { describeRun } from './MicrosoftConnection';

// microsoft-connect-v1 Stage 2: the Outlook sync block under the connection card.
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
const connected = { configured: true, email: 'jack@homelover.ai', scopes: ['Mail.Read', 'Calendars.Read', 'User.Read', 'openid'], connected_at: '2026-10-08T10:00:00Z', last_used_at: null, error: null };
const folderRun = (folder, over = {}) => ({ folder, pages: 2, seen: 60, stored: 20, skipped_draft: 1, skipped_internal: 30, skipped_personal: 9, capped: false, error: null, ...over });

afterEach(() => { delete global.fetch; });

test('describeRun: counts per folder, cap and error called out', () => {
  expect(describeRun(folderRun('inbox'))).toBe('Inbox: 60 seen · 20 kept · 40 skipped (30 internal, 9 personal, 1 drafts)');
  expect(describeRun(folderRun('sentitems', { capped: true }))).toMatch(/capped, continues next run$/);
  expect(describeRun(folderRun('calendar', { error: 'Microsoft Graph 403: ErrorAccessDenied' }))).toMatch(/error: Microsoft Graph 403/);
});

test('connected member: summary line, preview + sync buttons, a dry run reports per folder and stores nothing', async () => {
  const calls = [];
  global.fetch = (url, init) => {
    calls.push(`${init?.method || 'GET'} ${url}`);
    if (url === '/api/microsoft/status') return json(200, connected);
    if (url === '/api/microsoft/sync-summary') return json(200, { can_sync: true, sent: 120, received: 340, events: 12, since: '2026-07-10T12:00:00Z', last_synced_at: '2026-10-08T11:00:00Z', pending: ['inbox'], last_run: {} });
    if (url.startsWith('/api/microsoft/sync')) return json(200, { dry_run: true, folders: [folderRun('sentitems'), folderRun('inbox', { capped: true }), folderRun('calendar', { seen: 3, stored: 1, skipped_internal: 1, skipped_personal: 1, skipped_draft: 0 })] });
    return json(404, {});
  };
  render(<MicrosoftConnection />);
  await screen.findByText(/Sent 120 · Received 340 · Events 12 since Jul 10/);
  expect(screen.getByText(/Continues next run: Inbox/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Sync Outlook/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Preview sync/ }));
  await screen.findByText('Preview - nothing stored:');
  expect(calls).toContain('POST /api/microsoft/sync?dry_run=1');
  expect(screen.getByText(/^Inbox: 60 seen · 20 kept .* capped, continues next run$/)).toBeInTheDocument();
  expect(screen.getByText(/^Calendar: 3 seen · 1 kept/)).toBeInTheDocument();
  await waitFor(() => expect(calls.filter(c => c === 'GET /api/microsoft/sync-summary').length).toBe(2));
});

test('viewer: sees the counts, no sync buttons; unmapped mailbox: the refusal is shown', async () => {
  global.fetch = url => url === '/api/microsoft/status' ? json(200, connected)
    : url === '/api/microsoft/sync-summary' ? json(200, { can_sync: false, sent: 0, received: 0, events: 0, since: null, last_synced_at: null, pending: [], last_run: {} }) : json(404, {});
  const first = render(<MicrosoftConnection />);
  await screen.findByText('Sent 0 · Received 0 · Events 0');
  expect(screen.queryByRole('button', { name: /Sync Outlook/ })).toBeNull();
  first.unmount();
  global.fetch = url => url === '/api/microsoft/status' ? json(200, connected)
    : url === '/api/microsoft/sync-summary' ? json(409, { error: "x@y.ai isn't mapped to a workspace mailbox - ask an admin to add it", refused: 'mailbox_not_mapped' }) : json(404, {});
  render(<MicrosoftConnection />);
  await screen.findByText(/isn.t mapped to a workspace mailbox/);
  expect(screen.queryByRole('button', { name: /Sync Outlook/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Preview sync/ })).toBeNull();
});

test('not connected: no Outlook block at all', async () => {
  global.fetch = url => url === '/api/microsoft/status' ? json(200, { ...connected, email: null, scopes: [] }) : json(409, { error: 'Connect Microsoft to use this', needs_microsoft: true });
  render(<MicrosoftConnection />);
  await screen.findByText('○ Not connected');
  expect(screen.queryByTestId('outlook-sync')).toBeNull();
});
