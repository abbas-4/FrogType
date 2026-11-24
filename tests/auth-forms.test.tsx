// Sign-up, sign-in, resend and reset forms with the auth service mocked (validation helpers stay real).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ResendButton, ResetRequestForm, SignInForm, SignUpForm } from '../src/components/AuthForm';
import { checkUsername, EmailNotConfirmedError, resendConfirmation, resetPassword, signIn, signUp } from '../src/services/social';

vi.mock('../src/services/social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/social')>()),
  checkUsername: vi.fn(),
  signUp: vi.fn(),
  signIn: vi.fn(),
  resendConfirmation: vi.fn(),
  resetPassword: vi.fn(),
}));

const GOOD_PW = 'Good-Passw0rd';

function renderForm(form: React.ReactElement) {
  render(<MemoryRouter>{form}</MemoryRouter>);
  return userEvent.setup();
}

async function fillSignUp(user: ReturnType<typeof userEvent.setup>, v: { email?: string; username?: string; password?: string; confirm?: string }) {
  if (v.email) await user.type(screen.getByLabelText('Email'), v.email);
  if (v.username) await user.type(screen.getByLabelText('Username'), v.username);
  if (v.password) await user.type(screen.getByLabelText('Password'), v.password);
  if (v.confirm) await user.type(screen.getByLabelText('Confirm password'), v.confirm);
}

beforeEach(() => {
  vi.mocked(checkUsername).mockReset().mockResolvedValue('available');
  vi.mocked(signUp).mockReset().mockResolvedValue({ needsConfirmation: true });
  vi.mocked(signIn).mockReset().mockResolvedValue(undefined);
  vi.mocked(resendConfirmation).mockReset().mockResolvedValue(undefined);
  vi.mocked(resetPassword).mockReset().mockResolvedValue(undefined);
});

