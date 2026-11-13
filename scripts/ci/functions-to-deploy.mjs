#!/usr/bin/env node
/**
 * scripts/ci/functions-to-deploy.mjs
 *
 * The edge functions a change must redeploy. Each function is bundled with every file it imports, so a change to
 * supabase/functions/_shared/x.ts changes every function that imports x.ts, directly or through other files. Listing
 * only the folders that changed left those importers on the old code without a word: the 1973 Firebird engine-letter
 * fix (657e90226, 2026-11-11) changed _shared/vin-decoder.ts, deployed decode-vin-and-update only, and
 * api-v1-vin-lookup and ingest kept the old table until a manual dispatch.
 *
 * Input: changed paths (repo-relative), as arguments or one per line on stdin. Output: one function name per line,
 * sorted. A function is a folder supabase/functions/<name>/ whose name does not start with "_". It is listed when
 *   - a changed path is inside its folder, or
 *   - a file inside its folder (not a test) imports a changed path, directly or through other files.
 * Imports are the relative specifiers in `import ... from`, `export ... from`, bare `import '...'`, `import('...')`
 * and `new URL('...', import.meta.url)` in .ts/.tsx/.js/.mjs files under supabase/functions. Remote (https:, npm:,
 * jsr:) specifiers are not files here and are ignored.
 *
 *   git diff --name-only HEAD^ HEAD -- supabase/functions/ | node scripts/ci/functions-to-deploy.mjs
 *   node scripts/ci/functions-to-deploy.mjs --explain supabase/functions/_shared/vin-decoder.ts
 *   node --test scripts/ci/functions-to-deploy.test.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CODE = /\.(ts|tsx|js|mjs)$/;
const TEST = /(\.test\.(ts|tsx|js|mjs)|_test\.ts)$/;
const SPEC = [
  /\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
  /\bnew\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g,
];

/** Relative specifiers a source file names. */
export function specifiers(source) {
  const out = new Set();
  for (const re of SPEC) for (const m of source.matchAll(re)) if (m[1].startsWith('./') || m[1].startsWith('../')) out.add(m[1]);
  return [...out];
}

function walk(dir, rel, files) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const abs = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(abs).isDirectory()) walk(abs, r, files);
    else files.push(r);
  }
  return files;
}

/** Reverse import graph over the functions tree: file -> files that import it (paths relative to the tree root). */
export function importersGraph(root) {
  const importers = new Map();
  for (const file of walk(root, '', [])) {
    if (!CODE.test(file)) continue;
    let source;
    try { source = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    for (const spec of specifiers(source)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec.split(/[?#]/)[0]));
      if (target.startsWith('..')) continue;
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(file);
    }
  }
  return importers;
}

const fnOf = (file) => {
  const top = file.split('/')[0];
  return file.includes('/') && !top.startsWith('_') ? top : null;
};

/**
 * Functions to deploy for changed paths (repo-relative or relative to root). Returns
 * { functions: string[], reasons: Map<fn, string> } where a reason names the changed file and the import chain.
 */
export function functionsToDeploy(changed, { root = 'supabase/functions', prefix = 'supabase/functions/' } = {}) {
  const graph = importersGraph(root);
  const reasons = new Map();
  for (const raw of changed) {
    const p = raw.trim();
    if (!p.startsWith(prefix)) continue;
    const start = p.slice(prefix.length);
    const own = fnOf(start);
    if (own && !reasons.has(own)) reasons.set(own, `${start} (own folder)`);
    const seen = new Set([start]);
    const queue = [[start, [start]]];
    while (queue.length) {
      const [file, chain] = queue.shift();
      for (const imp of graph.get(file) ?? []) {
        if (seen.has(imp) || TEST.test(imp)) continue;
        seen.add(imp);
        const next = [...chain, imp];
        const fn = fnOf(imp);
        if (fn && !reasons.has(fn)) reasons.set(fn, next.join(' <- '));
        queue.push([imp, next]);
      }
    }
  }
  return { functions: [...reasons.keys()].sort(), reasons };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const explain = args.includes('--explain');
  let changed = args.filter((a) => a !== '--explain');
  if (!changed.length) changed = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  const { functions, reasons } = functionsToDeploy(changed);
  for (const fn of functions) console.log(explain ? `${fn}\t${reasons.get(fn)}` : fn);
}
