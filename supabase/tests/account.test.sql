-- pgTAP tests for 20261124000000_account_profiles.sql: avatar/bio constraints, protected profile updates,
-- username availability, public-profile privacy and cross-user isolation. Synthetic users; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(31);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000000001', 'acc-alice@test.local', '{"username":"acc_alice","public_profile":"true"}'),
  ('a0000000-0000-4000-8000-000000000002', 'acc-bob@test.local', '{"username":"acc_bob"}');
-- New accounts start public (20261125000000); bob has since chosen a private profile.
update profiles set is_public = false where id = 'a0000000-0000-4000-8000-000000000002';

-- ================================================================ schema and privileges
select has_column('public', 'profiles', 'avatar', 'profiles.avatar exists');
select has_column('public', 'profiles', 'bio', 'profiles.bio exists');
select is((select avatar from profiles where id = 'a0000000-0000-4000-8000-000000000001'), null, 'new accounts start without an avatar');
select is(has_column_privilege('authenticated', 'public.profiles', 'avatar', 'UPDATE'), true, 'authenticated may update avatar');
select is(has_column_privilege('authenticated', 'public.profiles', 'bio', 'UPDATE'), true, 'authenticated may update bio');
select is(has_column_privilege('authenticated', 'public.profiles', 'created_at', 'UPDATE') or has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE'), false,
  'id and created_at stay read-only');
select is(has_column_privilege('anon', 'public.profiles', 'bio', 'UPDATE') or has_table_privilege('anon', 'public.profiles', 'SELECT'), false, 'anon cannot read or write profiles');
select is((select relrowsecurity from pg_class where oid = 'public.anon_rate_limits'::regclass), true, 'anon_rate_limits has RLS');
select is(has_table_privilege('anon', 'public.anon_rate_limits', 'SELECT') or has_table_privilege('authenticated', 'public.anon_rate_limits', 'SELECT'), false,
  'rate-limit counters are not readable by clients');
select is(has_function_privilege('authenticated', 'public.ft_profile_guard()', 'execute') or has_function_privilege('anon', 'public.ft_profile_guard()', 'execute'), false,
  'the profile trigger function is not callable by clients');

-- ================================================================ anonymous visitor (sign-up form)
set local role anon;
select is(username_available('fresh_name_1'), true, 'anon: an unused username is available');
select is(username_available('ACC_ALICE'), false, 'anon: taken usernames are detected case-insensitively');
select is(username_available('no spaces!'), false, 'anon: invalid formats are never available');
select is(username_available('ab'), false, 'anon: too short is never available');
select is(get_public_profile('acc_bob'), null, 'anon: a private profile is invisible');
select is(get_public_profile('acc_alice') ->> 'username', 'acc_alice', 'anon: a public profile is visible');
select ok(get_public_profile('acc_alice') ? 'avatar' and get_public_profile('acc_alice') ? 'bio', 'public profile includes avatar and bio keys');
reset role;

-- ================================================================ alice edits her own profile
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub to 'a0000000-0000-4000-8000-000000000001';

select lives_ok($$ update profiles set avatar = 'cat', bio = '  Fast fingers,   slow coffee.  ' where id = 'a0000000-0000-4000-8000-000000000001' $$, 'owner can set avatar and bio');
select is((select bio from profiles where id = 'a0000000-0000-4000-8000-000000000001'), 'Fast fingers,   slow coffee.', 'bio is trimmed');
select throws_ok($$ update profiles set avatar = 'https://evil.example/x.png' where id = 'a0000000-0000-4000-8000-000000000001' $$, '23514', null,
  'only built-in avatar keys are accepted (no URLs)');
select throws_ok($$ update profiles set bio = repeat('x', 161) where id = 'a0000000-0000-4000-8000-000000000001' $$, '23514', null, 'bio is limited to 160 characters');
select throws_ok($$ update profiles set bio = E'line one\nline two' where id = 'a0000000-0000-4000-8000-000000000001' $$, '23514', null, 'bio rejects control characters');
select lives_ok($$ update profiles set bio = '   ' where id = 'a0000000-0000-4000-8000-000000000001' $$, 'a blank bio is allowed');
select is((select bio from profiles where id = 'a0000000-0000-4000-8000-000000000001'), null, 'a blank bio is stored as null');
select throws_ok($$ update profiles set username = 'Acc_Bob' where id = 'a0000000-0000-4000-8000-000000000001' $$, '23505', null,
  'duplicate usernames are rejected case-insensitively');
select is(username_available('acc_alice'), true, 'her own current username counts as available to her');
select throws_ok($$ update profiles set created_at = now() - interval '9 years' where id = 'a0000000-0000-4000-8000-000000000001' $$, '42501', null,
  'created_at cannot be changed');

-- cross-user: RLS hides bob's row from alice, so the update touches nothing
update profiles set bio = 'pwned', avatar = 'ghost' where id = 'a0000000-0000-4000-8000-000000000002';
reset role;
select is((select coalesce(bio, '') || coalesce(avatar, '') from profiles where id = 'a0000000-0000-4000-8000-000000000002'), '', 'a user cannot edit another user''s profile');

-- username changes are rate-limited (5 per day)
set local role authenticated;
set local request.jwt.claims to '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
set local request.jwt.claim.sub to 'a0000000-0000-4000-8000-000000000001';
select lives_ok($$ do $d$ begin for i in 1..5 loop update public.profiles set username = 'acc_alice_' || i where id = 'a0000000-0000-4000-8000-000000000001'; end loop; end $d$ $$,
  'five username changes in a day are allowed');
select throws_like($$ update profiles set username = 'acc_alice_6' where id = 'a0000000-0000-4000-8000-000000000001' $$, 'rate limited%', 'the sixth username change in a day is refused');
reset role;

-- ================================================================ anonymous availability checks are capped globally
insert into anon_rate_limits (action, window_start, hits) values ('username-check', clock_timestamp(), 300)
  on conflict (action) do update set window_start = excluded.window_start, hits = excluded.hits;
set local request.jwt.claims to '{"role":"anon"}'; -- drop alice's claims: auth.uid() must be null here
set local request.jwt.claim.sub to '';
set local role anon;
select throws_like($$ select username_available('another_name') $$, 'rate limited%', 'anonymous username checks are capped (300/min shared)');
reset role;

select * from finish();
rollback;
