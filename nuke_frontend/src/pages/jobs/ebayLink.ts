/**
 * The one place an eBay link for the parts hand-off is built.
 *
 * eBay Partner Network: the campaign id comes from VITE_EBAY_EPN_CAMPAIGN_ID, set in the deploy's environment, never in
 * this repo. It is empty today, so every link is the plain item page. When it is set, links carry eBay's documented EPN
 * parameters (US rotation id) and the page says so; the ranking never sees it (supabase/functions/extract-ebay-motors/
 * partsRank.ts reads no commission or affiliate field).
 *
 * Add-to-cart: eBay's cart URL (cart.payments.ebay.com/sc/add?item=iid:<id>,qty:1) was tried on 2026-10-20 with a real
 * item, logged out: it landed on an empty cart. It is not used; the hand-off is the item page, where the buyer adds to
 * cart or buys through eBay's own checkout.
 */

const ITEM_PAGE = /^https:\/\/www\.ebay\.com\/itm\/(\d{6,20})(\?fits=[^\s"<>#&]*)?$/;
const EPN_US_ROTATION = '711-53200-19255-0';

function readCampaign(): string | null {
  try {
    const v = import.meta.env.VITE_EBAY_EPN_CAMPAIGN_ID;
    return typeof v === 'string' && /^\d{6,12}$/.test(v.trim()) ? v.trim() : null;
  } catch {
    return null;
  }
}
const CAMPAIGN = readCampaign();

/** The link for an item page the parts finder returned, or null when it is not an eBay item page. Pure. */
export function buildEbayHref(itemUrl: string | null | undefined, campaignId: string | null): string | null {
  const m = typeof itemUrl === 'string' ? itemUrl.match(ITEM_PAGE) : null;
  if (!m) return null;
  if (!campaignId) return itemUrl as string;
  const epn = new URLSearchParams({ mkcid: '1', mkrid: EPN_US_ROTATION, siteid: '0', campid: campaignId, customid: 'nuke-parts', toolid: '10001', mkevt: '1' });
  return `${itemUrl}${m[2] ? '&' : '?'}${epn.toString()}`;
}

/** The hand-off link with this deploy's campaign id, if one is set. */
export const ebayHref = (itemUrl: string | null | undefined): string | null => buildEbayHref(itemUrl, CAMPAIGN);

/** What the page tells the buyer about the links. */
export function ebayLinkNote(campaignId: string | null = CAMPAIGN): string {
  return campaignId
    ? 'Links open eBay through the eBay Partner Network: Nuke may earn a commission on a purchase. Ranking never uses commission.'
    : 'Links open the plain eBay item page. Nuke earns nothing from them and ranking never uses commission.';
}
