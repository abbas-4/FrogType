import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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
    plugins: [react(), tailwindcss(), cspMeta],
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
