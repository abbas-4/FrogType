/** Built-in avatar keys. Must match the profiles_avatar_check constraint in supabase/migrations/20261124000000_account_profiles.sql. */
export const AVATARS = ['frog', 'cat', 'dog', 'bird', 'fish', 'rabbit', 'turtle', 'squirrel', 'snail', 'bug', 'panda', 'ghost'] as const;
export type AvatarKey = (typeof AVATARS)[number];

export const isAvatar = (v: unknown): v is AvatarKey => typeof v === 'string' && (AVATARS as readonly string[]).includes(v);

export const BIO_MAX = 160;

/** Collapses whitespace (the server rejects control characters such as newlines) and trims. Empty means "no bio". */
export const normalizeBio = (bio: string) => bio.replace(/\s+/g, ' ').trim();
