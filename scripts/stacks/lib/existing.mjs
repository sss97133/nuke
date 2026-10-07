// What already exists, so the generator does not repeat it: the 60 stacks of the case ledger (sections 13 and 13.2,
// parsed from the doc so the doc stays the single source) and every earlier proposal in the log folder.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_ROOT, REPO_ROOT } from './common.mjs';

export const DEFAULT_CASES_DOC = join(REPO_ROOT, 'docs', 'ledger', 'theory', 'data-machine-cases.md');
const dropAside = s => s.replace(/\s*\([^)]*\)\s*$/, '').trim();

/** Stack names from the case ledger: the table of 20, the four built stacks A to D, and the "forty more". */
export function parseExistingStacks(markdown) {
  const start = markdown.search(/^## 13\./m);
  if (start < 0) return [];
  const rest = markdown.slice(start);
  const next = rest.slice(3).search(/^## \d/m);
  const section = next >= 0 ? rest.slice(0, next + 3) : rest;
  const found = [];

  for (const m of section.matchAll(/^\|\s*(\d{1,2})\s*\|\s*([^|]+?)\s*\|/gm)) {
    found.push({ ref: m[1], name: dropAside(m[2]), source: 'case-ledger table' });
  }
  for (const m of section.matchAll(/^\*([A-D])\.\s+([^*]+?)\.\*/gm)) {
    found.push({ ref: m[1], name: dropAside(m[2]), source: 'case-ledger built stack' });
  }
  const marker = '**Forty more, each with the layer it needs.**';
  const a = section.indexOf(marker);
  if (a >= 0) {
    const b = section.indexOf('**How we get there', a);
    const paragraph = section.slice(a + marker.length, b > a ? b : undefined).replace(/\s+/g, ' ').trim();
    // "NN name (what it needs)", separated by ";" within a group and "." between groups; parentheses never nest.
    for (const m of paragraph.matchAll(/(?:^|[;.:]\s+)(\d{2})\s+([^;(]+?)\s*(?:\(([^()]*)\))?(?=\s*(?:;|\.(?:\s|$)|$))/g)) {
      found.push({ ref: m[1], name: m[2].trim(), source: 'case-ledger forty more' });
    }
  }
  return found;
}

export function loadExistingStacks(path = DEFAULT_CASES_DOC) {
  if (!existsSync(path)) return { stacks: [], path, found: false };
  return { stacks: parseExistingStacks(readFileSync(path, 'utf8')), path, found: true };
}

/** Every proposal already written to <logRoot>/proposals/*.jsonl, newest file first. Unreadable lines are skipped. */
export function loadEarlierProposals(logRoot = LOG_ROOT) {
  const dir = join(logRoot, 'proposals');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort().reverse()) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        const name = row.name ?? row.proposal?.name;
        if (name) out.push({ name, id: row.id, file });
      } catch { /* a torn line from an interrupted run; ignore */ }
    }
  }
  return out;
}
