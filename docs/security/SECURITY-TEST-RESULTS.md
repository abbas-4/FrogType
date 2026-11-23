# FrogType security test results

Every result below was produced by actually running the command on 2026-11-23 on the branch `security/frogtype-complete-hardening`. Nothing here was assumed from earlier runs.

## Environment

| | |
|---|---|
| Machine | macOS (Darwin 25.6.0), Docker Desktop |
| Node / npm | v24.21.0 / 11.19.0 |
| Supabase CLI | 3.2.0 (`npx supabase`), local stack: `supabase/postgres:17.12.0.000`, `gotrue:v2.198.0`, `postgrest:v16.5`, `kong:2.8.1`, mailpit |
| Browser tests | Playwright 1.65.1, Chromium |
| Isolation | Dedicated local stack (project `frogtype`, ports 553xx), synthetic accounts only, reset between runs. No production system or real user involved. |

## Baseline (before any change, commit `a22bfcc`)

| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm test` | 56 / 56 pass |
| `npm run test:e2e` | 8 / 8 pass |
| `npx supabase test db` | 24 / 24 pass |
| `npm audit --audit-level=moderate` | 0 vulnerabilities |
| gitleaks (git history, 2 commits) | no leaks |

## Final results

| Command | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm audit --audit-level=moderate` | **0 vulnerabilities** |
| `npm run lint` | pass (now also covers integration and online-e2e code) |
| `npm run typecheck` | pass |
| `npm test` (Vitest) | **87 / 87 pass**, 14 files |
| `npm run build` | pass; production `index.html` contains the CSP meta tag |
| `npm run check:secrets` | pass: 32 files in `dist/`, no service-role, secret or private keys |
| `npm run test:e2e` (Playwright, no Supabase) | **8 / 8 pass** |
| `npx supabase test db` (pgTAP) | **134 / 134 pass** (`database.test.sql` 25, `security.test.sql` 109) |
| `npm run test:integration` (HTTP, real GoTrue) | **14 / 14 pass** |
| `npm run test:e2e:online` (Playwright against the local stack) | **7 / 7 pass** |

