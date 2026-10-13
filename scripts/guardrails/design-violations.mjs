#!/usr/bin/env node
// Counts design-system lint violations in nuke_frontend/src, per rule, with every
// design-system rule treated as an error for the count. scripts/ci/verify.sh ratchets
// each count against scripts/ci/baseline.json: a PR may lower a count, never raise it.
//
//   node scripts/guardrails/design-violations.mjs          # table
//   node scripts/guardrails/design-violations.mjs --json   # {"no-inline-style": 123, ...}
//   node scripts/guardrails/design-violations.mjs --list no-font-props   # file:line for one rule
//
// src/kit is exempt: it is the one place type and layout are allowed to be decided.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FE = path.join(ROOT, 'nuke_frontend');
const { ESLint } = createRequire(path.join(FE, 'package.json'))('eslint');

export const DESIGN_RULES = [
  'no-hardcoded-colors',
  'no-border-radius',
  'no-box-shadow',
  'no-gradient',
  'no-banned-fonts',
  'no-inline-style',
  'no-font-props',
];

export async function countDesignViolations() {
  const eslint = new ESLint({
    cwd: FE,
    overrideConfig: [{
      files: ['src/**/*.{ts,tsx}'],
      ignores: ['src/kit/**'],
      rules: Object.fromEntries(DESIGN_RULES.map(rule => [`design-system/${rule}`, 'error'])),
    }],
  });
  const results = await eslint.lintFiles(['src/**/*.{ts,tsx}']);
  const counts = Object.fromEntries(DESIGN_RULES.map(rule => [rule, 0]));
  const sites = Object.fromEntries(DESIGN_RULES.map(rule => [rule, []]));
  for (const file of results) {
    for (const message of file.messages) {
      const rule = String(message.ruleId || '').replace(/^design-system\//, '');
      if (!(rule in counts)) continue;
      counts[rule] += 1;
      sites[rule].push(`${path.relative(ROOT, file.filePath)}:${message.line}`);
    }
  }
  return { counts, sites };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const { counts, sites } = await countDesignViolations();
  const listIndex = process.argv.indexOf('--list');
  if (listIndex > -1) {
    const rule = process.argv[listIndex + 1];
    for (const site of sites[rule] || []) console.log(site);
  } else if (process.argv.includes('--json')) {
    console.log(JSON.stringify(counts));
  } else {
    for (const [rule, count] of Object.entries(counts)) console.log(String(count).padStart(6), rule);
    console.log(String(Object.values(counts).reduce((a, b) => a + b, 0)).padStart(6), 'total');
  }
}
