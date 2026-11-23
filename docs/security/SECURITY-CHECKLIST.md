# FrogType security checklist

Settings that code cannot enforce. Do these before a public launch, and re-check them on every release. Local values live in `supabase/config.toml`. Hosted projects are configured in the Supabase dashboard (or with `supabase config push` after reviewing the diff).

## 1. Supabase project (production)

### Database

- [ ] Apply migrations in order with `supabase db push`: `20261122000000_init.sql`, `20261123000000_security_hardening.sql`, then `20261124000000_account_profiles.sql`. Never edit an applied migration; add a new one.
- [ ] **Take a backup before applying the hardening migration to a populated database.** It is non-destructive. Existing XP, achievements and leaderboard rows are kept, marked unverified, and hidden from public views. Existing profiles keep their visibility. The backfill runs `ft_award` once per profile in one transaction, so check row counts first on a large database.
- [ ] After applying, run these read-only checks in the SQL editor. Expected results: zero rows, `{get_leaderboard,get_public_profile,username_available}`, zero rows.
  ```sql
  -- every public function pins search_path
  select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where nspname = 'public' and prokind = 'f' and not coalesce('search_path=""' = any(proconfig), false);
  -- anon can only execute the two public read RPCs
  select array_agg(proname order by proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  -- no table without RLS
  select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where nspname = 'public' and relkind = 'r' and not relrowsecurity;
  ```
- [ ] Don't create tables or functions in `public` from the dashboard without a migration. Default privileges no longer auto-grant client access, so new objects stay private until granted on purpose.
- [ ] Enable Point-in-Time Recovery or daily backups. Document how long backups keep deleted users' data (the deletion dialog mentions this).
- [ ] Optional: under **Database → Network restrictions**, limit direct Postgres access. The app only uses the HTTPS API.

### Authentication

| Setting | Value | Why |
|---|---|---|
| Email confirmations | **On** | Blocks sign-ups with other people's emails |
| Minimum password length | **8** | Matches the UI (`passwordProblem`) |
| Password requirements | **Lowercase, uppercase letters and digits** | Matches the UI |
| Leaked-password protection | **On** (Pro plan) | Rejects known-breached passwords |
| Secure password change | **On** | Changing a password requires a recent sign-in |
| Email OTP / link expiry | **900 s** | Recovery links expire after 15 min |
| Site URL | `https://<your-domain>` | |
| Redirect URLs | `https://<your-domain>/reset-password`, `https://<your-domain>/profile` and `https://<your-domain>/settings` only | Exact URLs, no wildcards: prevents open redirects of auth codes. `/settings` receives email-change links |
| Secure email change | **On** | Both the old and new address must confirm an email change |
| Auth rate limits | Emails ≤ 4/hour; sign-ups and sign-ins ≤ 30 per 5 min per IP; token verifications ≤ 30 per 5 min | Brute-force and email-bombing protection. `email_sent = 30` in `config.toml` is for the local test stack only |
| CAPTCHA (hCaptcha or Turnstile) | **On** for sign-up, sign-in and reset | Slows bots and the upstream sign-up enumeration (audit N-6). Needs a small client change to pass `captchaToken` |
| Custom SMTP | A real provider with SPF, DKIM and DMARC | The built-in mailer is not for production |
| JWT expiry | 3600 s (default) | Short-lived access tokens; rotating refresh tokens |
| MFA (TOTP) | Optional | At least for the project owner's account |

