/** Only same-app paths: a crafted `from` must never send someone to another site after signing in. */
export function safeReturnPath(from: unknown): string {
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/\\') ? from : '/profile';
}
