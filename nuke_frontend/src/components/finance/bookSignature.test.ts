import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { bookSignature } from './useAccountingRevision';

// The live revision here and the revision stored with each gate run (books_book_signature) say "the book changed" in one spelling. The migration is the
// contract: its format is read from the file, and the browser's reading of PostgREST's timestamps must come out in it.
it('the browser spells the book\'s revision as the database does: count, a colon, the latest change as YYYY-MM-DDTHH:MI:SS.USZ in UTC', () => {
  const migration = readFileSync(fileURLToPath(new URL('../../../../supabase/migrations/20261106110000_books_gate_runs.sql', import.meta.url)), 'utf8');
  const sql = migration.slice(migration.indexOf('FUNCTION public.books_book_signature'), migration.indexOf('FUNCTION public.books_gate_md5'));
  expect(sql).toContain(`count(*)::text || ':' ||`);
  expect(sql).toContain(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);
  const shape = /^\d+:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
  for (const latest of ['2026-10-29T17:40:00.123456+00:00', '2026-10-29T17:40:00.5+00:00', '2026-10-29T17:40:00+00:00', '2026-10-29T17:40:00.5Z', '2026-10-29 17:40:00.123456+00']) {
    expect(bookSignature(3, latest), latest).toMatch(shape);
  }
  expect(bookSignature(3, '2026-10-29T17:40:00.123456+00:00')).toBe('3:2026-10-29T17:40:00.123456Z');
  expect(bookSignature(3, '2026-10-29T17:40:00.5+00:00')).toBe('3:2026-10-29T17:40:00.500000Z');
  expect(bookSignature(3, '2026-10-29T17:40:00+00:00')).toBe('3:2026-10-29T17:40:00.000000Z');
  // an empty book, and a reading that is not UTC (never guessed into the database's spelling)
  expect(bookSignature(0, undefined)).toBe('0:');
  expect(bookSignature(2, '2026-10-29T10:40:00.5-07:00')).toBe('2:2026-10-29T10:40:00.5-07:00');
});
