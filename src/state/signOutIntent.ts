// Set just before this tab signs out on purpose, so the SIGNED_OUT that follows is not reported as an ended session.
let expected = false;

/** Marks the next sign-out as user-initiated. Returns an undo for when the sign-out call fails. */
export function expectSignOut(): () => void {
  expected = true;
  return () => {
    expected = false;
  };
}

/** Reads and clears the flag (called once per SIGNED_OUT). */
export function takeExpectedSignOut(): boolean {
  const was = expected;
  expected = false;
  return was;
}
