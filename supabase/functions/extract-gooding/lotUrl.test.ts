// Run: deno test supabase/functions/extract-gooding/
import { goodingSlug, goodingUrlVariants } from './lotUrl.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

Deno.test('www and the bare host name the same lot', () => {
  equal(goodingSlug('https://www.goodingco.com/lot/1991-mercedes-benz-560-sec-1'), '1991-mercedes-benz-560-sec-1');
  equal(goodingSlug('https://goodingco.com/lot/1991-mercedes-benz-560-sec-1/'), '1991-mercedes-benz-560-sec-1');
  equal(goodingSlug('http://GoodingCo.com/lot/A-B?x=1'), 'a-b');
});

Deno.test('the variants cover both hosts and both trailing-slash spellings, whichever one is given', () => {
  const want = [
    'https://goodingco.com/lot/1991-mercedes-benz-560-sec-1', 'https://goodingco.com/lot/1991-mercedes-benz-560-sec-1/',
    'https://www.goodingco.com/lot/1991-mercedes-benz-560-sec-1', 'https://www.goodingco.com/lot/1991-mercedes-benz-560-sec-1/',
  ];
  equal(goodingUrlVariants('https://www.goodingco.com/lot/1991-mercedes-benz-560-sec-1'), want);
  equal(goodingUrlVariants('https://goodingco.com/lot/1991-mercedes-benz-560-sec-1/'), want);
});

Deno.test('a URL that is not a Gooding lot is left as it is', () => {
  equal(goodingSlug('https://example.com/lot/x'), null);
  equal(goodingUrlVariants('https://example.com/lot/x'), ['https://example.com/lot/x']);
});
