-- Attack-oriented pgTAP tests for 20261123000000_security_hardening.sql (FT-01/02/05/06/07/10/13 + extra findings).
-- Synthetic users only. Everything runs inside one transaction and is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(109);

-- Board and friendship assertions below count whole tables. Other local runs (integration and e2e tests) leave rows
-- behind, and new accounts are public by default, so start from an empty slate; the rollback at the end restores them.
delete from public.friendships;
delete from public.leaderboard_entries;

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111111', 'alice@sec.test', '{"username":"s_alice","public_profile":true,"show_on_leaderboard":true}'),
  ('b2222222-2222-2222-2222-222222222222', 'bob@sec.test', '{"username":"s_bob"}'),
  ('c3333333-3333-3333-3333-333333333333', 'carol@sec.test', '{"username":"s_carol","public_profile":false,"show_on_leaderboard":false}'),
  ('d4444444-4444-4444-4444-444444444444', 'dave@sec.test', '{"username":"S_ALICE"}');

create schema sectest;
grant usage on schema sectest to anon, authenticated;

-- keylog that types `words` joined by spaces; base ms per key with deterministic jitter (or perfectly uniform)
create function sectest.keylog(words text[], base int default 140, jitter boolean default true) returns jsonb language sql immutable as $$
  with txt as (select array_to_string(words, ' ') as s)
  select jsonb_build_object('k', s, 't', (select jsonb_agg(case when n = 1 then 0 else (n - 1) * base + case when jitter then (n * 37) % 60 else 0 end end order by n)
    from generate_series(1, length(s)) n)) from txt;
$$;

-- honest payload for a challenge: metrics computed by the same replay the server uses (or a forged wpm claim)
create function sectest.cpayload(p_id uuid, p_ch jsonb, p_keylog jsonb, p_claim_wpm numeric default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  w text[] := array(select jsonb_array_elements_text(p_ch -> 'words'));
  ch public.test_challenges;
  r jsonb;
begin
  select * into ch from public.test_challenges c where c.id = (p_ch ->> 'id')::uuid;
  r := public.ft_replay(w, coalesce(ch.mode, 'words'), coalesce(ch.mode2, array_length(w, 1)), p_keylog ->> 'k',
         array(select x::int from jsonb_array_elements_text(p_keylog -> 't') x));
  return jsonb_build_object('id', p_id, 'created_at', now(), 'mode', coalesce(ch.mode, 'words'), 'mode2', coalesce(ch.mode2, array_length(w, 1)),
    'wpm', coalesce(p_claim_wpm, (r ->> 'wpm')::numeric), 'raw', greatest(coalesce(p_claim_wpm, 0) + 2, (r ->> 'raw')::numeric),
    'accuracy', coalesce(r -> 'accuracy', '95'), 'consistency', 80,
    'chars', case when p_claim_wpm is null then r -> 'chars' else '{"correct": 20000, "incorrect": 0, "extra": 0, "missed": 0}'::jsonb end,
    'duration_ms', coalesce(r -> 'duration_ms', '20000'), 'words_typed', coalesce(r -> 'words_typed', '10'), 'language', 'english', 'punctuation', false, 'numbers', false,
    'difficulty', 'normal', 'samples', '[]'::jsonb, 'char_stats', '{}'::jsonb, 'bigram_errors', '{}'::jsonb,
    'challenge_id', p_ch ->> 'id', 'keylog', p_keylog);
end $$;
grant execute on function sectest.keylog(text[], int, boolean), sectest.cpayload(uuid, jsonb, jsonb, numeric) to authenticated;

-- unverified payload (no challenge)
create function sectest.payload(p_id uuid, p_wpm numeric, p_mode text default 'words', p_mode2 int default 25, p_dur int default 20000,
  p_created timestamptz default now()) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'created_at', p_created, 'mode', p_mode, 'mode2', p_mode2, 'wpm', p_wpm, 'raw', p_wpm + 2,
    'accuracy', 99, 'consistency', 80, 'chars', jsonb_build_object('correct', ceil(p_wpm * 5 * p_dur / 60000.0), 'incorrect', 0, 'extra', 0, 'missed', 0),
    'duration_ms', p_dur, 'words_typed', 25, 'language', 'english', 'punctuation', false, 'numbers', false, 'difficulty', 'normal',
    'samples', '[]'::jsonb, 'char_stats', '{}'::jsonb, 'bigram_errors', '{}'::jsonb);
