# FrogType

**Type faster. Get better.**

FrogType is a minimalist typing trainer: a fast, distraction-free typing test, plus personalized lessons, progress tracking, achievements, daily challenges and optional online features (accounts, sync, leaderboards and friends).

Everything core works offline in the browser. Online features turn on when you connect a Supabase project.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Requires Node 20+ (developed on Node 24).

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript only |
| `npm test` | Vitest unit + component tests |
| `npm run test:e2e` | Playwright end-to-end tests (builds and serves on :4173). Run `npx playwright install chromium` once first |
| `npm run test:db` | pgTAP database tests (RLS, grants, abuse cases) against the local Supabase stack |
| `npm run test:integration` | HTTP attack tests with real GoTrue users against the local stack |
| `npm run test:e2e:online` | Playwright journeys against the local stack (accounts, sync isolation, ranked test, recovery, deletion) |
| `npm run check:secrets` | Fails if a privileged key ends up in `dist/` |

## Features

- **Typing test.** Time mode (15/30/60/120 s or custom, 5–600 s), words mode (10/25/50/100 or custom, 5–500), punctuation, numbers, difficulty (easy/normal/hard), English/Spanish/German word lists. Live WPM and accuracy, a smooth caret, three-line scrolling, Tab to restart, Ctrl/Alt+Backspace to delete a word.
- **Accurate metrics.** WPM counts the characters of correctly typed words plus their spaces (÷5 per minute). Raw counts every typed character. Accuracy is keystroke-based (corrected mistakes still count). Consistency is derived from the per-second raw WPM's coefficient of variation.
- **Reliable timing.** `performance.now()`. The timer starts on the first keystroke, and time mode ends exactly at the limit even when the browser throttles timers. Hiding the tab mid-test resets the test instead of recording a misleading result. Tests that are too short, implausibly fast (>300 WPM), below 50% accuracy, mismatched with the timer, or mostly idle are marked invalid and never saved.
- **Results.** WPM, raw, accuracy, consistency, correct/incorrect/extra/missed characters, duration, mode, a WPM-over-time chart with error markers, XP earned, personal bests and achievements.
- **Statistics.** Averages, bests, totals, streaks and improvement, with WPM, accuracy, daily activity, weekly, monthly and consistency charts. Filter by 7/30/90 days or all time. Every past test can be reopened.
- **Progression.** Keyed XP ledger (never double-awarded) for tests, lessons, daily challenges, streaks and personal bests. Levels and 13 achievements.
- **Lessons.** 23 lessons across 10 categories. Recommendations come from your real per-key error rates, problem letter pairs, and speed-vs-accuracy pattern, and only appear after at least 3 tests and 500 characters.
- **Practice.** Daily challenge (the same passage for everyone on a UTC date), custom passages (saved locally), and a weak-key drill.
- **Settings.** Three themes, font family and size, caret style, sound, default mode, duration and word count, punctuation, numbers, difficulty, language, reduced motion, live WPM, and privacy. All persist.
- **Accessibility.** Keyboard-first, visible focus rings, skip link, ARIA labels, live regions, `prefers-reduced-motion` plus a manual override, responsive down to phone width.

## Enabling online features (Supabase)

Without configuration, Profile and Leaderboards say plainly that online features are off. No fake data is ever shown.

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the schema, using either of these:
   - Supabase CLI: `supabase init` (keeps the existing `supabase/migrations`), `supabase link --project-ref <ref>`, then `supabase db push`.
   - Dashboard: run every file in `supabase/migrations/` in order in the SQL editor.
