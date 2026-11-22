-- FrogType initial schema.
-- Principles: RLS on every table; clients may READ their own rows but all WRITES that affect
-- stats, rankings or XP go through SECURITY DEFINER functions that validate input and rate-limit.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  is_public boolean not null default true,
  show_on_leaderboard boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index profiles_username_lower on public.profiles (lower(username));

alter table public.profiles enable row level security;
create policy "profiles: read own or public" on public.profiles for select using (id = auth.uid() or is_public);
create policy "profiles: update own" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
-- Only these columns may change from the client.
revoke update on public.profiles from anon, authenticated;
grant update (username, is_public, show_on_leaderboard) on public.profiles to authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  wanted text := new.raw_user_meta_data ->> 'username';
  chosen text;
begin
  if wanted ~ '^[A-Za-z0-9_]{3,20}$' and not exists (select 1 from profiles where lower(username) = lower(wanted)) then
    chosen := wanted;
  else
    chosen := 'frog_' || substr(md5(new.id::text), 1, 8);
  end if;
  insert into profiles (id, username) values (new.id, chosen);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- catalogs
create table public.lessons (
  id text primary key,
  category text not null,
  title text not null,
  target_wpm int not null,
  target_accuracy int not null
);
alter table public.lessons enable row level security;
create policy "lessons: readable" on public.lessons for select using (true);

create table public.achievements (
  id text primary key,
  title text not null
);
alter table public.achievements enable row level security;
create policy "achievements: readable" on public.achievements for select using (true);

-- ---------------------------------------------------------------- typing tests
create table public.typing_tests (
  id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  mode text not null check (mode in ('time', 'words', 'custom', 'lesson', 'daily')),
  mode2 int not null check (mode2 between 1 and 2000),
  wpm numeric(6, 2) not null check (wpm between 0 and 300),
  raw numeric(6, 2) not null check (raw between 0 and 350),
  accuracy numeric(5, 2) not null check (accuracy between 0 and 100),
  consistency numeric(5, 2) not null check (consistency between 0 and 100),
  chars jsonb not null,
  duration_ms int not null check (duration_ms between 1000 and 3600000),
  words_typed int not null check (words_typed >= 0),
  language text not null check (language in ('english', 'spanish', 'german')),
  punctuation boolean not null,
  numbers boolean not null,
  difficulty text not null check (difficulty in ('easy', 'normal', 'hard')),
  samples jsonb not null default '[]',
  char_stats jsonb not null default '{}',
  bigram_errors jsonb not null default '{}',
  lesson_id text references public.lessons (id),
  daily_date date,
  ranked boolean not null default false,
  imported boolean not null default false
);
create index typing_tests_user_created on public.typing_tests (user_id, created_at desc);
create index typing_tests_user_submitted on public.typing_tests (user_id, submitted_at desc);

alter table public.typing_tests enable row level security;
create policy "tests: read own" on public.typing_tests for select using (user_id = auth.uid());
create policy "tests: delete own" on public.typing_tests for delete using (user_id = auth.uid());
-- no insert/update policies: writes only via submit_test / import_tests

-- ---------------------------------------------------------------- leaderboard (best per user per board)
create table public.leaderboard_entries (
  user_id uuid not null references public.profiles (id) on delete cascade,
  mode text not null,
  mode2 int not null,
  test_id uuid not null references public.typing_tests (id) on delete cascade,
  wpm numeric(6, 2) not null,
  accuracy numeric(5, 2) not null,
  duration_ms int not null,
  created_at timestamptz not null,
  primary key (user_id, mode, mode2)
);
create index leaderboard_board on public.leaderboard_entries (mode, mode2, wpm desc);
alter table public.leaderboard_entries enable row level security;
create policy "leaderboard: read own" on public.leaderboard_entries for select using (user_id = auth.uid());

-- ---------------------------------------------------------------- progress
create table public.lesson_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  lesson_id text not null references public.lessons (id),
  attempts int not null default 0 check (attempts between 0 and 1000000),
  best_wpm numeric(6, 2) not null default 0 check (best_wpm between 0 and 300),
  best_accuracy numeric(5, 2) not null default 0 check (best_accuracy between 0 and 100),
  first_wpm numeric(6, 2) not null default 0 check (first_wpm between 0 and 300),
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
alter table public.lesson_progress enable row level security;
create policy "lesson_progress: read own" on public.lesson_progress for select using (user_id = auth.uid());

