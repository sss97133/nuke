// Run: deno test supabase/functions/extract-rmsothebys/lotUrl.test.ts
// Both link shapes the SearchLots API has returned, against the URL form stored on vehicles for MO26 lots on 2026-10-06
// ("https://rmsothebys.com/auctions/mo26/lots/r0008-…", no trailing slash).
import { rmLotLinkMatchesUrl, rmLotUrl } from './lotUrl.ts';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const ABSOLUTE = 'https://rmsothebys.com/auctions/mo26/lots/r0007-1954-buick-skylark/';
const RELATIVE = '/auctions/mo26/lots/r0007-1954-buick-skylark/';
const STORED = 'https://rmsothebys.com/auctions/mo26/lots/r0007-1954-buick-skylark';

Deno.test('an absolute link is kept as given, never prefixed twice', () => {
  equal(rmLotUrl(ABSOLUTE), ABSOLUTE);
  equal(rmLotUrl('http://rmsothebys.com/auctions/mo26/lots/r0007-1954-buick-skylark/'),
    'http://rmsothebys.com/auctions/mo26/lots/r0007-1954-buick-skylark/');
  equal(rmLotUrl(` ${ABSOLUTE} `), ABSOLUTE);
});

Deno.test('a site-relative link gets the RM origin, with or without its leading slash', () => {
  equal(rmLotUrl(RELATIVE), ABSOLUTE);
  equal(rmLotUrl(RELATIVE.slice(1)), ABSOLUTE);
});

Deno.test('both shapes give the listing key of the URL already stored for the lot', () => {
  const key = normalizeListingUrlKey(STORED);
  equal(normalizeListingUrlKey(rmLotUrl(ABSOLUTE)), key);
  equal(normalizeListingUrlKey(rmLotUrl(RELATIVE)), key);
});

Deno.test('a lot link matches its page URL in either shape, and with www, a trailing slash or a query', () => {
  for (const link of [ABSOLUTE, RELATIVE]) {
    equal(rmLotLinkMatchesUrl(link, STORED), true);
    equal(rmLotLinkMatchesUrl(link, ABSOLUTE), true);
    equal(rmLotLinkMatchesUrl(link, 'https://www.rmsothebys.com/auctions/mo26/lots/r0007-1954-buick-skylark/?ref=x#top'), true);
  }
});

Deno.test('a different lot, auction or host does not match', () => {
  equal(rmLotLinkMatchesUrl(ABSOLUTE, 'https://rmsothebys.com/auctions/mo26/lots/r0008-1923-rollsroyce-silver-ghost'), false);
  equal(rmLotLinkMatchesUrl(ABSOLUTE, 'https://rmsothebys.com/auctions/mc26/lots/r0007-1954-buick-skylark'), false);
  equal(rmLotLinkMatchesUrl(ABSOLUTE, 'https://example.com/auctions/mo26/lots/r0007-1954-buick-skylark'), false);
});
