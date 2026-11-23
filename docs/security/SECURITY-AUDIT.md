# FrogType security audit and remediation

| | |
|---|---|
| Audit date | 2026-11-22 / 23 |
| Audited commit | `main` @ `a22bfcc3d72c607d3c18574818867ceefc667c3a` |
| Remediation branch | `security/frogtype-complete-hardening` |
| Prior report | *FrogType v1 — Security Audit* (2026-11-22, findings FT-01 … FT-13) |
| References | OWASP ASVS 4.0.3 (V2 auth, V3 session, V4 access control, V5 validation, V8 data protection, V11 business logic, V14 config), OWASP Top 10 2021, Supabase function/RLS/production guidance |

This is a repository-based review plus active testing against an **isolated local Supabase stack** (Docker) with synthetic accounts. No production system, real user, or third-party service was tested. No deployment of FrogType exists (no GitHub Pages, homepage or deployments on the repository), so production headers and hosted Supabase settings could not be verified — see [Areas that could not be verified](#areas-that-could-not-be-verified).

**No security audit can show that an application cannot be hacked.** This report states what was fixed, how it was tested, and what risk remains.

## Methodology

1. Read every source file, both migrations, all tests, CI/config; traced each user-controlled input from the browser (keyboard, localStorage, URL, forms) to localStorage and to each RPC/table.
2. Inspected live database state on the local stack: table grants, function ACLs, default privileges, RLS flags, function owners and `search_path`.
3. Reproduced the 13 prior findings where they were reproducible, then fixed them.
4. Independent review against ASVS/Top 10 categories (auth, session, access control, injection, XSS, storage, business logic, supply chain, deployment).
5. Wrote attack tests at four layers: pgTAP (in-database, as `anon`/`authenticated` roles), HTTP integration (supabase-js with real GoTrue users), browser e2e (Playwright against the local stack), unit (Vitest, mocked network for race conditions).
6. Scanners: `npm audit`, OSV-Scanner, Semgrep (JS/TS/React/secrets/GitHub-Actions rule packs), gitleaks (full git history), actionlint, a custom build-output secret check.
7. Second independent review of the final diff (see [Second review](#second-review-phase-7)).

## Summary

| Area | Before | After |
|---|---|---|
| Leaderboard integrity | Client-computed scores, plausibility only | Server-issued single-use passage + server replay of the keystroke log; only server-computed, unflagged results rank |
| XP / achievements / lessons | Client claims accepted by `merge_progress` | Derived only from server records; client claims ignored; verified vs unverified separated |
| Shared-browser isolation | One localStorage key for everyone; queue could upload under another account | Per-account namespaces, identity-pinned sync, stale-run cancellation, consent-gated guest import |
| Password recovery | Link landed on /profile with no way to set a password | Dedicated PKCE recovery flow, policy, other sessions revoked |
| Privileged SQL | `search_path = public`; clients held full table grants incl. TRUNCATE; future functions auto-exposed | `search_path = ''`, qualified names, minimal grants, default privileges revoked |
| Abuse limits | Racy read-then-insert limit | Atomic per-user counters on every mutating RPC, payload/record bounds |
| Privacy | Public by default; profiles table enumerable | Private by default with opt-in at sign-up; profiles readable only by owner |
| Account lifecycle | No export or deletion | JSON export; re-authenticated self-service deletion with cascade |

**Assessment:** all 13 prior findings and 13 additional findings have a documented resolution. Two areas carry deliberate residual risk: (1) leaderboard anti-cheat cannot prove a human typed the keystrokes; (2) daily-challenge and lesson rewards rest on client-generated passages and are stored as *unverified*. Production readiness depends on the manual settings in [SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md).

## Confirmed vulnerabilities

Severity reflects impact if the cloud features are deployed. Status vocabulary: *Fixed and verified*, *Fixed but not fully verified*, *Mitigated with residual risk*, *Unresolved or blocked*, *Not applicable*.

### FT-01 — Leaderboard scores were client-asserted (High) — Mitigated with residual risk

- **Where:** `supabase/migrations/20261122000000_init.sql` `submit_test`, `src/services/cloud.ts`.
- **Root cause:** The server ranked whatever WPM the browser reported once it passed range and consistency checks. A custom client could post `wpm: 249` with matching character counts.
- **Fix:** `issue_challenge(mode, mode2)` returns a server-generated passage under an unpredictable v4 UUID (`gen_random_uuid`, 122 random bits), bound to the user, single-use, expiring after duration + 15 min. The engine (`src/engine/core.ts`) records every applied key with its time since the first keystroke. `submit_test` atomically consumes the challenge (`UPDATE … WHERE consumed_at IS NULL … RETURNING`) and replays the keylog against the stored passage with `ft_replay`, a line-by-line port of the engine and metrics. **Every metric is replaced by the server's value**; mismatches are flagged. It also rejects results finished faster than wall-clock time since issuance, incomplete or non-monotonic logs, invalid runs (engine rules), and flags machine-uniform timing and burst input. Only unflagged, verified, standard-board results (English, normal difficulty, no punctuation/numbers) reach `leaderboard_entries`, with server timestamps. Offline and non-standard tests still save and sync as unverified.
- **Evidence:** pgTAP `security.test.sql` (honest run ranks; faster-than-wall-clock, replay, duplicate id, fabricated metrics, uniform timing, incomplete, malformed, non-monotonic, expired, config mismatch, cross-account); integration `score integrity` (real engine → server: WPM within 0.05 and accuracy within 0.01, with typos and word deletion; inflated metrics; replay; stolen challenge; 6-way race verifies once); e2e `a ranked test uses a server passage…`.
- **Residual risk:** A modified client or bot that types the real passage, or generates human-like timings, can still rank. Server replay raises the cost from "edit one number" to "drive the real passage in real time with plausible timing". Leaderboard copy says so explicitly. Moderation tooling and storing keylogs for review are recommended next steps.

### FT-02 — XP, achievements and lessons were client-asserted (High) — Fixed and verified

- **Where:** `merge_progress` (init migration).
- **Root cause:** It inserted arbitrary `daily:`/`streak:` keys without checking activity, any known achievement id, and lesson completion flags.
- **Fix:** `merge_progress` is now a backwards-compatible shim that ignores its arguments. `ft_award(user)` derives everything idempotently from server rows:
  - XP per live test, using the server formula from stored fields.
  - Personal bests among verified tests.
  - Lesson XP only when a live lesson test meets the server's targets.
  - Daily XP only from `challenge_submissions` decided by the server.
  - Streaks from server-clock days with verified tests.
  - Achievements from verified tests.

  Every XP and achievement row now carries `verified`. Only rows derived from server-replayed tests are verified; lesson/daily rewards and unverified tests are stored unverified. Public surfaces (`get_public_profile`) count only verified rows and report unverified XP separately. Imported history never earns XP. Existing rows are kept, marked unverified, and re-derived by a backfill (non-destructive).
- **Evidence:** pgTAP (fabricated dated/lesson keys absent, claimed amounts ignored, impossible achievements absent, lesson completion unclaimable, idempotent resync, backdated tests add no streak, imports earn nothing); integration `forged progression and imports`.

### FT-03 — Cross-account local data and sync contamination (High) — Fixed and verified

- **Where:** `src/persistence/storage.ts`, `src/state/store.ts`, `src/services/sync.ts`.
- **Root causes:**
  - One shared `frogtype:progress` key.
  - Sign-out did not swap state.
  - `syncNow` uploaded the queue under whoever was signed in.
  - `acceptMigration` fell back to importing *all* local history.
  - Async results were applied regardless of identity changes.
- **Fix:**
  - Storage is namespaced: the guest keeps `frogtype:progress`, each account gets `frogtype:progress:u:<uuid>`. The auth layer switches the in-memory store synchronously on every identity change, before render.
  - Sync captures (generation, user id) and uses a client pinned to that session's access token, so in-flight requests can't switch identity. It re-checks identity before each mutation and before every local write, and persists queue progress per item.
  - Guest data is offered as an explicit, one-time move into the account, then removed from guest storage.
  - Profile responses arriving after an account switch are discarded.
  - A "Sign out and remove my data from this browser" option was added.
- **Evidence:** unit `sync-isolation.test.ts` (A/B histories; A's offline queue never uploaded as B; sign-out during an in-flight sync abandons the run, with uploads only under A's token; guest consent; stale profile); unit `security-storage.test.ts`; e2e `two accounts sharing a browser…`, `a queued result that failed to upload is never sent under the next account`.

### FT-04 — Password recovery could not be completed (Medium) — Fixed and verified (local GoTrue)

- **Where:** `resetPassword` redirected to `/profile`; there was no new-password form.
- **Fix:**
  - The auth client uses the PKCE flow, so a recovery code works only in the browser that requested it.
  - The reset link lands on `/reset-password`, which recognises the `PASSWORD_RECOVERY` event and only then shows a new-password form.
  - Policy: at least 10 characters, upper- and lower-case letters and digits, max 72. Enforced client-side and server-side (`config.toml` `minimum_password_length`, `password_requirements`, `secure_password_change`).
  - `otp_expiry` is 15 min.
  - After a successful change, all other sessions are revoked.
  - Invalid, reused, tampered and expired links get a clear message and a re-request form.
  - Reset requests return the same message whether or not the email exists.
- **Evidence:** integration `password recovery` (valid link once, weak password rejected by server, old password dead, reuse/tampered/expired refused, unknown email indistinguishable); e2e `password recovery…` through the real UI and mailpit.

### FT-05 — SECURITY DEFINER hardening (Medium) — Fixed and verified

- **Fix:**
  - Every public function was recreated with `SET search_path = ''` and schema-qualified references.
  - Helpers that don't need definer rights are now `SECURITY INVOKER`.
  - EXECUTE is revoked from `PUBLIC`/`anon`/`authenticated` and granted per function. `anon` can run only `get_leaderboard` and `get_public_profile`.
  - Supabase's default privileges, which auto-grant EXECUTE and table access on new objects, are revoked so future functions are private until granted.
  - Every mutating RPC raises 42501 when `auth.uid()` is null.
- **Evidence:** pgTAP checks covering: search_path on every function; definer owner; exact anon and authenticated EXECUTE allow-lists; no client INSERT/UPDATE/TRUNCATE grants; RLS on every table; no CREATE on `public`; anon calls to internal helpers fail.

### FT-06 — Racy rate limits and unbounded resource use (Medium) — Fixed and verified (database layer)

- **Fix:** `ft_rate_limit(user, action, max, window)` is a fixed-window counter in one atomic upsert, so concurrent requests serialize on the row lock. Limits:

  | RPC / action | Limit |
  |---|---|
  | `submit_test` | 30/min, 1000/day |
  | `issue_challenge` | 60/5 min, 3000/day |
  | `import_tests` | 30 calls/hour, ≤200 per call, ≤4 MB per call, ≤5000 imported tests per account |
  | `sync_progress` | 20/min |
  | Friend requests | 20/hour, 60/day |

  Further bounds:
  - Stored tests: ≤20,000 per account. Rejected with a clear message, never silently dropped.
  - Payloads: ≤256 KB; `char_stats` ≤200 keys; `bigram_errors` ≤400 keys; samples bounded by duration.
  - Keylogs: ≤8,000 events (enough for a 120 s test at 300 WPM with corrections; worst-case replay measured at 184 ms).
  - Expired and consumed challenges are pruned on each issue.
- The client now backs off for 65 s on a rate-limit error instead of failing the sync.
- **Evidence:** integration: 40 parallel submissions accept exactly 30 and reject 10; oversized and malformed payloads refused; import batch bound. pgTAP: 31st submission per minute, friend limit, payload bounds.
- **Residual:** Auth endpoints (sign-up, sign-in, email) are rate-limited by Supabase Auth, not this code. Set them in the hosted project ([checklist](SECURITY-CHECKLIST.md)). Anonymous read RPCs rely on Supabase's API gateway.

### FT-07 — Public by default (Medium) — Fixed and verified

- **Fix:**
  - New accounts default to private and off-board, in both the DB column defaults and the local settings defaults.
  - Sign-up has two unchecked opt-in boxes. The trigger accepts only literal JSON `true` as consent.
  - The profiles table is readable only by its owner; public data flows through `get_public_profile`, which returns `null` for private profiles to everyone except the owner.
  - Leaderboards require `show_on_leaderboard`.
- **Evidence:** pgTAP (defaults, consent parsing, anon/other-user/owner visibility, opt-out removes from global board, friends board needs accepted friendship plus opt-in); integration; e2e sign-up check.
- **Note:** existing accounts keep their current settings (changing them silently would override a choice). Consider a one-time notice.

### FT-08 — Unprotected main, no CI or security workflows (Medium) — Fixed but not fully verified

- **Fix:** `.github/workflows/ci.yml` has three jobs:
  - `verify`: npm ci, `npm audit --audit-level=moderate`, lint, typecheck, unit, build, bundle secret check, offline Playwright.
  - `supabase`: local stack, pgTAP, HTTP integration, online Playwright.
  - `secrets`: gitleaks over the full history.

  Also added: `codeql.yml` (security-extended), `dependency-review.yml` (fails on moderate), `.github/dependabot.yml` (npm and actions, weekly), `SECURITY.md`. Workflows use `permissions: contents: read` (CodeQL adds `security-events: write`), pin actions to full commit SHAs, check out with `persist-credentials: false`, and avoid `pull_request_target` and untrusted interpolation. actionlint and Semgrep's GitHub-Actions rules pass.
- **Not fully verified:** the workflows run for the first time on the PR. Branch protection is covered in [SECURITY-TEST-RESULTS.md](SECURITY-TEST-RESULTS.md#github-repository-settings).

### FT-09 — No security headers (Medium) — Fixed but not fully verified (no deployment exists)

- **Fix:** A build plugin injects a strict CSP `<meta>` into the production `index.html`, which works on any static host: `default-src 'self'`, no inline script or style, `connect-src` limited to the configured Supabase origin (https/wss), `object-src 'none'`, `base-uri`/`form-action 'self'`. `vite preview` sends the full header set: the CSP with `frame-ancestors 'none'`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP. The e2e suite runs the app under these headers.
- **Evidence:** e2e asserts the headers and zero CSP violations across all pages with Supabase enabled.
- **Not verified:** HSTS, HTTPS redirects and `frame-ancestors` must be set at the real host. Copy-paste configs are in the checklist; verify with `curl -I` after deploying.

### FT-10 — No export or deletion (Medium) — Fixed and verified

- **Fix:**
  - "Download my data (JSON)" reads the user's own rows through RLS (no privileged key).
  - "Delete account" requires typing the username, re-entering the password (a fresh sign-in), and `delete_my_account`, which checks that the JWT `amr` timestamp is under 10 minutes old.
  - Deleting `auth.users` cascades to the profile, tests, XP, achievements, lesson and daily progress, leaderboard entries, friendships, challenges and rate-limit rows.
  - The local copy is removed and the session cleared.
  - The UI states that nothing is retained except provider backups until they expire.
- **Evidence:** pgTAP (no recent sign-in, stale sign-in, wrong confirmation, cascade, other accounts untouched); integration; e2e (wrong password refused, data downloaded, account gone, local copy removed).

### FT-11 — Weak localStorage validation (Low) — Fixed and verified

- **Fix:** `sanitizeTest`/`sanitizeProgress` validate every nested field:
  - Finite numbers in range.
  - Enums.
  - String and array bounds: 1000 history, 20,000 XP, 30 custom texts of ≤20,000 chars.
  - Sample, `charStats` and `bigramErrors` shapes.
  - Queue ids must exist in history.

  Unsafe keys (`__proto__`, `constructor`, `prototype`) are dropped, nested junk is repaired rather than discarding whole tests, and oversized storage (>8 MB) is not parsed.
- **Evidence:** unit tests, including a 2,000-case seeded fuzz test and a prototype-pollution test.

### FT-12 — HTTP Supabase URL allowed (Low) — Fixed and verified

- **Fix:** `checkSupabaseConfig` accepts `https:` URLs, plus `http:` only for `localhost`, `127.0.0.1` and `[::1]`. It rejects URLs with embedded credentials and refuses `sb_secret_…` keys or JWTs whose role is `service_role`; online features are then disabled. `npm run check:secrets` fails CI if a service-role or secret key, or a private key, appears in `dist/`.
- **Evidence:** unit `supabase-config.test.ts`; `check:secrets` on every build.

### FT-13 — Friend-request abuse and enumeration (Low–Medium) — Fixed and verified (residual)

- **Fix:**
  - Rate limits: 20/hour and 60/day.
  - The username format is validated.
  - Unknown usernames, existing relationships and declined requests return the same silent success.
  - Declines are kept as hidden `declined` rows, so the requester can't see or delete them and can't re-spam; the person who declined can still reach out later.
  - Concurrent requests rely on the unique pair index with `ON CONFLICT DO NOTHING`.
  - Only the addressee can respond.
- **Evidence:** pgTAP (unknown user, self, malformed, duplicates in any case, requester/third-party acceptance blocked, decline hidden and sticky, requester can't delete a declined row, rate limit); integration.
- **Residual:** the requester's outgoing list still shows a pending request when the username exists, which reveals existence at ≤20 lookups per hour. Usernames are already public on leaderboards.

### Additional findings from the independent audit

| ID | Severity | Finding | Fix | Status |
|---|---|---|---|---|
| N-1 | Medium | `anon`/`authenticated` held INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on every table (Supabase defaults). RLS was the only barrier, and RLS does not apply to TRUNCATE. | Revoked; only the needed SELECT/DELETE and column-level UPDATE remain | Fixed and verified (pgTAP grant checks) |
| N-2 | Medium | Default privileges auto-granted EXECUTE on any future `public` function, and table access, to `anon`/`authenticated` | `ALTER DEFAULT PRIVILEGES … REVOKE` | Fixed and verified |
| N-3 | Medium | `profiles` was readable by anyone for every public profile via REST, which allowed bulk enumeration of user UUIDs, privacy flags and creation dates | Owner-only policy; public data only through the RPC | Fixed and verified |
| N-4 | Medium | Public profile stats included imported (forgeable) tests | Verified tests only; unverified XP reported separately | Fixed and verified |
| N-5 | Medium | Streak days came from client `created_at`, so backdated tests fabricated streaks | `submitted_at` (server clock), verified tests only | Fixed and verified |
| N-6 | Low | GoTrue v2.198 reveals confirmed accounts on sign-up (`422 user_already_exists`) even with confirmations on | UI shows the same message as a fresh sign-up. The raw API still leaks it upstream (canary test). Mitigate with CAPTCHA and auth rate limits | Mitigated with residual risk |
| N-7 | Medium (availability/integrity) | The offline queue drained one test per sync: the 2 s limit threw on the second upload before progress was saved, so the same tests were re-submitted every sync | Per-item persistence, 30/min limit, back-off | Fixed and verified |
| N-8 | Low | Two sign-ups racing for one username made the trigger raise, so sign-up failed with a 500 | Fallback username on unique violation | Fixed and verified |
| N-9 | Low | Leaderboard `created_at` was client-supplied | Server time | Fixed and verified |
| N-10 | Low (fairness) | Easy-difficulty, punctuation and number tests competed on the same boards as standard tests | Ranking limited to the standard configuration, and labelled | Fixed and verified |
| N-11 | Low | Local auth config: 6-character passwords, no confirmations, reset links valid 1 h, no secure password change | `config.toml` hardened; hosted settings in the checklist | Fixed (local); hosted not verified |
| N-12 | Low | Password inputs had no max length; error messages from auth were shown raw (could vary by account state) | Max 72; normalised generic messages | Fixed and verified |
| N-13 | Info | Supabase session tokens live in localStorage, so any XSS could steal them | Strict CSP, no HTML injection sinks (`dangerouslySetInnerHTML`/`innerHTML` absent; Semgrep clean), React escaping | Mitigated with residual risk |

Areas reviewed and found sound: no SQL built from strings (all PL/pgSQL is static or parameterized), no open redirects (the reset redirect is built from `window.location.origin` and Supabase enforces an allow-list), no `eval`/HTML sinks, no third-party scripts, usernames constrained by regex at the database, and React escaping for all dynamic text.

## Remaining risks

1. **Bots and modified clients** can still produce plausible keylogs (FT-01). Web apps can't prove a human typed.
2. **Daily-challenge and lesson rewards** use client-generated passages, so they are stored as unverified and kept off public surfaces (FT-02).
3. **Account enumeration via the Supabase sign-up API** is an upstream behaviour (N-6).
4. **XSS → token theft** if a future change introduces an injection sink (N-13). The CSP is the main safety net.
5. **Hosted settings are unverified:** auth rate limits, CAPTCHA, SMTP, redirect allow-list, HSTS and other headers at the host ([checklist](SECURITY-CHECKLIST.md)).
6. **Existing accounts** keep public visibility if they had it (FT-07 note).
7. **Supabase provider backups** may retain deleted data until rotation; this is documented in the deletion dialog.

## Areas that could not be verified

- Production hosting, response headers, HSTS and TLS. No deployment exists, so nothing could be inspected.
- The hosted Supabase project, if one exists: Auth settings, live RLS and grants, migration state, backups, network restrictions. All testing used a local stack.
- Real SMTP deliverability for recovery and confirmation emails (local mailpit was used).
- First CI runs on GitHub; these happen on the PR.
- OWASP ZAP was not run: there is no deployed target, and the local preview is covered by the header assertions and browser tests.

## Second review (Phase 7)

See the "Second review" section of [SECURITY-FIXES.md](SECURITY-FIXES.md#second-review-phase-7) for the independent pass over the final diff and what it changed.
