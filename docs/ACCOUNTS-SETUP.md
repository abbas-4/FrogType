# Enabling real accounts on a public FrogType site

FrogType's account system (sign-up, email confirmation, sign-in, password reset, profiles, sync) needs a **hosted Supabase project**, a **real email sender** and a **static host** with SPA routing. None of these exist for this repository yet (no deployment, no hosted project). Everything below is a manual step for the site owner. Nothing in this document has been tested against a production deployment.

Replace `<domain>` with your public origin, for example `frogtype.example.com`, and `<ref>` with your Supabase project ref. Every redirect URL must match **exactly**: origin, path, and no trailing slash.

## 1. Supabase project

1. Create a project at <https://supabase.com/dashboard> in a region near your users. Save the database password in a password manager. FrogType never needs it at runtime.
2. Apply the migrations in order. Never edit an applied migration.
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push        # applies 20261122000000_init, 20261123000000_security_hardening, 20261124000000_account_profiles
   ```
   **Back up a populated database before pushing** (Database → Backups). `20261124000000_account_profiles.sql` is additive: two nullable columns, a trigger, one RPC and an internal table.
3. Run the read-only checks from [SECURITY-CHECKLIST.md § Database](security/SECURITY-CHECKLIST.md#database) in the SQL editor. `anon` must be able to execute exactly `get_leaderboard`, `get_public_profile` and `username_available`.

## 2. Authentication settings (Dashboard → Authentication)

| Where | Setting | Value |
|---|---|---|
| Sign In / Providers → Email | Enable email provider | On |
| | Confirm email | **On** |
| | Secure email change | **On** (both the old and the new address must confirm) |
| | Secure password change | On |
| | Minimum password length | 10 |
| | Password requirements | Lowercase, uppercase letters and digits |
| | Leaked password protection | On (Pro plan) |
| | Email OTP expiration | 900 seconds |
| URL Configuration | Site URL | `https://<domain>` |
| | Redirect URLs | `https://<domain>/profile`, `https://<domain>/reset-password`, `https://<domain>/settings` (these three only) |
| Rate Limits | Emails sent per hour | 4 to 30, depending on your SMTP plan |
| | Sign-ups and sign-ins per 5 min per IP | 30 |
| | Token verifications per 5 min per IP | 30 |
| Sessions | Refresh token rotation | On (default), reuse interval 10 s |

What each redirect URL is for:

- `/profile`: sign-up confirmation links (`signUp` and `resend` use `emailRedirectTo: <origin>/profile`).
- `/reset-password`: password-recovery links.
- `/settings`: email-change links (both halves of a secure email change).

The app builds these from `window.location.origin`, so the site must be served from the same origin you allow-list. If you also serve `www.<domain>`, either redirect it to the apex with a 301 (recommended) or add the `www` URLs as well.

## 3. Email delivery (custom SMTP)

Supabase's built-in mailer only sends to project team members and is heavily rate-limited, so **real users will not receive confirmation emails until custom SMTP is configured**.

1. Pick a transactional provider (for example Resend, Postmark, Amazon SES, Mailgun or SendGrid) and verify a sending domain such as `mail.<domain>`.
2. Add the DNS records the provider gives you, at your DNS host:
   - **SPF**: a `TXT` record on the sending domain that includes the provider (for example `v=spf1 include:<provider-spf> ~all`). Use only one SPF record per name.
   - **DKIM**: the `CNAME` or `TXT` records the provider lists.
   - **DMARC**: `TXT` at `_dmarc.<domain>`. Start with `v=DMARC1; p=none; rua=mailto:dmarc@<domain>`, then move to `p=quarantine` once reports look clean.
   - The return-path / bounce `CNAME`, if the provider uses one.
3. Dashboard → Authentication → **Emails → SMTP Settings**: enable custom SMTP and enter the host, port (587 with STARTTLS), username, password (an API key from the provider; it stays in Supabase, never in this repo or any `VITE_` variable), sender email (`no-reply@mail.<domain>`) and sender name (`FrogType`).
4. Dashboard → Authentication → **Emails → Templates**: keep `{{ .ConfirmationURL }}` in the *Confirm signup*, *Reset password* and *Change email address* templates. Optionally rename the confirm button text to "Confirm your email" to match the app's instructions.
5. Raise **Rate Limits → Emails sent per hour** to what your provider allows.

## 4. CAPTCHA (recommended before launch)

