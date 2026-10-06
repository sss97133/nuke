/**
 * Which vehicles price column each price on a listing page belongs in.
 *
 * A listing page states an ask. Some pages also state a sale ("sold for $X", a hammer price).
 * vehicles.asking_price takes the ask. vehicles.sale_price claims that money moved, so it takes
 * only the page's stated sale (sold_price), never the ask. A page that shows just a price
 * (Craigslist, other classifieds, dealer sites) states no sale, so sale_price stays null.
 *
 * The database holds the same line: guard_vehicle_sale_price (migration 20260927170000) refuses a
 * positive sale_price unless sale_status or auction_outcome says sold. Writing the ask there was
 * wrong before the guard, and after it the insert fails.
 */
export function listingPriceColumns(prices: { price?: number | null; sold_price?: number | null }): {
  sale_price: number | null;
  asking_price: number | null;
} {
  return {
    sale_price: prices.sold_price || null,
    asking_price: prices.price || null,
  };
}
