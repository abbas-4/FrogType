-- Sign in with a username: GoTrue only signs in by email, so the client first trades username + password for the
-- account's email, then signs in with that email as usual. The email is returned only when the password matches,
-- so this never reveals an address to someone who does not already hold the account's password. Unknown names and
-- wrong passwords both return null. Usernames themselves are already public (leaderboards, profiles).
--
-- Uniqueness needs no change here: profiles_username_lower (20261122000000) is a unique index on lower(username),
-- so "Abbas", "abbas" and "ABBAS" can only ever belong to one account, even when two sign-ups race.
--
-- Rate limit: 10 password checks per account per 15 minutes (bcrypt guessing through this RPC bypasses GoTrue's own
-- sign-in limits). Keyed by the account, so rate_limits grows by at most one row per user. Email sign-in is unaffected.
create or replace function public.email_for_sign_in(p_username text, p_password text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_email text;
  v_hash text;
begin
  if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,20}$' or p_password is null or length(p_password) > 72 then
    return null;
  end if;
  select u.id, u.email, u.encrypted_password into v_id, v_email, v_hash
  from public.profiles p join auth.users u on u.id = p.id
  where lower(p.username) = lower(p_username);
  if v_id is null then return null; end if;
  perform public.ft_rate_limit(v_id, 'username-sign-in', 10, interval '15 minutes');
  if coalesce(v_hash, '') = '' or extensions.crypt(p_password, v_hash) is distinct from v_hash then return null; end if;
  return v_email;
end $$;

revoke execute on function public.email_for_sign_in(text, text) from public, anon, authenticated;
grant execute on function public.email_for_sign_in(text, text) to anon, authenticated;
