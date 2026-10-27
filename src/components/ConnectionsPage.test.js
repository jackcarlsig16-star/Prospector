import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConnectionsPage, { describeRun } from './ConnectionsPage';

// shell-facelift-v1 Stage 3: the three provider cards on one page. The Microsoft
// cases come from microsoft-connect-v1 Stage 2 (the Outlook sync block) unchanged.
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
const connected = { configured: true, email: 'jack@homelover.ai', scopes: ['Mail.Read', 'Calendars.Read', 'User.Read', 'openid'], connected_at: '2026-10-08T10:00:00Z', last_used_at: null, error: null };
const folderRun = (folder, over = {}) => ({ folder, pages: 2, seen: 60, stored: 20, skipped_draft: 1, skipped_internal: 30, skipped_personal: 9, capped: false, error: null, ...over });
const page = (props = {}) => render(<ConnectionsPage businesses={[]} {...props} />);

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
  page({ microsoftResult: { ok: true, text: 'Microsoft connected' } });
  await screen.findByText(/Sent 120 · Received 340 · Events 12 since Jul 10/);
  expect(screen.getByText('Microsoft connected')).toBeInTheDocument();
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
  const first = page();
  await screen.findByText('Sent 0 · Received 0 · Events 0');
  expect(screen.queryByRole('button', { name: /Sync Outlook/ })).toBeNull();
  first.unmount();
  global.fetch = url => url === '/api/microsoft/status' ? json(200, connected)
    : url === '/api/microsoft/sync-summary' ? json(409, { error: "x@y.ai isn't mapped to a workspace mailbox - ask an admin to add it", refused: 'mailbox_not_mapped' }) : json(404, {});
  page();
  await screen.findByText(/isn.t mapped to a workspace mailbox/);
  expect(screen.queryByRole('button', { name: /Sync Outlook/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Preview sync/ })).toBeNull();
});

test('not connected: no Outlook block, no sync-summary call, Connect Microsoft', async () => {
  const calls = [];
  global.fetch = url => { calls.push(url); return url === '/api/microsoft/status' ? json(200, { ...connected, email: null, scopes: [] }) : json(409, { error: 'Connect Microsoft to use this', needs_microsoft: true }); };
  page();
  await screen.findByRole('button', { name: 'Connect Microsoft →' });
  expect(screen.queryByTestId('outlook-sync')).toBeNull();
  expect(calls).not.toContain('/api/microsoft/sync-summary');
});

test('Google (mailbox-connections-v1 REV2): the tether map replaces the card - own accounts with Default, workspaces with Link a mailbox, the connect-another URL carries account=new', async () => {
  const assign = jest.fn();
  delete window.location; window.location = { pathname: '/', search: '', assign };
  const HK = '981b790c-a3b0-4265-b32e-1f701d5731ff';
  const mailboxes = { accounts: [{ id: '11111111-1111-4111-8111-111111111111', provider: 'google', email: 'jack.personal@example.test', is_default: true, features: ['gmail', 'calendar'], state: 'ok', error_at: null, last_used_at: null, linked_business_ids: [] }], microsoft: null, apollo: [], workspaces: [{ id: HK, name: 'HumanKind', color: '#22c55e', role: 'owner', google_link: null, microsoft_derived: [], apollo_derived: false }] };
  const calls = [];
  global.fetch = (url, init) => { calls.push(`${init?.method || 'GET'} ${url}`); return url === '/api/mailboxes' ? json(200, mailboxes) : url === '/api/microsoft/status' ? json(200, { ...connected, email: null, scopes: [] }) : json(404, {}); };
  page({ businesses: [{ id: HK, name: 'HumanKind', features: { hk_sales: true } }] });
  await screen.findByText('jack.personal@example.test');
  expect(screen.getByText('Default')).toBeInTheDocument();
  expect(screen.getByText('Personal tools')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Link a mailbox' })).toBeInTheDocument();
  expect(screen.getByText(/Every mailbox you connected, and the exact workspace it works for/)).toBeInTheDocument();
  expect(calls).not.toContain('GET /api/google/status');
  fireEvent.click(screen.getByRole('button', { name: '+ Connect another Google account' }));
  expect(assign).toHaveBeenCalledWith('/api/google/connect?feature=gmail&return=%2F&account=new');
  fireEvent.click(screen.getByRole('button', { name: 'Link a mailbox' }));
  await screen.findByText('Which mailbox should HumanKind use?');
  expect(screen.getByText(/Your default account\. HumanKind drafts would land in your personal Drafts\./)).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: '+ Connect another Google account' }).at(-1));
  expect(assign).toHaveBeenLastCalledWith(`/api/google/connect?feature=gmail&return=%2F&account=new&business=${HK}&purposes=drafts%2Cinbox`);
});