GoTrue reveals already-registered emails on its raw sign-up API (audit item N-6), and sign-up and reset endpoints are bot targets. CAPTCHA mitigates both. It is **not enabled yet** because it needs a site key and a client change.

1. Create a Cloudflare Turnstile widget (or an hCaptcha site) for `<domain>`. You get a site key (public) and a secret key (private).
2. Dashboard → Authentication → **Attack Protection → Enable CAPTCHA protection**: choose the provider and paste the **secret** key there only.
3. Client change still to be made: render the widget on `/signup`, `/signin` and `/reset-password`, and pass `options: { captchaToken }` to `signUp`, `signInWithPassword`, `resetPasswordForEmail` and `resend` in `src/services/social.ts`. Put the **site** key in `VITE_TURNSTILE_SITE_KEY` (public by design).
4. Extend the CSP in `vite.config.ts`: Turnstile needs `script-src https://challenges.cloudflare.com` and `frame-src https://challenges.cloudflare.com`. hCaptcha needs `https://hcaptcha.com https://*.hcaptcha.com` in `script-src`, `frame-src`, `style-src` and `connect-src`.

**Turning CAPTCHA on in the dashboard before the client change ships will break sign-up, sign-in and reset.**

## 5. Build and host

1. Build with the production values (public anon or publishable key only):
   ```bash
   VITE_SUPABASE_URL=https://<ref>.supabase.co VITE_SUPABASE_ANON_KEY=<public anon key> npm run build
   npm run check:secrets   # fails if a service-role or secret key reached dist/
   ```
   The build embeds the Supabase origin in the CSP meta tag (`connect-src`), so rebuild whenever the project URL changes.
2. Serve `dist/` from the site root (`/`). The app assumes it is not under a sub-path such as GitHub Pages' `/<repo>/`.
3. **SPA fallback is required.** Email links open `/profile`, `/reset-password` and `/settings` directly, so every unknown path must serve `index.html` with status 200:
   - Netlify / Cloudflare Pages: `public/_redirects` containing `/* /index.html 200`.
   - Vercel: `"rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]` in `vercel.json`.
   - nginx: `try_files $uri /index.html;`.
4. Add the security headers from [SECURITY-CHECKLIST.md § 2](security/SECURITY-CHECKLIST.md#2-hosting-and-http-headers) and force HTTPS. Sessions live in browser storage, not cookies, so the strict CSP is the main defence against token theft.
5. DNS: point `<domain>` at the host (an `A`/`AAAA` or `CNAME` record as the host instructs), enable the host's TLS certificate, and add a 301 from `http://` and from `www` if you use the apex.

## 6. Verify on the live site (with a test inbox you control)

Do each step and record the result. Don't announce sign-ups until all of them pass.

1. `curl -sI https://<domain>/settings` returns 200 with the security headers. Repeat for `/profile`, `/reset-password`, `/signin` and `/signup`.
2. Create an account at `/signup`. The confirmation screen appears and the email arrives within a minute, from your domain, passing SPF/DKIM/DMARC (check the message headers).
3. Open the link in the same browser: it lands on `/profile` signed in with "Your email address is confirmed". Open a second confirmation link in a different browser: it says the email is confirmed and asks you to sign in.
4. Choose "Resend confirmation email" on an unconfirmed account: the button cools down, and the server refuses rapid repeats.
5. Sign out, then "Forgot password?": the link lands on `/reset-password`, the password changes, and reusing the link fails.
6. In Settings, change your email: both inboxes get a link, and the address changes only after both are opened.
7. Change your password in Settings, then sign in on another device with the old password: it fails.
8. Toggle the public profile on and off. `/u/<username>` in a private window shows the profile only while it's public.
9. Export your data, then delete the test account. Confirm in Dashboard → Authentication → Users that it's gone.
10. Watch Dashboard → Logs (Auth and Postgres) for 24 hours after launch for errors and rate-limit spikes.

## Known limits

- Username availability is visible to anyone, capped at 300 anonymous checks per minute across all visitors plus 60 per minute per signed-in user. Usernames aren't secret, but this does let someone confirm that a private account's username exists.
- Accounts that sign up but never confirm still reserve their username. Remove stale ones periodically, for example `auth.users` where `email_confirmed_at is null and created_at < now() - interval '7 days'`, using the dashboard or a scheduled job with the service role, never from the client.
- "Keep me signed in" unchecked stores the session in `sessionStorage`. It ends when the tab closes, but it doesn't protect against malware or XSS on the device.
