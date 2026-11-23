/** Brand mark (frog keycap, same file as the favicon) plus the FrogType wordmark. */
export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <img src="/favicon.svg" alt="" width={32} height={32} className="h-8 w-8 shrink-0" />
      <span className="text-xl font-semibold tracking-tight text-text">
        Frog<span className="text-brand">Type</span>
      </span>
    </span>
  );
}
