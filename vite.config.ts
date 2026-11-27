import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'https://frogtype.me/';
const HOME_TITLE = 'FrogType – Free Online Typing Test &amp; Practice';
const HOME_DESCRIPTION =
  'Practice typing, improve your WPM and accuracy, compete in daily typing challenges, and track your progress for free with FrogType.';

/** Public pages Google should index on their own (also listed in public/sitemap.xml). */
const SEO_PAGES = [
  {
    path: 'lessons',
    title: 'Typing Lessons – FrogType',
    description:
      'Free typing lessons from the home row to speed training. Learn finger placement, build accuracy and take the daily typing challenge on FrogType.',
  },
  {
    path: 'leaderboards',
    title: 'Typing Leaderboards – FrogType',
    description: 'See the fastest typists on FrogType’s timed typing test leaderboards and compare your WPM with friends.',
  },
];

/**
 * The SPA serves one index.html everywhere, so every route would claim the homepage's title and canonical.
 * Write <page>/index.html copies with their own head tags; Vercel serves them before the catch-all rewrite.
 */
function seoPages(): Plugin {
  return {
    name: 'frogtype-seo-pages',
    apply: 'build',
    writeBundle({ dir = 'dist' }) {
      const html = readFileSync(join(dir, 'index.html'), 'utf8');
      for (const page of SEO_PAGES) {
        const url = `${SITE}${page.path}`;
        const swaps: [string, string][] = [
          [HOME_TITLE, page.title],
          [HOME_DESCRIPTION, page.description],
          [`href="${SITE}"`, `href="${url}"`],
          [`property="og:url" content="${SITE}"`, `property="og:url" content="${url}"`],
        ];
        let out = html;
        for (const [from, to] of swaps) {
          // Fail the build rather than ship a page that still claims to be the homepage.
          if (!out.includes(from)) throw new Error(`frogtype-seo-pages: "${from}" not found in index.html`);
          out = out.replaceAll(from, to);
        }
        mkdirSync(join(dir, page.path), { recursive: true });
        writeFileSync(join(dir, page.path, 'index.html'), out);
      }
    },
  };
}

/** FT-09: one policy for the built page (meta tag, works on any host) and for `vite preview` (real headers, used by e2e). */
function securityPolicy(supabaseUrl: string | undefined) {
  let origin = '';
  try {
    origin = supabaseUrl ? new URL(supabaseUrl).origin : '';
  } catch {
    /* invalid URL: the app refuses it at runtime too */
  }
  const connect = ["'self'", origin, origin.replace(/^http/, 'ws')].filter(Boolean).join(' ');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ];
  return {
    // frame-ancestors is ignored in <meta>; it must come from a response header (see docs/security/SECURITY-CHECKLIST.md)
    meta: csp.join('; '),
    headers: {
      'Content-Security-Policy': [...csp, "frame-ancestors 'none'"].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const policy = securityPolicy(env.VITE_SUPABASE_URL);
  const cspMeta: Plugin = {
    name: 'frogtype-csp-meta',
    apply: 'build', // dev server needs inline HMR scripts
    transformIndexHtml: (html) =>
      html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy.meta}" />`),
  };
  return {
    plugins: [react(), tailwindcss(), cspMeta, seoPages()],
    preview: { headers: policy.headers },
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.{ts,tsx}'],
      // Unit tests run offline even when a developer's .env.local points at a real project.
      env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    },
  };
});
