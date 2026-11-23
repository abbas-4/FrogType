-- FrogType security hardening (forward-only; never edit 20261122000000_init.sql).
-- Fixes FT-01, FT-02, FT-05, FT-06, FT-07, FT-10, FT-13 and the extra findings in docs/security/SECURITY-AUDIT.md.
--
-- Data impact when applied to an existing database (non-destructive):
--   * existing leaderboard entries, XP rows and achievements are kept but marked verified = false and are hidden
--     from public surfaces until re-earned through server-verified play;
--   * existing profiles keep their current visibility; only NEW accounts default to private.
-- Every function uses SET search_path = '' and schema-qualified names (Supabase hardening guidance).

-- ================================================================ 1. privileges (defense in depth on top of RLS)
-- Supabase grants ALL (incl. TRUNCATE, which RLS does not cover) on public tables to anon/authenticated by default.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.lessons, public.achievements, public.daily_challenges to anon, authenticated;
grant select on public.profiles, public.typing_tests, public.leaderboard_entries, public.lesson_progress, public.user_achievements,
  public.xp_transactions, public.challenge_submissions, public.friendships to authenticated;
grant update (username, is_public, show_on_leaderboard) on public.profiles to authenticated;
grant delete on public.typing_tests, public.friendships to authenticated;

-- Objects created by later migrations must opt in explicitly.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- ================================================================ 2. schema changes
-- Extra finding: the profiles table was readable (ids, flags, created_at) by anyone for every public profile.
-- Public data is served only through get_public_profile / get_leaderboard now.
drop policy "profiles: read own or public" on public.profiles;
create policy "profiles: read own" on public.profiles for select to authenticated using (id = (select auth.uid()));
-- FT-07
alter table public.profiles alter column is_public set default false, alter column show_on_leaderboard set default false;

alter table public.typing_tests
  add column verified boolean not null default false, -- metrics recomputed by the server from a challenge keylog
  add column challenge_id uuid unique,
  add column flags text[] not null default '{}';
alter table public.leaderboard_entries add column verified boolean not null default false;
alter table public.xp_transactions add column verified boolean not null default false;
alter table public.user_achievements add column verified boolean not null default false;

-- FT-13: declined requests are kept (hidden) so the requester cannot immediately re-spam.
alter table public.friendships drop constraint friendships_status_check;
alter table public.friendships add constraint friendships_status_check check (status in ('pending', 'accepted', 'declined'));
alter table public.friendships add column responded_at timestamptz;
drop policy "friendships: read own" on public.friendships;
drop policy "friendships: delete own" on public.friendships;
create policy "friendships: read own" on public.friendships for select to authenticated
  using (addressee = (select auth.uid()) or (requester = (select auth.uid()) and status <> 'declined'));
create policy "friendships: delete own" on public.friendships for delete to authenticated
  using (addressee = (select auth.uid()) or (requester = (select auth.uid()) and status <> 'declined'));

-- FT-06: atomic fixed-window counters. Internal only (RLS on, no policies, no grants).
create table public.rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  hits int not null,
  primary key (user_id, action)
);
alter table public.rate_limits enable row level security;

