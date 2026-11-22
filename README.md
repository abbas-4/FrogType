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
| `npm run test:db` | pgTAP database tests via the Supabase CLI |

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
   - Dashboard: paste `supabase/migrations/20261122000000_init.sql` into the SQL editor and run it.
3. Under **Authentication → Providers**, make sure Email is enabled. Under **URL Configuration**, add your site URL (e.g. `http://localhost:5173`) for confirmation and reset links.
4. Copy `.env.example` to `.env.local` and fill in your values:
   ```bash
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<public anon key>
   ```
   Only use the **public anon key**. Never put the service-role key in any `VITE_` variable: everything prefixed `VITE_` ships to the browser.
5. Restart `npm run dev`.

### What turns on

- Email/password sign-up, sign-in and password reset.
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
  - `merge_progress`: only accepts XP keys that reference the user's real tests, real lessons or valid dates, with per-type caps, plus known achievement ids and clamped lesson stats.
  - `get_leaderboard`, `get_public_profile`, `list_friends`, `send_friend_request`, `respond_friend_request`.
- **Server-side daily targets.** The server computes daily challenge targets itself (`ft_daily_targets`, a port of the client's FNV-1a formula, checked for parity by tests). Completion is decided server-side.
- **Locked-down execute rights.** `EXECUTE` is revoked from `PUBLIC` and granted per function. Profile updates are restricted by column (`username`, `is_public`, `show_on_leaderboard`).

## Testing

- `npm test` runs 56 Vitest tests: WPM, accuracy and consistency math, the engine (timer start, exact time-mode completion, late ticks, post-limit keystrokes, backspace rules, words-mode completion, restart, validity), XP, levels, dedupe, achievements, streaks, lessons, daily-challenge determinism, settings/progress persistence and tamper resistance, analysis thresholds, local/cloud merge, behavior when unconfigured or signed out, and React component tests (highlighting, completion, Tab restart, no HTML injection).
- `npm run test:e2e` runs 8 Playwright journeys: landing test and caret position, words-mode completion persisted to stats, automatic time-mode completion, Tab restart, settings persistence, passing a lesson, honest "not configured" states, and keyboard navigation.
- `supabase/tests/database.test.sql` has 24 pgTAP checks: signup trigger, RLS isolation between users, blocked direct writes, column-level profile protection, validation and rate-limit rejections, XP/achievement filtering, friend flow, leaderboard, and daily-target parity. Run them with `supabase test db`, or against the Supabase Postgres image:
  ```bash
  docker run -d --rm --name ft-pg -e POSTGRES_PASSWORD=postgres public.ecr.aws/supabase/postgres:17.11.0.006
  docker exec -i ft-pg psql -U postgres -h localhost -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/20261122000000_init.sql
  docker exec -i ft-pg psql -U supabase_admin -h localhost -d postgres < supabase/tests/database.test.sql
  docker stop ft-pg
  ```

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

- **Leaderboard results are unverified.** Results are computed in the browser. The server rejects malformed, implausible, inconsistent and rate-limited submissions, but a determined user can still forge a plausible result. The UI labels leaderboards as unverified. Real verification would need server-side keystroke replay; see the improvements below.
- **Achievements and lesson completion synced from the client are trusted** once they pass basic checks. XP is limited to keys tied to real server data, but streak and daily keys are only date-checked.
- **Local data is not encrypted.** Anyone with access to the browser profile can read or edit it. Tampered local data is sanitized on load but can still inflate *local* stats.
- After signing out, synced history stays in this browser's local storage. Use **Settings → Clear local data** on shared machines.
- The daily challenge uses the device clock's UTC date. A wrong clock shows a different day's passage, and the server only accepts today's or yesterday's challenge.
- Some Android keyboards don't send reliable key events. Input falls back to the `input` event, and backspace may not register on those keyboards.
- Before deploying: enable Supabase email confirmation, set allowed redirect URLs, consider CAPTCHA on sign-up (Supabase Auth setting), and keep Supabase's own API rate limits on.

## Recommended improvements

1. Server-side verification: send keystroke timing logs and replay them in an Edge Function before ranking.
2. Store the daily passage centrally (or version word lists) so old challenges stay reproducible after word-list changes.
3. More languages and larger word lists; quote mode.
4. Heatmap keyboard visualization of per-key error rates.
5. PWA/offline install and background sync.
6. Account deletion and data export flows in the UI (the database already cascades deletes).