$$;
grant execute on function sectest.payload(uuid, numeric, text, int, int, timestamptz) to authenticated;

create function sectest.as_user(p_sub uuid, p_amr_age interval default null) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_sub, 'role', 'authenticated',
    'amr', case when p_amr_age is null then '[]'::jsonb
                else jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now() - p_amr_age)::bigint)) end)::text, true);
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
end $$;
grant execute on function sectest.as_user(uuid, interval) to authenticated;

-- backdate a challenge so the wall-clock check (cannot finish faster than real time) is satisfied inside one transaction
create function sectest.age_challenge(p_id text, p_age interval default interval '1 hour') returns void language sql security definer as $$
  update public.test_challenges set issued_at = now() - p_age where id = p_id::uuid;
$$;
grant execute on function sectest.age_challenge(text, interval) to authenticated;

-- ================================================================ FT-05: privileged functions and grants
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and not coalesce('search_path=""' = any(p.proconfig), false)), 0,
  'every public function pins search_path to empty');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef and p.proowner <> 'postgres'::regrole), 0, 'security definer functions are owned by postgres');
select is(array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1),
  array['get_leaderboard', 'get_public_profile', 'username_available'], 'anon can execute only the public read RPCs and the rate-limited username check');
select is(array(select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1),
  array['delete_my_account', 'get_leaderboard', 'get_public_profile', 'import_tests', 'issue_challenge', 'list_friends', 'merge_progress',
        'respond_friend_request', 'send_friend_request', 'submit_test', 'sync_progress', 'username_available'],
  'authenticated can execute only the intended API (helpers like ft_award/ft_replay/ft_rate_limit are private)');
select is((select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')), 0,
  'clients hold no INSERT/UPDATE/TRUNCATE table grants (profile column updates are column-level only)');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 0, 'RLS enabled on every public table');
select is(has_schema_privilege('authenticated', 'public', 'CREATE') or has_schema_privilege('anon', 'public', 'CREATE'), false,
  'clients cannot create objects in public (search_path hijack precondition)');