create table public.user_achievements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_id text not null references public.achievements (id),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
alter table public.user_achievements enable row level security;
create policy "user_achievements: read own" on public.user_achievements for select using (user_id = auth.uid());

create table public.xp_transactions (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  key text not null check (length(key) <= 80),
  amount int not null check (amount between 0 and 500),
  reason text not null check (length(reason) <= 120),
  created_at timestamptz not null default now(),
  unique (user_id, key)
);
alter table public.xp_transactions enable row level security;
create policy "xp: read own" on public.xp_transactions for select using (user_id = auth.uid());

-- ---------------------------------------------------------------- daily challenges
create table public.daily_challenges (
  challenge_date date primary key,
  version int not null,
  target_wpm int not null,
  target_accuracy int not null,
  created_at timestamptz not null default now()
);
alter table public.daily_challenges enable row level security;
create policy "daily: readable" on public.daily_challenges for select using (true);

create table public.challenge_submissions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_date date not null references public.daily_challenges (challenge_date),
  attempts int not null default 0,
  best_wpm numeric(6, 2) not null default 0,
  best_accuracy numeric(5, 2) not null default 0,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, challenge_date)
);
alter table public.challenge_submissions enable row level security;
create policy "submissions: read own" on public.challenge_submissions for select using (user_id = auth.uid());

-- ---------------------------------------------------------------- friends
create table public.friendships (
  id bigserial primary key,
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));
alter table public.friendships enable row level security;
create policy "friendships: read own" on public.friendships for select using (auth.uid() in (requester, addressee));
create policy "friendships: delete own" on public.friendships for delete using (auth.uid() in (requester, addressee));

-- ================================================================ functions

-- FNV-1a 32-bit, identical to src/engine/random.ts hashString (ASCII input).
create or replace function public.ft_fnv1a(s text) returns bigint
language plpgsql immutable as $$
declare
  h bigint := 2166136261;
  i int;
begin
  for i in 1 .. length(s) loop
    h := h # ascii(substr(s, i, 1));
    h := (h * 16777619) & 4294967295;
  end loop;
  return h;
end $$;

-- Mirrors src/domain/daily.ts so targets are decided by the server, not the client.
create or replace function public.ft_daily_targets(d date, out target_wpm int, out target_accuracy int)
language plpgsql immutable as $$
declare
  h bigint := public.ft_fnv1a('frogtype-daily-v1-' || to_char(d, 'YYYY-MM-DD'));
begin
  target_wpm := 35 + (h % 6)::int * 5;
  target_accuracy := 92 + ((h >> 8) % 5)::int;
end $$;

-- Validates one test payload. Raises on anything malformed or implausible.
create or replace function public.ft_validate_test(p jsonb) returns void
language plpgsql immutable as $$
declare
  v_mode text := p ->> 'mode';
  v_mode2 int := (p ->> 'mode2')::int;
  v_wpm numeric := (p ->> 'wpm')::numeric;
  v_raw numeric := (p ->> 'raw')::numeric;
  v_dur int := (p ->> 'duration_ms')::int;
  v_correct int := (p -> 'chars' ->> 'correct')::int;
  v_words int := (p ->> 'words_typed')::int;
begin
  if v_mode not in ('time', 'words', 'custom', 'lesson', 'daily') then raise exception 'invalid mode'; end if;
  if v_mode = 'time' and abs(v_dur - v_mode2 * 1000) > 1000 then raise exception 'duration does not match time mode'; end if;
  if v_wpm > v_raw + 1 then raise exception 'wpm exceeds raw'; end if;
  -- wpm characters can only come from correct characters plus the spaces after correct words
  if v_wpm * 5 * v_dur / 60000.0 > v_correct + v_words + 5 then raise exception 'wpm inconsistent with characters'; end if;
  if jsonb_typeof(p -> 'samples') <> 'array' or jsonb_array_length(p -> 'samples') > v_dur / 1000 + 2 then raise exception 'invalid samples'; end if;
  if pg_column_size(p) > 65536 then raise exception 'payload too large'; end if;
