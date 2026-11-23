-- New accounts start with a public profile and a leaderboard listing; each user can turn either off in Settings.
-- Forward-only: earlier migrations stay untouched. There is deliberately no UPDATE here, so every existing
-- account keeps the preferences it already saved.

alter table public.profiles alter column is_public set default true, alter column show_on_leaderboard set default true;

-- Sign-up no longer carries privacy choices: the column defaults above are the single source, and any
-- public_profile / show_on_leaderboard sign-up metadata is ignored. Visibility changes go through the owner's own
-- row (RLS "profiles: update own" + the column grant), and get_leaderboard / get_public_profile read the flags live.
-- CREATE OR REPLACE keeps the function's existing (revoked) privileges.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  wanted text := new.raw_user_meta_data ->> 'username';
  fallback text := 'frog_' || substr(md5(new.id::text), 1, 8);
begin
  if wanted is null or wanted !~ '^[A-Za-z0-9_]{3,20}$' then wanted := fallback; end if;
  begin
    insert into public.profiles (id, username) values (new.id, wanted);
  exception when unique_violation then -- taken (or raced): never fail the sign-up over a username
    insert into public.profiles (id, username) values (new.id, fallback);
  end;
  return new;
end $$;
