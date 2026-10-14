#!/usr/bin/env node
// Fails the build when the bundle is React's development build. Runs as `postbuild`, so every build path
// (Vercel, CI, local) checks it. A NODE_ENV other than "production" at build time ships react-dom.development,
// runs every effect twice under StrictMode (each page sends its reads twice) and sets import.meta.env.DEV, which
// turns on dev-server-only previews such as ?asOwner=1. nuke.ag served such a build until 2026-10-14.
//
//   node scripts/check-production-bundle.mjs              dist/
//   node scripts/check-production-bundle.mjs --dist <dir> another build dir
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const distDir = args.includes('--dist') ? args[args.indexOf('--dist') + 1] : join(root, 'dist');
const assets = join(distDir, 'assets');

// Strings only React's development build carries
const DEV_MARKS = ['react-dom.development', 'Download the React DevTools'];

if (!existsSync(assets)) {
  console.error(`check-production-bundle: no ${assets}; build first`);
  process.exit(1);
}
const hits = [];
for (const name of readdirSync(assets)) {
  if (!name.endsWith('.js')) continue;
  const text = readFileSync(join(assets, name), 'utf8');
  for (const mark of DEV_MARKS) if (text.includes(mark)) hits.push(`${name}: "${mark}"`);
}
if (hits.length) {
  console.error(`check-production-bundle: this is React's development build (NODE_ENV was "${process.env.NODE_ENV ?? ''}")`);
  for (const h of hits) console.error(`  ${h}`);
  console.error('  build with NODE_ENV=production (nuke_frontend/vercel.json buildCommand sets it)');
  process.exit(1);
}
console.log('check-production-bundle: production React build');