describe('SignUpForm', () => {
  it('registers and shows the confirmation screen with the email and a resend button in cooldown', async () => {
    const user = renderForm(<SignUpForm />);
    expect(screen.queryByRole('checkbox')).toBeNull(); // no privacy choices at sign-up; they live in Settings → Privacy
    expect(screen.queryByText(/Make my profile public|Show my username and best results|Privacy \(/)).toBeNull();
    await fillSignUp(user, { email: 'new@frog.test', username: 'new_frog', password: GOOD_PW, confirm: GOOD_PW });
    expect(await screen.findByText('✓ Username is available')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    const sent = await screen.findByTestId('signup-sent');
    expect(sent).toHaveTextContent('new@frog.test');
    expect(signUp).toHaveBeenCalledWith('new@frog.test', GOOD_PW, 'new_frog');
    const resend = screen.getByRole('button', { name: /Resend email in \d+s/ });
    expect(resend).toBeDisabled();
  });

  it('shows every validation error and does not call signUp for invalid input', async () => {
    const user = renderForm(<SignUpForm />);
    await fillSignUp(user, { email: 'not-an-email', username: 'bad name!', password: 'short', confirm: 'different' });
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Use only letters, numbers and underscores.')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByText('The passwords do not match.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Email')).toHaveFocus(); // first invalid field
    expect(signUp).not.toHaveBeenCalled();
    expect(checkUsername).not.toHaveBeenCalled(); // malformed names never reach the server
  });

  it('rejects a long but weak password', async () => {
    const user = renderForm(<SignUpForm />);
    await fillSignUp(user, { email: 'a@frog.test', username: 'weak_pw', password: 'alllowercase1', confirm: 'alllowercase1' });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Password needs an uppercase letter, a lowercase letter and a number.')).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it('reports a taken username from the live check and does not sign up', async () => {
    vi.mocked(checkUsername).mockResolvedValue('taken');
    const user = renderForm(<SignUpForm />);
    await fillSignUp(user, { email: 'a@frog.test', username: 'taken_name', password: GOOD_PW, confirm: GOOD_PW });
    expect(await screen.findByText('That username is taken. Try another.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(signUp).not.toHaveBeenCalled();
  });

  it('re-checks the username on submit and stops when it was taken in the meantime', async () => {
    vi.mocked(checkUsername).mockResolvedValueOnce('available').mockResolvedValueOnce('taken');
    const user = renderForm(<SignUpForm />);
    await fillSignUp(user, { email: 'a@frog.test', username: 'race_name', password: GOOD_PW, confirm: GOOD_PW });
    expect(await screen.findByText('✓ Username is available')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('That username is taken. Try another.')).toBeInTheDocument();
    expect(checkUsername).toHaveBeenLastCalledWith('race_name');
    expect(signUp).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Username')).toHaveFocus();
  });

  it('show/hide toggles the password input type and aria-pressed', async () => {
    const user = renderForm(<SignUpForm />);
    const input = screen.getByLabelText('Password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAccessibleName('Hide password');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password'); // independent toggles

    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'password');
  });
});

describe('SignInForm', () => {
  async function submit(user: ReturnType<typeof userEvent.setup>, email = 'me@frog.test', pw = GOOD_PW) {
    await user.type(screen.getByLabelText('Email'), email);
    await user.type(screen.getByLabelText('Password'), pw);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
  }

  it('keeps the session by default', async () => {
    const user = renderForm(<SignInForm />);
    expect(screen.getByRole('checkbox', { name: 'Keep me signed in' })).toBeChecked();
    await submit(user);
    expect(signIn).toHaveBeenCalledWith('me@frog.test', GOOD_PW, true);
  });

  it('passes remember=false when "Keep me signed in" is unchecked', async () => {
    const user = renderForm(<SignInForm />);
    await user.click(screen.getByRole('checkbox', { name: 'Keep me signed in' }));
    expect(screen.getByText(/signed out when you close this tab/)).toBeInTheDocument();
    await submit(user);
    expect(signIn).toHaveBeenCalledWith('me@frog.test', GOOD_PW, false);
  });

  it('shows the error for wrong credentials and no resend button', async () => {
    vi.mocked(signIn).mockRejectedValue(new Error('Incorrect email or password.'));
    const user = renderForm(<SignInForm />);
    await submit(user);
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resend/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('marks the email, not the FrogType username, as the login for password managers', () => {
    renderForm(<SignUpForm />);
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'nickname');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
  });

  it('fills the saved login into the email field and explains a username typed (or autofilled) there', async () => {
    const user = renderForm(<SignInForm />);
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username');
    await user.type(screen.getByLabelText('Email'), 'frog_fan');
    await user.type(screen.getByLabelText('Password'), GOOD_PW);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Sign in with the email address you created your account with, not your username.')).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('does not call signIn without an email and password', async () => {
    const user = renderForm(<SignInForm />);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email address and password.')).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it('offers to resend the confirmation email when the address is unconfirmed, then cools down', async () => {
    vi.mocked(signIn).mockRejectedValue(new EmailNotConfirmedError());
    const user = renderForm(<SignInForm />);
    await submit(user);
    expect(await screen.findByText(/not confirmed yet/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resend confirmation email' }));
    expect(resendConfirmation).toHaveBeenCalledWith('me@frog.test');
    expect(await screen.findByRole('button', { name: 'Resend email in 60s' })).toBeDisabled();
    expect(screen.getByText(/a new link is on its way/)).toBeInTheDocument();
  });
});

describe('ResendButton', () => {
  it('stays disabled during the initial cooldown and counts down to enabled', () => {
    vi.useFakeTimers();
    try {
      render(<ResendButton email="me@frog.test" initialCooldown={2} />);
      expect(screen.getByRole('button', { name: 'Resend email in 2s' })).toBeDisabled();
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByRole('button', { name: 'Resend email in 1s' })).toBeDisabled();
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByRole('button', { name: 'Resend confirmation email' })).toBeEnabled();
      expect(resendConfirmation).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ResetRequestForm', () => {
  it('shows the same generic message whether or not the email has an account', async () => {
    const user = renderForm(<ResetRequestForm />);
    await user.type(screen.getByLabelText('Email'), 'ghost@frog.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(resetPassword).toHaveBeenCalledWith('ghost@frog.test');
    expect(await screen.findByText('If that email has an account, a reset link is on its way.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send again in \d+s/ })).toBeDisabled();
  });
});
