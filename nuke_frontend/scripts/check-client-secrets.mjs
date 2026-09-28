#!/usr/bin/env node
// Fails the build when a secret can reach the browser. Runs as `postbuild`, so every
// build path (Vercel, CI, local) checks it.
//   1. Source: browser code may only read VITE_* names that are public by design.
//   2. Output: the built files may contain no key-shaped strings.
// Values are masked in the report.
//
//   node scripts/check-client-secrets.mjs               source + dist/
//   node scripts/check-client-secrets.mjs --src-only    source only
//   node scripts/check-client-secrets.mjs --dist <dir>  source + another build dir
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const srcOnly = args.includes('--src-only');
const distDir = args.includes('--dist') ? args[args.indexOf('--dist') + 1] : join(root, 'dist');

// Public by design. Any other credential-shaped name fails.
const PUBLIC_ENV = new Set([
  'VITE_SUPABASE_ANON_KEY', // access is enforced by grants and row security, not by hiding the key
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_STRIPE_PUBLISHABLE_KEY',
  'VITE_GOOGLE_API_KEY', // browser key: must be HTTP-referrer restricted in Google Cloud
]);
const SECRET_NAME = /(SECRET|PRIVATE|PASSWORD|SERVICE|TOKEN|API_KEY|_KEY$|CLAUDE_API|OPENAI)/;

const KEY_PATTERNS = [
  ['Anthropic key', /(?<![A-Za-z0-9_-])sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,}/g],
  ['OpenAI key', /(?<![A-Za-z0-9_-])sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}/g],
  ['OpenAI legacy key', /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{48}(?![A-Za-z0-9])/g],
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{20,}/g],
  ['Stripe secret key', /(?<![A-Za-z0-9])(?:sk|rk)_live_[A-Za-z0-9]{20,}/g],
  ['Stripe webhook secret', /whsec_[A-Za-z0-9]{20,}/g],
  ['AWS access key', /(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])/g],
  ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/g],
  ['Slack token', /xox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
];
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;

function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, exts, out);
    else if (exts.has(extname(entry.name))) out.push(path);
  }
  return out;
}

const mask = (s) => (s.length <= 16 ? '***' : `${s.slice(0, 8)}…${s.slice(-4)}`);
const problems = new Set();

for (const file of walk(join(root, 'src'), new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/import\.meta\.env\??\.((?:VITE|REACT_APP)_[A-Z0-9_]+)/g)) {
    const name = m[1];
    if (SECRET_NAME.test(name) && !PUBLIC_ENV.has(name)) {
      problems.add(`${relative(root, file)}: reads ${name}; a secret read here ships in public JavaScript`);
    }
  }
}

if (!srcOnly) {
  if (!existsSync(distDir)) {
    console.error(`check-client-secrets: ${distDir} not found; run it after vite build`);
    process.exit(1);
  }
  for (const file of walk(distDir, new Set(['.js', '.mjs', '.html', '.map', '.json', '.css']))) {
    const text = readFileSync(file, 'utf8');
    const where = relative(root, file);
    for (const [label, re] of KEY_PATTERNS) {
      for (const m of text.matchAll(re)) problems.add(`${where}: ${label} ${mask(m[0])}`);
    }
    for (const m of text.matchAll(JWT)) {
      let role;
      try {
        role = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')).role;
      } catch {
        continue;
      }
      if (role && role !== 'anon') problems.add(`${where}: Supabase JWT with role "${role}" ${mask(m[0])}`);
    }
  }
}

if (problems.size) {
  console.error(`check-client-secrets: ${problems.size} problem(s); nothing secret may reach the browser:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-client-secrets: clean (${srcOnly ? 'source' : `source + ${relative(root, distDir) || distDir}`})`);
