-- A completed test is never invalid just because of low accuracy. Same ft_replay as 20261123000000 minus the
-- 'Accuracy below 50%' reason, so low-accuracy runs are no longer flagged invalid:* and can be verified.
-- Leaderboard ranking still requires accuracy >= 75 in submit_test; that rule is unchanged.
-- create or replace keeps the existing grants (ft_replay stays private).
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
