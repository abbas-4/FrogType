-- pgTAP tests for RLS policies and server-side validation (expectations updated for 20261123000000_security_hardening.sql).
-- Run with: supabase test db   (or see README for running against the Supabase Postgres image)
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(25);

-- fixtures (as superuser)
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.local', '{"username":"alice"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.local', '{"username":"bob"}'),
  ('33333333-3333-3333-3333-333333333333', 'eve@test.local', '{"username":"bad name!"}');

create schema tests;
grant usage on schema tests to anon, authenticated;
create function tests.payload(p_id uuid, p_wpm numeric, p_mode text default 'time', p_mode2 int default 30, p_dur int default 30000)
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', p_id, 'created_at', now(), 'mode', p_mode, 'mode2', p_mode2, 'wpm', p_wpm, 'raw', p_wpm + 2,
    'accuracy', 97, 'consistency', 80,
    'chars', jsonb_build_object('correct', ceil(p_wpm * 5 * p_dur / 60000.0), 'incorrect', 2, 'extra', 0, 'missed', 0),
    'duration_ms', p_dur, 'words_typed', 30, 'language', 'english', 'punctuation', false, 'numbers', false,
    'difficulty', 'normal', 'samples', '[]'::jsonb, 'char_stats', '{}'::jsonb, 'bigram_errors', '{}'::jsonb);
$$;
grant execute on function tests.payload(uuid, numeric, text, int, int) to anon, authenticated;

-- 1-2 signup trigger
select is((select username from profiles where id = '11111111-1111-1111-1111-111111111111'), 'alice', 'profile created from signup metadata');
select matches((select username from profiles where id = '33333333-3333-3333-3333-333333333333'), '^frog_[0-9a-f]{8}$', 'invalid username replaced with generated one');

-- 3 daily targets match the client implementation (values from src/domain/daily.ts)
select results_eq(
  $$ select target_wpm, target_accuracy from ft_daily_targets('2026-11-22') union all select target_wpm, target_accuracy from ft_daily_targets('2025-01-01') $$,
  $$ values (55, 96), (40, 93) $$,
  'server daily targets match client');

-- ---------------------------------------------------------------- as anon
set local role anon;
select throws_ok($$ select submit_test(tests.payload(gen_random_uuid(), 50)) $$, '42501', null, 'anon cannot submit tests');
select throws_ok($$ select count(*) from typing_tests $$, '42501', null, 'anon has no table access at all (hardening migration)');

-- ---------------------------------------------------------------- as alice
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local request.jwt.claim.sub to '11111111-1111-1111-1111-111111111111'; -- older auth.uid() variant

select is(submit_test(tests.payload('aaaaaaaa-0000-0000-0000-000000000001', 60)) - 'flags' - 'wpm' - 'accuracy', '{"accepted": true, "duplicate": false, "ranked": false, "verified": false}'::jsonb, 'valid test without a server challenge is accepted but never ranked');
select lives_ok($$ select submit_test(tests.payload('aaaaaaaa-0000-0000-0000-000000000002', 61)) $$, 'back-to-back submissions are allowed (offline queue can drain; limit is 30/min)');
select throws_ok(
  $$ insert into typing_tests (id, user_id, created_at, mode, mode2, wpm, raw, accuracy, consistency, chars, duration_ms, words_typed, language, punctuation, numbers, difficulty)
     values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', now(), 'time', 30, 250, 250, 100, 100, '{}', 30000, 100, 'english', false, false, 'normal') $$,
  '42501', null, 'direct insert into typing_tests is blocked');
select throws_ok($$ update typing_tests set wpm = 299 $$, '42501', null, 'tests cannot be updated by clients (no update grant)');
select is((select wpm from typing_tests where id = 'aaaaaaaa-0000-0000-0000-000000000001')::numeric, 60.00, 'stored wpm unchanged');
select throws_ok($$ insert into xp_transactions (user_id, key, amount, reason) values ('11111111-1111-1111-1111-111111111111', 'x', 500, 'x') $$, '42501', null, 'xp cannot be inserted directly');
select throws_ok($$ insert into leaderboard_entries values ('11111111-1111-1111-1111-111111111111', 'time', 30, 'aaaaaaaa-0000-0000-0000-000000000001', 299, 100, 30000, now()) $$, '42501', null, 'leaderboard cannot be written directly');
select is((select count(*) from typing_tests)::int, 2, 'alice sees her own tests');

select lives_ok($$ select send_friend_request('bob') $$, 'alice sends a friend request');
select lives_ok($$ select merge_progress('[{"key":"test:aaaaaaaa-0000-0000-0000-000000000001","amount":20,"reason":"ok"},{"key":"streak:2026-11-22","amount":9999,"reason":"cheat"},{"key":"test:bbbbbbbb-0000-0000-0000-000000000000","amount":10,"reason":"fake"}]', '{"first-test":"x","not-real":"x"}', '{}') $$, 'merge_progress runs');
select is((select count(*) from xp_transactions where key !~ '^test:aaaaaaaa-0000-0000-0000-00000000000[12]$' or verified)::int, 0, 'client xp claims are ignored; only server-derived, unverified test xp exists');
select is((select count(*) from user_achievements)::int, 0, 'client achievement claims are ignored (no verified tests yet)');

-- ---------------------------------------------------------------- as bob
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
set local request.jwt.claim.sub to '22222222-2222-2222-2222-222222222222'; -- older auth.uid() variant

select is((select count(*) from typing_tests)::int, 0, 'bob cannot see alice''s tests');
select is((select count(*) from xp_transactions)::int, 0, 'bob cannot see alice''s xp');
update profiles set username = 'hacked' where id = '11111111-1111-1111-1111-111111111111';
select throws_ok($$ update profiles set created_at = now() where id = '22222222-2222-2222-2222-222222222222' $$, '42501', null, 'protected profile columns cannot be changed');
select throws_like($$ select submit_test(jsonb_set(tests.payload(gen_random_uuid(), 120), '{chars,correct}', '10')) $$, '%inconsistent%', 'wpm not backed by characters is rejected');
select throws_like($$ select submit_test(tests.payload(gen_random_uuid(), 50, 'time', 60, 30000)) $$, '%duration%', 'time-mode duration mismatch is rejected');
select lives_ok($$ select respond_friend_request((select id from friendships limit 1), true) $$, 'bob accepts the friend request');

-- ---------------------------------------------------------------- back to superuser for assertions
reset role;
select is((select username from profiles where id = '11111111-1111-1111-1111-111111111111'), 'alice', 'bob could not rename alice');
select is((select count(*) from get_leaderboard('global', 'time', 30))::int, 0, 'unverified results never reach the leaderboard');

select * from finish();
rollback;
