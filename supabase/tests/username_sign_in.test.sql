-- pgTAP tests for 20261126000000_username_sign_in.sql and case-insensitive username uniqueness.
-- Synthetic users; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values
  ('b0000000-0000-4000-8000-000000000001', 'usn-alice@test.local', extensions.crypt('Alice-Passw0rd', extensions.gen_salt('bf')), '{"username":"Usn_Alice"}'),
  ('b0000000-0000-4000-8000-000000000002', 'usn-bob@test.local', extensions.crypt('Bob-Passw0rd', extensions.gen_salt('bf')), '{"username":"usn_bob"}');

-- ================================================================ uniqueness (database level)
select throws_ok($$ update profiles set username = 'USN_ALICE' where id = 'b0000000-0000-4000-8000-000000000002' $$, '23505', null,
  'a username differing only in case belongs to one account');

-- ================================================================ anonymous sign-in form
set local role anon;
select is(email_for_sign_in('usn_alice', 'Alice-Passw0rd'), 'usn-alice@test.local', 'anon: username + right password returns the email');
select is(email_for_sign_in('USN_ALICE', 'Alice-Passw0rd'), 'usn-alice@test.local', 'anon: the username is matched case-insensitively');
select is(email_for_sign_in('usn_alice', 'Bob-Passw0rd'), null, 'anon: a wrong password returns nothing');
select is(email_for_sign_in('usn_nobody', 'Alice-Passw0rd'), null, 'anon: an unknown username returns nothing');
select is(email_for_sign_in('usn-alice@test.local', 'Alice-Passw0rd'), null, 'anon: an email or malformed name returns nothing');
select is(email_for_sign_in('usn_alice', null), null, 'anon: a missing password returns nothing');

-- ================================================================ rate limit: 10 checks per account per 15 minutes (bob: checks 1-11)
select is((select count(*) from generate_series(1, 7) where email_for_sign_in('usn_bob', 'Wrong-Passw0rd') is null), 7::bigint,
  'wrong passwords answer null under the limit (checks 1-7)');
select is(email_for_sign_in('usn_bob', 'Bob-Passw0rd'), 'usn-bob@test.local', 'the right password still works (check 8)');
select is(email_for_sign_in('usn_bob', 'Wrong-Passw0rd'), null, 'check 9');
select is(email_for_sign_in('usn_bob', 'Wrong-Passw0rd'), null, 'check 10');
select throws_like($$ select email_for_sign_in('usn_bob', 'Bob-Passw0rd') $$, 'rate limited%', 'check 11 is refused, even with the right password');
reset role;

select * from finish();
rollback;