test('Apollo: mailboxes + last sync per sales workspace from the snapshot routes, read-only; none without the sales module', async () => {
  global.fetch = url => url === '/api/sales/b1/entities' ? json(200, { sequences: [], mailboxes: [{ id: 'm1', email: 'one@x.com', active: true, last_synced_at: '2026-10-08T11:00:00Z' }, { id: 'm2', email: 'two@x.com', active: false, unlink_error_code: 'needs_reauth' }] })
    : url === '/api/sales/b1/runs?limit=1' ? json(200, { runs: [{ status: 'success', finished_at: '2026-10-08T11:05:00Z', counts: { apollo_calls: 7 } }] })
    : json(409, {});
  page({ businesses: [{ id: 'b1', name: 'HomeLover', features: { goals_sales: true } }, { id: 'b2', name: 'Plain', features: {} }] });
  await screen.findByText('one@x.com');
  expect(screen.getByText('two@x.com')).toBeInTheDocument();
  expect(screen.getByText('needs_reauth')).toBeInTheDocument();
  expect(screen.getByText(/Last sync Oct 8, .* · 7 Apollo calls/)).toBeInTheDocument();
  expect(screen.queryByText('Plain')).toBeNull();
  expect(screen.getByText('one@x.com').closest('[data-provider="apollo"]').querySelectorAll('button').length).toBe(0);
});

// FIX connections-mailbox-status-v1: one rule (mailboxConnectionProblem) for
// the Apollo pill and each row, so Connections agrees with Mailbox Health.
// Apollo keeps unlink_error_code after a reconnect - history, not a ✕.
test('Apollo: a leftover unlink_error_code on an active mailbox is hover history, not ✕; inactive and needs_reauth_at are ✕', async () => {
  global.fetch = url => url === '/api/sales/b1/entities' ? json(200, { sequences: [], mailboxes: [
    { id: 'm1', email: 'one@x.com', active: true, needs_reauth_at: null, unlink_error_code: 'auth_token_expired', inactive_reason: 'old grant error for one@x.com', last_synced_at: '2026-10-15T14:52:00Z', snapshot_at: '2026-10-15T14:59:00Z' },
    { id: 'm2', email: 'two@x.com', active: false, unlink_error_code: null },
    { id: 'm3', email: 'three@x.com', active: true, needs_reauth_at: '2026-10-14T00:00:00Z' },
  ] }) : url === '/api/sales/b1/runs?limit=1' ? json(200, { runs: [] }) : json(409, {});
  page({ businesses: [{ id: 'b1', name: 'HomeLover', features: { goals_sales: true } }] });
  await screen.findByText('one@x.com');
  const pillOf = email => screen.getByText(email).parentElement.querySelector('[data-status]');
  expect(pillOf('one@x.com').dataset.status).toBe('ok');
  expect(pillOf('one@x.com')).toHaveTextContent('Active');
  expect(screen.queryByText('auth_token_expired')).toBeNull();
  const history = screen.getByText('old error');
  expect(history).toHaveAttribute('title', 'Last error from Apollo: auth_token_expired');
  expect(history.title).not.toMatch(/@/);
  expect(screen.queryByText(/old grant error/)).toBeNull();
  expect(pillOf('two@x.com').dataset.status).toBe('bad');
  expect(pillOf('two@x.com')).toHaveTextContent('Inactive');
  expect(pillOf('three@x.com').dataset.status).toBe('bad');
  expect(pillOf('three@x.com')).toHaveTextContent('Needs re-auth');
  expect(screen.getByText('Needs attention')).toBeInTheDocument();
});

test('Apollo: only a leftover code across the workspace -> the card pill is Connected', async () => {
  global.fetch = url => url === '/api/sales/b1/entities' ? json(200, { sequences: [], mailboxes: [
    { id: 'm1', email: 'one@x.com', active: true, unlink_error_code: 'auth_token_expired', last_synced_at: '2026-10-15T14:52:00Z', snapshot_at: '2026-10-15T14:59:00Z' },
  ] }) : url === '/api/sales/b1/runs?limit=1' ? json(200, { runs: [] }) : json(409, {});
  page({ businesses: [{ id: 'b1', name: 'HomeLover', features: { goals_sales: true } }] });
  await screen.findByText('one@x.com');
  expect(screen.getByText('Connected')).toBeInTheDocument();
  expect(screen.queryByText('Needs attention')).toBeNull();
  expect(screen.getByText('one@x.com').closest('[data-provider="apollo"]').querySelector('[data-status="bad"]')).toBeNull();
});
