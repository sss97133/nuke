#!/usr/bin/env node
// Per-route initial JavaScript budget for the public and sign-in routes.
//
// Builds nuke_frontend with its own vite.config.ts in memory (nothing written), then for each route takes the entry
// chunk plus the chunks holding the route's page modules, follows *static* imports only (lazy imports are not initial),
// and sums the gzip size of their code. Compares against scripts/ci/route-js-budget.json: a route fails when it grows
// more than `tolerance` over its baseline or exceeds `cap_kb`. Shrinking is reported so the baseline can be lowered.
//
//   node scripts/ci/route-js-budget.mjs            # check (exit 1 on a regression)
//   node scripts/ci/route-js-budget.mjs --write    # reseed the baseline from this build
//   node scripts/ci/route-js-budget.mjs --json     # print the measurement
//
// Measured 2026-10-19 after the Leaflet-on-every-page fix (#2279); route-js-budget.test.mjs proves that reintroducing
// that bug (Vite's preload helper in the 'maps' chunk) fails this check.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FE = path.join(ROOT, 'nuke_frontend');
export const BASELINE = path.join(ROOT, 'scripts', 'ci', 'route-js-budget.json');

/** Route → the page modules a direct load needs (the router module and the page component it lazy-loads). */
export const ROUTES = {
  vehicle: ['src/routes/modules/vehicle/routes.tsx', 'src/pages/VehicleProfile.tsx'],
  jobs: ['src/pages/jobs/JobsBoard.tsx'],
  job: ['src/pages/jobs/JobPage.tsx'],
  provider: ['src/pages/providers/ProviderProfilePage.tsx'],
  org: ['src/routes/modules/organization/routes.tsx', 'src/pages/OrganizationProfile.tsx'],
  work_setup: ['src/pages/provider-setup/ProviderSetupPage.tsx'],
  login: ['src/components/auth/Login.tsx'],
};

const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;

/**
 * Build and measure. `manualChunks` lets a test wrap the project's chunking rule: it receives the module id and the
 * project's own answer, and returns the chunk name to use.
 */
export async function measure({ manualChunks } = {}) {
  const require = createRequire(path.join(FE, 'package.json'));
  const { build } = await import(pathToFileURL(require.resolve('vite')).href);
  const wrap = manualChunks ? [{
    name: 'route-js-budget-wrap',
    config(config) {
      const output = config.build?.rollupOptions?.output;
      const own = output && !Array.isArray(output) ? output.manualChunks : undefined;
      if (typeof own !== 'function') throw new Error('vite.config.ts manualChunks is not a function');
      output.manualChunks = (id, api) => manualChunks(id, own(id, api));
    },
  }] : [];
  const prevCwd = process.cwd();
  process.chdir(FE);
  let result;
  try {
    result = await build({ root: FE, logLevel: 'silent', mode: 'production', build: { write: false, reportCompressedSize: false }, plugins: wrap });
  } finally {
    process.chdir(prevCwd);
  }
  const output = (Array.isArray(result) ? result : [result]).flatMap(r => r.output);
  const chunks = output.filter(c => c.type === 'chunk');
  const byFile = new Map(chunks.map(c => [c.fileName, c]));
  const entry = chunks.find(c => c.isEntry);
  if (!entry) throw new Error('no entry chunk in the build');
  const gz = new Map(chunks.map(c => [c.fileName, gzipSync(c.code).length]));
  const closure = (start) => {
    const seen = new Set();
    const stack = [...start];
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f) || !byFile.has(f)) continue;
      seen.add(f);
      stack.push(...byFile.get(f).imports);
    }
    return seen;
  };
  const routes = {};
  for (const [name, modules] of Object.entries(ROUTES)) {
    const starts = [entry.fileName];
    for (const m of modules) {
      const abs = path.join(FE, m);
      const holder = chunks.find(c => c.facadeModuleId === abs) ?? chunks.find(c => c.moduleIds.includes(abs));
      if (!holder) throw new Error(`route ${name}: ${m} is in no chunk`);
      starts.push(holder.fileName);
    }
    const files = closure(starts);
    routes[name] = { kb: kb([...files].reduce((n, f) => n + gz.get(f), 0)), chunks: [...files].map(f => f.replace(/^assets\//, '').replace(/-[A-Za-z0-9_-]{8}\.js$/, '')).sort() };
  }
  return { entry_kb: kb(gz.get(entry.fileName)), routes };
}

/** Compare a measurement with the baseline. Returns problems (regressions) and notes (room to lower the baseline). */
export function check(measured, baseline) {
  const problems = [];
  const notes = [];
  const tol = baseline.tolerance ?? 0.1;
  const never = baseline.never_initial ?? [];
  for (const [name, base] of Object.entries(baseline.routes)) {
    const cur = measured.routes[name]?.kb;
    if (cur === undefined) { problems.push(`${name}: not measured`); continue; }
    const heavy = (measured.routes[name].chunks ?? []).filter(c => never.includes(c));
    if (heavy.length) problems.push(`${name}: loads ${heavy.join(', ')} before first paint (never_initial)`);
    if (cur > baseline.cap_kb) problems.push(`${name}: ${cur} KB is over the ${baseline.cap_kb} KB cap`);
    else if (cur > base * (1 + tol)) problems.push(`${name}: ${cur} KB is ${Math.round((cur / base - 1) * 100)}% over its ${base} KB baseline (limit +${Math.round(tol * 100)}%)`);
    else if (cur < base * 0.95) notes.push(`${name}: ${cur} KB, ${Math.round((1 - cur / base) * 100)}% under its ${base} KB baseline; lower it with --write`);
  }
  return { problems, notes };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const m = await measure();
  if (process.argv.includes('--json')) { console.log(JSON.stringify(m, null, 2)); process.exit(0); }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
  if (process.argv.includes('--write')) {
    baseline.generated = new Date().toISOString().slice(0, 10);
    baseline.routes = Object.fromEntries(Object.entries(m.routes).map(([k, v]) => [k, v.kb]));
    writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`route-js-budget: baseline written (${Object.entries(baseline.routes).map(([k, v]) => `${k} ${v} KB`).join(', ')})`);
    process.exit(0);
  }
  for (const [name, r] of Object.entries(m.routes)) console.log(`${String(r.kb).padStart(7)} KB  ${name.padEnd(11)} (baseline ${baseline.routes[name] ?? '—'} KB)`);
  const { problems, notes } = check(m, baseline);
  for (const n of notes) console.log(`note: ${n}`);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error('route-js-budget FAIL: a route\'s initial JavaScript grew. Lazy-load what the first paint does not need, or, if the growth is intended, reseed with --write and say why in the PR.');
    process.exit(1);
  }
  console.log('route-js-budget PASS');
}
