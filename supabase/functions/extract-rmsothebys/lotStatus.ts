// A lot's status, from the flags RM's lot search returns.
//
// Before: sold -> 'sold'; else still for sale -> 'available'; else 'ended'. A lot in an auction that has not been held
// is none of sold, for sale or ended, but it fell to 'ended': every lot of The London Auction 2026 (LF26, held 31 October
// 2026, 65 lots with auctioned=false, sold=false, isStillForSale=false on 2026-10-14) would have been written as ended.
//
// Now a lot RM says is not yet auctioned is 'upcoming' on the vehicle (a value vehicles.sale_status already allows) and
// 'pending' on its event, the way extract-gooding writes an upcoming lot. All 301 lots of the five held 2026 auctions read
// on 2026-10-14 have auctioned=true, so a held auction is unchanged.

export interface LotFlags {
  sold: boolean;
  /** RM's `auctioned`: true once the lot has been through the sale. Null when the source did not say (an HTML page). */
  auctioned: boolean | null;
  is_still_for_sale: boolean;
}

export interface LotStatus {
  sale_status: 'sold' | 'available' | 'upcoming' | 'ended';
  event_status: 'sold' | 'active' | 'pending' | 'ended';
}

export function lotStatus(lot: LotFlags): LotStatus {
  if (lot.sold) return { sale_status: 'sold', event_status: 'sold' };
  if (lot.is_still_for_sale) return { sale_status: 'available', event_status: 'active' };
  if (lot.auctioned === false) return { sale_status: 'upcoming', event_status: 'pending' };
  return { sale_status: 'ended', event_status: 'ended' };
}