3. Under **Authentication → Providers**, make sure Email is enabled. Under **URL Configuration**, set your site URL and add exactly `<site>/profile`, `<site>/reset-password` and `<site>/settings` as redirect URLs. Apply the auth settings in [the security checklist](docs/security/SECURITY-CHECKLIST.md#authentication) (confirmations, password policy, rate limits, SMTP). For a public launch, follow [docs/ACCOUNTS-SETUP.md](docs/ACCOUNTS-SETUP.md) step by step (SMTP and DNS, CAPTCHA, SPA routing, live verification).
4. Copy `.env.example` to `.env.local` and fill in your values:
   ```bash
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<public anon key>
   ```
   Only use the **public anon key**. Never put the service-role key in any `VITE_` variable: everything prefixed `VITE_` ships to the browser.
5. Restart `npm run dev`.

### What turns on

- Accounts (optional; guests keep everything working locally): `/signup` with live validation, username availability, password rules, show/hide password and an email-confirmation screen with rate-limited resend; `/signin` with "Keep me signed in" (off = this tab only), unconfirmed-email recovery and password reset; a header account menu (Profile, Settings, Sign out); a notice when a session expires.
- Profiles: username, built-in avatar, short bio, join date, level/XP, stats, earned achievements and recent activity. New accounts start with a public profile and a leaderboard listing; either can be turned off in Settings → Privacy.
- Account settings (`/settings`): profile information, email change (both addresses confirm), password change (current password required; other devices signed out), privacy, data export, permanent deletion, sign out, and sign out + remove this browser's data.
- **Safe migration.** On first sign-in, if this browser has tests that aren't in the account, FrogType *asks* before uploading. Uploading merges: tests are unioned by id, XP by key, and lesson bests take the max. Cloud data is never overwritten. Imported tests are stored but never ranked.
- Automatic sync of new tests. When offline or on errors, results stay queued locally and retry when the connection returns.
- Global and friends leaderboards (time 15/30/60/120 and words 10/25/50/100, English).
- Friend requests by username, public profiles (`/u/<username>`), and privacy toggles for profile visibility and leaderboard presence.

### Database design

`supabase/migrations/20261122000000_init.sql` creates: `profiles`, `typing_tests`, `leaderboard_entries`, `lessons`, `lesson_progress`, `achievements`, `user_achievements`, `xp_transactions`, `daily_challenges`, `challenge_submissions` and `friendships`.

- **RLS on every table.** Users can read only their own private rows. Profiles are readable when public.
- **No client writes to stats tables.** There are no INSERT/UPDATE policies on tests, XP, achievements, lesson progress, leaderboard or challenge tables. All writes go through `SECURITY DEFINER` functions:
  - `submit_test`: validates every field, checks that WPM is backed by the reported characters and that time-mode duration matches, rate-limits (1 per 2 s, 1000/day), is idempotent by id, and ranks only fresh, standard-mode English results.
  - `import_tests`: one-time migration, at most 200 per call and 3000 per hour, stored unranked.
  - `issue_challenge` + `submit_test`: ranked tests are typed on a single-use passage issued by the server; the server replays the keystroke log and recomputes every metric before ranking.
  - `sync_progress` (and the legacy `merge_progress`): XP and achievements are derived from server records only; client claims are ignored.
  - `get_leaderboard`, `get_public_profile`, `list_friends`, `send_friend_request`, `respond_friend_request`.
- **Server-side daily targets.** The server computes daily challenge targets itself (`ft_daily_targets`, a port of the client's FNV-1a formula, checked for parity by tests). Completion is decided server-side.
- **Locked-down execute rights.** `EXECUTE` is revoked from `PUBLIC` and granted per function. Profile updates are restricted by column (`username`, `is_public`, `show_on_leaderboard`, `avatar`, `bio`).
- **Profiles (`20261124000000_account_profiles.sql`).** `avatar` must be one of the built-in keys and `bio` is one line of at most 160 characters (both CHECK constraints). A trigger trims the bio and limits username changes to 5 a day. `username_available` (rate-limited, also for anonymous sign-up forms) powers the live availability check. `get_public_profile` returns avatar and bio only for public profiles.

## Testing

Unit tests run anywhere. Everything else needs the isolated local stack: `npx supabase start` (Docker; ports 553xx, see `supabase/config.toml`).

- `npm test`: Vitest. Engine, metrics, progression, storage validation (fuzzed), per-account isolation and sync races, config guards, auth helpers, components.
- `npm run test:e2e`: Playwright against the production build without Supabase, served with the production security headers.
- `npm run test:db`: pgTAP (`supabase/tests/*.sql`). RLS, grants, `search_path`, challenge/replay abuse, forged progression, rate limits, friends, privacy, deletion.
- `npm run test:integration`: real HTTP attacks with synthetic GoTrue users, including concurrency, recovery links via mailpit, export and deletion.
- `npm run test:e2e:online`: browser journeys against the local stack.

Full results and the security audit are in [docs/security](docs/security/).

## Project structure

```
src/
  engine/       typing engine: pure reducer (core.ts), metrics, word generation, seeded RNG
  domain/       progression, achievements, streaks, lessons, analysis, daily challenge, stats
  hooks/        useTypingTest (timer, sampling, word supply)
  state/        tiny external stores: settings/progress (localStorage), auth, toasts
  persistence/  validated localStorage load/save
  services/     Supabase client, cloud sync, social (leaderboards/friends/auth), sound
  components/   TypingTest, Word, ResultsView, charts, layout, UI primitives
  pages/        route pages (lazy-loaded except the test)
  data/         word lists
tests/          Vitest
e2e/            Playwright
supabase/       migrations + pgTAP tests
```

## Security notes and known limitations

See [docs/security/SECURITY-AUDIT.md](docs/security/SECURITY-AUDIT.md) for the full audit and [SECURITY-CHECKLIST.md](docs/security/SECURITY-CHECKLIST.md) for the production settings you must configure. Short version:

- **Leaderboards rank only server-verified results.** The passage comes from the server and the server re-scores the keystroke log, so edited scores and replays don't rank. A bot or modified client that types the real passage with human-like timing still can; rankings are not proof of human typing.
- **Lesson and daily-challenge rewards** are recorded server-side but marked unverified, because those passages are generated in the browser. Public profiles show verified XP and achievements only.
- **Visibility is the user's choice.** New accounts start public and on leaderboards; Settings → Privacy turns either off immediately, enforced by the database, not just the UI.
- **Each account has its own local storage** in the browser. Guest progress moves into an account only if you accept. Use **Sign out and remove my data from this browser** on shared machines.
- Local data is not encrypted, and tampered local data only affects local stats.
- The daily challenge uses the device clock's UTC date.
- Some Android keyboards don't send reliable key events.

## Recommended improvements

1. Moderation tools for leaderboard outliers (store flagged keylogs for review).
2. Store the daily passage centrally (or version word lists) so old challenges stay reproducible after word-list changes.
3. More languages and larger word lists; quote mode.
4. Heatmap keyboard visualization of per-key error rates.
5. PWA/offline install and background sync.
6. CAPTCHA on sign-up and reset (see the security checklist).
