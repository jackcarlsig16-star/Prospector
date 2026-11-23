import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorkPanel from './WorkPanel';

// FIX claude-pack-dossier P5 + P2 - the Claude pane: five ask chips, the objection chip's blank filled from what is
// typed, and Full swapping the record for the uncut dossier under the same ask. Invented pack; 0 server.
const REC = 'Scope: HomeLover · 1 record\n\n# Cloudflare — employer\n\n## People (1)\n- Dana Mayer · VP People\n+ 6 more people\n\n';
const ask = (id, label, line, more = {}) => ({ id, label, text: `${REC}## Ask\n${line}\n`, chars: `${REC}## Ask\n${line}\n`.length, ...more });
const PACK = { records: 1, cut: 6, asks: [
  ask('sequence', 'Write a 3-touch sequence', 'Write a 3-touch outreach sequence.'),
  ask('email', 'Write one email to Dana', 'Write one first email to Dana Mayer.'),
  ask('research', 'Research the account', 'Research this account.'),
  ask('call', 'Prep me for a call', 'Prep me for a call.'),
  ask('objection', 'Handle this objection', 'Help me answer this objection from them: ___', { blank: '___' }),
] };
const row = { key: 'todo:t1', kind: 'todo', id: 't1', text: 'Email the People team', verb: 'draft_email', company: { type: 'employer', id: 'e1', name: 'Cloudflare' }, person: { key: 'prospect:p1', name: 'Dana Mayer' } };
const work = { key: 'todo:t1', verb: 'next_steps', state: 'ready', data: { key: 'todo:t1', verb: 'next_steps', grounds: [], steps: [], prompt_pack: PACK, usage: { calls: 0, cost_usd: null, cap: null } } };
const noop = () => {};

test('P5 + P2: five asks; the objection is what was typed; Full copies the uncut dossier with the same ask and its real length', async () => {
  const copied = [];
  const onFull = jest.fn(() => Promise.resolve('# Cloudflare — employer\n\n## People (7)\n- Dana Mayer · VP People\n- Six More · Directors\n\n## Ask\n'));
  render(<WorkPanel work={work} row={row} canEdit onClose={noop} onRetry={noop} onCopy={async t => { copied.push(t); return true; }} onFull={onFull} onCompose={noop} onDone={noop} onFinish={noop} onAddReply={noop} onAddTodo={noop} onAddPerson={noop} onDraftFor={noop} />);
  const chips = [...document.querySelector('[aria-label="What to ask Claude"]').querySelectorAll('button')].map(b => b.textContent);
  expect(chips).toEqual(['Write a 3-touch sequence', 'Write one email to Dana', 'Research the account', 'Prep me for a call', 'Handle this objection']);
  const prompt = () => document.querySelector('[data-work-prompt]').textContent;
  const chars = () => document.querySelector('[data-work-chars]').textContent;
  expect(prompt().endsWith('## Ask\nWrite a 3-touch outreach sequence.\n')).toBe(true);
  expect(chars()).toBe(PACK.asks[0].chars.toLocaleString('en-US'));
  expect(document.querySelector('[data-work-chars]').parentElement).toHaveTextContent('6 cut to fit');
  expect(document.querySelector('[data-work-objection]')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Handle this objection' }));
  expect(prompt().endsWith('from them: ___\n')).toBe(true);
  fireEvent.change(screen.getByLabelText('The objection'), { target: { value: 'We already have a relocation vendor' } });
  expect(prompt().endsWith('## Ask\nHelp me answer this objection from them: We already have a relocation vendor\n')).toBe(true);
  expect(chars()).toBe(prompt().length.toLocaleString('en-US'));

  fireEvent.click(screen.getByRole('button', { name: 'Full' }));
  await waitFor(() => expect(prompt()).toMatch(/^# Cloudflare — employer\n\n## People \(7\)/));
  expect(onFull).toHaveBeenCalledTimes(1);
  expect(prompt().endsWith('## Ask\nHelp me answer this objection from them: We already have a relocation vendor\n')).toBe(true);
  expect(chars()).toBe(prompt().length.toLocaleString('en-US'));
  expect(screen.getByRole('button', { name: 'Full' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
  await waitFor(() => expect(copied).toEqual([prompt()]));
});