-- ================================================================ FT-07: privacy defaults and sign-up consent
select results_eq($$ select username, is_public, show_on_leaderboard from profiles where id in
  ('a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'c3333333-3333-3333-3333-333333333333') order by username $$,
  $$ values ('s_alice'::text, true, true), ('s_bob', true, true), ('s_carol', true, true) $$,
  'new accounts start public and on leaderboards; sign-up metadata cannot change that (20261125000000)');
-- bob and carol then choose private in Settings, as an existing user would have; the tests below rely on it.
update profiles set is_public = false, show_on_leaderboard = false
  where id in ('b2222222-2222-2222-2222-222222222222', 'c3333333-3333-3333-3333-333333333333');
select matches((select username from profiles where id = 'd4444444-4444-4444-4444-444444444444'), '^frog_[0-9a-f]{8}$',
  'a taken username falls back to a generated one instead of failing sign-up');

-- ================================================================ anonymous attacker
set local role anon;
select throws_ok($$ select issue_challenge('words', 10) $$, '42501', null, 'anon cannot request challenges');
select throws_ok($$ select sync_progress() $$, '42501', null, 'anon cannot run progression sync');
select throws_ok($$ select delete_my_account('s_alice') $$, '42501', null, 'anon cannot call delete_my_account');
select throws_ok($$ select ft_award('a1111111-1111-1111-1111-111111111111') $$, '42501', null, 'anon cannot call internal ft_award');
select throws_ok($$ select * from profiles $$, '42501', null, 'anon cannot list profiles');
select throws_ok($$ select * from xp_transactions $$, '42501', null, 'anon cannot read xp');
select throws_ok($$ insert into leaderboard_entries values ('a1111111-1111-1111-1111-111111111111', 'time', 30, gen_random_uuid(), 1, 1, 1, now()) $$,
  '42501', null, 'anon cannot write leaderboard');
select is(get_public_profile('s_bob'), null, 'anon cannot read a private profile');
select isnt(get_public_profile('s_alice'), null, 'anon can read an opted-in public profile');
reset role;

-- ================================================================ FT-01: verified challenge flow (alice)
select sectest.as_user('a1111111-1111-1111-1111-111111111111');
select set_config('sec.ch1', issue_challenge('words', 10)::text, true);
select is(jsonb_array_length(current_setting('sec.ch1')::jsonb -> 'words'), 10, 'challenge returns a 10-word server passage');
select matches(current_setting('sec.ch1')::jsonb ->> 'id', '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', 'challenge id is a random v4 uuid');
select throws_like($$ select issue_challenge('words', 37) $$, '%unsupported ranked mode%', 'non-standard boards get no challenge');
select throws_ok($$ select * from test_challenges $$, '42501', null, 'clients cannot read challenge rows (passages of other tests)');

-- faster than real time: submit a ~8 s test immediately after issue
select set_config('sec.r0', submit_test(sectest.cpayload('a0000000-0000-0000-0000-000000000000', current_setting('sec.ch1')::jsonb,
  sectest.keylog(array(select jsonb_array_elements_text(current_setting('sec.ch1')::jsonb -> 'words')))))::text, true);
select is(current_setting('sec.r0')::jsonb -> 'flags', '["faster_than_wall_clock"]'::jsonb, 'finishing faster than wall-clock time is flagged');
select is((current_setting('sec.r0')::jsonb ->> 'ranked')::boolean, false, '...and not ranked');

select set_config('sec.ch2', issue_challenge('words', 10)::text, true);
select sectest.age_challenge(current_setting('sec.ch2')::jsonb ->> 'id');
select set_config('sec.kl2', sectest.keylog(array(select jsonb_array_elements_text(current_setting('sec.ch2')::jsonb -> 'words')))::text, true);
select set_config('sec.r2', submit_test(sectest.cpayload('a0000000-0000-0000-0000-000000000002', current_setting('sec.ch2')::jsonb, current_setting('sec.kl2')::jsonb))::text, true);
select is(current_setting('sec.r2')::jsonb - 'wpm' - 'accuracy',
  '{"accepted": true, "duplicate": false, "ranked": true, "verified": true, "flags": []}'::jsonb, 'honest keylog for a fresh challenge is verified and ranked');
select is((select count(*)::int from get_leaderboard('global', 'words', 10)), 1, 'verified result appears on the leaderboard');

-- replay: same challenge, new test id
select set_config('sec.r3', submit_test(sectest.cpayload('a0000000-0000-0000-0000-000000000003', current_setting('sec.ch2')::jsonb, current_setting('sec.kl2')::jsonb))::text, true);
select is(current_setting('sec.r3')::jsonb -> 'flags', '["challenge_invalid"]'::jsonb, 'replaying a consumed challenge is rejected');
select is((current_setting('sec.r3')::jsonb ->> 'verified')::boolean, false, '...and stored unverified');
-- duplicate test id
select is((submit_test(sectest.cpayload('a0000000-0000-0000-0000-000000000002', current_setting('sec.ch2')::jsonb, current_setting('sec.kl2')::jsonb)) ->> 'duplicate')::boolean,
  true, 'resubmitting the same test id is a no-op duplicate');

-- fabricated metrics with an honest keylog: server values win, flagged, unranked
select set_config('sec.ch4', issue_challenge('words', 10)::text, true);
select sectest.age_challenge(current_setting('sec.ch4')::jsonb ->> 'id');
select set_config('sec.r4', submit_test(sectest.cpayload('a0000000-0000-0000-0000-000000000004', current_setting('sec.ch4')::jsonb,
  sectest.keylog(array(select jsonb_array_elements_text(current_setting('sec.ch4')::jsonb -> 'words'))), 240))::text, true);
select is(current_setting('sec.r4')::jsonb -> 'flags', '["metric_mismatch"]'::jsonb, 'claimed 240 WPM that the keylog does not support is flagged');
select ok((current_setting('sec.r4')::jsonb ->> 'wpm')::numeric < 150, 'stored wpm is the server-computed value, not the claim');
select is((current_setting('sec.r4')::jsonb ->> 'verified')::boolean, false, 'a flagged run is not verified');
select is((select ranked from typing_tests where id = 'a0000000-0000-0000-0000-000000000004'), false, 'fabricated claim never ranks');

-- automation-like perfectly uniform timing
select set_config('sec.ch5', issue_challenge('words', 25)::text, true);
select sectest.age_challenge(current_setting('sec.ch5')::jsonb ->> 'id');
select is(submit_test(sectest.cpayload('a0000000-0000-0000-0000-000000000005', current_setting('sec.ch5')::jsonb,
  sectest.keylog(array(select jsonb_array_elements_text(current_setting('sec.ch5')::jsonb -> 'words')), 100, false))) -> 'flags',
  '["uniform_timing"]'::jsonb, 'machine-uniform keystroke timing is flagged and unranked');

-- keylog that does not type the passage
select set_config('sec.ch6', issue_challenge('words', 10)::text, true);
select sectest.age_challenge(current_setting('sec.ch6')::jsonb ->> 'id');
select matches(submit_test(sectest.cpayload('a0000000-0000-0000-0000-000000000006', current_setting('sec.ch6')::jsonb,
  sectest.keylog(array['qqqq', 'zzzz', 'xxxx']), 30)) ->> 'flags', 'replay_rejected', 'keylog that never completes the passage is rejected');

-- malformed keylog
select set_config('sec.ch7', issue_challenge('words', 10)::text, true);
select sectest.age_challenge(current_setting('sec.ch7')::jsonb ->> 'id');
select matches(submit_test(sectest.cpayload('a0000000-0000-0000-0000-000000000007', current_setting('sec.ch7')::jsonb,
  sectest.keylog(array(select jsonb_array_elements_text(current_setting('sec.ch7')::jsonb -> 'words')))) || '{"keylog": {"k": "ab", "t": [0, "x"]}}') ->> 'flags',
  'malformed keylog', 'non-numeric timestamps are rejected safely');
select set_config('sec.ch8', issue_challenge('words', 10)::text, true);
select sectest.age_challenge(current_setting('sec.ch8')::jsonb ->> 'id');
select matches(submit_test(sectest.cpayload('a0000000-0000-0000-0000-000000000008', current_setting('sec.ch8')::jsonb,
  sectest.keylog(array(select jsonb_array_elements_text(current_setting('sec.ch8')::jsonb -> 'words')))) || '{"keylog": {"k": "abc", "t": [0, 50, 20]}}') ->> 'flags',
  'not monotonic', 'time-travelling timestamps are rejected');

-- second review: unbounded timestamps must be refused cheaply (was a CPU DoS via the idle check)
select set_config('sec.ch12', issue_challenge('words', 10)::text, true);
select sectest.age_challenge(current_setting('sec.ch12')::jsonb ->> 'id');
select matches(submit_test(sectest.cpayload('a0000000-0000-0000-0000-000000000012', current_setting('sec.ch12')::jsonb,
  sectest.keylog(array(select jsonb_array_elements_text(current_setting('sec.ch12')::jsonb -> 'words')))) || '{"keylog": {"k": "ab", "t": [0, 2000000000]}}') ->> 'flags',
  'timestamp out of range', 'keylog timestamps beyond one hour are rejected');
select throws_like($$ select submit_test(sectest.payload(gen_random_uuid(), 50) || '{"daily_date": "not-a-date"}') $$, '%date%', 'bad daily_date fails validation before any replay');
select throws_like($$ select submit_test(sectest.payload(gen_random_uuid(), 50) || '{"lesson_id": "no-such-lesson"}') $$, '%invalid lesson%', 'unknown lesson fails validation');

-- time mode: replayed duration is exactly the limit
select set_config('sec.ch9', issue_challenge('time', 15)::text, true);
select is(jsonb_array_length(current_setting('sec.ch9')::jsonb -> 'words'), 75, 'time challenge carries enough words for 300 WPM');
select sectest.age_challenge(current_setting('sec.ch9')::jsonb ->> 'id');
select set_config('sec.r9', submit_test(sectest.cpayload('a0000000-0000-0000-0000-000000000009', current_setting('sec.ch9')::jsonb,
  sectest.keylog(array(select jsonb_array_elements_text(current_setting('sec.ch9')::jsonb -> 'words')))))::text, true);
select is((current_setting('sec.r9')::jsonb ->> 'ranked')::boolean, true, 'honest time-mode challenge ranks');
select is((select duration_ms from typing_tests where id = 'a0000000-0000-0000-0000-000000000009'), 15000, 'time-mode duration comes from the server');

-- expired challenge
select set_config('sec.ch10', issue_challenge('words', 10)::text, true);
reset role;
update test_challenges set expires_at = now() - interval '1 second', issued_at = now() - interval '1 hour' where id = (current_setting('sec.ch10')::jsonb ->> 'id')::uuid;
select sectest.as_user('a1111111-1111-1111-1111-111111111111');
select is(submit_test(sectest.cpayload('a0000000-0000-0000-0000-000000000010', current_setting('sec.ch10')::jsonb,
  sectest.keylog(array(select jsonb_array_elements_text(current_setting('sec.ch10')::jsonb -> 'words'))))) -> 'flags',
  '["challenge_invalid"]'::jsonb, 'expired challenge is rejected');

-- config mismatch: challenge for words 10, payload claims punctuation
select set_config('sec.ch11', issue_challenge('words', 10)::text, true);
select sectest.age_challenge(current_setting('sec.ch11')::jsonb ->> 'id');
select is(submit_test(sectest.cpayload('a0000000-0000-0000-0000-000000000011', current_setting('sec.ch11')::jsonb,
  sectest.keylog(array(select jsonb_array_elements_text(current_setting('sec.ch11')::jsonb -> 'words')))) || '{"punctuation": true}') -> 'flags',
  '["challenge_config_mismatch"]'::jsonb, 'challenge used with a different test configuration is rejected');

-- ================================================================ FT-02: progression is derived, not claimed
select lives_ok($$ select merge_progress('[{"key":"daily:2026-01-01","amount":100,"reason":"x"},{"key":"streak:2026-01-01","amount":70,"reason":"x"},{"key":"lesson:speed-2","amount":50,"reason":"x"},{"key":"test:a0000000-0000-0000-0000-000000000002","amount":300,"reason":"x"}]',
  '{"wpm-100":"x","all-lessons":"x","streak-30":"x"}', '{"speed-2":{"completed":true,"bestWpm":300,"attempts":99}}') $$, 'legacy merge_progress still callable');
select is((select count(*)::int from xp_transactions where key in ('daily:2026-01-01', 'streak:2026-01-01', 'lesson:speed-2')), 0, 'fabricated dated/lesson XP keys are not stored');
select isnt((select amount from xp_transactions where key = 'test:a0000000-0000-0000-0000-000000000002'), 300, 'client-claimed XP amount for a real test is ignored');
select is((select count(*)::int from user_achievements where achievement_id in ('wpm-100', 'all-lessons', 'streak-30')), 0, 'impossible achievement claims are ignored');
select is((select count(*)::int from lesson_progress), 0, 'lesson completion cannot be claimed without a lesson test');
select ok((select bool_and(verified) and array_agg(achievement_id) @> array['first-test'] and array_agg(achievement_id) <@ array['first-test', 'perfect', 'wpm-50', 'wpm-75']
           from user_achievements), 'achievements are derived only from verified, unflagged tests');
select is((select count(*)::int from xp_transactions where key like 'streak:%'), 1, 'one streak day from verified play');
select lives_ok($$ select sync_progress(); select sync_progress(); $$, 'progression sync is idempotent');
select is((select count(*)::int from xp_transactions where key like 'streak:%'), 1, 'repeated sync creates no duplicate rewards');
select is((select count(*)::int from xp_transactions where key like 'pr:%'), 0, 'flagged/forged runs earn no personal-best reward');

-- backdated unverified tests cannot fabricate streak days
select lives_ok($$ select submit_test(sectest.payload('a0000000-0000-0000-0000-000000000020', 60, 'words', 25, 20000, now() - interval '10 days')) $$, 'backdated unverified test is stored');
select is((select count(*)::int from xp_transactions where key like 'streak:%'), 1, 'backdated test adds no streak day');
select is((select verified from xp_transactions where key = 'test:a0000000-0000-0000-0000-000000000020'), false, 'unverified test XP is marked unverified');

-- forged historical import
select is(import_tests(jsonb_build_array(sectest.payload('a0000000-0000-0000-0000-000000000030', 249, 'time', 60, 60000))), 1, 'forged import is stored');
select results_eq($$ select imported, ranked, verified from typing_tests where id = 'a0000000-0000-0000-0000-000000000030' $$, $$ values (true, false, false) $$,
  'imported test is unranked and unverified');
select is((select count(*)::int from xp_transactions where key = 'test:a0000000-0000-0000-0000-000000000030'), 0, 'imported tests earn no XP');
select ok((get_public_profile('s_alice') ->> 'best_wpm')::numeric < 200, 'forged import does not change public best WPM');
select ok(not ((get_public_profile('s_alice') -> 'achievements') ? 'wpm-100'), 'forged import unlocks nothing public');
select throws_like($$ select import_tests((select jsonb_agg(sectest.payload(gen_random_uuid(), 50)) from generate_series(1, 201))) $$, '%at most 200%', 'import batch size is bounded');
select is(import_tests('[{"id": "not-a-uuid"}, 42, "x"]'), 0, 'malformed import rows are skipped without failing');

-- ================================================================ FT-06: payload bounds
select throws_like($$ select submit_test(sectest.payload(gen_random_uuid(), 50) || jsonb_build_object('char_stats', (select jsonb_object_agg('k' || i, '[1,0]'::jsonb) from generate_series(1, 300) i))) $$,
  '%char_stats%', 'oversized char_stats map is rejected');
select throws_like($$ select submit_test(sectest.payload(gen_random_uuid(), 50) || jsonb_build_object('bigram_errors', repeat('x', 300000))) $$, '%too large%', 'oversized payload is rejected');
select throws_like($$ select submit_test('[]'::jsonb) $$, '%invalid payload%', 'non-object payload is rejected');
select throws_like($$ select submit_test(sectest.payload(gen_random_uuid(), 50) || '{"wpm": "fast"}') $$, '%invalid field%', 'string metric is rejected');
select throws_like($$ select submit_test(sectest.payload(gen_random_uuid(), 50) || '{"chars": {"correct": -5, "incorrect": 0, "extra": 0, "missed": 0}}') $$, '%invalid chars%', 'negative counts are rejected');

-- ================================================================ cross-account (bob)
select sectest.as_user('b2222222-2222-2222-2222-222222222222');
select set_config('sec.chb', issue_challenge('words', 10)::text, true);
select is((select count(*)::int from typing_tests), 0, 'bob cannot read alice''s tests');
select is((select count(*)::int from profiles), 1, 'bob sees only his own profile row');
select is(get_public_profile('s_carol'), null, 'bob cannot read carol''s private profile');
select is(submit_test(sectest.cpayload('b0000000-0000-0000-0000-000000000001', current_setting('sec.ch4')::jsonb,
  sectest.keylog(array(select jsonb_array_elements_text(current_setting('sec.ch4')::jsonb -> 'words'))))) -> 'flags',
  '["challenge_invalid"]'::jsonb, 'bob cannot use alice''s challenge');
delete from typing_tests where user_id = 'a1111111-1111-1111-1111-111111111111';
delete from friendships;
select is((select count(*)::int from typing_tests where user_id = 'a1111111-1111-1111-1111-111111111111'), 0, '(bob still sees none of alice''s rows)');
reset role;
select is((select count(*)::int from typing_tests where user_id = 'a1111111-1111-1111-1111-111111111111') > 0, true, 'bob''s delete did not remove alice''s tests');

-- ================================================================ FT-07: leaderboard privacy
select sectest.as_user('a1111111-1111-1111-1111-111111111111');
update profiles set show_on_leaderboard = false where id = 'a1111111-1111-1111-1111-111111111111';
select is((select count(*)::int from get_leaderboard('global', 'words', 10)), 0, 'opting out removes the user from the global board');
select is((select count(*)::int from get_leaderboard('friends', 'words', 10)), 1, 'user still sees own result on the friends board');
update profiles set is_public = false where id = 'a1111111-1111-1111-1111-111111111111';
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
select is(get_public_profile('s_alice'), null, 'turning profile private hides it from anon immediately');
select is((select count(*)::int from get_leaderboard('friends', 'words', 10)), 0, 'anon gets nothing from the friends board');
reset role;
select sectest.as_user('b2222222-2222-2222-2222-222222222222');
select is((select count(*)::int from get_leaderboard('friends', 'words', 10)), 0, 'non-friend cannot see alice on friends board');

-- ================================================================ FT-13: friend requests
select lives_ok($$ select send_friend_request('no_such_user') $$, 'unknown username gives the same response as a real one (no enumeration)');
select throws_like($$ select send_friend_request('s_bob') $$, '%yourself%', 'cannot friend yourself');
select throws_like($$ select send_friend_request('bad name; drop table profiles') $$, '%Invalid username%', 'malformed username rejected');
select lives_ok($$ select send_friend_request('s_carol') $$, 'bob sends carol a request');
select lives_ok($$ select send_friend_request('S_CAROL') $$, 'duplicate request (any case) is a silent no-op');
select is((select count(*)::int from friendships), 1, 'no duplicate relationship rows');
select throws_like($$ select respond_friend_request((select id from friendships limit 1), true) $$, '%not found%', 'requester cannot accept their own request');
reset role;
select sectest.as_user('a1111111-1111-1111-1111-111111111111');
select throws_like($$ select respond_friend_request((select max(id) from friendships), true) $$, '%not found%', 'a third party cannot accept someone else''s request');
reset role;
select sectest.as_user('c3333333-3333-3333-3333-333333333333');
select lives_ok($$ select respond_friend_request((select id from friendships limit 1), false) $$, 'carol declines');
reset role;
select sectest.as_user('b2222222-2222-2222-2222-222222222222');
select is((select count(*)::int from list_friends()), 0, 'declined request is hidden from the requester');
select is((select count(*)::int from friendships), 0, 'requester cannot see the declined row via REST either');
select lives_ok($$ select send_friend_request('s_carol') $$, 'requester re-sending after decline gets the generic response');
reset role;
select is((select status from friendships), 'declined', 'but the decline stands (no re-spam)');
select sectest.as_user('b2222222-2222-2222-2222-222222222222');
delete from friendships;
reset role;
select is((select count(*)::int from friendships), 1, 'requester cannot delete the declined row to reset it');
select sectest.as_user('c3333333-3333-3333-3333-333333333333');
select lives_ok($$ select send_friend_request('s_bob') $$, 'the person who declined can still reach out later');
reset role;
select results_eq($$ select requester::text, status from friendships $$, $$ values ('c3333333-3333-3333-3333-333333333333'::text, 'pending'::text) $$, 'which re-opens it in their direction');
select sectest.as_user('b2222222-2222-2222-2222-222222222222');
select lives_ok($$ select send_friend_request('user_' || i) from generate_series(1, 16) i $$, 'requests up to the hourly limit are allowed');
select throws_like($$ select send_friend_request('user_x') $$, '%rate limited%', 'friend requests are rate limited (20/hour)');

-- ================================================================ FT-06: submission rate limit (fresh user)
reset role;
select sectest.as_user('c3333333-3333-3333-3333-333333333333');
select lives_ok($$ select submit_test(sectest.payload(gen_random_uuid(), 50)) from generate_series(1, 30) $$, '30 submissions in a minute are allowed');
select throws_like($$ select submit_test(sectest.payload(gen_random_uuid(), 50)) $$, '%rate limited%', 'the 31st submission in a minute is rate limited');

-- ================================================================ FT-10: account deletion
select throws_like($$ select delete_my_account('s_carol') $$, '%password again%', 'deletion requires a recent sign-in');
reset role;
select sectest.as_user('c3333333-3333-3333-3333-333333333333', interval '20 minutes');
select throws_like($$ select delete_my_account('s_carol') $$, '%password again%', 'a 20-minute-old sign-in is not recent enough');
reset role;
select sectest.as_user('c3333333-3333-3333-3333-333333333333', interval '1 minute');
select throws_like($$ select delete_my_account('s_bob') $$, '%did not match%', 'confirmation must match your own username');
reset role;
select set_config('role', 'authenticated', true), set_config('request.jwt.claims', jsonb_build_object('sub', 'c3333333-3333-3333-3333-333333333333', 'role', 'authenticated',
  'amr', jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint)))::text, true);
select throws_like($$ select delete_my_account('s_carol') $$, '%password again%', 'a fresh recovery/OTP session cannot delete the account');
reset role;
select sectest.as_user('c3333333-3333-3333-3333-333333333333', interval '1 minute');
select lives_ok($$ select delete_my_account('s_carol') $$, 'carol deletes her account after re-authenticating');
reset role;
select is((select count(*)::int from auth.users where id = 'c3333333-3333-3333-3333-333333333333'), 0, 'auth user removed');
select is((select count(*)::int from profiles where id = 'c3333333-3333-3333-3333-333333333333')
        + (select count(*)::int from typing_tests where user_id = 'c3333333-3333-3333-3333-333333333333')
        + (select count(*)::int from xp_transactions where user_id = 'c3333333-3333-3333-3333-333333333333')
        + (select count(*)::int from friendships where 'c3333333-3333-3333-3333-333333333333' in (requester, addressee))
        + (select count(*)::int from rate_limits where user_id = 'c3333333-3333-3333-3333-333333333333'), 0,
  'profile, tests, XP, friendships and rate-limit rows cascade away');
select is((select count(*)::int from auth.users where id = 'b2222222-2222-2222-2222-222222222222'), 1, 'other accounts untouched');

select * from finish();
rollback;
