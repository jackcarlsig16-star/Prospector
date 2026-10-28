import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import LoginPage, { withTimeout, RESET_TIMEOUT_MS, RESET_SLOW_NOTICE, safeNextPath } from './LoginPage';
import { supabase } from '../../utils/supabase';

// FIX pipeline-quick-fixes-v1 C1 - Forgot password never hangs: a reset request that never settles frees the button after
// 15 s with the slow notice; an error shows its message; a reply shows the usual notice. The Supabase client is a mock -
// no real reset email is ever sent.
jest.mock('../../utils/supabase', () => ({ supabase: { auth: { resetPasswordForEmail: jest.fn(), signInWithPassword: jest.fn(), signInWithOAuth: jest.fn() } } }));

const forgot = async () => {
  render(<LoginPage next="/" />);
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'someone@zz.example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
};

test('withTimeout: a settled promise wins; a hung one answers timedOut after the delay; a rejection becomes { error }', async () => {
  jest.useFakeTimers();
  await expect(withTimeout(Promise.resolve({ error: null }), 100)).resolves.toEqual({ error: null });
  const hung = withTimeout(new Promise(() => {}), 100);
  jest.advanceTimersByTime(101);
  await expect(hung).resolves.toEqual({ timedOut: true });
  await expect(withTimeout(Promise.reject(new Error('boom')), 100)).resolves.toEqual({ error: new Error('boom') });
  expect(RESET_TIMEOUT_MS).toBe(15000);
  expect(safeNextPath('//evil')).toBe('/');
  jest.useRealTimers();
});

test('a hung reset request: "Working…" for 15 s, then the slow notice and the button is back', async () => {
  jest.useFakeTimers();
  supabase.auth.resetPasswordForEmail.mockReturnValue(new Promise(() => {}));
  await forgot();
  expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
  await act(async () => { jest.advanceTimersByTime(RESET_TIMEOUT_MS + 1); });
  await waitFor(() => expect(screen.getByText(RESET_SLOW_NOTICE)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Send reset link' })).not.toBeDisabled();
  expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('someone@zz.example', { redirectTo: `${window.location.origin}/reset-password` });
  jest.useRealTimers();
});

test('an error shows its message and frees the button; a reply shows the usual notice', async () => {
  supabase.auth.resetPasswordForEmail.mockResolvedValueOnce({ error: { message: 'Email rate limit exceeded' } });
  await forgot();
  expect(await screen.findByText('Email rate limit exceeded')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send reset link' })).not.toBeDisabled();
  supabase.auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  expect(await screen.findByText(/a reset link is on its way/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send reset link' })).not.toBeDisabled();
});
