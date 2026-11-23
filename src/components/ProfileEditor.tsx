import { useState } from 'react';
import { Avatar } from './Avatar';
import { Field, inputClass } from './forms';
import { Button, Notice } from './ui';
import { usernameStatusText, useUsernameStatus } from '../hooks/useUsernameStatus';
import { AVATARS, BIO_MAX, normalizeBio, type AvatarKey } from '../domain/avatars';
import { loadProfile, type Profile } from '../state/auth';
import { updateProfile, usernameProblem, type ProfilePatch } from '../services/social';
import { errorMessage } from '../services/supabase';

const titleCase = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Username, avatar and bio. Only changed fields are sent; the server re-validates all of them. */
export function ProfileEditor({
  userId,
  profile,
  onSaved,
  onCancel,
  autoFocus = false,
}: {
  userId: string;
  profile: Profile;
  onSaved?: () => void;
  onCancel?: () => void;
  /** focus the username field on mount (when the editor opens on demand) */
  autoFocus?: boolean;
}) {
  const [username, setUsername] = useState(profile.username);
  const [avatar, setAvatar] = useState<AvatarKey | null>((profile.avatar as AvatarKey | null) ?? null);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'info' | 'warn' } | null>(null);
  const status = useUsernameStatus(username, profile.username);

  const usernameError = usernameProblem(username) ?? (status === 'taken' ? 'That username is taken. Try another.' : null);
  const cleanBio = normalizeBio(bio);
  const bioError = cleanBio.length > BIO_MAX ? `Bio must be at most ${BIO_MAX} characters.` : null;
  const patch: ProfilePatch = {
    ...(username !== profile.username && { username }),
    ...(avatar !== (profile.avatar ?? null) && { avatar }),
    ...(cleanBio !== (profile.bio ?? '') && { bio: cleanBio || null }),
  };
  const dirty = Object.keys(patch).length > 0;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || usernameError || bioError) return;
    setBusy(true);
    setMsg(null);
    try {
      await updateProfile(userId, patch);
      await loadProfile();
      setMsg({ text: 'Profile saved.', tone: 'info' });
      onSaved?.();
    } catch (err) {
      setMsg({ text: errorMessage(err), tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="space-y-5" aria-label="Edit profile">
      <Field
        label="Username"
        name="username"
        autoFocus={autoFocus}
        autoComplete="username"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={20}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        error={username !== profile.username ? usernameError : null}
        hint="3–20 letters, numbers or underscores. Your public profile link changes with it."
        status={username !== profile.username && !usernameError ? usernameStatusText(status) : null}
      />

      <fieldset>
        <legend className="text-sm text-sub">Avatar</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {[null, ...AVATARS].map((a) => (
            <label key={a ?? 'initials'} className="cursor-pointer" title={a ? titleCase(a) : 'Initials'}>
              <input type="radio" name="avatar" className="peer sr-only" checked={avatar === a} onChange={() => setAvatar(a)} aria-label={a ? titleCase(a) : 'Initials'} />
              <span className="block rounded-full p-0.5 ring-2 ring-transparent transition peer-checked:ring-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
                <Avatar avatar={a} username={username || profile.username} />
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="profile-bio" className="block text-sm text-sub">
          Bio <span className="text-xs">(optional)</span>
        </label>
        <textarea
          id="profile-bio"
          rows={2}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          aria-describedby="profile-bio-count"
          aria-invalid={bioError ? true : undefined}
          className={`${inputClass} resize-none`}
          placeholder="A line about you, e.g. “Learning to touch type, 60 wpm goal.”"
        />
        <p id="profile-bio-count" className={`mt-1 text-xs ${bioError ? 'text-error' : 'text-sub'}`}>
          {bioError ?? `${cleanBio.length}/${BIO_MAX} characters. Shown on your public profile.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || !dirty || Boolean(usernameError) || Boolean(bioError) || status === 'checking'}>
          {busy ? 'Saving…' : 'Save profile'}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </form>
  );
}
