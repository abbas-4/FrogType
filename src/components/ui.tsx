import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg bg-surface p-5 ${className}`}>{children}</section>;
}

export function Stat({ label, value, hint, big = false }: { label: string; value: ReactNode; hint?: string; big?: boolean }) {
  return (
    <div title={hint}>
      <div className={big ? 'text-2xl leading-none text-sub sm:text-3xl' : 'text-xs tracking-wide text-sub'}>{label}</div>
      <div className={`${big ? 'text-6xl leading-tight sm:text-7xl' : 'text-2xl'} tabular-nums text-brand`}>{value}</div>
    </div>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
            o.value === value ? 'text-brand' : 'text-sub hover:text-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span>
        <span className="block text-text">{label}</span>
        {description && <span className="block text-sm text-sub">{description}</span>}
      </span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden="true"
        className="relative h-6 w-11 shrink-0 rounded-full bg-surface-2 transition-colors peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-text after:transition-transform peer-checked:after:translate-x-5"
      />
    </label>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    primary: 'bg-brand text-bg hover:bg-brand-hover',
    ghost: 'bg-surface-2 text-text hover:bg-surface-2/70',
    danger: 'bg-error/15 text-error hover:bg-error/25',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold text-text">{children}</h1>
      {sub && <p className="mt-1 text-sub">{sub}</p>}
    </header>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${tone === 'warn' ? 'border-error/40 text-error' : 'border-surface-2 text-sub'}`}>
      {children}
    </div>
  );
}
