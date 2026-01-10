#!/usr/bin/env node
/**
 * Audit deprecated Edge Function invocations in code (not docs).
 *
 * Why:
 * - We keep accidentally calling legacy BaT functions (e.g. `import-bat-listing`) that are deprecated/410.
 * - This script enumerates actual invocations so we can fix callers before archiving/deleting functions.
 *
 * Usage:
 * - node scripts/audit-deprecated-edge-functions.cjs
 * - node scripts/audit-deprecated-edge-functions.cjs --strict   (exit 1 if any deprecated invocations found)
 * - node scripts/audit-deprecated-edge-functions.cjs --json     (print machine-readable JSON)
 */

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SCAN_DIRS = [
  path.join(ROOT, 'nuke_frontend', 'src'),
  path.join(ROOT, 'supabase', 'functions'),
  path.join(ROOT, 'scripts'),
];

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'playwright-report',
  'test-results',
  'tmp',
  'temp',
  '.git',
]);

const FILE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs']);

// Source of truth: supabase/functions/_shared/approved-extractors.ts
const DEPRECATED_BAT_FUNCTIONS = [
  'comprehensive-bat-extraction',
  'import-bat-listing',
  'bat-extract-complete-v1',
  'bat-extract-complete-v2',
  'bat-extract-complete-v3',
];

const REPLACEMENTS = {
  'comprehensive-bat-extraction': 'extract-premium-auction + extract-auction-comments',
  'import-bat-listing': 'extract-premium-auction + extract-auction-comments',
  'bat-extract-complete-v1': 'process-bat-extraction-queue or pipeline-orchestrator',
  'bat-extract-complete-v2': 'extract-premium-auction + extract-auction-comments',
  'bat-extract-complete-v3': 'extract-premium-auction + extract-auction-comments',
};

const INVOKE_RE = /functions\.invoke\(\s*['"]([a-z0-9-]+)['"]/g;
const V1_RE = /\/functions\/v1\/([a-z0-9-]+)/g;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIR_NAMES.has(ent.name)) continue;
      walk(full, out);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (!FILE_EXTS.has(ext)) continue;
      out.push(full);
    }
  }
  return out;
}

function add(map, key, value) {
  if (!map[key]) map[key] = [];
  if (!map[key].includes(value)) map[key].push(value);
}

function scanFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const hits = new Set();
  for (const re of [INVOKE_RE, V1_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const fn = String(m[1] || '').trim();
      if (fn) hits.add(fn);
    }
  }
  return Array.from(hits);
}

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const jsonOnly = args.has('--json');

const allFiles = SCAN_DIRS.flatMap((d) => walk(d));

const invocationsByFunction = {};
for (const fp of allFiles) {
  let hits = [];
  try {
    hits = scanFile(fp);
  } catch {
    continue;
  }
  for (const fn of hits) add(invocationsByFunction, fn, path.relative(ROOT, fp));
}

const deprecatedInvocations = {};
for (const fn of DEPRECATED_BAT_FUNCTIONS) {
  if (invocationsByFunction[fn]?.length) {
    deprecatedInvocations[fn] = invocationsByFunction[fn].slice().sort();
  }
}

const report = {
  generated_at: new Date().toISOString(),
  scan_dirs: SCAN_DIRS.map((d) => path.relative(ROOT, d)),
  deprecated_bat_functions: DEPRECATED_BAT_FUNCTIONS,
  deprecated_invocations: deprecatedInvocations,
  replacements: REPLACEMENTS,
  ok: Object.keys(deprecatedInvocations).length === 0,
};

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Deprecated BaT function audit`);
  console.log(`- scanned: ${report.scan_dirs.join(', ')}`);
  if (report.ok) {
    console.log(`- result: OK (no deprecated invocations found)`);
  } else {
    console.log(`- result: FAIL (${Object.keys(deprecatedInvocations).length} deprecated function(s) invoked)`);
    for (const [fn, files] of Object.entries(deprecatedInvocations)) {
      const replacement = REPLACEMENTS[fn] ? ` (use: ${REPLACEMENTS[fn]})` : '';
      console.log(`\n- ${fn}${replacement}`);
      for (const f of files) console.log(`  - ${f}`);
    }
    console.log(`\nTip: run with --json to export a machine-readable report.`);
  }
}

if (strict && !report.ok) {
  process.exit(1);
}

