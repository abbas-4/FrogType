/** Wordmark: two "eyes" sitting on the F — a quiet nod to a frog, no mascot. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 select-none" aria-label="FrogType">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="11" cy="12" r="4.5" className="fill-brand" />
        <circle cx="21" cy="12" r="4.5" className="fill-brand" />
        <circle cx="11" cy="12" r="1.6" className="fill-bg" />
        <circle cx="21" cy="12" r="1.6" className="fill-bg" />
        <rect x="6" y="20" width="20" height="3.2" rx="1.6" className="fill-brand" />
      </svg>
      {!compact && (
        <span className="text-xl font-semibold tracking-tight text-text">
          frog<span className="text-brand">type</span>
        </span>
      )}
    </span>
  );
}