Total automated checks: **250**, all passing. Failures hit during development and how each was resolved are listed under [Issues found by the tests](#issues-found-by-the-tests).

## Security scans

| Tool | Scope | Result |
|---|---|---|
| `npm audit` | 337 packages in the lockfile | 0 vulnerabilities |
| OSV-Scanner v2.2.4 (Docker) | `package-lock.json`, 337 packages | No issues found |
| Semgrep 1.140.0 (Docker), packs `p/javascript p/typescript p/react p/secrets p/github-actions` | 86 tracked files, 122 rules | 0 findings. One earlier finding, `add-mask` on a CI value, was fixed by removing the step; the value is the local demo key |
| gitleaks v8.30.1 | Git history (`git` mode) and working tree (`dir` mode) | History: no leaks. Working tree: 1 hit in gitignored `dist-online/`, the local stack's public demo **anon** key in a local test build, not committed. 1 synthetic test password marked `gitleaks:allow` with a reason |
| actionlint 1.7.7 | `.github/workflows/*` | 0 issues |
| `check-dist-secrets.mjs` | Production build output | pass |
| CodeQL (security-extended) | Runs in CI on the PR | Not run locally |
| OWASP ZAP | n/a | Not run: no deployed target exists. Header and CSP behaviour is asserted by the online e2e suite against the production build |

## Database authorization results (pgTAP, `supabase/tests/security.test.sql`)

As `anon`:
- Cannot call `issue_challenge`, `sync_progress`, `delete_my_account` or internal helpers (42501).
- Cannot read `profiles` or `xp_transactions`, and cannot write the leaderboard.
- Private profiles return `null`.

Structural checks:
- Every public function has `search_path=""`.
- Definer functions are owned by `postgres`.
- `anon` EXECUTE allow-list is exactly `{get_leaderboard, get_public_profile}`, and the `authenticated` allow-list is exactly the 11 intended RPCs.
- Clients hold zero INSERT/UPDATE/TRUNCATE/REFERENCES/TRIGGER table grants.
- RLS is on for every table, and clients can't CREATE in `public`.

Cross-user:
- Bob can't read Alice's tests or profile row, can't use her challenge, and his DELETE removes none of her tests.
- Third parties can't accept requests.
- Requesters can't delete declined rows.

Business logic:
- **Challenges:** the honest run verifies and ranks; the following are all rejected or flagged and unranked:
  - faster than wall-clock time
  - replay and duplicate id
  - inflated WPM (server value stored)
  - uniform timing
  - incomplete keylog
  - non-numeric or non-monotonic timestamps
  - timestamps over 1 h
  - expired challenge
  - configuration mismatch
- **Progression:** forged `merge_progress` keys, amounts, achievements and lesson flags are ignored. Sync is idempotent. Backdated tests add no streak. Imports earn no XP and don't change public stats.
- **Bounds:** batch over 200, payload over 256 KB, `char_stats` over 200 keys, string metrics, negative counts, bad `daily_date`, unknown lesson.
- **Rate limits:** the 31st submission per minute and the 21st friend request per hour are refused.
- **Deletion:** refused without a recent password sign-in, with a 20-minute-old sign-in, with an OTP/recovery session, or with the wrong confirmation. A successful deletion cascades every user row; other accounts are untouched.

## HTTP integration results (`tests-integration/security.test.ts`)

| Scenario (prompt #) | Expectation | Result |
|---|---|---|
| Anonymous protected operations (1) | 7 RPCs and 6 tables refused | pass |
| Real engine → server replay with typos and word-delete (3) | Server WPM within 0.05 and accuracy within 0.01 of the client; verified, ranked, on the board | pass |
| Inflated metrics, replay, another user's challenge (3, 5) | `metric_mismatch` (server value stored), `challenge_invalid` ×2 | pass |
| One challenge raced by 6 parallel requests (5, 6) | Exactly one verified | pass |
| 40 parallel submissions (6) | Exactly 30 accepted, 10 rate limited | pass |
| Oversized / malformed / over-batch (7) | All refused | pass |
| Cross-account REST read/update/delete/insert (2) | No rows read or changed; insert and protected-column update refused | pass |
| Forged XP/achievements/lessons + forged import (4, 15) | Nothing stored; public profile shows 0 / 0 / [] | pass |
| Friend abuse, private profile visibility (10, 13) | Third-party and requester acceptance refused; private profile `null` to anon and others | pass |
| Hostile usernames (12) | XSS/SQL/overlong/short/emoji rejected; hostile sign-up metadata replaced with `frog_xxxxxxxx` | pass |
| Export + deletion | Own rows only; wrong confirmation refused; account and rows gone | pass |
| Recovery link: valid once; weak password; reuse; reused code; tampered; expired (11) | Server enforces policy; reuse, tampered and expired redirect with an error | pass |
| Enumeration | Reset for unknown email is indistinguishable. **Sign-up API returns `user_already_exists` for confirmed emails** (upstream GoTrue behaviour, kept as a canary; UI masks it) | pass (documents residual N-6) |

## Browser results (`e2e-online/online.spec.ts`, real UI + local stack)

| Journey | Result |
|---|---|
| Production headers present; zero CSP violations on 7 pages with Supabase enabled | pass |
| Sign-up: password policy, consent unchecked by default, email confirmation via mailpit, profile stored private | pass |
| Two accounts in one browser: A's history hidden after sign-out and from B; B's cloud account empty (8) | pass |
| Upload blocked for A, switch to B, sync as B: nothing uploaded to either; A signs back in, A's test goes to A (8, 9) | pass |
| Ranked test: waits for the server passage, verified and ranked in DB, shown on the leaderboard | pass |
| Recovery UI: mismatch caught, valid link sets password, then reused / tampered / expired links show the invalid state; direct visit shows no password form (11) | pass |
| Export downloads only own rows; deletion rejects a wrong password, then deletes and clears local data | pass |

Unit-level race coverage (`tests/sync-isolation.test.ts`): sign-out **during** an in-flight upload abandons the run; uploads carry only A's token; B's store and A's queue stay intact. Prompt scenario 9 (local storage manipulation) is covered by `tests/security-storage.test.ts`: prototype pollution, out-of-range and non-finite values, oversized and corrupt storage, and a 2,000-case seeded fuzz test.

## Regression: application features

| Feature | Evidence |
|---|---|
| Typing tests, live WPM/accuracy, results, word and time modes, Tab restart, caret | Offline e2e 8/8; `TypingTest`/engine unit tests |
| Lessons, XP/levels, achievements, streaks, daily challenge determinism | Unit tests; offline e2e "passing a lesson" |
| Statistics and history | Offline e2e "words mode … persists to statistics"; online e2e stats checks |
| Registration, login, logout, password recovery | Online e2e + integration |
| Offline mode / queued sync | Unit sync tests; online e2e blocked-upload journey |
| Cloud sync, leaderboards, friends, public/private profiles | Online e2e + integration + pgTAP |
| Settings persistence | Offline e2e |
| Keyboard accessibility | Offline e2e "keyboard users can reach every page" |
| Mobile responsiveness | Manual check in the browser pane at 375 px: `/profile` sign-up form and `/reset-password`; no horizontal scroll |
| Visual check (desktop) | Sign-up form with unchecked opt-ins and password hint, matching the existing charcoal/green design; no console errors |

## Issues found by the tests

Fixed before commit:

1. A flagged replay (uniform timing or metric mismatch) still counted as `verified` and unlocked WPM achievements (pgTAP). Fixed: verified requires zero flags.
2. Second review: unbounded keylog timestamps made the idle check cost O(seconds × keys), a CPU DoS. Exceptions after the replay rolled back rate-limit counters. Fixed: timestamps capped at 1 h, idle counted in O(keys), all casts validated before the replay, keylogs capped at 8,000 events. Measured worst case 184 ms; a realistic 120 s test 40 ms.
3. Second review: account deletion also accepted recovery/OTP sessions. Fixed: password sign-in only.
4. Password hint inside the `<label>` polluted the field's accessible name (e2e). Moved outside, linked with `aria-describedby`.
5. A stray local preview server (built without Supabase settings) was reused by Playwright and failed every online test. Fixed: the online config always builds its own server.

## GitHub repository settings

At audit time `main` was unprotected with no rulesets. Secret scanning and push protection were on; Dependabot security updates were off. Changes made with the owner's authorization, and their outcome, are in the pull-request description and in [SECURITY-FIXES.md](SECURITY-FIXES.md#github-delivery).

## Known limitations and blockers

- No deployment exists, so production headers, TLS and HSTS can't be tested ([checklist §2](SECURITY-CHECKLIST.md#2-hosting-and-http-headers)).
- No hosted Supabase project was examined. Auth settings, rate limits, SMTP and live grants must be checked after applying the migrations ([checklist §1](SECURITY-CHECKLIST.md#1-supabase-project-production)).
- The CI workflows and CodeQL run for the first time on the PR.
- Real-email deliverability was not tested (mailpit only).
