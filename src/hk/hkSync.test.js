import { syncPillState, pageloadDue, relative, PAGELOAD_GUARD_MS } from './hkSync';
import { canSave, kindsAvailable, subjectFor, contactWithEmail } from './brands/composerRules';

// hkos-gmail-connect-v1 Stage 3 - sync pill states, the page-load guard, the composer's gating.
const NOW = Date.UTC(2026, 9, 26, 20);
const linked = over => ({ mailbox: { linked: true, state: 'ok', email: 'x@example.invalid' }, last_run: null, sync_state: null, ...over });

test('pill: not linked -> Link your Gmail; flagged -> amber reconnect; syncing; never synced; synced relative; failed', () => {
  expect(syncPillState(null)).toBeNull();
  expect(syncPillState({ mailbox: { linked: false } })).toEqual({ tone: 'grey', text: 'Link your Gmail', action: 'connections' });
  expect(syncPillState(linked({ mailbox: { linked: true, state: 'needs_reconnect' } }))).toEqual({ tone: 'amber', text: 'Gmail needs reconnect', action: 'connections' });
  expect(syncPillState(linked(), true).text).toBe('Syncing');
  expect(syncPillState(linked(), false, NOW)).toEqual({ tone: 'grey', text: 'Gmail linked, not synced yet', action: 'sync' });
  expect(syncPillState(linked({ sync_state: { last_synced_at: new Date(NOW - 7 * 60e3).toISOString() } }), false, NOW)).toEqual({ tone: 'green', text: 'Gmail synced 7 min ago', action: 'sync' });
  expect(syncPillState(linked({ last_run: { status: 'error' } }), false, NOW).text).toBe('Gmail sync failed');
  expect(syncPillState(linked({ sync_state: { last_synced_at: new Date(NOW - 7 * 60e3).toISOString() }, badges: { drafts: 0, replies: 0, tracked: 0 } }), false, NOW).text).toBe('Gmail synced · nothing tracked yet');
  expect(syncPillState(linked({ sync_state: { last_synced_at: new Date(NOW - 7 * 60e3).toISOString() }, badges: { tracked: 3 } }), false, NOW).text).toBe('Gmail synced 7 min ago');
  expect([relative(new Date(NOW - 30e3).toISOString(), NOW), relative(new Date(NOW - 3 * 3600e3).toISOString(), NOW), relative(new Date(NOW - 49 * 3600e3).toISOString(), NOW)]).toEqual(['just now', '3 h ago', '2 d ago']);
  expect(syncPillState(linked()).text).not.toMatch(/[–—]/);
});

test('page-load guard: due when never run or older than 60 min', () => {
  expect(pageloadDue(null, NOW)).toBe(true);
  expect(pageloadDue(NOW - PAGELOAD_GUARD_MS + 1000, NOW)).toBe(false);
  expect(pageloadDue(NOW - PAGELOAD_GUARD_MS - 1000, NOW)).toBe(true);
});

test('composer: kinds need a sent email first; subject prefilled from the format; primary contact with an email wins', () => {
  expect(kindsAvailable([])).toEqual(['cold']);
  expect(kindsAvailable([{ state: 'drafted', channel: 'email' }])).toEqual(['cold']);
  expect(kindsAvailable([{ state: 'sent', channel: 'email' }])).toEqual(['cold', 'bump', 'final', 'reply']);
  expect(subjectFor('HumanKind x [Brand] - [descriptor]', 'Harbor Yoga')).toBe('HumanKind x Harbor Yoga - ');
  expect(subjectFor(null, 'Harbor Yoga')).toBe('HumanKind x Harbor Yoga - ');
  expect(contactWithEmail([{ id: 'a', email: null, is_primary: true }, { id: 'b', email: 'b@x.invalid' }]).id).toBe('b');
  expect(contactWithEmail([{ id: 'a', email: null }])).toBeNull();
});

test('composer: Save opens only after a clean lint on the current text with a recipient', () => {
  const base = { linted: true, problems: [], lintedText: 'abc', currentText: 'abc', hasRecipient: true };
  expect(canSave(base)).toEqual({ ok: true, why: null });
  expect(canSave({ ...base, hasRecipient: false }).why).toMatch(/No contact with an email/);
  expect(canSave({ ...base, linted: false }).why).toBe('Run lint first.');
  expect(canSave({ ...base, currentText: 'abd' }).why).toMatch(/changed since the last lint/);
  expect(canSave({ ...base, problems: [{ rule: 'dash', level: 'reject' }, { rule: 'subject_format', level: 'warn' }] }).why).toBe('1 rule to fix first.');
  expect(canSave({ ...base, problems: [{ rule: 'subject_format', level: 'warn' }] }).ok).toBe(true);
});