- [ ] Complete a real password reset on the production domain with a test account, then try an expired link after 15 min.
- [ ] Work through the live verification list in [ACCOUNTS-SETUP.md § 6](../ACCOUNTS-SETUP.md#6-verify-on-the-live-site-with-a-test-inbox-you-control) (sign-up confirmation, resend, email change, password change, privacy, export, deletion).

### API keys

- [ ] Only the **anon / publishable** key goes in `VITE_SUPABASE_ANON_KEY`. The app refuses `service_role` and `sb_secret_` keys, and CI fails if one reaches `dist/`.
- [ ] Keep service-role and secret keys out of the repo, the static host's environment and CI. FrogType never needs them in production.
- [ ] Under **Data API**, expose only `public` (the default).

## 2. Hosting and HTTP headers

No host was configured at audit time. The production build already contains a strict CSP `<meta>` tag. The host **must** add these headers, because `frame-ancestors`, HSTS and `nosniff` can't be set from HTML:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
```

Browsers enforce both the header CSP and the meta CSP. Commit the config for the host you choose:

**Netlify / Cloudflare Pages** (`public/_headers`, plus `public/_redirects` containing `/* /index.html 200` for SPA routes such as `/reset-password`):
```
/*
  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
  Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin
```

**Vercel** (`vercel.json`):
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [{ "source": "/(.*)", "headers": [
    { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
    { "key": "Content-Security-Policy", "value": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
    { "key": "X-Content-Type-Options", "value": "nosniff" },
    { "key": "X-Frame-Options", "value": "DENY" },
    { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
    { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }
  ]}]
}
```

Verify after every deploy:
```bash
curl -sI https://<your-domain>/ | grep -iE 'strict-transport|content-security|x-content-type|x-frame|referrer-policy|permissions-policy'
```
- [ ] `http://` redirects to `https://` (301/308).
- [ ] DevTools shows no CSP violations on Test, Stats, Leaderboards, Profile (signed in) and Settings.
- [ ] Build with the production `VITE_SUPABASE_URL` set, so the meta CSP's `connect-src` names your project.

## 3. GitHub repository

On `main` (**Settings → Rules → Rulesets**):
- [ ] Require a pull request before merging. Solo maintainer: 0 approvals. With collaborators: 1, and dismiss stale approvals.
- [ ] Require these status checks, with the branch up to date:
  - `Lint, types, unit, build, audit, e2e`
  - `Database, integration and online e2e (local Supabase)`
  - `Secret scan (gitleaks, full history)`
  - `Analyze (javascript-typescript)`
  - `review`
- [ ] Block force pushes and deletion. Require conversation resolution.

**Settings → Code security:**
- [ ] Dependabot alerts and security updates **on**.
- [ ] Secret scanning and push protection **on**.
- [ ] Private vulnerability reporting **on**.

**Settings → Actions → General:**
- [ ] Workflow permissions: **read repository contents**. Don't allow Actions to approve PRs.

## 4. Secrets

- [ ] Only `.env.example` is committed; `.env*` and `*.local` are gitignored.
- [ ] If a privileged key ever leaks: rotate it in Supabase first, then purge it from history, then review the logs.
- [ ] Production `VITE_*` values live in the host's build settings.
- [ ] The CI stack keys are Supabase's fixed public demo values for an ephemeral container, not secrets.

## 5. Release checklist

1. All CI jobs are green. Every suppressed finding has a written reason in the PR.
2. New SQL is a new migration. Every function has `SET search_path = ''`, `REVOKE` plus a minimal `GRANT`, and a pgTAP test proving `anon` can't run it unless intended. New tables have RLS, policies, and a cross-user pgTAP test.
3. Changes to sync, auth or storage keep `tests/sync-isolation.test.ts` and `e2e-online` passing.
4. Staging: back up, run migrations, run the SQL checks above, then smoke-test sign-up, reset, ranked test, export and deletion with a synthetic account.
5. Production: deploy, check headers with `curl`, watch Supabase logs for errors and rate-limit spikes for 24 h.

## 6. Ongoing maintenance

- **Weekly:** merge Dependabot PRs after CI passes; review CodeQL and secret-scanning alerts.
- **Monthly:** review leaderboard outliers and add a moderation path (FT-01 residual); review rate-limit hits; consider scheduled deletion of expired `test_challenges` (pg_cron) if the opportunistic purge isn't enough.
- **Quarterly:** re-run this checklist; review auth settings and redirect URLs; rotate shared credentials.
- **On a Supabase/GoTrue upgrade:** re-run `npm run test:integration`. If the sign-up enumeration canary fails, update audit item N-6.
- Before any larger launch: get an external review or penetration test.