end $$;

create or replace function public.ft_insert_test(p jsonb, v_user uuid, v_ranked boolean, v_imported boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  inserted int;
begin
  insert into typing_tests (id, user_id, created_at, mode, mode2, wpm, raw, accuracy, consistency, chars, duration_ms, words_typed,
    language, punctuation, numbers, difficulty, samples, char_stats, bigram_errors, lesson_id, daily_date, ranked, imported)
  values ((p ->> 'id')::uuid, v_user, least((p ->> 'created_at')::timestamptz, now()), p ->> 'mode', (p ->> 'mode2')::int,
    (p ->> 'wpm')::numeric, (p ->> 'raw')::numeric, (p ->> 'accuracy')::numeric, (p ->> 'consistency')::numeric,
    jsonb_build_object('correct', (p -> 'chars' ->> 'correct')::int, 'incorrect', (p -> 'chars' ->> 'incorrect')::int,
                       'extra', (p -> 'chars' ->> 'extra')::int, 'missed', (p -> 'chars' ->> 'missed')::int),
    (p ->> 'duration_ms')::int, (p ->> 'words_typed')::int, p ->> 'language', (p ->> 'punctuation')::boolean,
    (p ->> 'numbers')::boolean, p ->> 'difficulty', coalesce(p -> 'samples', '[]'), coalesce(p -> 'char_stats', '{}'),
    coalesce(p -> 'bigram_errors', '{}'), nullif(p ->> 'lesson_id', ''), (p ->> 'daily_date')::date, v_ranked, v_imported)
  on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end $$;

-- Live submission: validated, rate-limited, idempotent. Returns { accepted, ranked }.
create or replace function public.submit_test(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_created timestamptz := (payload ->> 'created_at')::timestamptz;
  v_fresh boolean;
  v_ranked boolean;
  v_mode text := payload ->> 'mode';
  v_mode2 int := (payload ->> 'mode2')::int;
  v_wpm numeric := (payload ->> 'wpm')::numeric;
  v_acc numeric := (payload ->> 'accuracy')::numeric;
  v_daily date := (payload ->> 'daily_date')::date;
  t record;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from typing_tests where user_id = v_user and submitted_at > now() - interval '2 seconds') then
    raise exception 'rate limited: slow down';
  end if;
  if (select count(*) from typing_tests where user_id = v_user and submitted_at > now() - interval '1 day' and not imported) >= 1000 then
    raise exception 'daily submission limit reached';
  end if;
  perform ft_validate_test(payload);

  v_fresh := v_created between now() - interval '15 minutes' and now() + interval '1 minute';
  v_ranked := v_fresh
    and payload ->> 'language' = 'english'
    and v_acc >= 75 and v_wpm <= 250
    and ((v_mode = 'time' and v_mode2 in (15, 30, 60, 120)) or (v_mode = 'words' and v_mode2 in (10, 25, 50, 100)));

  if not ft_insert_test(payload, v_user, v_ranked, false) then
    return jsonb_build_object('accepted', false, 'duplicate', true, 'ranked', false);
  end if;

  if v_ranked then
    insert into leaderboard_entries (user_id, mode, mode2, test_id, wpm, accuracy, duration_ms, created_at)
    values (v_user, v_mode, v_mode2, (payload ->> 'id')::uuid, v_wpm, v_acc, (payload ->> 'duration_ms')::int, v_created)
    on conflict (user_id, mode, mode2) do update
      set test_id = excluded.test_id, wpm = excluded.wpm, accuracy = excluded.accuracy,
          duration_ms = excluded.duration_ms, created_at = excluded.created_at
      where excluded.wpm > leaderboard_entries.wpm;
  end if;

  if v_mode = 'lesson' and payload ->> 'lesson_id' is not null then
    insert into lesson_progress as lp (user_id, lesson_id, attempts, best_wpm, best_accuracy, first_wpm, completed)
    select v_user, l.id, 1, v_wpm, v_acc, v_wpm, (v_wpm >= l.target_wpm and v_acc >= l.target_accuracy)
    from lessons l where l.id = payload ->> 'lesson_id'
    on conflict (user_id, lesson_id) do update set
      attempts = lp.attempts + 1,
      best_wpm = greatest(lp.best_wpm, excluded.best_wpm),
      best_accuracy = greatest(lp.best_accuracy, excluded.best_accuracy),
      completed = lp.completed or excluded.completed,
      updated_at = now();
  end if;

  -- Daily challenge: only for today/yesterday (UTC) and only for fresh submissions; targets come from the server.
  if v_mode = 'daily' and v_fresh and v_daily between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date then
    select * into t from ft_daily_targets(v_daily);
    insert into daily_challenges (challenge_date, version, target_wpm, target_accuracy)
    values (v_daily, 1, t.target_wpm, t.target_accuracy) on conflict do nothing;
    insert into challenge_submissions as cs (user_id, challenge_date, attempts, best_wpm, best_accuracy, completed)
    values (v_user, v_daily, 1, v_wpm, v_acc, v_wpm >= t.target_wpm and v_acc >= t.target_accuracy)
    on conflict (user_id, challenge_date) do update set
      attempts = cs.attempts + 1,
      best_wpm = greatest(cs.best_wpm, excluded.best_wpm),
      best_accuracy = greatest(cs.best_accuracy, excluded.best_accuracy),
      completed = cs.completed or excluded.completed,
      updated_at = now();
  end if;

  return jsonb_build_object('accepted', true, 'ranked', v_ranked);
end $$;

-- One-time migration of pre-account local history. Stored unranked; invalid rows are skipped, not fatal.
create or replace function public.import_tests(payloads jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  p jsonb;
  n int := 0;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(payloads) <> 'array' or jsonb_array_length(payloads) > 200 then raise exception 'send at most 200 tests per call'; end if;
  if (select count(*) from typing_tests where user_id = v_user and imported and submitted_at > now() - interval '1 hour') >= 3000 then
    raise exception 'import limit reached, try again later';
  end if;
  for p in select * from jsonb_array_elements(payloads) loop
    begin
      perform ft_validate_test(p);
      if ft_insert_test(p, v_user, false, true) then n := n + 1; end if;
    exception when others then
      -- skip malformed rows
    end;
  end loop;
  return n;
end $$;

-- Merges client progress. Only keys that reference real server data are accepted, with per-type caps.
create or replace function public.merge_progress(p_xp jsonb, p_achievements jsonb, p_lessons jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  x jsonb;
  k text;
  amt int;
  cap int;
  ok boolean;
  lid text;
  l jsonb;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(p_xp) <> 'array' or jsonb_array_length(p_xp) > 2000 then raise exception 'too many xp entries'; end if;

  for x in select * from jsonb_array_elements(p_xp) loop
    k := x ->> 'key';
    amt := coalesce((x ->> 'amount')::int, 0);
    ok := false;
    if k ~ '^test:[0-9a-f-]{36}$' then
      cap := 300; ok := exists (select 1 from typing_tests where user_id = v_user and id = substr(k, 6)::uuid);
    elsif k ~ '^pr:[0-9a-f-]{36}$' then
      cap := 25; ok := exists (select 1 from typing_tests where user_id = v_user and id = substr(k, 4)::uuid);
    elsif k ~ '^lesson:' then
      cap := 50; ok := exists (select 1 from lessons where id = substr(k, 8));
    elsif k ~ '^daily:\d{4}-\d{2}-\d{2}$' then
      cap := 100; ok := true;
    elsif k ~ '^streak:\d{4}-\d{2}-\d{2}$' then
      cap := 70; ok := true;
    end if;
    if ok and amt between 1 and cap then
      insert into xp_transactions (user_id, key, amount, reason)
      values (v_user, k, amt, left(coalesce(x ->> 'reason', ''), 120))
      on conflict (user_id, key) do nothing;
    end if;
  end loop;

  if jsonb_typeof(p_achievements) = 'object' then
    insert into user_achievements (user_id, achievement_id)
    select v_user, a.id from achievements a where p_achievements ? a.id
    on conflict do nothing;
  end if;

  if jsonb_typeof(p_lessons) = 'object' then
    for lid, l in select * from jsonb_each(p_lessons) loop
      if exists (select 1 from lessons where id = lid) then
        insert into lesson_progress as lp (user_id, lesson_id, attempts, best_wpm, best_accuracy, first_wpm, completed)
        values (v_user, lid,
          least(greatest(coalesce((l ->> 'attempts')::int, 0), 0), 1000000),
          least(greatest(coalesce((l ->> 'bestWpm')::numeric, 0), 0), 300),
          least(greatest(coalesce((l ->> 'bestAccuracy')::numeric, 0), 0), 100),
          least(greatest(coalesce((l ->> 'firstWpm')::numeric, 0), 0), 300),
          coalesce((l ->> 'completed')::boolean, false))
        on conflict (user_id, lesson_id) do update set
          attempts = greatest(lp.attempts, excluded.attempts),
          best_wpm = greatest(lp.best_wpm, excluded.best_wpm),
          best_accuracy = greatest(lp.best_accuracy, excluded.best_accuracy),
          first_wpm = case when lp.first_wpm = 0 then excluded.first_wpm else lp.first_wpm end,
          completed = lp.completed or excluded.completed,
          updated_at = now();
      end if;
    end loop;
  end if;
end $$;

create or replace function public.get_leaderboard(p_scope text, p_mode text, p_mode2 int, p_limit int default 50)
returns table (rank bigint, username text, wpm numeric, accuracy numeric, mode text, mode2 int, duration_ms int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select row_number() over (order by le.wpm desc, le.created_at asc), p.username, le.wpm, le.accuracy, le.mode, le.mode2, le.duration_ms, le.created_at
  from leaderboard_entries le
  join profiles p on p.id = le.user_id
  where le.mode = p_mode and le.mode2 = p_mode2
    and (
      (p_scope = 'global' and p.show_on_leaderboard)
      or (p_scope = 'friends' and auth.uid() is not null and (
        le.user_id = auth.uid()
        or (p.show_on_leaderboard and exists (
          select 1 from friendships f where f.status = 'accepted'
            and ((f.requester = auth.uid() and f.addressee = le.user_id) or (f.addressee = auth.uid() and f.requester = le.user_id))))))
    )
  order by le.wpm desc, le.created_at asc
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function public.list_friends()
returns table (id bigint, username text, status text, direction text)
language sql stable security definer set search_path = public as $$
  select f.id, p.username, f.status, case when f.requester = auth.uid() then 'outgoing' else 'incoming' end
  from friendships f
  join profiles p on p.id = case when f.requester = auth.uid() then f.addressee else f.requester end
  where auth.uid() in (f.requester, f.addressee)
  order by f.status, p.username;
$$;

create or replace function public.send_friend_request(p_username text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_target uuid;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  select id into v_target from profiles where lower(username) = lower(p_username);
  if v_target is null then raise exception 'No user with that username.'; end if;
  if v_target = v_user then raise exception 'You cannot add yourself.'; end if;
  if (select count(*) from friendships where requester = v_user and status = 'pending') >= 50 then
    raise exception 'Too many pending requests.';
  end if;
  -- If they already asked us, accept instead of duplicating.
  update friendships set status = 'accepted' where requester = v_target and addressee = v_user and status = 'pending';
  if found then return; end if;
  insert into friendships (requester, addressee) values (v_user, v_target);
exception when unique_violation then
  raise exception 'You are already friends or a request is pending.';
end $$;

create or replace function public.respond_friend_request(p_id bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_accept then
    update friendships set status = 'accepted' where id = p_id and addressee = auth.uid() and status = 'pending';
  else
    delete from friendships where id = p_id and addressee = auth.uid() and status = 'pending';
  end if;
  if not found then raise exception 'Request not found.'; end if;
end $$;

create or replace function public.get_public_profile(p_username text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  pr profiles;
  v_streak int;
begin
  select * into pr from profiles where lower(username) = lower(p_username);
  if pr.id is null or (not pr.is_public and pr.id is distinct from auth.uid()) then return null; end if;
  with d as (select distinct (created_at at time zone 'utc')::date as day from typing_tests where user_id = pr.id),
       g as (select day, day - (row_number() over (order by day))::int as grp from d),
       islands as (select max(day) as last_day, count(*) as len from g group by grp)
  select coalesce((select len from islands where last_day >= (now() at time zone 'utc')::date - 1 order by last_day desc limit 1), 0)
  into v_streak;
  return jsonb_build_object(
    'username', pr.username,
    'created_at', pr.created_at,
    'total_xp', coalesce((select sum(amount) from xp_transactions where user_id = pr.id), 0),
    'best_wpm', coalesce((select max(wpm) from typing_tests where user_id = pr.id), 0),
    'avg_accuracy', coalesce((select round(avg(accuracy), 2) from typing_tests where user_id = pr.id), 0),
    'total_tests', (select count(*) from typing_tests where user_id = pr.id),
    'achievements', coalesce((select jsonb_agg(achievement_id) from user_achievements where user_id = pr.id), '[]'),
    'current_streak', v_streak
  );
end $$;

-- Postgres grants EXECUTE to PUBLIC by default; lock everything down, then grant explicitly.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.submit_test(jsonb) to authenticated;
grant execute on function public.import_tests(jsonb) to authenticated;
grant execute on function public.merge_progress(jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.list_friends() to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(bigint, boolean) to authenticated;
grant execute on function public.get_leaderboard(text, text, int, int) to anon, authenticated;
grant execute on function public.get_public_profile(text) to anon, authenticated;

-- ---------------------------------------------------------------- seed catalogs (keep in sync with src/domain)
insert into public.achievements (id, title) values
  ('first-test', 'First Test Completed'), ('tests-10', '10 Tests Completed'), ('tests-100', '100 Tests Completed'),
  ('wpm-50', '50 WPM Club'), ('wpm-75', '75 WPM Club'), ('wpm-100', '100 WPM Club'), ('perfect', 'Perfect Accuracy'),
  ('streak-7', '7-Day Streak'), ('streak-30', '30-Day Streak'), ('daily-champion', 'Daily Challenge Champion'),
  ('daily-7', 'Daily Regular'), ('first-lesson', 'Student'), ('all-lessons', 'Graduate');

insert into public.lessons (id, category, title, target_wpm, target_accuracy) values
  ('beginner-1', 'beginner', 'First keys: F and J', 10, 90),
  ('beginner-2', 'beginner', 'Index fingers', 12, 90),
  ('beginner-3', 'beginner', 'First words', 15, 90),
  ('home-1', 'home', 'Left hand home', 15, 92),
  ('home-2', 'home', 'Right hand home', 15, 92),
  ('home-3', 'home', 'Full home row', 20, 93),
  ('top-1', 'top', 'Reaching up: E and I', 18, 92),
  ('top-2', 'top', 'R, T, U, Y', 20, 92),
  ('top-3', 'top', 'Whole top row', 22, 93),
  ('bottom-1', 'bottom', 'C, V, N, M', 18, 92),
  ('bottom-2', 'bottom', 'Z, X, B', 18, 92),
  ('fingers-1', 'fingers', 'Pinky power', 16, 90),
  ('fingers-2', 'fingers', 'Ring fingers', 18, 92),
  ('combos-1', 'combos', 'th, he, in, er', 25, 94),
  ('combos-2', 'combos', 'ing, ion, and, ent', 25, 94),
  ('difficult-1', 'difficult', 'Tricky spellings', 25, 92),
  ('difficult-2', 'difficult', 'Long words', 25, 92),
  ('accuracy-1', 'accuracy', 'Precision drill', 20, 98),
  ('accuracy-2', 'accuracy', 'Similar shapes', 22, 97),
  ('speed-1', 'speed', 'Short word sprint', 45, 92),
  ('speed-2', 'speed', 'Common word flow', 50, 93),
  ('advanced-1', 'advanced', 'Capitals and punctuation', 35, 94),
  ('advanced-2', 'advanced', 'Numbers and symbols', 30, 93);
