// Run: deno test supabase/functions/extract-bonhams-typesense/
import { advance, landedAnything, startFrom } from './landCursor.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

Deno.test('no cursor starts at page 1 of pass 0; a cursor starts on the page after it', () => {
  equal(startFrom(null), { pass: 0, page: 1 });
  equal(startFrom({ pass: 3, last_page: 591 }), { pass: 3, page: 592 });
});

Deno.test('a run that landed two pages moves the cursor to the second', () => {
  equal(advance({ pass: 3, last_page: 591 }, 3, 592, 2, true), { pass: 3, last_page: 593 });
  equal(advance(null, 0, 1, 1, true), { pass: 0, last_page: 1 });
});

Deno.test('a wrap to page 1 of the next pass outranks the last page of the old pass', () => {
  equal(advance({ pass: 3, last_page: 682 }, 4, 1, 2, true), { pass: 4, last_page: 2 });
});

Deno.test('nothing landed, or a run behind the stored cursor, leaves it where it is', () => {
  equal(advance({ pass: 3, last_page: 591 }, 3, 592, 2, false), null);
  equal(advance({ pass: 3, last_page: 600 }, 3, 592, 2, true), null);
  equal(advance({ pass: 4, last_page: 1 }, 3, 592, 2, true), null);
});

Deno.test('landed means a lot was created or updated by a lander call', () => {
  equal(landedAnything([{ created: 0, updated: 0, rejected: 50 }, { error: 'HTTP 500' }]), false);
  equal(landedAnything([{ created: 0, updated: 47 }]), true);
});
