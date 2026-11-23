-- pgTAP tests for 20261125000000_public_by_default.sql: new accounts start public and on leaderboards, only the owner
-- can change either flag, and visibility is enforced by the database (direct table access and RPCs), not the UI.
-- Synthetic users only. Everything runs inside one transaction and is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(26);

-- finn's sign-up metadata tries to opt out; sign-up no longer reads privacy flags at all.
insert into auth.users (id, email, raw_user_meta_data) values
  ('e0000000-0000-4000-8000-000000000001', 'pd-erin@test.local', '{"username":"pd_erin"}'),
  ('e0000000-0000-4000-8000-000000000002', 'pd-finn@test.local', '{"username":"pd_finn","public_profile":false,"show_on_leaderboard":false}');

-- one verified ranked result for erin on the time-30 board
insert into typing_tests (id, user_id, created_at, mode, mode2, wpm, raw, accuracy, consistency, chars, duration_ms, words_typed, language, punctuation, numbers, difficulty, ranked, verified)
values ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', now(), 'time', 30, 88, 90, 98, 90, '{}', 30000, 44, 'english', false, false, 'normal', true, true);
insert into leaderboard_entries (user_id, mode, mode2, test_id, wpm, accuracy, duration_ms, created_at, verified)
values ('e0000000-0000-4000-8000-000000000001', 'time', 30, 'e1000000-0000-4000-8000-000000000001', 88, 98, 30000, now(), true);

-- ================================================================ defaults
select col_default_is('public', 'profiles', 'is_public', 'true', 'is_public defaults to true');
select col_default_is('public', 'profiles', 'show_on_leaderboard', 'true', 'show_on_leaderboard defaults to true');
select results_eq($$ select username, is_public, show_on_leaderboard from profiles where id in
  ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002') order by username $$,
  $$ values ('pd_erin'::text, true, true), ('pd_finn', true, true) $$,
  'new accounts start public and on leaderboards; sign-up metadata cannot change that');

-- ================================================================ anonymous visitor: only the intended public data
set local request.jwt.claims to '{"role":"anon"}'; -- anon carries no user: auth.uid() must be null
set local request.jwt.claim.sub to '';
set local role anon;
select throws_ok($$ select is_public from profiles $$, '42501', null, 'anon cannot read the profiles table directly');
select throws_ok($$ update profiles set is_public = false $$, '42501', null, 'anon cannot change anyone''s privacy flags');
select ok(exists (select 1 from get_leaderboard('global', 'time', 30) where username = 'pd_erin'), 'a new account appears on the global board');
select is((select array_agg(k order by k) from jsonb_object_keys(get_public_profile('pd_erin')) k),
  array['achievements', 'avatar', 'avg_accuracy', 'best_wpm', 'bio', 'created_at', 'current_streak', 'total_tests', 'total_xp', 'unverified_xp', 'username', 'verified_tests'],
  'a public profile exposes only the intended fields (no id, email or flags)');
select ok(get_public_profile('pd_erin')::text !~ '@', 'no email address in the public profile');
select ok(not exists (select 1 from get_leaderboard('global', 'time', 30) r where row_to_json(r)::text ~ '@'), 'no email address on the leaderboard');
reset role;

-- ================================================================ another user cannot touch erin's settings
set local role authenticated;
set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub to 'e0000000-0000-4000-8000-000000000002';
select is((select count(*)::int from profiles where id = 'e0000000-0000-4000-8000-000000000001'), 0, 'finn cannot read erin''s profile row');
update profiles set is_public = false, show_on_leaderboard = false where id = 'e0000000-0000-4000-8000-000000000001';
select throws_ok($$ update profiles set id = 'e0000000-0000-4000-8000-000000000001' where id = 'e0000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'finn cannot re-point his row at erin''s id');
reset role;
select results_eq($$ select is_public, show_on_leaderboard from profiles where id = 'e0000000-0000-4000-8000-000000000001' $$,
  $$ values (true, true) $$, 'finn''s update of erin''s row changed nothing (RLS)');

-- ================================================================ erin turns each option off and on, independently
set local role authenticated;
set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub to 'e0000000-0000-4000-8000-000000000001';
select lives_ok($$ update profiles set show_on_leaderboard = false where id = 'e0000000-0000-4000-8000-000000000001' $$, 'owner can hide herself from leaderboards');
select results_eq($$ select is_public, show_on_leaderboard from profiles $$, $$ values (true, false) $$, 'only the leaderboard flag changed');
reset role;

set local request.jwt.claims to '{"role":"anon"}'; -- anon carries no user: auth.uid() must be null
set local request.jwt.claim.sub to '';
set local role anon;
select ok(not exists (select 1 from get_leaderboard('global', 'time', 30) where username = 'pd_erin'), 'leaderboard opt-out takes effect immediately');
select isnt(get_public_profile('pd_erin'), null, 'her profile is still public (the options are independent)');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub to 'e0000000-0000-4000-8000-000000000001';
select lives_ok($$ update profiles set is_public = false where id = 'e0000000-0000-4000-8000-000000000001' $$, 'owner can make her profile private');
select isnt(get_public_profile('pd_erin'), null, 'the owner can still see her own private profile');
reset role;

set local request.jwt.claims to '{"role":"anon"}'; -- anon carries no user: auth.uid() must be null
set local request.jwt.claim.sub to '';
set local role anon;
select is(get_public_profile('pd_erin'), null, 'a private profile is hidden from anon immediately');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000002","role":"authenticated"}';
set local request.jwt.claim.sub to 'e0000000-0000-4000-8000-000000000002';
select is(get_public_profile('pd_erin'), null, 'a private profile is hidden from other signed-in users');
reset role;

-- a later session (fresh claims) reads back the saved values, then turns both on again
set local role authenticated;
set local request.jwt.claims to '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub to 'e0000000-0000-4000-8000-000000000001';
select results_eq($$ select is_public, show_on_leaderboard from profiles $$, $$ values (false, false) $$, 'both choices persist across sessions');
select lives_ok($$ update profiles set is_public = true, show_on_leaderboard = true where id = 'e0000000-0000-4000-8000-000000000001' $$, 'owner can re-enable both');
select results_eq($$ select is_public, show_on_leaderboard from profiles $$, $$ values (true, true) $$, 'both are on again');
select throws_ok($$ update profiles set created_at = now() where id = 'e0000000-0000-4000-8000-000000000001' $$, '42501', null,
  'only username, privacy flags, avatar and bio are client-writable');
reset role;

set local request.jwt.claims to '{"role":"anon"}'; -- anon carries no user: auth.uid() must be null
set local request.jwt.claim.sub to '';
set local role anon;
select ok(exists (select 1 from get_leaderboard('global', 'time', 30) where username = 'pd_erin'), 're-enabling puts her back on the board');
select isnt(get_public_profile('pd_erin'), null, 're-enabling makes her profile public again');
reset role;

select * from finish();
rollback;
