// vercel.json is the only thing between the deployed build and Vercel's defaults: without the rewrite every
// client-side route (/signup, /profile, /reset-password, email links) is a Vercel 404 on direct load, and without the
// headers the site can be framed (frame-ancestors cannot be set from the CSP <meta> tag).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync(resolve(__dirname, '../vercel.json'), 'utf8')) as {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

describe('vercel.json', () => {
  it('serves index.html for every client-side route', () => {
    expect(config.rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' });
  });

  it('serves the build-time SEO pages (vite.config.ts seoPages) before the catch-all', () => {
    const order = config.rewrites.map((r) => r.destination);
    for (const page of ['/lessons/index.html', '/leaderboards/index.html']) {
      expect(order.indexOf(page)).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(page)).toBeLessThan(order.indexOf('/index.html'));
    }
  });

  it('sends the security headers from SECURITY-CHECKLIST.md § 2 on every path', () => {
    const all = config.headers.find((h) => h.source === '/(.*)');
    const sent = Object.fromEntries((all?.headers ?? []).map((h) => [h.key, h.value]));
    expect(sent).toMatchObject({
      'Strict-Transport-Security': expect.stringContaining('max-age=63072000'),
      'Content-Security-Policy': expect.stringContaining("frame-ancestors 'none'"),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    expect(sent['Permissions-Policy']).toContain('camera=()');
  });
});

// Search Console: the site must stay crawlable and point crawlers at the sitemap on the canonical domain.
describe('SEO files', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('robots.txt allows the homepage and references the sitemap', () => {
    const robots = read('public/robots.txt');
    expect(robots).not.toMatch(/^Disallow:\s*\/\s*$/m);
    expect(robots).toContain('Sitemap: https://frogtype.me/sitemap.xml');
  });

  it('sitemap.xml lists the canonical public pages', () => {
    const sitemap = read('public/sitemap.xml');
    for (const url of ['https://frogtype.me/', 'https://frogtype.me/lessons', 'https://frogtype.me/leaderboards']) {
      expect(sitemap).toContain(`<loc>${url}</loc>`);
    }
  });

  it('index.html is indexable and canonical to frogtype.me', () => {
    const html = read('index.html');
    expect(html).toContain('<link rel="canonical" href="https://frogtype.me/" />');
    expect(html).not.toMatch(/noindex/i);
  });
});
