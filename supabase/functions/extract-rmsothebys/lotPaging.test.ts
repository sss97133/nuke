// Run: deno test supabase/functions/extract-rmsothebys/
// collectLots against a stand-in for RM's lot search that pages the way the real one does (measured 2026-10-14):
// page 0 and page 1 are the same first page, skip = (page - 1) * pageSize, a page past the end is empty, a pageSize
// above 200 falls back to 40, and the pager states totalItems and totalPages.
import { collectLots, type LotPage } from './lotPaging.ts';

function equal(actual: unknown, expected: unknown, what = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

type Lot = { id: string; link: string };
const makeLots = (n: number): Lot[] => Array.from({ length: n }, (_, i) => ({ id: `lot-${i + 1}`, link: `/lots/${i + 1}/` }));

/** A stand-in for the real search: pages from 1 (page 0 = page 1), serves `size` lots a page, states the pager. */
function realApi(all: Lot[], size: number, calls: number[] = []) {
  return (page: number): Promise<LotPage<Lot>> => {
    calls.push(page);
    const p = Math.max(page, 1);
    const items = all.slice((p - 1) * size, p * size);
    return Promise.resolve({ items, totalItems: all.length, totalPages: Math.max(Math.ceil(all.length / size), 1) });
  };
}

Deno.test('the old loop started at page 0 and read a one-page auction twice: this stand-in does that to page 0', async () => {
  const api = realApi(makeLots(199), 200);
  equal(JSON.stringify((await api(0)).items), JSON.stringify((await api(1)).items));
});

Deno.test('a one-page auction (MO26: 199 lots) is read once, each lot once', async () => {
  const calls: number[] = [];
  const got = await collectLots(realApi(makeLots(199), 200, calls));
  equal(got.items.length, 199);
  equal(got.reported_total, 199);
  equal(got.duplicates_dropped, 0);
  equal(got.pages_fetched, 1);
  equal(calls, [1]);
});

Deno.test('a three-page auction is read page by page, 450 lots once each, and stops at the last page', async () => {
  const calls: number[] = [];
  const got = await collectLots(realApi(makeLots(450), 200, calls));
  equal(got.items.length, 450);
  equal(new Set(got.items.map((l) => l.id)).size, 450);
  equal(got.pages_fetched, 3);
  equal(calls, [1, 2, 3]);
  equal(got.duplicates_dropped, 0);
});

Deno.test('a server that serves 40 a page whatever was asked (pageSize above 200) is still read in full', async () => {
  const got = await collectLots(realApi(makeLots(199), 40));
  equal(got.items.length, 199);
  equal(got.pages_fetched, 5);
  equal(got.duplicates_dropped, 0);
});

Deno.test('an empty auction is one empty page', async () => {
  const got = await collectLots(realApi([], 200));
  equal(got.items.length, 0);
  equal(got.pages_fetched, 1);
});

Deno.test('a server that ignores the page number is read twice, its repeats dropped and counted, then stopped', async () => {
  const same = makeLots(65);
  const calls: number[] = [];
  const got = await collectLots(async (page) => {
    calls.push(page);
    return { items: same, totalItems: null, totalPages: null };
  });
  equal(got.items.length, 65);
  equal(got.duplicates_dropped, 65);
  equal(calls, [1, 2]);
});

Deno.test('a server that never ends is stopped at maxPages', async () => {
  let n = 0;
  const calls: number[] = [];
  const got = await collectLots(async (page) => {
    calls.push(page);
    return { items: [{ id: `x${n++}`, link: '' }], totalItems: null, totalPages: null };
  }, { maxPages: 4 });
  equal(got.items.length, 4);
  equal(calls, [1, 2, 3, 4]);
});

Deno.test('a short read shows: RM reports 100, the server holds 90, and the run says both', async () => {
  const all = makeLots(90);
  const got = await collectLots(async (page) => {
    const items = all.slice((page - 1) * 40, page * 40);
    return { items, totalItems: 100, totalPages: 3 };
  });
  equal(got.items.length, 90);
  equal(got.reported_total, 100);
});

Deno.test('a lot with no id is told apart by its link; a lot with neither is kept', async () => {
  const got = await collectLots(async (page) => ({
    items: page === 1
      ? [{ id: '', link: '/a/' }, { id: '', link: '/b/' }, { id: '', link: '/a/' }, {}] as Lot[]
      : [],
    totalItems: null,
    totalPages: null,
  }));
  equal(got.items.length, 3);
  equal(got.duplicates_dropped, 1);
});

Deno.test('a fetch error is not swallowed', async () => {
  let threw = false;
  try {
    await collectLots(async () => { throw new Error("RM Sotheby's API error: 429"); });
  } catch (e) {
    threw = (e as Error).message.includes('429');
  }
  equal(threw, true);
});
