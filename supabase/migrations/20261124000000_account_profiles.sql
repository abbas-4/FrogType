-- Account system: profile avatar + bio, username availability check, protected profile updates.
-- Forward-only and additive: never edit 20261122000000_init.sql or 20261123000000_security_hardening.sql.
-- Every function uses SET search_path = '' with schema-qualified names, and EXECUTE is granted explicitly
-- (default privileges from the hardening migration keep new objects private).

-- ================================================================ 1. profile fields
-- avatar: one key from the app's built-in collection (src/domain/avatars.ts); null = initials.
-- bio: optional, one line, 160 characters max, no control characters.
alter table public.profiles
  add column avatar text constraint profiles_avatar_check
    check (avatar is null or avatar in ('frog', 'cat', 'dog', 'bird', 'fish', 'rabbit', 'turtle', 'squirrel', 'snail', 'bug', 'panda', 'ghost')),
  add column bio text constraint profiles_bio_check
    check (bio is null or (char_length(bio) between 1 and 160 and bio !~ '[[:cntrl:]]'));

-- Column-level only: id, created_at and anything added later stay read-only for clients.
grant update (avatar, bio) on public.profiles to authenticated;

-- Normalises the bio and rate-limits username changes (squatting / impersonation churn).
-- Only fires for client updates: column grants already stop clients from touching id or created_at.
create or replace function public.ft_profile_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.bio := nullif(btrim(new.bio), '');
  if new.username is distinct from old.username and (select auth.uid()) is not null then
    perform public.ft_rate_limit((select auth.uid()), 'username:day', 5, interval '1 day');
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.ft_profile_guard();

-- ================================================================ 2. username availability
-- Fixed-window counters for callers without an account (sign-up form). Internal only: RLS on, no policies, no grants.
create table public.anon_rate_limits (
  action text primary key,
  window_start timestamptz not null,
  hits int not null
);
alter table public.anon_rate_limits enable row level security;

-- Sign-up and rename helper. Returns false for invalid formats, so callers cannot tell "invalid" from "taken"
-- without validating the format themselves (the client does). A user's own current name counts as available.
-- Rate limits: 60/min per account; one shared 300/min bucket for all anonymous callers, which caps bulk
-- enumeration of usernames. If the bucket is exhausted the check errors and the form falls back to the
-- sign-up trigger, which never fails over a taken name (it assigns frog_xxxxxxxx instead).
create or replace function public.username_available(p_username text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_hits int;
begin
  if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,20}$' then return false; end if;
  if v_user is not null then
    perform public.ft_rate_limit(v_user, 'username-check:min', 60, interval '1 minute');
  else
    insert into public.anon_rate_limits as r (action, window_start, hits) values ('username-check', clock_timestamp(), 1)
    on conflict (action) do update set
      hits = case when r.window_start <= clock_timestamp() - interval '1 minute' then 1 else r.hits + 1 end,
      window_start = case when r.window_start <= clock_timestamp() - interval '1 minute' then clock_timestamp() else r.window_start end
    returning hits into v_hits;
    if v_hits > 300 then
      raise exception 'rate limited: too many requests, try again later' using errcode = 'P0001', hint = 'username-check';
    end if;
  end if;
  return not exists (select 1 from public.profiles where lower(username) = lower(p_username) and id is distinct from v_user);
end $$;

-- ================================================================ 3. public profile
-- Same contract as 20261123000000 plus avatar and bio. Private profiles still return null to everyone but the owner.
create or replace function public.get_public_profile(p_username text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  pr public.profiles;
  v_streak int;
begin
  if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,20}$' then return null; end if;
  select * into pr from public.profiles where lower(username) = lower(p_username);
  if pr.id is null or (not pr.is_public and pr.id is distinct from (select auth.uid())) then return null; end if;
  with d as (select distinct (submitted_at at time zone 'utc')::date as day from public.typing_tests where user_id = pr.id and verified),
       g as (select day, day - (row_number() over (order by day))::int as grp from d),
       islands as (select max(day) as last_day, count(*) as len from g group by grp)
  select coalesce((select len from islands where last_day >= (now() at time zone 'utc')::date - 1 order by last_day desc limit 1), 0)
  into v_streak;
  -- Public numbers come from server-verified records only; unverified XP is reported separately.
  return jsonb_build_object(
    'username', pr.username,
    'avatar', pr.avatar,
    'bio', pr.bio,
    'created_at', pr.created_at,
    'total_xp', coalesce((select sum(amount) from public.xp_transactions where user_id = pr.id and verified), 0),
    'unverified_xp', coalesce((select sum(amount) from public.xp_transactions where user_id = pr.id and not verified), 0),
    'best_wpm', coalesce((select max(wpm) from public.typing_tests where user_id = pr.id and verified), 0),
    'avg_accuracy', coalesce((select round(avg(accuracy), 2) from public.typing_tests where user_id = pr.id and verified), 0),
    'total_tests', (select count(*) from public.typing_tests where user_id = pr.id and not imported),
    'verified_tests', (select count(*) from public.typing_tests where user_id = pr.id and verified),
    'achievements', coalesce((select jsonb_agg(achievement_id order by achievement_id) from public.user_achievements where user_id = pr.id and verified), '[]'),
    'current_streak', v_streak
  );
end $$;

-- ================================================================ 4. grants
revoke execute on function public.ft_profile_guard() from public, anon, authenticated;
revoke execute on function public.username_available(text) from public, anon, authenticated;
revoke execute on function public.get_public_profile(text) from public, anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.get_public_profile(text) to anon, authenticated;
