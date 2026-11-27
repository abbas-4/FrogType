-- Zen mode: free typing with no target text, ended by the typist. Results sync like any other unranked test
-- (no challenge, so no replay and no leaderboard). Allows 'zen' in the typing_tests check and in ft_validate_test.
alter table public.typing_tests drop constraint typing_tests_mode_check;
alter table public.typing_tests add constraint typing_tests_mode_check check (mode in ('time', 'words', 'custom', 'lesson', 'daily', 'zen'));

-- Same ft_validate_test as 20261123000000 with 'zen' added to the allowed modes; create or replace keeps its grants.
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
  if v_mode is null or v_mode not in ('time', 'words', 'custom', 'lesson', 'daily', 'zen') then raise exception 'invalid mode'; end if;
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
