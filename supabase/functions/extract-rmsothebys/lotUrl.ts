// RM Sotheby's lot links from the SearchLots API.
// The API used to return site-relative links ("/auctions/mo26/lots/r0007-1954-buick-skylark/"). On 2026-10-06 it returns
// absolute ones ("https://rmsothebys.com/auctions/mo26/lots/r0007-1954-buick-skylark/"). Prefixing the host onto an
// absolute link produced "https://rmsothebys.comhttps://rmsothebys.com/auctions/...", which matched no stored vehicle.
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';

const RM_ORIGIN = 'https://rmsothebys.com';

/** The lot's page URL. An absolute link is kept as given; a site-relative one gets RM's origin. */
export function rmLotUrl(link: string): string {
  const raw = String(link ?? '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${RM_ORIGIN}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

/** True when an API lot link and a lot page URL name the same lot, ignoring scheme, www, trailing slash, query and hash. */
export function rmLotLinkMatchesUrl(link: string, url: string): boolean {
  const a = normalizeListingUrlKey(rmLotUrl(link));
  const b = normalizeListingUrlKey(url);
  return a !== null && a === b;
}
