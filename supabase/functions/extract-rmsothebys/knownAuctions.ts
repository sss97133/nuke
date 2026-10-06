/**
 * RM Sotheby's auction code -> sale day. There is no public RM API for this, so the table is kept by hand.
 *
 * extract-rmsothebys writes vehicle_events.sold_at = `${date}T12:00:00Z` (and the timeline sale event) from this
 * table, so a wrong day here becomes a wrong sale date on every lot of that auction.
 *
 * `date` is the FIRST day the RM auction page states: https://rmsothebys.com/auctions/<code>/, the line under the
 * auction name in the page header. For a multi-day sale it is the first day; the page does not say which day a lot
 * sold. Every line marked "page:" cites the listing_page_snapshots row that holds that page (captured 2026-10-06
 * through archiveFetch). Lines marked "not checked" have not been compared with a page.
 *
 * RM's codes: `mo` is Monterey and `mc` is Monaco. The table first written on 2026-02-01 had MO24/MO25 as Monaco
 * (May), and wrong days for PA24, PA25 and MI25.
 * Pinned by nuke_frontend/src/lib/dealRead/rmsothebysKnownAuctions.test.ts.
 */
export interface KnownAuction {
  code: string;
  name: string;
  date: string;
}

export function getKnownAuctions(): KnownAuction[] {
  return [
    // 2026 auctions
    { code: 'PA26', name: 'Paris 2026', date: '2026-01-28' }, // page: "28 January 2026" · listing_page_snapshots 0e9e873b-a054-45e0-ac23-481a9908d201
    { code: 'AZ26', name: 'Arizona 2026', date: '2026-01-23' }, // page: "23 January 2026" · listing_page_snapshots ea2fb9b9-ab08-4ffd-b74c-b5df50f673b1
    { code: 'CC26', name: 'Cavallino Palm Beach 2026', date: '2026-02-14' }, // not checked
    { code: 'MI26', name: 'Miami 2026', date: '2026-02-27' }, // page: "27 February 2026" · listing_page_snapshots 6b84e34b-b10e-49a6-8d98-73a372244e25
    { code: 'S0226', name: 'Sealed February 2026', date: '2026-02-02' }, // not checked
    // 2025 auctions (historical)
    { code: 'PA25', name: 'Paris 2025', date: '2025-02-04' }, // page: "4 - 5 February 2025" · listing_page_snapshots 642352d6-9356-4a1a-af3b-34004c9f3366 (was 2025-01-29)
    { code: 'AZ25', name: 'Arizona 2025', date: '2025-01-24' }, // page: "24 January 2025" · listing_page_snapshots f28374cf-8f5e-4437-9419-cbbb3e49d9da
    { code: 'MO25', name: 'Monterey 2025', date: '2025-08-15' }, // page: "15 - 16 August 2025" · listing_page_snapshots caf5c600-bf9d-4e99-a90b-48d8c05caea0 (was Monaco 2025, 2025-05-10)
    { code: 'MI25', name: 'Miami 2025', date: '2025-02-27' }, // page: "27 - 28 February 2025" · listing_page_snapshots 13ab1717-8c72-4ab4-917a-9b5ae556ff86 (was 2025-02-20)
    { code: 'MT25', name: 'Monterey 2025', date: '2025-08-15' }, // not checked; RM's Monterey code is MO (see MO25)
    // 2024 auctions
    { code: 'PA24', name: 'Paris 2024', date: '2024-01-31' }, // page: "31 January 2024" · listing_page_snapshots 421d6674-3d86-49d9-a5d6-7eac4e09afb1 (was 2024-02-01)
    { code: 'AZ24', name: 'Arizona 2024', date: '2024-01-25' }, // page: "25 January 2024" · listing_page_snapshots 3856bb78-8288-43ab-af95-9f3c79f79d4b
    { code: 'MO24', name: 'Monterey 2024', date: '2024-08-15' }, // page: "15 - 17 August 2024" · listing_page_snapshots f4da52df-c414-4feb-818f-db6aa49bea2f (was Monaco 2024, 2024-05-11)
    { code: 'MT24', name: 'Monterey 2024', date: '2024-08-16' }, // not checked; RM's Monterey code is MO (see MO24)
  ];
}
