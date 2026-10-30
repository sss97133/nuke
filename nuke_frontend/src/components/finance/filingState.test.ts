import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { FILING_WORDS } from './filingState';
import { ACTORS } from '../../services/accountingCloseout';

// The lists a filing state and an actor are drawn from live in three places: the writer (scripts/books/return_facts.py), the reader (books_gate_status counts by
// actor) and this page. They are not kept the same by being copied; they are kept the same by reading the other two here.
const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../../../${path}`, import.meta.url)), 'utf8');
const tuple = (source: string, name: string) => {
  const m = new RegExp(`^${name} = \\(([^)]*)\\)`, 'm').exec(source);
  if (!m) throw new Error(`${name} not found`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
};

it('the filing states the writer accepts are the ones the page has words for, in the same order', () => {
  expect(tuple(read('scripts/books/return_facts.py'), 'FILING_STATES')).toEqual(Object.keys(FILING_WORDS));
});

it('the actors the writer accepts are the ones the page and the reader count', () => {
  expect(tuple(read('scripts/books/return_facts.py'), 'ACTORS')).toEqual([...ACTORS]);
  const reader = read('supabase/migrations/20261106110000_books_gate_runs.sql');
  for (const actor of ACTORS) expect(reader, actor).toContain(`f.actor = '${actor}'`);
  expect(reader).toContain(`f.actor NOT IN (${ACTORS.map(a => `'${a}'`).join(', ')})`);
});