-- FT-01: server-issued, single-use, user-bound typing challenges. Internal only.
create table public.test_challenges (
  id uuid primary key default gen_random_uuid(), -- 122 random bits from pg_strong_random
  user_id uuid not null references public.profiles (id) on delete cascade,
  mode text not null check (mode in ('time', 'words')),
  mode2 int not null,
  words text[] not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index test_challenges_user on public.test_challenges (user_id, issued_at desc);
create index test_challenges_expiry on public.test_challenges (expires_at);
alter table public.test_challenges enable row level security;

-- Server copy of the English "normal" word list (keep in sync with src/data/wordlists.ts; checked by tests/parity.test.ts).
create table public.ft_words (word text primary key check (word ~ '^[a-z]{1,20}$'));
alter table public.ft_words enable row level security;
insert into public.ft_words (word) select unnest(string_to_array(
  'the be of and a to in he have it that for they with as not on she at by this we you do but from or which one would all will there say who make when can more if no man out other so what time up go about than into could state only new year some take come these know see use get like then first any work now may such give over think most even find day also after way many must look before great back through long where much should well people down own just because good each those feel seem how high too place little world very still nation hand old life tell write become here show house both between need mean call develop under last right move thing general school never same another begin while number part turn real leave might want point form off child few small since against ask late home interest large person end open public follow during present without again hold govern around possible head consider word program problem however lead system set order eye plan run keep face fact group play stand increase early course change help line city put close case force meet once water upon war build hear light unite live every country bring center let side try provide continue name certain power pay result question study woman member until far night always service away report something company week church toward start social room figure nature though young less enough almost read include president nothing yet better big boy cost business value second why clear expect family complete act sense mind experience art next near direct car law industry important girl food several matter usual rather per often kind among white reason action return foot care simple within love human along appear doctor believe speak active student month drive concern best door hope example inform body ever least probable understand reach effect different idea whole control condition field pass fall note special talk particular today measure walk teach low hour type carry rate remain full street easy although record sit determine level local sure receive thus moment spirit train college perhaps music grow free cause serve age book board recent sound office cut step class true history position above strong friend necessary add court deal support party whether either land material happen education agree arm mother across quite anything town past view society manage answer break organize half fire lose money stop actual already effort wait department able learn voice air together shall cover common subject draw short treat limit road letter color behind produce send term total university rise century success minute remember purpose test watch situation south ago difference stage father table rest bear entire market prepare explain offer plant charge ground west picture hard front lie modern dark surface rule regard dance peace observe future wall farm claim firm operation further pressure property morning amount top outside piece sometimes beauty trade demand wonder list accept judge paint mile soon responsible allow heart union slow island enter drink story experiment stay paper space apply decide share desire spend sign therefore various visit supply officer doubt private immediate wish contain feed raise describe ready horse son exist north suggest station effective deep wide alone character attention', ' '));

-- ================================================================ 3. helpers (not callable by clients)
create or replace function public.ft_fnv1a(s text) returns bigint
language plpgsql immutable set search_path = '' as $$
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

create or replace function public.ft_daily_targets(d date, out target_wpm int, out target_accuracy int)
language plpgsql immutable set search_path = '' as $$
declare
  h bigint := public.ft_fnv1a('frogtype-daily-v1-' || to_char(d, 'YYYY-MM-DD'));
begin
  target_wpm := 35 + (h % 6)::int * 5;
  target_accuracy := 92 + ((h >> 8) % 5)::int;
end $$;

-- Raises 'rate limited' when p_user exceeds p_max calls of p_action per p_window. The upsert takes a row lock,
-- so concurrent requests serialize and cannot both pass (unlike the old read-then-insert check).
create or replace function public.ft_rate_limit(p_user uuid, p_action text, p_max int, p_window interval) returns void
language plpgsql set search_path = '' as $$
declare
  v_hits int;
begin
  insert into public.rate_limits as r (user_id, action, window_start, hits) values (p_user, p_action, clock_timestamp(), 1)
  on conflict (user_id, action) do update set
    hits = case when r.window_start <= clock_timestamp() - p_window then 1 else r.hits + 1 end,
    window_start = case when r.window_start <= clock_timestamp() - p_window then clock_timestamp() else r.window_start end
  returning hits into v_hits;
  if v_hits > p_max then
    raise exception 'rate limited: too many requests, try again later' using errcode = 'P0001', hint = p_action;
  end if;
end $$;

-- Validates one client payload (shape, types, bounds, internal consistency). Raises on anything malformed.
create or replace function public.ft_validate_test(p jsonb) returns void
language plpgsql stable set search_path = '' as $$
declare
  v_mode text;
  v_mode2 int;
  v_wpm numeric;
  v_raw numeric;
  v_dur int;
  v_correct int;
  v_words int;
  k text;
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'invalid payload'; end if;
  if pg_column_size(p) > 262144 then raise exception 'payload too large'; end if;
  foreach k in array array['wpm', 'raw', 'accuracy', 'consistency', 'mode2', 'duration_ms', 'words_typed'] loop
    if jsonb_typeof(p -> k) is distinct from 'number' then raise exception 'invalid field: %', k; end if;
  end loop;
  foreach k in array array['correct', 'incorrect', 'extra', 'missed'] loop
    if jsonb_typeof(p -> 'chars' -> k) is distinct from 'number' or (p -> 'chars' ->> k)::numeric not between 0 and 100000 then
      raise exception 'invalid chars'; end if;
  end loop;
  v_mode := p ->> 'mode';
  v_mode2 := (p ->> 'mode2')::int;
  v_wpm := (p ->> 'wpm')::numeric;
  v_raw := (p ->> 'raw')::numeric;
  v_dur := (p ->> 'duration_ms')::int;
  v_correct := (p -> 'chars' ->> 'correct')::int;
  v_words := (p ->> 'words_typed')::int;
  if v_mode is null or v_mode not in ('time', 'words', 'custom', 'lesson', 'daily') then raise exception 'invalid mode'; end if;
  if v_mode = 'time' and abs(v_dur - v_mode2 * 1000) > 1000 then raise exception 'duration does not match time mode'; end if;
  if v_wpm > v_raw + 1 then raise exception 'wpm exceeds raw'; end if;
  -- wpm characters can only come from correct characters plus the spaces after correct words
  if v_wpm * 5 * v_dur / 60000.0 > v_correct + v_words + 5 then raise exception 'wpm inconsistent with characters'; end if;
  if jsonb_typeof(p -> 'samples') is distinct from 'array' or jsonb_array_length(p -> 'samples') > v_dur / 1000 + 2 then raise exception 'invalid samples'; end if;
  if p ? 'char_stats' and (jsonb_typeof(p -> 'char_stats') <> 'object' or (select count(*) from jsonb_object_keys(p -> 'char_stats')) > 200) then
    raise exception 'invalid char_stats'; end if;
  if p ? 'bigram_errors' and (jsonb_typeof(p -> 'bigram_errors') <> 'object' or (select count(*) from jsonb_object_keys(p -> 'bigram_errors')) > 400) then
    raise exception 'invalid bigram_errors'; end if;
  if (p ->> 'created_at')::timestamptz is null then raise exception 'invalid created_at'; end if;
  -- every field cast later is checked here, so nothing can fail after the (costlier) replay
  if (p ->> 'id')::uuid is null then raise exception 'invalid id'; end if;
  if v_dur not between 1000 and 3600000 or v_mode2 not between 1 and 2000 then raise exception 'invalid duration'; end if;
  if p ->> 'language' is null or p ->> 'language' not in ('english', 'spanish', 'german') then raise exception 'invalid language'; end if;
  if p ->> 'difficulty' is null or p ->> 'difficulty' not in ('easy', 'normal', 'hard') then raise exception 'invalid difficulty'; end if;
  if jsonb_typeof(p -> 'punctuation') is distinct from 'boolean' or jsonb_typeof(p -> 'numbers') is distinct from 'boolean' then raise exception 'invalid options'; end if;
  if (p ->> 'wpm')::numeric not between 0 and 300 or (p ->> 'raw')::numeric not between 0 and 350 or (p ->> 'accuracy')::numeric not between 0 and 100 then
    raise exception 'metrics out of range'; end if;
  if p ->> 'daily_date' is not null and (p ->> 'daily_date')::date is null then raise exception 'invalid daily_date'; end if;
  if p ->> 'lesson_id' is not null and not exists (select 1 from public.lessons where id = p ->> 'lesson_id') then raise exception 'invalid lesson'; end if;
end $$;

create or replace function public.ft_random_words(n int) returns text[]
language plpgsql volatile set search_path = '' as $$
declare
  pool text[] := (select array_agg(word order by word) from public.ft_words);
  len int := array_length(pool, 1);
  v_out text[] := '{}';
  w text;
  prev text := '';
begin
  for i in 1 .. n loop
    loop
      w := pool[1 + floor(random() * len)::int];
      exit when w <> prev;
    end loop;
    v_out := v_out || w;
    prev := w;
  end loop;
  return v_out;
end $$;

-- Server-side replay of a keylog against the challenge passage. Port of src/engine/core.ts + metrics.ts
-- (char, space, backspace, word-backspace; MAX_EXTRA = 10; backspace into a previous word only if it has a mistake).
-- Keylog: k = one character per event (chr(8) backspace, chr(23) delete word), t = ms since the first keystroke.
create or replace function public.ft_replay(p_words text[], p_mode text, p_mode2 int, p_keys text, p_times int[])
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  n int := coalesce(length(p_keys), 0);
  nwords int := coalesce(array_length(p_words, 1), 0);
  limit_ms int := case when p_mode = 'time' then p_mode2 * 1000 end;
  inputs text[] := array[''];
  wi int := 1;
  keystrokes int := 0;
  correct_keys int := 0;
  finished_at int;
  k text;
  t int;
  prev_t int := 0;
  word text;
  input text;
  expected text;
  key_times int[] := '{}';
  c_correct int := 0;
  c_incorrect int := 0;
  c_extra int := 0;
  c_missed int := 0;
  wpm_chars int := 0;
  raw_chars int := 0;
  correct_words int := 0;
  committed boolean;
  typed text;
  dur int;
  v_wpm numeric;
  v_raw numeric;
  v_acc numeric;
  flags text[] := '{}';
  reason text;
  secs int;
  idle int;
  gaps numeric[];
  g_mean numeric;
  g_sd numeric;
begin
  if n = 0 or n <> coalesce(array_length(p_times, 1), 0) then return jsonb_build_object('ok', false, 'reason', 'keylog length mismatch'); end if;
  if n > 8000 then return jsonb_build_object('ok', false, 'reason', 'keylog too long'); end if; -- ~120 s at 300 WPM with corrections
  if p_times[1] <> 0 or substr(p_keys, 1, 1) in (' ', chr(8), chr(23)) then return jsonb_build_object('ok', false, 'reason', 'keylog must start with a character at t=0'); end if;

  for i in 1 .. n loop
    k := substr(p_keys, i, 1);
    t := p_times[i];
    if t is null or t < prev_t then return jsonb_build_object('ok', false, 'reason', 'timestamps not monotonic'); end if;
    if t > 3600000 then return jsonb_build_object('ok', false, 'reason', 'timestamp out of range'); end if;
    prev_t := t;
    if limit_ms is not null and t >= limit_ms then exit; end if; -- keystrokes after the limit belong to no test
    word := coalesce(p_words[wi], '');
    input := coalesce(inputs[wi], '');
    if k = chr(8) or k = chr(23) then
      if length(input) > 0 then
        inputs[wi] := case when k = chr(23) then '' else left(input, -1) end;
      elsif wi > 1 and coalesce(inputs[wi - 1], '') <> coalesce(p_words[wi - 1], '') then
        wi := wi - 1;
        if k = chr(23) then inputs[wi] := ''; end if;
      end if;
    elsif k = ' ' then
      continue when length(input) = 0;
      keystrokes := keystrokes + 1;
      key_times := key_times || t;
      if input = word then correct_keys := correct_keys + 1; end if;
      wi := wi + 1;
      if coalesce(array_length(inputs, 1), 0) < wi then inputs := inputs || ''::text; end if;
      if p_mode = 'words' and wi > nwords then finished_at := t; exit; end if;
    else
      continue when length(input) >= length(word) + 10;
      expected := substr(word, length(input) + 1, 1);
      keystrokes := keystrokes + 1;
      key_times := key_times || t;
      if expected <> '' and k = expected then correct_keys := correct_keys + 1; end if;
      inputs[wi] := input || k;
      if p_mode = 'words' and wi = nwords and inputs[wi] = word then finished_at := t; exit; end if;
    end if;
  end loop;

  if limit_ms is not null then finished_at := limit_ms; end if; -- time mode always ends exactly at the limit
  if finished_at is null then return jsonb_build_object('ok', false, 'reason', 'test not completed'); end if;

  -- countChars(words, inputs, wordIndex, includePartial = true)
  for j in 1 .. least(wi, nwords) loop
    word := coalesce(p_words[j], '');
    input := coalesce(inputs[j], '');
    committed := j < wi;
    for c in 1 .. greatest(length(word), length(input)) loop
      typed := substr(input, c, 1);
      expected := substr(word, c, 1);
      if typed = '' then
        if committed then c_missed := c_missed + 1; end if;
      elsif expected = '' then c_extra := c_extra + 1;
      elsif typed = expected then c_correct := c_correct + 1;
      else c_incorrect := c_incorrect + 1;
      end if;
    end loop;
    raw_chars := raw_chars + length(input) + case when committed then 1 else 0 end;
    if committed then
      if input = word then correct_words := correct_words + 1; wpm_chars := wpm_chars + length(word) + 1; end if;
    elsif length(input) > 0 and left(word, length(input)) = input then
      wpm_chars := wpm_chars + length(input);
      if input = word then correct_words := correct_words + 1; end if;
    end if;
  end loop;

  dur := finished_at;
  v_wpm := case when dur > 0 then round((wpm_chars / 5.0) / (dur / 60000.0), 2) else 0 end;
  v_raw := case when dur > 0 then round((raw_chars / 5.0) / (dur / 60000.0), 2) else 0 end;
  v_acc := case when keystrokes > 0 then round(correct_keys * 100.0 / keystrokes, 2) else 0 end;

  -- invalidReason() port
  secs := dur / 1000;
  idle := secs - (select count(distinct kt / 1000) from unnest(key_times) kt where kt / 1000 < secs); -- O(keys), not O(seconds x keys)
  reason := case
    when dur < 1000 then 'Test too short'
    when keystrokes < 5 then 'Too few keystrokes'
    when v_raw > 350 or v_wpm > 300 then 'Unrealistic speed'
    when v_acc < 50 then 'Accuracy below 50%'
    when secs >= 5 and idle::numeric / secs > 0.5 then 'Inactive for most of the test'
  end;

  -- Anti-automation heuristics. They flag (unrank) rather than prove anything: a careful bot can evade them.
  gaps := array(select key_times[i] - key_times[i - 1] from generate_series(2, coalesce(array_length(key_times, 1), 0)) i);
  if coalesce(array_length(gaps, 1), 0) >= 40 then
    select avg(g), stddev_pop(g) into g_mean, g_sd from unnest(gaps) g;
    if g_mean > 0 and g_sd / g_mean < 0.08 then flags := flags || 'uniform_timing'::text; end if;
    if (select count(*) from unnest(gaps) g where g = 0)::numeric / array_length(gaps, 1) > 0.2 then flags := flags || 'burst_input'::text; end if;
  end if;

  return jsonb_build_object('ok', true, 'valid', reason is null, 'reason', reason, 'wpm', v_wpm, 'raw', v_raw, 'accuracy', v_acc,
    'chars', jsonb_build_object('correct', c_correct, 'incorrect', c_incorrect, 'extra', c_extra, 'missed', c_missed),
    'words_typed', correct_words, 'duration_ms', dur, 'keystrokes', keystrokes, 'flags', to_jsonb(flags));
end $$;

drop function public.ft_insert_test(jsonb, uuid, boolean, boolean);
create or replace function public.ft_insert_test(p jsonb, v_user uuid, v_ranked boolean, v_imported boolean, v_verified boolean,
  v_challenge uuid, v_flags text[], v_created timestamptz) returns boolean
language plpgsql set search_path = '' as $$
declare
  inserted int;
begin
  insert into public.typing_tests (id, user_id, created_at, mode, mode2, wpm, raw, accuracy, consistency, chars, duration_ms, words_typed,
    language, punctuation, numbers, difficulty, samples, char_stats, bigram_errors, lesson_id, daily_date, ranked, imported,
    verified, challenge_id, flags)
  values ((p ->> 'id')::uuid, v_user, v_created, p ->> 'mode', (p ->> 'mode2')::int,
    (p ->> 'wpm')::numeric, (p ->> 'raw')::numeric, (p ->> 'accuracy')::numeric, least(greatest((p ->> 'consistency')::numeric, 0), 100),
    jsonb_build_object('correct', (p -> 'chars' ->> 'correct')::int, 'incorrect', (p -> 'chars' ->> 'incorrect')::int,
                       'extra', (p -> 'chars' ->> 'extra')::int, 'missed', (p -> 'chars' ->> 'missed')::int),
    (p ->> 'duration_ms')::int, (p ->> 'words_typed')::int, p ->> 'language', (p ->> 'punctuation')::boolean,
    (p ->> 'numbers')::boolean, p ->> 'difficulty', coalesce(p -> 'samples', '[]'), coalesce(p -> 'char_stats', '{}'),
    coalesce(p -> 'bigram_errors', '{}'), nullif(p ->> 'lesson_id', ''), (p ->> 'daily_date')::date, v_ranked, v_imported,
    v_verified, v_challenge, v_flags)
  on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end $$;

-- FT-02: progression derived only from server records. Idempotent; safe to call any time.
-- verified = derived from server-replayed (challenge) tests. Lesson/daily rewards come from live submissions whose
-- passages are client-generated, so they are stored but marked unverified.
create or replace function public.ft_award(p_user uuid, p_test uuid default null) returns void
language plpgsql set search_path = '' as $$
declare
  v_longest int;
begin
  -- XP for every live (non-imported) test, recomputed from stored fields (port of xpForTest).
  insert into public.xp_transactions as x (user_id, key, amount, reason, verified)
  select p_user, 'test:' || t.id,
    least(300, round(5 + ((t.chars ->> 'correct')::int / 5.0) * greatest(0, (t.accuracy - 50) / 50.0)))::int, 'Completed test', t.verified
  from public.typing_tests t where t.user_id = p_user and not t.imported and (p_test is null or t.id = p_test) -- submit: only the new test
  on conflict (user_id, key) do update set amount = excluded.amount, reason = excluded.reason, verified = excluded.verified
    where (x.amount, x.reason, x.verified) is distinct from (excluded.amount, excluded.reason, excluded.verified);

  -- Personal bests among verified tests.
  insert into public.xp_transactions as x (user_id, key, amount, reason, verified)
  select p_user, 'pr:' || id, 25, 'New personal best', true from (
    select id, wpm, max(wpm) over (partition by mode, mode2 order by submitted_at, id rows between unbounded preceding and 1 preceding) as prev
    from public.typing_tests where user_id = p_user and verified and mode in ('time', 'words')) s
  where prev > 0 and wpm >= prev + 1 -- at least 1 WPM better: no farming in 0.01 steps
  on conflict (user_id, key) do update set amount = 25, verified = true where (x.amount, x.verified) is distinct from (25, true);

  -- Lessons passed by a live submission meeting the server's targets.
  insert into public.xp_transactions as x (user_id, key, amount, reason, verified)
  select distinct p_user, 'lesson:' || l.id, 50, 'Passed lesson: ' || l.title, false
  from public.typing_tests t join public.lessons l on l.id = t.lesson_id
  where t.user_id = p_user and not t.imported and t.wpm >= l.target_wpm and t.accuracy >= l.target_accuracy
  on conflict (user_id, key) do update set amount = 50, verified = false where (x.amount, x.verified) is distinct from (50, false);

  -- Daily challenges completed (decided by submit_test with server targets and freshness checks).
  insert into public.xp_transactions as x (user_id, key, amount, reason, verified)
  select p_user, 'daily:' || challenge_date, 100, 'Daily challenge ' || challenge_date, false
  from public.challenge_submissions where user_id = p_user and completed
  on conflict (user_id, key) do update set amount = 100, verified = false where (x.amount, x.verified) is distinct from (100, false);

  -- Streaks from server-clock days with a verified test (submitted_at cannot be backdated, unlike created_at).
  with d as (select distinct (submitted_at at time zone 'utc')::date as day from public.typing_tests where user_id = p_user and verified),
       g as (select day, day - (row_number() over (order by day))::int as grp from d),
       s as (select day, row_number() over (partition by grp order by day) as pos from g)
  insert into public.xp_transactions as x (user_id, key, amount, reason, verified)
  select p_user, 'streak:' || day, 10 * least(pos, 7)::int, 'Daily streak (' || pos || ' day' || case when pos = 1 then '' else 's' end || ')', true from s
  on conflict (user_id, key) do update set amount = excluded.amount, reason = excluded.reason, verified = true
    where (x.amount, x.verified) is distinct from (excluded.amount, true);

  with d as (select distinct (submitted_at at time zone 'utc')::date as day from public.typing_tests where user_id = p_user and verified),
       g as (select day - (row_number() over (order by day))::int as grp from d)
  select coalesce(max(c), 0) into v_longest from (select count(*) as c from g group by grp) islands;

  -- Achievements (port of src/domain/achievements.ts, evaluated on server records only).
  insert into public.user_achievements as ua (user_id, achievement_id, verified)
  select p_user, a.id, a.verified from (
    select 'first-test' as id, true as verified, (select count(*) from public.typing_tests where user_id = p_user and verified) >= 1 as ok
    union all select 'tests-10', true, (select count(*) from public.typing_tests where user_id = p_user and verified) >= 10
    union all select 'tests-100', true, (select count(*) from public.typing_tests where user_id = p_user and verified) >= 100
    union all select 'wpm-50', true, exists (select 1 from public.typing_tests where user_id = p_user and verified and wpm >= 50 and duration_ms >= 10000)
    union all select 'wpm-75', true, exists (select 1 from public.typing_tests where user_id = p_user and verified and wpm >= 75 and duration_ms >= 10000)
    union all select 'wpm-100', true, exists (select 1 from public.typing_tests where user_id = p_user and verified and wpm >= 100 and duration_ms >= 10000)
    union all select 'perfect', true, exists (select 1 from public.typing_tests where user_id = p_user and verified and accuracy = 100 and (chars ->> 'correct')::int >= 50)
    union all select 'streak-7', true, v_longest >= 7
    union all select 'streak-30', true, v_longest >= 30
    union all select 'daily-champion', false, (select count(*) from public.challenge_submissions where user_id = p_user and completed) >= 1
    union all select 'daily-7', false, (select count(*) from public.challenge_submissions where user_id = p_user and completed) >= 7
    union all select 'first-lesson', false, exists (select 1 from public.xp_transactions where user_id = p_user and key like 'lesson:%')
    union all select 'all-lessons', false, (select count(*) from public.xp_transactions where user_id = p_user and key like 'lesson:%') >= (select count(*) from public.lessons)
  ) a where a.ok
  on conflict (user_id, achievement_id) do update set verified = excluded.verified where ua.verified is distinct from excluded.verified;
end $$;

-- ================================================================ 4. client API
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  wanted text := new.raw_user_meta_data ->> 'username';
  fallback text := 'frog_' || substr(md5(new.id::text), 1, 8);
  -- FT-07: private unless the user explicitly opted in at sign-up.
  v_public boolean := coalesce(new.raw_user_meta_data ->> 'public_profile' = 'true', false);
  v_board boolean := coalesce(new.raw_user_meta_data ->> 'show_on_leaderboard' = 'true', false);
begin
  if wanted is null or wanted !~ '^[A-Za-z0-9_]{3,20}$' then wanted := fallback; end if;
  begin
    insert into public.profiles (id, username, is_public, show_on_leaderboard) values (new.id, wanted, v_public, v_board);
  exception when unique_violation then -- taken (or raced): never fail the sign-up over a username
    insert into public.profiles (id, username, is_public, show_on_leaderboard) values (new.id, fallback, v_public, v_board);
  end;
  return new;
end $$;

-- FT-01: issues a single-use passage for a ranked test. Only standard boards can be ranked.
create or replace function public.issue_challenge(p_mode text, p_mode2 int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_words text[];
  v_id uuid;
  v_exp timestamptz;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not ((p_mode = 'time' and p_mode2 in (15, 30, 60, 120)) or (p_mode = 'words' and p_mode2 in (10, 25, 50, 100))) then
    raise exception 'unsupported ranked mode';
  end if;
  perform public.ft_rate_limit(v_user, 'challenge:5min', 60, interval '5 minutes');
  perform public.ft_rate_limit(v_user, 'challenge:day', 3000, interval '1 day');
  delete from public.test_challenges where user_id = v_user and (expires_at < now() or consumed_at is not null);
  -- opportunistic global purge so abandoned accounts don't leave passages behind forever
  delete from public.test_challenges where ctid = any (array(select ctid from public.test_challenges where expires_at < now() - interval '1 day' limit 500));
  -- time mode: enough words for 300 WPM, so the client never needs to append unverifiable words
  v_words := public.ft_random_words(case when p_mode = 'time' then p_mode2 * 5 else p_mode2 end);
  v_exp := now() + case when p_mode = 'time' then make_interval(secs => p_mode2) else interval '10 minutes' end + interval '15 minutes';
  insert into public.test_challenges (user_id, mode, mode2, words, expires_at) values (v_user, p_mode, p_mode2, v_words, v_exp) returning id into v_id;
  return jsonb_build_object('id', v_id, 'words', to_jsonb(v_words), 'expires_at', v_exp);
end $$;

-- Live submission. With a valid challenge + keylog the server recomputes every metric (verified, may rank);
-- without one the test is stored unverified and unranked. Returns { accepted, duplicate, ranked, verified, flags }.
create or replace function public.submit_test(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_created timestamptz;
  v_fresh boolean;
  v_mode text;
  v_mode2 int;
  v_daily date;
  v_ch public.test_challenges;
  r jsonb;
  v_verified boolean := false;
  v_ranked boolean := false;
  v_flags text[] := '{}';
  v_wpm numeric;
  v_acc numeric;
  t record;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  perform public.ft_rate_limit(v_user, 'submit:min', 30, interval '1 minute');
  perform public.ft_rate_limit(v_user, 'submit:day', 1000, interval '1 day');
  if (select count(*) from public.typing_tests where user_id = v_user) >= 20000 then
    raise exception 'storage limit reached: delete old tests to keep syncing';
  end if;
  perform public.ft_validate_test(payload);
  if exists (select 1 from public.typing_tests where id = (payload ->> 'id')::uuid) then
    return jsonb_build_object('accepted', false, 'duplicate', true, 'ranked', false, 'verified', false);
  end if;
  v_mode := payload ->> 'mode';
  v_mode2 := (payload ->> 'mode2')::int;
  v_created := least((payload ->> 'created_at')::timestamptz, now());

  if payload ->> 'challenge_id' is not null then
    -- single use: the row lock makes concurrent replays of one challenge impossible
    update public.test_challenges set consumed_at = now()
      where id = (payload ->> 'challenge_id')::uuid and user_id = v_user and consumed_at is null and expires_at > now()
      returning * into v_ch;
    if v_ch.id is null then
      v_flags := v_flags || 'challenge_invalid'::text; -- unknown, expired, reused or another user's
    elsif v_ch.mode <> v_mode or v_ch.mode2 <> v_mode2 or payload ->> 'language' <> 'english' or (payload ->> 'punctuation')::boolean
      or (payload ->> 'numbers')::boolean or payload ->> 'difficulty' <> 'normal' then
      v_flags := v_flags || 'challenge_config_mismatch'::text;
    else
      begin
        if jsonb_typeof(payload -> 'keylog' -> 't') <> 'array' or jsonb_array_length(payload -> 'keylog' -> 't') > 8000 then raise exception 'bad keylog'; end if;
        r := public.ft_replay(v_ch.words, v_ch.mode, v_ch.mode2, payload -> 'keylog' ->> 'k',
               array(select x::int from jsonb_array_elements_text(payload -> 'keylog' -> 't') x));
      exception when others then
        r := jsonb_build_object('ok', false, 'reason', 'malformed keylog');
      end;
      if not (r ->> 'ok')::boolean then
        v_flags := v_flags || ('replay_rejected:' || (r ->> 'reason'));
      elsif not (r ->> 'valid')::boolean then
        v_flags := v_flags || ('invalid:' || (r ->> 'reason'));
      elsif clock_timestamp() - v_ch.issued_at < make_interval(secs => (r ->> 'duration_ms')::numeric / 1000 - 1) then
        v_flags := v_flags || 'faster_than_wall_clock'::text; -- cannot finish a 60 s test 10 s after the passage was issued
      else
        v_flags := v_flags || array(select jsonb_array_elements_text(r -> 'flags'));
        if abs((r ->> 'wpm')::numeric - (payload ->> 'wpm')::numeric) > greatest(1, 0.02 * (r ->> 'wpm')::numeric) then
          v_flags := v_flags || 'metric_mismatch'::text;
        end if;
        -- server values replace every client-claimed metric
        payload := payload || jsonb_build_object('wpm', r -> 'wpm', 'raw', r -> 'raw', 'accuracy', r -> 'accuracy', 'chars', r -> 'chars',
          'words_typed', r -> 'words_typed', 'duration_ms', r -> 'duration_ms');
        v_verified := cardinality(v_flags) = 0; -- flagged runs keep server metrics but never count as verified
        v_created := now();
      end if;
    end if;
  end if;

  v_wpm := (payload ->> 'wpm')::numeric;
  v_acc := (payload ->> 'accuracy')::numeric;
  v_fresh := v_created between now() - interval '15 minutes' and now() + interval '1 minute';
  v_daily := (payload ->> 'daily_date')::date;
  v_ranked := v_verified and cardinality(v_flags) = 0 and v_acc >= 75 and v_wpm <= 250;

  if not public.ft_insert_test(payload, v_user, v_ranked, false, v_verified, v_ch.id, v_flags, v_created) then
    return jsonb_build_object('accepted', false, 'duplicate', true, 'ranked', false, 'verified', false);
  end if;

  if v_ranked then
    insert into public.leaderboard_entries as le (user_id, mode, mode2, test_id, wpm, accuracy, duration_ms, created_at, verified)
    values (v_user, v_mode, v_mode2, (payload ->> 'id')::uuid, v_wpm, v_acc, (payload ->> 'duration_ms')::int, now(), true)
    on conflict (user_id, mode, mode2) do update
      set test_id = excluded.test_id, wpm = excluded.wpm, accuracy = excluded.accuracy,
          duration_ms = excluded.duration_ms, created_at = excluded.created_at, verified = true
      where excluded.wpm > le.wpm or not le.verified;
  end if;

  if v_mode = 'lesson' and payload ->> 'lesson_id' is not null then
    insert into public.lesson_progress as lp (user_id, lesson_id, attempts, best_wpm, best_accuracy, first_wpm, completed)
    select v_user, l.id, 1, v_wpm, v_acc, v_wpm, (v_wpm >= l.target_wpm and v_acc >= l.target_accuracy)
    from public.lessons l where l.id = payload ->> 'lesson_id'
    on conflict (user_id, lesson_id) do update set
      attempts = lp.attempts + 1,
      best_wpm = greatest(lp.best_wpm, excluded.best_wpm),
      best_accuracy = greatest(lp.best_accuracy, excluded.best_accuracy),
      completed = lp.completed or excluded.completed,
      updated_at = now();
  end if;

  -- Daily challenge: only today/yesterday (UTC), only fresh submissions; targets come from the server.
  if v_mode = 'daily' and v_fresh and v_daily between (now() at time zone 'utc')::date - 1 and (now() at time zone 'utc')::date then
    select * into t from public.ft_daily_targets(v_daily);
    insert into public.daily_challenges (challenge_date, version, target_wpm, target_accuracy)
    values (v_daily, 1, t.target_wpm, t.target_accuracy) on conflict do nothing;
    insert into public.challenge_submissions as cs (user_id, challenge_date, attempts, best_wpm, best_accuracy, completed)
    values (v_user, v_daily, 1, v_wpm, v_acc, v_wpm >= t.target_wpm and v_acc >= t.target_accuracy)
    on conflict (user_id, challenge_date) do update set
      attempts = cs.attempts + 1,
      best_wpm = greatest(cs.best_wpm, excluded.best_wpm),
      best_accuracy = greatest(cs.best_accuracy, excluded.best_accuracy),
      completed = cs.completed or excluded.completed,
      updated_at = now();
  end if;

  perform public.ft_award(v_user, (payload ->> 'id')::uuid);
  return jsonb_build_object('accepted', true, 'duplicate', false, 'ranked', v_ranked, 'verified', v_verified, 'flags', to_jsonb(v_flags),
    'wpm', v_wpm, 'accuracy', v_acc);
end $$;

-- Pre-account history. Stored imported + unverified: never ranked, never earns XP or achievements.
create or replace function public.import_tests(payloads jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  p jsonb;
  n int := 0;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if jsonb_typeof(payloads) is distinct from 'array' or jsonb_array_length(payloads) > 200 then raise exception 'send at most 200 tests per call'; end if;
  if pg_column_size(payloads) > 4194304 then raise exception 'payload too large'; end if;
  perform public.ft_rate_limit(v_user, 'import:hour', 30, interval '1 hour');
  if (select count(*) from public.typing_tests where user_id = v_user and imported) + jsonb_array_length(payloads) > 5000 then
    raise exception 'import limit reached (5000 imported tests per account)';
  end if;
  for p in select * from jsonb_array_elements(payloads) loop
    begin
      perform public.ft_validate_test(p);
      if public.ft_insert_test(p - 'challenge_id', v_user, false, true, false, null, '{}', least((p ->> 'created_at')::timestamptz, now())) then
        n := n + 1;
      end if;
    exception when others then
      -- skip malformed rows
    end;
  end loop;
  return n;
end $$;

-- FT-02: recomputes the caller's progression from server records. Takes no client claims.
create or replace function public.sync_progress() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  perform public.ft_rate_limit(v_user, 'sync:min', 10, interval '1 minute');
  perform public.ft_award(v_user);
end $$;

-- Deprecated (old clients): arguments are ignored; client-asserted XP/achievements/lessons are no longer accepted.
create or replace function public.merge_progress(p_xp jsonb, p_achievements jsonb, p_lessons jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.sync_progress();
end $$;

create or replace function public.get_leaderboard(p_scope text, p_mode text, p_mode2 int, p_limit int default 50)
returns table (rank bigint, username text, wpm numeric, accuracy numeric, mode text, mode2 int, duration_ms int, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select row_number() over (order by le.wpm desc, le.created_at asc), p.username, le.wpm, le.accuracy, le.mode, le.mode2, le.duration_ms, le.created_at
  from public.leaderboard_entries le
  join public.profiles p on p.id = le.user_id
  where le.verified and le.mode = p_mode and le.mode2 = p_mode2
    and (
      (p_scope = 'global' and p.show_on_leaderboard)
      or (p_scope = 'friends' and (select auth.uid()) is not null and (
        le.user_id = (select auth.uid())
        or (p.show_on_leaderboard and exists (
          select 1 from public.friendships f where f.status = 'accepted'
            and ((f.requester = (select auth.uid()) and f.addressee = le.user_id) or (f.addressee = (select auth.uid()) and f.requester = le.user_id))))))
    )
  order by le.wpm desc, le.created_at asc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.list_friends()
returns table (id bigint, username text, status text, direction text)
language sql stable security definer set search_path = '' as $$
  select f.id, p.username, f.status, case when f.requester = (select auth.uid()) then 'outgoing' else 'incoming' end
  from public.friendships f
  join public.profiles p on p.id = case when f.requester = (select auth.uid()) then f.addressee else f.requester end
  where (select auth.uid()) in (f.requester, f.addressee) and f.status <> 'declined'
  order by f.status, p.username;
$$;

-- FT-13: rate-limited; unknown usernames, existing relationships and declined requests all look the same to the caller.
create or replace function public.send_friend_request(p_username text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_target uuid;
  f public.friendships;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,20}$' then raise exception 'Invalid username.'; end if;
  perform public.ft_rate_limit(v_user, 'friend:hour', 20, interval '1 hour');
  perform public.ft_rate_limit(v_user, 'friend:day', 60, interval '1 day');
  select id into v_target from public.profiles where lower(username) = lower(p_username);
  if v_target = v_user then raise exception 'You cannot add yourself.'; end if;
  if v_target is null then return; end if;
  if (select count(*) from public.friendships where requester = v_user and status = 'pending') >= 50 then
    raise exception 'Too many pending requests.';
  end if;
  select * into f from public.friendships
    where least(requester, addressee) = least(v_user, v_target) and greatest(requester, addressee) = greatest(v_user, v_target)
    for update;
  if f.id is null then
    insert into public.friendships (requester, addressee) values (v_user, v_target) on conflict do nothing;
  elsif f.status = 'pending' and f.requester = v_target then
    update public.friendships set status = 'accepted', responded_at = now() where id = f.id; -- they asked us first
  elsif f.status = 'declined' and f.addressee = v_user then
    update public.friendships set requester = v_user, addressee = v_target, status = 'pending', created_at = now(), responded_at = null
      where id = f.id; -- the person who declined changed their mind
  end if;
end $$;

create or replace function public.respond_friend_request(p_id bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  update public.friendships set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
    where id = p_id and addressee = (select auth.uid()) and status = 'pending';
  if not found then raise exception 'Request not found.'; end if;
end $$;

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

-- FT-10: permanent self-service deletion. Requires typing the username and a password sign-in within the last 10 minutes
-- (newest JWT amr timestamp). Deleting auth.users cascades to profiles and every per-user table.
create or replace function public.delete_my_account(p_confirm text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_auth_at bigint;
begin
  if v_user is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if p_confirm is distinct from (select username from public.profiles where id = v_user) then
    raise exception 'Confirmation did not match your username.';
  end if;
  -- only a password sign-in counts (a recovery-link or magic-link session does not)
  select max((a ->> 'timestamp')::bigint) into v_auth_at
  from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) a
  where a ->> 'method' = 'password';
  if v_auth_at is null or to_timestamp(v_auth_at) < now() - interval '10 minutes' then
    raise exception 'Please enter your password again to confirm.' using errcode = '42501';
  end if;
  delete from auth.users where id = v_user;
end $$;

-- ================================================================ 5. backfill + grants
-- Re-derive progression for existing users from their stored server records (adds verified flags; deletes nothing).
do $$
declare u uuid;
begin
  for u in select id from public.profiles loop perform public.ft_award(u); end loop;
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.submit_test(jsonb) to authenticated;
grant execute on function public.import_tests(jsonb) to authenticated;
grant execute on function public.issue_challenge(text, int) to authenticated;
grant execute on function public.sync_progress() to authenticated;
grant execute on function public.merge_progress(jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.list_friends() to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(bigint, boolean) to authenticated;
grant execute on function public.delete_my_account(text) to authenticated;
grant execute on function public.get_leaderboard(text, text, int, int) to anon, authenticated;
grant execute on function public.get_public_profile(text) to anon, authenticated;
