import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { MIN_PASSWORD_LENGTH } from '../services/social';

export const inputClass =
  'mt-1 w-full rounded-lg border border-transparent bg-surface-2 px-3 py-2 text-text placeholder:text-sub/70 focus:border-brand/60 focus:outline-none aria-[invalid=true]:border-error/60 disabled:opacity-60';

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  label: string;
  /** shown under the field; replaced by `error` when there is one */
  hint?: ReactNode;
  error?: string | null;
  /** status line (e.g. "Username is available") announced politely */
  status?: ReactNode;
  /** element placed inside the field on the right (e.g. the show/hide button) */
  adornment?: ReactNode;
};

/** Labelled input with its hint/error wired to aria-describedby, and aria-invalid when there is an error. */
export function Field({ label, hint, error, status, adornment, 'aria-describedby': extra, ...input }: FieldProps) {
  const id = useId();
  const describedBy = [error || hint ? `${id}-msg` : null, status ? `${id}-status` : null, extra].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-sub">
        {label}
      </label>
      <div className="relative">
        <input id={id} className={`${inputClass} ${adornment ? 'pr-11' : ''}`} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
        {adornment && <div className="absolute inset-y-0 right-1 mt-1 flex items-center">{adornment}</div>}
      </div>
      {/* Always mounted so screen readers announce messages that appear later (e.g. "That username is taken"). */}
      <p id={`${id}-status`} className={status ? 'mt-1 text-xs' : 'sr-only'} aria-live="polite">
        {status}
      </p>
      <p id={`${id}-msg`} className={error || hint ? `mt-1 text-xs ${error ? 'text-error' : 'text-sub'}` : 'sr-only'} aria-live="polite">
        {error || hint}
      </p>
    </div>
  );
}

/** Password input with a show/hide toggle. The toggle is a real button with a state-describing label. */
export function PasswordField(props: Omit<FieldProps, 'type' | 'adornment'>) {
  const [shown, setShown] = useState(false);
  return (
    <Field
      {...props}
      type={shown ? 'text' : 'password'}
      maxLength={props.maxLength ?? 72}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      adornment={
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? `Hide ${props.label.toLowerCase()}` : `Show ${props.label.toLowerCase()}`}
          aria-pressed={shown}
          className="flex h-9 w-9 items-center justify-center rounded-md text-sub hover:text-text focus-visible:text-brand"
        >
          {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      }
    />
  );
}

/** Live checklist for the password policy (mirrors passwordProblem and supabase/config.toml). */
export function PasswordRules({ password, id }: { password: string; id?: string }) {
  const rules = [
    [`At least ${MIN_PASSWORD_LENGTH} characters`, password.length >= MIN_PASSWORD_LENGTH && password.length <= 72],
    ['An uppercase letter', /[A-Z]/.test(password)],
    ['A lowercase letter', /[a-z]/.test(password)],
    ['A number', /[0-9]/.test(password)],
  ] as const;
  return (
    <ul id={id} className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs" aria-label="Password requirements">
      {rules.map(([text, ok]) => (
        <li key={text} className={ok ? 'text-brand' : 'text-sub'}>
          <span aria-hidden="true">{ok ? '✓' : '·'}</span> {text}
          <span className="sr-only">{ok ? ' (met)' : ' (not met yet)'}</span>
        </li>
      ))}
    </ul>
  );
}
