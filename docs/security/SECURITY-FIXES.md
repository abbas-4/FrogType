# FrogType security fixes: before and after

Details, evidence and residual risk for each item are in [SECURITY-AUDIT.md](SECURITY-AUDIT.md). Test runs are in [SECURITY-TEST-RESULTS.md](SECURITY-TEST-RESULTS.md).

## Prior findings

| ID | Before | After | Status |
|---|---|---|---|
| FT-01 Leaderboard manipulation | Browser-computed WPM ranked after plausibility checks | Server-issued single-use passage; server replays the keylog and recomputes every metric; wall-clock, expiry, ownership, config and timing checks; only unflagged verified results rank | **Mitigated with residual risk** (a bot typing the real passage with human-like timing can still rank) |
| FT-02 XP/achievement/lesson forgery | `merge_progress` stored client claims | Progression derived from server records only; claims ignored; verified/unverified separated; imports earn nothing; idempotent | **Fixed and verified** |
| FT-03 Cross-account contamination | One localStorage key; queue uploaded under whoever was signed in | Per-account namespaces, synchronous switch on identity change, token-pinned sync, stale-run cancellation, consent-gated guest move, forget-this-browser option | **Fixed and verified** |
| FT-04 Incomplete recovery | Link opened /profile with no way to set a password | PKCE recovery to `/reset-password`, password policy (client and server), other sessions revoked, clear invalid/expired states, no enumeration | **Fixed and verified** (local GoTrue; production SMTP/redirects are config) |
| FT-05 Definer hardening | `search_path = public`; Supabase default grants | `search_path = ''`, qualified names, minimal EXECUTE and table grants, default privileges revoked | **Fixed and verified** |
| FT-06 Rate limits / resources | Racy read-then-insert limit; unbounded progress merge | Atomic per-user counters on every mutating RPC; payload, batch, record and keylog bounds; cheap replay (≤184 ms worst case) | **Fixed and verified** (DB layer); auth endpoint limits are hosted config |
| FT-07 Privacy defaults | Public profile and leaderboard by default; profiles table enumerable | Private by default; explicit opt-in at sign-up; owner-only table access; RPCs respect privacy | **Fixed and verified** (existing accounts unchanged by design) |
| FT-08 Repo / CI security | No CI, no scanning, unprotected `main` | CI (audit, lint, types, unit, build, secret check, e2e, pgTAP, integration, online e2e, gitleaks), CodeQL, dependency review, Dependabot, `SECURITY.md`, SHA-pinned least-privilege workflows | **Fixed but not fully verified** (first CI run happens on the PR) |
| FT-09 Security headers | None | Strict CSP meta in every production build; full header set on preview; host configs and verification steps in the checklist | **Fixed but not fully verified** (no deployment exists) |
| FT-10 Export / deletion | Neither existed | JSON export via RLS; deletion needs username, password and a recent password sign-in; full cascade; local copy removed | **Fixed and verified** |
| FT-11 Local storage validation | Shallow checks | Bounded nested validation, unsafe keys dropped, repair instead of loss, fuzz-tested | **Fixed and verified** |
| FT-12 Insecure Supabase URL | Any `http(s)` URL accepted | HTTPS only (loopback HTTP for local development); service-role/secret keys refused; build output scanned in CI | **Fixed and verified** |
| FT-13 Friend-request abuse | Unlimited, enumerating, re-spammable after decline | Rate-limited, generic responses, sticky hidden declines, strict authorization | **Fixed and verified** (outgoing list still reveals a username exists, at ≤20/hour) |

## Additional findings

