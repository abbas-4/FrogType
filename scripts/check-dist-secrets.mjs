// FT-12: fail the build if anything privileged ended up in the browser bundle. Usage: node scripts/check-dist-secrets.mjs [dir]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
walk(dir);

const problems = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) problems.push(`${f}: Supabase secret key (sb_secret_...)`);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) problems.push(`${f}: private key block`);
  if (/SERVICE_ROLE_KEY\s*[:=]\s*["'][^"']{20,}/.test(text)) problems.push(`${f}: service-role key assignment`);
  for (const jwt of text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
    try {
      const role = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role;
      if (role && role !== 'anon') problems.push(`${f}: JWT with role "${role}"`);
    } catch {
      /* not a JWT */
    }
  }
}
if (problems.length) {
  console.error(`Secret check FAILED (values not printed):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Secret check passed: ${files.length} files in ${dir}/ contain no service-role, secret or private keys.`);