| ID | Before | After | Status |
|---|---|---|---|
| N-1 Excess table grants | Clients held INSERT/UPDATE/DELETE/TRUNCATE on every table | Only the needed SELECT/DELETE and column UPDATE | Fixed and verified |
| N-2 Default privileges | New functions and tables auto-exposed to anon | Revoked; explicit grants required | Fixed and verified |
| N-3 Profile enumeration | Anyone could list all public profiles with UUIDs | Owner-only table; RPCs for public data | Fixed and verified |
| N-4 Forged imports in public stats | Imported tests counted in public best WPM | Verified tests only | Fixed and verified |
| N-5 Backdated streaks | Streak days from client `created_at` | Server `submitted_at`, verified tests | Fixed and verified |
| N-6 Sign-up enumeration | API and UI revealed registered emails | UI masked. Upstream API still reveals confirmed emails | Mitigated with residual risk |
| N-7 Offline queue stall | One test per sync, repeated re-submits | Per-item progress, sane limit, back-off | Fixed and verified |
| N-8 Username race | Sign-up failed with a 500 | Fallback username | Fixed and verified |
| N-9 Client leaderboard dates | Client timestamp shown | Server time | Fixed and verified |
| N-10 Mixed-difficulty boards | Easy, punctuation and number tests ranked together | Standard configuration only, labelled | Fixed and verified |
| N-11 Weak local auth config | 6-character passwords, no confirmations, 1 h links | 10+ characters with classes, confirmations, 15 min links, secure password change | Fixed (local); hosted settings in checklist |
| N-12 Raw auth errors, no password max length | Messages could vary by account state | Generic messages, max 72 | Fixed and verified |
| N-13 Tokens in localStorage | No CSP | Strict CSP; no HTML sinks | Mitigated with residual risk |

## Second review (Phase 7)

A separate reviewer, given only the diff and the risk areas, audited the finished change set. It confirmed:
- The `SECURITY DEFINER` functions and final grant block are correct.
- RLS and the friendship logic are correct.
- Challenge single use works.
- `ft_replay` matches `src/engine/core.ts` (chars, space, backspace, word-delete, MAX_EXTRA, step-back rule, time-limit cut-off, words completion).
- The client sync guards and CI hygiene are sound.

It reported the following; each was verified against the code before acting:

| Finding | Severity | Action | Test |
|---|---|---|---|
| Unbounded keylog timestamp made the idle check O(seconds × keys); exceptions after the replay rolled back rate-limit counters | High | Timestamps capped at 1 h; idle counted in O(keys); every later cast validated before the replay; keylog capped at 8,000 events. Worst case measured at 184 ms (was unbounded) | pgTAP: timestamp over 1 h rejected; bad `daily_date` and unknown lesson fail validation |
| Deletion accepted any fresh session, including a recovery/OTP session | Medium | Only a password sign-in in the last 10 min counts | pgTAP: OTP session refused |
| Abandoned challenges never purged | Medium | Opportunistic global purge (500 rows per issue) + expiry index | Covered by existing challenge tests |
| `ft_award` rescanned every test on each submit | Medium/Low | Submit path upserts only the new test's XP; sync limit lowered to 10/min | Existing progression tests |
| Personal-best XP farmable in 0.01 WPM steps | Low | Requires at least +1 WPM | Existing PR test |
| gitleaks image pinned by tag | Low | Pinned by digest in CI | actionlint |
| "Sign out and remove data" could lose queued tests | Low | Not applicable: the button was already disabled while uploads are pending | — |
| CSP `style-src 'self'` might break inline styles | Low | Not applicable: React applies styles through CSSOM. The e2e suite shows zero CSP violations on 7 pages | e2e headers test |
| Scripted clients can still rank | Inherent | Documented residual (FT-01) | — |

Every suite was re-run after these fixes ([results](SECURITY-TEST-RESULTS.md#final-results)).

## GitHub delivery

- Branch `security/frogtype-complete-hardening`, one pull request to `main`, **not merged**: the owner reviews and approves.
- Pull request: https://github.com/abbas-4/FrogType/pull/1
- Applied to `main` with the owner's authorization (2026-11-23, confirmed via the GitHub API):
  - Required status checks, with the branch up to date: `Lint, types, unit, build, audit, e2e`, `Database, integration and online e2e (local Supabase)`, `Secret scan (gitleaks, full history)`, `Analyze (javascript-typescript)`, `review`.
  - A pull request is required, with 0 approvals (solo maintainer) and stale reviews dismissed.
  - Force pushes and deletion are blocked; conversation resolution is required.
  - Admin enforcement is off, so the owner can still override in an emergency. Turn it on once CI is proven stable.
- Also enabled: Dependabot alerts, Dependabot security updates, private vulnerability reporting. Secret scanning and push protection were already on.
- Still manual: Actions workflow permissions "read" (Settings → Actions → General) and, when collaborators join, 1 required approval ([checklist §3](SECURITY-CHECKLIST.md#3-github-repository)).
